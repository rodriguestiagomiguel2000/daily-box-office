import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { pool, query } from "./db";

export interface CollectorJobOptions {
  runId?: string;
  movieExternalIds?: string[];
  limitSessionsPerMovie?: number;
  lookbackMinutes?: number;
  triggerSource?: "MANUAL" | "SCHEDULED" | "CRON" | "CLI";
}

export interface CollectorJobResult {
  runId: string;
  status: string;
  moviesFound: number;
  sessionsAttempted: number;
  sessionsSuccessful: number;
  sessionsFailed: number;
  snapshotsCreated: number;
  errors: string[];
  durationMs: number;
}

export interface ActiveRunProgress {
  run_id: string;
  status: string;
  current_movie: string;
  movies_total: number;
  movies_completed: number;
  sessions_found: number;
  sessions_attempted: number;
  sessions_completed: number;
  sessions_successful: number;
  sessions_failed: number;
  snapshots_created: number;
  current_session: string;
  started_at: string;
  elapsed_seconds: number;
  last_error: string | null;
}

let isCollectingGlobal = false;
let activeProgress: ActiveRunProgress | null = null;

export function getActiveProgress(): { isCollecting: boolean; progress: ActiveRunProgress | null } {
  return {
    isCollecting: isCollectingGlobal,
    progress: activeProgress,
  };
}

export interface PreparedRun {
  runId: string;
  collectionRunDbId: number;
  targetIds: string[];
  startedAtIso: string;
  startTime: number;
}

