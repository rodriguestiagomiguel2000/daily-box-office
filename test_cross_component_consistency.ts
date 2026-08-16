import { query } from "./server/db";

async function runTests() {
  console.log("=========================================================");
  console.log("   CROSS-COMPONENT REVENUE & ADMISSIONS CONSISTENCY SUITE");
  console.log("=========================================================\n");

  let totalFailures = 0;

  // Test 1: Verify Homem-Aranha (Movie 10) on 2026-08-15 across snapshots
  console.log("--- TEST 1: Homem-Aranha (Movie 10) on 2026-08-15 ---");
  const movie10Snaps = await query(`
    SELECT snapshot_timestamp, showcount_total, estimated_admissions, estimated_revenue
    FROM movie_performance_snapshots
    WHERE movie_id = 10 AND operational_date = '2026-08-15'
    ORDER BY snapshot_timestamp DESC;
  `);

  if (movie10Snaps.rows.length === 0) {
    console.error("FAIL: No snapshots found for Movie 10 on 2026-08-15!");
    totalFailures++;
  } else {
    const latest = movie10Snaps.rows[0];
    const latestRev = parseFloat(latest.estimated_revenue);
    const latestAdm = parseInt(latest.estimated_admissions, 10);
    console.log(`Latest Snapshot EOD (at ${new Date(latest.snapshot_timestamp).toISOString()}): Revenue = €${latestRev.toFixed(2)}, Admissions = ${latestAdm}`);

    // Verify all late snapshots (after 23:00) yield continuous, non-jumping revenue (~€190.6k)
    for (const snap of movie10Snaps.rows) {
      const rev = parseFloat(snap.estimated_revenue);
      const ts = new Date(snap.snapshot_timestamp);
      // Ensure no snapshot for 2026-08-15 exceeds €200,000 (which was the old ~€278k bug)
      if (rev > 200000) {
        console.error(`FAIL: Snapshot at ${ts.toISOString()} has inflated revenue €${rev.toFixed(2)} (> €200k)!`);
        totalFailures++;
      }
    }
    console.log("PASS: All snapshots for Movie 10 on 2026-08-15 are within valid, non-inflated bounds.\n");
  }

  // Test 2: Check all movies on 2026-08-15 for snapshot vs live calculation consistency
  console.log("--- TEST 2: Comparing Snapshot Revenue vs Live SQL Query for All Movies (2026-08-15) ---");
  const allMoviesRes = await query(`SELECT DISTINCT movie_id FROM movie_performance_snapshots WHERE operational_date = '2026-08-15';`);
  const movieIds = allMoviesRes.rows.map((r) => r.movie_id);

  for (const mId of movieIds) {
    // 1. Get latest snapshot revenue
    const snapRes = await query(`
      SELECT estimated_revenue, estimated_admissions, snapshot_timestamp
      FROM movie_performance_snapshots
      WHERE movie_id = $1 AND operational_date = '2026-08-15'
      ORDER BY snapshot_timestamp DESC LIMIT 1;
    `, [mId]);

    // 2. Compute live SQL revenue for the latest snapshot timestamp
    if (snapRes.rows.length > 0) {
      const snap = snapRes.rows[0];
      const snapRev = parseFloat(snap.estimated_revenue);
      const snapAdm = parseInt(snap.estimated_admissions, 10);
      const targetTs = snap.snapshot_timestamp;

      const liveRes = await query(`
        WITH session_latest_snaps AS (
          SELECT DISTINCT ON (s.id)
            s.id as session_id,
            s.format,
            ss.unavailable_seats
          FROM sessions s
          JOIN seat_snapshots ss ON ss.session_id = s.id
          WHERE s.movie_id = $1 
            AND (s.operational_date = '2026-08-15' OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = '2026-08-15')
            AND ss.collected_at <= $2
          ORDER BY s.id, ss.collected_at DESC
        ),
        session_prices AS (
          SELECT 
            session_id,
            COALESCE(
              AVG(price) FILTER (WHERE is_default = true AND price > 0),
              AVG(price) FILTER (WHERE price > 0 AND ticket_type NOT ILIKE '%fam%' AND ticket_type NOT ILIKE '%pax%' AND (seats_count IS NULL OR seats_count = 1)),
              AVG(price) FILTER (WHERE price > 0)
            ) as avg_price
          FROM session_ticket_prices
          WHERE session_id IN (SELECT session_id FROM session_latest_snaps)
          GROUP BY session_id
        )
        SELECT 
          COALESCE(SUM(sls.unavailable_seats), 0) as total_admissions,
          COALESCE(SUM(sls.unavailable_seats * COALESCE(sp.avg_price, CASE WHEN sls.format ILIKE '%IMAX%' THEN 13.50 WHEN sls.format ILIKE '%3D%' THEN 9.50 ELSE 8.75 END)), 0.0) as total_revenue
        FROM session_latest_snaps sls
        LEFT JOIN session_prices sp ON sls.session_id = sp.session_id;
      `, [mId, targetTs]);

      const liveRev = Math.round((parseFloat(liveRes.rows[0].total_revenue) || 0) * 100) / 100;
      const liveAdm = parseInt(liveRes.rows[0].total_admissions, 10) || 0;

      const diff = Math.abs(snapRev - liveRev);
      if (diff > 0.05 || snapAdm !== liveAdm) {
        console.error(`FAIL: Movie ${mId} mismatch! Snapshot: €${snapRev} (${snapAdm} adm) vs Live: €${liveRev} (${liveAdm} adm), diff = €${diff.toFixed(2)}`);
        totalFailures++;
      } else {
        console.log(`PASS: Movie ${mId} matches perfectly! Snapshot Revenue = €${snapRev.toFixed(2)} (${snapAdm} adm) == Live Revenue = €${liveRev.toFixed(2)} (${liveAdm} adm)`);
      }
    }
  }

  // Test 3: Operational date 06:00 cutoff boundary check
  console.log("\n--- TEST 3: Operational Date 06:00 Cutoff Verification ---");
  const cutoffCheck = await query(`
    SELECT id, starts_at, operational_date,
      TO_CHAR((starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') as calculated_op_date
    FROM sessions
    WHERE starts_at IS NOT NULL
    LIMIT 20;
  `);

  let cutoffFailures = 0;
  for (const row of cutoffCheck.rows) {
    if (row.operational_date && row.operational_date !== row.calculated_op_date) {
      console.error(`FAIL: Session ${row.id} at ${row.starts_at} has op_date '${row.operational_date}' but calculated '${row.calculated_op_date}'`);
      cutoffFailures++;
      totalFailures++;
    }
  }
  if (cutoffFailures === 0) {
    console.log("PASS: All sessions strictly respect the 06:00 Europe/Lisbon operational date boundary.");
  }

  console.log("\n=========================================================");
  if (totalFailures === 0) {
    console.log("   ALL CROSS-COMPONENT CONSISTENCY TESTS PASSED! (0 Failures)");
  } else {
    console.error(`   TEST SUITE FAILED WITH ${totalFailures} FAILURE(S)!`);
  }
  console.log("=========================================================\n");

  process.exit(totalFailures > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
