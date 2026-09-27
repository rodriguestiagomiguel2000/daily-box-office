import { pool, query } from "./db";

export interface RetentionPurgeOptions {
  retentionDays?: number;
  batchSizeSnapshots?: number;
  vacuumFullThresholdPct?: number;
  dryRun?: boolean;
}

export interface TableBloatInfo {
  relname: string;
  n_dead_tup: number;
  n_live_tup: number;
  dead_pct: number;
}

export interface RetentionPurgeResult {
  snapshotsPurged: number;
  seatStatesPurged: number;
  transitionsPurged: number;
  cutoffDate: string;
  durationMs: number;
  vacuumResults: Array<{
    table: string;
    deadPct: number;
    vacuumFullExecuted: boolean;
  }>;
  success: boolean;
  error?: string;
}

/**
 * Checks dead tuple percentages across the three granular seat tables using pg_stat_user_tables.
 */
export async function getGranularTablesBloat(): Promise<TableBloatInfo[]> {
  try {
    const res = await query<TableBloatInfo>(`
      SELECT 
        relname,
        COALESCE(n_dead_tup, 0)::bigint AS n_dead_tup,
        COALESCE(n_live_tup, 0)::bigint AS n_live_tup,
        ROUND(100.0 * COALESCE(n_dead_tup, 0) / GREATEST(1, COALESCE(n_dead_tup, 0) + COALESCE(n_live_tup, 0)), 2)::float AS dead_pct
      FROM pg_stat_user_tables
      WHERE relname IN ('seat_states', 'seat_snapshots', 'seat_transitions')
      ORDER BY relname ASC;
    `);
    return res.rows;
  } catch (err) {
    console.error("[Retention Purge] Error querying pg_stat_user_tables:", err);
    return [];
  }
}

/**
 * Executes a 45-day retention purge strictly scoped to granular tables:
 * seat_states, seat_snapshots, and seat_transitions.
 *
 * CRITICAL SAFETY BOUNDARY:
 * NEVER deletes or modifies movie_performance_snapshots, collection_runs,
 * room_structural_blocks, calibration_factors, sessions, movies, cinemas, or rooms.
 *
 * Deletes in controlled batches (e.g. 1,000 snapshots / ~250k seat_states per batch)
 * to avoid long table locks.
 * Runs regular VACUUM ANALYZE after completion, and conditionally triggers
 * VACUUM FULL only if dead tuple bloat crosses the 20% threshold.
 */
