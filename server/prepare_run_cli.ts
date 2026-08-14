import { prepareCollectionRun } from "./collector";
import { pool, query } from "./db";

async function main() {
  try {
    // Determine the trigger source. GHA sets GITHUB_ACTIONS=true in environment by default
    const isGha = process.env.GITHUB_ACTIONS === "true";
    const triggerSource = isGha ? "GITHUB_ACTIONS" : "MANUAL";

    const prepared = await prepareCollectionRun({ triggerSource });
    if (!prepared) {
      console.warn("CONCURRENCY_LOCK: Another run is active. Skipping.");
      console.log(JSON.stringify({ skipped: true, reason: "BUSY" }));
      process.exit(0);
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
