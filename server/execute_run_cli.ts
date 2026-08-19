import * as fs from "fs";
import { executeCollectionRun } from "./collector";
import { pool } from "./db";

async function main() {
  try {
    const triggerSource: "MANUAL" | "SCHEDULED" | "CRON" | "CLI" = (process.env.TRIGGER_SOURCE as any) || "CLI";
    console.log(`Starting standalone collection run (${triggerSource})...`);

    const result = await executeCollectionRun({ triggerSource });

    console.log("=== RUN RESULT ===");
    console.log(`Status: ${result.status}`);
    console.log(`Movies Found: ${result.moviesFound}`);
    console.log(`Sessions Attempted: ${result.sessionsAttempted}`);
    console.log(`Sessions Successful: ${result.sessionsSuccessful}`);
    console.log(`Sessions Failed: ${result.sessionsFailed}`);
    console.log(`Snapshots Created: ${result.snapshotsCreated}`);
    console.log(`Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
    if (result.errors && result.errors.length > 0) {
      console.log("Errors captured:");
      result.errors.forEach((e) => console.log(`- ${e}`));
    }

    if (result.status === "FAILED") {
      process.exit(1);
    }

    process.exit(0);
  } catch (err: any) {
    console.error("CLI run failed with error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
