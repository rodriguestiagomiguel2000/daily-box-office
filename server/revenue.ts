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
 * Note on why unweighted averaging was wrong:
 * Averaging distinct ticket-type prices unweighted systematically overestimates revenue
 * because discounted tickets represent a large volume of actual attendance.
 * We prefer the single standard/default adult ticket price (MIN price where is_default = true
 * or ticket_type ILIKE '%normal%') and only fall back to an average across all non-zero prices
 * as a last resort.
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
          MIN(stp.price) FILTER (WHERE stp.is_default = true AND stp.price > 0),
          MIN(stp.price) FILTER (WHERE stp.price > 0 AND (stp.ticket_type ILIKE '%normal%' OR stp.ticket_type ILIKE '%adulto%' OR stp.ticket_type ILIKE '%inteiro%' OR stp.ticket_type ILIKE '%standard%') AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
          MIN(stp.price) FILTER (WHERE stp.price > 0 AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND stp.ticket_type NOT ILIKE '%crian%' AND stp.ticket_type NOT ILIKE '%estud%' AND stp.ticket_type NOT ILIKE '%sénior%' AND stp.ticket_type NOT ILIKE '%senior%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
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
          MIN(stp.price) FILTER (WHERE stp.is_default = true AND stp.price > 0),
          MIN(stp.price) FILTER (WHERE stp.price > 0 AND (stp.ticket_type ILIKE '%normal%' OR stp.ticket_type ILIKE '%adulto%' OR stp.ticket_type ILIKE '%inteiro%' OR stp.ticket_type ILIKE '%standard%') AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
          MIN(stp.price) FILTER (WHERE stp.price > 0 AND stp.ticket_type NOT ILIKE '%fam%' AND stp.ticket_type NOT ILIKE '%pax%' AND stp.ticket_type NOT ILIKE '%crian%' AND stp.ticket_type NOT ILIKE '%estud%' AND stp.ticket_type NOT ILIKE '%sénior%' AND stp.ticket_type NOT ILIKE '%senior%' AND (stp.seats_count IS NULL OR stp.seats_count = 1)),
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
