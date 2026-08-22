import React, { useState, useEffect, useCallback } from "react";
import {
  Clock,
  Calendar,
  BarChart3,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Euro,
  Ticket,
  AlertCircle,
  RefreshCw,
  GitCompare,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { HourlyBreakdownResponse, HourlyBucketItem } from "../types";

interface HourlyBreakdownViewProps {
  movieId: number;
  movieTitle: string;
  historyDates: string[];
  defaultDate: string;
}

export const HourlyBreakdownView: React.FC<HourlyBreakdownViewProps> = ({
  movieId,
  movieTitle,
  historyDates,
  defaultDate,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(defaultDate);
  const [compareDate, setCompareDate] = useState<string>("");
  const [chartMetric, setChartMetric] = useState<"tickets" | "revenue">("tickets");
  const [viewMode, setViewMode] = useState<"hourly" | "cumulative">("hourly");
  const [flowMode, setFlowMode] = useState<"net" | "gross">("net");
  const [data, setData] = useState<HourlyBreakdownResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selectedDate with historyDates if current selectedDate is not in list
  useEffect(() => {
    if (historyDates.length > 0 && !historyDates.includes(selectedDate)) {
      setSelectedDate(historyDates[0]);
    }
  }, [historyDates, selectedDate]);

  const fetchData = useCallback(async () => {
    if (!selectedDate) return;
    setIsLoading(true);
    setError(null);

    try {
      let url = `/api/movies/${movieId}/hourly-breakdown?date=${encodeURIComponent(selectedDate)}`;
      if (compareDate && compareDate !== selectedDate) {
        url += `&compare_date=${encodeURIComponent(compareDate)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }
      const json: HourlyBreakdownResponse = await res.json();
      setData(json);
    } catch (err: any) {
      console.error("Error fetching hourly breakdown:", err);
      setError(err.message || "Failed to load hourly breakdown data");
    } finally {
      setIsLoading(false);
    }
  }, [movieId, selectedDate, compareDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isComparing = !!compareDate && compareDate !== selectedDate;

  // Chart data formatting based on flowMode (net vs gross), metric, and aggregation mode
  const rawItems = data?.hourly || [];
  
  // In Hourly Flow (velocity view): exclude baseline and reconciliation to focus strictly on 09:00+ intraday velocity
  // In Cumulative Total view: keep baseline as the starting point of the running total
  const filteredHourly = viewMode === "hourly"
    ? rawItems.filter((item) => !item.is_baseline && !item.is_reconciliation)
    : rawItems.filter((item) => !item.is_reconciliation);

  const chartData = filteredHourly.map((item: HourlyBucketItem) => {
    const isCumulative = viewMode === "cumulative";
    
    const primaryHourlyTickets = flowMode === "gross" ? (item.gross_tickets_sold ?? item.tickets_sold) : item.tickets_sold;
    const primaryHourlyRev = flowMode === "gross" ? (item.gross_revenue ?? item.estimated_revenue) : item.estimated_revenue;

    const primaryVal = isCumulative
      ? chartMetric === "tickets"
        ? item.cumulative_tickets
        : item.cumulative_revenue
      : chartMetric === "tickets"
      ? primaryHourlyTickets
      : primaryHourlyRev;

    const compHourlyTickets = flowMode === "gross" ? (item.compare_gross_tickets_sold ?? item.compare_tickets_sold ?? 0) : (item.compare_tickets_sold ?? 0);
    const compHourlyRev = flowMode === "gross" ? (item.compare_gross_revenue ?? item.compare_estimated_revenue ?? 0) : (item.compare_estimated_revenue ?? 0);

    const compareVal = isComparing
      ? isCumulative
        ? chartMetric === "tickets"
          ? item.compare_cumulative_tickets || 0
          : item.compare_cumulative_revenue || 0
        : chartMetric === "tickets"
        ? compHourlyTickets
        : compHourlyRev
      : undefined;

    return {
      hour: item.is_baseline ? "Pre-Sales Baseline" : item.hour,
      raw_hour: item.raw_hour,
      is_baseline: item.is_baseline,
      is_reconciliation: item.is_reconciliation,
      [selectedDate]: primaryVal,
      ...(isComparing && compareDate ? { [compareDate]: compareVal } : {}),
      tickets_sold: item.tickets_sold,
      estimated_revenue: item.estimated_revenue,
      gross_tickets_sold: item.gross_tickets_sold,
      gross_revenue: item.gross_revenue,
      cumulative_tickets: item.cumulative_tickets,
      cumulative_revenue: item.cumulative_revenue,
      compare_tickets_sold: item.compare_tickets_sold,
      compare_estimated_revenue: item.compare_estimated_revenue,
      compare_gross_tickets_sold: item.compare_gross_tickets_sold,
      compare_gross_revenue: item.compare_gross_revenue,
      compare_cumulative_tickets: item.compare_cumulative_tickets,
      compare_cumulative_revenue: item.compare_cumulative_revenue,
      delta_tickets: item.delta_tickets,
      delta_revenue: item.delta_revenue,
    };
  });

  const renderDeltaPill = (delta: number, isCurrency: boolean = false, percentageBase?: number) => {
    if (delta === 0 || delta === undefined || delta === null) {
      return (
        <span className="text-slate-500 font-mono text-xs">
          {isCurrency ? "0.00 €" : "0"} (0%)
        </span>
      );
    }
    const isPositive = delta > 0;
    const sign = isPositive ? "+" : "";
    const pct =
      percentageBase && percentageBase > 0
        ? ` (${sign}${Math.round((delta / percentageBase) * 100)}%)`
        : "";

    return (
      <span
        className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-mono font-medium ${
          isPositive
            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
        }`}
      >
        {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
        <span>
          {sign}
          {isCurrency
            ? `${Math.abs(delta).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €`
            : Math.abs(delta).toLocaleString()}
          {pct}
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap w-full xl:w-auto">
            {/* Primary Date Selector */}
            <div>
              <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                Target Date
              </label>
              <select
                id="hourly-primary-date-select"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-amber-300 text-xs rounded-xl px-3 py-2 font-medium focus:ring-1 focus:ring-amber-500 outline-none cursor-pointer"
              >
                {historyDates.length === 0 ? (
                  <option value={defaultDate}>{defaultDate}</option>
                ) : (
                  historyDates.map((d) => (
                    <option key={d} value={d}>
                      {d} {d === defaultDate ? "(Latest)" : ""}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Compare Date Selector */}
            <div>
              <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1 font-semibold flex items-center gap-1">
                <GitCompare className="w-3 h-3 text-indigo-400" />
                <span>Compare Date</span>
              </label>
              <select
                id="hourly-compare-date-select"
                value={compareDate}
                onChange={(e) => setCompareDate(e.target.value)}
                className={`border text-xs rounded-xl px-3 py-2 font-medium focus:ring-1 outline-none cursor-pointer ${
                  compareDate
                    ? "bg-indigo-950/40 border-indigo-500/50 text-indigo-300 focus:ring-indigo-500"
                    : "bg-slate-800 border-slate-700 text-slate-400 focus:ring-slate-500"
                }`}
              >
                <option value="">None (Single Date)</option>
                {historyDates
                  .filter((d) => d !== selectedDate)
                  .map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
              </select>
            </div>

            {/* Metric Selector */}
            <div>
              <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                Metric
              </label>
              <div className="flex items-center bg-slate-950/80 p-0.5 rounded-xl border border-slate-800">
                <button
                  id="metric-tickets-btn"
                  onClick={() => setChartMetric("tickets")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                    chartMetric === "tickets"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Ticket className="w-3.5 h-3.5" />
                  <span>Tickets</span>
                </button>
                <button
                  id="metric-revenue-btn"
                  onClick={() => setChartMetric("revenue")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                    chartMetric === "revenue"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Euro className="w-3.5 h-3.5" />
                  <span>Revenue</span>
                </button>
              </div>
            </div>

            {/* Aggregation Mode Toggle */}
            <div>
              <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                Aggregation Mode
              </label>
              <div className="flex items-center bg-slate-950/80 p-0.5 rounded-xl border border-slate-800">
                <button
                  id="viewmode-hourly-btn"
                  onClick={() => setViewMode("hourly")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                    viewMode === "hourly"
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Hourly Flow</span>
                </button>
                <button
                  id="viewmode-cumulative-btn"
                  onClick={() => setViewMode("cumulative")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                    viewMode === "cumulative"
                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Cumulative Total</span>
                </button>
              </div>
            </div>

            {/* Flow Type Toggle (NET vs Gross) */}
            <div>
              <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1 font-semibold flex items-center gap-1">
                <span>Flow Accounting</span>
                <span title="Net flow counts newly claimed seats minus seat returns/cart cancellations, reconciling exactly with snapshot box office totals.">
                  <HelpCircle className="w-3 h-3 text-slate-500 hover:text-slate-300 cursor-help" />
                </span>
              </label>
              <div className="flex items-center bg-slate-950/80 p-0.5 rounded-xl border border-slate-800">
                <button
                  id="flowmode-net-btn"
                  onClick={() => setFlowMode("net")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                    flowMode === "net"
                      ? "bg-teal-500/20 text-teal-300 border border-teal-500/40 font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
                  <span>Net Admissions (Default)</span>
                </button>
                <button
                  id="flowmode-gross-btn"
                  onClick={() => setFlowMode("gross")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                    flowMode === "gross"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title="View raw ticket-claim transitions without subtracting returns"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Gross Claims</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end xl:self-center">
            <button
              id="hourly-refresh-btn"
              onClick={fetchData}
              disabled={isLoading}
              className="p-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 transition disabled:opacity-60 cursor-pointer"
              title="Refresh Hourly Data"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-amber-400" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Graceful Empty State Banner */}
      {data && !data.has_data && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto border border-amber-500/30">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              No Hourly Telemetry for {selectedDate}
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
              Either tracking was not yet active for {movieTitle} on this operational date, or no ticket transitions were recorded. Please select another date from the history dropdown above.
            </p>
          </div>
        </div>
      )}

      {/* Comparison Missing Data Warning */}
      {data && isComparing && data.compare_has_data === false && (
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3.5 flex items-center gap-3 text-indigo-300 text-xs">
          <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>
            Comparison date <strong>{compareDate}</strong> has no recorded seat transitions. Its hourly values are shown as 0.
          </span>
        </div>
      )}

      {/* Unified Reconciled KPI Cards (3 Explicit Core Cards + Peak Pace Card) */}
      {data && data.has_data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Day Box Office (Snapshot - Source of Truth) */}
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4 shadow-sm relative overflow-hidden bg-gradient-to-b from-amber-500/[0.04] to-transparent">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Ticket className="w-3.5 h-3.5 text-amber-400" />
                Total Day Box Office
              </span>
              <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                Snapshot Truth
              </span>
            </div>
            <div className="text-2xl font-black text-slate-100 tracking-tight">
              {data.summary.total_tickets.toLocaleString()}{" "}
              <span className="text-xs font-normal text-slate-400 font-sans">admissions</span>
            </div>
            <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
              {data.summary.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-0.5">
              ATP: {data.summary.total_tickets > 0
                ? `${(data.summary.total_revenue / data.summary.total_tickets).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                : "—"}
            </div>
            {isComparing && data.compare_summary && (
              <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-indigo-300 font-mono">
                  {compareDate}: {data.compare_summary.total_tickets.toLocaleString()} · ATP{" "}
                  {data.compare_summary.total_tickets > 0
                    ? `${(data.compare_summary.total_revenue / data.compare_summary.total_tickets).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                    : "—"}
                </span>
                {renderDeltaPill(
                  data.summary.total_tickets - data.compare_summary.total_tickets,
                  false,
                  data.compare_summary.total_tickets
                )}
              </div>
            )}
          </div>

          {/* Card 2: Pre-Sales / Opening Baseline */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                Pre-Sales / Opening Baseline
              </span>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                {data.summary.baseline_pct ?? 0}% of Day
              </span>
            </div>
            <div className="text-2xl font-black text-slate-100 tracking-tight">
              {(data.summary.baseline_tickets ?? 0).toLocaleString()}{" "}
              <span className="text-xs font-normal text-slate-400 font-sans">seats</span>
            </div>
            <div className="text-sm font-bold text-cyan-300 font-mono mt-0.5">
              {(data.summary.baseline_revenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Opening sweep baseline state before 09:00
            </div>
            {isComparing && data.compare_summary && (
              <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-indigo-300 font-mono">
                  {compareDate}: {(data.compare_summary.baseline_tickets ?? 0).toLocaleString()}
                </span>
                {renderDeltaPill(
                  (data.summary.baseline_tickets ?? 0) - (data.compare_summary.baseline_tickets ?? 0),
                  false,
                  data.compare_summary.baseline_tickets
                )}
              </div>
            )}
          </div>

          {/* Card 3: Intraday Walk-Up / Same-Day Sales */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                Intraday Walk-Up Sales
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                {data.summary.walkup_pct ?? 0}% of Day
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-400 tracking-tight">
              {(data.summary.walkup_tickets ?? 0).toLocaleString()}{" "}
              <span className="text-xs font-normal text-slate-400 font-sans">tickets</span>
            </div>
            <div className="text-sm font-bold text-slate-200 font-mono mt-0.5">
              {(data.summary.walkup_revenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Total sales generated during operational hours
            </div>
            {isComparing && data.compare_summary && (
              <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-indigo-300 font-mono">
                  {compareDate}: {(data.compare_summary.walkup_tickets ?? 0).toLocaleString()}
                </span>
                {renderDeltaPill(
                  (data.summary.walkup_tickets ?? 0) - (data.compare_summary.walkup_tickets ?? 0),
                  false,
                  data.compare_summary.walkup_tickets
                )}
              </div>
            )}
          </div>

          {/* Card 4: Peak Sales Hour & Pace */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                Peak Hour & Avg Pace
              </span>
              <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                {data.summary.peak_hour || "—"}
              </span>
            </div>
            <div className="text-2xl font-black text-purple-300 tracking-tight">
              {data.summary.peak_tickets.toLocaleString()}{" "}
              <span className="text-xs font-normal text-slate-400 font-sans">net tickets</span>
            </div>
            <div className="text-sm font-bold text-slate-200 font-mono mt-0.5">
              {(data.summary.peak_revenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € peak rev
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Avg Pace: <span className="font-semibold text-purple-400">{data.summary.avg_hourly_tickets || 0}</span> tickets/hr
            </div>
          </div>
        </div>
      )}

      {/* Informative Accounting Banner when viewing Net vs Gross */}
      {data && data.has_data && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Unified Reconciliation Active:</strong> Cumulative progression starts with Pre-Sales Baseline and adds Net Hourly Flow ({data.summary.gross_tickets?.toLocaleString()} gross claims minus {(data.summary.returns_tickets ?? 0).toLocaleString()} returns), reconciling to the exact snapshot total of <strong>{data.summary.total_tickets.toLocaleString()} admissions / {data.summary.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</strong>.
            </span>
          </div>
          {flowMode === "gross" && (
            <span className="shrink-0 px-2 py-0.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded text-[11px] font-medium">
              Gross view enabled
            </span>
          )}
        </div>
      )}

      {/* Hourly vs Cumulative Chart Container */}
      {data && data.has_data && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-amber-400" />
                <span>
                  {viewMode === "hourly"
                    ? `${chartMetric === "tickets" ? "Hourly Net Ticket Flow" : "Hourly Estimated Revenue"} (Sales Velocity)`
                    : `${chartMetric === "tickets" ? "Cumulative Admissions Progression" : "Cumulative Revenue Progression"} (Running Total)`}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {viewMode === "hourly"
                  ? `Intraday pace across operating hours (09:00 to 01:00 +1d) in Europe/Lisbon. Baseline presales excluded to focus purely on sales rate.`
                  : `Running total starting from Pre-Sales Baseline (${(data.summary.baseline_tickets ?? 0).toLocaleString()} seats) and accumulating across the day to the final snapshot total (${data.summary.total_tickets.toLocaleString()}).`}
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 font-mono">
                <span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block"></span>
                <span>{selectedDate} (Primary)</span>
              </span>
              {isComparing && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-mono">
                  <span className="w-2.5 h-2.5 rounded bg-indigo-400 inline-block"></span>
                  <span>{compareDate} (Comparison)</span>
                </span>
              )}
            </div>
          </div>

          <div className="h-80 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              {viewMode === "hourly" ? (
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} opacity={0.5} />
                  <XAxis
                    dataKey="hour"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    dy={8}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    tickFormatter={(val) =>
                      chartMetric === "revenue"
                        ? `${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val} €`
                        : val >= 1000
                        ? `${(val / 1000).toFixed(0)}k`
                        : val
                    }
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || !payload.length) return null;
                      const item = payload[0]?.payload;
                      if (!item) return null;

                      const primaryTickets =
                        flowMode === "gross"
                          ? (item.gross_tickets_sold ?? item.tickets_sold)
                          : item.tickets_sold;

                      const primaryRev =
                        flowMode === "gross"
                          ? (item.gross_revenue ?? item.estimated_revenue)
                          : item.estimated_revenue;

                      const compTickets =
                        flowMode === "gross"
                          ? (item.compare_gross_tickets_sold ?? item.compare_tickets_sold)
                          : item.compare_tickets_sold;

                      const compRev =
                        flowMode === "gross"
                          ? (item.compare_gross_revenue ?? item.compare_estimated_revenue)
                          : item.compare_estimated_revenue;

                      return (
                        <div className="bg-slate-950 border border-slate-700 rounded-xl p-3 shadow-2xl text-xs space-y-2.5 min-w-[240px]">
                          <div className="font-semibold text-slate-200 border-b border-slate-800 pb-1.5 flex items-center justify-between">
                            <span className="flex items-center gap-1 text-slate-300">
                              <Clock className="w-3.5 h-3.5 text-amber-400" />
                              {label}
                            </span>
                            <span className="text-[10px] text-teal-400 font-mono bg-teal-500/10 px-1.5 py-0.5 rounded border border-teal-500/20">
                              {flowMode === "net" ? "Net Flow" : "Gross Claims"}
                            </span>
                          </div>

                          {/* Primary Date */}
                          <div className="space-y-1">
                            <div className="text-[11px] font-semibold text-amber-400 flex items-center justify-between">
                              <span>{selectedDate}:</span>
                              <span className="font-mono font-bold">{primaryTickets.toLocaleString()} tickets</span>
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center justify-between">
                              <span>Est. Revenue:</span>
                              <span className="font-mono text-emerald-400">
                                {primaryRev.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })} €
                              </span>
                            </div>
                            {flowMode === "net" && item.gross_tickets_sold !== undefined && (
                              <div className="text-[10px] text-slate-500 flex items-center justify-between pt-0.5">
                                <span>Gross / Returns:</span>
                                <span className="font-mono">
                                  +{item.gross_tickets_sold} / -{item.returns_tickets || 0}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Comparison Date */}
                          {isComparing && compTickets !== undefined && (
                            <div className="space-y-1 pt-1.5 border-t border-slate-800">
                              <div className="text-[11px] font-semibold text-indigo-300 flex items-center justify-between">
                                <span>{compareDate}:</span>
                                <span className="font-mono font-bold">{compTickets.toLocaleString()} tickets</span>
                              </div>
                              <div className="text-[11px] text-slate-400 flex items-center justify-between">
                                <span>Est. Revenue:</span>
                                <span className="font-mono text-indigo-300">
                                  {compRev?.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })} €
                                </span>
                              </div>

                              {/* Deltas */}
                              <div className="pt-1 flex items-center justify-between text-[11px]">
                                <span className="text-slate-400">Delta:</span>
                                {renderDeltaPill(
                                  chartMetric === "tickets"
                                    ? primaryTickets - (compTickets || 0)
                                    : primaryRev - (compRev || 0),
                                  chartMetric === "revenue"
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: 10, fontSize: "12px" }}
                    formatter={(val) => <span className="text-slate-300 font-medium">{val}</span>}
                  />
                  <Bar
                    dataKey={selectedDate}
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                    name={`${selectedDate} (${chartMetric === "tickets" ? "Tickets" : "Revenue €"})`}
                  />
                  {isComparing && (
                    <Bar
                      dataKey={compareDate}
                      fill="#818cf8"
                      radius={[4, 4, 0, 0]}
                      name={`${compareDate} (${chartMetric === "tickets" ? "Tickets" : "Revenue €"})`}
                    />
                  )}
                </BarChart>
              ) : (
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                  <defs>
                    <linearGradient id="primaryCumGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="compareCumGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#818cf8" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} opacity={0.5} />
                  <XAxis
                    dataKey="hour"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    dy={8}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    tickFormatter={(val) =>
                      chartMetric === "revenue"
                        ? `${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val} €`
                        : val >= 1000
                        ? `${(val / 1000).toFixed(0)}k`
                        : val
                    }
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || !payload.length) return null;
                      const item = payload[0]?.payload;
                      if (!item) return null;

                      const primaryTickets = item.cumulative_tickets;
                      const primaryRev = item.cumulative_revenue;
                      const compTickets = item.compare_cumulative_tickets;
                      const compRev = item.compare_cumulative_revenue;

                      return (
                        <div className="bg-slate-950 border border-slate-700 rounded-xl p-3 shadow-2xl text-xs space-y-2.5 min-w-[240px]">
                          <div className="font-semibold text-slate-200 border-b border-slate-800 pb-1.5 flex items-center justify-between">
                            <span className="flex items-center gap-1 text-slate-300">
                              <Layers className="w-3.5 h-3.5 text-purple-400" />
                              {label}
                            </span>
                            <span className="text-[10px] text-purple-400 font-mono bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                              {item.is_baseline ? "Starting Point" : "Running Total"}
                            </span>
                          </div>

                          {/* Primary Date */}
                          <div className="space-y-1">
                            <div className="text-[11px] font-semibold text-amber-400 flex items-center justify-between">
                              <span>{selectedDate}:</span>
                              <span className="font-mono font-bold">{primaryTickets.toLocaleString()} tickets</span>
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center justify-between">
                              <span>Est. Revenue:</span>
                              <span className="font-mono text-emerald-400">
                                {primaryRev.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })} €
                              </span>
                            </div>
                            {!item.is_baseline && (
                              <div className="text-[10px] text-slate-500 flex items-center justify-between pt-0.5">
                                <span>Hour Flow Rate:</span>
                                <span className="font-mono text-amber-300/90">
                                  +{item.tickets_sold.toLocaleString()} tickets ({item.estimated_revenue.toLocaleString()} €)
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Comparison Date */}
                          {isComparing && compTickets !== undefined && (
                            <div className="space-y-1 pt-1.5 border-t border-slate-800">
                              <div className="text-[11px] font-semibold text-indigo-300 flex items-center justify-between">
                                <span>{compareDate}:</span>
                                <span className="font-mono font-bold">{compTickets.toLocaleString()} tickets</span>
                              </div>
                              <div className="text-[11px] text-slate-400 flex items-center justify-between">
                                <span>Est. Revenue:</span>
                                <span className="font-mono text-indigo-300">
                                  {compRev?.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })} €
                                </span>
                              </div>

                              {/* Deltas */}
                              <div className="pt-1 flex items-center justify-between text-[11px]">
                                <span className="text-slate-400">Delta:</span>
                                {renderDeltaPill(
                                  chartMetric === "tickets"
                                    ? primaryTickets - (compTickets || 0)
                                    : primaryRev - (compRev || 0),
                                  chartMetric === "revenue"
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: 10, fontSize: "12px" }}
                    formatter={(val) => <span className="text-slate-300 font-medium">{val}</span>}
                  />
                  <Area
                    type="monotone"
                    dataKey={selectedDate}
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#primaryCumGrad)"
                    dot={{ fill: "#f59e0b", r: 3 }}
                    activeDot={{ r: 6, fill: "#f59e0b" }}
                    name={`${selectedDate} (Running Cumulative)`}
                  />
                  {isComparing && (
                    <Area
                      type="monotone"
                      dataKey={compareDate}
                      stroke="#818cf8"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#compareCumGrad)"
                      dot={{ fill: "#818cf8", r: 3 }}
                      activeDot={{ r: 6, fill: "#818cf8" }}
                      name={`${compareDate} (Running Cumulative)`}
                    />
                  )}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Hourly Data Table */}
      {data && data.has_data && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-400" />
                <span>Theatrical Day Hourly Data Table</span>
              </h4>
              <p className="text-xs text-slate-400">
                Detailed hourly breakdown of {flowMode === "net" ? "Net Admissions" : "Gross Claims"} and estimated revenue across all sessions.
              </p>
            </div>

            <div className="text-xs text-slate-400 font-mono">
              Mode: <span className="text-teal-300 font-semibold">{flowMode === "net" ? "Net Flow" : "Gross Claims"}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4">Hour / Bucket</th>
                  <th className="py-3 px-4 text-right text-amber-300">
                    {flowMode === "net" ? "Net Tickets" : "Gross Tickets"} <br />
                    <span className="text-[10px] font-normal text-slate-400">({selectedDate})</span>
                  </th>
                  <th className="py-3 px-4 text-right text-emerald-400">
                    Est. Revenue <br />
                    <span className="text-[10px] font-normal text-slate-400">({selectedDate})</span>
                  </th>

                  {isComparing && (
                    <>
                      <th className="py-3 px-4 text-right text-indigo-300">
                        {flowMode === "net" ? "Net Tickets" : "Gross Tickets"} <br />
                        <span className="text-[10px] font-normal text-slate-400">({compareDate})</span>
                      </th>
                      <th className="py-3 px-4 text-right text-indigo-300">
                        Est. Revenue <br />
                        <span className="text-[10px] font-normal text-slate-400">({compareDate})</span>
                      </th>
                      <th className="py-3 px-4 text-right text-slate-200">
                        Delta <br />
                        <span className="text-[10px] font-normal text-slate-400">(Tickets / €)</span>
                      </th>
                    </>
                  )}

                  <th className="py-3 px-4 text-right text-slate-300">
                    Cumulative Tickets <br />
                    <span className="text-[10px] font-normal text-slate-400">({selectedDate})</span>
                  </th>
                  <th className="py-3 px-4 text-right text-slate-300">
                    Cumulative Revenue <br />
                    <span className="text-[10px] font-normal text-slate-400">({selectedDate})</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {data.hourly.map((item) => {
                  const displayTickets = flowMode === "gross" ? (item.gross_tickets_sold ?? item.tickets_sold) : item.tickets_sold;
                  const displayRev = flowMode === "gross" ? (item.gross_revenue ?? item.estimated_revenue) : item.estimated_revenue;

                  const compDisplayTickets = flowMode === "gross" ? (item.compare_gross_tickets_sold ?? item.compare_tickets_sold) : item.compare_tickets_sold;
                  const compDisplayRev = flowMode === "gross" ? (item.compare_gross_revenue ?? item.compare_estimated_revenue) : item.compare_estimated_revenue;

                  const isBaselineRow = item.is_baseline;
                  const isReconRow = item.is_reconciliation;

                  return (
                    <tr
                      key={item.hour}
                      className={`hover:bg-slate-800/40 transition ${
                        isBaselineRow
                          ? "bg-cyan-950/20 border-l-2 border-l-cyan-400"
                          : isReconRow
                          ? "bg-purple-950/20 border-l-2 border-l-purple-400"
                          : ""
                      }`}
                    >
                      <td className="py-3 px-4 font-semibold text-slate-200">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded border text-xs font-semibold ${
                              isBaselineRow
                                ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                                : isReconRow
                                ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
                                : "bg-slate-800 text-slate-300 border-slate-700"
                            }`}
                          >
                            {item.hour}
                          </span>
                          {isBaselineRow && (
                            <span className="text-[10px] text-cyan-400 font-sans font-normal hidden md:inline">
                              Opening Presales
                            </span>
                          )}
                          {isReconRow && (
                            <span className="text-[10px] text-purple-400 font-sans font-normal hidden md:inline">
                              Snapshot Sync
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-100">
                        {displayTickets > 0 ? (
                          displayTickets.toLocaleString()
                        ) : displayTickets < 0 ? (
                          <span className="text-rose-400">{displayTickets.toLocaleString()}</span>
                        ) : (
                          <span className="text-slate-600">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-emerald-400 font-semibold">
                        {displayRev !== 0 ? (
                          `${displayRev.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })} €`
                        ) : (
                          <span className="text-slate-600">0.00 €</span>
                        )}
                      </td>

                      {isComparing && (
                        <>
                          <td className="py-3 px-4 text-right text-indigo-300">
                            {compDisplayTickets !== undefined && compDisplayTickets > 0 ? (
                              compDisplayTickets.toLocaleString()
                            ) : compDisplayTickets !== undefined && compDisplayTickets < 0 ? (
                              <span className="text-rose-400">{compDisplayTickets.toLocaleString()}</span>
                            ) : (
                              <span className="text-slate-600">0</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right text-indigo-300 font-semibold">
                            {compDisplayRev !== undefined && compDisplayRev !== 0 ? (
                              `${compDisplayRev.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })} €`
                            ) : (
                              <span className="text-slate-600">0.00 €</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              {renderDeltaPill(
                                compDisplayTickets !== undefined ? displayTickets - compDisplayTickets : 0,
                                false
                              )}
                              <span className="text-[10px] text-slate-400">
                                {renderDeltaPill(
                                  compDisplayRev !== undefined
                                    ? Math.round((displayRev - compDisplayRev) * 100) / 100
                                    : 0,
                                  true
                                )}
                              </span>
                            </div>
                          </td>
                        </>
                      )}

                      <td className="py-3 px-4 text-right text-slate-200 font-bold">
                        {item.cumulative_tickets.toLocaleString()}
                        {isComparing && item.compare_cumulative_tickets !== undefined && (
                          <div className="text-[10px] text-indigo-400 font-normal">
                            Comp: {item.compare_cumulative_tickets.toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-200 font-bold">
                        {item.cumulative_revenue.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} €
                        {isComparing && item.compare_cumulative_revenue !== undefined && (
                          <div className="text-[10px] text-indigo-400 font-normal">
                            Comp: {item.compare_cumulative_revenue.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} €
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Grand Total Footer (Reconciled to Snapshot Exact Truth) */}
              <tfoot className="bg-slate-950/90 border-t-2 border-amber-500/40 font-mono font-bold">
                <tr className="text-slate-200">
                  <td className="py-3.5 px-4 font-sans font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-amber-400" />
                    <span>Total Theatrical Day (Snapshot)</span>
                  </td>
                  <td className="py-3.5 px-4 text-right text-amber-300 text-sm">
                    {data.summary.total_tickets.toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4 text-right text-emerald-400 text-sm">
                    {data.summary.total_revenue.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} €
                  </td>

                  {isComparing && data.compare_summary && (
                    <>
                      <td className="py-3.5 px-4 text-right text-indigo-300 text-sm">
                        {data.compare_summary.total_tickets.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right text-indigo-300 text-sm">
                        {data.compare_summary.total_revenue.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} €
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          {renderDeltaPill(
                            data.summary.total_tickets - data.compare_summary.total_tickets,
                            false,
                            data.compare_summary.total_tickets
                          )}
                          <span className="text-[10px]">
                            {renderDeltaPill(
                              data.summary.total_revenue - data.compare_summary.total_revenue,
                              true,
                              data.compare_summary.total_revenue
                            )}
                          </span>
                        </div>
                      </td>
                    </>
                  )}

                  <td className="py-3.5 px-4 text-right text-amber-300 text-sm">
                    {data.summary.total_tickets.toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4 text-right text-emerald-400 text-sm">
                    {data.summary.total_revenue.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} €
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
