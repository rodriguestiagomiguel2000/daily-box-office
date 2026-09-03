import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Calendar,
  TrendingUp,
  RefreshCw,
  Search,
  Filter,
  Film,
  ArrowUpDown,
  Layers,
  Info,
  Columns,
  Check,
} from "lucide-react";
import {
  DailyBoxOfficeHistoryResponse,
  DailyBoxOfficeRow,
  Movie,
} from "../types";
import { fetchJson } from "../utils/api";

interface DailyBoxOfficeHistoryViewProps {
  onSelectMovie: (movieId: number) => void;
  onBackToDashboard: () => void;
  onSelectView?: (view: "today" | "daily" | "weekend" | "weekly") => void;
}

// Calculate release day number: (operational_date - release_date) + 1
export function calculateReleaseDayNumber(
  operationalDateStr?: string | null,
  releaseDateStr?: string | null
): number | null {
  if (!operationalDateStr || !releaseDateStr) return null;

  const opMatch = operationalDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const relMatch = releaseDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!opMatch || !relMatch) return null;

  const opDate = new Date(
    Date.UTC(
      parseInt(opMatch[1], 10),
      parseInt(opMatch[2], 10) - 1,
      parseInt(opMatch[3], 10)
    )
  );
  const relDate = new Date(
    Date.UTC(
      parseInt(relMatch[1], 10),
      parseInt(relMatch[2], 10) - 1,
      parseInt(relMatch[3], 10)
    )
  );

  const diffMs = opDate.getTime() - relDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays + 1; // Release day itself is Day 1
}

// Helper to format currency compactly
export function formatCompactCurrency(val: number): string {
  if (val >= 1_000_000) {
    return `${(val / 1_000_000).toFixed(2)}M €`;
  }
  return `${Math.round(val).toLocaleString()} €`;
}

// Helper to format admissions compactly
export function formatCompactAdmissions(val: number): string {
  if (val >= 100_000) {
    return `${(val / 1000).toFixed(1)}k adm`;
  }
  return `${val.toLocaleString()} adm`;
}

type DateRangeFilter = "7d" | "30d" | "all";
type ViewMode = "calendar" | "release_day";
type SortField = "movie" | "total_revenue" | "release_date" | string; // string = operational_date
type SortOrder = "asc" | "desc";

