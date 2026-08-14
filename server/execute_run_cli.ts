import * as fs from "fs";
import { executeCollectionRun } from "./collector";
import { pool } from "./db";

async function main() {
  try {
    const isGha = process.env.GITHUB_ACTIONS === "true";
    const triggerSource: "MANUAL" | "SCHEDULED" | "CRON" | "GITHUB_ACTIONS" = isGha ? "GITHUB_ACTIONS" : "MANUAL";
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

    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummaryPath) {
      try {
        const md = `
### 🎬 NOS Collector Session Run Summary
- **Run ID**: \`${result.runId}\`
- **Trigger Source**: \`${triggerSource}\`
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
    console.error("CLI run failed with error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
