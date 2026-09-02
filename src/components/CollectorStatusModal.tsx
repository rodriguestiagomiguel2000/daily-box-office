import React, { useState } from "react";
import {
  X,
  Activity,
  Database,
  Clock,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Play,
  Pause,
  Server,
  Layers,
  FileText,
} from "lucide-react";
import { CollectorStatusResponse } from "../types";

interface CollectorStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: CollectorStatusResponse | null;
  onTriggerRun: () => void;
  onUpdateConfig: (intervalMinutes?: number, isRunning?: boolean) => void;
  isTriggering: boolean;
}

export const CollectorStatusModal: React.FC<CollectorStatusModalProps> = ({
  isOpen,
  onClose,
  status,
  onTriggerRun,
  onUpdateConfig,
  isTriggering,
}) => {
  const [selectedErrorLog, setSelectedErrorLog] = useState<string[] | null>(null);

  if (!isOpen) return null;

  const scheduler = status?.scheduler;
  const totals = status?.totals || { snapshots: 0, individual_seat_states: 0, transitions_recorded: 0 };
  const recentRuns = status?.recent_runs || [];
  const formatHealth = status?.format_health || [];
  const persistentFailures = formatHealth.filter((f) => f.consecutive_failures >= 6);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div
        id="status-modal-content"
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center space-x-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              <span>Collector Telemetry & Persistent Storage</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Automated 20-minute background collector worker & Neon PostgreSQL database metrics
            </p>
          </div>
          <button
            id="close-status-modal-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Persistent Upstream Format Failure Alert Banner */}
          {persistentFailures.length > 0 && (
            <div
              id="persistent-format-failures-alert"
              className="bg-rose-950/30 border-2 border-rose-500/60 rounded-2xl p-5 space-y-4 shadow-xl shadow-rose-950/30 animate-fade-in"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start space-x-3">
                  <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40 mt-0.5 shrink-0">
                    <AlertTriangle className="w-6 h-6 text-rose-400" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                      <h3 className="text-sm font-bold text-rose-100">
                        Persistent Upstream Schedule Discovery Failure
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono">
                        {persistentFailures.length} format{persistentFailures.length > 1 ? "s" : ""} affected (&ge;6 consecutive runs)
                      </span>
                    </div>
                    <p className="text-xs text-rose-200/90 mt-1 leading-relaxed">
                      The NOS origin server has repeatedly returned HTTP 500 error responses for specific movie format timetable aggregators across consecutive runs. Cache-busting retry was attempted and origin continues to fail. This indicates an invalid or unconfigured schedule aggregator on NOS origin servers, not a transient network timeout.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                {persistentFailures.map((pf) => {
                  const approxHours = ((pf.consecutive_failures * 20) / 60).toFixed(
                    (pf.consecutive_failures * 20) % 60 === 0 ? 0 : 1
                  );
                  return (
                    <div
                      key={pf.format_external_id}
                      className="bg-slate-950/80 border border-rose-500/40 rounded-xl p-4 space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center space-x-2.5 flex-wrap">
                          <span className="font-bold text-rose-200 text-sm">
                            {pf.movie_title}
                          </span>
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-rose-900/60 text-rose-300 border border-rose-700">
                            {approxHours}h+ ({pf.consecutive_failures} consecutive runs)
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono select-all">
                          Format UUID: {pf.format_external_id}
                        </span>
                      </div>

                      <div className="text-xs text-rose-300 font-medium bg-rose-950/40 border border-rose-800/50 rounded-lg p-2.5">
                        &ldquo;{pf.movie_title} has failed schedule discovery for {approxHours}h+ &mdash; likely broken upstream, not a transient error&rdquo;
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-400 pt-1 border-t border-slate-800/80">
                        <div>
                          <span className="text-slate-500">Last Successful Schedule:</span>{" "}
                          <span className="text-slate-300 font-medium">
                            {pf.last_success_at
                              ? new Date(pf.last_success_at).toLocaleString("pt-PT", {
                                  timeZone: "Europe/Lisbon",
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "None recorded"}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Last Failure Attempt:</span>{" "}
                          <span className="text-rose-300 font-medium">
                            {pf.last_failure_at
                              ? new Date(pf.last_failure_at).toLocaleString("pt-PT", {
                                  timeZone: "Europe/Lisbon",
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "Most recent run"}
                          </span>
                        </div>
                      </div>

                      {pf.last_failure_detail && (
                        <div className="bg-slate-900/90 rounded p-2.5 text-[11px] font-mono text-slate-400 border border-slate-800/80 break-words">
                          <span className="text-rose-400 font-semibold">Error Detail:</span> {pf.last_failure_detail}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Live Active Collection Progress Card */}
          {(status?.is_collecting || status?.active_progress) && (() => {
            const progress = status.active_progress;
            const runStatus = (progress?.status || (status.is_collecting ? "RUNNING" : "SUCCESS")).toUpperCase();
            const runId = progress?.run_id || "Active";
            const isRunning = runStatus === "RUNNING";
            const isSuccess = runStatus === "SUCCESS";
            const isPartial = runStatus === "PARTIAL";
            const isFailed = runStatus === "FAILED";

            let cardContainerClass = "bg-amber-950/30 border-amber-500/40 animate-pulse-subtle";
            let headerText = `Live Collection Run In Progress (${runId})`;
            let headerTextColor = "text-amber-200";
            let badgeClass = "bg-amber-500/20 text-amber-300 border-amber-500/30";
            let progressFillClass = "bg-amber-400";
            let HeaderIcon = <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />;

            if (isSuccess) {
              cardContainerClass = "bg-emerald-950/30 border-emerald-500/40";
              headerText = `Run Completed Successfully (${runId})`;
              headerTextColor = "text-emerald-200";
              badgeClass = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
              progressFillClass = "bg-emerald-400";
              HeaderIcon = <CheckCircle className="w-4 h-4 text-emerald-400" />;
            } else if (isPartial) {
              cardContainerClass = "bg-amber-950/20 border-amber-500/50";
              headerText = `Run Completed with Errors (${runId})`;
              headerTextColor = "text-amber-200";
              badgeClass = "bg-amber-500/20 text-amber-300 border-amber-500/30";
              progressFillClass = "bg-amber-500";
              HeaderIcon = <AlertCircle className="w-4 h-4 text-amber-400" />;
            } else if (isFailed) {
              cardContainerClass = "bg-rose-950/30 border-rose-500/40";
              headerText = `Run Failed (${runId})`;
              headerTextColor = "text-rose-200";
              badgeClass = "bg-rose-500/20 text-rose-300 border-rose-500/30";
              progressFillClass = "bg-rose-500";
              HeaderIcon = <AlertCircle className="w-4 h-4 text-rose-400" />;
            }

            return (
              <div className={`p-5 rounded-2xl border space-y-3 ${cardContainerClass}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {HeaderIcon}
                    <span className={`text-sm font-bold ${headerTextColor}`}>
                      {headerText}
                    </span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border ${badgeClass}`}>
                    {runStatus}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>
                      Current Movie: <strong className={isRunning ? "text-amber-300" : isSuccess ? "text-emerald-300" : isFailed ? "text-rose-300" : "text-amber-300"}>{progress?.current_movie || (isRunning ? "Initializing" : "Completed")}</strong>
                    </span>
                    <span className="font-mono">
                      Sessions: {progress?.sessions_completed || 0} / {progress?.sessions_found || 0}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`${progressFillClass} h-2 transition-all duration-300 rounded-full`}
                      style={{
                        width: `${
                          progress?.sessions_found && progress.sessions_found > 0
                            ? Math.min(
                                100,
                                Math.round(
                                  ((progress.sessions_completed || 0) / progress.sessions_found) * 100
                                )
                              )
                            : isRunning
                            ? 5
                            : 100
                        }%`,
                      }}
                    />
                  </div>
                </div>

                {/* Detailed Live Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
                  <div>
                    <span className="text-slate-400">Current Target:</span>
                    <div className="font-medium text-slate-200 truncate mt-0.5">
                      {progress?.current_session || (isRunning ? "Discovering timetable..." : "Finished")}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400">Success / Failed:</span>
                    <div className="font-mono font-bold mt-0.5">
                      <span className="text-emerald-400">{progress?.sessions_successful || 0}</span>
                      <span className="text-slate-500 mx-1">/</span>
                      <span className="text-rose-400">{progress?.sessions_failed || 0}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400">Snapshots Created:</span>
                    <div className="font-mono font-bold text-cyan-300 mt-0.5">
                      {progress?.snapshots_created || 0}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400">Elapsed Time:</span>
                    <div className="font-mono text-amber-300 mt-0.5">
                      {progress?.elapsed_seconds
                        ? `${Math.round(progress.elapsed_seconds)}s`
                        : "0s"}
                    </div>
                  </div>
                </div>

                {progress?.last_error && (
                  <div className="text-[11px] font-mono text-rose-300 bg-rose-950/40 p-2 rounded border border-rose-800/40 truncate">
                    • Latest error: {progress.last_error}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Storage Telemetry Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-800/60 border border-slate-700/60 p-4 rounded-xl">
              <div className="flex items-center space-x-2 text-slate-400 text-xs mb-1">
                <Database className="w-4 h-4 text-emerald-400" />
                <span>Total Seat Snapshots</span>
              </div>
              <div className="text-2xl font-bold text-slate-100">
                {totals.snapshots.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Immutable historical records</div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 p-4 rounded-xl">
              <div className="flex items-center space-x-2 text-slate-400 text-xs mb-1">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>Physical Seat States</span>
              </div>
              <div className="text-2xl font-bold text-cyan-300">
                {totals.individual_seat_states.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Exact row/col state keys</div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 p-4 rounded-xl">
              <div className="flex items-center space-x-2 text-slate-400 text-xs mb-1">
                <Activity className="w-4 h-4 text-amber-400" />
                <span>Recorded Transitions</span>
              </div>
              <div className="text-2xl font-bold text-amber-400">
                {totals.transitions_recorded.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Differential sales proxies</div>
            </div>
          </div>

          {/* Scheduler Controls */}
          <div className="bg-slate-800/40 border border-slate-800 p-5 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>Scheduled Collection Worker</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Periodically queries active OutSystems sessions to snapshot physical seating maps.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  id="toggle-scheduler-btn"
                  onClick={() => onUpdateConfig(undefined, !scheduler?.isRunning)}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    scheduler?.isRunning
                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-300"
                      : "bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-emerald-500/20 hover:text-emerald-300"
                  }`}
                >
                  {scheduler?.isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{scheduler?.isRunning ? "Worker: Active" : "Worker: Paused"}</span>
                </button>

                <button
                  id="modal-trigger-run-btn"
                  onClick={onTriggerRun}
                  disabled={scheduler?.isCollecting || isTriggering}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${scheduler?.isCollecting || isTriggering ? "animate-spin" : ""}`} />
                  <span>{scheduler?.isCollecting || isTriggering ? "Running..." : "Trigger Run Now"}</span>
                </button>
              </div>
            </div>

            {/* Scheduler Status Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2 border-t border-slate-700/50">
              <div>
                <span className="text-slate-400">Interval:</span>
                <div className="flex items-center space-x-1 mt-1">
                  {[5, 15, 20, 30, 60].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => onUpdateConfig(mins)}
                      className={`px-2 py-1 rounded text-xs font-mono font-medium ${
                        scheduler?.intervalMinutes === mins
                          ? "bg-amber-500 text-slate-950 font-bold"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-slate-400">Last Execution:</span>
                <div className="font-semibold text-slate-200 mt-1">
                  {scheduler?.lastRunTime
                    ? new Date(scheduler.lastRunTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" })
                    : "None yet"}
                </div>
              </div>

              <div>
                <span className="text-slate-400">Collector Core:</span>
                <div className="font-mono text-cyan-400 font-semibold mt-1">
                  v{scheduler?.collectorVersion || "2.0.0"} (Render Cron)
                </div>
              </div>
            </div>

            {/* Note about Background Cron Delay */}
            <div className="text-[11px] text-slate-400 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/40 flex items-center space-x-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>
                <strong>Approximate time:</strong> background execution may show a slight delay of a few minutes relative to the exact scheduled time.
              </span>
            </div>
          </div>

          {/* Recent Collection Runs History */}
          <div>
            <h3 className="text-sm font-bold text-slate-200 mb-3 flex items-center space-x-2">
              <Server className="w-4 h-4 text-slate-400" />
              <span>Recent Collection Runs History</span>
            </h3>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800 text-slate-400 uppercase tracking-wider font-semibold sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Run ID / Timestamp</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Attempted</th>
                      <th className="py-2.5 px-3 text-right">Success</th>
                      <th className="py-2.5 px-3 text-right">Failed</th>
                      <th className="py-2.5 px-3 text-right">Snapshots</th>
                      <th className="py-2.5 px-3 text-center">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {recentRuns.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-500">
                          No collection runs recorded yet.
                        </td>
                      </tr>
                    ) : (
                      recentRuns.map((run) => (
                        <tr key={run.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3">
                            <div className="font-mono text-[11px] text-slate-300">{run.run_id}</div>
                            <div className="text-[10px] text-slate-500">
                              {new Date(run.started_at).toLocaleString()}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                run.status === "SUCCESS"
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                  : run.status === "PARTIAL"
                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                  : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                              }`}
                            >
                              {run.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-300">{run.sessions_attempted}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-semibold">{run.sessions_successful}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-rose-400">{run.sessions_failed}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-cyan-300">
                            {run.snapshots_created}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {run.errors && run.errors.length > 0 ? (
                              <button
                                onClick={() => setSelectedErrorLog(run.errors)}
                                className="text-amber-400 hover:text-amber-300 underline font-semibold text-[11px]"
                              >
                                View ({run.errors.length})
                              </button>
                            ) : (
                              <span className="text-emerald-400 text-[11px]">None</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Format Discovery Health Matrix */}
          {formatHealth.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>Format Discovery Health Matrix</span>
                </h3>
                <span className="text-[11px] text-slate-400">
                  Persistent upstream alert threshold: &ge;6 consecutive runs (~2 hours)
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-56">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-800 text-slate-400 uppercase tracking-wider font-semibold sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3">Movie & Format</th>
                        <th className="py-2.5 px-3">Format UUID</th>
                        <th className="py-2.5 px-3 text-center">Status</th>
                        <th className="py-2.5 px-3 text-center">Consecutive Failures</th>
                        <th className="py-2.5 px-3">Last Success (Lisbon)</th>
                        <th className="py-2.5 px-3">Last Failure</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-200">
                      {formatHealth.map((fh) => {
                        const isPersistent = fh.consecutive_failures >= 6;
                        const isTransient = fh.consecutive_failures > 0 && fh.consecutive_failures < 6;
                        return (
                          <tr key={fh.format_external_id} className="hover:bg-slate-800/40">
                            <td className="py-2.5 px-3 font-medium text-slate-200">
                              {fh.movie_title}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400 select-all">
                              {fh.format_external_id}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {isPersistent ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                  BROKEN UPSTREAM
                                </span>
                              ) : isTransient ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  TRANSIENT RETRY
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  HEALTHY
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center font-mono font-bold">
                              <span className={isPersistent ? "text-rose-400" : isTransient ? "text-amber-400" : "text-emerald-400"}>
                                {fh.consecutive_failures}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                              {fh.last_success_at
                                ? new Date(fh.last_success_at).toLocaleString("pt-PT", {
                                    timeZone: "Europe/Lisbon",
                                    day: "2-digit",
                                    month: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "Never"}
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                              {fh.last_failure_at
                                ? new Date(fh.last_failure_at).toLocaleString("pt-PT", {
                                    timeZone: "Europe/Lisbon",
                                    day: "2-digit",
                                    month: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "None"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Modal for Error Log Detail if clicked */}
          {selectedErrorLog && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400 flex items-center space-x-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  <span>Run Error Log Details</span>
                </span>
                <button
                  onClick={() => setSelectedErrorLog(null)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Close Log
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1 bg-slate-900 p-2.5 rounded">
                {selectedErrorLog.map((err, i) => (
                  <div key={i} className="text-rose-300">
                    • {err}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex justify-end">
          <button
            id="close-status-bottom-btn"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
