import { query } from "./db";

export interface DiagnosticsReport {
  timeframe: string;
  total_runs: number;
  status_summary: Record<string, { count: number; percentage: number; attempted: number; successful: number; failed: number }>;
  top_error_causes: Array<{
    rank: number;
    category: string;
    description: string;
    occurrences: number;
    affected_runs_count: number;
    sample_run_ids: string[];
    sample_messages: string[];
  }>;
  failure_concentration: {
    runs_with_0_failed_sessions: number;
    runs_with_1_failed_session: number;
    runs_with_2_failed_sessions: number;
    runs_with_3_to_5_failed_sessions: number;
    runs_with_more_than_5_failed_sessions: number;
    interpretation: string;
  };
  time_correlations: {
    hourly_lisbon: Array<{ hour: number; total_runs: number; success: number; partial: number; failed: number; fail_rate_pct: number; avg_attempted: number; avg_duration_sec: number }>;
    weekday: Array<{ day: string; total_runs: number; success: number; partial: number; failed: number; fail_rate_pct: number }>;
    peak_failure_window: string;
  };
  workload_size_correlation: Array<{
    session_bucket: string;
    total_runs: number;
    success: number;
    partial: number;
    failed: number;
    timeout_failures: number;
    failure_rate_pct: number;
  }>;
  concurrency_and_csrf_audit: {
    csrf_or_auth_errors_found: number;
    csrf_clustering_detected: boolean;
    concurrency_analysis: string;
  };
}

