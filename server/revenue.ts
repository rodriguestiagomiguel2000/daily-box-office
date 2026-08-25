import { query } from "./db";

/**
 * Canonical Session Pricing Resolver in TypeScript/JavaScript.
 * Matches the exact SQL logic used across all database queries.
 * 
 * Note on why unweighted averaging was wrong:
 * Taking all distinct non-zero ticket prices offered for a session (e.g. Normal, Estudante,
 * Sénior, Criança, 3D) and computing an unweighted arithmetic mean systematically overestimates
 * revenue and average ticket price. Discounted ticket types (child/student/senior/promo) typically
 * represent a large share of real admissions but got equal weight to the standard adult price
 * in an unweighted average — especially visible on family/animated titles.
 * 
 * Correct approach:
 * Prefer the single ticket type explicitly marked as the standard/default adult price
 * ("Normal" / is_default = true, picking the FIRST or lowest such match rather than averaging).
 * Only fall back to an average across all non-zero prices as a last resort when no default/standard
 * type is present, and log a warning for auditing.
 */
export function resolveSessionUnitPriceJs(
  format: string | null | undefined,
  prices: { ticket_type?: string; price: number | string; is_default?: boolean; seats_count?: number }[]
): number {
  if (!prices || prices.length === 0) {
    const fmt = (format || "").toUpperCase();
    if (fmt.includes("IMAX")) return 13.50;
    if (fmt.includes("3D")) return 9.50;
    return 8.75;
  }

  // 1. Prefer single ticket type explicitly marked as default (is_default = true and price > 0).
  // Pick the lowest/first match rather than averaging multiple default entries.
  const defaultPrices = prices
    .filter((p) => p.is_default && Number(p.price) > 0)
    .map((p) => Number(p.price));

  if (defaultPrices.length > 0) {
    return Math.min(...defaultPrices);
  }

  // 2. Prefer standard adult ticket types ("Normal", "Adulto", "Inteiro", "Standard")
  const standardPrices = prices
    .filter((p) => {
      const pr = Number(p.price);
      if (pr <= 0) return false;
      const type = (p.ticket_type || "").toLowerCase();
      if (type.includes("fam") || type.includes("pax")) return false;
      if (p.seats_count && p.seats_count > 1) return false;
      return type.includes("normal") || type.includes("adulto") || type.includes("inteiro") || type.includes("standard");
    })
    .map((p) => Number(p.price));

  if (standardPrices.length > 0) {
    return Math.min(...standardPrices);
  }

  // 3. Prefer single-seat non-family/pax tickets (excluding known concession/discount tiers)
  const singlePrices = prices
    .filter((p) => {
      const pr = Number(p.price);
      if (pr <= 0) return false;
      const type = (p.ticket_type || "").toLowerCase();
      if (
        type.includes("fam") ||
        type.includes("pax") ||
        type.includes("criança") ||
        type.includes("crianca") ||
        type.includes("estudante") ||
        type.includes("sénior") ||
        type.includes("senior") ||
        type.includes("jovem")
      ) {
        return false;
      }
      if (p.seats_count && p.seats_count > 1) return false;
      return true;
    })
    .map((p) => Number(p.price));

  if (singlePrices.length > 0) {
    return Math.min(...singlePrices);
  }

  // 4. Fallback: average across all non-zero prices as a last resort (with audit warning)
  const nonZeroPrices = prices
    .filter((p) => Number(p.price) > 0)
    .map((p) => Number(p.price));

  if (nonZeroPrices.length > 0) {
    console.warn(
      `[revenue] No default/standard ticket price found for session (format='${format || ""}'). ` +
      `Falling back to unweighted average across non-zero ticket types: [${nonZeroPrices.join(", ")}]`
    );
    return nonZeroPrices.reduce((a, b) => a + b, 0) / nonZeroPrices.length;
  }

  // 5. Default format fallback
  const fmt = (format || "").toUpperCase();
  if (fmt.includes("IMAX")) return 13.50;
  if (fmt.includes("3D")) return 9.50;
  return 8.75;
}

/**
 * Returns the canonical SQL subquery for session pricing resolution.
 * 
 * Applies empirical calibration factors (gamma) from official ICA reports:
 * 1. Base unit price is resolved via standard priority (DEFAULT_FLAG -> STANDARD_NAME -> SINGLE_NON_CONCESSION -> AVG -> FORMAT_FALLBACK).
 * 2. Multiplies by the movie-specific calibration factor (gamma) from calibration_factors table if matched.
 * 3. Otherwise falls back to the movie's category factor ('Family / Animation', 'Action / General', 'Drama / Adult').
 * 4. Otherwise falls back to gamma = 1.0.
 * 
 * Outputs:
 * - session_id
 * - movie_id
 * - operational_date
 * - format
 * - resolved_unit_price_raw (uncalibrated standard adult ticket price)
 * - gamma (the calibration discount/premium factor)
 * - resolved_unit_price (calibrated price = ROUND(raw * gamma, 2))
 */
export function getSessionPricesSqlCte(): string {
  return `
    session_prices AS (
      SELECT 
        s.id as session_id,
        s.movie_id,
        s.operational_date,
        s.format,
        base_price.raw_unit_price as resolved_unit_price_raw,
        COALESCE(cf_movie.gamma, cf_cat.gamma, 1.0) as gamma,
        ROUND((base_price.raw_unit_price * COALESCE(cf_movie.gamma, cf_cat.gamma, 1.0))::numeric, 2) as resolved_unit_price,
        /*
         * Structural block subtraction re-enabled on 2026-08-25 after threshold validation:
         * Confirmed realistic percentages (Braga Parque Sala 6 @ 4%, Mar Algarve Sala 4 @ 11.6%).
         * Colombo & Matosinhos IMAX correctly return 0 via the insufficient low-demand data skip.
         */
        COALESCE(sb.blocked_count, 0)::int as structural_blocked_seats
      FROM sessions s
      LEFT JOIN rooms r ON s.room_id = r.id
      LEFT JOIN movies m ON s.movie_id = m.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as blocked_count
        FROM room_structural_blocks rsb
        WHERE rsb.theater_room_uuid = r.external_id
          AND rsb.first_observed_at::date <= NULLIF(s.operational_date, '')::date
          AND (rsb.removed_at IS NULL OR rsb.removed_at::date > NULLIF(s.operational_date, '')::date)
      ) sb ON true
      LEFT JOIN LATERAL (
        SELECT 
          COALESCE(
            MIN(stp.price) FILTER (WHERE stp.is_default = true AND stp.price > 0),
            MIN(stp.price) FILTER (WHERE stp.price > 0 AND (stp.ticket_type ILIKE '%normal%' OR stp.ticket_type ILIKE '%adulto%' OR stp.ticket_type ILIKE '%inteiro%' OR stp.ticket_type ILIKE '%standard%') AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
            MIN(stp.price) FILTER (WHERE stp.price > 0 AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND stp.ticket_type NOT ILIKE '%crian%' AND stp.ticket_type NOT ILIKE '%estud%' AND stp.ticket_type NOT ILIKE '%sénior%' AND stp.ticket_type NOT ILIKE '%senior%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
            AVG(stp.price) FILTER (WHERE stp.price > 0),
            CASE 
              WHEN s.format ILIKE '%IMAX%' THEN 13.50 
              WHEN s.format ILIKE '%3D%' THEN 9.50 
              ELSE 8.75 
            END
          ) as raw_unit_price
        FROM session_ticket_prices stp
        WHERE stp.session_id = s.id
      ) base_price ON true
      LEFT JOIN calibration_factors cf_movie ON cf_movie.movie_id = s.movie_id
      LEFT JOIN calibration_factors cf_cat ON cf_cat.movie_id IS NULL AND cf_cat.category = COALESCE(
        m.category,
        CASE 
          WHEN m.title ILIKE '%animac%' OR m.title ILIKE '%patrulha pata%' OR m.title ILIKE '%minion%' OR m.title ILIKE '%minimo%' OR m.title ILIKE '%famil%' OR m.title ILIKE '%disney%' OR m.title ILIKE '%pixar%' OR m.title ILIKE '%divertida%' OR m.title ILIKE '%toy story%' OR m.title ILIKE '%vaiana%' OR m.title ILIKE '%sonic%' OR m.title ILIKE '%mario%' OR m.title ILIKE '%stitch%' OR m.title ILIKE '%paddington%' OR m.title ILIKE '%shrek%' OR m.title ILIKE '%frozen%' OR m.title ILIKE '%wonka%' OR m.title ILIKE '%barbie%' THEN 'Family / Animation'
          WHEN m.title ILIKE '%drama%' OR m.title ILIKE '%terror%' OR m.title ILIKE '%horror%' OR m.title ILIKE '%thriller%' OR m.title ILIKE '%crime%' OR m.title ILIKE '%misterio%' OR m.title ILIKE '%romance%' OR m.title ILIKE '%biograf%' THEN 'Drama / Adult'
          ELSE 'Action / General'
        END
      )
      GROUP BY s.id, s.movie_id, s.operational_date, s.format, base_price.raw_unit_price, cf_movie.gamma, cf_cat.gamma, sb.blocked_count
    )
  `;
}