export async function executeRetentionPurge(
  options: RetentionPurgeOptions = {}
): Promise<RetentionPurgeResult> {
  const retentionDays = options.retentionDays !== undefined ? options.retentionDays : 45;
  const batchSizeSnapshots = options.batchSizeSnapshots || 1000;
  const vacuumFullThresholdPct = options.vacuumFullThresholdPct !== undefined ? options.vacuumFullThresholdPct : 20.0;
  const dryRun = Boolean(options.dryRun);

  const startTime = Date.now();
  console.log(`[Retention Purge] Initiating 45-day retention purge (retention: ${retentionDays} days, batch: ${batchSizeSnapshots}, dryRun: ${dryRun})...`);

  // Calculate cutoff timestamp in UTC
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoffDate.toISOString();

  let totalSnapshotsPurged = 0;
  let totalSeatStatesPurged = 0;
  let totalTransitionsPurged = 0;

  try {
    if (dryRun) {
      const dryRes = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM seat_snapshots WHERE collected_at < $1;`,
        [cutoffIso]
      );
      const snapshotCount = parseInt(dryRes.rows[0]?.count || "0", 10);
      console.log(`[Retention Purge DRY RUN] Found ${snapshotCount} seat_snapshots older than ${cutoffIso} eligible for deletion.`);
      return {
        snapshotsPurged: snapshotCount,
        seatStatesPurged: snapshotCount * 220, // estimate
        transitionsPurged: snapshotCount,
        cutoffDate: cutoffIso,
        durationMs: Date.now() - startTime,
        vacuumResults: [],
        success: true,
      };
    }

    let hasMore = true;
    let batchIndex = 0;

    while (hasMore) {
      batchIndex++;
      const client = await pool.connect();
      let batchSnapCount = 0;
      let batchStateCount = 0;
      let batchTransCount = 0;

      try {
        await client.query("BEGIN");

        // 1. Fetch next batch of snapshot IDs older than cutoff
        const snapRes = await client.query<{ id: number }>(
          `SELECT id FROM seat_snapshots 
           WHERE collected_at < $1 
           ORDER BY id ASC 
           LIMIT $2;`,
          [cutoffIso, batchSizeSnapshots]
        );

        const snapIds = snapRes.rows.map((r) => r.id);

        if (snapIds.length === 0) {
          await client.query("COMMIT");
          hasMore = false;
          break;
        }

        // 2. Delete child physical seat_states for this batch of snapshots
        const stateDelRes = await client.query(
          `DELETE FROM seat_states WHERE snapshot_id = ANY($1::int[]);`,
          [snapIds]
        );
        batchStateCount = stateDelRes.rowCount || 0;

        // 3. Delete seat_transitions referencing these snapshots
        const transDelRes = await client.query(
          `DELETE FROM seat_transitions 
           WHERE curr_snapshot_id = ANY($1::int[]) 
              OR prev_snapshot_id = ANY($1::int[]);`,
          [snapIds]
        );
        batchTransCount = transDelRes.rowCount || 0;

        // 4. Delete the seat_snapshots rows
        const snapDelRes = await client.query(
          `DELETE FROM seat_snapshots WHERE id = ANY($1::int[]);`,
          [snapIds]
        );
        batchSnapCount = snapDelRes.rowCount || 0;

        await client.query("COMMIT");

        totalSnapshotsPurged += batchSnapCount;
        totalSeatStatesPurged += batchStateCount;
        totalTransitionsPurged += batchTransCount;

        console.log(
          `[Retention Purge] Batch ${batchIndex}: Purged ${batchSnapCount} snapshots, ${batchStateCount} seat_states, ${batchTransCount} transitions.`
        );

        // Check if there may be more
        if (snapIds.length < batchSizeSnapshots) {
          hasMore = false;
        }
      } catch (batchErr) {
        await client.query("ROLLBACK");
        console.error(`[Retention Purge] Error in batch ${batchIndex}:`, batchErr);
        throw batchErr;
      } finally {
        client.release();
      }
    }

    // Also sweep any orphaned transitions older than cutoff that might not reference remaining snapshots
    try {
      let orphanedTransitions = true;
      while (orphanedTransitions) {
        const orphanRes = await query(
          `DELETE FROM seat_transitions 
           WHERE id IN (
             SELECT id FROM seat_transitions 
             WHERE transition_timestamp < $1 
             LIMIT 5000
           );`,
          [cutoffIso]
        );
        const count = orphanRes.rowCount || 0;
        if (count > 0) {
          totalTransitionsPurged += count;
          console.log(`[Retention Purge] Purged ${count} orphaned seat_transitions older than ${cutoffIso}.`);
        }
        if (count < 5000) {
          orphanedTransitions = false;
        }
      }
    } catch (orphanErr) {
      console.warn("[Retention Purge] Warning sweeping orphaned transitions:", orphanErr);
    }

    console.log(
      `[Retention Purge] Data purge completed in ${Date.now() - startTime}ms. Totals: ${totalSnapshotsPurged} snapshots, ${totalSeatStatesPurged} seat_states, ${totalTransitionsPurged} transitions.`
    );

    // 5. Run regular VACUUM ANALYZE on granular tables (reclaims space within tables, prevents bloat)
    console.log("[Retention Purge] Running regular VACUUM ANALYZE on seat_states, seat_snapshots, seat_transitions...");
    const granularTables = ["seat_states", "seat_snapshots", "seat_transitions"];
    for (const tbl of granularTables) {
      try {
        const vacClient = await pool.connect();
        try {
          await vacClient.query(`VACUUM ANALYZE ${tbl};`);
        } finally {
          vacClient.release();
        }
        console.log(`[Retention Purge] VACUUM ANALYZE ${tbl} completed successfully.`);
      } catch (vacErr) {
        console.warn(`[Retention Purge] VACUUM ANALYZE ${tbl} warning:`, vacErr);
      }
    }

    // 6. Check accumulated dead tuple bloat via pg_stat_user_tables and conditionally run VACUUM FULL
    const bloatStats = await getGranularTablesBloat();
    const vacuumResults: Array<{ table: string; deadPct: number; vacuumFullExecuted: boolean }> = [];

    for (const stat of bloatStats) {
      let executedFull = false;
      const deadPct = stat.dead_pct;
      console.log(`[Retention Purge Bloat] Table ${stat.relname}: dead_pct=${deadPct}% (${stat.n_dead_tup} dead / ${stat.n_live_tup} live tuples).`);

      if (deadPct >= vacuumFullThresholdPct) {
        console.log(
          `[Retention Purge] Table ${stat.relname} dead_pct (${deadPct}%) crosses threshold (${vacuumFullThresholdPct}%). Initiating VACUUM FULL ${stat.relname}...`
        );
        try {
          const fullClient = await pool.connect();
          try {
            await fullClient.query(`VACUUM FULL ${stat.relname};`);
            executedFull = true;
            console.log(`[Retention Purge] VACUUM FULL ${stat.relname} completed successfully.`);
          } finally {
            fullClient.release();
          }
        } catch (fullErr) {
          console.error(`[Retention Purge] VACUUM FULL ${stat.relname} encountered error:`, fullErr);
        }
      } else {
        console.log(
          `[Retention Purge] Table ${stat.relname} dead_pct (${deadPct}%) is below threshold (${vacuumFullThresholdPct}%). VACUUM FULL skipped.`
        );
      }

      vacuumResults.push({
        table: stat.relname,
        deadPct,
        vacuumFullExecuted: executedFull,
      });
    }

    return {
      snapshotsPurged: totalSnapshotsPurged,
      seatStatesPurged: totalSeatStatesPurged,
      transitionsPurged: totalTransitionsPurged,
      cutoffDate: cutoffIso,
      durationMs: Date.now() - startTime,
      vacuumResults,
      success: true,
    };
  } catch (err: any) {
    console.error("[Retention Purge] Fatal error executing retention purge:", err);
    return {
      snapshotsPurged: totalSnapshotsPurged,
      seatStatesPurged: totalSeatStatesPurged,
      transitionsPurged: totalTransitionsPurged,
      cutoffDate: cutoffIso,
      durationMs: Date.now() - startTime,
      vacuumResults: [],
      success: false,
      error: err.message || String(err),
    };
  }
}