export async function prepareCollectionRun(options: CollectorJobOptions = {}): Promise<PreparedRun | null> {
  // 1. Auto-recover stale runs: Mark any run in status 'RUNNING' that started more than 10 minutes ago as FAILED
  try {
    const staleRecoverRes = await query(
      `UPDATE collection_runs 
       SET status = 'FAILED', 
           completed_at = NOW(), 
           errors = '["Terminated due to timeout"]'::jsonb
       WHERE status = 'RUNNING' 
         AND started_at < NOW() - INTERVAL '10 minutes';`
    );
    if (staleRecoverRes.rowCount && staleRecoverRes.rowCount > 0) {
      console.log(`Auto-recovered ${staleRecoverRes.rowCount} stale running collection runs (elapsed > 10m).`);
    }
  } catch (err) {
    console.error("Failed to perform auto-recovery of stale runs:", err);
  }

  // 2. Database-backed concurrency lock to prevent overlapping runs across different nodes/processes
  try {
    const activeCheck = await query<{ run_id: string; started_at: Date; elapsed_seconds: number }>(
      `SELECT run_id, started_at, EXTRACT(EPOCH FROM (NOW() - started_at)) AS elapsed_seconds 
       FROM collection_runs 
       WHERE status = 'RUNNING' 
       ORDER BY started_at ASC
       LIMIT 1;`
    );

    if (activeCheck.rows.length > 0) {
      const activeRun = activeCheck.rows[0];
      const elapsed = Number(activeRun.elapsed_seconds || 0);
      if (elapsed > 600) {
        console.warn(
          `Active run ${activeRun.run_id} has exceeded 10 minutes (${Math.round(elapsed)}s). Marking as FAILED due to timeout.`
        );
        await query(
          `UPDATE collection_runs 
           SET status = 'FAILED', 
               completed_at = NOW(), 
               errors = '["Terminated due to timeout"]'::jsonb 
           WHERE run_id = $1;`,
          [activeRun.run_id]
        );
        if (activeProgress?.run_id === activeRun.run_id) {
          isCollectingGlobal = false;
          activeProgress = null;
        }
      } else {
        console.warn(
          `Collection run requested while database run ${activeRun.run_id} is active (started at ${new Date(activeRun.started_at).toISOString()}, ${Math.round(elapsed)}s elapsed). Rejecting concurrent run.`
        );
        return null;
      }
    }
  } catch (err) {
    console.error("Database concurrency check failed. Proceeding with caution using in-memory lock only:", err);
  }

  if (isCollectingGlobal) {
    console.warn("Collection run requested while another is already active (in-memory lock). Rejecting concurrent run.");
    return null;
  }

  isCollectingGlobal = true;
  const startTime = Date.now();

  try {
    let targetIds = options.movieExternalIds;
    if (!targetIds || targetIds.length === 0) {
      const trackedRes = await query<{ external_id: string }>(
        "SELECT external_id FROM movies WHERE tracking_enabled = true"
      );
      targetIds = trackedRes.rows.map((r) => r.external_id);
      if (targetIds.length === 0) {
        console.log("No movies currently have tracking enabled. Run finished early.");
        isCollectingGlobal = false;
        activeProgress = null;

        // Save an early-finish run record in the database so telemetry remains correct
        const startedAtIso = new Date().toISOString();
        const triggerSource = options.triggerSource || "SCHEDULED";
        const runInsertRes = await query<{ id: number }>(
          `INSERT INTO collection_runs (
            run_id, started_at, completed_at, status, movies_found, sessions_found,
            sessions_attempted, sessions_successful, sessions_failed,
            snapshots_created, errors, collector_version, trigger_source
          ) VALUES ($1, $2, $2, 'SUCCESS', 0, 0, 0, 0, 0, 0, '["No tracked movies configured."]'::jsonb, '2.0.0', $3)
          RETURNING id;`,
          [`run-temp-${Date.now()}`, startedAtIso, triggerSource]
        );
        const collectionRunDbId = runInsertRes.rows[0].id;
        const runId = options.runId || `run-${collectionRunDbId}`;
        await query(`UPDATE collection_runs SET run_id = $1 WHERE id = $2;`, [runId, collectionRunDbId]);

        return {
          runId,
          collectionRunDbId,
          targetIds: [],
          startedAtIso,
          startTime
        };
      }
    }

    const startedAtIso = new Date().toISOString();
    const triggerSource = options.triggerSource || "SCHEDULED";
    const runInsertRes = await query<{ id: number }>(
      `INSERT INTO collection_runs (
        run_id, started_at, status, movies_found, sessions_found,
        sessions_attempted, sessions_successful, sessions_failed,
        snapshots_created, errors, collector_version, trigger_source
      ) VALUES ($1, $2, 'RUNNING', 0, 0, 0, 0, 0, 0, '[]'::jsonb, '2.0.0', $3)
      RETURNING id;`,
      [`run-temp-${Date.now()}`, startedAtIso, triggerSource]
    );
    const collectionRunDbId = runInsertRes.rows[0].id;
    const runId = options.runId || `run-${collectionRunDbId}`;

    await query(`UPDATE collection_runs SET run_id = $1 WHERE id = $2;`, [runId, collectionRunDbId]);

    activeProgress = {
      run_id: runId,
      status: "RUNNING",
      current_movie: "Initializing Python Collector",
      movies_total: targetIds.length,
      movies_completed: 0,
      sessions_found: 0,
      sessions_attempted: 0,
      sessions_completed: 0,
      sessions_successful: 0,
      sessions_failed: 0,
      snapshots_created: 0,
      current_session: "",
      started_at: startedAtIso,
      elapsed_seconds: 0,
      last_error: null,
    };

    return {
      runId,
      collectionRunDbId,
      targetIds,
      startedAtIso,
      startTime
    };
  } catch (err) {
    isCollectingGlobal = false;
    activeProgress = null;
    throw err;
  }
}