/**
 * Recalculate stored performance snapshots in movie_performance_snapshots
 * using calibrated canonical unit prices and excluding structural seat blocks.
 */
export async function recalculateAllPerformanceSnapshots(movieId?: number, operationalDate?: string): Promise<number> {
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (movieId) {
    params.push(movieId);
    whereClauses.push(`mps.movie_id = $${params.length}`);
  }
  if (operationalDate) {
    params.push(operationalDate);
    whereClauses.push(`mps.operational_date = $${params.length}`);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const querySql = `
    WITH ${getSessionPricesSqlCte()},
    recalculated_snapshots AS (
      SELECT 
        mps.id as snapshot_id,
        mps.movie_id,
        mps.operational_date,
        mps.snapshot_timestamp,
        mps.showcount_total,
        ROUND(AVG(sp.resolved_unit_price_raw)::numeric, 2) as avg_raw_price,
        ROUND(AVG(sp.gamma)::numeric, 3) as avg_gamma,
        ROUND(AVG(sp.resolved_unit_price)::numeric, 2) as avg_resolved_price,
        COALESCE(SUM(GREATEST(0, ss.unavailable_seats - sp.structural_blocked_seats)), 0)::int as new_estimated_admissions,
        COALESCE(SUM(GREATEST(0, ss.unavailable_seats - sp.structural_blocked_seats) * sp.resolved_unit_price), 0.0) as new_estimated_revenue
      FROM movie_performance_snapshots mps
      JOIN sessions s ON s.movie_id = mps.movie_id 
        AND (s.operational_date = mps.operational_date OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = mps.operational_date)
      JOIN LATERAL (
        SELECT DISTINCT ON (ss.session_id) ss.session_id, ss.unavailable_seats
        FROM seat_snapshots ss
        WHERE ss.session_id = s.id AND ss.collected_at <= mps.snapshot_timestamp
        ORDER BY ss.session_id, ss.collected_at DESC
      ) ss ON true
      JOIN session_prices sp ON sp.session_id = s.id
      ${whereStr}
      GROUP BY mps.id, mps.movie_id, mps.operational_date, mps.snapshot_timestamp, mps.showcount_total
    )
    UPDATE movie_performance_snapshots mps
    SET 
      estimated_admissions = rs.new_estimated_admissions,
      estimated_revenue = ROUND(rs.new_estimated_revenue::numeric, 2),
      unavailable_seats = rs.new_estimated_admissions,
      occupancy_proxy = CASE WHEN mps.sellable_capacity > 0 THEN ROUND((rs.new_estimated_admissions::numeric / mps.sellable_capacity::numeric), 4) ELSE 0.0 END,
      revenue_per_show = CASE WHEN mps.showcount_total > 0 THEN ROUND((rs.new_estimated_revenue / mps.showcount_total)::numeric, 2) ELSE 0.0 END,
      admissions_per_show = CASE WHEN mps.showcount_total > 0 THEN ROUND((rs.new_estimated_admissions::numeric / mps.showcount_total)::numeric, 2) ELSE 0.0 END,
      resolved_unit_price_raw = rs.avg_raw_price,
      resolved_unit_price = rs.avg_resolved_price,
      gamma = rs.avg_gamma
    FROM recalculated_snapshots rs
    WHERE mps.id = rs.snapshot_id;
  `;

  const res = await query(querySql, params);
  return res.rowCount || 0;
}

export interface ComputeRoomStructuralBlocksOptions {
  force?: boolean;
  intervalHours?: number;
  maxOccupancyProxy?: number;
  minQualifyingSessions?: number;
  minObservationRatio?: number;
  windowDays?: number;
}

export interface RoomBlockResult {
  skipped?: boolean;
  reason?: string;
  lastComputedAt?: string | null;
  totalRoomsEvaluated: number;
  qualifyingRoomsCount: number;
  skippedRoomsCount: number;
  totalSeatsBlocked: number;
  newlyAdded: number;
  updatedCount: number;
  removedCount: number;
  auditEntriesLogged?: number;
  details: Array<{
    theater_room_uuid: string;
    blocked_seat_count: number;
    seats: string[];
  }>;
}

/**
 * Computes per-room structural block list over a rolling 60-day window.
 *
 * Rules:
 * 1. Absolute occupancy ceiling only (<= 15% occupancy, no relative percentile fallback).
 * 2. Earliest snapshot gating: only uses a session's earliest snapshot if its occupancy proxy <= 15%.
 *    High-demand sessions (opening with large presales) are completely excluded from the reference set.
 * 3. Requires at least N (default: 8) qualifying low-occupancy sessions in the rolling window for that room.
 * 4. If a room has < 8 qualifying sessions, detection is SKIPPED for that room (structural_blocked_seats = 0)
 *    and logged as "insufficient low-demand data, detection skipped" rather than risking false-positives
 *    from a contaminated reference set.
 * 5. Full per-room replace-on-recompute: every recompute cycle evaluates the full 60-day rolling window.
 *    Any seat previously flagged as structurally blocked that is no longer detected (e.g. physically repaired
 *    and observation ratio dropped below 80%, or aged out) is automatically REMOVED from room_structural_blocks.
 * 6. Lightweight audit log: each addition and removal is recorded in room_structural_blocks_audit_log with
 *    room, seat key, action (ADDED/REMOVED), reason, observed counts, and timestamp.
 *
 * Throttles execution unless force = true or default interval (6 hours) has elapsed.
 */
export async function computeRoomStructuralBlocks(
  optsOrForce: ComputeRoomStructuralBlocksOptions | boolean = {}
): Promise<RoomBlockResult> {
  const opts = typeof optsOrForce === "boolean" ? { force: optsOrForce } : optsOrForce;
  const force = Boolean(opts.force);
  const intervalHours = opts.intervalHours !== undefined ? opts.intervalHours : 6;
  const maxOccupancy = opts.maxOccupancyProxy !== undefined ? opts.maxOccupancyProxy : 0.15;
  const minQualifyingSessions = opts.minQualifyingSessions !== undefined ? opts.minQualifyingSessions : 8;
  const minObservationRatio = opts.minObservationRatio !== undefined ? opts.minObservationRatio : 0.80;
  const windowDays = opts.windowDays !== undefined ? opts.windowDays : 60;

  // Ensure tracking and audit tables exist
  await query(`
    ALTER TABLE room_structural_blocks ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ NULL;

    CREATE TABLE IF NOT EXISTS room_structural_blocks_meta (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      last_computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS room_structural_blocks_audit_log (
      id SERIAL PRIMARY KEY,
      theater_room_uuid VARCHAR(100) NOT NULL,
      stable_seat_key VARCHAR(150) NOT NULL,
      action VARCHAR(20) NOT NULL,
      reason TEXT,
      observed_count INT,
      qualifying_sessions INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rsb_audit_room ON room_structural_blocks_audit_log(theater_room_uuid);
    CREATE INDEX IF NOT EXISTS idx_rsb_audit_created ON room_structural_blocks_audit_log(created_at DESC);
  `);

  if (!force) {
    const metaRes = await query(`SELECT last_computed_at FROM room_structural_blocks_meta WHERE id = 1;`).catch(() => ({ rows: [] }));
    const lastComputed = metaRes.rows[0]?.last_computed_at;
    if (lastComputed) {
      const elapsedMs = Date.now() - new Date(lastComputed).getTime();
      const thresholdMs = intervalHours * 3600 * 1000;
      if (elapsedMs < thresholdMs) {
        console.debug(`[STRUCTURAL_BLOCKS] Skipped computation: last run was ${Math.round(elapsedMs / 60000)}m ago (throttle interval: ${intervalHours}h).`);
        return {
          skipped: true,
          reason: "skipped, too recent",
          lastComputedAt: new Date(lastComputed).toISOString(),
          totalRoomsEvaluated: 0,
          qualifyingRoomsCount: 0,
          skippedRoomsCount: 0,
          totalSeatsBlocked: 0,
          newlyAdded: 0,
          updatedCount: 0,
          removedCount: 0,
          auditEntriesLogged: 0,
          details: [],
        };
      }
    }
  }

  // 1. Fetch all existing active blocks in DB grouped by room
  const prevRes = await query(`
    SELECT theater_room_uuid, stable_seat_key, low_occupancy_observations, first_observed_at, last_observed_at 
    FROM room_structural_blocks
    WHERE removed_at IS NULL;
  `);
  
  const existingByRoom = new Map<string, Map<string, {
    theater_room_uuid: string;
    stable_seat_key: string;
    low_occupancy_observations: number;
    first_observed_at: Date;
    last_observed_at: Date;
  }>>();

  for (const row of prevRes.rows) {
    if (!existingByRoom.has(row.theater_room_uuid)) {
      existingByRoom.set(row.theater_room_uuid, new Map());
    }
    existingByRoom.get(row.theater_room_uuid)!.set(row.stable_seat_key, {
      theater_room_uuid: row.theater_room_uuid,
      stable_seat_key: row.stable_seat_key,
      low_occupancy_observations: Number(row.low_occupancy_observations || 0),
      first_observed_at: new Date(row.first_observed_at),
      last_observed_at: new Date(row.last_observed_at),
    });
  }

  // 2. Detect structural blocks across the rolling 60-day window using earliest snapshots and <= 15% occupancy gating
  const detectSql = `
    WITH earliest_session_snaps AS (
      SELECT DISTINCT ON (ss.session_id)
        ss.session_id,
        s.starts_at,
        r.external_id as theater_room_uuid,
        r.name as room_name,
        c.name as cinema_name,
        ss.id as snapshot_id,
        ss.sellable_seats,
        ss.unavailable_seats,
        ss.occupancy_proxy
      FROM sessions s
      JOIN rooms r ON s.room_id = r.id
      LEFT JOIN cinemas c ON s.cinema_id = c.id
      JOIN seat_snapshots ss ON ss.session_id = s.id
      WHERE s.starts_at IS NOT NULL
        AND s.starts_at >= NOW() - ($1 || ' days')::INTERVAL
      ORDER BY ss.session_id, ss.collected_at ASC
    ),
    low_occ_sessions AS (
      SELECT *
      FROM earliest_session_snaps
      WHERE sellable_seats > 0 
        AND theater_room_uuid IS NOT NULL 
        AND theater_room_uuid != ''
        AND occupancy_proxy <= $2
    ),
    room_qualifying_counts AS (
      SELECT 
        theater_room_uuid,
        cinema_name,
        room_name,
        COUNT(DISTINCT session_id)::int as qualifying_sessions
      FROM low_occ_sessions
      GROUP BY theater_room_uuid, cinema_name, room_name
    ),
    qualified_rooms AS (
      SELECT *
      FROM room_qualifying_counts
      WHERE qualifying_sessions >= $3
    ),
    detected_blocks AS (
      SELECT 
        st.theater_room_uuid,
        qr.cinema_name,
        qr.room_name,
        qr.qualifying_sessions,
        st.stable_seat_key,
        COUNT(DISTINCT f.session_id)::int as obs_count,
        MIN(f.starts_at) as min_ts,
        MAX(f.starts_at) as max_ts
      FROM qualified_rooms qr
      JOIN low_occ_sessions f ON f.theater_room_uuid = qr.theater_room_uuid
      JOIN seat_states st ON st.snapshot_id = f.snapshot_id
      WHERE st.is_seat = true 
        AND (st.is_available = false OR st.state = 'UNAVAILABLE')
        AND (st.is_safety_seat = false OR st.is_safety_seat IS NULL)
      GROUP BY st.theater_room_uuid, qr.cinema_name, qr.room_name, qr.qualifying_sessions, st.stable_seat_key
      HAVING COUNT(DISTINCT f.session_id) >= $3 
         AND COUNT(DISTINCT f.session_id)::float / qr.qualifying_sessions >= $4
    )
    SELECT * FROM detected_blocks;
  `;

  const detectedRes = await query(detectSql, [
    String(windowDays),
    maxOccupancy,
    minQualifyingSessions,
    minObservationRatio,
  ]);
  const detectedRows = detectedRes.rows;

  const detectedByRoom = new Map<string, Map<string, {
    theater_room_uuid: string;
    cinema_name: string;
    room_name: string;
    qualifying_sessions: number;
    stable_seat_key: string;
    obs_count: number;
    min_ts: Date;
    max_ts: Date;
  }>>();

  for (const row of detectedRows) {
    if (!detectedByRoom.has(row.theater_room_uuid)) {
      detectedByRoom.set(row.theater_room_uuid, new Map());
    }
    detectedByRoom.get(row.theater_room_uuid)!.set(row.stable_seat_key, {
      theater_room_uuid: row.theater_room_uuid,
      cinema_name: row.cinema_name,
      room_name: row.room_name,
      qualifying_sessions: Number(row.qualifying_sessions || 0),
      stable_seat_key: row.stable_seat_key,
      obs_count: Number(row.obs_count || 0),
      min_ts: new Date(row.min_ts),
      max_ts: new Date(row.max_ts),
    });
  }

  // 3. Fetch all evaluated rooms in the 60-day window to distinguish qualified vs skipped rooms
  const allEvaluatedRoomsRes = await query(`
    WITH earliest_session_snaps AS (
      SELECT DISTINCT ON (ss.session_id)
        ss.session_id,
        r.external_id as theater_room_uuid,
        r.name as room_name,
        c.name as cinema_name,
        ss.occupancy_proxy,
        ss.sellable_seats
      FROM sessions s
      JOIN rooms r ON s.room_id = r.id
      LEFT JOIN cinemas c ON s.cinema_id = c.id
      JOIN seat_snapshots ss ON ss.session_id = s.id
      WHERE s.starts_at IS NOT NULL
        AND s.starts_at >= NOW() - ($1 || ' days')::INTERVAL
      ORDER BY ss.session_id, ss.collected_at ASC
    ),
    low_occ_sessions AS (
      SELECT *
      FROM earliest_session_snaps
      WHERE sellable_seats > 0 
        AND theater_room_uuid IS NOT NULL 
        AND theater_room_uuid != ''
        AND occupancy_proxy <= $2
    ),
    all_evaluated_rooms AS (
      SELECT DISTINCT 
        r.external_id as theater_room_uuid,
        r.name as room_name,
        c.name as cinema_name
      FROM sessions s
      JOIN rooms r ON s.room_id = r.id
      LEFT JOIN cinemas c ON s.cinema_id = c.id
      WHERE s.starts_at IS NOT NULL
        AND s.starts_at >= NOW() - ($1 || ' days')::INTERVAL
        AND r.external_id IS NOT NULL 
        AND r.external_id != ''
    )
    SELECT 
      ar.theater_room_uuid,
      ar.cinema_name,
      ar.room_name,
      COALESCE(COUNT(DISTINCT l.session_id), 0)::int as qualifying_sessions
    FROM all_evaluated_rooms ar
    LEFT JOIN low_occ_sessions l ON l.theater_room_uuid = ar.theater_room_uuid
    GROUP BY ar.theater_room_uuid, ar.cinema_name, ar.room_name;
  `, [String(windowDays), maxOccupancy]);

  const allRooms = allEvaluatedRoomsRes.rows;
  const roomMetaMap = new Map<string, { cinema_name: string; room_name: string; qualifying_sessions: number }>();
  for (const r of allRooms) {
    roomMetaMap.set(r.theater_room_uuid, {
      cinema_name: r.cinema_name,
      room_name: r.room_name,
      qualifying_sessions: Number(r.qualifying_sessions || 0),
    });
  }

  const qualifiedRooms = allRooms.filter(r => r.qualifying_sessions >= minQualifyingSessions);
  const skippedRooms = allRooms.filter(r => r.qualifying_sessions < minQualifyingSessions);

  // Log skipped rooms due to insufficient low-occupancy sessions
  for (const r of skippedRooms) {
    const roomLabel = `${r.cinema_name ? r.cinema_name + ' - ' : ''}${r.room_name || 'unnamed'}`;
    console.log(
      `[STRUCTURAL_BLOCKS] Room ${r.theater_room_uuid} (${roomLabel}): insufficient low-demand data (${r.qualifying_sessions} < ${minQualifyingSessions} low-occupancy sessions), detection skipped.`
    );
  }

  // 4. Compile union of all rooms to evaluate (rooms active in 60-day window + any rooms with existing blocks in DB)
  const allTargetRoomUuids = new Set<string>([
    ...allRooms.map(r => r.theater_room_uuid),
    ...existingByRoom.keys(),
  ]);

  // 5. Per-Room Replace-on-Recompute:
  // For each room, compare existing DB set vs fresh detected set in current rolling 60-day window.
  const seatsToUpsert: Array<{ roomUuid: string; seatKey: string; obsCount: number; minTs: Date; maxTs: Date }> = [];
  const addedAuditEntries: Array<{ roomUuid: string; seatKey: string; reason: string; obsCount: number; qualifyingSessions: number }> = [];
  const removedSeats: Array<{ roomUuid: string; seatKey: string }> = [];
  const removedAuditEntries: Array<{ roomUuid: string; seatKey: string; reason: string; qualifyingSessions: number }> = [];

  let newlyAdded = 0;
  let updatedCount = 0;
  let removedCount = 0;

  for (const roomUuid of allTargetRoomUuids) {
    const existingSeats = existingByRoom.get(roomUuid) || new Map();
    const detectedSeats = detectedByRoom.get(roomUuid) || new Map();
    const meta = roomMetaMap.get(roomUuid);
    const qualifyingCount = meta?.qualifying_sessions ?? 0;
    const isQualified = qualifyingCount >= minQualifyingSessions;

    // If room is qualified, the target set is detectedSeats. If not qualified / skipped, target set is empty.
    const targetSeats = isQualified ? detectedSeats : new Map();

    // Added and Updated seats
    for (const [seatKey, targetSeat] of targetSeats.entries()) {
      seatsToUpsert.push({
        roomUuid,
        seatKey,
        obsCount: targetSeat.obs_count,
        minTs: targetSeat.min_ts,
        maxTs: targetSeat.max_ts,
      });

      if (!existingSeats.has(seatKey)) {
        newlyAdded++;
        const ratioPercent = qualifyingCount > 0 ? Math.round((targetSeat.obs_count / qualifyingCount) * 100) : 100;
        const reason = `Qualified baseline block: observed unavailable in ${targetSeat.obs_count}/${qualifyingCount} (${ratioPercent}%) low-occupancy sessions (<=15% occ) in 60-day window`;
        addedAuditEntries.push({
          roomUuid,
          seatKey,
          reason,
          obsCount: targetSeat.obs_count,
          qualifyingSessions: qualifyingCount,
        });
      } else {
        updatedCount++;
      }
    }

    // Removed seats
    for (const [seatKey, existingSeat] of existingSeats.entries()) {
      if (!targetSeats.has(seatKey)) {
        removedCount++;
        removedSeats.push({ roomUuid, seatKey });

        let reason: string;
        if (!meta) {
          reason = `Aged out: venue/room has had no showtimes in 60-day window`;
        } else if (!isQualified) {
          reason = `Room skipped: insufficient low-occupancy sessions (${qualifyingCount} < ${minQualifyingSessions}) in 60-day window`;
        } else {
          reason = `Repaired or unblocked: seat dropped below ${Math.round(minObservationRatio * 100)}% unavailable threshold in 60-day window`;
        }

        removedAuditEntries.push({
          roomUuid,
          seatKey,
          reason,
          qualifyingSessions: qualifyingCount,
        });
      }
    }
  }

  // Execute bulk operations
  if (removedSeats.length > 0) {
    // Soft-delete removed seats by setting removed_at = NOW()
    await query(`
      UPDATE room_structural_blocks
      SET removed_at = NOW()
      WHERE (theater_room_uuid, stable_seat_key) IN (
        SELECT r, s FROM jsonb_to_recordset($1::jsonb) AS (r text, s text)
      );
    `, [JSON.stringify(removedSeats.map(item => ({ r: item.roomUuid, s: item.seatKey })))]);

    // Insert removal audit records
    await query(`
      INSERT INTO room_structural_blocks_audit_log (
        theater_room_uuid, stable_seat_key, action, reason, observed_count, qualifying_sessions, created_at
      )
      SELECT r, s, 'REMOVED', reason, NULL, qual_sess, NOW()
      FROM jsonb_to_recordset($1::jsonb) AS (r text, s text, reason text, qual_sess int);
    `, [JSON.stringify(removedAuditEntries.map(item => ({
      r: item.roomUuid,
      s: item.seatKey,
      reason: item.reason,
      qual_sess: item.qualifyingSessions,
    })))]);
  }

  if (seatsToUpsert.length > 0) {
    // Upsert active target seats (clearing removed_at back to NULL if seat was previously removed)
    await query(`
      INSERT INTO room_structural_blocks (
        theater_room_uuid, stable_seat_key, low_occupancy_observations, first_observed_at, last_observed_at, removed_at
      )
      SELECT r, s, obs, min_ts::timestamptz, max_ts::timestamptz, NULL
      FROM jsonb_to_recordset($1::jsonb) AS (r text, s text, obs int, min_ts text, max_ts text)
      ON CONFLICT (theater_room_uuid, stable_seat_key) DO UPDATE SET
        low_occupancy_observations = EXCLUDED.low_occupancy_observations,
        first_observed_at = LEAST(room_structural_blocks.first_observed_at, EXCLUDED.first_observed_at),
        last_observed_at = GREATEST(room_structural_blocks.last_observed_at, EXCLUDED.last_observed_at),
        removed_at = NULL;
    `, [JSON.stringify(seatsToUpsert.map(item => ({
      r: item.roomUuid,
      s: item.seatKey,
      obs: item.obsCount,
      min_ts: item.minTs.toISOString(),
      max_ts: item.maxTs.toISOString(),
    })))]);
  }

  if (addedAuditEntries.length > 0) {
    // Insert added audit records
    await query(`
      INSERT INTO room_structural_blocks_audit_log (
        theater_room_uuid, stable_seat_key, action, reason, observed_count, qualifying_sessions, created_at
      )
      SELECT r, s, 'ADDED', reason, obs, qual_sess, NOW()
      FROM jsonb_to_recordset($1::jsonb) AS (r text, s text, reason text, obs int, qual_sess int);
    `, [JSON.stringify(addedAuditEntries.map(item => ({
      r: item.roomUuid,
      s: item.seatKey,
      reason: item.reason,
      obs: item.obsCount,
      qual_sess: item.qualifyingSessions,
    })))]);
  }

  const auditEntriesLogged = addedAuditEntries.length + removedAuditEntries.length;

  // 6. Fetch final summary of active blocks
  const summaryRes = await query(`
    SELECT theater_room_uuid, COUNT(*)::int as block_count, array_agg(stable_seat_key) as seats
    FROM room_structural_blocks
    WHERE removed_at IS NULL
    GROUP BY theater_room_uuid;
  `);

  // Record successful run timestamp in meta table
  await query(`
    INSERT INTO room_structural_blocks_meta (id, last_computed_at)
    VALUES (1, NOW())
    ON CONFLICT (id) DO UPDATE SET last_computed_at = NOW();
  `);

  console.log(
    `[STRUCTURAL_BLOCKS] Calculation complete. Evaluated ${allRooms.length} rooms (${qualifiedRooms.length} qualified, ${skippedRooms.length} skipped). Total active blocked seats: ${detectedRows.length}. Newly added: ${newlyAdded}, Updated: ${updatedCount}, Removed: ${removedCount}, Audit entries: ${auditEntriesLogged}.`
  );

  return {
    skipped: false,
    lastComputedAt: new Date().toISOString(),
    totalRoomsEvaluated: allRooms.length,
    qualifyingRoomsCount: qualifiedRooms.length,
    skippedRoomsCount: skippedRooms.length,
    totalSeatsBlocked: detectedRows.length,
    newlyAdded,
    updatedCount,
    removedCount,
    auditEntriesLogged,
    details: summaryRes.rows.map(r => ({
      theater_room_uuid: r.theater_room_uuid,
      blocked_seat_count: r.block_count,
      seats: r.seats || [],
    })),
  };
}

const STOPWORDS_SET = new Set([
  "o", "a", "os", "as", "um", "uma", "uns", "umas",
  "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos",
  "e", "ou", "para", "pra", "pro", "pras", "pros", "por", "com", "sem",
  "filme", "filmes", "cinema",
  "the", "a", "an", "and", "or", "of", "in", "to", "for", "with", "without", "on", "at", "by", "from", "movie", "film"
]);

export function cleanMovieTitle(title: string): string {
  if (!title) return "";
  let cleaned = title
    // Remove parenthetical/bracketed version & format tags like (VO), (VP), (V.O.), (VP/3D), (Versão Portuguesa), etc.
    .replace(/\s*[\(\[]\s*(?:VO|VP|V\.O\.|V\.P\.|Dob\.|Sub\.|Dobrado|Legendado|Vers[ãa]o\s+(?:Original|Portuguesa))(?:\s*[\/\\]\s*[\w\d]+)?\s*[\)\]]/gi, "")
    // Remove trailing dash-separated version tags like - VO, - VP, - V.O., - Dobrado, - Versão Portuguesa
    .replace(/\s*[-–—]\s*(?:VO|VP|V\.O\.|V\.P\.|Dob\.|Sub\.|Dobrado|Legendado|Vers[ãa]o\s+(?:Original|Portuguesa))\b/gi, "")
    // Remove standalone trailing version tags like Movie VO, Movie VP, Movie V.O., Movie V.P., Movie Dobrado, Movie Legendado
    .replace(/\s+\b(?:VO|VP|V\.O\.|V\.P\.|Dob\.|Sub\.|Dobrado|Legendado|Vers[ãa]o\s+(?:Original|Portuguesa))\b$/gi, "");

  // Normalize multiple spaces and trim
  return cleaned.replace(/\s+/g, " ").trim();
}

export function normalizeMovieTitle(s: string): string {
  if (!s) return "";
  const cleanedTitle = cleanMovieTitle(s);
  let text = (cleanedTitle || s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Strip format tags in parentheses or brackets
  const formatPattern = /(?:\b(?:2d|3d|imax|vip|atmos|4dx|4d|d-box|screenx|vo|vp|dob|leg|versao\s+portuguesa|versao\s+original)\b|v\.o\.|v\.p\.)/gi;
  text = text.replace(/\s*\([^)]*(?:2d|3d|imax|vip|atmos|4dx|4d|d-box|screenx|vo|vp|dob|leg|versao\s+portuguesa|versao\s+original|v\.o\.|v\.p\.)[^)]*\)/gi, "");
  text = text.replace(/\s*\[[^\]]*(?:2d|3d|imax|vip|atmos|4dx|4d|d-box|screenx|vo|vp|dob|leg|versao\s+portuguesa|versao\s+original|v\.o\.|v\.p\.)[^\]]*\]/gi, "");
  text = text.replace(formatPattern, "");

  // Strip years (19xx, 20xx)
  text = text.replace(/\s*\((?:19|20)\d{2}\)/g, "");
  text = text.replace(/\s*\[(?:19|20)\d{2}\]/g, "");

  // Replace special characters with space
  text = text.replace(/[^a-z0-9 ]/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

export function extractCoreTokens(normTitle: string): string[] {
  const words = normTitle.match(/[a-z0-9]+/g) || [];
  const filtered = words.filter(w => !STOPWORDS_SET.has(w));
  return filtered.length > 0 ? filtered : words;
}

export function calculateTitleSimilarity(t1: string, t2: string): number {
  if (!t1 || !t2) return 0;
  const n1 = normalizeMovieTitle(t1);
  const n2 = normalizeMovieTitle(t2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1.0;

  // Number consistency check: e.g. Toy Story 4 vs Toy Story 5
  const nums1 = n1.match(/\b\d+\b/g) || [];
  const nums2 = n2.match(/\b\d+\b/g) || [];
  if (nums1.length > 0 && nums2.length > 0 && nums1.join(",") !== nums2.join(",")) {
    return 0.0;
  }

  // Core content token comparison FIRST (stripping 'os', 'e', 'de', 'the', etc.)
  const core1 = extractCoreTokens(n1);
  const core2 = extractCoreTokens(n2);

  if (core1.length > 0 && core2.length > 0 && core1.join(" ") === core2.join(" ")) {
    return 0.98;
  }

  // Direct substring / containment
  if (n1.includes(n2) || n2.includes(n1)) {
    const shorter = n1.length <= n2.length ? n1 : n2;
    const longer = n1.length > n2.length ? n1 : n2;
    if (shorter.length >= 5) {
      return Math.max(0.88, shorter.length / longer.length);
    }
  }

  if (core1.length > 0 && core2.length > 0) {
    const set1 = new Set(core1);
    const set2 = new Set(core2);

    let intersectionCount = 0;
    for (const w of set1) {
      if (set2.has(w)) intersectionCount++;
    }

    const unionCount = new Set([...core1, ...core2]).size;
    const jaccard = unionCount > 0 ? intersectionCount / unionCount : 0;

    const isSubset1 = core1.every(w => set2.has(w));
    const isSubset2 = core2.every(w => set1.has(w));

    if (isSubset1 || isSubset2) {
      if (intersectionCount >= 2 || (intersectionCount === 1 && !STOPWORDS_SET.has(core1[0]) && core1[0].length >= 4)) {
        return Math.max(0.85, 0.75 + 0.20 * jaccard);
      }
    }

    if (jaccard >= 0.60) {
      return Math.max(0.80, jaccard);
    }
  }

  // Bigram Dice coefficient for character similarity
  function getBigrams(str: string): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  }

  const b1 = getBigrams(n1);
  const b2 = getBigrams(n2);
  let common = 0;
  for (const b of b1) {
    if (b2.has(b)) common++;
  }
  const dice = (b1.size + b2.size) > 0 ? (2 * common) / (b1.size + b2.size) : 0;

  return Math.round(dice * 1000) / 1000;
}

export function areTitlesLenientMatch(t1: string, t2: string, minSimilarity = 0.70): boolean {
  return calculateTitleSimilarity(t1, t2) >= minSimilarity;
}

/**
 * Computes the admissions-weighted average raw resolved unit price per movie from Postgres.
 * Returns both weekly (all sessions) and weekend (Thu-Sun sessions) resolved price maps
 * to feed period-matched reference prices into the ICA calibration pipeline.
 */
export async function getMovieResolvedPricesForCalibration(): Promise<{
  weekly: Record<string, number>;
  weekend: Record<string, number>;
}> {
  async function computeResolvedPriceMap(filterWeekend: boolean = false): Promise<Record<string, number>> {
    const weekendFilterClause = filterWeekend
      ? `WHERE CASE 
          WHEN s.starts_at IS NOT NULL THEN EXTRACT(DOW FROM (s.starts_at AT TIME ZONE 'Europe/Lisbon' - INTERVAL '6 hours')) IN (0, 4, 5, 6)
          WHEN s.operational_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN EXTRACT(DOW FROM s.operational_date::date) IN (0, 4, 5, 6)
          ELSE false
        END`
      : "";

    const res = await query<{
      movie_id: number;
      title: string;
      resolved_price: string | number;
      total_weighted_revenue?: string | number;
      total_admissions_weight?: string | number;
    }>(`
      WITH session_raw_prices AS (
        SELECT 
          s.id as session_id,
          s.movie_id,
          base_price.raw_unit_price,
          COALESCE(ss.admissions_weight, 1) as admissions_weight
        FROM sessions s
        JOIN movies m ON s.movie_id = m.id
        LEFT JOIN LATERAL (
          SELECT 
            COALESCE(
              MIN(stp.price) FILTER (WHERE stp.is_default = true AND stp.price > 0),
              MIN(stp.price) FILTER (WHERE stp.price > 0 AND (stp.ticket_type ILIKE '%normal%' OR stp.ticket_type ILIKE '%adulto%' OR stp.ticket_type ILIKE '%inteiro%' OR stp.ticket_type ILIKE '%standard%') AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
              MIN(stp.price) FILTER (WHERE stp.price > 0 AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND stp.ticket_type NOT ILIKE '%crian%' AND stp.ticket_type NOT ILIKE '%estud%' AND stp.ticket_type NOT ILIKE '%sénior%' AND stp.ticket_type NOT ILIKE '%senior%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
              AVG(stp.price) FILTER (WHERE stp.price > 0),
              CASE WHEN s.format ILIKE '%IMAX%' THEN 13.50 WHEN s.format ILIKE '%3D%' THEN 9.50 ELSE 8.75 END
            ) as raw_unit_price
          FROM session_ticket_prices stp
          WHERE stp.session_id = s.id
        ) base_price ON true
        LEFT JOIN LATERAL (
          SELECT MAX(unavailable_seats) as admissions_weight
          FROM seat_snapshots
          WHERE session_id = s.id
        ) ss ON true
        ${weekendFilterClause}
      )
      SELECT 
        m.id as movie_id,
        m.title,
        ROUND(
          (SUM(srp.raw_unit_price * srp.admissions_weight) / NULLIF(SUM(srp.admissions_weight), 0))::numeric, 
          2
        ) as resolved_price,
        SUM(srp.raw_unit_price * srp.admissions_weight) as total_weighted_revenue,
        SUM(srp.admissions_weight) as total_admissions_weight
      FROM movies m
      JOIN session_raw_prices srp ON srp.movie_id = m.id
      GROUP BY m.id, m.title;
    `);

    const mapping: Record<string, number> = {};
    const titleGroups: Record<string, { totalRevenue: number; totalAdmissions: number; originalTitles: Set<string> }> = {};

    for (const r of res.rows) {
      const pr = Number(r.resolved_price);
      const rev = Number(r.total_weighted_revenue || 0);
      const adm = Number(r.total_admissions_weight || 0);

      if (pr > 0) {
        // Keep per-movie_id entries unchanged and independent
        mapping[String(r.movie_id)] = pr;

        // Group by normalized title to combine versions sharing the same title
        const normKey = normalizeMovieTitle(r.title);
        if (!titleGroups[normKey]) {
          titleGroups[normKey] = { totalRevenue: 0, totalAdmissions: 0, originalTitles: new Set() };
        }
        titleGroups[normKey].totalRevenue += (adm > 0 ? rev : pr * 1);
        titleGroups[normKey].totalAdmissions += (adm > 0 ? adm : 1);
        titleGroups[normKey].originalTitles.add(r.title);
      }
    }

    // Write admissions-weighted price for title-keyed entries
    for (const group of Object.values(titleGroups)) {
      if (group.totalAdmissions > 0) {
        const blendedPrice = Number((group.totalRevenue / group.totalAdmissions).toFixed(2));
        for (const rawTitle of group.originalTitles) {
          mapping[rawTitle] = blendedPrice;
          mapping[normalizeMovieTitle(rawTitle)] = blendedPrice;
        }
      }
    }

    return mapping;
  }

  try {
    const [weekly, weekend] = await Promise.all([
      computeResolvedPriceMap(false),
      computeResolvedPriceMap(true),
    ]);
    return { weekly, weekend };
  } catch (err) {
    console.error("Failed to compute movie resolved prices for calibration:", err);
    return { weekly: {}, weekend: {} };
  }
}

/**
 * Persists ICA calibration results into the PostgreSQL calibration_factors table
 * and updates movie categories, then runs snapshot recalculation.
 */
export async function syncCalibrationFactorsToDb(calibrationData: {
  category_factors?: Record<string, number>;
  sample_counts?: Record<string, number>;
  movie_factors?: Record<string, number>;
  movies_updated?: Array<{
    title: string;
    normalized_title?: string;
    category?: string;
    gamma_final?: number;
    gamma_observed?: number;
  }>;
}): Promise<{ categoriesUpdated: number; moviesUpdated: number; snapshotsRecalculated: number }> {
  let categoriesUpdated = 0;
  let moviesUpdated = 0;

  // 1. Sync category factors
  if (calibrationData.category_factors) {
    for (const [cat, gamma] of Object.entries(calibrationData.category_factors)) {
      const samples = (calibrationData.sample_counts && calibrationData.sample_counts[cat]) || 0;
      await query(
        `INSERT INTO calibration_factors (category, gamma, sample_count, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (category) WHERE movie_id IS NULL
         DO UPDATE SET gamma = EXCLUDED.gamma, sample_count = EXCLUDED.sample_count, updated_at = NOW();`,
        [cat, Number(gamma), samples]
      );
      categoriesUpdated++;
    }
  }

  // 2. Fetch all movies from DB to match titles
  const allMovies = await query<{ id: number; title: string }>("SELECT id, title FROM movies;");

  const factorMap = calibrationData.movie_factors || {};
  const updatedList = calibrationData.movies_updated || [];

  for (const m of allMovies.rows) {
    const normTitle = normalizeMovieTitle(m.title);

    let matchedGamma: number | null = null;
    let matchedCategory: string | null = null;
    let bestSimilarity = 0;

    // Check in movies_updated array first (exact, substring, or lenient similarity)
    for (const mu of updatedList) {
      const muNorm = mu.normalized_title || normalizeMovieTitle(mu.title);
      const sim = calculateTitleSimilarity(normTitle, muNorm);
      if (sim > bestSimilarity && sim >= 0.70) {
        bestSimilarity = sim;
        matchedGamma = mu.gamma_final || mu.gamma_observed || null;
        matchedCategory = mu.category || null;
      }
    }

    // Check direct factorMap if not already matched with high confidence
    if (matchedGamma === null || bestSimilarity < 0.90) {
      if (factorMap[normTitle] !== undefined) {
        matchedGamma = factorMap[normTitle];
        bestSimilarity = 1.0;
      } else {
        for (const [k, g] of Object.entries(factorMap)) {
          const kNorm = normalizeMovieTitle(k);
          const sim = calculateTitleSimilarity(normTitle, kNorm);
          if (sim > bestSimilarity && sim >= 0.70) {
            bestSimilarity = sim;
            matchedGamma = g;
          }
        }
      }
    }

    if (matchedGamma !== null) {
      const cat = matchedCategory || (
        normTitle.includes("patrulha") || normTitle.includes("minion") || normTitle.includes("minimo") || normTitle.includes("toy story") || normTitle.includes("vaiana") || normTitle.includes("animac")
          ? "Family / Animation"
          : normTitle.includes("drama") || normTitle.includes("terror") || normTitle.includes("oak street")
          ? "Drama / Adult"
          : "Action / General"
      );

      // Update movie category
      await query("UPDATE movies SET category = $1 WHERE id = $2;", [cat, m.id]);

      // Upsert movie-specific calibration factor
      await query(
        `INSERT INTO calibration_factors (movie_id, category, gamma, sample_count, updated_at)
         VALUES ($1, $2, $3, 1, NOW())
         ON CONFLICT (movie_id) WHERE movie_id IS NOT NULL
         DO UPDATE SET gamma = EXCLUDED.gamma, category = EXCLUDED.category, sample_count = calibration_factors.sample_count + 1, updated_at = NOW();`,
        [m.id, cat, Number(matchedGamma)]
      );
      moviesUpdated++;
    }
  }

  // 3. Recalculate all performance snapshots with new calibration factors
  const snapshotsRecalculated = await recalculateAllPerformanceSnapshots();
  console.log(`[calibration] Synced factors to DB (${categoriesUpdated} categories, ${moviesUpdated} movies). Recalculated ${snapshotsRecalculated} snapshots.`);

  return { categoriesUpdated, moviesUpdated, snapshotsRecalculated };
}

export interface PricingResolutionMetadata {
  unitPrice: number;
  method: "DEFAULT_FLAG" | "STANDARD_NAME" | "SINGLE_NON_CONCESSION" | "NON_ZERO_AVERAGE" | "FORMAT_FALLBACK";
}

/**
 * Detailed Pricing Resolver returning both unit price and method used.
 */
export function resolveSessionUnitPriceWithMetadataJs(
  format: string | null | undefined,
  prices: { ticket_type?: string; price: number | string; is_default?: boolean; seats_count?: number }[]
): PricingResolutionMetadata {
  if (!prices || prices.length === 0) {
    const fmt = (format || "").toUpperCase();
    if (fmt.includes("IMAX")) return { unitPrice: 13.50, method: "FORMAT_FALLBACK" };
    if (fmt.includes("3D")) return { unitPrice: 9.50, method: "FORMAT_FALLBACK" };
    return { unitPrice: 8.75, method: "FORMAT_FALLBACK" };
  }

  // 1. Prefer single ticket type explicitly marked as default (is_default = true and price > 0).
  const defaultPrices = prices
    .filter((p) => p.is_default && Number(p.price) > 0)
    .map((p) => Number(p.price));

  if (defaultPrices.length > 0) {
    return { unitPrice: Math.min(...defaultPrices), method: "DEFAULT_FLAG" };
  }

  // 2. Prefer standard adult ticket types ("Normal", "Adulto", "Inteiro", "Standard")
  const standardPrices = prices
    .filter((p) => {
      const pr = Number(p.price);
      if (pr <= 0) return false;
      const type = (p.ticket_type || "").toLowerCase();
      if (type.includes("fam") || type.includes("pax")) return false;
      if (p.seats_count && p.seats_count > 1) return false;
      return type.includes("normal") || type.includes("adulto") || type.includes("inteiro") || type.includes("standard");
    })
    .map((p) => Number(p.price));

  if (standardPrices.length > 0) {
    return { unitPrice: Math.min(...standardPrices), method: "STANDARD_NAME" };
  }

  // 3. Prefer single-seat non-family/pax tickets (excluding known concession/discount tiers)
  const singlePrices = prices
    .filter((p) => {
      const pr = Number(p.price);
      if (pr <= 0) return false;
      const type = (p.ticket_type || "").toLowerCase();
      if (
        type.includes("fam") ||
        type.includes("pax") ||
        type.includes("criança") ||
        type.includes("crianca") ||
        type.includes("estudante") ||
        type.includes("sénior") ||
        type.includes("senior") ||
        type.includes("jovem")
      ) {
        return false;
      }
      if (p.seats_count && p.seats_count > 1) return false;
      return true;
    })
    .map((p) => Number(p.price));

  if (singlePrices.length > 0) {
    return { unitPrice: Math.min(...singlePrices), method: "SINGLE_NON_CONCESSION" };
  }

  // 4. Fallback: average across all non-zero prices as a last resort (with audit warning)
  const nonZeroPrices = prices
    .filter((p) => Number(p.price) > 0)
    .map((p) => Number(p.price));

  if (nonZeroPrices.length > 0) {
    const avg = nonZeroPrices.reduce((a, b) => a + b, 0) / nonZeroPrices.length;
    console.warn(
      `[revenue] No default/standard ticket price found for session (format='${format || ""}'). ` +
      `Falling back to unweighted average across non-zero ticket types: [${nonZeroPrices.join(", ")}] -> ${avg.toFixed(2)} EUR.`
    );
    return { unitPrice: avg, method: "NON_ZERO_AVERAGE" };
  }

  // 5. Default format fallback
  const fmt = (format || "").toUpperCase();
  if (fmt.includes("IMAX")) return { unitPrice: 13.50, method: "FORMAT_FALLBACK" };
  if (fmt.includes("3D")) return { unitPrice: 9.50, method: "FORMAT_FALLBACK" };
  return { unitPrice: 8.75, method: "FORMAT_FALLBACK" };
}

export interface MoviePricingDiagnostic {
  movieId: number;
  movieTitle: string;
  cleanDefaultCount: number;
  fallbackAvgCount: number;
  cleanDefaultAvgUnitPrice: number | null;
  fallbackAvgUnitPrice: number | null;
  priceDelta: number | null; // fallback - clean
}

/**
 * Generates and prints a comprehensive diagnostic audit report per movie for a completed collection run.
 * Checks per movie:
 * 1. Count of sessions that used clean single default / standard pricing vs unweighted fallback average path
 * 2. Resulting average unit price for each path
 * 3. Deviation between paths to audit family/animated titles vs adult titles
 */
export async function logCollectionPricingAuditReport(collectionRunDbId: number): Promise<MoviePricingDiagnostic[]> {
  try {
    const diagnosticQuery = `
      WITH run_sessions AS (
        SELECT DISTINCT s.id as session_id, s.movie_id, m.title as movie_title, s.format
        FROM seat_snapshots ss
        JOIN sessions s ON ss.session_id = s.id
        JOIN movies m ON s.movie_id = m.id
        WHERE ss.collection_run_id = $1
      ),
      session_prices_detailed AS (
        SELECT 
          rs.session_id,
          rs.movie_id,
          rs.movie_title,
          rs.format,
          -- Determine resolution path
          CASE 
            WHEN MIN(stp.price) FILTER (WHERE stp.is_default = true AND stp.price > 0) IS NOT NULL THEN 'CLEAN_DEFAULT'
            WHEN MIN(stp.price) FILTER (WHERE stp.price > 0 AND (stp.ticket_type ILIKE '%normal%' OR stp.ticket_type ILIKE '%adulto%' OR stp.ticket_type ILIKE '%inteiro%' OR stp.ticket_type ILIKE '%standard%') AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)) IS NOT NULL THEN 'CLEAN_DEFAULT'
            WHEN MIN(stp.price) FILTER (WHERE stp.price > 0 AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND stp.ticket_type NOT ILIKE '%crian%' AND stp.ticket_type NOT ILIKE '%estud%' AND stp.ticket_type NOT ILIKE '%sénior%' AND stp.ticket_type NOT ILIKE '%senior%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)) IS NOT NULL THEN 'CLEAN_DEFAULT'
            WHEN AVG(stp.price) FILTER (WHERE stp.price > 0) IS NOT NULL THEN 'FALLBACK_AVG'
            ELSE 'NO_PRICES'
          END as resolution_path,
          -- Clean default / standard price
          COALESCE(
            MIN(stp.price) FILTER (WHERE stp.is_default = true AND stp.price > 0),
            MIN(stp.price) FILTER (WHERE stp.price > 0 AND (stp.ticket_type ILIKE '%normal%' OR stp.ticket_type ILIKE '%adulto%' OR stp.ticket_type ILIKE '%inteiro%' OR stp.ticket_type ILIKE '%standard%') AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
            MIN(stp.price) FILTER (WHERE stp.price > 0 AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND stp.ticket_type NOT ILIKE '%crian%' AND stp.ticket_type NOT ILIKE '%estud%' AND stp.ticket_type NOT ILIKE '%sénior%' AND stp.ticket_type NOT ILIKE '%senior%' AND (stp.seats_count IS NULL OR stp.seats_count = 1))
          ) as clean_unit_price,
          -- Fallback average across all non-zero prices
          AVG(stp.price) FILTER (WHERE stp.price > 0) as fallback_avg_unit_price
        FROM run_sessions rs
        LEFT JOIN session_ticket_prices stp ON stp.session_id = rs.session_id
        GROUP BY rs.session_id, rs.movie_id, rs.movie_title, rs.format
      )
      SELECT 
        movie_id,
        movie_title,
        COUNT(CASE WHEN resolution_path = 'CLEAN_DEFAULT' THEN 1 END) as clean_default_count,
        COUNT(CASE WHEN resolution_path = 'FALLBACK_AVG' THEN 1 END) as fallback_avg_count,
        ROUND(AVG(CASE WHEN resolution_path = 'CLEAN_DEFAULT' THEN clean_unit_price END)::numeric, 2) as clean_default_avg_unit_price,
        ROUND(AVG(CASE WHEN resolution_path = 'FALLBACK_AVG' THEN fallback_avg_unit_price END)::numeric, 2) as fallback_avg_unit_price
      FROM session_prices_detailed
      GROUP BY movie_id, movie_title
      ORDER BY movie_title ASC;
    `;

    const res = await query<{
      movie_id: number;
      movie_title: string;
      clean_default_count: string | number;
      fallback_avg_count: string | number;
      clean_default_avg_unit_price: string | number | null;
      fallback_avg_unit_price: string | number | null;
    }>(diagnosticQuery, [collectionRunDbId]);

    const report: MoviePricingDiagnostic[] = res.rows.map((row) => {
      const cleanCount = Number(row.clean_default_count || 0);
      const fallbackCount = Number(row.fallback_avg_count || 0);
      const cleanAvg = row.clean_default_avg_unit_price !== null ? Number(row.clean_default_avg_unit_price) : null;
      const fallbackAvg = row.fallback_avg_unit_price !== null ? Number(row.fallback_avg_unit_price) : null;
      const delta = (fallbackAvg !== null && cleanAvg !== null) ? Number((fallbackAvg - cleanAvg).toFixed(2)) : null;

      return {
        movieId: row.movie_id,
        movieTitle: row.movie_title,
        cleanDefaultCount: cleanCount,
        fallbackAvgCount: fallbackCount,
        cleanDefaultAvgUnitPrice: cleanAvg,
        fallbackAvgUnitPrice: fallbackAvg,
        priceDelta: delta,
      };
    });

    // Format and print log report to stdout
    console.log("\n" + "=".repeat(105));
    console.log(`[PRICING RESOLUTION AUDIT REPORT] Collection Run DB ID #${collectionRunDbId}`);
    console.log("=".repeat(105));
    console.log(
      "Movie Title".padEnd(38) +
      "Clean Def Sessions".padStart(19) +
      "Clean Avg €".padStart(13) +
      "Fallback Sessions".padStart(19) +
      "Fallback Avg €".padStart(16)
    );
    console.log("-".repeat(105));

    if (report.length === 0) {
      console.log("  No sessions or snapshots recorded in this run.");
    } else {
      let totalClean = 0;
      let totalFallback = 0;

      for (const item of report) {
        totalClean += item.cleanDefaultCount;
        totalFallback += item.fallbackAvgCount;
        const cleanPriceStr = item.cleanDefaultAvgUnitPrice !== null ? `${item.cleanDefaultAvgUnitPrice.toFixed(2)} €` : "N/A";
        const fallbackPriceStr = item.fallbackAvgUnitPrice !== null ? `${item.fallbackAvgUnitPrice.toFixed(2)} €` : "N/A";
        const titleTrunc = item.movieTitle.length > 36 ? item.movieTitle.substring(0, 33) + "..." : item.movieTitle;

        console.log(
          titleTrunc.padEnd(38) +
          String(item.cleanDefaultCount).padStart(19) +
          cleanPriceStr.padStart(13) +
          String(item.fallbackAvgCount).padStart(19) +
          fallbackPriceStr.padStart(16)
        );
      }

      console.log("-".repeat(105));
      console.log(
        `TOTALS: ${report.length} movies | Clean Default: ${totalClean} sessions | Fallback Average: ${totalFallback} sessions`
      );
    }
    console.log("=".repeat(105) + "\n");

    return report;
  } catch (err) {
    console.error("Failed to generate collection pricing audit report:", err);
    return [];
  }
}

/**
 * Normalizes all movie titles in DB and merges duplicate movie entries
 * (e.g., VO vs VP versions of the same movie) under a single canonical movie record.
 */
export async function mergeDuplicateMoviesInDb(): Promise<number> {
  try {
    // 1. Clean titles of all existing movies
    const allMovies = await query<{ id: number; title: string }>("SELECT id, title FROM movies ORDER BY id ASC;");
    for (const m of allMovies.rows) {
      const cleaned = cleanMovieTitle(m.title);
      if (cleaned && cleaned !== m.title) {
        await query("UPDATE movies SET title = $1 WHERE id = $2;", [cleaned, m.id]);
      }
    }

    // 2. Find groups of movies sharing the exact same LOWER(title)
    const duplicates = await query<{ clean_title: string; movie_ids: number[] }>(
      `SELECT LOWER(title) as clean_title, array_agg(id ORDER BY id ASC) as movie_ids
       FROM movies
       GROUP BY LOWER(title)
       HAVING COUNT(*) > 1;`
    );

    let mergedCount = 0;
    for (const group of duplicates.rows) {
      const ids = group.movie_ids;
      if (ids.length <= 1) continue;

      // Pick canonical ID: the one that already has the most sessions, or smallest ID
      const counts = await query<{ movie_id: number; cnt: number }>(
        `SELECT movie_id, COUNT(*)::int as cnt 
         FROM sessions 
         WHERE movie_id = ANY($1::int[]) 
         GROUP BY movie_id 
         ORDER BY cnt DESC, movie_id ASC;`,
        [ids]
      );

      let canonicalId = ids[0];
      if (counts.rows.length > 0) {
        canonicalId = counts.rows[0].movie_id;
      }

      const secondaryIds = ids.filter((id) => id !== canonicalId);
      console.log(`[Movie Merge] Merging duplicate movie records for "${group.clean_title}". Canonical ID: ${canonicalId}, Secondary IDs: ${secondaryIds.join(", ")}`);

      for (const secId of secondaryIds) {
        // Re-link sessions
        await query("UPDATE sessions SET movie_id = $1 WHERE movie_id = $2;", [canonicalId, secId]);

        // Re-link or clean movie_performance_snapshots
        await query("UPDATE movie_performance_snapshots SET movie_id = $1 WHERE movie_id = $2;", [canonicalId, secId]);

        // Re-link or clean forecast_backtests
        await query("UPDATE forecast_backtests SET movie_id = $1 WHERE movie_id = $2;", [canonicalId, secId]);

        // Re-link or clean calibration_factors
        await query(
          `UPDATE calibration_factors SET movie_id = $1 WHERE movie_id = $2 
           AND NOT EXISTS (SELECT 1 FROM calibration_factors WHERE movie_id = $1);`,
          [canonicalId, secId]
        );
        await query("DELETE FROM calibration_factors WHERE movie_id = $1;", [secId]);

        // Delete secondary movie entry
        await query("DELETE FROM movies WHERE id = $1;", [secId]);
        mergedCount++;
      }
    }

    if (mergedCount > 0) {
      console.log(`[Movie Merge] Successfully merged ${mergedCount} duplicate movie entries. Recalculating performance snapshots...`);
      await recalculateAllPerformanceSnapshots();
    }

    return mergedCount;
  } catch (err) {
    console.error("[Movie Merge] Error during movie deduplication:", err);
    return 0;
  }
}
