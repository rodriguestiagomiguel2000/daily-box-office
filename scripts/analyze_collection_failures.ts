import { runDiagnostics } from "../server/diagnostics";

// Standalone execution
const isMain = process.argv[1]?.includes("analyze_collection_failures");
if (isMain) {
  const days = process.argv[2] ? parseInt(process.argv[2], 10) : 14;
  runDiagnostics(days).then((report) => {
    console.log("\n==========================================================================================");
    console.log(`COLLECTION RUNS ROOT CAUSE DIAGNOSTIC REPORT (${report.timeframe})`);
    console.log("==========================================================================================");
    console.log(`Total Runs Analyzed: ${report.total_runs}`);
    console.log("Status Breakdown:");
    for (const [s, data] of Object.entries(report.status_summary)) {
      console.log(`  - ${s.padEnd(8)}: ${data.count} runs (${data.percentage}%) | Attempted: ${data.attempted} | Successful: ${data.successful} | Failed: ${data.failed}`);
    }

    console.log("\n------------------------------------------------------------------------------------------");
    console.log("TOP 5 DISTINCT ERROR CAUSES BY FREQUENCY");
    console.log("------------------------------------------------------------------------------------------");
    for (const err of report.top_error_causes) {
      console.log(`\n#${err.rank} [${err.occurrences} occurrences across ${err.affected_runs_count} runs] ${err.category}`);
      console.log(`   Description: ${err.description}`);
      console.log(`   Sample Run IDs: ${err.sample_run_ids.join(", ")}`);
      console.log(`   Sample Error Message: ${err.sample_messages[0] || "N/A"}`);
    }

    console.log("\n------------------------------------------------------------------------------------------");
    console.log("FAILURE CONCENTRATION & SPREAD");
    console.log("------------------------------------------------------------------------------------------");
    console.log(`Runs with 0 failed sessions: ${report.failure_concentration.runs_with_0_failed_sessions}`);
    console.log(`Runs with 1 failed session:  ${report.failure_concentration.runs_with_1_failed_session}`);
    console.log(`Runs with 2 failed sessions: ${report.failure_concentration.runs_with_2_failed_sessions}`);
    console.log(`Runs with 3-5 failed:        ${report.failure_concentration.runs_with_3_to_5_failed_sessions}`);
    console.log(`Runs with >5 failed:         ${report.failure_concentration.runs_with_more_than_5_failed_sessions}`);
    console.log(`Finding: ${report.failure_concentration.interpretation}`);

    console.log("\n------------------------------------------------------------------------------------------");
    console.log("WORKLOAD SIZE VS RUN FAILURE / TIMEOUT");
    console.log("------------------------------------------------------------------------------------------");
    for (const b of report.workload_size_correlation) {
      console.log(`  - ${b.session_bucket.padEnd(20)}: ${b.total_runs} runs | Success: ${b.success}, Partial: ${b.partial}, Failed: ${b.failed} (Timeouts: ${b.timeout_failures}) -> Issue Rate: ${b.failure_rate_pct}%`);
    }

    console.log("\n------------------------------------------------------------------------------------------");
    console.log("CONCURRENCY & CSRF AUDIT");
    console.log("------------------------------------------------------------------------------------------");
    console.log(`CSRF / Auth Errors in Database: ${report.concurrency_and_csrf_audit.csrf_or_auth_errors_found}`);
    console.log(`CSRF Clustering Detected:      ${report.concurrency_and_csrf_audit.csrf_clustering_detected}`);
    console.log(`Summary: ${report.concurrency_and_csrf_audit.concurrency_analysis}`);
    console.log("==========================================================================================\n");
    process.exit(0);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