export const DailyBoxOfficeHistoryView: React.FC<DailyBoxOfficeHistoryViewProps> = ({
  onSelectMovie,
  onBackToDashboard,
  onSelectView,
}) => {
  const [data, setData] = useState<DailyBoxOfficeHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Layout Toggles
  const [dateRange, setDateRange] = useState<DateRangeFilter>("7d");
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [showRangeTotal, setShowRangeTotal] = useState<boolean>(true);
  const [movieQuery, setMovieQuery] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("total_revenue");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Fetch Data
  const fetchDailyHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const json = await fetchJson<DailyBoxOfficeHistoryResponse>("/api/boxoffice/daily-history");
      setData(json);
    } catch (err: any) {
      console.error("Failed to fetch daily box office history:", err);
      setError(err.message || "Failed to load history");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDailyHistory();
  }, [fetchDailyHistory]);

  // 1. Filter operational dates based on DateRangeFilter (most recent first)
  const visibleDateRows = useMemo(() => {
    if (!data?.rows) return [];
    let rows = [...data.rows];

    // Ensure rows are sorted DESC by operational_date
    rows.sort((a, b) => b.operational_date.localeCompare(a.operational_date));

    if (dateRange === "7d") {
      return rows.slice(0, 7);
    } else if (dateRange === "30d") {
      return rows.slice(0, 30);
    }
    return rows;
  }, [data?.rows, dateRange]);

  // 2. Filter movies by title query
  const filteredMovies = useMemo(() => {
    if (!data?.movies) return [];
    if (!movieQuery.trim()) return data.movies;
    const q = movieQuery.toLowerCase();
    return data.movies.filter((m) => m.title.toLowerCase().includes(q));
  }, [data?.movies, movieQuery]);

  // 3. Calculate per-movie totals for visible dates & sort movie rows
  const { sortedMovies, movieRangeStats, dateTotals } = useMemo(() => {
    const stats: Record<
      number,
      { revenue: number; admissions: number; days: number }
    > = {};

    const dTotals: Record<
      string,
      { total_revenue: number; total_admissions: number }
    > = {};

    for (const movie of filteredMovies) {
      stats[movie.id] = { revenue: 0, admissions: 0, days: 0 };
    }

    for (const dRow of visibleDateRows) {
      dTotals[dRow.operational_date] = { total_revenue: 0, total_admissions: 0 };

      for (const movie of filteredMovies) {
        const mData = dRow.movie_data[movie.id];
        if (mData && (mData.revenue > 0 || mData.shows > 0)) {
          const rev = mData.revenue || 0;
          const adm = mData.admissions || 0;

          stats[movie.id].revenue += rev;
          stats[movie.id].admissions += adm;
          stats[movie.id].days += 1;

          dTotals[dRow.operational_date].total_revenue += rev;
          dTotals[dRow.operational_date].total_admissions += adm;
        }
      }
    }

    const movies = [...filteredMovies];

    movies.sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;

      if (sortField === "movie") {
        valA = a.title;
        valB = b.title;
        return sortOrder === "asc"
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      } else if (sortField === "release_date") {
        valA = a.release_date || "";
        valB = b.release_date || "";
        return sortOrder === "asc"
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      } else if (sortField === "total_revenue") {
        valA = stats[a.id]?.revenue || 0;
        valB = stats[b.id]?.revenue || 0;
      } else {
        // Sort by revenue on specific operational date
        const dRow = visibleDateRows.find(
          (r) => r.operational_date === sortField
        );
        valA = dRow?.movie_data[a.id]?.revenue || 0;
        valB = dRow?.movie_data[b.id]?.revenue || 0;
      }

      if (typeof valA === "number" && typeof valB === "number") {
        return sortOrder === "desc" ? valB - valA : valA - valB;
      }
      return 0;
    });

    return {
      sortedMovies: movies,
      movieRangeStats: stats,
      dateTotals: dTotals,
    };
  }, [filteredMovies, visibleDateRows, sortField, sortOrder]);

  // Overall Grand Total across visible dates
  const grandTotal = useMemo(() => {
    let rev = 0;
    let adm = 0;
    for (const dStr in dateTotals) {
      rev += dateTotals[dStr].total_revenue;
      adm += dateTotals[dStr].total_admissions;
    }
    return { revenue: Math.round(rev * 100) / 100, admissions: adm };
  }, [dateTotals]);

  // Release Day Matrix Data Transformation (Transposed)
  const releaseDayData = useMemo(() => {
    if (!data?.rows || !data?.movies)
      return { sortedDays: [], dayMovieMatrix: {}, dayTotals: {} };

    const matrix: Record<
      number,
      Record<
        number,
        { revenue: number; admissions: number; date: string; is_live: boolean }
      >
    > = {};

    const totals: Record<number, { revenue: number; admissions: number }> = {};

    for (const row of visibleDateRows) {
      for (const movie of filteredMovies) {
        const mData = row.movie_data[movie.id];
        if (mData && (mData.revenue > 0 || mData.shows > 0)) {
          const dayNum = calculateReleaseDayNumber(
            row.operational_date,
            movie.release_date
          );
          if (dayNum !== null) {
            if (!matrix[dayNum]) matrix[dayNum] = {};
            if (!totals[dayNum]) totals[dayNum] = { revenue: 0, admissions: 0 };

            matrix[dayNum][movie.id] = {
              revenue: mData.revenue,
              admissions: mData.admissions,
              date: row.operational_date,
              is_live: mData.is_live,
            };

            totals[dayNum].revenue += mData.revenue;
            totals[dayNum].admissions += mData.admissions;
          }
        }
      }
    }

    const sortedDays = Object.keys(matrix)
      .map((k) => parseInt(k, 10))
      .sort((a, b) => a - b);

    return { sortedDays, dayMovieMatrix: matrix, dayTotals: totals };
  }, [visibleDateRows, filteredMovies, data?.rows, data?.movies]);

  // Handle Sort Toggle
  const handleSortToggle = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  if (isLoading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
        <p className="text-slate-400 font-medium text-sm">
          Loading Daily Box Office History...
        </p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-rose-950/40 border border-rose-800/60 rounded-2xl p-8 text-center space-y-4 my-8 max-w-xl mx-auto">
        <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
          <Info className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-rose-200">Failed to Load History</h3>
        <p className="text-sm text-slate-400">{error}</p>
        <button
          onClick={fetchDailyHistory}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-sm font-semibold transition"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Calculate sticky offset for Range Total column
  const rangeTotalLeftOffset = "left-[200px]";

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-100">
                Daily Box Office History
              </h1>
              <p className="text-xs text-slate-400">
                Compact transposed matrix — sticky movie headers with scoped date scrolling
              </p>
            </div>
          </div>
        </div>

        {/* View Mode & Actions */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Box Office Period Tabs */}
          {onSelectView && (
            <div className="bg-slate-950 border border-slate-800 p-1 rounded-xl flex items-center text-xs font-semibold">
              <button
                id="today-live-tab-btn"
                onClick={() => onSelectView("today")}
                className="px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer flex items-center gap-1.5"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Today (Live)</span>
              </button>
              <button
                id="daily-tab-btn"
                onClick={() => onSelectView("daily")}
                className="px-3.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 shadow font-bold cursor-pointer"
              >
                Daily
              </button>
              <button
                id="weekend-tab-btn"
                onClick={() => onSelectView("weekend")}
                className="px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                Weekend (Thu–Sun)
              </button>
              <button
                id="weekly-tab-btn"
                onClick={() => onSelectView("weekly")}
                className="px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                Weekly (Thu–Wed)
              </button>
            </div>
          )}

          {/* Calendar vs Release Day View Mode */}
          <div className="bg-slate-950 border border-slate-800 p-1 rounded-xl flex items-center text-xs font-semibold">
            <button
              onClick={() => setViewMode("calendar")}
              className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition ${
                viewMode === "calendar"
                  ? "bg-amber-500 text-slate-950 shadow font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Calendar View</span>
            </button>
            <button
              onClick={() => setViewMode("release_day")}
              className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition ${
                viewMode === "release_day"
                  ? "bg-amber-500 text-slate-950 shadow font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Release Day Matrix</span>
            </button>
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchDailyHistory}
            disabled={isLoading}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
            title="Refresh Box Office Data"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoading ? "animate-spin text-amber-400" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Control Bar: Date Range Filter, Search & Column Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/50 p-4 rounded-xl border border-slate-800 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Range Buttons */}
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-amber-400" />
            <span className="font-medium text-slate-400">Range:</span>
            <div className="flex items-center space-x-1 bg-slate-950 border border-slate-800 p-1 rounded-lg font-medium">
              <button
                onClick={() => setDateRange("7d")}
                className={`px-2.5 py-1 rounded transition ${
                  dateRange === "7d"
                    ? "bg-slate-800 text-amber-300 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Last 7 Days
              </button>
              <button
                onClick={() => setDateRange("30d")}
                className={`px-2.5 py-1 rounded transition ${
                  dateRange === "30d"
                    ? "bg-slate-800 text-amber-300 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Last 30 Days
              </button>
              <button
                onClick={() => setDateRange("all")}
                className={`px-2.5 py-1 rounded transition ${
                  dateRange === "all"
                    ? "bg-slate-800 text-amber-300 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                All Time ({data?.rows?.length || 0}d)
              </button>
            </div>
          </div>

          {/* Toggle Range Total Column */}
          <button
            onClick={() => setShowRangeTotal((prev) => !prev)}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
              showRangeTotal
                ? "bg-slate-800 text-amber-300 border-amber-500/40"
                : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
            }`}
            title="Toggle Range Total Column"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Range Total</span>
            {showRangeTotal && <Check className="w-3 h-3 text-amber-400" />}
          </button>
        </div>

        {/* Search Movie Column */}
        <div className="relative w-full sm:w-60">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search movie title..."
            value={movieQuery}
            onChange={(e) => setMovieQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition"
          />
        </div>
      </div>

      {/* Transposed Matrix Table Container with Scoped Horizontal Scroll */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto max-w-full">
          {viewMode === "calendar" ? (
            /* ================= COMPACT TRANSPOSED CALENDAR VIEW ================= */
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-medium">
                  {/* Sticky Movie Column Header */}
                  <th
                    onClick={() => handleSortToggle("movie")}
                    className="py-2.5 px-3 cursor-pointer hover:text-amber-400 transition select-none sticky left-0 z-30 bg-slate-950 border-r border-slate-800 w-[200px] min-w-[200px]"
                  >
                    <div className="flex items-center space-x-1.5 font-bold">
                      <span>Tracked Movie</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Optional Sticky Range Total Column Header */}
                  {showRangeTotal && (
                    <th
                      onClick={() => handleSortToggle("total_revenue")}
                      className={`py-2.5 px-3 cursor-pointer hover:text-amber-400 transition select-none border-r border-slate-800 text-right w-[110px] min-w-[110px] bg-slate-950 sticky ${rangeTotalLeftOffset} z-30`}
                    >
                      <div className="flex items-center justify-end space-x-1 font-bold text-amber-300">
                        <span>Total</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-500" />
                      </div>
                    </th>
                  )}

                  {/* Operational Date Column Headers (Most recent first) */}
                  {visibleDateRows.map((dRow) => {
                    // Extract compact date e.g. "08-14"
                    const compactDate = dRow.operational_date.length === 10
                      ? dRow.operational_date.slice(5)
                      : dRow.operational_date;

                    return (
                      <th
                        key={dRow.operational_date}
                        onClick={() => handleSortToggle(dRow.operational_date)}
                        title={dRow.operational_date}
                        className="py-2.5 px-2 min-w-[92px] cursor-pointer hover:bg-slate-900 transition border-r border-slate-800/60 text-right select-none"
                      >
                        <div className="flex flex-col items-end">
                          <div className="flex items-center space-x-1 font-bold text-slate-200">
                            <span>{compactDate}</span>
                            {dRow.is_today && (
                              <span className="px-1 py-0.2 rounded text-[8px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                                LIVE
                              </span>
                            )}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {/* 1. Daily Total Summary Row (Pinned at Top) */}
                <tr className="bg-slate-950/90 border-b-2 border-slate-800 text-slate-100 font-bold">
                  {/* Sticky Movie Cell Header */}
                  <td className="py-2.5 px-3 sticky left-0 z-20 bg-slate-950 border-r border-slate-800 font-sans w-[200px] min-w-[200px]">
                    <div className="flex items-center space-x-2 text-amber-400 font-bold">
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span>Daily Total</span>
                    </div>
                  </td>

                  {/* Range Grand Total Cell */}
                  {showRangeTotal && (
                    <td
                      className={`py-2.5 px-3 text-right text-amber-400 border-r border-slate-800 bg-slate-950 sticky ${rangeTotalLeftOffset} z-20 font-bold w-[110px] min-w-[110px]`}
                    >
                      <div>{formatCompactCurrency(grandTotal.revenue)}</div>
                      <div className="text-[10px] text-slate-400 font-sans font-normal">
                        {formatCompactAdmissions(grandTotal.admissions)}
                      </div>
                    </td>
                  )}

                  {/* Date Sum cells */}
                  {visibleDateRows.map((dRow) => {
                    const dTot = dateTotals[dRow.operational_date] || {
                      total_revenue: 0,
                      total_admissions: 0,
                    };
                    return (
                      <td
                        key={dRow.operational_date}
                        className="py-2.5 px-2 text-right border-r border-slate-800/60 font-bold text-emerald-400 bg-slate-950/60"
                      >
                        <div>{formatCompactCurrency(dTot.total_revenue)}</div>
                        <div className="text-[10px] text-slate-500 font-sans font-normal">
                          {formatCompactAdmissions(dTot.total_admissions)}
                        </div>
                      </td>
                    );
                  })}
                </tr>

                {/* 2. Movie Rows */}
                {sortedMovies.length === 0 ? (
                  <tr>
                    <td
                      colSpan={
                        visibleDateRows.length + (showRangeTotal ? 2 : 1)
                      }
                      className="py-12 text-center text-slate-500 font-sans"
                    >
                      No tracked movies match the current search query.
                    </td>
                  </tr>
                ) : (
                  sortedMovies.map((movie) => {
                    const stats = movieRangeStats[movie.id] || {
                      revenue: 0,
                      admissions: 0,
                      days: 0,
                    };

                    return (
                      <tr
                        key={movie.id}
                        className="hover:bg-slate-800/40 transition"
                      >
                        {/* Sticky Movie Column (Solid Dark Background) */}
                        <td className="py-2 px-3 sticky left-0 z-20 bg-slate-900 border-r border-slate-800 font-sans w-[200px] min-w-[200px]">
                          <div className="flex items-center space-x-2.5">
                            {movie.poster_url ? (
                              <img
                                src={movie.poster_url}
                                alt={movie.title}
                                className="w-7 h-10 object-cover rounded shadow border border-slate-800 flex-shrink-0"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-7 h-10 rounded bg-slate-800 flex items-center justify-center text-slate-500 flex-shrink-0">
                                <Film className="w-3.5 h-3.5" />
                              </div>
                            )}
                            <div className="overflow-hidden leading-tight">
                              <div
                                onClick={() => onSelectMovie(movie.id)}
                                className="font-bold text-slate-200 text-xs truncate hover:text-amber-400 hover:underline cursor-pointer transition"
                                title={movie.title}
                              >
                                {movie.title}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                                {movie.release_date
                                  ? `Rel: ${movie.release_date.slice(5)}`
                                  : "N/A"}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Sticky Range Total Cell for this Movie */}
                        {showRangeTotal && (
                          <td
                            className={`py-2 px-3 text-right border-r border-slate-800 bg-slate-900/95 sticky ${rangeTotalLeftOffset} z-20 font-bold text-emerald-400 w-[110px] min-w-[110px]`}
                          >
                            <div>{formatCompactCurrency(stats.revenue)}</div>
                            <div className="text-[10px] text-slate-500 font-sans font-normal">
                              {formatCompactAdmissions(stats.admissions)}
                            </div>
                          </td>
                        )}

                        {/* Compact Per-Date Cells for this Movie */}
                        {visibleDateRows.map((dRow) => {
                          const mData = dRow.movie_data[movie.id];
                          const dayNumber = calculateReleaseDayNumber(
                            dRow.operational_date,
                            movie.release_date
                          );

                          if (
                            !mData ||
                            (mData.revenue === 0 && mData.shows === 0)
                          ) {
                            return (
                              <td
                                key={dRow.operational_date}
                                className="py-2 px-2 text-center text-slate-700 border-r border-slate-800/30 font-sans text-xs"
                              >
                                —
                              </td>
                            );
                          }

                          return (
                            <td
                              key={dRow.operational_date}
                              className="py-2 px-2 text-right border-r border-slate-800/40 leading-tight"
                            >
                              {/* Top Line: Compact Revenue + Superscript Inline Day Number */}
                              <div
                                className={`font-bold ${
                                  mData.is_live
                                    ? "text-amber-300"
                                    : "text-slate-100"
                                }`}
                              >
                                {formatCompactCurrency(mData.revenue)}
                                {dayNumber !== null && (
                                  <span
                                    className="ml-1 text-[9px] font-medium font-sans text-slate-400"
                                    title={`Day ${dayNumber} of release`}
                                  >
                                    (D{dayNumber})
                                  </span>
                                )}
                              </div>

                              {/* Sub-Line: Compact Admissions */}
                              <div className="text-[10px] text-slate-500 font-sans mt-0.5">
                                {formatCompactAdmissions(mData.admissions)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            /* ================= COMPACT TRANSPOSED RELEASE DAY MATRIX VIEW ================= */
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-medium">
                  <th className="py-2.5 px-3 sticky left-0 z-30 bg-slate-950 border-r border-slate-800 font-bold w-[200px] min-w-[200px]">
                    Tracked Movie
                  </th>
                  {showRangeTotal && (
                    <th
                      className={`py-2.5 px-3 border-r border-slate-800 text-right font-bold text-amber-300 w-[110px] min-w-[110px] bg-slate-950 sticky ${rangeTotalLeftOffset} z-30`}
                    >
                      Total
                    </th>
                  )}
                  {releaseDayData.sortedDays.map((dayNum) => (
                    <th
                      key={dayNum}
                      className="py-2.5 px-2 min-w-[85px] border-r border-slate-800/60 text-right font-bold text-slate-200"
                    >
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-[11px]">
                        Day {dayNum}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {/* Industry Day Total Row */}
                <tr className="bg-slate-950/90 border-b-2 border-slate-800 text-slate-100 font-bold">
                  <td className="py-2.5 px-3 sticky left-0 z-20 bg-slate-950 border-r border-slate-800 font-sans text-amber-400 font-bold w-[200px] min-w-[200px]">
                    Industry Total
                  </td>
                  {showRangeTotal && (
                    <td
                      className={`py-2.5 px-3 text-right text-amber-400 border-r border-slate-800 bg-slate-950 sticky ${rangeTotalLeftOffset} z-20 w-[110px] min-w-[110px]`}
                    >
                      {formatCompactCurrency(grandTotal.revenue)}
                    </td>
                  )}
                  {releaseDayData.sortedDays.map((dayNum) => {
                    const dTot = releaseDayData.dayTotals[dayNum] || {
                      revenue: 0,
                      admissions: 0,
                    };
                    return (
                      <td
                        key={dayNum}
                        className="py-2.5 px-2 text-right border-r border-slate-800/60 font-bold text-emerald-400 bg-slate-950/60"
                      >
                        {formatCompactCurrency(dTot.revenue)}
                      </td>
                    );
                  })}
                </tr>

                {sortedMovies.map((movie) => {
                  const stats = movieRangeStats[movie.id] || {
                    revenue: 0,
                    admissions: 0,
                    days: 0,
                  };

                  return (
                    <tr
                      key={movie.id}
                      className="hover:bg-slate-800/40 transition"
                    >
                      <td className="py-2 px-3 sticky left-0 z-20 bg-slate-900 border-r border-slate-800 font-sans w-[200px] min-w-[200px]">
                        <div className="flex items-center space-x-2.5">
                          {movie.poster_url ? (
                            <img
                              src={movie.poster_url}
                              alt={movie.title}
                              className="w-7 h-10 object-cover rounded shadow border border-slate-800 flex-shrink-0"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-7 h-10 rounded bg-slate-800 flex items-center justify-center text-slate-500 flex-shrink-0">
                              <Film className="w-3.5 h-3.5" />
                            </div>
                          )}
                          <div className="overflow-hidden leading-tight">
                            <div
                              onClick={() => onSelectMovie(movie.id)}
                              className="font-bold text-slate-200 text-xs truncate hover:text-amber-400 hover:underline cursor-pointer transition"
                            >
                              {movie.title}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {movie.release_date
                                ? `Rel: ${movie.release_date.slice(5)}`
                                : "N/A"}
                            </div>
                          </div>
                        </div>
                      </td>

                      {showRangeTotal && (
                        <td
                          className={`py-2 px-3 text-right border-r border-slate-800 bg-slate-900/95 sticky ${rangeTotalLeftOffset} z-20 font-bold text-emerald-400 w-[110px] min-w-[110px]`}
                        >
                          {formatCompactCurrency(stats.revenue)}
                        </td>
                      )}

                      {releaseDayData.sortedDays.map((dayNum) => {
                        const mData =
                          releaseDayData.dayMovieMatrix[dayNum]?.[movie.id];
                        if (!mData) {
                          return (
                            <td
                              key={dayNum}
                              className="py-2 px-2 text-center text-slate-700 border-r border-slate-800/30 font-sans text-xs"
                            >
                              —
                            </td>
                          );
                        }

                        return (
                          <td
                            key={dayNum}
                            className="py-2 px-2 text-right border-r border-slate-800/40 leading-tight"
                          >
                            <div className="font-bold text-slate-100">
                              {formatCompactCurrency(mData.revenue)}
                            </div>
                            <div className="text-[10px] text-slate-500 font-sans">
                              {mData.date.slice(5)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
