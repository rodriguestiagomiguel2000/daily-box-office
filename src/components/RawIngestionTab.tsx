import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Database,
  FileSpreadsheet,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Search,
  Eye,
  Copy,
  Check,
  ExternalLink,
  Layers,
  Sparkles,
  DownloadCloud,
  ChevronRight,
  X,
  TrendingUp,
  Ticket,
  Film,
  Building2,
  Calendar,
  AlertCircle,
  Sliders
} from "lucide-react";
import { RawIngestionLog, CalibrationFactorsResponse } from "../types";
import { fetchJson } from "../utils/api";

interface RawIngestionTabProps {
  onTriggerNosRun?: () => void;
  isNosCollecting?: boolean;
}

export const RawIngestionTab: React.FC<RawIngestionTabProps> = ({
  onTriggerNosRun,
  isNosCollecting = false,
}) => {
  const [logs, setLogs] = useState<RawIngestionLog[]>([]);
  const [calibrationData, setCalibrationData] = useState<CalibrationFactorsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isTriggeringIca, setIsTriggeringIca] = useState<boolean>(false);
  const [selectedLog, setSelectedLog] = useState<RawIngestionLog | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "ICA" | "NOS">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "SUCCESS" | "FAILED">("ALL");
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Fetch raw ingestion logs from GET /api/ingestion/raw-logs and calibration factors
  const fetchLogs = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const [data, calData] = await Promise.all([
        fetchJson<RawIngestionLog[]>("/api/ingestion/raw-logs"),
        fetchJson<CalibrationFactorsResponse>("/api/calibration/factors").catch(() => null)
      ]);

      setLogs(Array.isArray(data) ? data : []);
      if (calData) {
        setCalibrationData(calData);
      }
    } catch (err: any) {
      console.error("Failed to load raw ingestion logs:", err);
      setActionMessage({
        text: `Error loading ingestion logs: ${err.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
      if (manual) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(false);
  }, [fetchLogs]);

  // Trigger manual ICA ingestion run
  const handleTriggerIcaIngestion = async () => {
    setIsTriggeringIca(true);
    setActionMessage(null);
    try {
      const data = await fetchJson<{ success?: boolean; message?: string; error?: string }>("/api/ingestion/trigger-ica", { method: "POST" });
      if (data?.success) {
        setActionMessage({
          text: data.message || "Official ICA report successfully downloaded, parsed, and logged!",
          type: "success",
        });
        await fetchLogs(true);
      } else {
        throw new Error(data?.error || "Failed to trigger ICA ingestion");
      }
    } catch (err: any) {
      setActionMessage({
        text: `ICA Ingestion failed: ${err.message}`,
        type: "error",
      });
    } finally {
      setIsTriggeringIca(false);
    }
  };

  // Copy raw details JSON to clipboard
  const handleCopyJson = (payload: any) => {
    try {
      navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } catch (e) {
      console.error("Failed to copy JSON:", e);
    }
  };

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (sourceFilter !== "ALL" && log.source !== sourceFilter) return false;
      if (statusFilter !== "ALL") {
        if (statusFilter === "SUCCESS" && log.status !== "SUCCESS") return false;
        if (statusFilter === "FAILED" && log.status === "SUCCESS") return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesFile = log.fileName.toLowerCase().includes(query);
        const matchesSource = log.source.toLowerCase().includes(query);
        const matchesId = log.id.toLowerCase().includes(query);
        const matchesDetails = JSON.stringify(log.rawDetails).toLowerCase().includes(query);
        return matchesFile || matchesSource || matchesId || matchesDetails;
      }
      return true;
    });
  }, [logs, sourceFilter, statusFilter, searchQuery]);

  // Derived Metrics
  const totalIngestions = logs.length;
  const totalRawRecords = logs.reduce((acc, l) => acc + (l.recordCount || 0), 0);
  const successfulCount = logs.filter((l) => l.status === "SUCCESS").length;
  const successRate = totalIngestions > 0 ? Math.round((successfulCount / totalIngestions) * 100) : 100;
  const lastRunTime = logs.length > 0 ? logs[0].collectedAt : null;

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header and Action Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Raw Ingested Data
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Raw Logs & Telemetry
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Visual confirmation and audit trail for raw official ICA Excel files and NOS seat matrix collections.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            id="refresh-raw-logs-btn"
            onClick={() => fetchLogs(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 border border-slate-700 text-xs sm:text-sm font-medium text-slate-200 transition active:scale-95 disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 text-emerald-400 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Refresh Data</span>
          </button>

          <button
            id="trigger-ica-ingest-btn"
            onClick={handleTriggerIcaIngestion}
            disabled={isTriggeringIca}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs sm:text-sm font-semibold transition active:scale-95 disabled:opacity-60 shadow-md shadow-emerald-950/40"
          >
            <FileSpreadsheet className={`w-4 h-4 ${isTriggeringIca ? "animate-spin" : ""}`} />
            <span>{isTriggeringIca ? "Ingesting ICA..." : "Ingest ICA Report"}</span>
          </button>

          {onTriggerNosRun && (
            <button
              id="trigger-nos-ingest-btn"
              onClick={onTriggerNosRun}
              disabled={isNosCollecting}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-semibold transition active:scale-95 disabled:opacity-60 shadow-md shadow-amber-950/40"
            >
              <Activity className={`w-4 h-4 ${isNosCollecting ? "animate-spin" : ""}`} />
              <span>{isNosCollecting ? "Collecting NOS..." : "Run NOS Sweep"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div
          className={`py-2.5 px-4 rounded-lg text-xs sm:text-sm flex items-center justify-between gap-3 border ${
            actionMessage.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-rose-500/10 border-rose-500/30 text-rose-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Metrics Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Ingestions */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Ingestions</span>
            <div className="text-2xl font-bold text-slate-100 font-mono mt-1">{totalIngestions}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">ICA reports + NOS sweeps</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        {/* Last Run Time */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Last Run Time</span>
            <div className="text-sm font-bold text-slate-100 font-mono mt-1 truncate max-w-[170px]" title={lastRunTime || "N/A"}>
              {lastRunTime
                ? new Date(lastRunTime).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }) +
                  " " +
                  new Date(lastRunTime).toLocaleDateString([], { month: "short", day: "numeric" })
                : "No runs yet"}
            </div>
            <div className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Live Pipeline Active
            </div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* Total Raw Records */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Raw Records</span>
            <div className="text-2xl font-bold text-emerald-400 font-mono mt-1">
              {totalRawRecords.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Seats & official chart entries</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Database className="w-5 h-5" />
          </div>
        </div>

        {/* Success Rate */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Success Rate</span>
            <div className="text-2xl font-bold text-slate-100 font-mono mt-1">{successRate}%</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {successfulCount} / {totalIngestions} runs successful
            </div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Dynamic Empirical Calibration Factors Block */}
      <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Empirical Price Calibration Factors (Gamma Correction)
              </h3>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                Active in Revenue CTE
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Derived weekly from ICA official box office benchmarks with EMA smoothing (α={(calibrationData?.emaAlpha ?? 0.70).toFixed(2)}, clipped [{(calibrationData?.clipMin ?? 0.50).toFixed(2)}, {(calibrationData?.clipMax ?? 1.30).toFixed(2)}]). Automatically corrects standard-rate overestimation on family/discounted titles.
            </p>
          </div>

          <button
            onClick={() => fetchLogs(true)}
            className="text-xs text-slate-400 hover:text-emerald-300 transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Reload Gammas</span>
          </button>
        </div>

        {/* Category Baselines */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {/* Family / Animation */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">Family / Animation</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Category
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-xl font-bold font-mono text-emerald-400">
                {calibrationData?.categoryFactors?.FAMILY?.gamma !== undefined
                  ? Number(calibrationData.categoryFactors.FAMILY.gamma).toFixed(3)
                  : "0.850"}×
              </span>
              <span className="text-[11px] text-slate-500">
                ({calibrationData?.categoryFactors?.FAMILY?.sample_count ?? 0} samples)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Compensates child/family discount concessions (~15% below standard).
            </p>
          </div>

          {/* Action / General */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">Action / General</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Category
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-xl font-bold font-mono text-emerald-400">
                {calibrationData?.categoryFactors?.ACTION_GENERAL?.gamma !== undefined
                  ? Number(calibrationData.categoryFactors.ACTION_GENERAL.gamma).toFixed(3)
                  : "0.920"}×
              </span>
              <span className="text-[11px] text-slate-500">
                ({calibrationData?.categoryFactors?.ACTION_GENERAL?.sample_count ?? 0} samples)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Standard blockbusters, premium formats, and evening admissions.
            </p>
          </div>

          {/* Drama / Adult */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">Drama / Adult</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                Category
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-xl font-bold font-mono text-emerald-400">
                {calibrationData?.categoryFactors?.DRAMA_ADULT?.gamma !== undefined
                  ? Number(calibrationData.categoryFactors.DRAMA_ADULT.gamma).toFixed(3)
                  : "0.940"}×
              </span>
              <span className="text-[11px] text-slate-500">
                ({calibrationData?.categoryFactors?.DRAMA_ADULT?.sample_count ?? 0} samples)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Senior tickets, mature demographics, and specialized screenings.
            </p>
          </div>
        </div>

        {/* Movie-Specific Calibrations (if present) */}
        {calibrationData?.movieFactors && calibrationData.movieFactors.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-800/60">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">
                Individual Movie Gammas ({calibrationData.movieFactors.length} titles calibrated)
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {calibrationData.movieFactors.map((mf) => (
                <div key={mf.movieId} className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                  <div className="truncate pr-2">
                    <span className="text-xs font-medium text-white truncate block">
                      {mf.movieTitle}
                      <span className="text-[10px] text-slate-500 font-mono font-normal ml-1">#{mf.movieId}</span>
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {mf.category} • {mf.sampleCount} {mf.sampleCount === 1 ? "update" : "updates"}
                    </span>
                  </div>
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                    {Number(mf.gamma).toFixed(3)}×
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="search-raw-logs-input"
            type="text"
            placeholder="Search by file name, source, details, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {/* Source Selector */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setSourceFilter("ALL")}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                sourceFilter === "ALL" ? "bg-slate-800 text-slate-100 shadow-sm" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              All Sources
            </button>
            <button
              onClick={() => setSourceFilter("ICA")}
              className={`px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1 ${
                sourceFilter === "ICA" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <FileSpreadsheet className="w-3 h-3 text-emerald-400" />
              ICA
            </button>
            <button
              onClick={() => setSourceFilter("NOS")}
              className={`px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1 ${
                sourceFilter === "NOS" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Activity className="w-3 h-3 text-amber-400" />
              NOS
            </button>
          </div>

          {/* Status Selector */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                statusFilter === "ALL" ? "bg-slate-800 text-slate-100 shadow-sm" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              All Status
            </button>
            <button
              onClick={() => setStatusFilter("SUCCESS")}
              className={`px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1 ${
                statusFilter === "SUCCESS" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Success
            </button>
            <button
              onClick={() => setStatusFilter("FAILED")}
              className={`px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1 ${
                statusFilter === "FAILED" ? "bg-rose-500/20 text-rose-300" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Failed
            </button>
          </div>
        </div>
      </div>

      {/* Main Ingestion Data Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-semibold uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">File / Origin</th>
                <th className="py-3 px-4 text-right">Records Ingested</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                      <span>Loading raw ingestion logs from database...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Database className="w-8 h-8 text-slate-600" />
                      <span className="font-medium text-slate-300">No raw ingestion logs match your filters.</span>
                      <span className="text-xs text-slate-500">
                        Click &quot;Ingest ICA Report&quot; or &quot;Run NOS Sweep&quot; above to capture raw telemetry.
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isIca = log.source === "ICA";
                  const isSuccess = log.status === "SUCCESS";
                  const isPending = log.status === "PENDING";
                  const formattedTime = new Date(log.collectedAt).toLocaleString([], {
                    year: "numeric",
                    month: "short",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="hover:bg-slate-800/40 cursor-pointer transition group"
                    >
                      {/* Source */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide flex items-center gap-1.5 border ${
                              isIca
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                            }`}
                          >
                            {isIca ? <FileSpreadsheet className="w-3.5 h-3.5" /> : <Activity className="w-3.5 h-3.5" />}
                            {log.source}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono hidden xl:inline">
                            {isIca ? "Official Excel" : "Seat Matrix"}
                          </span>
                        </div>
                      </td>

                      {/* Timestamp */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-slate-300">
                        {formattedTime}
                      </td>

                      {/* File/Origin */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 max-w-[280px] sm:max-w-md truncate">
                          <span className="font-mono text-xs text-slate-200 truncate" title={log.fileName}>
                            {log.fileName}
                          </span>
                        </div>
                      </td>

                      {/* Records Ingested */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span className="font-mono font-semibold text-emerald-400">
                          {log.recordCount.toLocaleString()}
                        </span>
                        <span className="text-[11px] text-slate-500 ml-1">
                          {isIca ? "movies" : "records"}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                            isSuccess
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : isPending
                              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                              : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                          }`}
                        >
                          {isSuccess ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          ) : isPending ? (
                            <Clock className="w-3 h-3 text-amber-400" />
                          ) : (
                            <XCircle className="w-3 h-3 text-rose-400" />
                          )}
                          {log.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition group-hover:border-amber-500/40"
                        >
                          <Eye className="w-3.5 h-3.5 text-amber-400" />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Inspection Panel / Drawer */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-sm flex justify-end animate-fadeIn">
          <div
            className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 shadow-2xl h-full flex flex-col text-slate-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div className="flex items-center gap-2.5">
                <span
                  className={`p-2 rounded-lg border ${
                    selectedLog.source === "ICA"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  }`}
                >
                  {selectedLog.source === "ICA" ? (
                    <FileSpreadsheet className="w-5 h-5" />
                  ) : (
                    <Activity className="w-5 h-5" />
                  )}
                </span>
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    {selectedLog.source === "ICA" ? "ICA Official Box Office Report" : "NOS Live Seat Matrix Snapshot"}
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold uppercase ${
                        selectedLog.status === "SUCCESS"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-rose-500/20 text-rose-300"
                      }`}
                    >
                      {selectedLog.status}
                    </span>
                  </h3>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">ID: {selectedLog.id}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopyJson(selectedLog.rawDetails)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition"
                  title="Copy JSON Payload"
                >
                  {copiedJson ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Metadata Card */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Collected At</span>
                  <span className="font-mono text-slate-200 font-medium">
                    {new Date(selectedLog.collectedAt).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">File / Origin</span>
                  <span className="font-mono text-slate-200 font-medium truncate block" title={selectedLog.fileName}>
                    {selectedLog.fileName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Total Records</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {selectedLog.recordCount.toLocaleString()} {selectedLog.source === "ICA" ? "movies" : "records"}
                  </span>
                </div>
              </div>

              {/* ICA Specific Structured Overview */}
              {selectedLog.source === "ICA" && selectedLog.rawDetails?.movies && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Film className="w-4 h-4 text-emerald-400" />
                      Parsed Official Chart Titles ({selectedLog.rawDetails.movies.length})
                    </h4>
                    {selectedLog.rawDetails.overall_average_ticket_price && (
                      <span className="text-xs text-amber-400 font-mono">
                        Official Overall ATP: <strong>€{selectedLog.rawDetails.overall_average_ticket_price}</strong>
                      </span>
                    )}
                  </div>

                  <div className="border border-slate-800 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[11px] uppercase sticky top-0">
                        <tr>
                          <th className="py-2 px-3">#</th>
                          <th className="py-2 px-3">Title</th>
                          <th className="py-2 px-3 text-right">Weekly Gross (€)</th>
                          <th className="py-2 px-3 text-right">Admissions</th>
                          <th className="py-2 px-3 text-right">ATP (€)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 font-mono">
                        {selectedLog.rawDetails.movies.map((m: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="py-2 px-3 text-slate-500 font-bold">{m.rank || idx + 1}</td>
                            <td className="py-2 px-3 font-sans text-slate-200 font-medium">
                              {m.title}
                              {m.distributor && (
                                <span className="block text-[10px] font-sans text-slate-500">
                                  {m.distributor}
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-emerald-400">
                              €{Number(m.weekly_gross_revenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-300">
                              {Number(m.weekly_admissions || 0).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right text-amber-400 font-bold">
                              €{Number(m.atp || 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* NOS Specific Structured Overview */}
              {selectedLog.source === "NOS" && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-amber-400" />
                    Collection Run Telemetry Breakdown
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">Movies Found</span>
                      <span className="text-white font-bold">{selectedLog.rawDetails?.movies_found ?? 0}</span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">Sessions Found</span>
                      <span className="text-white font-bold">{selectedLog.rawDetails?.sessions_found ?? 0}</span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">Successful</span>
                      <span className="text-emerald-400 font-bold">
                        {selectedLog.rawDetails?.sessions_successful ?? 0}
                      </span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">Snapshots</span>
                      <span className="text-amber-400 font-bold">
                        {selectedLog.rawDetails?.snapshots_created ?? selectedLog.recordCount}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Raw JSON Payload Viewer */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-cyan-400" />
                    Raw JSON Payload
                  </h4>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {JSON.stringify(selectedLog.rawDetails).length.toLocaleString()} bytes
                  </span>
                </div>
                <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-96 leading-relaxed selection:bg-emerald-500 selection:text-slate-950">
                  {JSON.stringify(selectedLog.rawDetails, null, 2)}
                </pre>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400">
              <span>Portugal Theatrical Box Office • Real Ingestions</span>
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