export async function executeCollectionRunFromPrepared(
  prepared: PreparedRun,
  options: CollectorJobOptions = {}
): Promise<CollectorJobResult> {
  const { runId, collectionRunDbId, targetIds, startedAtIso, startTime } = prepared;
  let knownSessionsFile: string | null = null;

  try {
    // 2. Build Python process CLI arguments
    const args = ["nos_collector_job.py", "--run-id", runId];
    if (targetIds.length > 0) {
      args.push("--movie-ids", ...targetIds);
    }
    if (options.limitSessionsPerMovie) {
      args.push("--limit-sessions", String(options.limitSessionsPerMovie));
    }
    args.push("--lookback-minutes", String(options.lookbackMinutes || 30));

    // Query tracked movies from DB to pass to Python collector for targeted opening-day presale collection
    try {
      const trackedRes = await query<{ external_id: string }>(
        "SELECT external_id FROM movies WHERE tracking_enabled = true;"
      );
      const trackedUuids = trackedRes.rows.map((r) => r.external_id).filter(Boolean);
      if (trackedUuids.length > 0) {
        args.push("--tracked-movie-ids", ...trackedUuids);
      }
    } catch (trErr) {
      console.warn("Could not query tracked movie IDs from DB:", trErr);
    }

    // Pre-fetch sessions that already have ticket prices to avoid redundant NOS API calls
    try {
      const knownSessionsRes = await query<{ external_session_id: string }>(
        `SELECT DISTINCT s.external_session_id 
         FROM sessions s 
         JOIN session_ticket_prices stp ON stp.session_id = s.id 
         WHERE s.external_session_id IS NOT NULL;`
      );
      const knownUuids = knownSessionsRes.rows.map((r) => r.external_session_id).filter(Boolean);
      if (knownUuids.length > 0) {
        const tmpPath = path.join(os.tmpdir(), `known_ticket_sessions_${runId}.json`);
        await fs.promises.writeFile(tmpPath, JSON.stringify(knownUuids));
        knownSessionsFile = tmpPath;
        args.push("--known-ticket-sessions-file", tmpPath);
      }
    } catch (knownErr) {
      console.warn("Could not pre-fetch known ticket sessions from DB:", knownErr);
    }

    // 3. Spawn Python process and parse line-by-line streaming JSON progress/sessions with 10-minute timeout protection
    let finalPayload: any = null;
    let stderrOutput = "";
    let incrementalSnapshotsCount = 0;
    const sessionWritePromises: Promise<void>[] = [];
    const TIMEOUT_MS = 600000; // 10 minutes (600 seconds)

    await new Promise<void>((resolve, reject) => {
      const py = spawn("python3", args, { cwd: process.cwd() });
      let isSettled = false;

      const timeoutTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          console.warn(`Collection run ${runId} exceeded 10 minutes. Terminating child process.`);
          py.kill("SIGTERM");
          setTimeout(() => {
            try { py.kill("SIGKILL"); } catch {}
          }, 3000);
          reject(new Error("Terminated due to timeout"));
        }
      }, TIMEOUT_MS);

      const rl = readline.createInterface({ input: py.stdout });

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === "session" && parsed.data) {
            // Incrementally write individual session snapshot to PostgreSQL immediately
            const writePromise = persistSingleSession(collectionRunDbId, parsed.data)
              .then(() => {
                incrementalSnapshotsCount++;
              })
              .catch((err) => {
                console.error("Error persisting incremental session:", err);
              });
            sessionWritePromises.push(writePromise);
          } else if (parsed.type === "progress" && parsed.data) {
            const data = parsed.data;
            activeProgress = {
              run_id: data.run_id || runId,
              status: data.status || "RUNNING",
              current_movie: data.current_movie || "",
              movies_total: data.movies_total || 0,
              movies_completed: data.movies_completed || 0,
              sessions_found: data.sessions_found || 0,
              sessions_attempted: data.sessions_attempted || 0,
              sessions_completed: data.sessions_completed || 0,
              sessions_successful: data.sessions_successful || 0,
              sessions_failed: data.sessions_failed || 0,
              snapshots_created: data.snapshots_created || 0,
              current_session: data.current_session || "",
              started_at: data.started_at || startedAtIso,
              elapsed_seconds: data.elapsed_seconds || 0,
              last_error: data.last_error || null,
            };

            // Non-blocking update to collection_runs row
            query(
              `UPDATE collection_runs SET
                movies_found = $1,
                sessions_found = $2,
                sessions_attempted = $3,
                sessions_successful = $4,
                sessions_failed = $5,
                snapshots_created = $6
               WHERE id = $7;`,
              [
                data.movies_total || 0,
                data.sessions_found || 0,
                data.sessions_attempted || 0,
                data.sessions_successful || 0,
                data.sessions_failed || 0,
                data.snapshots_created || 0,
                collectionRunDbId,
              ]
            ).catch((e) => console.error("Error updating progress in DB:", e));
          } else if (parsed.type === "final") {
            finalPayload = parsed;
          }
        } catch {
          // Non-JSON stdout line
        }
      });

      py.stderr.on("data", (data) => {
        stderrOutput += data.toString();
      });

      py.on("close", (code) => {
        clearTimeout(timeoutTimer);
        if (isSettled) return;
        isSettled = true;

        if (code !== 0 && !finalPayload) {
          reject(new Error(`Python collector process exited with code ${code}: ${stderrOutput}`));
        } else {
          resolve();
        }
      });
    });

    if (!finalPayload) {
      throw new Error(`Python collector process did not return a valid final payload. Stderr: ${stderrOutput.slice(0, 300)}`);
    }

    // Wait for all incremental session writes to finish flushing to Postgres
    await Promise.all(sessionWritePromises);

    return await persistCollectionPayload(prepared, finalPayload, incrementalSnapshotsCount);
  } catch (err: any) {
    isCollectingGlobal = false;
    activeProgress = null;
    console.error("Collection run failed with error:", err);
    try {
      const isTimeout = String(err.message || err).includes("Terminated due to timeout") || String(err.message || err).includes("timeout");
      const errMsg = isTimeout ? "Terminated due to timeout" : (err.message || String(err));
      const errJson = JSON.stringify([errMsg]);
      await query(
        `UPDATE collection_runs SET status = 'FAILED', completed_at = NOW(), errors = $1::jsonb WHERE id = $2;`,
        [errJson, collectionRunDbId]
      );
    } catch (dbErr) {
      console.error("Failed to mark collection_run as FAILED in database:", dbErr);
    }
    throw err;
  } finally {
    if (knownSessionsFile) {
      fs.promises.unlink(knownSessionsFile).catch(() => {});
    }
  }
}

