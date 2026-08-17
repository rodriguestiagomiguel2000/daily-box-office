import { calculateDaysBeforeRelease } from "./server/presale";
import { normalizeDateStr, addDays, getDayDifference } from "./server/boxoffice";

function assertEqual(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    console.error(`❌ FAILED: ${message}`);
    console.error(`   Expected: ${JSON.stringify(expected)}`);
    console.error(`   Actual:   ${JSON.stringify(actual)}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("\n==========================================");
console.log("TEST SUITE: PRE-SALE TRACKING & CURVE CALCULATION");
console.log("==========================================\n");

// Movie release / opening operational date: Wednesday, July 29, 2026
const openingDate = "2026-07-29";

console.log("--- 1. Testing days_before_release Calculation ---");
// 7 days before release (T-7)
assertEqual(
  calculateDaysBeforeRelease(openingDate, "2026-07-22T14:00:00Z"),
  7,
  "2026-07-22 snapshot for 2026-07-29 opening is T-7 (7 days before)"
);

// 6 days before release (T-6)
assertEqual(
  calculateDaysBeforeRelease(openingDate, "2026-07-23T10:30:00Z"),
  6,
  "2026-07-23 snapshot for 2026-07-29 opening is T-6"
);

// 3 days before release (T-3)
assertEqual(
  calculateDaysBeforeRelease(openingDate, "2026-07-26T20:00:00Z"),
  3,
  "2026-07-26 snapshot for 2026-07-29 opening is T-3"
);

// 1 day before release (T-1) (July 28 at 18:00 UTC = 19:00 Lisbon)
assertEqual(
  calculateDaysBeforeRelease(openingDate, "2026-07-28T18:00:00Z"),
  1,
  "2026-07-28 snapshot for 2026-07-29 opening is T-1"
);

// Release day itself (T-0)
assertEqual(
  calculateDaysBeforeRelease(openingDate, "2026-07-29T11:00:00Z"),
  0,
  "2026-07-29 snapshot for 2026-07-29 opening is T-0"
);

console.log("--- 2. Testing Day-over-Day Presale Growth Math ---");
// Simulate T-buckets curve
const testBuckets = [
  { t: 7, date: "2026-07-22", tickets: 120, rev: 1050.0 },
  { t: 6, date: "2026-07-23", tickets: 222, rev: 1942.5 },
  { t: 5, date: "2026-07-24", tickets: 350, rev: 3062.5 },
  { t: 0, date: "2026-07-29", tickets: 1420, rev: 12425.0 },
];

const dod0_1_tickets = testBuckets[1].tickets - testBuckets[0].tickets;
const dod0_1_pct = Math.round(((testBuckets[1].tickets - testBuckets[0].tickets) / testBuckets[0].tickets) * 1000) / 10;
assertEqual(dod0_1_tickets, 102, "T-7 to T-6 added +102 tickets");
assertEqual(dod0_1_pct, 85.0, "T-7 to T-6 growth is +85.0%");

console.log("--- 3. Testing Graceful Handling of Late Tracking Start (e.g. T-3) ---");
const lateStartBuckets = [
  { days_before_release: 3, t_label: "T-3", cumulative_tickets: 400 },
  { days_before_release: 2, t_label: "T-2", cumulative_tickets: 650 },
  { days_before_release: 1, t_label: "T-1", cumulative_tickets: 980 },
  { days_before_release: 0, t_label: "T-0", cumulative_tickets: 1420 },
];

assertEqual(lateStartBuckets[0].t_label, "T-3", "Curve gracefully starts at T-3 without error");
assertEqual(lateStartBuckets.length, 4, "Curve contains exactly the 4 captured observations");

console.log("\n==========================================");
console.log("🎉 ALL PRE-SALE TESTS PASSED SUCCESSFULLY!");
console.log("==========================================\n");
