import { prepareCollectionRun } from "./collector";
import { pool, query } from "./db";

async function main() {
  try {
    // 1. Database-backed concurrency lock to prevent concurrent runs from overlapping
    // Check if any run is currently 'RUNNING' and started within the last 20 minutes
    const activeCheck = await query<{ run_id: string; started_at: Date }>(
      `SELECT run_id, started_at FROM collection_runs 
       WHERE status = 'RUNNING' 
         AND started_at > NOW() - INTERVAL '20 minutes'
       LIMIT 1;`
    );

    if (activeCheck.rows.length > 0) {
      console.error(
        `CONCURRENCY_LOCK: Run ${activeCheck.rows[0].run_id} is already active (started at ${activeCheck.rows[0].started_at.toISOString()}). Skipping.`
      );
      process.exit(2);
    }

    // Determine the trigger source. GHA sets GITHUB_ACTIONS=true in environment by default
    const isGha = process.env.GITHUB_ACTIONS === "true";
    const triggerSource = isGha ? "GITHUB_ACTIONS" : "MANUAL";

    const prepared = await prepareCollectionRun({ triggerSource });
    if (!prepared) {
      console.error("CONCURRENCY_LOCK: In-memory lock failed. Skipping.");
      process.exit(2);
    }

    // Output JSON representation to stdout so python can parse it
    console.log(JSON.stringify(prepared));
    process.exit(0);
  } catch (err: any) {
    console.error("Failed to prepare collection run:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