/**
 * Persists a single scraped session with movie, cinema, room, session,
 * immutable seat_snapshot, seat_states, transitions, and ticket prices in an atomic transaction.
 */
export async function persistSingleSession(
  collectionRunDbId: number,
  item: any
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const m = item.movie;
    const c = item.cinema;
    const r = item.room;
    const s = item.session;
    const snap = item.snapshot;

    // 1. Upsert movie
    const movieRes = await client.query<{ id: number }>(
      `INSERT INTO movies (external_id, title, poster_url, duration, age_rating, release_date, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         title = EXCLUDED.title,
         poster_url = COALESCE(NULLIF(EXCLUDED.poster_url, ''), movies.poster_url),
         duration = COALESCE(EXCLUDED.duration, movies.duration),
         age_rating = COALESCE(EXCLUDED.age_rating, movies.age_rating),
         updated_at = NOW()
       RETURNING id;`,
      [m.external_id, m.title, m.poster_url, m.duration, m.age_rating, m.release_date]
    );
    const movieId = movieRes.rows[0].id;

    // 2. Upsert cinema
    const cinemaRes = await client.query<{ id: number }>(
      `INSERT INTO cinemas (external_id, name, city, region, latitude, longitude, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         name = EXCLUDED.name,
         city = COALESCE(EXCLUDED.city, cinemas.city),
         region = COALESCE(EXCLUDED.region, cinemas.region),
         updated_at = NOW()
       RETURNING id;`,
      [c.external_id, c.name, c.city, c.region, c.latitude, c.longitude]
    );
    const cinemaId = cinemaRes.rows[0].id;

    // 3. Upsert room
    const roomRes = await client.query<{ id: number }>(
      `INSERT INTO rooms (cinema_id, external_id, name, capacity, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         cinema_id = EXCLUDED.cinema_id,
         name = EXCLUDED.name,
         capacity = GREATEST(rooms.capacity, EXCLUDED.capacity),
         updated_at = NOW()
       RETURNING id;`,
      [cinemaId, r.external_id, r.name, r.capacity]
    );
    const roomId = roomRes.rows[0].id;

    // 4. Upsert session
    let safeStartsAt: string | null = null;
    try {
      if (s.starts_at) {
        safeStartsAt = new Date(s.starts_at).toISOString();
      }
    } catch {
      safeStartsAt = new Date().toISOString();
    }

    const sessionRes = await client.query<{ id: number }>(
      `INSERT INTO sessions (movie_id, cinema_id, room_id, external_session_id, starts_at, operational_date, format, description, active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
       ON CONFLICT (external_session_id) DO UPDATE SET
         movie_id = EXCLUDED.movie_id,
         cinema_id = EXCLUDED.cinema_id,
         room_id = EXCLUDED.room_id,
         starts_at = COALESCE(EXCLUDED.starts_at, sessions.starts_at),
         operational_date = COALESCE(EXCLUDED.operational_date, sessions.operational_date),
         format = COALESCE(EXCLUDED.format, sessions.format),
         active = true,
         updated_at = NOW()
       RETURNING id;`,
      [movieId, cinemaId, roomId, s.external_session_id, safeStartsAt, s.operational_date, s.format, s.description]
    );
    const sessionId = sessionRes.rows[0].id;

    // 5. Find previous snapshot to compute physical seat transitions
    const prevSnapRes = await client.query<{ id: number; collected_at: Date }>(
      `SELECT id, collected_at FROM seat_snapshots 
       WHERE session_id = $1 
       ORDER BY collected_at DESC LIMIT 1;`,
      [sessionId]
    );

    let prevSeatStatesMap: Map<string, string> = new Map();
    let prevSnapshotId: number | null = null;
    let prevCollectedAt: Date | null = null;

    if (prevSnapRes.rows.length > 0) {
      prevSnapshotId = prevSnapRes.rows[0].id;
      prevCollectedAt = prevSnapRes.rows[0].collected_at;

      const prevStatesRes = await client.query<{ stable_seat_key: string; state: string }>(
        `SELECT stable_seat_key, state FROM seat_states WHERE snapshot_id = $1;`,
        [prevSnapshotId]
      );
      for (const row of prevStatesRes.rows) {
        prevSeatStatesMap.set(row.stable_seat_key, row.state);
      }
    }

    // 6. Insert immutable seat_snapshots record
    const snapRes = await client.query<{ id: number }>(
      `INSERT INTO seat_snapshots (
        session_id, collected_at, total_seats, sellable_seats, available_seats,
        unavailable_seats, safety_seats, unknown_seats, occupancy_proxy,
        invariant_valid, source, collector_version, collection_run_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id;`,
      [
        sessionId,
        snap.collected_at,
        snap.total_seats,
        snap.sellable_seats,
        snap.available_seats,
        snap.unavailable_seats,
        snap.safety_seats,
        snap.unknown_seats,
        snap.occupancy_proxy,
        snap.invariant_valid,
        snap.source || "NOS",
        snap.collector_version || "2.0.0",
        collectionRunDbId,
      ]
    );
    const snapshotDbId = snapRes.rows[0].id;

    // 7. Bulk insert individual physical seat states in safe chunks of 100
    const seats = snap.seats || [];
    const CHUNK_SIZE = 100;
    for (let i = 0; i < seats.length; i += CHUNK_SIZE) {
      const chunk = seats.slice(i, i + CHUNK_SIZE);
      const valuePlaceholders: string[] = [];
      const values: any[] = [];
      let pIdx = 1;

      for (const seat of chunk) {
        valuePlaceholders.push(
          `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7}, $${pIdx + 8}, $${pIdx + 9}, $${pIdx + 10}, $${pIdx + 11}, $${pIdx + 12}, $${pIdx + 13}, $${pIdx + 14}, $${pIdx + 15})`
        );
        values.push(
          snapshotDbId,
          sessionId,
          seat.theater_room_uuid,
          seat.queue,
          seat.row,
          seat.col,
          seat.seat_number,
          seat.stable_seat_key,
          Boolean(seat.is_seat),
          Boolean(seat.is_available),
          Boolean(seat.is_safety_seat),
          Boolean(seat.is_premium),
          Boolean(seat.is_vip),
          Boolean(seat.is_love_seat),
          Boolean(seat.is_handicapped),
          seat.state
        );
        pIdx += 16;
      }

      const seatInsertSQL = `
        INSERT INTO seat_states (
          snapshot_id, session_id, theater_room_uuid, queue, row, col,
          seat_number, stable_seat_key, is_seat, is_available, is_safety_seat,
          is_premium, is_vip, is_love_seat, is_handicapped, state
        ) VALUES ${valuePlaceholders.join(", ")};
      `;
      await client.query(seatInsertSQL, values);
    }

    // 8. Compute and persist seat transitions if previous snapshot existed
    if (prevSnapshotId && prevCollectedAt) {
      const currCollectedAt = new Date(snap.collected_at);
      const deltaMs = Math.max(1, currCollectedAt.getTime() - new Date(prevCollectedAt).getTime());
      const deltaHours = deltaMs / (1000 * 60 * 60);

      let newlyUnavailable = 0;
      let newlyAvailable = 0;
      let newlySafety = 0;
      let otherChanges = 0;
      const transitionEvents: any[] = [];

      for (const seat of seats) {
        const prevState = prevSeatStatesMap.get(seat.stable_seat_key);
        const currState = seat.state;

        if (prevState && prevState !== currState) {
          transitionEvents.push({
            seat_key: seat.stable_seat_key,
            from_state: prevState,
            to_state: currState,
            queue: seat.queue,
            row: seat.row,
            col: seat.col,
            number: seat.seat_number,
          });

          if (prevState === "AVAILABLE" && (currState === "UNAVAILABLE" || currState === "OCCUPIED")) {
            newlyUnavailable++;
          } else if ((prevState === "UNAVAILABLE" || prevState === "OCCUPIED" || prevState === "SAFETY") && currState === "AVAILABLE") {
            newlyAvailable++;
          } else if (currState === "SAFETY" && prevState !== "SAFETY") {
            newlySafety++;
          } else {
            otherChanges++;
          }
        }
      }

      const velocityProxy = deltaHours > 0 ? newlyUnavailable / deltaHours : 0;

      await client.query(
        `INSERT INTO seat_transitions (
          session_id, prev_snapshot_id, curr_snapshot_id, transition_timestamp,
          delta_time_hours, newly_unavailable, newly_available, newly_safety,
          other_state_changes, sales_velocity_proxy, detailed_transitions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
        [
          sessionId,
          prevSnapshotId,
          snapshotDbId,
          snap.collected_at,
          deltaHours,
          newlyUnavailable,
          newlyAvailable,
          newlySafety,
          otherChanges,
          velocityProxy,
          JSON.stringify(transitionEvents),
        ]
      );
    }

    // 9. Insert ticket prices (Only once per session, or if price changes occur)
    const prices = snap.ticket_prices || [];
    if (prices.length > 0) {
      const existingPricesRes = await client.query<{ ticket_type: string; raw_price: string; seats_count: number }>(
        `SELECT ticket_type, raw_price, seats_count FROM session_ticket_prices WHERE session_id = $1;`,
        [sessionId]
      );

      let needsInsert = false;
      if (existingPricesRes.rows.length === 0) {
        needsInsert = true;
      } else {
        const existingMap = new Map<string, { raw_price: number; seats_count: number }>();
        for (const row of existingPricesRes.rows) {
          existingMap.set(row.ticket_type, {
            raw_price: Number(row.raw_price),
            seats_count: Number(row.seats_count || 1),
          });
        }

        for (const tp of prices) {
          const existing = existingMap.get(tp.ticket_type);
          const incomingRaw = Number(tp.raw_price !== undefined ? tp.raw_price : tp.price);
          const incomingSeats = Math.max(1, Number(tp.seats_count || 1));
          if (!existing || existing.raw_price !== incomingRaw || existing.seats_count !== incomingSeats) {
            needsInsert = true;
            break;
          }
        }
      }

      if (needsInsert) {
        for (const tp of prices) {
          const seatsCount = Math.max(1, Number(tp.seats_count || 1));
          const rawPrice = Number(tp.raw_price !== undefined ? tp.raw_price : tp.price);
          const normalizedPrice = Number((rawPrice / seatsCount).toFixed(2));
          const isDefault = Boolean(tp.is_default);

          await client.query(
            `INSERT INTO session_ticket_prices (session_id, collected_at, ticket_type, price, seats_count, raw_price, is_default, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
            [sessionId, snap.collected_at, tp.ticket_type, normalizedPrice, seatsCount, rawPrice, isDefault, "NOS"]
          );
        }
      }
    }

    await client.query("COMMIT");
  } catch (sessionErr) {
    await client.query("ROLLBACK");
    console.error("Error persisting session data:", sessionErr);
    throw sessionErr;
  } finally {
    client.release();
  }
}

