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

    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummaryPath) {
      try {
        const md = `
### 🎬 NOS Collector Session Run Summary
- **Run ID**: \`${envelope.prepared.runId}\`
- **Trigger Source**: \`GITHUB_ACTIONS\`
- **Status**: ${result.status === "SUCCESS" ? "🟢 **SUCCESS**" : result.status === "PARTIAL" ? "🟡 **PARTIAL**" : "🔴 **FAILED**"}
- **Movies Discovered**: \`${result.moviesFound}\`
- **Sessions Attempted**: \`${result.sessionsAttempted}\`
- **Sessions Successful**: \`${result.sessionsSuccessful}\`
- **Sessions Failed**: \`${result.sessionsFailed}\`
- **Seat Snapshots Created**: \`${result.snapshotsCreated}\`
- **Duration**: \`${(result.durationMs / 1000).toFixed(2)}s\`

${result.errors && result.errors.length > 0 ? `#### ⚠️ Errors Captured:\n${result.errors.map((e) => `- \`${e}\``).join("\n")}` : ""}
`;
        fs.appendFileSync(stepSummaryPath, md);
      } catch (err) {
        console.error("Failed to write to GITHUB_STEP_SUMMARY:", err);
      }
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
