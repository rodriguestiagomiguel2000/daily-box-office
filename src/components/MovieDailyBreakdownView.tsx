import React, { useState, useEffect } from "react";
import {
  Calendar,
  Euro,
  Users,
  Building,
  Film,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Sparkles,
  Layers,
  Clock,
  Ticket,
  BarChart2,
  Info,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { MovieDailyBreakdownResponse, MovieDailyBreakdownDay } from "../types";
import { fetchJson } from "../utils/api";

interface MovieDailyBreakdownViewProps {
  movieId: number;
  movieTitle?: string;
}

export const MovieDailyBreakdownView: React.FC<MovieDailyBreakdownViewProps> = ({
  movieId,
  movieTitle,
}) => {
  const [data, setData] = useState<MovieDailyBreakdownResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeChartMetric, setActiveChartMetric] = useState<"revenue" | "admissions" | "sessions">("revenue");

  const fetchBreakdown = async (isManual = false) => {
    if (!movieId) return;
    if (isManual) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const json = await fetchJson<MovieDailyBreakdownResponse>(`/api/movies/${movieId}/daily-breakdown`);
      setData(json);
    } catch (err: any) {
      console.error("Error fetching daily breakdown:", err);
      setError(err.message || "Failed to load daily breakdown");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBreakdown();
  }, [movieId]);

  const formatCurrency = (val: number) => {
    return `${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  };

  const formatNumber = (val: number) => {
    return new Intl.NumberFormat().format(val);
  };

  const renderDelta = (pct: number | null, label?: string) => {
    if (pct === null || pct === undefined) {
      return <span className="text-slate-600 font-mono text-xs">—</span>;
    }

    if (pct > 0) {
      return (
        <span
          className="inline-flex items-center gap-0.5 text-emerald-400 font-medium font-mono text-xs"
          title={label ? `${label}: +${pct}%` : `+${pct}%`}
        >
          <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />
          <span>+{pct.toFixed(1)}%</span>
        </span>
      );
    }

    if (pct < 0) {
      return (
        <span
          className="inline-flex items-center gap-0.5 text-rose-400 font-medium font-mono text-xs"
          title={label ? `${label}: ${pct}%` : `${pct}%`}
        >
          <TrendingDown className="w-3 h-3 text-rose-400 shrink-0" />
          <span>{pct.toFixed(1)}%</span>
        </span>
      );
    }

    return (
      <span
        className="inline-flex items-center gap-0.5 text-slate-400 font-medium font-mono text-xs"
        title={label ? `${label}: 0.0%` : "0.0%"}
      >
        <Minus className="w-3 h-3 text-slate-500 shrink-0" />
        <span>0.0%</span>
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-xl">
        <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto mb-4" />
        <h3 className="text-base font-semibold text-slate-200">Loading Daily Breakdown</h3>
        <p className="text-xs text-slate-400 mt-1">Aggregating historical operational days and box-office comparisons...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-900 border border-rose-900/50 rounded-2xl p-8 text-center">
        <p className="text-rose-400 text-sm font-medium mb-3">{error}</p>
        <button
          onClick={() => fetchBreakdown(true)}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-xl transition border border-slate-700 inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  if (!data || data.days.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-xl">
        <Film className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-200">No Daily Breakdown Recorded</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
          Performance snapshots and session data will appear here once collector sweeps record theatrical runs for this title.
        </p>
      </div>
    );
  }

  // Data for chart (chronological order: oldest -> newest)
  const chartData = data.days.map((d) => ({
    date: d.operational_date,
    label: `${d.day_of_week_short} ${d.operational_date.slice(5)}`,
    day_of_week: d.day_of_week,
    run_day_label: d.run_day_label ? d.run_day_label.replace("Day ", "D") : `D${d.run_day}`,
    is_weekend: d.is_weekend,
    revenue: d.revenue,
    admissions: d.admissions,
    sessions: d.sessions_count,
    cinemas: d.cinemas_count,
  }));

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-slate-100">Daily Box Office Breakdown</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {data.summary.total_days} Theatrical {data.summary.total_days === 1 ? "Day" : "Days"}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Day-by-day theatrical revenue, admissions, and cinema footprints with sequential and week-over-week comparisons.
          </p>
        </div>

        <button
          id="btn-refresh-daily-breakdown"
          onClick={() => fetchBreakdown(true)}
          disabled={isRefreshing}
          className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 text-xs font-medium transition disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-amber-400" : "text-slate-400"}`} />
          <span>{isRefreshing ? "Refreshing..." : "Refresh Daily Data"}</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Euro className="w-3.5 h-3.5 text-amber-400" />
            <span>Total Gross</span>
          </div>
          <div className="text-xl font-black text-amber-400 font-mono">
            {formatCurrency(data.summary.total_revenue)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Across all recorded days</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Users className="w-3.5 h-3.5 text-cyan-400" />
            <span>Total Admissions</span>
          </div>
          <div className="text-xl font-black text-cyan-400 font-mono">
            {formatNumber(data.summary.total_admissions)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Avg{" "}
            {data.summary.total_admissions > 0
              ? `${(data.summary.total_revenue / data.summary.total_admissions).toFixed(2)} €`
              : "0.00 €"}{" "}
            / ticket
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Ticket className="w-3.5 h-3.5 text-emerald-400" />
            <span>Total Shows</span>
          </div>
          <div className="text-xl font-black text-emerald-400 font-mono">
            {formatNumber(data.summary.total_sessions)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Avg{" "}
            {data.summary.total_sessions > 0
              ? (data.summary.total_admissions / data.summary.total_sessions).toFixed(1)
              : "0"}{" "}
            adm / show
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Building className="w-3.5 h-3.5 text-purple-400" />
            <span>Peak Circuit</span>
          </div>
          <div className="text-xl font-black text-purple-400 font-mono">
            {data.summary.max_cinemas} <span className="text-xs font-normal text-slate-400">Cinemas</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Maximum daily footprint</div>
        </div>
      </div>

      {/* Chart Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-slate-200">Daily Trajectory & Weekend Highlights</h3>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveChartMetric("revenue")}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeChartMetric === "revenue"
                  ? "bg-amber-500 text-slate-950 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Revenue (€)
            </button>
            <button
              onClick={() => setActiveChartMetric("admissions")}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeChartMetric === "admissions"
                  ? "bg-cyan-500 text-slate-950 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Admissions
            </button>
            <button
              onClick={() => setActiveChartMetric("sessions")}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeChartMetric === "sessions"
                  ? "bg-emerald-500 text-slate-950 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Shows
            </button>
          </div>
        </div>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} />
              <XAxis
                dataKey="label"
                stroke="#64748b"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                interval={0}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickFormatter={(val) => {
                  if (activeChartMetric === "revenue") {
                    return val >= 1000 ? `${(val / 1000).toFixed(0)}k €` : `${val} €`;
                  }
                  return val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`;
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderColor: "#334155",
                  borderRadius: "0.75rem",
                  fontSize: "12px",
                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)",
                  color: "#f8fafc",
                }}
                itemStyle={{ color: "#f8fafc" }}
                labelStyle={{ color: "#94a3b8", fontWeight: 600, marginBottom: "4px" }}
                cursor={{ fill: "rgba(148, 163, 184, 0.08)" }}
                formatter={(value: any) => [
                  activeChartMetric === "revenue" ? formatCurrency(Number(value)) : formatNumber(Number(value)),
                  activeChartMetric === "revenue"
                    ? "Gross Revenue"
                    : activeChartMetric === "admissions"
                    ? "Admissions"
                    : "Sessions/Shows",
                ]}
                labelFormatter={(label, payload) => {
                  if (payload && payload.length > 0) {
                    const d = payload[0].payload;
                    return `${d.day_of_week}, ${d.date} ${d.is_weekend ? "(Weekend: Thu-Sun)" : ""}`;
                  }
                  return label;
                }}
              />
              <Bar
                dataKey={activeChartMetric}
                radius={[4, 4, 0, 0]}
              >
                {chartData.map((entry, index) => {
                  let fillColor = "#64748b";
                  if (activeChartMetric === "revenue") {
                    fillColor = entry.is_weekend ? "#f59e0b" : "#b45309";
                  } else if (activeChartMetric === "admissions") {
                    fillColor = entry.is_weekend ? "#06b6d4" : "#0891b2";
                  } else {
                    fillColor = entry.is_weekend ? "#10b981" : "#059669";
                  }
                  return <Cell key={`cell-${index}`} fill={fillColor} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800 flex-wrap gap-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-500"></span>
              <span>Weekend (Thu–Sun)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-600"></span>
              <span>Weekday (Mon–Wed)</span>
            </span>
          </div>
          <span className="text-slate-500">Theatrical day runs 06:00 to 05:59 Lisbon time</span>
        </div>
      </div>

      {/* Main Daily Breakdown Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>Theatrical Operational Day Log</span>
              <span className="text-xs text-slate-400 font-normal">({data.days.length} days recorded)</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Changes compare against immediately previous recorded day and same weekday of previous week.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
              Weekend: Thu – Sun
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3 px-2 font-semibold text-center">Run Day</th>
                <th className="py-3 px-3 font-semibold">Date & Day</th>
                <th className="py-3 px-2 font-semibold text-center">Type</th>
                <th className="py-3 px-3 font-semibold text-right">Revenue (€)</th>
                <th className="py-3 px-2 font-semibold text-right">vs Prev Day</th>
                <th className="py-3 px-2 font-semibold text-right">vs Last Wk</th>
                <th className="py-3 px-3 font-semibold text-right">Admissions</th>
                <th className="py-3 px-2 font-semibold text-right">vs Prev Day</th>
                <th className="py-3 px-2 font-semibold text-right">vs Last Wk</th>
                <th className="py-3 px-2 font-semibold text-center">Cinemas</th>
                <th className="py-3 px-1.5 font-semibold text-center">vs Prev</th>
                <th className="py-3 px-2 font-semibold text-center">Shows</th>
                <th className="py-3 px-1.5 font-semibold text-center">vs Prev</th>
                <th className="py-3 px-2 font-semibold text-right">Avg Ticket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {data.days.map((day) => {
                const avgTicket = day.admissions > 0 ? day.revenue / day.admissions : 0;

                return (
                  <tr
                    key={day.operational_date}
                    className={`transition ${
                      day.is_today
                        ? "bg-amber-500/10 hover:bg-amber-500/15"
                        : day.is_weekend
                        ? "bg-amber-950/20 hover:bg-amber-950/30"
                        : "hover:bg-slate-800/40"
                    }`}
                  >
                    {/* Run Day */}
                    <td className="py-3 px-2 text-center whitespace-nowrap">
                      <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-slate-800 text-amber-400 border border-slate-700/80 shadow-inner">
                        {day.run_day_label ? day.run_day_label.replace("Day ", "D") : `D${day.run_day}`}
                      </span>
                    </td>

                    {/* Date & Day */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                        <span>{day.operational_date}</span>
                        {day.is_today && (
                          <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-amber-500 text-slate-950 uppercase animate-pulse">
                            TODAY
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">{day.day_of_week}</div>
                    </td>

                    {/* Type Badge (Weekend vs Weekday) */}
                    <td className="py-3 px-2 text-center whitespace-nowrap">
                      {day.is_weekend ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          Wknd
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                          Wday
                        </span>
                      )}
                    </td>

                    {/* Revenue */}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="font-bold text-amber-400 font-mono text-sm">
                        {formatCurrency(day.revenue)}
                      </div>
                    </td>

                    {/* Revenue Change vs Prev Day */}
                    <td className="py-3 px-2 text-right whitespace-nowrap font-mono">
                      {renderDelta(day.revenue_change_pct, "DoD Revenue")}
                    </td>

                    {/* Revenue Change vs Last Week */}
                    <td className="py-3 px-2 text-right whitespace-nowrap font-mono">
                      {renderDelta(day.prev_week_revenue_change_pct, "WoW Revenue")}
                    </td>

                    {/* Admissions */}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="font-semibold text-cyan-400 font-mono">
                        {formatNumber(day.admissions)}
                      </div>
                    </td>

                    {/* Admissions Change vs Prev Day */}
                    <td className="py-3 px-2 text-right whitespace-nowrap font-mono">
                      {renderDelta(day.admissions_change_pct, "DoD Admissions")}
                    </td>

                    {/* Admissions Change vs Last Week */}
                    <td className="py-3 px-2 text-right whitespace-nowrap font-mono">
                      {renderDelta(day.prev_week_admissions_change_pct, "WoW Admissions")}
                    </td>

                    {/* Cinemas Count */}
                    <td className="py-3 px-2 text-center whitespace-nowrap font-mono font-medium text-slate-200">
                      {day.cinemas_count}
                    </td>

                    {/* Cinemas Change vs Prev Day */}
                    <td className="py-3 px-1.5 text-center whitespace-nowrap font-mono">
                      {renderDelta(day.cinemas_change_pct, "Cinemas")}
                    </td>

                    {/* Sessions/Shows Count */}
                    <td className="py-3 px-2 text-center whitespace-nowrap font-mono font-medium text-slate-200">
                      {day.sessions_count}
                    </td>

                    {/* Sessions Change vs Prev Day */}
                    <td className="py-3 px-1.5 text-center whitespace-nowrap font-mono">
                      {renderDelta(day.sessions_change_pct, "Shows")}
                    </td>

                    {/* Average Ticket Price */}
                    <td className="py-3 px-3 text-right whitespace-nowrap font-mono text-slate-400 text-xs">
                      {avgTicket > 0 ? `${avgTicket.toFixed(2)} €` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer Notes */}
        <div className="p-3 bg-slate-950/60 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between flex-wrap gap-2">
          <span>• Comparisons display "—" when no valid prior baseline exists.</span>
          <span>• Theatrical Weekend strictly defined as Thursday through Sunday.</span>
        </div>
      </div>
    </div>
  );
};