export async function persistCollectionPayload(
  prepared: PreparedRun,
  finalPayload: any,
  incrementalSnapshotsCount: number = 0
): Promise<CollectorJobResult> {
  const { runId, collectionRunDbId, targetIds, startTime } = prepared;
  isCollectingGlobal = true; // Ensure the global concurrency lock is set when persisting directly

  try {
    const runMeta = finalPayload.run || {};
    const sessionsData: any[] = finalPayload.sessions || [];

    let snapshotsCreatedCount = incrementalSnapshotsCount;

    // 4. Persist any collected session snapshots that weren't streamed incrementally
    if (sessionsData.length > 0) {
      const DB_CONCURRENCY = 5;
      const sessionQueue = [...sessionsData];

      const worker = async () => {
        while (sessionQueue.length > 0) {
          const item = sessionQueue.shift();
          if (!item) break;

          try {
            await persistSingleSession(collectionRunDbId, item);
            snapshotsCreatedCount++;
          } catch (sessionErr) {
            runMeta.errors = runMeta.errors || [];
            runMeta.errors.push(String(sessionErr));
          }
        }
      };

      const workers = Array.from({ length: Math.min(DB_CONCURRENCY, sessionQueue.length || 1) }, () => worker());
      await Promise.all(workers);
    }

    // 4j. Generate movie performance snapshots for intraday & historical analysis
    if (snapshotsCreatedCount > 0) {
      await generateMoviePerformanceSnapshots(collectionRunDbId);
    }

    // 5. Finalize collection_runs record in PostgreSQL
    const finalRunStatus = runMeta.errors && runMeta.errors.length > 0 ? (snapshotsCreatedCount > 0 ? "PARTIAL" : "FAILED") : "SUCCESS";
    await query(
      `UPDATE collection_runs SET
        completed_at = NOW(),
        status = $1,
        movies_found = $2,
        sessions_found = $3,
        sessions_attempted = $4,
        sessions_successful = $5,
        sessions_failed = $6,
        snapshots_created = $7,
        errors = $8
       WHERE id = $9;`,
      [
        finalRunStatus,
        runMeta.movies_found || targetIds.length,
        runMeta.sessions_found || 0,
        runMeta.sessions_attempted || 0,
        snapshotsCreatedCount,
        Math.max(0, (runMeta.sessions_attempted || 0) - snapshotsCreatedCount),
        snapshotsCreatedCount,
        JSON.stringify(runMeta.errors || []),
        collectionRunDbId,
      ]
    );

    const durationMs = Date.now() - startTime;
    console.log(`Collection run ${runId} completed in ${durationMs}ms: ${snapshotsCreatedCount} snapshots created.`);

    const result: CollectorJobResult = {
      runId,
      status: finalRunStatus,
      moviesFound: runMeta.movies_found || targetIds.length,
      sessionsAttempted: runMeta.sessions_attempted || 0,
      sessionsSuccessful: snapshotsCreatedCount,
      sessionsFailed: Math.max(0, (runMeta.sessions_attempted || 0) - snapshotsCreatedCount),
      snapshotsCreated: snapshotsCreatedCount,
      errors: runMeta.errors || [],
      durationMs,
    };

    if (activeProgress) {
      activeProgress.status = finalRunStatus;
      activeProgress.snapshots_created = snapshotsCreatedCount;
      activeProgress.elapsed_seconds = durationMs / 1000;
    }

    return result;
  } catch (err: any) {
    console.error("Collection run failed with error:", err);
    throw err;
  } finally {
    isCollectingGlobal = false;
  }
}

