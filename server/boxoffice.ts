import { query } from "./db";
import { getOperationalDateStr, getOrComputeMovieSnapshotAtTime } from "./api";

// Helper to determine Day of Week (0 = Sunday, 1 = Monday, ..., 4 = Thursday, 5 = Friday, 6 = Saturday)
export function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function getDayOfWeekName(dateStr: string): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[getDayOfWeek(dateStr)];
}

export function getDayOfWeekShort(dateStr: string): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[getDayOfWeek(dateStr)];
}

// Theatrical Weekend: Thursday, Friday, Saturday, Sunday
export function isTheatricalWeekend(dateStr: string): boolean {
  const dow = getDayOfWeek(dateStr);
  return dow === 4 || dow === 5 || dow === 6 || dow === 0;
}

// Find Thursday anchor for Theatrical Week / Weekend
export function getTheatricalWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const daysSinceThursday = (dow + 3) % 7;
  dt.setUTCDate(dt.getUTCDate() - daysSinceThursday);
  return dt.toISOString().split("T")[0];
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().split("T")[0];
}

export function getDayDifference(dateStr1: string, dateStr2: string): number {
  const [y1, m1, d1] = dateStr1.split("-").map(Number);
  const [y2, m2, d2] = dateStr2.split("-").map(Number);
  const dt1 = Date.UTC(y1, m1 - 1, d1);
  const dt2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((dt2 - dt1) / (24 * 60 * 60 * 1000));
}

