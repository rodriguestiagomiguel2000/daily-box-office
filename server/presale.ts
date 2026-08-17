import { query } from "./db";
import { normalizeDateStr, addDays, getDayDifference } from "./boxoffice";

export interface PresaleBucket {
  days_before_release: number; // e.g. 7 for T-7, 0 for T-0
  t_label: string; // "T-7", "T-6", ... "T-0"
  calendar_date: string; // "YYYY-MM-DD"
  cumulative_tickets: number;
  cumulative_revenue: number;
  sessions_count: number;
  cinemas_count: number;
  total_capacity: number;
  occupancy_rate: number;
  dod_tickets_growth: number;
  dod_tickets_growth_pct: number | null;
  dod_revenue_growth: number;
  dod_revenue_growth_pct: number | null;
}

export interface PresaleCinemaSummary {
  cinema_id: number;
  cinema_name: string;
  cinema_city: string;
  sessions_count: number;
  sellable_capacity: number;
  unavailable_seats: number;
  occupancy_proxy: number;
  estimated_revenue: number;
}

export interface MoviePresaleCurveResponse {
  movie: {
    id: number;
    title: string;
    poster_url: string;
    release_date: string;
    opening_operational_date: string;
    tracking_enabled: boolean;
  };
  opening_day: {
    operational_date: string;
    is_release_date_match: boolean;
    total_opening_sessions: number;
    total_opening_cinemas: number;
    total_opening_capacity: number;
  } | null;
  has_presale_data: boolean;
  min_t_days: number;
  max_t_days: number;
  tracking_start_bucket?: string;
  buckets: PresaleBucket[];
  cinemas_breakdown: PresaleCinemaSummary[];
}

/**
 * Calculates days before operational/release date for any observation.
 * Positive = presale observation before operational date (e.g. 7 = T-7)
 * Zero = on the operational date itself (T-0)
 * Negative = after operational date
 */
export function calculateDaysBeforeRelease(operationalDate: string, collectedAt: Date | string): number {
  const opDate = normalizeDateStr(operationalDate);
  if (!opDate) return 0;

  const dt = new Date(collectedAt);
  const collDateStr = dt.toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });
  return getDayDifference(collDateStr, opDate);
}

/**
 * Computes the day-bucketed cumulative presale curve for a movie's opening day sessions.
 */