/**
 * Executes the NOS collector python pipeline, parses snapshots,
 * and persists the entire relational model into PostgreSQL atomically.
 * Enforces a strict global concurrency lock so only 1 run executes at a time.
 * Backwards compatible wrapper for synchronous execution.
 */
export async function executeCollectionRun(options: CollectorJobOptions = {}): Promise<CollectorJobResult> {
  const prepared = await prepareCollectionRun(options);
  if (!prepared) {
    const active = getActiveProgress();
    return {
      runId: active.progress?.run_id || "busy-" + Date.now(),
      status: "SKIPPED_BUSY",
      moviesFound: active.progress?.movies_total || 0,
      sessionsAttempted: active.progress?.sessions_attempted || 0,
      sessionsSuccessful: active.progress?.sessions_successful || 0,
      sessionsFailed: active.progress?.sessions_failed || 0,
      snapshotsCreated: active.progress?.snapshots_created || 0,
      errors: ["Collection is already running in background."],
      durationMs: 0,
    };
  }

  if (prepared.targetIds.length === 0) {
    return {
      runId: prepared.runId,
      status: "SUCCESS",
      moviesFound: 0,
      sessionsAttempted: 0,
      sessionsSuccessful: 0,
      sessionsFailed: 0,
      snapshotsCreated: 0,
      errors: ["No tracked movies configured."],
      durationMs: Date.now() - prepared.startTime,
    };
  }

  return executeCollectionRunFromPrepared(prepared, options);
}