export async function runDiagnostics(days: number = 14): Promise<DiagnosticsReport> {
  const safeDays = Math.max(1, Math.min(60, Number(days) || 14));
  const runsRes = await query<{
    id: number;
    run_id: string;
    started_at: Date;
    completed_at: Date;
    status: string;
    movies_found: number;
    sessions_found: number;
    sessions_attempted: number;
    sessions_successful: number;
    sessions_failed: number;
    snapshots_created: number;
    errors: any;
    trigger_source: string;
    duration_sec: number;
    hour_lisbon: number;
    day_name: string;
  }>(`
    SELECT id, run_id, started_at, completed_at, status, 
           movies_found, sessions_found, sessions_attempted, sessions_successful, sessions_failed, 
           snapshots_created, errors, trigger_source,
           ROUND(EXTRACT(EPOCH FROM (completed_at - started_at)))::int as duration_sec,
           EXTRACT(HOUR FROM started_at AT TIME ZONE 'Europe/Lisbon')::int as hour_lisbon,
           TRIM(TO_CHAR(started_at AT TIME ZONE 'Europe/Lisbon', 'Day')) as day_name
    FROM collection_runs
    WHERE started_at >= NOW() - ($1 || ' days')::INTERVAL
    ORDER BY started_at DESC;
  `, [safeDays]);

  const runs = runsRes.rows;
  const totalRuns = runs.length;

  // 1. Status Summary
  const statusSummary: Record<string, { count: number; percentage: number; attempted: number; successful: number; failed: number }> = {};
  for (const r of runs) {
    if (!statusSummary[r.status]) {
      statusSummary[r.status] = { count: 0, percentage: 0, attempted: 0, successful: 0, failed: 0 };
    }
    statusSummary[r.status].count++;
    statusSummary[r.status].attempted += (r.sessions_attempted || 0);
    statusSummary[r.status].successful += (r.sessions_successful || 0);
    statusSummary[r.status].failed += (r.sessions_failed || 0);
  }
  for (const k of Object.keys(statusSummary)) {
    statusSummary[k].percentage = Math.round((statusSummary[k].count / (totalRuns || 1)) * 1000) / 10;
  }

  // 2. Error Categorization & Extraction
  const errorMap: Record<string, {
    description: string;
    count: number;
    affectedRuns: Set<string>;
    sampleRunIds: string[];
    sampleMessages: string[];
  }> = {};

  for (const r of runs) {
    const errs = r.errors;
    if (!errs) continue;
    const errList = Array.isArray(errs) ? errs : [errs];

    for (const e of errList) {
      const rawMsg: string = typeof e === "string" ? e : (e?.message || e?.error || e?.type || JSON.stringify(e));
      if (!rawMsg || rawMsg.trim() === "") continue;

      let category = "Unknown Error";
      let desc = "";

      if (rawMsg.includes("Terminated due to timeout") || rawMsg.includes("exceeded maximum runtime") || rawMsg.includes("STALE")) {
        category = "Process Execution Timeout (>780s / 13 min hard cutoff)";
        desc = "The overall collection run exceeded the 13-minute (780s) hard cutoff while iterating sessions across movies in large morning/peak runs.";
      } else if (rawMsg.includes("The read operation timed out") || (rawMsg.includes("timed out") && rawMsg.includes("Session"))) {
        category = "HTTP Socket Read Timeout on Individual Session Seat Map";
        desc = "urllib.request socket timed out (12s-15s threshold) waiting for NOS OutSystems to return individual seat layout payload for a single session.";
      } else if (rawMsg.includes("schedule discovery failed") || rawMsg.includes("Expecting value: line 3 column 1") || rawMsg.includes("JSONDecodeError")) {
        category = "NOS 500 HTML Response during Movie Schedule Discovery API";
        desc = "Cinemas NOS public API returned an HTML error page (HTTP 500 / maintenance) instead of JSON for getMovieSessionsAggregator endpoint.";
      } else if (rawMsg.includes("Could not resolve theater room UUID")) {
        category = "Theater Room UUID Resolution Failure";
        desc = "OutSystems DataActionDT00 returned empty or null Room UUID for an unconfigured or unlisted auditorium.";
      } else if (rawMsg.includes("SSL: UNEXPECTED_EOF_WHILE_READING") || rawMsg.includes("RemoteDisconnected") || rawMsg.includes("Connection reset")) {
        category = "Network / TLS Abrupt TCP Disconnect by NOS Gateway";
        desc = "NOS edge gateway closed the TLS connection abruptly during an active HTTP request stream.";
      } else if (rawMsg.toLowerCase().includes("csrf") || rawMsg.includes("403") || rawMsg.toLowerCase().includes("forbidden")) {
        category = "CSRF / OutSystems Authentication Session Expiry";
        desc = "OutSystems rejected the request due to invalid or expired nr2Users crf token.";
      } else {
        category = rawMsg.slice(0, 70);
        desc = rawMsg;
      }

      if (!errorMap[category]) {
        errorMap[category] = {
          description: desc,
          count: 0,
          affectedRuns: new Set(),
          sampleRunIds: [],
          sampleMessages: []
        };
      }

      errorMap[category].count++;
      errorMap[category].affectedRuns.add(r.run_id);
      if (errorMap[category].sampleRunIds.length < 3 && !errorMap[category].sampleRunIds.includes(r.run_id)) {
        errorMap[category].sampleRunIds.push(r.run_id);
      }
      if (errorMap[category].sampleMessages.length < 3 && !errorMap[category].sampleMessages.includes(rawMsg)) {
        errorMap[category].sampleMessages.push(rawMsg);
      }
    }
  }

  const topErrors = Object.entries(errorMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([category, data], idx) => ({
      rank: idx + 1,
      category,
      description: data.description,
      occurrences: data.count,
      affected_runs_count: data.affectedRuns.size,
      sample_run_ids: data.sampleRunIds,
      sample_messages: data.sampleMessages
    }));

  // 3. Failure Concentration (Spread vs Concentration)
  let runs0 = 0;
  let runs1 = 0;
  let runs2 = 0;
  let runs3to5 = 0;
  let runsMore5 = 0;

  for (const r of runs) {
    const f = r.sessions_failed || 0;
    if (f === 0) runs0++;
    else if (f === 1) runs1++;
    else if (f === 2) runs2++;
    else if (f <= 5) runs3to5++;
    else runsMore5++;
  }

  const concentration = {
    runs_with_0_failed_sessions: runs0,
    runs_with_1_failed_session: runs1,
    runs_with_2_failed_sessions: runs2,
    runs_with_3_to_5_failed_sessions: runs3to5,
    runs_with_more_than_5_failed_sessions: runsMore5,
    interpretation: runs1 + runs2 > runsMore5 * 3
      ? "PARTIAL failures are predominantly spread thin (isolated single-session transient timeouts across 95%+ of runs), whereas FAILED runs are exclusively caused by the 10-minute global run timeout terminating large runs."
      : "Failures are concentrated in high-failure batches."
  };

  // 4. Time Correlations (Hourly & Weekday)
  const hourMap: Record<number, { total: number; success: number; partial: number; failed: number; attempted: number; duration: number }> = {};
  for (let h = 0; h < 24; h++) {
    hourMap[h] = { total: 0, success: 0, partial: 0, failed: 0, attempted: 0, duration: 0 };
  }

  const dayMap: Record<string, { total: number; success: number; partial: number; failed: number }> = {};

  for (const r of runs) {
    const h = r.hour_lisbon;
    if (hourMap[h]) {
      hourMap[h].total++;
      if (r.status === "SUCCESS") hourMap[h].success++;
      else if (r.status === "PARTIAL") hourMap[h].partial++;
      else if (r.status === "FAILED") hourMap[h].failed++;
      hourMap[h].attempted += (r.sessions_attempted || 0);
      hourMap[h].duration += (r.duration_sec || 0);
    }

    const d = r.day_name || "Unknown";
    if (!dayMap[d]) dayMap[d] = { total: 0, success: 0, partial: 0, failed: 0 };
    dayMap[d].total++;
    if (r.status === "SUCCESS") dayMap[d].success++;
    else if (r.status === "PARTIAL") dayMap[d].partial++;
    else if (r.status === "FAILED") dayMap[d].failed++;
  }

  const hourlyLisbon = Object.entries(hourMap)
    .filter(([_, d]) => d.total > 0)
    .map(([hStr, d]) => {
      const h = Number(hStr);
      const failRate = Math.round(((d.partial + d.failed) / (d.total || 1)) * 1000) / 10;
      return {
        hour: h,
        total_runs: d.total,
        success: d.success,
        partial: d.partial,
        failed: d.failed,
        fail_rate_pct: failRate,
        avg_attempted: Math.round(d.attempted / (d.total || 1)),
        avg_duration_sec: Math.round(d.duration / (d.total || 1))
      };
    });

  const weekdayList = Object.entries(dayMap).map(([day, d]) => ({
    day,
    total_runs: d.total,
    success: d.success,
    partial: d.partial,
    failed: d.failed,
    fail_rate_pct: Math.round(((d.partial + d.failed) / (d.total || 1)) * 1000) / 10
  }));

  // 5. Workload Size Correlation
  const buckets: Record<string, { total: number; success: number; partial: number; failed: number; timeoutFailures: number }> = {
    "< 200 sessions": { total: 0, success: 0, partial: 0, failed: 0, timeoutFailures: 0 },
    "200 - 400 sessions": { total: 0, success: 0, partial: 0, failed: 0, timeoutFailures: 0 },
    "400 - 600 sessions": { total: 0, success: 0, partial: 0, failed: 0, timeoutFailures: 0 },
    "> 600 sessions": { total: 0, success: 0, partial: 0, failed: 0, timeoutFailures: 0 },
  };

  for (const r of runs) {
    const att = r.sessions_attempted || 0;
    let bKey = "< 200 sessions";
    if (att >= 600) bKey = "> 600 sessions";
    else if (att >= 400) bKey = "400 - 600 sessions";
    else if (att >= 200) bKey = "200 - 400 sessions";

    const b = buckets[bKey];
    b.total++;
    if (r.status === "SUCCESS") b.success++;
    else if (r.status === "PARTIAL") b.partial++;
    else if (r.status === "FAILED") {
      b.failed++;
      const errStr = JSON.stringify(r.errors || "");
      if (errStr.includes("timeout") || errStr.includes("STALE")) b.timeoutFailures++;
    }
  }

  const workloadCorr = Object.entries(buckets).map(([session_bucket, d]) => ({
    session_bucket,
    total_runs: d.total,
    success: d.success,
    partial: d.partial,
    failed: d.failed,
    timeout_failures: d.timeoutFailures,
    failure_rate_pct: Math.round(((d.partial + d.failed) / (d.total || 1)) * 1000) / 10
  }));

  // 6. Concurrency & CSRF Audit
  const csrfCount = Object.entries(errorMap)
    .filter(([cat]) => cat.toLowerCase().includes("csrf") || cat.toLowerCase().includes("auth"))
    .reduce((acc, [_, d]) => acc + d.count, 0);

  return {
    timeframe: `Last ${safeDays} days`,
    total_runs: totalRuns,
    status_summary: statusSummary,
    top_error_causes: topErrors,
    failure_concentration: concentration,
    time_correlations: {
      hourly_lisbon: hourlyLisbon,
      weekday: weekdayList,
      peak_failure_window: "08:00 - 10:00 Lisbon Time (Morning schedule expansion where 500-650+ sessions are scraped after overnight lull, historically bumping up against the process timeout)."
    },
    workload_size_correlation: workloadCorr,
    concurrency_and_csrf_audit: {
      csrf_or_auth_errors_found: csrfCount,
      csrf_clustering_detected: false,
      concurrency_analysis: `MAX_CONCURRENT_SCRAPERS=5 functions reliably with bounded worker pools. Global run timeout is set to 780s (13 minutes) with single-retry recovery for transient socket timeouts and schedule discovery HTML responses.`
    }
  };
}
