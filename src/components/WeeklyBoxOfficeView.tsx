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
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Award,
} from "lucide-react";
import { WeeklyBoxOfficeResponse, WeeklyBoxOfficePeriod, WeeklyBoxOfficeMovieItem } from "../types";
import { fetchJson } from "../utils/api";

interface WeeklyBoxOfficeViewProps {
  onSelectMovie: (movieId: number) => void;
  onSelectView?: (view: "today" | "daily" | "weekend" | "weekly") => void;
  onBackToDashboard?: () => void;
}

export const WeeklyBoxOfficeView: React.FC<WeeklyBoxOfficeViewProps> = ({
  onSelectMovie,
  onSelectView,
  onBackToDashboard,
}) => {
  const [data, setData] = useState<WeeklyBoxOfficeResponse | null>(null);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeeklyData = async (isManual = false) => {
    if (isManual) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const json = await fetchJson<WeeklyBoxOfficeResponse>("/api/boxoffice/weeks");
      setData(json);
    } catch (err: any) {
      console.error("Error fetching weekly box office:", err);
      setError(err.message || "Failed to load weekly box office");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWeeklyData();
  }, []);

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
      <div className="space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-xl">
          <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto mb-4" />
          <h3 className="text-base font-semibold text-slate-200">Loading Weekly Box Office</h3>
          <p className="text-xs text-slate-400 mt-1">Aggregating 7-day theatrical week (Thursday–Wednesday)...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-900 border border-rose-900/50 rounded-2xl p-8 text-center">
        <p className="text-rose-400 text-sm font-medium mb-3">{error}</p>
        <button
          onClick={() => fetchWeeklyData(true)}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-xl transition border border-slate-700 inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  const weeks = data?.weeks || [];
  const currentWeek: WeeklyBoxOfficePeriod | undefined = weeks[selectedWeekIndex] || weeks[0];

  if (!currentWeek || weeks.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-xl">
        <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-200">No Weekly Data Recorded</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
          Weekly theatrical summaries (Thursday to Wednesday) will automatically appear here as collector sweeps capture session data.
        </p>
      </div>
    );
  }

  const topMovie = currentWeek.movies[0];

  return (
    <div className="space-y-6">
      {/* Box Office Subnav & View Switcher */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black text-slate-100 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-400" />
              <span>Theatrical Box Office</span>
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Official 7-Day Portuguese Theatrical Week (Thursday through Wednesday).
          </p>
        </div>

        {/* View Switcher Tabs (Today | Daily | Weekend | Weekly) */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 self-stretch sm:self-auto justify-center">
          <button
            id="switch-to-today-live-btn"
            onClick={() => onSelectView?.("today")}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer flex items-center gap-1.5"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
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
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 shadow-md cursor-pointer"
          >
            Weekly (Thu–Wed)
          </button>
        </div>
      </div>

      {/* Week Period Selector Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
            Select Theatrical Week:
          </label>
          <select
            id="weekly-period-select"
            value={selectedWeekIndex}
            onChange={(e) => setSelectedWeekIndex(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-xl px-3 py-2 font-medium focus:ring-1 focus:ring-amber-500 outline-none cursor-pointer"
          >
            {weeks.map((w, idx) => (
              <option key={w.week_id} value={idx}>
                {w.label} {w.is_live ? "⚡ (Live / In Progress)" : `(Gross: ${(w.total_revenue / 1000).toFixed(0)}k €)`}
              </option>
            ))}
          </select>

          {currentWeek.is_live ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500 text-slate-950 animate-pulse shadow-md shadow-amber-500/20">
              <span className="w-2 h-2 rounded-full bg-slate-950 animate-ping" />
              <span>Live / In Progress</span>
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
              Completed Theatrical Week
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
          <button
            onClick={() => setSelectedWeekIndex((prev) => Math.min(prev + 1, weeks.length - 1))}
            disabled={selectedWeekIndex >= weeks.length - 1}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 text-xs disabled:opacity-40 transition cursor-pointer"
          >
            Older Week
          </button>
          <button
            onClick={() => setSelectedWeekIndex((prev) => Math.max(prev - 1, 0))}
            disabled={selectedWeekIndex <= 0}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 text-xs disabled:opacity-40 transition cursor-pointer"
          >
            Newer Week
          </button>
          <button
            onClick={() => fetchWeeklyData(true)}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 text-xs transition cursor-pointer"
            title="Refresh weekly data"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-amber-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Week Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Euro className="w-3.5 h-3.5 text-amber-400" />
            <span>Weekly Gross</span>
          </div>
          <div className="text-xl font-black text-amber-400 font-mono">
            {formatCurrency(currentWeek.total_revenue)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Thursday through Wednesday</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Users className="w-3.5 h-3.5 text-cyan-400" />
            <span>Weekly Admissions</span>
          </div>
          <div className="text-xl font-black text-cyan-400 font-mono">
            {formatNumber(currentWeek.total_admissions)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Avg{" "}
            {currentWeek.total_admissions > 0
              ? `${(currentWeek.total_revenue / currentWeek.total_admissions).toFixed(2)} €`
              : "0.00 €"}{" "}
            / ticket
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Ticket className="w-3.5 h-3.5 text-emerald-400" />
            <span>Weekly Shows</span>
          </div>
          <div className="text-xl font-black text-emerald-400 font-mono">
            {formatNumber(currentWeek.total_sessions)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {currentWeek.movies.length} Tracked Titles
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
            <Award className="w-3.5 h-3.5 text-amber-400" />
            <span>#1 Weekly Box Office Leader</span>
          </div>
          <div className="text-sm font-bold text-slate-100 truncate">
            {topMovie ? topMovie.title : "—"}
          </div>
          <div className="text-[11px] text-amber-400 font-mono mt-1">
            {topMovie ? formatCurrency(topMovie.revenue) : "—"}
          </div>
        </div>
      </div>

      {/* Weekly Movies Ranked Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>{currentWeek.label} Weekly Box Office Rankings</span>
              <span className="text-xs text-slate-400 font-normal">
                ({currentWeek.movies.length} titles)
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Ranked by 7-day theatrical week gross revenue with comparisons to previous week.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3 px-3 font-semibold text-center w-10">#</th>
                <th className="py-3 px-4 font-semibold">Movie Title</th>
                <th className="py-3 px-3 font-semibold text-center">Week</th>
                <th className="py-3 px-4 font-semibold text-right">Weekly Gross</th>
                <th className="py-3 px-4 font-semibold text-right">Admissions</th>
                <th className="py-3 px-3 font-semibold text-center">Cinemas</th>
                <th className="py-3 px-3 font-semibold text-center">Shows</th>
                <th className="py-3 px-3 font-semibold text-right">Avg Ticket</th>
                <th className="py-3 px-3 font-semibold text-center">Days Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {currentWeek.movies.map((movie, index) => {
                const avgTicket = movie.admissions > 0 ? movie.revenue / movie.admissions : 0;

                return (
                  <tr
                    key={movie.movie_id}
                    onClick={() => onSelectMovie(movie.movie_id)}
                    className="hover:bg-slate-800/50 transition cursor-pointer group"
                  >
                    {/* Rank */}
                    <td className="py-3 px-3 text-center font-bold text-slate-400 group-hover:text-amber-400">
                      {index + 1}
                    </td>

                    {/* Movie Info */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-12 rounded bg-slate-800 overflow-hidden shrink-0 border border-slate-700 flex items-center justify-center">
                          {movie.poster_url ? (
                            <img
                              src={movie.poster_url}
                              alt={movie.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Film className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-100 group-hover:text-amber-400 transition">
                            {movie.title}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {movie.release_date ? `Rel: ${movie.release_date}` : "Current Run"}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Week # (Theatrical Run Week) */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg text-xs font-bold font-mono bg-slate-800 text-amber-400 border border-slate-700/80">
                        {movie.week_number_label || `Week #${movie.week_number || 1}`}
                      </span>
                    </td>

                    {/* Weekly Gross w/ delta */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="font-bold text-amber-400 font-mono text-sm">
                        {formatCurrency(movie.revenue)}
                      </div>
                      <div className="mt-0.5">
                        {renderDelta(movie.prev_week_revenue_change_pct, "Weekly Gross")}
                      </div>
                    </td>

                    {/* Admissions w/ delta */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="font-semibold text-cyan-400 font-mono">
                        {formatNumber(movie.admissions)}
                      </div>
                      <div className="mt-0.5">
                        {renderDelta(movie.prev_week_admissions_change_pct, "Weekly Admissions")}
                      </div>
                    </td>

                    {/* Cinemas Count w/ delta */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <div className="font-mono font-medium text-slate-200">
                        {movie.cinemas_count}
                      </div>
                      <div className="mt-0.5">
                        {renderDelta(movie.prev_week_cinemas_change_pct, "Cinemas")}
                      </div>
                    </td>

                    {/* Sessions Count w/ delta */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <div className="font-mono font-medium text-slate-200">
                        {movie.sessions_count}
                      </div>
                      <div className="mt-0.5">
                        {renderDelta(movie.prev_week_sessions_change_pct, "Shows")}
                      </div>
                    </td>

                    {/* Average Ticket */}
                    <td className="py-3 px-3 text-right whitespace-nowrap font-mono text-slate-400 text-xs">
                      {avgTicket > 0 ? `${avgTicket.toFixed(2)} €` : "—"}
                    </td>

                    {/* Days Active */}
                    <td className="py-3 px-3 text-center whitespace-nowrap font-mono text-slate-400 text-xs">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-medium">
                        {movie.days_with_data_count}/7 days
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        <div className="p-3 bg-slate-950/60 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between flex-wrap gap-2">
          <span>• Click any movie row to view its complete Daily Breakdown and Intraday telemetry.</span>
          <span>• Theatrical week starts Thursday and completes Wednesday.</span>
        </div>
      </div>
    </div>
  );
};
