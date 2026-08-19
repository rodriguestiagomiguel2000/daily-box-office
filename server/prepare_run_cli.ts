import { prepareCollectionRun } from "./collector";
import { pool, query } from "./db";

async function main() {
  try {
    const triggerSource: "MANUAL" | "SCHEDULED" | "CRON" | "CLI" = (process.env.TRIGGER_SOURCE as any) || "CLI";

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