export function normalizeDateStr(dateVal: any): string | null {
  if (!dateVal) return null;
  if (typeof dateVal === "string") {
    const trimmed = dateVal.trim();
    if (!trimmed) return null;
    return trimmed.split("T")[0].trim();
  }
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
    const y = dateVal.getUTCFullYear();
    const m = String(dateVal.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dateVal.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * The theatrical weekend is Thursday -> Friday -> Saturday -> Sunday.
 * Returns the Thursday anchoring Weekend #1 for a movie released on `releaseDateStr`.
 *
 * - If released Thursday, Friday, Saturday, or Sunday: Opening weekend is that current weekend (anchored by its Thursday).
 * - If released Monday, Tuesday, or Wednesday: The movie opens into the upcoming weekend (anchored by the next Thursday).
 */
export function getMovieOpeningWeekendThu(releaseDateStr: string): string {
  const dow = getDayOfWeek(releaseDateStr); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  let offset = 0;
  if (dow === 4) offset = 0;      // Thursday
  else if (dow === 5) offset = -1; // Friday
  else if (dow === 6) offset = -2; // Saturday
  else if (dow === 0) offset = -3; // Sunday
  else if (dow === 1) offset = 3;  // Monday (opens into next Thursday)
  else if (dow === 2) offset = 2;  // Tuesday (opens into next Thursday)
  else if (dow === 3) offset = 1;  // Wednesday (opens into next Thursday)
  return addDays(releaseDateStr, offset);
}

/**
 * Calculates a movie's theatrical Run Day:
 * Release date = Run Day 1.
 * Release date + 1 day = Day 2.
 * Independent of data collection start date.
 */
export function getMovieRunDay(
  releaseDateStr: string | null | undefined,
  operationalDateStr: string,
  fallbackFirstOpDate?: string
): { run_day: number; run_day_label: string } {
  const cleanReleaseDate = normalizeDateStr(releaseDateStr) || normalizeDateStr(fallbackFirstOpDate) || operationalDateStr;
  const diff = getDayDifference(cleanReleaseDate, operationalDateStr);
  const runDay = diff + 1;
  const runDayLabel = runDay > 0 ? `Day ${runDay}` : `Preview (${runDay})`;
  return { run_day: runDay, run_day_label: runDayLabel };
}

/**
 * Calculates a movie's theatrical Weekend #:
 * The first theatrical weekend associated with the movie's release date is Weekend #1.
 * Independent of data collection start date.
 */
export function getMovieWeekendNumber(
  releaseDateStr: string | null | undefined,
  weekendThuStr: string,
  fallbackFirstOpDate?: string
): { weekend_number: number; weekend_number_label: string } {
  const cleanReleaseDate = normalizeDateStr(releaseDateStr) || normalizeDateStr(fallbackFirstOpDate) || weekendThuStr;
  const openingWeekendThu = getMovieOpeningWeekendThu(cleanReleaseDate);
  const weeksDiff = Math.round(getDayDifference(openingWeekendThu, weekendThuStr) / 7);
  const weekendNumber = weeksDiff + 1;
  const weekendNumberLabel = weekendNumber >= 1 ? `Weekend #${weekendNumber}` : `Preview Weekend`;
  return { weekend_number: weekendNumber, weekend_number_label: weekendNumberLabel };
}

/**
 * Calculates a movie's theatrical Week #:
 * Theatrical week is Thursday -> Wednesday.
 * The first theatrical week containing the movie's release date is Week #1.
 * Independent of data collection start date.
 */
export function getMovieWeekNumber(
  releaseDateStr: string | null | undefined,
  weekThuStr: string,
  fallbackFirstOpDate?: string
): { week_number: number; week_number_label: string } {
  const cleanReleaseDate = normalizeDateStr(releaseDateStr) || normalizeDateStr(fallbackFirstOpDate) || weekThuStr;
  const openingWeekThu = getTheatricalWeekStart(cleanReleaseDate);
  const weeksDiff = Math.round(getDayDifference(openingWeekThu, weekThuStr) / 7);
  const weekNumber = weeksDiff + 1;
  const weekNumberLabel = weekNumber >= 1 ? `Week #${weekNumber}` : `Preview Week`;
  return { week_number: weekNumber, week_number_label: weekNumberLabel };
}

export function calculatePercentChange(curr: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || isNaN(prev) || prev === 0) {
    return null;
  }
  const pct = ((curr - prev) / prev) * 100;
  return Math.round(pct * 10) / 10;
}

export function formatPeriodLabel(startStr: string, endStr: string): string {
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  const startDt = new Date(Date.UTC(sy, sm - 1, sd));
  const endDt = new Date(Date.UTC(ey, em - 1, ed));

  const startMonth = startDt.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const endMonth = endDt.toLocaleString("en-US", { month: "short", timeZone: "UTC" });

  if (startMonth === endMonth && sy === ey) {
    return `${startMonth} ${sd} – ${ed}, ${sy}`;
  }
  return `${startMonth} ${sd} – ${endMonth} ${ed}, ${ey}`;
}

/**
 * Fetch unified daily performance and session counts across all movies or for a specific movie.
 */
export async function getUnifiedDailyBoxOfficeData(movieId?: number) {
  const todayStr = getOperationalDateStr();

  // 1. Fetch latest snapshot per (movie_id, operational_date)
  const snapParams: any[] = [];
  let snapWhere = "";
  if (movieId) {
    snapParams.push(movieId);
    snapWhere = "WHERE movie_id = $1";
  }

  const snapsRes = await query(
    `WITH latest_snaps AS (
      SELECT DISTINCT ON (movie_id, operational_date)
        movie_id,
        operational_date,
        estimated_revenue::float as revenue,
        estimated_admissions::int as admissions,
        showcount_total::int as showcount,
        snapshot_timestamp
      FROM movie_performance_snapshots
      ${snapWhere}
      ORDER BY movie_id, operational_date, snapshot_timestamp DESC
    )
    SELECT * FROM latest_snaps;`,
    snapParams
  );

  // 2. Fetch distinct sessions and distinct cinemas per (movie_id, operational_date)
  const sessionParams: any[] = [];
  let sessionWhere = "";
  if (movieId) {
    sessionParams.push(movieId);
    sessionWhere = "AND s.movie_id = $1";
  }

  const sessionsRes = await query(
    `SELECT 
       s.movie_id,
       COALESCE(NULLIF(s.operational_date, ''), TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD')) as op_date,
       s.cinema_id,
       s.id as session_id
     FROM sessions s
     WHERE s.starts_at IS NOT NULL ${sessionWhere};`,
    sessionParams
  );

  // 3. Fetch movies metadata
  const moviesRes = await query(
    `SELECT id, external_id, title, poster_url, duration, age_rating, release_date, tracking_enabled
     FROM movies
     ${movieId ? "WHERE id = $1" : "WHERE tracking_enabled = true OR id IN (SELECT DISTINCT movie_id FROM sessions)"}
     ORDER BY tracking_enabled DESC, id ASC;`,
    movieId ? [movieId] : []
  );

  const moviesMap = new Map<number, any>();
  for (const m of moviesRes.rows) {
    moviesMap.set(m.id, m);
  }

  // 4. Build unified daily map: Map<`${movie_id}_${op_date}`, DailyEntry>
  const dailyMap = new Map<
    string,
    {
      movie_id: number;
      op_date: string;
      revenue: number;
      admissions: number;
      snapshot_timestamp: string | null;
      cinemaIds: Set<number>;
      sessionIds: Set<number>;
      is_live: boolean;
    }
  >();

  // Add snapshots
  for (const snap of snapsRes.rows) {
    const opDate = snap.operational_date;
    if (!opDate) continue;
    const key = `${snap.movie_id}_${opDate}`;
    dailyMap.set(key, {
      movie_id: snap.movie_id,
      op_date: opDate,
      revenue: snap.revenue || 0,
      admissions: snap.admissions || 0,
      snapshot_timestamp: snap.snapshot_timestamp,
      cinemaIds: new Set(),
      sessionIds: new Set(),
      is_live: opDate === todayStr,
    });
  }

  // Add session stats (cinema IDs and session IDs)
  for (const sess of sessionsRes.rows) {
    const opDate = sess.op_date;
    if (!opDate) continue;
    const key = `${sess.movie_id}_${opDate}`;
    if (!dailyMap.has(key)) {
      dailyMap.set(key, {
        movie_id: sess.movie_id,
        op_date: opDate,
        revenue: 0,
        admissions: 0,
        snapshot_timestamp: null,
        cinemaIds: new Set(),
        sessionIds: new Set(),
        is_live: opDate === todayStr,
      });
    }
    const entry = dailyMap.get(key)!;
    if (sess.cinema_id) entry.cinemaIds.add(sess.cinema_id);
    if (sess.session_id) entry.sessionIds.add(sess.session_id);
  }

  // Check today live data if snapshot is missing for today
  for (const movie of moviesRes.rows) {
    const todayKey = `${movie.id}_${todayStr}`;
    const entry = dailyMap.get(todayKey);
    if (!entry || (entry.revenue === 0 && entry.admissions === 0)) {
      // Check live snapshot
      try {
        const liveSnap = await getOrComputeMovieSnapshotAtTime(movie.id, todayStr, new Date());
        if (liveSnap && (liveSnap.estimated_revenue > 0 || liveSnap.showcount_total > 0)) {
          if (!dailyMap.has(todayKey)) {
            dailyMap.set(todayKey, {
              movie_id: movie.id,
              op_date: todayStr,
              revenue: liveSnap.estimated_revenue || 0,
              admissions: liveSnap.estimated_admissions || 0,
              snapshot_timestamp: liveSnap.timestamp || new Date().toISOString(),
              cinemaIds: new Set(),
              sessionIds: new Set(),
              is_live: true,
            });
          } else {
            const e = dailyMap.get(todayKey)!;
            e.revenue = liveSnap.estimated_revenue || 0;
            e.admissions = liveSnap.estimated_admissions || 0;
            e.snapshot_timestamp = liveSnap.timestamp || new Date().toISOString();
            e.is_live = true;
          }
        }
      } catch (err) {
        console.warn(`Failed to compute live snapshot for movie ${movie.id} on ${todayStr}:`, err);
      }
    }
  }

  return {
    moviesMap,
    dailyMap,
    todayStr,
  };
}

/**
 * 1. GET /api/movies/:id/daily-breakdown
 */
export async function getMovieDailyBreakdown(movieId: number) {
  const { moviesMap, dailyMap, todayStr } = await getUnifiedDailyBoxOfficeData(movieId);
  const movie = moviesMap.get(movieId);
  if (!movie) {
    return null;
  }

  // Filter daily items for this movie
  const movieDaysRaw: Array<{
    operational_date: string;
    revenue: number;
    admissions: number;
    cinemas_count: number;
    sessions_count: number;
    is_live: boolean;
  }> = [];

  for (const entry of dailyMap.values()) {
    if (entry.movie_id === movieId) {
      // Only include days with some activity or data
      const cinemasCount = entry.cinemaIds.size;
      const sessionsCount = entry.sessionIds.size;
      if (entry.revenue > 0 || entry.admissions > 0 || cinemasCount > 0 || sessionsCount > 0) {
        movieDaysRaw.push({
          operational_date: entry.op_date,
          revenue: Math.round(entry.revenue * 100) / 100,
          admissions: entry.admissions,
          cinemas_count: cinemasCount,
          sessions_count: sessionsCount,
          is_live: entry.op_date === todayStr,
        });
      }
    }
  }

  // Sort chronological ASC to compute sequential deltas
  movieDaysRaw.sort((a, b) => a.operational_date.localeCompare(b.operational_date));

  const firstOpDate = movieDaysRaw.length > 0 ? movieDaysRaw[0].operational_date : todayStr;

  const dateMap = new Map<string, typeof movieDaysRaw[0]>();
  for (const d of movieDaysRaw) {
    dateMap.set(d.operational_date, d);
  }

  const days = movieDaysRaw.map((day, idx) => {
    const prevDay = idx > 0 ? movieDaysRaw[idx - 1] : null;
    const prevWeekDate = addDays(day.operational_date, -7);
    const prevWeekDay = dateMap.get(prevWeekDate);

    // Calculate independent theatrical Run Day strictly based on the movie's official release_date (Release Date = Day 1)
    const { run_day, run_day_label } = getMovieRunDay(
      movie?.release_date,
      day.operational_date,
      movieDaysRaw[0]?.operational_date
    );

    return {
      operational_date: day.operational_date,
      run_day,
      run_day_label,
      day_of_week: getDayOfWeekName(day.operational_date),
      day_of_week_short: getDayOfWeekShort(day.operational_date),
      is_weekend: isTheatricalWeekend(day.operational_date),
      is_today: day.operational_date === todayStr,
      is_live: day.is_live,
      revenue: day.revenue,
      admissions: day.admissions,
      cinemas_count: day.cinemas_count,
      sessions_count: day.sessions_count,

      // Sequential Day-over-Day comparisons (vs immediately previous day with data)
      prev_day_date: prevDay ? prevDay.operational_date : null,
      revenue_change_pct: calculatePercentChange(day.revenue, prevDay?.revenue),
      admissions_change_pct: calculatePercentChange(day.admissions, prevDay?.admissions),
      cinemas_change_pct: calculatePercentChange(day.cinemas_count, prevDay?.cinemas_count),
      sessions_change_pct: calculatePercentChange(day.sessions_count, prevDay?.sessions_count),

      // Week-over-Week comparisons (vs same weekday from previous week)
      prev_week_date: prevWeekDay ? prevWeekDate : null,
      prev_week_revenue_change_pct: calculatePercentChange(day.revenue, prevWeekDay?.revenue),
      prev_week_admissions_change_pct: calculatePercentChange(day.admissions, prevWeekDay?.admissions),
    };
  });

  // Calculate summary metrics
  let totalRevenue = 0;
  let totalAdmissions = 0;
  let totalSessions = 0;
  let maxCinemas = 0;

  for (const d of days) {
    totalRevenue += d.revenue;
    totalAdmissions += d.admissions;
    totalSessions += d.sessions_count;
    if (d.cinemas_count > maxCinemas) maxCinemas = d.cinemas_count;
  }

  // Return days in ascending chronological order: oldest operational day -> newest operational day (Day 1 at top)
  return {
    movie,
    days,
    summary: {
      total_days: days.length,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      total_admissions: totalAdmissions,
      total_sessions: totalSessions,
      max_cinemas: maxCinemas,
    },
  };
}

/**
 * 2. GET /api/boxoffice/weekends
 */
export async function getWeekendBoxOffice() {
  const { moviesMap, dailyMap, todayStr } = await getUnifiedDailyBoxOfficeData();

  // Build map of earliest recorded operational date per movie
  const movieFirstOpDateMap = new Map<number, string>();
  for (const entry of dailyMap.values()) {
    if (entry.revenue > 0 || entry.admissions > 0 || entry.cinemaIds.size > 0 || entry.sessionIds.size > 0) {
      const existing = movieFirstOpDateMap.get(entry.movie_id);
      if (!existing || entry.op_date < existing) {
        movieFirstOpDateMap.set(entry.movie_id, entry.op_date);
      }
    }
  }

  // Find all distinct Thursdays anchoring theatrical weekends
  // Group days by weekend start (Thu) -> movie_id -> aggregated metrics
  const weekendPeriodsMap = new Map<
    string,
    Map<
      number,
      {
        movie_id: number;
        revenue: number;
        admissions: number;
        cinemaIds: Set<number>;
        sessions_count: number;
        days_count: number;
      }
    >
  >();

  for (const entry of dailyMap.values()) {
    if (isTheatricalWeekend(entry.op_date)) {
      const thu = getTheatricalWeekStart(entry.op_date);
      if (!weekendPeriodsMap.has(thu)) {
        weekendPeriodsMap.set(thu, new Map());
      }
      const periodMovies = weekendPeriodsMap.get(thu)!;
      if (!periodMovies.has(entry.movie_id)) {
        periodMovies.set(entry.movie_id, {
          movie_id: entry.movie_id,
          revenue: 0,
          admissions: 0,
          cinemaIds: new Set(),
          sessions_count: 0,
          days_count: 0,
        });
      }
      const mEntry = periodMovies.get(entry.movie_id)!;
      mEntry.revenue += entry.revenue;
      mEntry.admissions += entry.admissions;
      entry.cinemaIds.forEach((cid) => mEntry.cinemaIds.add(cid));
      mEntry.sessions_count += entry.sessionIds.size;
      if (entry.revenue > 0 || entry.admissions > 0 || entry.sessionIds.size > 0) {
        mEntry.days_count += 1;
      }
    }
  }

  // Sort weekend starts descending (most recent first)
  const sortedThuStarts = Array.from(weekendPeriodsMap.keys()).sort((a, b) => b.localeCompare(a));

  const weekends = sortedThuStarts.map((thu) => {
    const sun = addDays(thu, 3);
    const prevThu = addDays(thu, -7);
    const prevWeekendMovies = weekendPeriodsMap.get(prevThu);

    const isLive = todayStr >= thu && todayStr <= sun;
    const periodMovies = weekendPeriodsMap.get(thu)!;

    let totalRevenue = 0;
    let totalAdmissions = 0;
    let totalSessions = 0;

    const moviesList = Array.from(periodMovies.entries())
      .map(([movieId, mData]) => {
        const movie = moviesMap.get(movieId);
        const prevMData = prevWeekendMovies?.get(movieId);
        const cinemasCount = mData.cinemaIds.size;
        const prevCinemasCount = prevMData ? prevMData.cinemaIds.size : null;

        totalRevenue += mData.revenue;
        totalAdmissions += mData.admissions;
        totalSessions += mData.sessions_count;

        // Calculate movie-specific Weekend # strictly based on the movie's official release_date
        const { weekend_number, weekend_number_label } = getMovieWeekendNumber(
          movie?.release_date,
          thu,
          movieFirstOpDateMap.get(movieId)
        );

        return {
          movie_id: movieId,
          title: movie?.title || "Unknown Movie",
          poster_url: movie?.poster_url || "",
          release_date: movie?.release_date || "",
          tracking_enabled: movie?.tracking_enabled ?? true,
          weekend_number,
          weekend_number_label,
          revenue: Math.round(mData.revenue * 100) / 100,
          admissions: mData.admissions,
          cinemas_count: cinemasCount,
          sessions_count: mData.sessions_count,
          days_with_data_count: mData.days_count,

          // Comparison vs previous weekend (immediately preceding Thursday–Sunday)
          prev_weekend_revenue_change_pct: calculatePercentChange(mData.revenue, prevMData?.revenue),
          prev_weekend_admissions_change_pct: calculatePercentChange(mData.admissions, prevMData?.admissions),
          prev_weekend_cinemas_change_pct: calculatePercentChange(cinemasCount, prevCinemasCount),
          prev_weekend_sessions_change_pct: calculatePercentChange(mData.sessions_count, prevMData?.sessions_count),
        };
      })
      .filter((m) => m.revenue > 0 || m.admissions > 0 || m.sessions_count > 0)
      .sort((a, b) => b.revenue - a.revenue);

    return {
      weekend_id: thu,
      start_date: thu,
      end_date: sun,
      label: formatPeriodLabel(thu, sun),
      is_live: isLive,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      total_admissions: totalAdmissions,
      total_sessions: totalSessions,
      movies: moviesList,
    };
  }).filter((w) => w.movies.length > 0);

  return { weekends };
}

/**
 * 3. GET /api/boxoffice/weeks
 */
export async function getWeeklyBoxOffice() {
  const { moviesMap, dailyMap, todayStr } = await getUnifiedDailyBoxOfficeData();

  // Build map of earliest recorded operational date per movie
  const movieFirstOpDateMap = new Map<number, string>();
  for (const entry of dailyMap.values()) {
    if (entry.revenue > 0 || entry.admissions > 0 || entry.cinemaIds.size > 0 || entry.sessionIds.size > 0) {
      const existing = movieFirstOpDateMap.get(entry.movie_id);
      if (!existing || entry.op_date < existing) {
        movieFirstOpDateMap.set(entry.movie_id, entry.op_date);
      }
    }
  }

  // Find all distinct Thursdays anchoring theatrical weeks (Thu..Wed)
  const weekPeriodsMap = new Map<
    string,
    Map<
      number,
      {
        movie_id: number;
        revenue: number;
        admissions: number;
        cinemaIds: Set<number>;
        sessions_count: number;
        days_count: number;
      }
    >
  >();

  for (const entry of dailyMap.values()) {
    const thu = getTheatricalWeekStart(entry.op_date);
    if (!weekPeriodsMap.has(thu)) {
      weekPeriodsMap.set(thu, new Map());
    }
    const periodMovies = weekPeriodsMap.get(thu)!;
    if (!periodMovies.has(entry.movie_id)) {
      periodMovies.set(entry.movie_id, {
        movie_id: entry.movie_id,
        revenue: 0,
        admissions: 0,
        cinemaIds: new Set(),
        sessions_count: 0,
        days_count: 0,
      });
    }
    const mEntry = periodMovies.get(entry.movie_id)!;
    mEntry.revenue += entry.revenue;
    mEntry.admissions += entry.admissions;
    entry.cinemaIds.forEach((cid) => mEntry.cinemaIds.add(cid));
    mEntry.sessions_count += entry.sessionIds.size;
    if (entry.revenue > 0 || entry.admissions > 0 || entry.sessionIds.size > 0) {
      mEntry.days_count += 1;
    }
  }

  // Sort week starts descending (most recent first)
  const sortedThuStarts = Array.from(weekPeriodsMap.keys()).sort((a, b) => b.localeCompare(a));

  const weeks = sortedThuStarts.map((thu) => {
    const wed = addDays(thu, 6);
    const prevThu = addDays(thu, -7);
    const prevWeekMovies = weekPeriodsMap.get(prevThu);

    const isLive = todayStr >= thu && todayStr <= wed;
    const periodMovies = weekPeriodsMap.get(thu)!;

    let totalRevenue = 0;
    let totalAdmissions = 0;
    let totalSessions = 0;

    const moviesList = Array.from(periodMovies.entries())
      .map(([movieId, mData]) => {
        const movie = moviesMap.get(movieId);
        const prevMData = prevWeekMovies?.get(movieId);
        const cinemasCount = mData.cinemaIds.size;
        const prevCinemasCount = prevMData ? prevMData.cinemaIds.size : null;

        totalRevenue += mData.revenue;
        totalAdmissions += mData.admissions;
        totalSessions += mData.sessions_count;

        // Calculate movie-specific Week # strictly based on the movie's official release_date
        const { week_number, week_number_label } = getMovieWeekNumber(
          movie?.release_date,
          thu,
          movieFirstOpDateMap.get(movieId)
        );

        return {
          movie_id: movieId,
          title: movie?.title || "Unknown Movie",
          poster_url: movie?.poster_url || "",
          release_date: movie?.release_date || "",
          tracking_enabled: movie?.tracking_enabled ?? true,
          week_number,
          week_number_label,
          revenue: Math.round(mData.revenue * 100) / 100,
          admissions: mData.admissions,
          cinemas_count: cinemasCount,
          sessions_count: mData.sessions_count,
          days_with_data_count: mData.days_count,

          // Comparison vs previous theatrical week (immediately preceding Thursday–Wednesday)
          prev_week_revenue_change_pct: calculatePercentChange(mData.revenue, prevMData?.revenue),
          prev_week_admissions_change_pct: calculatePercentChange(mData.admissions, prevMData?.admissions),
          prev_week_cinemas_change_pct: calculatePercentChange(cinemasCount, prevCinemasCount),
          prev_week_sessions_change_pct: calculatePercentChange(mData.sessions_count, prevMData?.sessions_count),
        };
      })
      .filter((m) => m.revenue > 0 || m.admissions > 0 || m.sessions_count > 0)
      .sort((a, b) => b.revenue - a.revenue);

    return {
      week_id: thu,
      start_date: thu,
      end_date: wed,
      label: formatPeriodLabel(thu, wed),
      is_live: isLive,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      total_admissions: totalAdmissions,
      total_sessions: totalSessions,
      movies: moviesList,
    };
  }).filter((w) => w.movies.length > 0);

  return { weeks };
}