export async function generateMoviePerformanceSnapshots(collectionRunDbId: number): Promise<void> {
  try {
    const pairsRes = await query<{ movie_id: number; operational_date: string; snapshot_timestamp: Date }>(
      `SELECT DISTINCT 
        s.movie_id, 
        COALESCE(NULLIF(s.operational_date, ''), TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD')) as operational_date,
        MAX(ss.collected_at) as snapshot_timestamp
       FROM seat_snapshots ss
       JOIN sessions s ON ss.session_id = s.id
       WHERE ss.collection_run_id = $1
       GROUP BY s.movie_id, COALESCE(NULLIF(s.operational_date, ''), TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD'));`,
      [collectionRunDbId]
    );

    for (const pair of pairsRes.rows) {
      const { movie_id, operational_date, snapshot_timestamp } = pair;
      if (!movie_id || !operational_date) continue;

      const aggRes = await query(
        `WITH session_latest_snaps AS (
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
            AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2)
            AND ss.collected_at <= $3
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
            AND st.transition_timestamp <= $3
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
          COUNT(CASE WHEN sls.starts_at <= $3 THEN 1 END) as shows_started,
          COUNT(CASE WHEN sls.starts_at + INTERVAL '2 hours' <= $3 THEN 1 END) as shows_completed,
          COUNT(CASE WHEN sls.starts_at + INTERVAL '2 hours' > $3 THEN 1 END) as shows_remaining,
          COALESCE(SUM(sls.sellable_seats), 0) as sellable_capacity,
          COALESCE(SUM(sls.available_seats), 0) as available_seats,
          COALESCE(SUM(sls.unavailable_seats), 0) as unavailable_seats,
          COALESCE(SUM(st.newly_unavailable), 0) as newly_unavailable,
          COALESCE(SUM(st.newly_available), 0) as newly_available,
          COALESCE(SUM(st.sales_velocity_proxy), 0.0) as sales_velocity,
          COALESCE(SUM(sls.unavailable_seats * COALESCE(sp.avg_price, CASE WHEN sls.format ILIKE '%IMAX%' THEN 13.50 WHEN sls.format ILIKE '%3D%' THEN 9.50 ELSE 8.75 END)), 0.0) as estimated_revenue
        FROM session_latest_snaps sls
        LEFT JOIN session_transitions st ON sls.session_id = st.session_id
        LEFT JOIN session_prices sp ON sls.session_id = sp.session_id;`,
        [movie_id, operational_date, snapshot_timestamp]
      );

      if (aggRes.rows.length > 0) {
        const row = aggRes.rows[0];
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

        await query(
          `INSERT INTO movie_performance_snapshots (
            movie_id, operational_date, snapshot_timestamp, collection_run_id,
            showcount_total, shows_started, shows_completed, shows_remaining,
            sellable_capacity, available_seats, unavailable_seats, occupancy_proxy,
            estimated_admissions, estimated_revenue, revenue_per_show, admissions_per_show,
            newly_unavailable, newly_available, sales_velocity
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19);`,
          [
            movie_id,
            operational_date,
            snapshot_timestamp,
            collectionRunDbId,
            showcountTotal,
            showsStarted,
            showsCompleted,
            showsRemaining,
            sellableCapacity,
            availableSeats,
            unavailableSeats,
            occupancyProxy,
            estimatedAdmissions,
            estimatedRevenue,
            revenuePerShow,
            admissionsPerShow,
            newlyUnavailable,
            newlyAvailable,
            salesVelocity,
          ]
        );
      }
    }
  } catch (err) {
    console.error("Failed to generate movie performance snapshots:", err);
  }
}