export async function getMoviePresaleCurve(movieId: number): Promise<MoviePresaleCurveResponse | null> {
  // 1. Fetch movie metadata
  const movieRes = await query<{
    id: number;
    external_id: string;
    title: string;
    poster_url: string;
    release_date: string;
    tracking_enabled: boolean;
  }>(
    `SELECT id, external_id, title, poster_url, release_date, tracking_enabled 
     FROM movies 
     WHERE id = $1;`,
    [movieId]
  );

  if (movieRes.rows.length === 0) {
    return null;
  }

  const movie = movieRes.rows[0];
  let openingDateStr = normalizeDateStr(movie.release_date);
  let isReleaseDateMatch = Boolean(openingDateStr);

  // If movie has no explicit release_date, determine opening date as the earliest recorded session operational_date
  if (!openingDateStr) {
    const minOpRes = await query<{ min_op_date: string }>(
      `SELECT MIN(COALESCE(NULLIF(operational_date, ''), TO_CHAR((starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD'))) as min_op_date
       FROM sessions 
       WHERE movie_id = $1;`,
      [movieId]
    );
    openingDateStr = normalizeDateStr(minOpRes.rows[0]?.min_op_date);
  }

  // If no sessions or opening date exist at all
  if (!openingDateStr) {
    return {
      movie: {
        id: movie.id,
        title: movie.title,
        poster_url: movie.poster_url || "",
        release_date: movie.release_date || "",
        opening_operational_date: "",
        tracking_enabled: movie.tracking_enabled ?? true,
      },
      opening_day: null,
      has_presale_data: false,
      min_t_days: 0,
      max_t_days: 0,
      buckets: [],
      cinemas_breakdown: [],
    };
  }

  // 2. Fetch total opening day sessions info
  const openingSessionsRes = await query<{
    session_id: number;
    cinema_id: number;
    cinema_name: string;
    cinema_city: string;
    format: string;
    room_capacity: number;
  }>(
    `SELECT 
      s.id as session_id,
      s.cinema_id,
      c.name as cinema_name,
      c.city as cinema_city,
      s.format,
      COALESCE(r.capacity, 0) as room_capacity
     FROM sessions s
     JOIN cinemas c ON s.cinema_id = c.id
     LEFT JOIN rooms r ON s.room_id = r.id
     WHERE s.movie_id = $1 
       AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2);`,
    [movieId, openingDateStr]
  );

  const openingSessions = openingSessionsRes.rows;
  const totalOpeningSessions = openingSessions.length;
  const totalOpeningCinemas = new Set(openingSessions.map((s) => s.cinema_id)).size;
  const totalOpeningCapacity = openingSessions.reduce((acc, s) => acc + (s.room_capacity || 0), 0);

  if (totalOpeningSessions === 0) {
    return {
      movie: {
        id: movie.id,
        title: movie.title,
        poster_url: movie.poster_url || "",
        release_date: movie.release_date || "",
        opening_operational_date: openingDateStr,
        tracking_enabled: movie.tracking_enabled ?? true,
      },
      opening_day: {
        operational_date: openingDateStr,
        is_release_date_match: isReleaseDateMatch,
        total_opening_sessions: 0,
        total_opening_cinemas: 0,
        total_opening_capacity: 0,
      },
      has_presale_data: false,
      min_t_days: 0,
      max_t_days: 0,
      buckets: [],
      cinemas_breakdown: [],
    };
  }

  // 3. Query day-bucketed cumulative presale curve across all opening day sessions
  // For each distinct days_before_release (T-14, ... T-0), we take the LATEST snapshot of each session on or before that bucket's date
  const bucketsRes = await query<{
    days_before_release: number;
    calendar_date: string;
    cumulative_tickets: number;
    cumulative_revenue: number;
    sessions_count: number;
    cinemas_count: number;
    total_capacity: number;
  }>(
    `WITH session_prices AS (
      SELECT 
        s.id as session_id,
        s.movie_id,
        s.operational_date,
        s.format,
        COALESCE(
          AVG(stp.price) FILTER (WHERE stp.is_default = true AND stp.price > 0),
          AVG(stp.price) FILTER (WHERE stp.price > 0 AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
          AVG(stp.price) FILTER (WHERE stp.price > 0),
          CASE 
            WHEN s.format ILIKE '%IMAX%' THEN 13.50 
            WHEN s.format ILIKE '%3D%' THEN 9.50 
            ELSE 8.75 
          END
        ) as resolved_unit_price
      FROM sessions s
      LEFT JOIN session_ticket_prices stp ON stp.session_id = s.id
      WHERE s.movie_id = $1 
        AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2)
      GROUP BY s.id, s.movie_id, s.operational_date, s.format
    ),
    opening_sessions AS (
      SELECT 
        s.id as session_id,
        s.cinema_id,
        s.format,
        COALESCE(r.capacity, 0) as room_capacity
      FROM sessions s
      LEFT JOIN rooms r ON s.room_id = r.id
      WHERE s.movie_id = $1 
        AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2)
    ),
    distinct_t_buckets AS (
      SELECT DISTINCT 
        ($2::date - DATE(ss.collected_at AT TIME ZONE 'Europe/Lisbon')) as days_before_release,
        DATE(ss.collected_at AT TIME ZONE 'Europe/Lisbon') as bucket_date
      FROM seat_snapshots ss
      JOIN opening_sessions os ON ss.session_id = os.session_id
      WHERE ($2::date - DATE(ss.collected_at AT TIME ZONE 'Europe/Lisbon')) >= 0
    ),
    latest_session_per_bucket AS (
      SELECT DISTINCT ON (dtb.days_before_release, os.session_id)
        dtb.days_before_release,
        dtb.bucket_date,
        os.session_id,
        os.cinema_id,
        ss.unavailable_seats,
        COALESCE(NULLIF(ss.sellable_seats, 0), os.room_capacity, 0) as sellable_seats,
        sp.resolved_unit_price,
        (ss.unavailable_seats * sp.resolved_unit_price) as estimated_revenue
      FROM distinct_t_buckets dtb
      CROSS JOIN opening_sessions os
      JOIN seat_snapshots ss ON ss.session_id = os.session_id 
        AND ss.collected_at <= (dtb.bucket_date || ' 23:59:59.999 Europe/Lisbon')::timestamptz
      JOIN session_prices sp ON sp.session_id = os.session_id
      ORDER BY dtb.days_before_release, os.session_id, ss.collected_at DESC
    )
    SELECT 
      days_before_release,
      TO_CHAR(bucket_date, 'YYYY-MM-DD') as calendar_date,
      COALESCE(SUM(unavailable_seats), 0)::int as cumulative_tickets,
      ROUND(COALESCE(SUM(estimated_revenue), 0)::numeric, 2)::float as cumulative_revenue,
      COUNT(session_id)::int as sessions_count,
      COUNT(DISTINCT cinema_id)::int as cinemas_count,
      COALESCE(SUM(sellable_seats), 0)::int as total_capacity
    FROM latest_session_per_bucket
    GROUP BY days_before_release, bucket_date
    ORDER BY days_before_release DESC;`,
    [movieId, openingDateStr]
  );

  const rawBuckets = bucketsRes.rows;
  const hasPresaleData = rawBuckets.length > 0;

  // Process buckets chronologically from oldest observation (e.g. T-7) to newest (T-0)
  // rawBuckets is ordered by days_before_release DESC, so index 0 is T-max (e.g. T-7) and the last is T-0
  const processedBuckets: PresaleBucket[] = [];

  for (let i = 0; i < rawBuckets.length; i++) {
    const b = rawBuckets[i];
    const daysBefore = Number(b.days_before_release);
    const tLabel = daysBefore === 0 ? "T-0" : `T-${daysBefore}`;
    const tickets = Number(b.cumulative_tickets) || 0;
    const revenue = Math.round((Number(b.cumulative_revenue) || 0) * 100) / 100;
    const capacity = Number(b.total_capacity) || 0;
    const occupancy = capacity > 0 ? Math.round((tickets / capacity) * 10000) / 10000 : 0;

    let dodTicketsGrowth = 0;
    let dodTicketsGrowthPct: number | null = null;
    let dodRevenueGrowth = 0;
    let dodRevenueGrowthPct: number | null = null;

    if (i > 0) {
      const prev = processedBuckets[i - 1];
      dodTicketsGrowth = tickets - prev.cumulative_tickets;
      if (prev.cumulative_tickets > 0) {
        dodTicketsGrowthPct = Math.round(((tickets - prev.cumulative_tickets) / prev.cumulative_tickets) * 1000) / 10;
      }
      dodRevenueGrowth = Math.round((revenue - prev.cumulative_revenue) * 100) / 100;
      if (prev.cumulative_revenue > 0) {
        dodRevenueGrowthPct = Math.round(((revenue - prev.cumulative_revenue) / prev.cumulative_revenue) * 1000) / 10;
      }
    }

    processedBuckets.push({
      days_before_release: daysBefore,
      t_label: tLabel,
      calendar_date: b.calendar_date,
      cumulative_tickets: tickets,
      cumulative_revenue: revenue,
      sessions_count: Number(b.sessions_count) || 0,
      cinemas_count: Number(b.cinemas_count) || 0,
      total_capacity: capacity,
      occupancy_rate: occupancy,
      dod_tickets_growth: dodTicketsGrowth,
      dod_tickets_growth_pct: dodTicketsGrowthPct,
      dod_revenue_growth: dodRevenueGrowth,
      dod_revenue_growth_pct: dodRevenueGrowthPct,
    });
  }

  // 4. Query cinema-level opening day breakdown
  const cinemasRes = await query<{
    cinema_id: number;
    cinema_name: string;
    cinema_city: string;
    sessions_count: number;
    sellable_capacity: number;
    unavailable_seats: number;
    estimated_revenue: number;
    occupancy_proxy: number;
  }>(
    `WITH session_prices AS (
      SELECT 
        s.id as session_id,
        s.movie_id,
        s.operational_date,
        s.format,
        COALESCE(
          AVG(stp.price) FILTER (WHERE stp.is_default = true AND stp.price > 0),
          AVG(stp.price) FILTER (WHERE stp.price > 0 AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
          AVG(stp.price) FILTER (WHERE stp.price > 0),
          CASE 
            WHEN s.format ILIKE '%IMAX%' THEN 13.50 
            WHEN s.format ILIKE '%3D%' THEN 9.50 
            ELSE 8.75 
          END
        ) as resolved_unit_price
      FROM sessions s
      LEFT JOIN session_ticket_prices stp ON stp.session_id = s.id
      WHERE s.movie_id = $1 
        AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2)
      GROUP BY s.id, s.movie_id, s.operational_date, s.format
    ),
    opening_sessions AS (
      SELECT 
        s.id as session_id,
        s.cinema_id,
        c.name as cinema_name,
        c.city as cinema_city,
        s.format,
        COALESCE(r.capacity, 0) as room_capacity
      FROM sessions s
      JOIN cinemas c ON s.cinema_id = c.id
      LEFT JOIN rooms r ON s.room_id = r.id
      WHERE s.movie_id = $1 
        AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2)
    ),
    latest_session_snaps AS (
      SELECT DISTINCT ON (os.session_id)
        os.session_id,
        os.cinema_id,
        os.cinema_name,
        os.cinema_city,
        ss.unavailable_seats,
        COALESCE(NULLIF(ss.sellable_seats, 0), os.room_capacity, 0) as sellable_seats,
        sp.resolved_unit_price,
        (ss.unavailable_seats * sp.resolved_unit_price) as estimated_revenue
      FROM opening_sessions os
      JOIN seat_snapshots ss ON ss.session_id = os.session_id
      JOIN session_prices sp ON sp.session_id = os.session_id
      ORDER BY os.session_id, ss.collected_at DESC
    )
    SELECT 
      cinema_id,
      cinema_name,
      COALESCE(cinema_city, '') as cinema_city,
      COUNT(session_id)::int as sessions_count,
      COALESCE(SUM(sellable_seats), 0)::int as sellable_capacity,
      COALESCE(SUM(unavailable_seats), 0)::int as unavailable_seats,
      ROUND(COALESCE(SUM(estimated_revenue), 0)::numeric, 2)::float as estimated_revenue,
      CASE 
        WHEN SUM(sellable_seats) > 0 THEN ROUND((SUM(unavailable_seats)::numeric / SUM(sellable_seats)::numeric), 4)::float 
        ELSE 0.0 
      END as occupancy_proxy
    FROM latest_session_snaps
    GROUP BY cinema_id, cinema_name, cinema_city
    ORDER BY unavailable_seats DESC, estimated_revenue DESC;`,
    [movieId, openingDateStr]
  );

  const minTDays = processedBuckets.length > 0 ? processedBuckets[processedBuckets.length - 1].days_before_release : 0;
  const maxTDays = processedBuckets.length > 0 ? processedBuckets[0].days_before_release : 0;
  const startBucket = processedBuckets.length > 0 ? processedBuckets[0].t_label : undefined;

  return {
    movie: {
      id: movie.id,
      title: movie.title,
      poster_url: movie.poster_url || "",
      release_date: movie.release_date || "",
      opening_operational_date: openingDateStr,
      tracking_enabled: movie.tracking_enabled ?? true,
    },
    opening_day: {
      operational_date: openingDateStr,
      is_release_date_match: isReleaseDateMatch,
      total_opening_sessions: totalOpeningSessions,
      total_opening_cinemas: totalOpeningCinemas,
      total_opening_capacity: totalOpeningCapacity,
    },
    has_presale_data: hasPresaleData,
    min_t_days: minTDays,
    max_t_days: maxTDays,
    tracking_start_bucket: startBucket,
    buckets: processedBuckets,
    cinemas_breakdown: cinemasRes.rows.map((c) => ({
      cinema_id: Number(c.cinema_id),
      cinema_name: c.cinema_name,
      cinema_city: c.cinema_city,
      sessions_count: Number(c.sessions_count),
      sellable_capacity: Number(c.sellable_capacity),
      unavailable_seats: Number(c.unavailable_seats),
      occupancy_proxy: Number(c.occupancy_proxy),
      estimated_revenue: Number(c.estimated_revenue),
    })),
  };
}
