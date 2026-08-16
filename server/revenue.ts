import { query } from "./db";

/**
 * Canonical Session Pricing Resolver in TypeScript/JavaScript.
 * Matches the exact SQL logic used across all database queries.
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

  // 1. Try default tickets (is_default = true and price > 0)
  const defaultPrices = prices
    .filter((p) => p.is_default && Number(p.price) > 0)
    .map((p) => Number(p.price));

  if (defaultPrices.length > 0) {
    return defaultPrices.reduce((a, b) => a + b, 0) / defaultPrices.length;
  }

  // 2. Try single-seat, non-family/pax tickets
  const singlePrices = prices
    .filter((p) => {
      const pr = Number(p.price);
      if (pr <= 0) return false;
      const type = (p.ticket_type || "").toLowerCase();
      if (type.includes("fam") || type.includes("pax")) return false;
      if (p.seats_count && p.seats_count > 1) return false;
      return true;
    })
    .map((p) => Number(p.price));

  if (singlePrices.length > 0) {
    return singlePrices.reduce((a, b) => a + b, 0) / singlePrices.length;
  }

  // 3. Fallback to any non-zero prices
  const nonZeroPrices = prices
    .filter((p) => Number(p.price) > 0)
    .map((p) => Number(p.price));

  if (nonZeroPrices.length > 0) {
    return nonZeroPrices.reduce((a, b) => a + b, 0) / nonZeroPrices.length;
  }

  // 4. Default format fallback
  const fmt = (format || "").toUpperCase();
  if (fmt.includes("IMAX")) return 13.50;
  if (fmt.includes("3D")) return 9.50;
  return 8.75;
}

/**
 * Returns the canonical SQL subquery for session pricing resolution.
 */
export function getSessionPricesSqlCte(): string {
  return `
    session_prices AS (
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
      GROUP BY s.id, s.movie_id, s.operational_date, s.format
    )
  `;
}

/**
 * Recalculate stored performance snapshots in movie_performance_snapshots
 * using canonical unit prices for consistency across historical tables.
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
    WITH session_prices AS (
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
      GROUP BY s.id, s.movie_id, s.operational_date, s.format
    ),
    recalculated_snapshots AS (
      SELECT 
        mps.id as snapshot_id,
        mps.movie_id,
        mps.operational_date,
        mps.snapshot_timestamp,
        mps.showcount_total,
        mps.estimated_admissions,
        COALESCE(SUM(ss.unavailable_seats * sp.resolved_unit_price), 0.0) as new_estimated_revenue
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
      GROUP BY mps.id, mps.movie_id, mps.operational_date, mps.snapshot_timestamp, mps.showcount_total, mps.estimated_admissions
    )
    UPDATE movie_performance_snapshots mps
    SET 
      estimated_revenue = ROUND(rs.new_estimated_revenue::numeric, 2),
      revenue_per_show = CASE WHEN mps.showcount_total > 0 THEN ROUND((rs.new_estimated_revenue / mps.showcount_total)::numeric, 2) ELSE 0.0 END
    FROM recalculated_snapshots rs
    WHERE mps.id = rs.snapshot_id;
  `;

  const res = await query(querySql, params);
  return res.rowCount || 0;
}
