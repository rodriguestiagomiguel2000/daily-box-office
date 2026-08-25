import { recalculateAllPerformanceSnapshots } from "../server/revenue";

async function main() {
  console.log("[recalculate] Recalculating all performance snapshots with structural block subtraction disabled...");
  const updatedCount = await recalculateAllPerformanceSnapshots();
  console.log(`[recalculate] Successfully recalculated ${updatedCount} performance snapshots.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[recalculate] Error:", err);
  process.exit(1);
});
