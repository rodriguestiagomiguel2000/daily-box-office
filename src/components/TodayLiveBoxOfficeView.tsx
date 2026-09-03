import React, { useState, useEffect, useMemo } from "react";
import {
  Euro,
  Users,
  Film,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Clock,
  Ticket,
  Award,
  Radio,
  Building,
  Zap,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Calendar,
  Layers,
  Search,
  ArrowUpDown,
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
import {
  TodayBoxOfficeResponse,
  TodayBoxOfficeMovieItem,
  TodayHourlyBucket,
} from "../types";
import { fetchJson } from "../utils/api";

interface TodayLiveBoxOfficeViewProps {
  onSelectMovie: (movieId: number) => void;
  onSelectView?: (view: "today" | "daily" | "weekend" | "weekly") => void;
  onBackToDashboard?: () => void;
}

type SortField = "revenue" | "admissions" | "occupancy" | "velocity" | "cinemas";

function formatOperationalDateLong(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dateStr;
  }
}

export const TodayLiveBoxOfficeView: React.FC<TodayLiveBoxOfficeViewProps> = ({
  onSelectMovie,
  onSelectView,
  onBackToDashboard,
}) => {
  const [data, setData] = useState<TodayBoxOfficeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isNavigatingDate, setIsNavigatingDate] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("revenue");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [chartMetric, setChartMetric] = useState<"revenue" | "tickets">("revenue");

  const fetchTodayData = async (targetDate?: string | null, isManual = false) => {
    if (isManual) {
      setIsRefreshing(true);
    } else if (targetDate !== undefined) {
      setIsNavigatingDate(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const url = targetDate ? `/api/boxoffice/today?date=${targetDate}` : "/api/boxoffice/today";
      const json = await fetchJson<TodayBoxOfficeResponse>(url);
      setData(json);
      setLastRefreshedAt(new Date());
    } catch (err: any) {
      console.error("Error fetching today box office:", err);
      setError(err.message || "Failed to load today's live box office data");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setIsNavigatingDate(false);
    }
  };

  useEffect(() => {
    fetchTodayData();
  }, []);

  const handlePrevDay = () => {
    if (data?.summary?.previous_date) {
      fetchTodayData(data.summary.previous_date);
    }
  };

  const handleNextDay = () => {
    if (data?.summary?.next_date) {
      fetchTodayData(data.summary.next_date);
    }
  };

  const handleGoToday = () => {
    fetchTodayData(null);
  };

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
          className="inline-flex items-center gap-0.5 text-emerald-400 font-semibold font-mono text-xs"
          title={label ? `${label}: +${pct}%` : `+${pct}% vs yesterday same time`}
        >
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>+{pct.toFixed(1)}%</span>
        </span>
      );
    }

    if (pct < 0) {
      return (
        <span
          className="inline-flex items-center gap-0.5 text-rose-400 font-semibold font-mono text-xs"
          title={label ? `${label}: ${pct}%` : `${pct}% vs yesterday same time`}
        >
          <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span>{pct.toFixed(1)}%</span>
        </span>
      );
    }

    return (
      <span
        className="inline-flex items-center gap-0.5 text-slate-400 font-semibold font-mono text-xs"
        title={label ? `${label}: 0.0%` : "0.0% vs yesterday same time"}
      >
        <Minus className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span>0.0%</span>
      </span>
    );
  };

  // Filter and sort movies
  const filteredAndSortedMovies = useMemo(() => {
    if (!data?.movies) return [];
    let list = data.movies.filter((m) =>
      m.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
    );

    list.sort((a, b) => {
      let valA = 0;
      let valB = 0;
      switch (sortField) {
        case "revenue":
          valA = a.revenue_today;
          valB = b.revenue_today;
          break;
        case "admissions":
          valA = a.admissions_today;
          valB = b.admissions_today;
          break;
        case "occupancy":
          valA = a.occupancy_pct;
          valB = b.occupancy_pct;
          break;
        case "velocity":
          valA = a.sales_velocity;
          valB = b.sales_velocity;
          break;
        case "cinemas":
          valA = a.cinemas_active_today;
          valB = b.cinemas_active_today;
          break;
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    return list;
  }, [data?.movies, searchQuery, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-xl">
          <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto mb-4" />
          <h3 className="text-base font-semibold text-slate-200">Loading Today's Live Box Office</h3>
          <p className="text-xs text-slate-400 mt-1">
            Aggregating real-time seat snapshots, canonical unit prices, and sales velocity...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-900 border border-rose-900/50 rounded-2xl p-8 text-center shadow-xl">
        <ShieldAlert className="w-10 h-10 text-rose-400 mx-auto mb-3" />
        <p className="text-rose-400 text-sm font-medium mb-3">{error}</p>
        <button
          id="retry-today-boxoffice-btn"
          onClick={() => fetchTodayData(null, true)}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-xl transition border border-slate-700 inline-flex items-center gap-2 cursor-pointer shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry Live Metrics</span>
        </button>
      </div>
    );
  }

  const summary = data?.summary;
  const isViewingToday = summary?.is_today ?? true;
  const movies = data?.movies || [];
  const hourlyTimeline = data?.hourly_timeline || [];
  const topMovie = summary?.top_movie;

  return (
    <div className="space-y-6">
      {/* ================= 1. SUB-NAV & VIEW SWITCHER ================= */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black text-slate-100 flex items-center gap-2.5">
              {isViewingToday ? (
                <>
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                  <span>Today's Live Box Office</span>
                </>
              ) : (
                <>
                  <Calendar className="w-5 h-5 text-amber-400" />
                  <span>Box Office: {formatOperationalDateLong(summary?.operational_date || "")}</span>
                </>
              )}
            </h1>
            {isViewingToday ? (
              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 shadow-sm">
                <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span>LIVE</span>
              </span>
            ) : (
              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                HISTORICAL DAY
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
            <span>Operational Date: <strong className="text-slate-200 font-mono">{summary?.operational_date}</strong> (06:00–05:59 Lisbon).</span>
            <span className="text-slate-600">•</span>
            <span>Operating Window: <strong className="text-slate-300 font-mono">09:00 – 02:00</strong>.</span>
            {isViewingToday && summary?.current_lisbon_time && (
              <>
                <span className="text-slate-600">•</span>
                <span>As of <strong className="text-amber-400 font-mono">{summary.current_lisbon_time}</strong> Lisbon Time</span>
              </>
            )}
          </p>
        </div>

        {/* View Switcher Pill Group (Today Live | Daily | Weekend | Weekly) */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 self-stretch sm:self-auto justify-center">
          <button
            id="switch-to-today-live-btn"
            onClick={() => {
              if (!isViewingToday) {
                handleGoToday();
              } else {
                onSelectView?.("today");
              }
            }}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 shadow-md cursor-pointer flex items-center gap-1.5"
          >
            {isViewingToday && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-950 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-950"></span>
              </span>
            )}
            <span>Today (Live)</span>
          </button>
          <button
            id="switch-to-daily-btn"
            onClick={() => onSelectView?.("daily")}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer"
          >
            Daily
          </button>
          <button
            id="switch-to-weekend-btn"
            onClick={() => onSelectView?.("weekend")}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer"
          >
            Weekend (Thu–Sun)
          </button>
          <button
            id="switch-to-weekly-btn"
            onClick={() => onSelectView?.("weekly")}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer"
          >
            Weekly (Thu–Wed)
          </button>
        </div>
      </div>

      {/* ================= 2. OPERATIONAL DATE NAVIGATOR (DAY BEFORE & NEXT DAY) ================= */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:px-4 shadow-md">
        {/* Day Before / Previous Day Button */}
        <button
          id="today-tab-prev-day-btn"
          onClick={handlePrevDay}
          disabled={!summary?.previous_date || isNavigatingDate || isRefreshing}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-semibold text-slate-200 border border-slate-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          title={`View box office for ${summary?.previous_date || "the day before"}`}
        >
          <ChevronLeft className="w-4 h-4 text-amber-400" />
          <span>Day Before ({summary?.previous_date || "Previous"})</span>
        </button>

        {/* Center: Current Operational Date Indicator */}
        <div className="flex items-center gap-2.5 flex-wrap justify-center text-center">
          <Calendar className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-bold text-slate-100">
            {formatOperationalDateLong(summary?.operational_date || "")}
          </span>
          <span className="font-mono text-xs text-slate-400">
            ({summary?.operational_date})
          </span>

          {isViewingToday ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE TODAY</span>
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                HISTORICAL
              </span>
              <button
                id="today-tab-jump-today-btn"
                onClick={handleGoToday}
                className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 underline underline-offset-2 transition cursor-pointer flex items-center gap-1"
                title="Return to today's live telemetry"
              >
                <span>Jump to Today (Live)</span>
              </button>
            </div>
          )}

          {isNavigatingDate && (
            <span className="text-xs text-amber-400 animate-pulse font-mono flex items-center gap-1 ml-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Loading...</span>
            </span>
          )}
        </div>

        {/* Next Day Button */}
        <button
          id="today-tab-next-day-btn"
          onClick={handleNextDay}
          disabled={!summary?.next_date || isNavigatingDate || isRefreshing}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-semibold text-slate-200 border border-slate-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          title={`View box office for ${summary?.next_date || "the next day"}`}
        >
          <span>Next Day ({summary?.next_date || "Next"})</span>
          <ChevronRight className="w-4 h-4 text-amber-400" />
        </button>
      </div>

      {/* ================= 2. LIVE CONTROLS & REFRESH BAR ================= */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-md">
        <div className="flex items-center gap-3 flex-wrap text-xs text-slate-400">
          <div className="flex items-center gap-1.5 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Tracking Window: <strong className="text-slate-200">09:00 - 02:00</strong> (Open Theaters)</span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
            <Film className="w-3.5 h-3.5 text-cyan-400" />
            <span>Active Titles: <strong className="text-cyan-400 font-mono">{movies.length}</strong></span>
          </div>

          {lastRefreshedAt && (
            <span className="text-slate-500 text-[11px]">
              Last refreshed at {lastRefreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>

        {/* Manual Refresh Button */}
        <button
          id="refresh-today-live-btn"
          onClick={() => fetchTodayData(isViewingToday ? null : summary?.operational_date, true)}
          disabled={isRefreshing || isNavigatingDate}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition active:scale-95 shadow-sm cursor-pointer disabled:opacity-50"
          title="Refresh box office metrics for this operational date"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isRefreshing ? "animate-spin" : ""}`} />
          <span>{isRefreshing ? "Refreshing..." : isViewingToday ? "Refresh Live Data" : "Refresh Day Data"}</span>
        </button>
      </div>

      {/* ================= 3. TOP SUMMARY KPI CARDS ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Revenue */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <Euro className="w-3.5 h-3.5 text-amber-400" />
              <span>{isViewingToday ? "Today's Live Gross" : "Day Gross"}</span>
            </div>
            {renderDelta(summary?.vs_yesterday_revenue_pct, "vs. yesterday")}
          </div>
          <div className="text-2xl font-black text-amber-400 font-mono">
            {formatCurrency(summary?.total_revenue_today || 0)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Avg {summary?.avg_ticket_price ? `${summary.avg_ticket_price.toFixed(2)} €` : "—"} / ticket</span>
            <span className="text-slate-400 font-mono">{summary?.total_shows_completed || 0} shows done</span>
          </div>
        </div>

        {/* Today's Admissions */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              <span>{isViewingToday ? "Today's Admissions" : "Day Admissions"}</span>
            </div>
            {renderDelta(summary?.vs_yesterday_admissions_pct, "vs. yesterday")}
          </div>
          <div className="text-2xl font-black text-cyan-400 font-mono">
            {formatNumber(summary?.total_admissions_today || 0)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Across {summary?.total_cinemas_active || 0} active cinemas</span>
            <span className="text-slate-400 font-mono">{summary?.total_sessions_today || 0} sessions</span>
          </div>
        </div>

        {/* Theatrical Occupancy */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Ticket className="w-3.5 h-3.5 text-emerald-400" />
            <span>Effective Occupancy</span>
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            {(summary?.overall_occupancy_pct || 0).toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Net of structural blocks</span>
            {summary && summary.total_structural_blocks > 0 && (
              <span className="text-slate-400 font-mono">-{summary.total_structural_blocks} blocks</span>
            )}
          </div>
        </div>

        {/* #1 Box Office Leader */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Award className="w-3.5 h-3.5 text-amber-400" />
            <span>#1 Box Office Leader</span>
          </div>
          <div className="text-sm font-bold text-slate-100 truncate" title={topMovie?.title || ""}>
            {topMovie ? topMovie.title : "—"}
          </div>
          <div className="text-xs text-amber-400 font-mono mt-1 flex items-center justify-between">
            <span>{topMovie ? formatCurrency(topMovie.revenue) : "—"}</span>
            {topMovie && (
              <span className="text-slate-400 font-sans text-[11px]">
                {topMovie.share_of_box_office.toFixed(1)}% market share
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ================= 4. INTRADAY TIMELINE CHART (09:00 - 02:00) ================= */}
      {hourlyTimeline.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-amber-400" />
                <span>Theatrical Open-Hours Intraday Flow (09:00 – 02:00)</span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Hourly market ticket sales and revenue during theatrical operating hours.
              </p>
            </div>

            {/* Metric Toggle */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                id="chart-metric-revenue-btn"
                onClick={() => setChartMetric("revenue")}
                className={`px-3 py-1 rounded font-semibold transition cursor-pointer ${
                  chartMetric === "revenue"
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Revenue (€)
              </button>
              <button
                id="chart-metric-tickets-btn"
                onClick={() => setChartMetric("tickets")}
                className={`px-3 py-1 rounded font-semibold transition cursor-pointer ${
                  chartMetric === "tickets"
                    ? "bg-cyan-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Tickets (Admissions)
              </button>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyTimeline} margin={{ top: 8, right: 10, left: -10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="hour"
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => (chartMetric === "revenue" ? `${val}€` : `${val}`)}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const item = payload[0].payload as TodayHourlyBucket;
                    return (
                      <div className="bg-slate-950 border border-slate-700 p-2.5 rounded-xl shadow-xl text-xs space-y-1">
                        <div className="font-bold text-slate-200 flex items-center justify-between gap-4">
                          <span>{item.hour}</span>
                          <span className="text-[10px] text-slate-400">Open Window</span>
                        </div>
                        <div className="text-amber-400 font-mono">
                          Revenue: {formatCurrency(item.revenue)}
                        </div>
                        <div className="text-cyan-400 font-mono">
                          Tickets: {formatNumber(item.tickets)}
                        </div>
                        <div className="text-slate-400 text-[10px] border-t border-slate-800 pt-1 mt-1">
                          Cum. Revenue: {formatCurrency(item.cumulative_revenue)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey={chartMetric === "revenue" ? "revenue" : "tickets"}
                  fill={chartMetric === "revenue" ? "#f59e0b" : "#06b6d4"}
                  radius={[4, 4, 0, 0]}
                >
                  {hourlyTimeline.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.hour.includes(summary?.current_lisbon_time?.slice(0, 2) || "###")
                          ? "#10b981"
                          : chartMetric === "revenue"
                          ? "#f59e0b"
                          : "#06b6d4"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ================= 5. PER-MOVIE RANKED LEADERBOARD ================= */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Table Header Controls */}
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              <span>{isViewingToday ? "Today's Theatrical Leaderboard" : `Theatrical Leaderboard (${summary?.operational_date})`}</span>
              <span className="text-xs text-slate-400 font-normal">
                ({filteredAndSortedMovies.length} showing movies)
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              {isViewingToday
                ? "Only showing movies with live sessions or admissions today."
                : `Theatrical sessions and admissions recorded for operational date ${summary?.operational_date}.`}{" "}
              Sorted by gross revenue descending.
            </p>
          </div>

          {/* Search Box */}
          <div className="relative w-full md:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="search-today-movies-input"
              type="text"
              placeholder="Filter movies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>
        </div>

        {/* Movies List Table */}
        {filteredAndSortedMovies.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            <Film className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="font-medium text-slate-300">No active movies match your search</p>
            <p className="mt-1 text-slate-500">Only titles with sessions or admissions today are displayed.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800 select-none">
                  <th className="py-3 px-3 font-semibold text-center w-12">#</th>
                  <th className="py-3 px-4 font-semibold">Movie Title</th>
                  <th
                    onClick={() => handleSort("revenue")}
                    className="py-3 px-4 font-semibold text-right cursor-pointer hover:text-slate-200"
                  >
                    <div className="inline-flex items-center gap-1 justify-end">
                      <span>{isViewingToday ? "Today's Gross" : "Day Gross"}</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("admissions")}
                    className="py-3 px-4 font-semibold text-right cursor-pointer hover:text-slate-200"
                  >
                    <div className="inline-flex items-center gap-1 justify-end">
                      <span>Admissions</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("velocity")}
                    className="py-3 px-3 font-semibold text-center cursor-pointer hover:text-slate-200"
                  >
                    <div className="inline-flex items-center gap-1 justify-center">
                      <span>Sales Velocity</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("occupancy")}
                    className="py-3 px-3 font-semibold text-center cursor-pointer hover:text-slate-200"
                  >
                    <div className="inline-flex items-center gap-1 justify-center">
                      <span>Occupancy</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("cinemas")}
                    className="py-3 px-3 font-semibold text-center cursor-pointer hover:text-slate-200"
                  >
                    <div className="inline-flex items-center gap-1 justify-center">
                      <span>Cinemas / Shows</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th className="py-3 px-3 font-semibold text-center">Structural Blocks</th>
                  <th className="py-3 px-3 font-semibold text-right">As Of</th>
                  <th className="py-3 px-3 font-semibold text-center w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredAndSortedMovies.map((movie, index) => {
                  const rank = index + 1;
                  return (
                    <tr
                      key={movie.movie_id}
                      onClick={() => onSelectMovie(movie.movie_id)}
                      className="hover:bg-slate-800/40 transition cursor-pointer group"
                    >
                      {/* Rank */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-black text-xs ${
                            rank === 1
                              ? "bg-amber-500 text-slate-950 shadow-sm"
                              : rank === 2
                              ? "bg-slate-300 text-slate-950"
                              : rank === 3
                              ? "bg-amber-700/80 text-amber-100"
                              : "text-slate-400 font-mono"
                          }`}
                        >
                          {rank}
                        </span>
                      </td>

                      {/* Title & Poster */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {movie.poster_url ? (
                            <img
                              src={movie.poster_url}
                              alt={movie.title}
                              className="w-9 h-12 rounded object-cover border border-slate-700 shadow-sm shrink-0"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-9 h-12 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-600 shrink-0">
                              <Film className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-bold text-slate-100 group-hover:text-amber-400 transition truncate max-w-xs md:max-w-md">
                              {movie.title}
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                              <span>Released {movie.release_date || "—"}</span>
                              <span className="text-slate-600">•</span>
                              <span className="text-amber-400/90 font-mono">
                                {movie.avg_ticket_price ? `${movie.avg_ticket_price.toFixed(2)} €/tix` : "—"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Revenue & vs. Yesterday */}
                      <td className="py-3 px-4 text-right">
                        <div className="font-mono font-bold text-amber-400 text-sm">
                          {formatCurrency(movie.revenue_today)}
                        </div>
                        <div className="mt-0.5 flex items-center justify-end gap-1">
                          {renderDelta(movie.vs_yesterday_pct)}
                        </div>
                      </td>

                      {/* Admissions */}
                      <td className="py-3 px-4 text-right font-mono">
                        <div className="font-bold text-cyan-400 text-sm">
                          {formatNumber(movie.admissions_today)}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          admissions so far
                        </div>
                      </td>

                      {/* Sales Velocity (tickets/hr) */}
                      <td className="py-3 px-3 text-center font-mono">
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-200">
                          <Zap className="w-3 h-3 text-amber-400" />
                          <span>{movie.sales_velocity.toFixed(1)}</span>
                          <span className="text-[10px] text-slate-500 font-sans">tix/h</span>
                        </div>
                      </td>

                      {/* Occupancy % */}
                      <td className="py-3 px-3 text-center">
                        <div className="inline-block w-20">
                          <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                            <span className="text-slate-300 font-semibold">{movie.occupancy_pct.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-emerald-500 h-full rounded-full"
                              style={{ width: `${Math.min(100, movie.occupancy_pct)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Cinemas & Shows */}
                      <td className="py-3 px-3 text-center">
                        <div className="text-slate-200 font-medium">
                          {movie.cinemas_active_today} <span className="text-slate-500 text-[10px]">cinemas</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {movie.shows_completed} / {movie.sessions_today} shows done
                        </div>
                      </td>

                      {/* Structural Blocks Excluded (only shown when > 0) */}
                      <td className="py-3 px-3 text-center">
                        {movie.structural_blocks_excluded > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/40 text-amber-300 border border-amber-500/30"
                            title={`${movie.structural_blocks_excluded} structural blocks excluded from capacity calculation`}
                          >
                            <ShieldAlert className="w-3 h-3 text-amber-400" />
                            <span>{movie.structural_blocks_excluded} excluded</span>
                          </span>
                        ) : (
                          <span className="text-slate-600 font-mono text-[11px]">—</span>
                        )}
                      </td>

                      {/* As of HH:MM */}
                      <td className="py-3 px-3 text-right font-mono text-slate-400 text-xs whitespace-nowrap">
                        <span>As of {movie.as_of_time}</span>
                      </td>

                      {/* Chevron Arrow */}
                      <td className="py-3 px-3 text-center">
                        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-amber-400 transition" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
