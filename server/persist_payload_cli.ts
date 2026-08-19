import * as fs from "fs";
import { persistCollectionPayload } from "./collector";
import { pool } from "./db";

async function main() {
  try {
    const jsonPath = process.argv[2];
    if (!jsonPath) {
      console.error("Error: Missing JSON file path argument.");
      process.exit(1);
    }

    if (!fs.existsSync(jsonPath)) {
      console.error(`Error: File not found at ${jsonPath}`);
      process.exit(1);
    }

    const fileContent = fs.readFileSync(jsonPath, "utf-8");
    const envelope = JSON.parse(fileContent);

    if (!envelope.prepared || !envelope.finalPayload) {
      console.error("Error: Invalid envelope format. Must contain 'prepared' and 'finalPayload'.");
      process.exit(1);
    }

    console.log(`Starting persistence for run ${envelope.prepared.runId}...`);
    const result = await persistCollectionPayload(envelope.prepared, envelope.finalPayload);

    console.log("=== PERSISTENCE SUCCESS ===");
    console.log(`Status: ${result.status}`);
    console.log(`Movies Found: ${result.moviesFound}`);
    console.log(`Sessions Attempted: ${result.sessionsAttempted}`);
    console.log(`Sessions Successful: ${result.sessionsSuccessful}`);
    console.log(`Sessions Failed: ${result.sessionsFailed}`);
    console.log(`Snapshots Created: ${result.snapshotsCreated}`);
    console.log(`Duration: ${result.durationMs}ms`);
    if (result.errors && result.errors.length > 0) {
      console.log("Errors captured:");
      result.errors.forEach((e) => console.log(`- ${e}`));
    }

    if (result.status === "FAILED") {
      process.exit(1);
    }

    process.exit(0);
  } catch (err: any) {
    console.error("Persistence CLI failed with error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
