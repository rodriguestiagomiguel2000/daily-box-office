import { executeRetentionPurge, getGranularTablesBloat } from "../server/retention";

async function main() {
  const args = process.argv.slice(2);
  let retentionDays = 45;
  let batchSize = 1000;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      retentionDays = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--batch" && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  console.log("==================================================");
  console.log("  NOS Theatrical Granular Data Retention Purge   ");
  console.log("==================================================");
  console.log(`Retention window: ${retentionDays} days`);
  console.log(`Batch size (snapshots): ${batchSize}`);
  console.log(`Dry run mode: ${dryRun}`);
  console.log("--------------------------------------------------");

  const bloatBefore = await getGranularTablesBloat();
  console.log("Initial Granular Table Dead-Tuple Bloat Status:");
  for (const b of bloatBefore) {
    console.log(`  • ${b.relname}: ${b.dead_pct}% dead (${b.n_dead_tup} dead / ${b.n_live_tup} live)`);
  }
  console.log("--------------------------------------------------");

  const result = await executeRetentionPurge({
    retentionDays,
    batchSizeSnapshots: batchSize,
    dryRun,
  });

  console.log("==================================================");
  console.log("Retention Purge Results:");
  console.log(`  Success: ${result.success}`);
  console.log(`  Cutoff date: ${result.cutoffDate}`);
  console.log(`  Snapshots purged: ${result.snapshotsPurged.toLocaleString()}`);
  console.log(`  Seat states purged: ${result.seatStatesPurged.toLocaleString()}`);
  console.log(`  Transitions purged: ${result.transitionsPurged.toLocaleString()}`);
  console.log(`  Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
  if (result.vacuumResults && result.vacuumResults.length > 0) {
    console.log("  Vacuum Results:");
    for (const v of result.vacuumResults) {
      console.log(`    • ${v.table}: dead_pct=${v.deadPct}%, VACUUM FULL=${v.vacuumFullExecuted}`);
    }
  }
  if (result.error) {
    console.error(`  Error: ${result.error}`);
    process.exit(1);
  }
  console.log("==================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error running retention purge:", err);
  process.exit(1);
});
