import { Router } from "express";
import { spawn } from "child_process";
import { 
  getMovieDailyBreakdown, 
  getWeekendBoxOffice, 
  getWeeklyBoxOffice 
} from "./boxoffice";
import { getMoviePresaleCurve } from "./presale";
import { query } from "./db";
import { scheduler } from "./scheduler";
import { executeCollectionRun, getActiveProgress, prepareCollectionRun, executeCollectionRunFromPrepared } from "./collector";
import { resolveSessionUnitPriceJs, recalculateAllPerformanceSnapshots } from "./revenue";
import { computeMovieEODForecast, runHistoricalBacktests, getBacktestSummaryMetrics } from "./forecast";

export const apiRouter = Router();

// Health check
apiRouter.get("/health", async (req, res) => {
  try {
    const dbRes = await query("SELECT NOW() as now;");
    res.json({
      status: "ok",
      database: "connected",
      dbTime: dbRes.rows[0].now,
      scheduler: scheduler.getStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ status: "error", database: "disconnected", error: err.message });
  }
});

// Browse full NOS movies catalog with DB tracking status
apiRouter.get("/movies/catalog", async (req, res) => {
  try {
    // 1. Fetch live catalog from NOS via python job
    const rawCatalogJson = await new Promise<string>((resolve, reject) => {
      const py = spawn("python3", ["nos_collector_job.py", "--browse-all-movies"], { cwd: process.cwd() });
      let stdout = "";
      let stderr = "";
      py.stdout.on("data", (d) => (stdout += d.toString()));
      py.stderr.on("data", (d) => (stderr += d.toString()));
      py.on("close", (code) => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`Python scraper exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });

    const parsed = JSON.parse(rawCatalogJson);
    const rawLiveMovies: any[] = parsed.movies || [];

    // Deduplicate raw live movies by external_id
    const liveMap = new Map<string, any>();
    for (const m of rawLiveMovies) {
      if (!m.external_id) continue;
      const key = String(m.external_id).trim();
      if (!liveMap.has(key)) {
        liveMap.set(key, { ...m, external_id: key });
      } else {
        const existing = liveMap.get(key);
        const mergedFormats = Array.from(new Set([...(existing.formats || []), ...(m.formats || [])]));
        liveMap.set(key, { ...existing, formats: mergedFormats });
      }
    }
    const liveMovies = Array.from(liveMap.values());

    // 2. Safely sync catalog metadata into DB while preserving tracking_enabled state
    for (const m of liveMovies) {
      await query(
        `INSERT INTO movies (external_id, title, poster_url, duration, age_rating, release_date, tracking_enabled, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE, NOW())
         ON CONFLICT (external_id) DO UPDATE SET
           title = EXCLUDED.title,
           poster_url = COALESCE(NULLIF(EXCLUDED.poster_url, ''), movies.poster_url),
           duration = COALESCE(EXCLUDED.duration, movies.duration),
           age_rating = COALESCE(NULLIF(EXCLUDED.age_rating, ''), movies.age_rating),
           release_date = COALESCE(NULLIF(EXCLUDED.release_date, ''), movies.release_date),
           updated_at = NOW();`,
        [m.external_id, m.title, m.poster_url || "", m.duration || null, m.age_rating || "", m.release_date || ""]
      );
    }

    // 3. Fetch local tracking states
    const dbMovies = await query(
      "SELECT id, external_id, title, poster_url, duration, age_rating, release_date, tracking_enabled, updated_at FROM movies;"
    );
    const trackingMap = new Map<string, any>();
    for (const m of dbMovies.rows) {
      trackingMap.set(m.external_id, m);
    }

    const merged = liveMovies.map((m) => {
      const dbEntry = trackingMap.get(m.external_id);
      return {
        ...m,
        id: dbEntry ? dbEntry.id : null,
        title: dbEntry ? dbEntry.title : m.title,
        tracking_enabled: dbEntry ? dbEntry.tracking_enabled : false,
      };
    });

    res.json({ movies: merged });
  } catch (err: any) {
    console.error("Error fetching movies catalog:", err);
    res.status(500).json({ error: err.message });
  }
});

// Toggle tracking for a movie
apiRouter.post("/movies/track", async (req, res) => {
  try {
    const { external_id, title, poster_url, duration, age_rating, release_date, tracking_enabled } = req.body;
    if (!external_id) {
      return res.status(400).json({ error: "external_id is required" });
    }

    const isTracking = Boolean(tracking_enabled);

    const upsertRes = await query(
      `INSERT INTO movies (external_id, title, poster_url, duration, age_rating, release_date, tracking_enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         tracking_enabled = EXCLUDED.tracking_enabled,
         title = COALESCE(EXCLUDED.title, movies.title),
         poster_url = COALESCE(NULLIF(EXCLUDED.poster_url, ''), movies.poster_url),
         updated_at = NOW()
       RETURNING *;`,
      [external_id, title || "Unknown Movie", poster_url || "", duration || null, age_rating || "", release_date || "", isTracking]
    );

    const movie = upsertRes.rows[0];

    // If enabled, trigger a background collection sweep for this specific movie
    if (isTracking) {
      executeCollectionRun({ movieExternalIds: [external_id] }).catch((e) =>
        console.error("Background initial collection failed:", e)
      );
    }

    res.json({ success: true, movie });
  } catch (err: any) {
    console.error("Error updating tracking status:", err);
    res.status(500).json({ error: err.message });
  }
});

// Summary dashboard metrics for all tracked movies (Based on CURRENT/FUTURE sessions only)
apiRouter.get("/dashboard/summary", async (req, res) => {
  try {
    // 1. Get all tracked movies
    const moviesRes = await query(
      `SELECT * FROM movies WHERE tracking_enabled = true ORDER BY title ASC;`
    );
    const trackedMovies = moviesRes.rows;

    const summaryList = [];

    for (const movie of trackedMovies) {
      // 2. Query latest snapshot per CURRENT/FUTURE active session for this movie (starts_at >= NOW() - 30 minutes)
      const latestSnapshotsRes = await query(
        `SELECT DISTINCT ON (s.id)
          s.id as session_id,
          s.cinema_id,
          s.format,
          ss.id as snapshot_id,
          ss.collected_at,
          ss.total_seats,
          ss.sellable_seats,
          ss.available_seats,
          ss.unavailable_seats,
          ss.safety_seats,
          ss.unknown_seats,
          ss.occupancy_proxy,
          ss.invariant_valid
         FROM sessions s
         JOIN seat_snapshots ss ON ss.session_id = s.id
         WHERE s.movie_id = $1 
           AND s.active = true 
           AND (s.starts_at IS NULL OR s.starts_at >= NOW() - INTERVAL '30 minutes')
         ORDER BY s.id, ss.collected_at DESC;`,
        [movie.id]
      );

      const latestSnapshots = latestSnapshotsRes.rows;
      const uniqueCinemas = new Set(latestSnapshots.map((r) => r.cinema_id));
      const sessionsCount = latestSnapshots.length;

      let totalSellable = 0;
      let totalAvailable = 0;
      let totalUnavailable = 0;
      let totalSafety = 0;
      let latestCollectedAt: Date | null = null;

      for (const snap of latestSnapshots) {
        totalSellable += snap.sellable_seats;
        totalAvailable += snap.available_seats;
        totalUnavailable += snap.unavailable_seats;
        totalSafety += snap.safety_seats;
        if (!latestCollectedAt || new Date(snap.collected_at) > latestCollectedAt) {
          latestCollectedAt = new Date(snap.collected_at);
        }
      }

      const overallOccupancyProxy = totalSellable > 0 ? totalUnavailable / totalSellable : 0;

      // 3. Query latest transitions for current sessions
      let newlyUnavailableDelta = 0;
      let newlyAvailableDelta = 0;
      let totalVelocity = 0;

      if (latestSnapshots.length > 0) {
        const sessionIds = latestSnapshots.map((s) => s.session_id);
        const transitionsRes = await query(
          `SELECT DISTINCT ON (session_id)
            newly_unavailable, newly_available, sales_velocity_proxy
           FROM seat_transitions
           WHERE session_id = ANY($1::int[])
           ORDER BY session_id, transition_timestamp DESC;`,
          [sessionIds]
        );

        for (const t of transitionsRes.rows) {
          newlyUnavailableDelta += t.newly_unavailable || 0;
          newlyAvailableDelta += t.newly_available || 0;
          totalVelocity += Number(t.sales_velocity_proxy) || 0;
        }
      }

      // 4. Compute Modular Revenue Estimate based on real ticket prices (excluding €0 vouchers)
      let estimatedRevenue = 0;
      if (latestSnapshots.length > 0) {
        const sessionIds = latestSnapshots.map((s) => s.session_id);
        const pricesRes = await query(
          `SELECT session_id, ticket_type, price, is_default, seats_count FROM session_ticket_prices
           WHERE session_id = ANY($1::int[]) AND price > 0;`,
          [sessionIds]
        );

        const pricesBySession = new Map<number, any[]>();
        for (const p of pricesRes.rows) {
          if (!pricesBySession.has(p.session_id)) {
            pricesBySession.set(p.session_id, []);
          }
          pricesBySession.get(p.session_id)!.push(p);
        }

        for (const snap of latestSnapshots) {
          const sPrices = pricesBySession.get(snap.session_id) || [];
          const avgTicket = resolveSessionUnitPriceJs(snap.format, sPrices);
          estimatedRevenue += snap.unavailable_seats * avgTicket;
        }
      }

      summaryList.push({
        id: movie.id,
        external_id: movie.external_id,
        title: movie.title,
        poster_url: movie.poster_url,
        duration: movie.duration,
        age_rating: movie.age_rating,
        release_date: movie.release_date,
        sessions_count: sessionsCount,
        cinemas_count: uniqueCinemas.size,
        total_sellable_capacity: totalSellable,
        available_seats: totalAvailable,
        unavailable_seats: totalUnavailable,
        safety_seats: totalSafety,
        occupancy_proxy: overallOccupancyProxy,
        newly_unavailable: newlyUnavailableDelta,
        newly_available: newlyAvailableDelta,
        sales_velocity_proxy: totalVelocity,
        estimated_revenue: Math.round(estimatedRevenue * 100) / 100,
        latest_collection_time: latestCollectedAt ? latestCollectedAt.toISOString() : null,
      });
    }

    res.json({
      tracked_movies: summaryList,
      total_tracked_movies: summaryList.length,
      scheduler: scheduler.getStatus(),
    });
  } catch (err: any) {
    console.error("Error generating dashboard summary:", err);
    res.status(500).json({ error: err.message });
  }
});

// Movie detailed metrics: Overview (current sessions only), timeline graphs, sessions list, cinema breakdown
apiRouter.get("/movies/:id/detail", async (req, res) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (isNaN(movieId)) {
      return res.status(400).json({ error: "Invalid movie ID" });
    }

    // 1. Fetch movie metadata
    const movieRes = await query("SELECT * FROM movies WHERE id = $1;", [movieId]);
    if (movieRes.rows.length === 0) {
      return res.status(404).json({ error: "Movie not found" });
    }
    const movie = movieRes.rows[0];

    // 2. Fetch all sessions (both current and historical) for this movie
    const sessionsRes = await query(
      `SELECT 
        s.id as session_id,
        s.external_session_id,
        s.starts_at,
        s.operational_date,
        s.format,
        s.description,
        s.active,
        c.id as cinema_id,
        c.name as cinema_name,
        c.city as cinema_city,
        c.region as cinema_region,
        r.id as room_id,
        r.name as room_name,
        r.capacity as room_capacity
       FROM sessions s
       JOIN cinemas c ON s.cinema_id = c.id
       LEFT JOIN rooms r ON s.room_id = r.id
       WHERE s.movie_id = $1
       ORDER BY c.name ASC, s.starts_at ASC;`,
      [movieId]
    );
    const sessions = sessionsRes.rows;
    const sessionIds = sessions.map((s) => s.session_id);

    if (sessionIds.length === 0) {
      return res.json({
        movie,
        overview: {
          sessions_count: 0,
          cinemas_count: 0,
          sellable_capacity: 0,
          available_seats: 0,
          unavailable_seats: 0,
          occupancy_proxy: 0,
          newly_unavailable: 0,
          estimated_revenue: 0,
          latest_update: null,
        },
        timeline: [],
        sessions: [],
        cinemas: [],
      });
    }

    // 3. Get latest snapshot for each session
    const latestSnapsRes = await query(
      `SELECT DISTINCT ON (session_id)
        id as snapshot_id,
        session_id,
        collected_at,
        total_seats,
        sellable_seats,
        available_seats,
        unavailable_seats,
        safety_seats,
        unknown_seats,
        occupancy_proxy,
        invariant_valid,
        source
       FROM seat_snapshots
       WHERE session_id = ANY($1::int[])
       ORDER BY session_id, collected_at DESC;`,
      [sessionIds]
    );
    const latestSnapsMap = new Map<number, any>();
    for (const snap of latestSnapsRes.rows) {
      latestSnapsMap.set(snap.session_id, snap);
    }

    // 4. Ticket prices for sessions
    const ticketPricesRes = await query(
      `SELECT session_id, ticket_type, price, is_default, seats_count FROM session_ticket_prices
       WHERE session_id = ANY($1::int[]) AND price > 0;`,
      [sessionIds]
    );
    const pricesBySession = new Map<number, any[]>();
    for (const tp of ticketPricesRes.rows) {
      if (!pricesBySession.has(tp.session_id)) {
        pricesBySession.set(tp.session_id, []);
      }
      pricesBySession.get(tp.session_id)!.push(tp);
    }

    // 5. Aggregate overview metrics ONLY FOR CURRENT/FUTURE SESSIONS
    const nowThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 mins ago
    let sellableCapacity = 0;
    let availableSeats = 0;
    let unavailableSeats = 0;
    let totalEstimatedRev = 0;
    let currentSessionsCount = 0;
    let latestUpdate: Date | null = null;
    const cinemaMap = new Map<number, any>();

    const enrichedSessions = sessions.map((sess) => {
      const snap = latestSnapsMap.get(sess.session_id);
      const prices = pricesBySession.get(sess.session_id) || [];
      
      const sellable = snap ? snap.sellable_seats : 0;
      const available = snap ? snap.available_seats : 0;
      const unavailable = snap ? snap.unavailable_seats : 0;
      const occProxy = snap ? snap.occupancy_proxy : 0;
      const invValid = snap ? snap.invariant_valid : true;
      const snapTime = snap ? snap.collected_at : null;

      const startsAtDate = sess.starts_at ? new Date(sess.starts_at) : null;
      const isCurrent = Boolean(sess.active && (!startsAtDate || startsAtDate >= nowThreshold));

      if (snapTime && (!latestUpdate || new Date(snapTime) > latestUpdate)) {
        latestUpdate = new Date(snapTime);
      }

      // Ticket prices calculation via canonical resolver
      const avgPrice = resolveSessionUnitPriceJs(sess.format, prices);
      const sessionRev = unavailable * avgPrice;

      if (isCurrent) {
        currentSessionsCount += 1;
        sellableCapacity += sellable;
        availableSeats += available;
        unavailableSeats += unavailable;
        totalEstimatedRev += sessionRev;

        if (!cinemaMap.has(sess.cinema_id)) {
          cinemaMap.set(sess.cinema_id, {
            cinema_id: sess.cinema_id,
            cinema_name: sess.cinema_name,
            city: sess.cinema_city,
            region: sess.cinema_region,
            sessions_count: 0,
            sellable_capacity: 0,
            available_seats: 0,
            unavailable_seats: 0,
            estimated_revenue: 0,
          });
        }
        const cin = cinemaMap.get(sess.cinema_id);
        cin.sessions_count += 1;
        cin.sellable_capacity += sellable;
        cin.available_seats += available;
        cin.unavailable_seats += unavailable;
        cin.estimated_revenue += sessionRev;
      }

      return {
        session_id: sess.session_id,
        external_session_id: sess.external_session_id,
        cinema_name: sess.cinema_name,
        cinema_city: sess.cinema_city,
        room_name: sess.room_name || "Sala",
        starts_at: sess.starts_at,
        operational_date: sess.operational_date,
        format: sess.format || "2D",
        sellable_seats: sellable,
        available_seats: available,
        unavailable_seats: unavailable,
        occupancy_proxy: occProxy,
        invariant_valid: invValid,
        estimated_revenue: Math.round(sessionRev * 100) / 100,
        ticket_prices: prices,
        latest_update: snapTime ? new Date(snapTime).toISOString() : null,
        is_current: isCurrent,
      };
    });

    const cinemaBreakdown = Array.from(cinemaMap.values()).map((cin) => ({
      ...cin,
      occupancy_proxy: cin.sellable_capacity > 0 ? cin.unavailable_seats / cin.sellable_capacity : 0,
      estimated_revenue: Math.round(cin.estimated_revenue * 100) / 100,
    }));

    // 6. Timeline history across collection sweeps with cumulative reservation proxy
    const timelineRes = await query(
      `SELECT 
        date_trunc('minute', ss.collected_at) as timeline_time,
        SUM(ss.unavailable_seats) as total_unavailable,
        SUM(ss.available_seats) as total_available,
        SUM(ss.sellable_seats) as total_sellable,
        COUNT(DISTINCT ss.session_id) as active_sessions,
        COALESCE(SUM(st.newly_unavailable), 0) as newly_unavailable,
        COALESCE(SUM(st.newly_available), 0) as newly_available,
        COALESCE(AVG(st.sales_velocity_proxy), 0) as avg_velocity
       FROM seat_snapshots ss
       LEFT JOIN seat_transitions st ON st.curr_snapshot_id = ss.id
       WHERE ss.session_id = ANY($1::int[])
       GROUP BY date_trunc('minute', ss.collected_at)
       ORDER BY timeline_time ASC;`,
      [sessionIds]
    );

    let runningCumulativeSales = 0;
    const timeline = timelineRes.rows.map((row) => {
      const sellable = parseInt(row.total_sellable, 10) || 0;
      const unavail = parseInt(row.total_unavailable, 10) || 0;
      const newlyUnavail = parseInt(row.newly_unavailable, 10) || 0;
      runningCumulativeSales += newlyUnavail;

      return {
        timestamp: new Date(row.timeline_time).toISOString(),
        time_label: new Date(row.timeline_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }),
        total_unavailable: unavail,
        total_available: parseInt(row.total_available, 10) || 0,
        total_sellable: sellable,
        occupancy_proxy: sellable > 0 ? unavail / sellable : 0,
        newly_unavailable: newlyUnavail,
        newly_available: parseInt(row.newly_available, 10) || 0,
        sales_velocity_proxy: parseFloat(row.avg_velocity) || 0,
        sessions_count: parseInt(row.active_sessions, 10) || 0,
        cumulative_sales_proxy: runningCumulativeSales,
      };
    });

    const totalNewlyUnavailable = timeline.reduce((acc, t) => acc + t.newly_unavailable, 0);

    res.json({
      movie,
      overview: {
        sessions_count: currentSessionsCount,
        cinemas_count: cinemaBreakdown.length,
        sellable_capacity: sellableCapacity,
        available_seats: availableSeats,
        unavailable_seats: unavailableSeats,
        occupancy_proxy: sellableCapacity > 0 ? unavailableSeats / sellableCapacity : 0,
        newly_unavailable: totalNewlyUnavailable,
        estimated_revenue: Math.round(totalEstimatedRev * 100) / 100,
        latest_update: latestUpdate ? latestUpdate.toISOString() : null,
      },
      timeline,
      sessions: enrichedSessions,
      cinemas: cinemaBreakdown,
    });
  } catch (err: any) {
    console.error("Error fetching movie details:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/:id/history - Session-level chronological tracking history
apiRouter.get("/sessions/:id/history", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: "Invalid session ID" });
    }

    // 1. Fetch session details
    const sessionRes = await query(
      `SELECT 
        s.id as session_id,
        s.external_session_id,
        s.starts_at,
        s.operational_date,
        s.format,
        s.description,
        s.active,
        c.id as cinema_id,
        c.name as cinema_name,
        c.city as cinema_city,
        r.id as room_id,
        r.name as room_name,
        r.capacity as room_capacity,
        m.id as movie_id,
        m.title as movie_title
       FROM sessions s
       JOIN cinemas c ON s.cinema_id = c.id
       JOIN movies m ON s.movie_id = m.id
       LEFT JOIN rooms r ON s.room_id = r.id
       WHERE s.id = $1;`,
      [sessionId]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    const sess = sessionRes.rows[0];

    // 2. Fetch latest snapshot
    const latestSnapRes = await query(
      `SELECT * FROM seat_snapshots WHERE session_id = $1 ORDER BY collected_at DESC LIMIT 1;`,
      [sessionId]
    );
    const latestSnap = latestSnapRes.rows[0] || null;

    // 3. Fetch all snapshots chronologically (oldest -> newest) with transition deltas
    const snapshotsRes = await query(
      `SELECT 
        ss.id,
        ss.collected_at,
        ss.total_seats,
        ss.sellable_seats,
        ss.available_seats,
        ss.unavailable_seats,
        ss.safety_seats,
        ss.unknown_seats,
        ss.occupancy_proxy,
        ss.invariant_valid,
        COALESCE(st.newly_unavailable, 0) as newly_unavailable,
        COALESCE(st.newly_available, 0) as newly_available,
        COALESCE(st.sales_velocity_proxy, 0) as sales_velocity_proxy
       FROM seat_snapshots ss
       LEFT JOIN seat_transitions st ON st.curr_snapshot_id = ss.id
       WHERE ss.session_id = $1
       ORDER BY ss.collected_at ASC;`,
      [sessionId]
    );

    res.json({
      session: {
        session_id: sess.session_id,
        external_session_id: sess.external_session_id,
        cinema_name: sess.cinema_name,
        cinema_city: sess.cinema_city,
        room_name: sess.room_name || "Sala",
        format: sess.format || "2D",
        starts_at: sess.starts_at,
        operational_date: sess.operational_date,
        sellable_capacity: latestSnap ? latestSnap.sellable_seats : (sess.room_capacity || 0),
        available_seats: latestSnap ? latestSnap.available_seats : 0,
        unavailable_seats: latestSnap ? latestSnap.unavailable_seats : 0,
        occupancy_proxy: latestSnap ? latestSnap.occupancy_proxy : 0,
        latest_collected_at: latestSnap ? latestSnap.collected_at : null,
        movie_title: sess.movie_title,
      },
      snapshots: snapshotsRes.rows.map((s) => ({
        id: s.id,
        collected_at: new Date(s.collected_at).toISOString(),
        total_seats: s.total_seats,
        sellable_seats: s.sellable_seats,
        available_seats: s.available_seats,
        unavailable_seats: s.unavailable_seats,
        safety_seats: s.safety_seats,
        unknown_seats: s.unknown_seats,
        occupancy_proxy: parseFloat(s.occupancy_proxy) || 0,
        invariant_valid: Boolean(s.invariant_valid),
        newly_unavailable: parseInt(s.newly_unavailable, 10) || 0,
        newly_available: parseInt(s.newly_available, 10) || 0,
        sales_velocity_proxy: parseFloat(s.sales_velocity_proxy) || 0,
      })),
    });
  } catch (err: any) {
    console.error("Error fetching session history:", err);
    res.status(500).json({ error: err.message });
  }
});

// Collection monitoring and status
apiRouter.get("/collector/status", async (req, res) => {
  try {
    const recentRunsRes = await query(
      `SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT 20;`
    );
    const totalSnapshotsRes = await query(`SELECT COUNT(*) as count FROM seat_snapshots;`);
    const totalStatesRes = await query(`SELECT COUNT(*) as count FROM seat_states;`);
    const totalTransitionsRes = await query(`SELECT COUNT(*) as count FROM seat_transitions;`);

    const active = getActiveProgress();

    res.json({
      scheduler: scheduler.getStatus(),
      active_progress: active.progress,
      is_collecting: active.isCollecting,
      recent_runs: recentRunsRes.rows,
      totals: {
        snapshots: parseInt(totalSnapshotsRes.rows[0].count, 10) || 0,
        individual_seat_states: parseInt(totalStatesRes.rows[0].count, 10) || 0,
        transitions_recorded: parseInt(totalTransitionsRes.rows[0].count, 10) || 0,
      },
    });
  } catch (err: any) {
    console.error("Error fetching collector status:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/collector/progress - Real-time progress monitoring endpoint
apiRouter.get("/collector/progress", (req, res) => {
  const active = getActiveProgress();
  res.json({
    isCollecting: active.isCollecting,
    progress: active.progress,
  });
});

// Manual trigger for collector run
apiRouter.post("/collector/trigger", async (req, res) => {
  try {
    const active = getActiveProgress();
    if (active.isCollecting) {
      return res.status(409).json({
        success: false,
        message: "Collection run is already in progress",
        progress: active.progress,
      });
    }

    // Initiate run in background if not already collecting
    scheduler.triggerRun("MANUAL").catch((err) => {
      console.error("Background trigger error:", err);
    });
    res.json({ success: true, message: "Collection run started in background", status: scheduler.getStatus() });
  } catch (err: any) {
    console.error("Error triggering manual collection:", err);
    res.status(500).json({ error: err.message });
  }
});

// Secure HTTP collection trigger endpoint for Render Cron or external scheduler
apiRouter.post("/collector/cron", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || (req.headers["authorization"] as string | undefined);
    const expectedSecret = process.env.COLLECTOR_CRON_SECRET;

    if (!expectedSecret) {
      console.error("[CRON] COLLECTOR_CRON_SECRET environment variable is not configured on server.");
      return res.status(401).json({ error: "Unauthorized: Missing cron secret configuration" });
    }

    const match = authHeader ? authHeader.match(/^Bearer\s+(.+)$/i) : null;
    const token = match ? match[1].trim() : null;

    if (!token || token !== expectedSecret) {
      console.warn("[CRON] Unauthorized request to /api/collector/cron: invalid or missing bearer token.");
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log("[CRON] Authorized collection cron trigger received. Checking active progress...");
    const active = getActiveProgress();
    if (active.isCollecting) {
      return res.status(409).json({
        success: false,
        message: "Collection run is already in progress",
        progress: active.progress,
      });
    }

    const runId = `cron-${Date.now()}`;
    console.log(`[CRON] Executing collection run ${runId} asynchronously in background...`);

    // Execute asynchronously in the background WITHOUT await
    executeCollectionRun({ triggerSource: "CRON", runId }).catch((err) => {
      console.error("Background run error:", err);
    });

    return res.status(200).json({
      success: true,
      message: "Collection run started for today's sessions",
      runId,
    });
  } catch (err: any) {
    console.error("[CRON] Error starting collection run via /api/collector/cron:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Internal server error during data collection",
    });
  }
});

// Helper functions for Lisbon timezone conversion & Theatrical Operational Day (6:00 AM Cutoff)
export function getOperationalDateStr(date: Date = new Date()): string {
  // 6:00 AM Lisbon Cutoff: Subtract 6 hours from timestamp, format in Europe/Lisbon
  const shifted = new Date(date.getTime() - 6 * 60 * 60 * 1000);
  return shifted.toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });
}

export function parseLisbonLocalToUTC(operationalDateStr: string, timeStr: string): Date {
  const parts = timeStr.split(":");
  const hour = parseInt(parts[0], 10) || 0;
  const minute = parseInt(parts[1], 10) || 0;

  // Theatrical Operational Day: showtimes from 00:00:00 to 05:59:59 belong to the next calendar date
  let calendarDateStr = operationalDateStr;
  if (hour < 6) {
    const [y, m, d] = operationalDateStr.split("-").map((s) => parseInt(s, 10));
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
    calendarDateStr = nextDay.toISOString().split("T")[0];
  }

  const paddedH = String(hour).padStart(2, "0");
  const paddedM = String(minute).padStart(2, "0");
  const naive = new Date(`${calendarDateStr}T${paddedH}:${paddedM}:00.000Z`);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const partsMap: Record<string, string> = {};
  for (const part of formatter.formatToParts(naive)) {
    if (part.type !== "literal") {
      partsMap[part.type] = part.value;
    }
  }

  let formattedHour = parseInt(partsMap.hour, 10);
  if (formattedHour === 24) formattedHour = 0;

  const lisbonAsUTC = new Date(
    Date.UTC(
      parseInt(partsMap.year, 10),
      parseInt(partsMap.month, 10) - 1,
      parseInt(partsMap.day, 10),
      formattedHour,
      parseInt(partsMap.minute, 10),
      parseInt(partsMap.second, 10)
    )
  );

  const offsetMs = lisbonAsUTC.getTime() - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

function getPreviousDateStr(dateStr: string, daysBack: number): string {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  return dt.toISOString().split("T")[0];
}

// Helper function to get or aggregate movie performance snapshots for multiple target points in time in batch
export async function getOrComputeMovieSnapshotsBatch(
  movieId: number,
  targets: Array<{ date: string; targetTs: Date }>
) {
  if (targets.length === 0) return [];

  const formattedTargets = targets.map((t, idx) => ({
    idx,
    op_date: t.date,
    target_ts: t.targetTs.toISOString(),
  }));

  // 1. Batch Cache Lookup (1 SQL Query)
  const cacheRes = await query(
    `WITH targets AS (
      SELECT 
        (elem->>'idx')::int AS target_idx,
        elem->>'op_date' AS op_date,
        (elem->>'target_ts')::timestamptz AS target_ts
      FROM jsonb_array_elements($2::jsonb) AS elem
    )
    SELECT 
      t.target_idx,
      t.op_date,
      t.target_ts,
      mps.id AS snap_id,
      mps.operational_date,
      mps.snapshot_timestamp,
      mps.showcount_total,
      mps.shows_started,
      mps.shows_completed,
      mps.shows_remaining,
      mps.sellable_capacity,
      mps.available_seats,
      mps.unavailable_seats,
      mps.occupancy_proxy,
      mps.estimated_admissions,
      mps.estimated_revenue,
      mps.revenue_per_show,
      mps.admissions_per_show,
      mps.newly_unavailable,
      mps.newly_available,
      mps.sales_velocity
    FROM targets t
    LEFT JOIN LATERAL (
      SELECT *
      FROM movie_performance_snapshots
      WHERE movie_id = $1
        AND operational_date = t.op_date
        AND snapshot_timestamp >= t.target_ts - INTERVAL '45 minutes'
        AND snapshot_timestamp <= t.target_ts
      ORDER BY snapshot_timestamp DESC
      LIMIT 1
    ) mps ON true;`,
    [movieId, JSON.stringify(formattedTargets)]
  );

  const results: any[] = new Array(targets.length);
  const missingTargets: Array<{ idx: number; op_date: string; target_ts: string }> = [];

  for (const row of cacheRes.rows) {
    const idx = Number(row.target_idx);
    if (row.snap_id !== null && row.snap_id !== undefined) {
      results[idx] = {
        date: row.operational_date,
        timestamp: row.snapshot_timestamp,
        time: new Date(row.snapshot_timestamp).toLocaleTimeString("pt-PT", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Lisbon",
        }),
        showcount_total: Number(row.showcount_total),
        shows_started: Number(row.shows_started),
        shows_completed: Number(row.shows_completed),
        shows_remaining: Number(row.shows_remaining),
        sellable_capacity: Number(row.sellable_capacity),
        available_seats: Number(row.available_seats),
        unavailable_seats: Number(row.unavailable_seats),
        occupancy_proxy: Number(row.occupancy_proxy),
        estimated_admissions: Number(row.estimated_admissions),
        estimated_revenue: Number(row.estimated_revenue),
        revenue_per_show: Number(row.revenue_per_show),
        admissions_per_show: Number(row.admissions_per_show),
        newly_unavailable: Number(row.newly_unavailable),
        newly_available: Number(row.newly_available),
        sales_velocity: Number(row.sales_velocity),
        is_fallback: false,
      };
    } else {
      missingTargets.push({
        idx,
        op_date: targets[idx].date,
        target_ts: targets[idx].targetTs.toISOString(),
      });
    }
  }

  // 2. Fallback Batch Aggregation (1 SQL Query if missingTargets > 0)
  if (missingTargets.length > 0) {
    const aggRes = await query(
      `WITH missing_targets AS (
        SELECT 
          (elem->>'idx')::int AS target_idx,
          elem->>'op_date' AS op_date,
          (elem->>'target_ts')::timestamptz AS target_ts
        FROM jsonb_array_elements($2::jsonb) AS elem
      )
      SELECT 
        mt.target_idx,
        mt.op_date,
        mt.target_ts,
        agg.*
      FROM missing_targets mt
      CROSS JOIN LATERAL (
        WITH session_latest_snaps AS (
          SELECT DISTINCT ON (s.id)
            s.id as session_id,
            s.starts_at,
            s.format,
            ss.sellable_seats,
            ss.available_seats,
            ss.unavailable_seats,
            ss.occupancy_proxy,
            ss.collected_at
          FROM sessions s
          JOIN seat_snapshots ss ON ss.session_id = s.id
          WHERE s.movie_id = $1 
            AND (s.operational_date = mt.op_date OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = mt.op_date)
            AND ss.collected_at <= mt.target_ts
          ORDER BY s.id, ss.collected_at DESC
        ),
        session_transitions AS (
          SELECT DISTINCT ON (st.session_id)
            st.session_id,
            st.newly_unavailable,
            st.newly_available,
            st.sales_velocity_proxy
          FROM seat_transitions st
          WHERE st.session_id IN (SELECT session_id FROM session_latest_snaps)
            AND st.transition_timestamp <= mt.target_ts
          ORDER BY st.session_id, st.transition_timestamp DESC
        ),
        session_prices AS (
          SELECT 
            session_id,
            COALESCE(
              AVG(price) FILTER (WHERE is_default = true AND price > 0),
              AVG(price) FILTER (WHERE price > 0 AND ticket_type NOT ILIKE '%fam%' AND ticket_type NOT ILIKE '%pax%' AND (seats_count IS NULL OR seats_count = 1)),
              AVG(price) FILTER (WHERE price > 0)
            ) as avg_price
          FROM session_ticket_prices
          WHERE session_id IN (SELECT session_id FROM session_latest_snaps)
          GROUP BY session_id
        )
        SELECT 
          COUNT(sls.session_id) as showcount_total,
          COUNT(CASE WHEN sls.starts_at <= mt.target_ts THEN 1 END) as shows_started,
          COUNT(CASE WHEN sls.starts_at + INTERVAL '2 hours' <= mt.target_ts THEN 1 END) as shows_completed,
          COUNT(CASE WHEN sls.starts_at + INTERVAL '2 hours' > mt.target_ts THEN 1 END) as shows_remaining,
          COALESCE(SUM(sls.sellable_seats), 0) as sellable_capacity,
          COALESCE(SUM(sls.available_seats), 0) as available_seats,
          COALESCE(SUM(sls.unavailable_seats), 0) as unavailable_seats,
          COALESCE(SUM(st.newly_unavailable), 0) as newly_unavailable,
          COALESCE(SUM(st.newly_available), 0) as newly_available,
          COALESCE(SUM(st.sales_velocity_proxy), 0.0) as sales_velocity,
          COALESCE(SUM(sls.unavailable_seats * COALESCE(sp.avg_price, CASE WHEN sls.format ILIKE '%IMAX%' THEN 13.50 WHEN sls.format ILIKE '%3D%' THEN 9.50 ELSE 8.75 END)), 0.0) as estimated_revenue
        FROM session_latest_snaps sls
        LEFT JOIN session_transitions st ON sls.session_id = st.session_id
        LEFT JOIN session_prices sp ON sls.session_id = sp.session_id
      ) agg;`,
      [movieId, JSON.stringify(missingTargets)]
    );

    const toInsert: any[] = [];
    const nowMs = Date.now();
    const fortyFiveMinMs = 45 * 60 * 1000;

    for (const row of aggRes.rows) {
      const idx = Number(row.target_idx);
      const targetTsObj = targets[idx].targetTs;
      const operationalDate = targets[idx].date;

      const showcountTotal = parseInt(row.showcount_total, 10) || 0;
      const showsStarted = parseInt(row.shows_started, 10) || 0;
      const showsCompleted = parseInt(row.shows_completed, 10) || 0;
      const showsRemaining = parseInt(row.shows_remaining, 10) || 0;
      const sellableCapacity = parseInt(row.sellable_capacity, 10) || 0;
      const availableSeats = parseInt(row.available_seats, 10) || 0;
      const unavailableSeats = parseInt(row.unavailable_seats, 10) || 0;
      const newlyUnavailable = parseInt(row.newly_unavailable, 10) || 0;
      const newlyAvailable = parseInt(row.newly_available, 10) || 0;
      const salesVelocity = parseFloat(row.sales_velocity) || 0.0;
      const estimatedRevenue = Math.round((parseFloat(row.estimated_revenue) || 0.0) * 100) / 100;
      const estimatedAdmissions = unavailableSeats;
      const occupancyProxy = sellableCapacity > 0 ? unavailableSeats / sellableCapacity : 0.0;
      const revenuePerShow = showcountTotal > 0 ? Math.round((estimatedRevenue / showcountTotal) * 100) / 100 : 0.0;
      const admissionsPerShow = showcountTotal > 0 ? Math.round((estimatedAdmissions / showcountTotal) * 10) / 10 : 0.0;

      results[idx] = {
        date: operationalDate,
        timestamp: targetTsObj.toISOString(),
        time: targetTsObj.toLocaleTimeString("pt-PT", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Lisbon",
        }),
        showcount_total: showcountTotal,
        shows_started: showsStarted,
        shows_completed: showsCompleted,
        shows_remaining: showsRemaining,
        sellable_capacity: sellableCapacity,
        available_seats: availableSeats,
        unavailable_seats: unavailableSeats,
        occupancy_proxy: occupancyProxy,
        estimated_admissions: estimatedAdmissions,
        estimated_revenue: estimatedRevenue,
        revenue_per_show: revenuePerShow,
        admissions_per_show: admissionsPerShow,
        newly_unavailable: newlyUnavailable,
        newly_available: newlyAvailable,
        sales_velocity: salesVelocity,
        is_fallback: true,
      };

      if (nowMs - targetTsObj.getTime() > fortyFiveMinMs) {
        toInsert.push({
          movie_id: movieId,
          operational_date: operationalDate,
          snapshot_timestamp: targetTsObj.toISOString(),
          showcount_total: showcountTotal,
          shows_started: showsStarted,
          shows_completed: showsCompleted,
          shows_remaining: showsRemaining,
          sellable_capacity: sellableCapacity,
          available_seats: availableSeats,
          unavailable_seats: unavailableSeats,
          occupancy_proxy: occupancyProxy,
          estimated_admissions: estimatedAdmissions,
          estimated_revenue: estimatedRevenue,
          revenue_per_show: revenuePerShow,
          admissions_per_show: admissionsPerShow,
          newly_unavailable: newlyUnavailable,
          newly_available: newlyAvailable,
          sales_velocity: salesVelocity,
        });
      }
    }

    // 3. Write-Through Batch Insert (1 SQL Query if toInsert > 0)
    if (toInsert.length > 0) {
      try {
        await query(
          `INSERT INTO movie_performance_snapshots (
            movie_id, operational_date, snapshot_timestamp,
            showcount_total, shows_started, shows_completed, shows_remaining,
            sellable_capacity, available_seats, unavailable_seats, occupancy_proxy,
            estimated_admissions, estimated_revenue, revenue_per_show, admissions_per_show,
            newly_unavailable, newly_available, sales_velocity
          )
          SELECT
            (elem->>'movie_id')::int,
            elem->>'operational_date',
            (elem->>'snapshot_timestamp')::timestamptz,
            (elem->>'showcount_total')::int,
            (elem->>'shows_started')::int,
            (elem->>'shows_completed')::int,
            (elem->>'shows_remaining')::int,
            (elem->>'sellable_capacity')::int,
            (elem->>'available_seats')::int,
            (elem->>'unavailable_seats')::int,
            (elem->>'occupancy_proxy')::double precision,
            (elem->>'estimated_admissions')::int,
            (elem->>'estimated_revenue')::numeric,
            (elem->>'revenue_per_show')::numeric,
            (elem->>'admissions_per_show')::numeric,
            (elem->>'newly_unavailable')::int,
            (elem->>'newly_available')::int,
            (elem->>'sales_velocity')::double precision
          FROM jsonb_array_elements($1::jsonb) AS elem;`,
          [JSON.stringify(toInsert)]
        );
      } catch (insertErr) {
        console.warn("[Cache Batch Write-Through] Failed batch insert:", insertErr);
      }
    }
  }

  return results;
}

// Single snapshot helper wrapping batch calculation for backwards compatibility
export async function getOrComputeMovieSnapshotAtTime(
  movieId: number,
  operationalDate: string,
  targetTimestamp: Date
) {
  const snaps = await getOrComputeMovieSnapshotsBatch(movieId, [
    { date: operationalDate, targetTs: targetTimestamp },
  ]);
  return snaps[0];
}

// 1. Fetch available historical operational dates for a movie
apiRouter.get("/movies/:id/history-dates", async (req, res) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (isNaN(movieId)) return res.status(400).json({ error: "Invalid movie ID" });

    const todayStr = getOperationalDateStr();
    const datesRes = await query(
      `SELECT DISTINCT 
        COALESCE(NULLIF(s.operational_date, ''), TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD')) as date
       FROM sessions s
       WHERE s.movie_id = $1 AND s.starts_at IS NOT NULL
         AND COALESCE(NULLIF(s.operational_date, ''), TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD')) <= $2
       ORDER BY date DESC;`,
      [movieId, todayStr]
    );

    const dates = datesRes.rows.map((r) => r.date).filter(Boolean);
    res.json({ dates });
  } catch (err: any) {
    console.error("Error fetching movie history dates:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Intraday sweep progression log for a specific date
apiRouter.get("/movies/:id/intraday-progression", async (req, res) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (isNaN(movieId)) return res.status(400).json({ error: "Invalid movie ID" });

    const dateStr = (req.query.date as string) || getOperationalDateStr();

    const snapsRes = await query(
      `SELECT 
        id,
        movie_id,
        operational_date,
        snapshot_timestamp,
        showcount_total,
        shows_started,
        shows_completed,
        shows_remaining,
        sellable_capacity,
        available_seats,
        unavailable_seats,
        occupancy_proxy,
        estimated_admissions,
        estimated_revenue,
        revenue_per_show,
        admissions_per_show,
        newly_unavailable,
        newly_available,
        sales_velocity,
        created_at
       FROM movie_performance_snapshots
       WHERE movie_id = $1 AND operational_date = $2
       ORDER BY snapshot_timestamp ASC;`,
      [movieId, dateStr]
    );

    if (snapsRes.rows.length > 0) {
      const items = snapsRes.rows.map((s) => ({
        ...s,
        snapshot_timestamp: s.snapshot_timestamp,
        timestamp: s.snapshot_timestamp,
        time: new Date(s.snapshot_timestamp).toLocaleTimeString("pt-PT", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Lisbon",
        }),
        showcount_total: Number(s.showcount_total),
        shows_started: Number(s.shows_started),
        shows_completed: Number(s.shows_completed),
        shows_remaining: Number(s.shows_remaining),
        sellable_capacity: Number(s.sellable_capacity),
        available_seats: Number(s.available_seats),
        unavailable_seats: Number(s.unavailable_seats),
        occupancy_proxy: Number(s.occupancy_proxy),
        estimated_admissions: Number(s.estimated_admissions),
        estimated_revenue: Number(s.estimated_revenue),
        revenue_per_show: Number(s.revenue_per_show),
        admissions_per_show: Number(s.admissions_per_show),
        newly_unavailable: Number(s.newly_unavailable),
        newly_available: Number(s.newly_available),
        sales_velocity: Number(s.sales_velocity),
      }));
      return res.json({ date: dateStr, items });
    }

    // Fallback if no pre-stored snapshots exist for this date: batch calculate for all distinct collected_at timestamps
    const timestampsRes = await query(
      `SELECT DISTINCT ss.collected_at
       FROM seat_snapshots ss
       JOIN sessions s ON ss.session_id = s.id
       WHERE s.movie_id = $1 
         AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2)
       ORDER BY ss.collected_at ASC;`,
      [movieId, dateStr]
    );

    if (timestampsRes.rows.length === 0) {
      return res.json({ date: dateStr, items: [] });
    }

    const targets = timestampsRes.rows.map((row) => ({
      date: dateStr,
      targetTs: new Date(row.collected_at),
    }));

    const items = await getOrComputeMovieSnapshotsBatch(movieId, targets);

    res.json({ date: dateStr, items });
  } catch (err: any) {
    console.error("Error fetching intraday progression:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Intraday Comparison: TODAY vs YESTERDAY vs SAME WEEKDAY LAST WEEK (6:00 AM Theatrical Cutoff)
apiRouter.get("/movies/:id/intraday-comparison", async (req, res) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (isNaN(movieId)) return res.status(400).json({ error: "Invalid movie ID" });

    const todayStr = getOperationalDateStr();
    const targetDateStr = (req.query.date as string) || todayStr;

    let targetTimeStr = (req.query.time as string) || new Date().toLocaleTimeString("pt-PT", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/Lisbon",
    });

    if (targetTimeStr.length === 4) targetTimeStr = "0" + targetTimeStr;

    const yesterdayStr = getPreviousDateStr(targetDateStr, 1);
    const lastWeekStr = getPreviousDateStr(targetDateStr, 7);

    const targetTs = parseLisbonLocalToUTC(targetDateStr, targetTimeStr);
    const yesterdayTs = parseLisbonLocalToUTC(yesterdayStr, targetTimeStr);
    const lastWeekTs = parseLisbonLocalToUTC(lastWeekStr, targetTimeStr);

    const targets = [
      { date: targetDateStr, targetTs },
      { date: yesterdayStr, targetTs: yesterdayTs },
      { date: lastWeekStr, targetTs: lastWeekTs },
    ];

    const [todaySnap, yesterdaySnap, lastWeekSnap] = await getOrComputeMovieSnapshotsBatch(movieId, targets);

    res.json({
      target_date: targetDateStr,
      target_time: targetTimeStr,
      today: todaySnap,
      yesterday: yesterdaySnap,
      last_week: lastWeekSnap,
    });
  } catch (err: any) {
    console.error("Error generating intraday comparison:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Intraday Curves for Recharts (Hourly series across the Theatrical Operational Day: 08:00 to 05:59 next day)
apiRouter.get("/movies/:id/intraday-curves", async (req, res) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (isNaN(movieId)) return res.status(400).json({ error: "Invalid movie ID" });

    const todayStr = getOperationalDateStr();
    const targetDateStr = (req.query.date as string) || todayStr;

    const yesterdayStr = getPreviousDateStr(targetDateStr, 1);
    const lastWeekStr = getPreviousDateStr(targetDateStr, 7);

    // Operational Day Timeline: 08:00 morning through 23:59 and late night 02:00, 05:59 (Next Day EOD Cutoff)
    const hours = [
      "08:00",
      "10:00",
      "12:00",
      "14:00",
      "16:00",
      "18:00",
      "20:00",
      "22:00",
      "23:59",
      "02:00",
      "05:59",
    ];

    // Build the full batch of 33 targets (11 hours * 3 dates)
    const targets: { date: string; targetTs: Date }[] = [];
    for (const h of hours) {
      targets.push({ date: targetDateStr, targetTs: parseLisbonLocalToUTC(targetDateStr, h) });
      targets.push({ date: yesterdayStr, targetTs: parseLisbonLocalToUTC(yesterdayStr, h) });
      targets.push({ date: lastWeekStr, targetTs: parseLisbonLocalToUTC(lastWeekStr, h) });
    }

    const batchedResults = await getOrComputeMovieSnapshotsBatch(movieId, targets);

    const points = hours.map((h, i) => {
      const todaySnap = batchedResults[i * 3];
      const yesterdaySnap = batchedResults[i * 3 + 1];
      const lastWeekSnap = batchedResults[i * 3 + 2];

      return {
        time: h === "05:59" ? "05:59 (EOD)" : h === "02:00" ? "02:00 (+1d)" : h,
        today_revenue: todaySnap?.estimated_revenue || 0,
        today_admissions: todaySnap?.estimated_admissions || 0,
        today_occupancy: Math.round((todaySnap?.occupancy_proxy || 0) * 1000) / 10,
        today_velocity: Math.round((todaySnap?.sales_velocity || 0) * 10) / 10,
        today_shows: todaySnap?.showcount_total || 0,
        today_completed: todaySnap?.shows_completed || 0,

        yesterday_revenue: yesterdaySnap?.estimated_revenue || 0,
        yesterday_admissions: yesterdaySnap?.estimated_admissions || 0,
        yesterday_occupancy: Math.round((yesterdaySnap?.occupancy_proxy || 0) * 1000) / 10,
        yesterday_velocity: Math.round((yesterdaySnap?.sales_velocity || 0) * 10) / 10,
        yesterday_shows: yesterdaySnap?.showcount_total || 0,
        yesterday_completed: yesterdaySnap?.shows_completed || 0,

        last_week_revenue: lastWeekSnap?.estimated_revenue || 0,
        last_week_admissions: lastWeekSnap?.estimated_admissions || 0,
        last_week_occupancy: Math.round((lastWeekSnap?.occupancy_proxy || 0) * 1000) / 10,
        last_week_velocity: Math.round((lastWeekSnap?.sales_velocity || 0) * 10) / 10,
        last_week_shows: lastWeekSnap?.showcount_total || 0,
        last_week_completed: lastWeekSnap?.shows_completed || 0,
      };
    });

    res.json({
      target_date: targetDateStr,
      yesterday_date: yesterdayStr,
      last_week_date: lastWeekStr,
      curve: points,
    });
  } catch (err: any) {
    console.error("Error generating intraday curves:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4b. Intraday End-of-Day Revenue Forecast (Deterministic, weighted curve-based projection)
const handleIntradayForecast = async (req: any, res: any) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (isNaN(movieId)) return res.status(400).json({ error: "Invalid movie ID" });

    const todayStr = getOperationalDateStr();
    const targetDateStr = (req.query.date as string) || (req.query.operationalDate as string) || todayStr;

    let targetTimeStr = (req.query.time as string) || (req.query.cutoff as string) || new Date().toLocaleTimeString("pt-PT", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/Lisbon",
    });

    if (targetTimeStr.length === 4) targetTimeStr = "0" + targetTimeStr;

    const forecastData = await computeMovieEODForecast(movieId, targetDateStr, targetTimeStr);
    res.json(forecastData);
  } catch (err: any) {
    console.error("Error computing intraday EOD forecast:", err);
    res.status(500).json({ error: err.message });
  }
};

apiRouter.get("/movies/:id/forecast", handleIntradayForecast);
apiRouter.get("/movies/:id/intraday-forecast", handleIntradayForecast);
apiRouter.get("/movies/:id/intraday/forecast", handleIntradayForecast);

// Backtest metrics & execution endpoints
apiRouter.get("/forecast/backtest-results", async (req, res) => {
  try {
    const movieId = req.query.movieId ? parseInt(req.query.movieId as string, 10) : undefined;
    const data = await getBacktestSummaryMetrics(movieId);
    res.json(data);
  } catch (err: any) {
    console.error("Error fetching backtest metrics:", err);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post("/forecast/run-backtests", async (req, res) => {
  try {
    const { movieIds, overwrite } = req.body || {};
    const results = await runHistoricalBacktests({ movieIds, overwrite });
    res.json({ success: true, results });
  } catch (err: any) {
    console.error("Error running backtests:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Hourly Breakdown & Date Comparison (Hourly tickets sold & revenue across the theatrical day)
apiRouter.get("/movies/:id/hourly-breakdown", async (req, res) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (isNaN(movieId)) return res.status(400).json({ error: "Invalid movie ID" });

    const todayStr = getOperationalDateStr();
    const dateStr = (req.query.date as string) || todayStr;
    const compareDateStr = (req.query.compare_date as string) || null;

    const standardHours = [
      { hour: 9, label: "09:00" },
      { hour: 10, label: "10:00" },
      { hour: 11, label: "11:00" },
      { hour: 12, label: "12:00" },
      { hour: 13, label: "13:00" },
      { hour: 14, label: "14:00" },
      { hour: 15, label: "15:00" },
      { hour: 16, label: "16:00" },
      { hour: 17, label: "17:00" },
      { hour: 18, label: "18:00" },
      { hour: 19, label: "19:00" },
      { hour: 20, label: "20:00" },
      { hour: 21, label: "21:00" },
      { hour: 22, label: "22:00" },
      { hour: 23, label: "23:00" },
      { hour: 0, label: "00:00 (+1d)" },
      { hour: 1, label: "01:00 (+1d)" },
    ];

    async function fetchHourlyDataForDate(d: string) {
      // 1. Fetch final snapshot total for this date (The single source of truth for the entire theatrical day)
      const finalSnapRes = await query(
        `WITH session_latest AS (
          SELECT DISTINCT ON (s.id)
            s.id as session_id,
            s.starts_at,
            s.format,
            ss.unavailable_seats,
            ss.sellable_seats,
            ss.collected_at
          FROM sessions s
          JOIN seat_snapshots ss ON ss.session_id = s.id
          WHERE s.movie_id = $1
            AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2)
          ORDER BY s.id, ss.collected_at DESC
        ),
        session_prices AS (
          SELECT 
            session_id,
            COALESCE(
              AVG(price) FILTER (WHERE is_default = true AND price > 0),
              AVG(price) FILTER (WHERE price > 0 AND ticket_type NOT ILIKE '%fam%' AND ticket_type NOT ILIKE '%pax%' AND (seats_count IS NULL OR seats_count = 1)),
              AVG(price) FILTER (WHERE price > 0)
            ) as avg_price
          FROM session_ticket_prices
          GROUP BY session_id
        )
        SELECT 
          COUNT(*) as total_sessions,
          COALESCE(SUM(sl.unavailable_seats), 0)::int as total_admissions,
          COALESCE(SUM(sl.unavailable_seats * COALESCE(sp.avg_price, CASE WHEN s.format ILIKE '%IMAX%' THEN 13.50 WHEN s.format ILIKE '%3D%' THEN 9.50 ELSE 8.75 END)), 0.0)::numeric as total_revenue
        FROM session_latest sl
        JOIN sessions s ON sl.session_id = s.id
        LEFT JOIN session_prices sp ON sl.session_id = sp.session_id;`,
        [movieId, d]
      );

      const finalAdmissions = parseInt(finalSnapRes.rows[0]?.total_admissions, 10) || 0;
      const finalRevenue = parseFloat(finalSnapRes.rows[0]?.total_revenue) || 0.0;
      const totalSessions = parseInt(finalSnapRes.rows[0]?.total_sessions, 10) || 0;

      // 2. Fetch baseline presales (seats unavailable at the first tracked sweep of the day)
      const baselineRes = await query(
        `WITH session_first AS (
          SELECT DISTINCT ON (s.id)
            s.id as session_id,
            s.starts_at,
            s.format,
            ss.unavailable_seats,
            ss.sellable_seats,
            ss.collected_at
          FROM sessions s
          JOIN seat_snapshots ss ON ss.session_id = s.id
          WHERE s.movie_id = $1
            AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2)
          ORDER BY s.id, ss.collected_at ASC
        ),
        session_prices AS (
          SELECT 
            session_id,
            COALESCE(
              AVG(price) FILTER (WHERE is_default = true AND price > 0),
              AVG(price) FILTER (WHERE price > 0 AND ticket_type NOT ILIKE '%fam%' AND ticket_type NOT ILIKE '%pax%' AND (seats_count IS NULL OR seats_count = 1)),
              AVG(price) FILTER (WHERE price > 0)
            ) as avg_price
          FROM session_ticket_prices
          GROUP BY session_id
        )
        SELECT 
          COUNT(*) as total_sessions,
          COALESCE(SUM(sf.unavailable_seats), 0)::int as baseline_seats,
          COALESCE(SUM(sf.unavailable_seats * COALESCE(sp.avg_price, CASE WHEN s.format ILIKE '%IMAX%' THEN 13.50 WHEN s.format ILIKE '%3D%' THEN 9.50 ELSE 8.75 END)), 0.0)::numeric as baseline_revenue
        FROM session_first sf
        JOIN sessions s ON sf.session_id = s.id
        LEFT JOIN session_prices sp ON sf.session_id = sp.session_id;`,
        [movieId, d]
      );

      const baselineSeats = parseInt(baselineRes.rows[0]?.baseline_seats, 10) || 0;
      const baselineRevenue = parseFloat(baselineRes.rows[0]?.baseline_revenue) || 0.0;

      // 3. Fetch hourly seat transitions with both NET and GROSS metrics
      const transRes = await query(
        `WITH session_prices AS (
          SELECT 
            session_id,
            COALESCE(
              AVG(price) FILTER (WHERE is_default = true AND price > 0),
              AVG(price) FILTER (WHERE price > 0 AND ticket_type NOT ILIKE '%fam%' AND ticket_type NOT ILIKE '%pax%' AND (seats_count IS NULL OR seats_count = 1)),
              AVG(price) FILTER (WHERE price > 0)
            ) as avg_price
          FROM session_ticket_prices
          GROUP BY session_id
        )
        SELECT 
          EXTRACT(HOUR FROM st.transition_timestamp AT TIME ZONE 'Europe/Lisbon')::int as lisbon_hour,
          COALESCE(SUM(st.newly_unavailable), 0)::int as gross_tickets,
          COALESCE(SUM(st.newly_unavailable * COALESCE(sp.avg_price, CASE WHEN s.format ILIKE '%IMAX%' THEN 13.50 WHEN s.format ILIKE '%3D%' THEN 9.50 ELSE 8.75 END)), 0.0)::numeric as gross_revenue,
          COALESCE(SUM(st.newly_available), 0)::int as returns_tickets,
          COALESCE(SUM(st.newly_available * COALESCE(sp.avg_price, CASE WHEN s.format ILIKE '%IMAX%' THEN 13.50 WHEN s.format ILIKE '%3D%' THEN 9.50 ELSE 8.75 END)), 0.0)::numeric as returns_revenue,
          COALESCE(SUM(st.newly_unavailable - st.newly_available), 0)::int as net_tickets,
          COALESCE(SUM((st.newly_unavailable - st.newly_available) * COALESCE(sp.avg_price, CASE WHEN s.format ILIKE '%IMAX%' THEN 13.50 WHEN s.format ILIKE '%3D%' THEN 9.50 ELSE 8.75 END)), 0.0)::numeric as net_revenue
        FROM seat_transitions st
        JOIN sessions s ON st.session_id = s.id
        LEFT JOIN session_prices sp ON s.id = sp.session_id
        WHERE s.movie_id = $1 
          AND (
            st.transition_timestamp >= (($2::text || ' 06:00:00')::timestamp AT TIME ZONE 'Europe/Lisbon')
            AND st.transition_timestamp < ((($2::date + 1)::text || ' 06:00:00')::timestamp AT TIME ZONE 'Europe/Lisbon')
          )
        GROUP BY lisbon_hour;`,
        [movieId, d]
      );

      const transMap = new Map<number, {
        gross_tickets: number;
        gross_revenue: number;
        returns_tickets: number;
        returns_revenue: number;
        net_tickets: number;
        net_revenue: number;
      }>();

      let totalGrossTickets = 0;
      let totalGrossRev = 0;
      let totalReturnsTickets = 0;
      let totalReturnsRev = 0;
      let totalNetTickets = 0;
      let totalNetRev = 0;

      let peakHour: string | null = null;
      let peakTickets = 0;
      let peakRevenue = 0;

      for (const r of transRes.rows) {
        const grossT = parseInt(r.gross_tickets, 10) || 0;
        const grossR = parseFloat(r.gross_revenue) || 0;
        const retT = parseInt(r.returns_tickets, 10) || 0;
        const retR = parseFloat(r.returns_revenue) || 0;
        const netT = parseInt(r.net_tickets, 10) || 0;
        const netR = parseFloat(r.net_revenue) || 0;

        transMap.set(r.lisbon_hour, {
          gross_tickets: grossT,
          gross_revenue: grossR,
          returns_tickets: retT,
          returns_revenue: retR,
          net_tickets: netT,
          net_revenue: netR,
        });

        totalGrossTickets += grossT;
        totalGrossRev += grossR;
        totalReturnsTickets += retT;
        totalReturnsRev += retR;
        totalNetTickets += netT;
        totalNetRev += netR;

        if (netT > peakTickets) {
          peakTickets = netT;
          peakRevenue = netR;
          const matched = standardHours.find((h) => h.hour === r.lisbon_hour);
          peakHour = matched ? matched.label : `${r.lisbon_hour}:00`;
        }
      }

      const hourly: any[] = [];
      let cumTickets = 0;
      let cumRev = 0;

      // 1. Add "Pre-Sales / Opening Baseline" bucket at start of theatrical day (before 09:00)
      cumTickets += baselineSeats;
      cumRev += baselineRevenue;

      hourly.push({
        hour: "Pre-Sales (Baseline)",
        raw_hour: 8,
        is_baseline: true,
        tickets_sold: baselineSeats,
        estimated_revenue: Math.round(baselineRevenue * 100) / 100,
        gross_tickets_sold: baselineSeats,
        gross_revenue: Math.round(baselineRevenue * 100) / 100,
        returns_tickets: 0,
        returns_revenue: 0,
        cumulative_tickets: cumTickets,
        cumulative_revenue: Math.round(cumRev * 100) / 100,
      });

      // 2. Add each standard hour using NET flow (newly_unavailable - newly_available)
      let rawHourlySumTickets = 0;
      let rawHourlySumRev = 0;
      for (const h of standardHours) {
        const data = transMap.get(h.hour);
        if (data) {
          rawHourlySumTickets += data.net_tickets;
          rawHourlySumRev += data.net_revenue;
        }
      }

      // Calculate residual discrepancy
      const residualTickets = finalAdmissions - (baselineSeats + rawHourlySumTickets);
      const residualRev = Math.round((finalRevenue - (baselineRevenue + rawHourlySumRev)) * 100) / 100;

      // Identify active hours with observed transitions
      const activeHourIndices: number[] = [];
      for (let i = 0; i < standardHours.length; i++) {
        const data = transMap.get(standardHours[i].hour);
        if (data && (data.net_tickets !== 0 || data.net_revenue !== 0)) {
          activeHourIndices.push(i);
        }
      }

      let allocatedResidualRev = 0;
      let allocatedResidualTickets = 0;

      for (let i = 0; i < standardHours.length; i++) {
        const h = standardHours[i];
        const data = transMap.get(h.hour) || {
          gross_tickets: 0,
          gross_revenue: 0,
          returns_tickets: 0,
          returns_revenue: 0,
          net_tickets: 0,
          net_revenue: 0,
        };

        let itemResidualRev = 0;
        let itemResidualTickets = 0;

        // Distribute residual proportionally across active hours rather than dumping into midnight
        if (activeHourIndices.includes(i) && rawHourlySumRev > 0) {
          const isLastActive = i === activeHourIndices[activeHourIndices.length - 1];
          if (isLastActive) {
            itemResidualRev = Math.round((residualRev - allocatedResidualRev) * 100) / 100;
            itemResidualTickets = residualTickets - allocatedResidualTickets;
          } else {
            const share = data.net_revenue / rawHourlySumRev;
            itemResidualRev = Math.round(residualRev * share * 100) / 100;
            allocatedResidualRev += itemResidualRev;

            const tShare = rawHourlySumTickets > 0 ? data.net_tickets / rawHourlySumTickets : 0;
            itemResidualTickets = Math.round(residualTickets * tShare);
            allocatedResidualTickets += itemResidualTickets;
          }
        }

        const itemNetTickets = data.net_tickets + itemResidualTickets;
        const itemNetRev = Math.round((data.net_revenue + itemResidualRev) * 100) / 100;
        const itemGrossTickets = data.gross_tickets + Math.max(0, itemResidualTickets);
        const itemGrossRev = Math.round((data.gross_revenue + Math.max(0, itemResidualRev)) * 100) / 100;

        cumTickets += itemNetTickets;
        cumRev += itemNetRev;

        hourly.push({
          hour: h.label,
          raw_hour: h.hour,
          tickets_sold: itemNetTickets,
          estimated_revenue: itemNetRev,
          gross_tickets_sold: itemGrossTickets,
          gross_revenue: itemGrossRev,
          returns_tickets: data.returns_tickets,
          returns_revenue: Math.round(data.returns_revenue * 100) / 100,
          cumulative_tickets: cumTickets,
          cumulative_revenue: Math.round(cumRev * 100) / 100,
        });
      }

      const walkupTickets = Math.max(0, finalAdmissions - baselineSeats);
      const walkupRevenue = Math.max(0, Math.round((finalRevenue - baselineRevenue) * 100) / 100);
      const baselinePct = finalAdmissions > 0 ? Math.round((baselineSeats / finalAdmissions) * 1000) / 10 : 0;
      const walkupPct = finalAdmissions > 0 ? Math.round((walkupTickets / finalAdmissions) * 1000) / 10 : 0;

      return {
        has_data: totalSessions > 0 || finalAdmissions > 0 || totalGrossTickets > 0,
        summary: {
          total_tickets: finalAdmissions,
          total_revenue: Math.round(finalRevenue * 100) / 100,
          baseline_tickets: baselineSeats,
          baseline_revenue: Math.round(baselineRevenue * 100) / 100,
          baseline_pct: baselinePct,
          walkup_tickets: walkupTickets,
          walkup_revenue: walkupRevenue,
          walkup_pct: walkupPct,
          gross_tickets: totalGrossTickets,
          gross_revenue: Math.round(totalGrossRev * 100) / 100,
          returns_tickets: totalReturnsTickets,
          returns_revenue: Math.round(totalReturnsRev * 100) / 100,
          peak_hour: peakHour,
          peak_tickets: peakTickets,
          peak_revenue: Math.round(peakRevenue * 100) / 100,
          avg_hourly_tickets: walkupTickets > 0 ? Math.round((walkupTickets / standardHours.length) * 10) / 10 : 0,
        },
        hourly,
      };
    }

    const primaryData = await fetchHourlyDataForDate(dateStr);
    let compareData: Awaited<ReturnType<typeof fetchHourlyDataForDate>> | null = null;

    if (compareDateStr && compareDateStr !== dateStr) {
      compareData = await fetchHourlyDataForDate(compareDateStr);
    }

    // Build a map of compareData hourly items by hour name for robust matching
    const compareMap = new Map<string, any>();
    if (compareData) {
      for (const cItem of compareData.hourly) {
        compareMap.set(cItem.hour, cItem);
      }
    }

    const combinedHourly = primaryData.hourly.map((item) => {
      const compItem = compareMap.get(item.hour);
      return {
        ...item,
        ...(compItem
          ? {
              compare_tickets_sold: compItem.tickets_sold,
              compare_estimated_revenue: compItem.estimated_revenue,
              compare_gross_tickets_sold: compItem.gross_tickets_sold,
              compare_gross_revenue: compItem.gross_revenue,
              compare_cumulative_tickets: compItem.cumulative_tickets,
              compare_cumulative_revenue: compItem.cumulative_revenue,
              delta_tickets: item.tickets_sold - compItem.tickets_sold,
              delta_revenue: Math.round((item.estimated_revenue - compItem.estimated_revenue) * 100) / 100,
              delta_cumulative_tickets: item.cumulative_tickets - compItem.cumulative_tickets,
              delta_cumulative_revenue: Math.round((item.cumulative_revenue - compItem.cumulative_revenue) * 100) / 100,
            }
          : {}),
      };
    });

    res.json({
      movie_id: movieId,
      date: dateStr,
      compare_date: compareDateStr,
      has_data: primaryData.has_data,
      compare_has_data: compareData ? compareData.has_data : undefined,
      summary: primaryData.summary,
      compare_summary: compareData ? compareData.summary : null,
      hourly: combinedHourly,
    });
  } catch (err: any) {
    console.error("Error generating hourly breakdown:", err);
    res.status(500).json({ error: err.message });
  }
});


// GET /api/boxoffice/daily-history
apiRouter.get("/boxoffice/daily-history", async (req, res) => {
  try {
    const todayStr = getOperationalDateStr();

    // 1. Get all movies that have tracking_enabled = true OR have performance snapshots / sessions for dates <= todayStr
    const moviesRes = await query(`
      SELECT DISTINCT m.id, m.title, m.poster_url, m.release_date, m.tracking_enabled
      FROM movies m
      WHERE m.tracking_enabled = true 
         OR m.id IN (SELECT DISTINCT movie_id FROM movie_performance_snapshots WHERE operational_date <= $1)
         OR m.id IN (SELECT DISTINCT movie_id FROM sessions WHERE COALESCE(NULLIF(operational_date, ''), TO_CHAR((starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD')) <= $1)
      ORDER BY m.tracking_enabled DESC, m.id ASC;
    `, [todayStr]);
    const movies = moviesRes.rows;

    // 2. Fetch latest snapshot per (movie_id, operational_date) from movie_performance_snapshots for dates <= todayStr
    const snapsRes = await query(`
      WITH latest_snaps AS (
        SELECT DISTINCT ON (movie_id, operational_date)
          id,
          movie_id,
          operational_date,
          snapshot_timestamp,
          showcount_total,
          shows_started,
          shows_completed,
          sellable_capacity,
          available_seats,
          unavailable_seats,
          occupancy_proxy,
          estimated_admissions,
          estimated_revenue,
          sales_velocity
        FROM movie_performance_snapshots
        WHERE operational_date <= $1
        ORDER BY movie_id, operational_date, snapshot_timestamp DESC
      )
      SELECT ls.*
      FROM latest_snaps ls;
    `, [todayStr]);

    // 3. Group snapshots by operational_date (strictly <= todayStr)
    const dateMap = new Map<string, Record<number, any>>();

    for (const snap of snapsRes.rows) {
      const opDate = snap.operational_date;
      if (!opDate || opDate > todayStr) continue;
      if (!dateMap.has(opDate)) {
        dateMap.set(opDate, {});
      }
      const rev = parseFloat(snap.estimated_revenue) || 0;
      const adm = parseInt(snap.estimated_admissions, 10) || 0;
      const cap = parseInt(snap.sellable_capacity, 10) || 0;
      const occ = parseFloat(snap.occupancy_proxy) || 0;
      const shows = parseInt(snap.showcount_total, 10) || 0;

      dateMap.get(opDate)![snap.movie_id] = {
        movie_id: snap.movie_id,
        revenue: rev,
        admissions: adm,
        capacity: cap,
        occupancy: occ,
        shows: shows,
        snapshot_timestamp: snap.snapshot_timestamp,
        is_live: opDate === todayStr,
      };
    }

    // 4. Ensure today's operational date is present in dateMap even if no snapshots exist yet
    if (!dateMap.has(todayStr)) {
      dateMap.set(todayStr, {});
    }

    // 5. For today's date, compute live stats if snapshot is missing
    for (const movie of movies) {
      const todayData = dateMap.get(todayStr)?.[movie.id];
      if (!todayData) {
        const liveSnap = await getOrComputeMovieSnapshotAtTime(movie.id, todayStr, new Date());
        if (liveSnap && (liveSnap.showcount_total > 0 || liveSnap.estimated_revenue > 0)) {
          if (!dateMap.has(todayStr)) dateMap.set(todayStr, {});
          dateMap.get(todayStr)![movie.id] = {
            movie_id: movie.id,
            revenue: liveSnap.estimated_revenue,
            admissions: liveSnap.estimated_admissions,
            capacity: liveSnap.sellable_capacity,
            occupancy: liveSnap.occupancy_proxy,
            shows: liveSnap.showcount_total,
            snapshot_timestamp: liveSnap.timestamp || new Date().toISOString(),
            is_live: true,
          };
        }
      }
    }

    // 6. Build operational dates list sorted DESC (strictly <= todayStr)
    const sortedDates = Array.from(dateMap.keys())
      .filter((d) => d <= todayStr)
      .sort((a, b) => b.localeCompare(a));

    const rows = sortedDates.map((opDate) => {
      const movieEntries = dateMap.get(opDate) || {};
      let dailyTotalRev = 0;
      let dailyTotalAdm = 0;

      for (const movieIdStr in movieEntries) {
        const entry = movieEntries[movieIdStr];
        dailyTotalRev += entry.revenue || 0;
        dailyTotalAdm += entry.admissions || 0;
      }

      return {
        operational_date: opDate,
        is_today: opDate === todayStr,
        total_revenue: Math.round(dailyTotalRev * 100) / 100,
        total_admissions: dailyTotalAdm,
        movie_data: movieEntries,
      };
    });

    // 7. Calculate overall movie totals
    const totalsPerMovie: Record<number, { total_revenue: number; total_admissions: number; days_tracked: number }> = {};
    let grandTotalRevenue = 0;
    let grandTotalAdmissions = 0;

    for (const movie of movies) {
      totalsPerMovie[movie.id] = { total_revenue: 0, total_admissions: 0, days_tracked: 0 };
    }

    for (const row of rows) {
      for (const movie of movies) {
        const mData = row.movie_data[movie.id];
        if (mData && (mData.revenue > 0 || mData.shows > 0)) {
          totalsPerMovie[movie.id].total_revenue += mData.revenue || 0;
          totalsPerMovie[movie.id].total_admissions += mData.admissions || 0;
          totalsPerMovie[movie.id].days_tracked += 1;

          grandTotalRevenue += mData.revenue || 0;
          grandTotalAdmissions += mData.admissions || 0;
        }
      }
    }

    for (const id in totalsPerMovie) {
      totalsPerMovie[id].total_revenue = Math.round(totalsPerMovie[id].total_revenue * 100) / 100;
    }

    res.json({
      movies,
      rows,
      summary: {
        totals_per_movie: totalsPerMovie,
        grand_total_revenue: Math.round(grandTotalRevenue * 100) / 100,
        grand_total_admissions: grandTotalAdmissions,
      },
    });
  } catch (err: any) {
    console.error("Error fetching daily box office history:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/movies/:id/daily-breakdown
apiRouter.get("/movies/:id/daily-breakdown", async (req, res) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (isNaN(movieId)) {
      return res.status(400).json({ error: "Invalid movie ID" });
    }

    const data = await getMovieDailyBreakdown(movieId);
    if (!data) {
      return res.status(404).json({ error: "Movie not found" });
    }

    res.json(data);
  } catch (err: any) {
    console.error(`Error fetching daily breakdown for movie ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/movies/:id/presale-curve - Returns opening day cumulative presale curve (T-14, ... T-0)
apiRouter.get("/movies/:id/presale-curve", async (req, res) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (isNaN(movieId)) {
      return res.status(400).json({ error: "Invalid movie ID" });
    }

    const data = await getMoviePresaleCurve(movieId);
    if (!data) {
      return res.status(404).json({ error: "Movie not found" });
    }

    res.json(data);
  } catch (err: any) {
    console.error(`Error fetching presale curve for movie ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/boxoffice/weekends
apiRouter.get("/boxoffice/weekends", async (req, res) => {
  try {
    const data = await getWeekendBoxOffice();
    res.json(data);
  } catch (err: any) {
    console.error("Error fetching weekend box office:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/boxoffice/weeks
apiRouter.get("/boxoffice/weeks", async (req, res) => {
  try {
    const data = await getWeeklyBoxOffice();
    res.json(data);
  } catch (err: any) {
    console.error("Error fetching weekly box office:", err);
    res.status(500).json({ error: err.message });
  }
});

// Configure scheduler interval or toggle
apiRouter.post("/collector/config", (req, res) => {
  const { interval_minutes, is_running } = req.body;

  if (typeof interval_minutes === "number" && interval_minutes >= 1) {
    scheduler.setIntervalMinutes(interval_minutes);
  }

  if (typeof is_running === "boolean") {
    if (is_running) {
      scheduler.start(scheduler.getStatus().intervalMinutes);
    } else {
      scheduler.stop();
    }
  }

  res.json({ success: true, scheduler: scheduler.getStatus() });
});

// Fallback 404 handler for any unmatched /api requests
apiRouter.use((req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// Error handling middleware for /api routes
apiRouter.use((err: any, req: any, res: any, next: any) => {
  console.error("API Router Error:", err);
  res.status(500).json({ error: err?.message || "Internal server error" });
});
