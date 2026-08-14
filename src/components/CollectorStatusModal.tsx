import React, { useState } from "react";
import {
  X,
  Activity,
  Database,
  Clock,
  RefreshCw,
  CheckCircle,
  AlertCircle,
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
              Automated 15-minute background collector worker & Neon PostgreSQL database metrics
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
          {/* Live Active Collection Progress Card */}
          {(status?.is_collecting || status?.active_progress) && (
            <div className="bg-amber-950/30 border border-amber-500/40 p-5 rounded-2xl space-y-3 animate-pulse-subtle">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
                  <span className="text-sm font-bold text-amber-200">
                    Live Collection Run In Progress ({status?.active_progress?.run_id || "Active"})
                  </span>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {status?.active_progress?.status || "RUNNING"}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>
                    Current Movie: <strong className="text-amber-300">{status?.active_progress?.current_movie || "Initializing"}</strong>
                  </span>
                  <span className="font-mono">
                    Sessions: {status?.active_progress?.sessions_completed || 0} / {status?.active_progress?.sessions_found || 0}
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-amber-400 h-2 transition-all duration-300 rounded-full"
                    style={{
                      width: `${
                        status?.active_progress?.sessions_found && status.active_progress.sessions_found > 0
                          ? Math.min(
                              100,
                              Math.round(
                                ((status.active_progress.sessions_completed || 0) /
                                  status.active_progress.sessions_found) *
                                  100
                              )
                            )
                          : 5
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
                    {status?.active_progress?.current_session || "Discovering timetable..."}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400">Success / Failed:</span>
                  <div className="font-mono font-bold mt-0.5">
                    <span className="text-emerald-400">{status?.active_progress?.sessions_successful || 0}</span>
                    <span className="text-slate-500 mx-1">/</span>
                    <span className="text-rose-400">{status?.active_progress?.sessions_failed || 0}</span>
                  </div>
                </div>
                <div>
                  <span className="text-slate-400">Snapshots Created:</span>
                  <div className="font-mono font-bold text-cyan-300 mt-0.5">
                    {status?.active_progress?.snapshots_created || 0}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400">Elapsed Time:</span>
                  <div className="font-mono text-amber-300 mt-0.5">
                    {status?.active_progress?.elapsed_seconds
                      ? `${Math.round(status.active_progress.elapsed_seconds)}s`
                      : "0s"}
                  </div>
                </div>
              </div>

              {status?.active_progress?.last_error && (
                <div className="text-[11px] font-mono text-rose-300 bg-rose-950/40 p-2 rounded border border-rose-800/40 truncate">
                  • Latest error: {status.active_progress.last_error}
                </div>
              )}
            </div>
          )}

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
                  {[5, 15, 30, 60].map((mins) => (
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
                    ? new Date(scheduler.lastRunTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "None yet"}
                </div>
              </div>

              <div>
                <span className="text-slate-400">Next Scheduled:</span>
                <div className="font-semibold text-slate-200 mt-1">
                  {scheduler?.nextRunTime
                    ? new Date(scheduler.nextRunTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "Paused"}
                </div>
              </div>

              <div>
                <span className="text-slate-400">Collector Core:</span>
                <div className="font-mono text-amber-400 font-semibold mt-1">
                  v{scheduler?.collectorVersion || "2.0.0"} (NOS Validated)
                </div>
              </div>
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
