import React, { useState, useEffect, useCallback, useRef } from "react";
import { cleanMovieTitle } from "../utils/title";
import {
  ArrowLeft,
  Film,
  Building,
  Calendar,
  Clock,
  TrendingUp,
  Euro,
  Users,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  Info,
  ChevronRight,
  BarChart2,
  Activity,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Ticket,
  BarChart3,
  ChevronDown,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ComposedChart,
  Area,
} from "recharts";
import {
  MovieDetailResponse,
  IntradayComparisonResponse,
  IntradayCurvesResponse,
  IntradaySnapshot,
  MovieForecastResponse,
} from "../types";
import {
  getLisbonTimeParts,
  getCurrentTheatricalOperationalDate,
} from "../utils/scheduling";
import { fetchJson } from "../utils/api";
import { SessionDetailModal } from "./SessionDetailModal";
import { MovieDailyBreakdownView } from "./MovieDailyBreakdownView";
import { MoviePresaleCurveView } from "./MoviePresaleCurveView";
import { HourlyBreakdownView } from "./HourlyBreakdownView";
import { IntradayForecastCard } from "./IntradayForecastCard";

interface MovieDetailViewProps {
  data: MovieDetailResponse;
  onBack: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const MovieDetailView: React.FC<MovieDetailViewProps> = ({
  data,
  onBack,
  onRefresh,
  isRefreshing,
}) => {
  const { movie, overview, timeline, sessions, cinemas } = data;

  const [activeTab, setActiveTab] = useState<"daily" | "presale" | "boxoffice" | "hourly" | "timeline" | "sessions" | "cinemas">("daily");
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState<boolean>(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close More overflow menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMoreMenuOpen(false);
      }
    };

    if (isMoreMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMoreMenuOpen]);
  
  // Theatrical Operational Date calculation (6:00 AM Lisbon cutoff)
  const getLisbonOperationalDate = () => {
    return getCurrentTheatricalOperationalDate();
  };
  const todayDefaultStr = getLisbonOperationalDate();
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(todayDefaultStr);
  const [datesLoaded, setDatesLoaded] = useState<boolean>(false);
  const [targetTime, setTargetTime] = useState<string>("05:59");
  const [isNowActive, setIsNowActive] = useState<boolean>(false);
  const [comparisonData, setComparisonData] = useState<IntradayComparisonResponse | null>(null);
  const [curvesData, setCurvesData] = useState<IntradayCurvesResponse | null>(null);
  const [forecastData, setForecastData] = useState<MovieForecastResponse | null>(null);
  const [progressionData, setProgressionData] = useState<IntradaySnapshot[]>([]);
  const [curveMetric, setCurveMetric] = useState<"revenue" | "admissions" | "occupancy" | "velocity" | "shows">("revenue");
  const [isLoadingComparison, setIsLoadingComparison] = useState<boolean>(false);
  const [isLoadingCurves, setIsLoadingCurves] = useState<boolean>(false);
  const [isLoadingForecast, setIsLoadingForecast] = useState<boolean>(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState<boolean>(false);

  // Guard refs to prevent out-of-order async response race conditions
  const comparisonRequestIdRef = useRef<number>(0);
  const comparisonAbortControllerRef = useRef<AbortController | null>(null);
  const curvesRequestIdRef = useRef<number>(0);
  const curvesAbortControllerRef = useRef<AbortController | null>(null);
  const forecastRequestIdRef = useRef<number>(0);
  const forecastAbortControllerRef = useRef<AbortController | null>(null);

  // Session table filtering & sorting
  const [sessionSearch, setSessionSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [formatFilter, setFormatFilter] = useState("ALL");
  const [cinemaFilter, setCinemaFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "CURRENT" | "HISTORICAL">("ALL");
  const [sortBy, setSortBy] = useState<"occupancy" | "time" | "unavailable">("occupancy");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  // NOW button handler: captures current Lisbon time & theatrical operational date
  const handleNowClick = () => {
    const { formattedTime, operationalDate } = getLisbonTimeParts();
    setTargetTime(formattedTime);
    setSelectedDate(operationalDate);
    setIsNowActive(true);
  };

  // Manual time input or preset button change
  const handleTimeChange = (newTime: string) => {
    setTargetTime(newTime);
    setIsNowActive(false);
  };

  // Date selector change
  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    const currentOpDate = getCurrentTheatricalOperationalDate();
    if (newDate !== currentOpDate) {
      setIsNowActive(false);
    }
  };

  // Cleanup abort controllers on unmount
  useEffect(() => {
    return () => {
      comparisonAbortControllerRef.current?.abort();
      curvesAbortControllerRef.current?.abort();
      forecastAbortControllerRef.current?.abort();
    };
  }, []);

  // Fetch available dates on mount / movie change
  useEffect(() => {
    let isMounted = true;
    async function fetchDates() {
      if (!movie?.id) return;
      try {
        const json = await fetchJson<{ dates?: string[] }>(`/api/movies/${movie.id}/history-dates`);
        if (json && isMounted) {
          const dates: string[] = json.dates || [];
          setHistoryDates(dates);
          if (dates.length > 0 && !dates.includes(selectedDate)) {
            setSelectedDate(dates[0]);
          }
        }
      } catch (err) {
        console.error("Error fetching historical dates:", err);
      } finally {
        if (isMounted) {
          setDatesLoaded(true);
        }
      }
    }
    setDatesLoaded(false);
    fetchDates();
    return () => {
      isMounted = false;
    };
  }, [movie?.id]);

  // Fetch intraday comparison alone with race condition protection
  const fetchComparison = useCallback(async () => {
    if (!datesLoaded || !movie?.id) return;

    // Abort previous in-flight request
    if (comparisonAbortControllerRef.current) {
      comparisonAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    comparisonAbortControllerRef.current = controller;

    // Increment request counter to ignore stale out-of-order resolutions
    const currentRequestId = ++comparisonRequestIdRef.current;

    setIsLoadingComparison(true);
    try {
      const dateParam = selectedDate || todayDefaultStr;
      const timeParam = targetTime || "13:00";
      const json = await fetchJson<IntradayComparisonResponse>(
        `/api/movies/${movie.id}/intraday-comparison?date=${encodeURIComponent(dateParam)}&time=${encodeURIComponent(timeParam)}`,
        { signal: controller.signal }
      );
      if (json && currentRequestId === comparisonRequestIdRef.current) {
        setComparisonData(json);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Error fetching intraday comparison:", err);
      }
    } finally {
      if (currentRequestId === comparisonRequestIdRef.current) {
        setIsLoadingComparison(false);
      }
    }
  }, [movie?.id, selectedDate, targetTime, todayDefaultStr, datesLoaded]);

  useEffect(() => {
    fetchComparison();
  }, [fetchComparison]);

  // Fetch intraday curves & progression together with race condition protection
  const fetchCurvesAndProgression = useCallback(async () => {
    if (!datesLoaded || !movie?.id) return;

    // Abort previous in-flight request
    if (curvesAbortControllerRef.current) {
      curvesAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    curvesAbortControllerRef.current = controller;

    const currentRequestId = ++curvesRequestIdRef.current;
    setIsLoadingCurves(true);
    try {
      const dateParam = selectedDate || todayDefaultStr;
      const [curvesJson, progJson] = await Promise.all([
        fetchJson<IntradayCurvesResponse>(
          `/api/movies/${movie.id}/intraday-curves?date=${encodeURIComponent(dateParam)}`,
          { signal: controller.signal }
        ),
        fetchJson<{ items?: IntradaySnapshot[] }>(
          `/api/movies/${movie.id}/intraday-progression?date=${encodeURIComponent(dateParam)}`,
          { signal: controller.signal }
        ),
      ]);
      if (curvesJson && currentRequestId === curvesRequestIdRef.current) {
        setCurvesData(curvesJson);
      }
      if (progJson && currentRequestId === curvesRequestIdRef.current) {
        setProgressionData(progJson.items || []);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Error fetching intraday curves and progression:", err);
      }
    } finally {
      if (currentRequestId === curvesRequestIdRef.current) {
        setIsLoadingCurves(false);
      }
    }
  }, [movie?.id, selectedDate, todayDefaultStr, datesLoaded]);

  useEffect(() => {
    fetchCurvesAndProgression();
  }, [fetchCurvesAndProgression]);

  // Fetch intraday forecast with race condition protection
  const fetchForecast = useCallback(async () => {
    if (!datesLoaded || !movie?.id) return;

    // Abort previous in-flight request
    if (forecastAbortControllerRef.current) {
      forecastAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    forecastAbortControllerRef.current = controller;

    const currentRequestId = ++forecastRequestIdRef.current;
    setIsLoadingForecast(true);
    try {
      const dateParam = selectedDate || todayDefaultStr;
      const timeParam = targetTime || "13:00";
      const json = await fetchJson<MovieForecastResponse>(
        `/api/movies/${movie.id}/intraday-forecast?date=${encodeURIComponent(dateParam)}&time=${encodeURIComponent(timeParam)}`,
        { signal: controller.signal }
      );
      if (json && currentRequestId === forecastRequestIdRef.current) {
        setForecastData(json);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Error fetching intraday forecast:", err);
      }
    } finally {
      if (currentRequestId === forecastRequestIdRef.current) {
        setIsLoadingForecast(false);
      }
    }
  }, [movie?.id, selectedDate, targetTime, todayDefaultStr, datesLoaded]);

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  // Manual refresh handler triggered only by explicit button click
  const handleManualRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      await Promise.all([
        onRefresh(),
        fetchComparison(),
        fetchCurvesAndProgression(),
        fetchForecast(),
      ]);
    } finally {
      setIsManualRefreshing(false);
    }
  };

  // Merge intraday curves with forecast points for unified chart rendering
  const mergedCurveData = React.useMemo(() => {
    if (!curvesData?.curve) return [];
    
    // Map forecast points by time string
    const forecastMap = new Map<string, any>();
    if (forecastData?.curve) {
      for (const pt of forecastData.curve) {
        forecastMap.set(pt.time, pt);
      }
    }

    return curvesData.curve.map((item) => {
      const fc = forecastMap.get(item.time);
      return {
        ...item,
        today_revenue_actual: fc ? fc.today_revenue : item.today_revenue,
        forecast_revenue: fc ? fc.forecast_revenue : null,
        forecast_low: fc ? fc.forecast_low : null,
        forecast_high: fc ? fc.forecast_high : null,
      };
    });
  }, [curvesData, forecastData]);

  // Filter & Sort Sessions
  const filteredSessions = sessions
    .filter((s) => {
      const matchesSearch =
        s.cinema_name.toLowerCase().includes(sessionSearch.toLowerCase()) ||
        s.room_name.toLowerCase().includes(sessionSearch.toLowerCase());
      const matchesDate = dateFilter === "ALL" || s.operational_date === dateFilter;
      const matchesFormat = formatFilter === "ALL" || s.format.toUpperCase().includes(formatFilter.toUpperCase());
      const matchesCinema = cinemaFilter === "ALL" || s.cinema_name === cinemaFilter;
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "CURRENT" && s.is_current) ||
        (statusFilter === "HISTORICAL" && !s.is_current);
      return matchesSearch && matchesDate && matchesFormat && matchesCinema && matchesStatus;
    })
    .sort((a, b) => {
      if (sortBy === "occupancy") return b.occupancy_proxy - a.occupancy_proxy;
      if (sortBy === "unavailable") return b.unavailable_seats - a.unavailable_seats;
      if (sortBy === "time") return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
      return 0;
    });

  const uniqueDates = Array.from(new Set(sessions.map((s) => s.operational_date).filter(Boolean))).sort().reverse();
  const uniqueFormats = Array.from(new Set(sessions.map((s) => s.format).filter(Boolean)));
  const uniqueCinemas = Array.from(new Set(sessions.map((s) => s.cinema_name)));

  // Percent change calculator helper
  const calcChange = (curr: number, base: number) => {
    if (!base || base === 0) return null;
    const pct = ((curr - base) / base) * 100;
    return pct;
  };

  return (
    <div className="space-y-6">
      {/* Session History Modal */}
      {selectedSessionId && (
        <SessionDetailModal
          sessionId={selectedSessionId}
          onClose={() => setSelectedSessionId(null)}
        />
      )}

      {/* Operational Notice Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 flex items-start sm:items-center gap-3 text-slate-300 text-xs">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
        <div>
          <span className="font-semibold text-amber-200">Theatrical Day Pipeline & Deterministic EOD Forecast: </span>
          Theatrical day operates on 06:00 → 05:59 Lisbon time. Forecast models dynamically synthesize historical comparable trajectories (same weekday -7d, -1d, run-average) adjusted for live sales momentum and remaining scheduled session capacity.
        </div>
      </div>

      {/* Header & Back Button */}
      <div className="flex items-center justify-between">
        <button
          id="detail-back-btn"
          onClick={onBack}
          className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition font-medium text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to All Tracked Movies</span>
        </button>

        <button
          id="detail-refresh-btn"
          onClick={handleManualRefresh}
          disabled={isManualRefreshing}
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 text-sm font-medium transition disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isManualRefreshing ? "animate-spin text-amber-400" : "text-slate-400"}`} />
          <span>{isManualRefreshing ? "Refreshing..." : "Refresh Metrics"}</span>
        </button>
      </div>

      {/* Movie Hero Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="w-20 h-28 bg-slate-800 rounded-xl overflow-hidden shrink-0 flex items-center justify-center border border-slate-700 shadow-md">
            {movie.poster_url ? (
              <img src={movie.poster_url} alt={movie.title} className="w-full h-full object-cover" />
            ) : (
              <Film className="w-8 h-8 text-slate-600" />
            )}
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-100">{cleanMovieTitle(movie.title)}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Tracking Active
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                {movie.duration ? `${movie.duration} mins` : "Standard Duration"}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                Release: {movie.release_date || "Current Season"}
              </span>
              <span className="flex items-center gap-1 font-mono text-slate-500">
                ID: {movie.external_id.slice(0, 8)}...
              </span>
            </div>

            <p className="text-xs text-slate-400 max-w-2xl">
              Real-time OutSystems seat map telemetry across Portuguese theatrical exhibitors. Preserving all historical session observations for intraday curve analysis.
            </p>
          </div>

          {/* Current Active Inventory Overview Badge */}
          <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl text-right shrink-0">
            <div className="text-[11px] text-amber-400 font-semibold uppercase tracking-wider mb-1">
              Active Inventory (Upcoming)
            </div>
            <div className="text-xl font-black text-slate-100">
              {overview.sessions_count} <span className="text-xs font-normal text-slate-400">Sessions</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {overview.cinemas_count} Cinemas • {overview.sellable_capacity.toLocaleString()} Sellable Capacity
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs: Most used tabs visible + "More ▾" overflow menu */}
      {(() => {
        const isOverflowActive = activeTab === "presale" || activeTab === "timeline" || activeTab === "cinemas";
        const overflowLabel =
          activeTab === "presale"
            ? "More: Pre-Sale (T-Curve)"
            : activeTab === "timeline"
            ? "More: Timeline"
            : activeTab === "cinemas"
            ? "More: Cinemas"
            : "More";

        return (
          <div className="flex border-b border-slate-800 space-x-6 text-sm font-medium overflow-visible relative">
            <button
              id="tab-daily-breakdown-btn"
              onClick={() => setActiveTab("daily")}
              className={`pb-3 transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === "daily"
                  ? "border-amber-500 text-amber-400 font-semibold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Calendar className="w-4 h-4 text-amber-400" />
              <span>Daily Breakdown</span>
            </button>

            <button
              id="tab-boxoffice-btn"
              onClick={() => setActiveTab("boxoffice")}
              className={`pb-3 transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === "boxoffice"
                  ? "border-amber-500 text-amber-400 font-semibold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <BarChart2 className="w-4 h-4 text-amber-400" />
              <span>Box Office & Intraday Comparison</span>
            </button>

            <button
              id="tab-hourly-btn"
              onClick={() => setActiveTab("hourly")}
              className={`pb-3 transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === "hourly"
                  ? "border-amber-500 text-amber-400 font-semibold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Clock className="w-4 h-4 text-amber-400" />
              <span>Hourly Breakdown</span>
            </button>

            <button
              id="tab-sessions-btn"
              onClick={() => setActiveTab("sessions")}
              className={`pb-3 transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === "sessions"
                  ? "border-amber-500 text-amber-400 font-semibold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Ticket className="w-4 h-4 text-emerald-400" />
              <span>Individual Sessions ({sessions.length})</span>
            </button>

            {/* Overflow "More ▾" Menu */}
            <div className="relative" ref={moreMenuRef}>
              <button
                id="tab-more-menu-btn"
                onClick={() => setIsMoreMenuOpen((prev) => !prev)}
                className={`pb-3 transition border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  isOverflowActive
                    ? "border-amber-500 text-amber-400 font-semibold"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>{overflowLabel}</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isMoreMenuOpen ? "rotate-180 text-amber-400" : ""}`} />
              </button>

              {isMoreMenuOpen && (
                <div className="absolute left-0 top-full mt-1 w-64 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl py-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                  <button
                    id="tab-more-presale-btn"
                    onClick={() => {
                      setActiveTab("presale");
                      setIsMoreMenuOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between text-xs transition cursor-pointer ${
                      activeTab === "presale"
                        ? "bg-amber-500/10 text-amber-400 font-semibold"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Opening Day Pre-Sale</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium">T-Curve</span>
                  </button>

                  <button
                    id="tab-more-timeline-btn"
                    onClick={() => {
                      setActiveTab("timeline");
                      setIsMoreMenuOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between text-xs transition cursor-pointer ${
                      activeTab === "timeline"
                        ? "bg-amber-500/10 text-amber-400 font-semibold"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>Timeline & Growth Sweeps</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">{timeline.length}</span>
                  </button>

                  <button
                    id="tab-more-cinemas-btn"
                    onClick={() => {
                      setActiveTab("cinemas");
                      setIsMoreMenuOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between text-xs transition cursor-pointer ${
                      activeTab === "cinemas"
                        ? "bg-amber-500/10 text-amber-400 font-semibold"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Building className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>Cinema Venues</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">{cinemas.length}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* TAB 0: DAILY BOX OFFICE BREAKDOWN */}
      {activeTab === "daily" && (
        <MovieDailyBreakdownView movieId={movie.id} movieTitle={movie.title} />
      )}

      {/* TAB 0.5: OPENING DAY PRESALE CURVE */}
      {activeTab === "presale" && (
        <MoviePresaleCurveView movieId={movie.id} movieTitle={movie.title} />
      )}

      {/* TAB 1: BOX OFFICE & INTRADAY PERFORMANCE */}
      {activeTab === "boxoffice" && (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap w-full md:w-auto">
              <div>
                <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1 font-semibold">
                  Select Target Date
                </label>
                <select
                  id="intraday-date-select"
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-xl px-3 py-2 font-medium focus:ring-1 focus:ring-amber-500 outline-none cursor-pointer"
                >
                  {historyDates.length === 0 ? (
                    <option value={todayDefaultStr}>{todayDefaultStr} (Today)</option>
                  ) : (
                    historyDates.map((d) => (
                      <option key={d} value={d}>
                        {d} {d === todayDefaultStr ? "(Today)" : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                    Intraday Comparison Time
                  </label>
                  {isNowActive && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      LIVE LISBON TIME
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    id="intraday-time-input"
                    type="time"
                    value={targetTime}
                    onChange={(e) => handleTimeChange(e.target.value)}
                    className={`bg-slate-800 border text-xs rounded-xl px-3 py-2 font-mono outline-none transition ${
                      isNowActive
                        ? "border-amber-500 text-amber-300 ring-1 ring-amber-500/50"
                        : "border-slate-700 text-slate-100 focus:ring-1 focus:ring-amber-500"
                    }`}
                  />

                  {/* NOW Button */}
                  <button
                    id="btn-now-time"
                    type="button"
                    onClick={handleNowClick}
                    title="Instantly set comparison to exact current Lisbon time and theatrical date"
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm ${
                      isNowActive
                        ? "bg-amber-500 text-slate-950 shadow-amber-500/20 font-black"
                        : "bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 hover:border-amber-500/50"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isNowActive ? "bg-slate-950 animate-pulse" : "bg-amber-400"}`} />
                    <span>NOW</span>
                  </button>

                  <div className="flex items-center gap-1 flex-wrap">
                    {[
                      { t: "10:00", label: "10:00" },
                      { t: "14:00", label: "14:00" },
                      { t: "18:00", label: "18:00" },
                      { t: "21:00", label: "21:00" },
                      { t: "23:59", label: "23:59" },
                      { t: "05:59", label: "05:59 (EOD)" },
                    ].map(({ t, label }) => (
                      <button
                        key={t}
                        id={`btn-preset-${t.replace(":", "")}`}
                        type="button"
                        onClick={() => handleTimeChange(t)}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-mono transition cursor-pointer ${
                          !isNowActive && targetTime === t
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
                            : "bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-transparent"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="text-right text-xs text-slate-400 space-y-0.5">
              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                <span>Comparing</span>
                <span className="font-semibold text-amber-300">
                  {selectedDate} @ {targetTime}
                </span>
                {isNowActive && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    LIVE NOW
                  </span>
                )}
                <span>vs Previous Day & Previous Week</span>
              </div>
              <div className="text-[11px] text-slate-500">
                Theatrical Day Cutoff: <span className="text-slate-400">06:00 AM Lisbon</span> (showtimes 00:00–05:59 count towards previous operational date)
              </div>
            </div>
          </div>

          {/* Intraday Comparison Cards: TODAY vs YESTERDAY vs SAME WEEKDAY LAST WEEK */}
          {comparisonData && (
            <div className={`grid grid-cols-1 md:grid-cols-3 gap-5 transition-opacity duration-150 ${isLoadingComparison ? "opacity-60 pointer-events-none" : "opacity-100"}`}>
              {/* TODAY / Target Day Card */}
              <div id="card-comparison-today" className="bg-slate-900 border-2 border-amber-500/40 rounded-2xl p-5 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-amber-500/20 text-amber-300 px-3 py-1 rounded-bl-xl text-[10px] font-bold uppercase tracking-wider border-b border-l border-amber-500/30">
                  Target Date
                </div>

                <div className="flex items-center justify-between text-amber-400 font-bold text-sm mb-1">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>{comparisonData.today.date}</span>
                    <span className="text-slate-400 text-xs font-normal">@ {targetTime}</span>
                    {isNowActive && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        NOW
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-4">
                  <span>Intraday state up to {targetTime}</span>
                  {comparisonData.today.time && comparisonData.today.time !== targetTime && (
                    <span className="text-[11px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700 font-mono" title="Latest available collector sweep before requested cutoff">
                      Latest sweep: <span className="text-amber-300 font-semibold">{comparisonData.today.time}</span>
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-slate-400 uppercase tracking-wider">Est. Revenue</div>
                    <div className="text-2xl font-black text-emerald-400">
                      {comparisonData.today.estimated_revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800 text-xs">
                    <div>
                      <div className="text-slate-400">Est. Admissions</div>
                      <div className="font-bold text-slate-100 text-base">{comparisonData.today.estimated_admissions.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Occupancy Proxy</div>
                      <div className="font-bold text-amber-400 text-base">{(comparisonData.today.occupancy_proxy * 100).toFixed(1)}%</div>
                    </div>
                  </div>

                  {/* Showcount First-Class Metrics */}
                  <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl text-xs space-y-2">
                    <div className="flex items-center justify-between text-slate-300 font-semibold border-b border-slate-800/80 pb-1.5">
                      <span>Showcount (NOS Sessions)</span>
                      <span className="text-amber-400 font-bold">{comparisonData.today.showcount_total} Total</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[11px] text-center font-mono">
                      <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                        <div className="text-slate-500 text-[9px] uppercase">Completed</div>
                        <div className="font-bold text-emerald-400">{comparisonData.today.shows_completed}</div>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                        <div className="text-slate-500 text-[9px] uppercase">Started</div>
                        <div className="font-bold text-amber-400">{comparisonData.today.shows_started}</div>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                        <div className="text-slate-500 text-[9px] uppercase">Remaining</div>
                        <div className="font-bold text-cyan-400">{comparisonData.today.shows_remaining}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs">
                    <div>
                      <div className="text-slate-400 text-[11px]">Revenue / Show</div>
                      <div className="font-bold text-slate-200">
                        {comparisonData.today.showcount_total > 0 ? `${comparisonData.today.revenue_per_show.toFixed(2)} €` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[11px]">Admissions / Show</div>
                      <div className="font-bold text-slate-200">
                        {comparisonData.today.showcount_total > 0 ? `${comparisonData.today.admissions_per_show.toFixed(1)} seats` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[11px]">ATP</div>
                      <div className="font-bold text-slate-200">
                        {comparisonData.today.estimated_admissions > 0
                          ? `${(comparisonData.today.estimated_revenue / comparisonData.today.estimated_admissions).toFixed(2)} €`
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 pt-1 flex items-center justify-between">
                    <span>Sales Velocity:</span>
                    <span className="font-mono text-cyan-300 font-medium">{comparisonData.today.sales_velocity.toFixed(1)} seats/hr</span>
                  </div>
                </div>
              </div>

              {/* YESTERDAY Card */}
              <div id="card-comparison-yesterday" className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                    <Calendar className="w-4 h-4" />
                    <span>Yesterday</span>
                    <span className="text-slate-400 text-xs font-normal">({comparisonData.yesterday.date})</span>
                    <span className="text-slate-400 text-xs font-normal">@ {targetTime}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-4">
                  <span>Previous day up to {targetTime}</span>
                  {comparisonData.yesterday.time && comparisonData.yesterday.time !== targetTime && (
                    <span className="text-[11px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700 font-mono" title="Latest available collector sweep before requested cutoff">
                      Latest sweep: <span className="text-cyan-300 font-semibold">{comparisonData.yesterday.time}</span>
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-slate-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Est. Revenue</span>
                      {(() => {
                        const change = calcChange(comparisonData.today.estimated_revenue, comparisonData.yesterday.estimated_revenue);
                        if (change === null) return null;
                        return (
                          <span className={`text-[11px] font-bold flex items-center ${change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {change >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                            {Math.abs(change).toFixed(1)}% vs yesterday
                          </span>
                        );
                      })()}
                    </div>
                    <div className="text-2xl font-black text-slate-200">
                      {comparisonData.yesterday.estimated_revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800 text-xs">
                    <div>
                      <div className="text-slate-400">Est. Admissions</div>
                      <div className="font-bold text-slate-200 text-base">{comparisonData.yesterday.estimated_admissions.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Occupancy Proxy</div>
                      <div className="font-bold text-cyan-300 text-base">{(comparisonData.yesterday.occupancy_proxy * 100).toFixed(1)}%</div>
                    </div>
                  </div>

                  {/* Showcount Stats */}
                  <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl text-xs space-y-2">
                    <div className="flex items-center justify-between text-slate-300 font-semibold border-b border-slate-800/80 pb-1.5">
                      <span>Showcount</span>
                      <span className="text-cyan-400 font-bold">{comparisonData.yesterday.showcount_total} Total</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[11px] text-center font-mono">
                      <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                        <div className="text-slate-500 text-[9px] uppercase">Completed</div>
                        <div className="font-bold text-slate-200">{comparisonData.yesterday.shows_completed}</div>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                        <div className="text-slate-500 text-[9px] uppercase">Started</div>
                        <div className="font-bold text-slate-200">{comparisonData.yesterday.shows_started}</div>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                        <div className="text-slate-500 text-[9px] uppercase">Remaining</div>
                        <div className="font-bold text-slate-200">{comparisonData.yesterday.shows_remaining}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs">
                    <div>
                      <div className="text-slate-400 text-[11px]">Revenue / Show</div>
                      <div className="font-bold text-slate-200">
                        {comparisonData.yesterday.showcount_total > 0 ? `${comparisonData.yesterday.revenue_per_show.toFixed(2)} €` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[11px]">Admissions / Show</div>
                      <div className="font-bold text-slate-200">
                        {comparisonData.yesterday.showcount_total > 0 ? `${comparisonData.yesterday.admissions_per_show.toFixed(1)} seats` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[11px]">ATP</div>
                      <div className="font-bold text-slate-200">
                        {comparisonData.yesterday.estimated_admissions > 0
                          ? `${(comparisonData.yesterday.estimated_revenue / comparisonData.yesterday.estimated_admissions).toFixed(2)} €`
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 pt-1 flex items-center justify-between">
                    <span>Sales Velocity:</span>
                    <span className="font-mono text-slate-300 font-medium">{comparisonData.yesterday.sales_velocity.toFixed(1)} seats/hr</span>
                  </div>
                </div>
              </div>

              {/* SAME WEEKDAY LAST WEEK Card */}
              <div id="card-comparison-lastweek" className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 text-purple-400 font-bold text-sm">
                    <Calendar className="w-4 h-4" />
                    <span>Same Weekday Last Week</span>
                    <span className="text-slate-400 text-xs font-normal">({comparisonData.last_week.date})</span>
                    <span className="text-slate-400 text-xs font-normal">@ {targetTime}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-4">
                  <span>Same day of week (-7d) up to {targetTime}</span>
                  {comparisonData.last_week.time && comparisonData.last_week.time !== targetTime && (
                    <span className="text-[11px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700 font-mono" title="Latest available collector sweep before requested cutoff">
                      Latest sweep: <span className="text-purple-300 font-semibold">{comparisonData.last_week.time}</span>
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-slate-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Est. Revenue</span>
                      {(() => {
                        const change = calcChange(comparisonData.today.estimated_revenue, comparisonData.last_week.estimated_revenue);
                        if (change === null) return null;
                        return (
                          <span className={`text-[11px] font-bold flex items-center ${change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {change >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                            {Math.abs(change).toFixed(1)}% vs last week
                          </span>
                        );
                      })()}
                    </div>
                    <div className="text-2xl font-black text-slate-200">
                      {comparisonData.last_week.estimated_revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800 text-xs">
                    <div>
                      <div className="text-slate-400">Est. Admissions</div>
                      <div className="font-bold text-slate-200 text-base">{comparisonData.last_week.estimated_admissions.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Occupancy Proxy</div>
                      <div className="font-bold text-purple-300 text-base">{(comparisonData.last_week.occupancy_proxy * 100).toFixed(1)}%</div>
                    </div>
                  </div>

                  {/* Showcount Stats */}
                  <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl text-xs space-y-2">
                    <div className="flex items-center justify-between text-slate-300 font-semibold border-b border-slate-800/80 pb-1.5">
                      <span>Showcount</span>
                      <span className="text-purple-400 font-bold">{comparisonData.last_week.showcount_total} Total</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[11px] text-center font-mono">
                      <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                        <div className="text-slate-500 text-[9px] uppercase">Completed</div>
                        <div className="font-bold text-slate-200">{comparisonData.last_week.shows_completed}</div>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                        <div className="text-slate-500 text-[9px] uppercase">Started</div>
                        <div className="font-bold text-slate-200">{comparisonData.last_week.shows_started}</div>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                        <div className="text-slate-500 text-[9px] uppercase">Remaining</div>
                        <div className="font-bold text-slate-200">{comparisonData.last_week.shows_remaining}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs">
                    <div>
                      <div className="text-slate-400 text-[11px]">Revenue / Show</div>
                      <div className="font-bold text-slate-200">
                        {comparisonData.last_week.showcount_total > 0 ? `${comparisonData.last_week.revenue_per_show.toFixed(2)} €` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[11px]">Admissions / Show</div>
                      <div className="font-bold text-slate-200">
                        {comparisonData.last_week.showcount_total > 0 ? `${comparisonData.last_week.admissions_per_show.toFixed(1)} seats` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[11px]">ATP</div>
                      <div className="font-bold text-slate-200">
                        {comparisonData.last_week.estimated_admissions > 0
                          ? `${(comparisonData.last_week.estimated_revenue / comparisonData.last_week.estimated_admissions).toFixed(2)} €`
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 pt-1 flex items-center justify-between">
                    <span>Sales Velocity:</span>
                    <span className="font-mono text-slate-300 font-medium">{comparisonData.last_week.sales_velocity.toFixed(1)} seats/hr</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Intraday End-of-Day Revenue Forecast Summary Card */}
          <IntradayForecastCard
            forecastData={forecastData}
            isLoading={isLoadingForecast}
            selectedDate={selectedDate}
            targetTime={targetTime}
            isNowActive={isNowActive}
          />

          {/* Intraday Cumulative Time-Series Curves Chart */}
          {curvesData && curvesData.curve && (
            <div id="chart-intraday-curves" className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="font-bold text-slate-100 text-lg flex items-center gap-2">
                    <span>Intraday Performance Curves</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
                      Hourly Time-Series
                    </span>
                    {curveMetric === "revenue" && !forecastData?.is_day_complete && forecastData?.forecast && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/40 font-mono font-bold">
                        EOD Forecast Active
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {curveMetric === "revenue" && !forecastData?.is_day_complete
                      ? `Actual tracked revenue (Solid Gold) & Projected EOD trajectory (Dashed Gold) for ${selectedDate} vs Yesterday (${curvesData.yesterday_date}, Cyan) vs Last Week (${curvesData.last_week_date}, Purple)`
                      : `Cumulative trajectory for ${selectedDate} (Gold) vs Yesterday (${curvesData.yesterday_date}, Cyan) vs Same Weekday Last Week (${curvesData.last_week_date}, Purple)`}
                  </p>
                </div>

                {/* Metric Selector Buttons */}
                <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/80 text-xs">
                  <button
                    onClick={() => setCurveMetric("revenue")}
                    className={`px-3 py-1.5 rounded-lg font-medium transition ${
                      curveMetric === "revenue"
                        ? "bg-amber-500 text-slate-950 font-bold shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Revenue (€)
                  </button>
                  <button
                    onClick={() => setCurveMetric("admissions")}
                    className={`px-3 py-1.5 rounded-lg font-medium transition ${
                      curveMetric === "admissions"
                        ? "bg-amber-500 text-slate-950 font-bold shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Admissions
                  </button>
                  <button
                    onClick={() => setCurveMetric("occupancy")}
                    className={`px-3 py-1.5 rounded-lg font-medium transition ${
                      curveMetric === "occupancy"
                        ? "bg-amber-500 text-slate-950 font-bold shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Occupancy %
                  </button>
                  <button
                    onClick={() => setCurveMetric("velocity")}
                    className={`px-3 py-1.5 rounded-lg font-medium transition ${
                      curveMetric === "velocity"
                        ? "bg-amber-500 text-slate-950 font-bold shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Velocity
                  </button>
                </div>
              </div>

              {/* Chart */}
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={mergedCurveData.length > 0 ? mergedCurveData : curvesData.curve}
                    margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="forecastAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} />
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                    <YAxis
                      stroke="#94a3b8"
                      fontSize={12}
                      tickFormatter={(val) =>
                        curveMetric === "revenue"
                          ? `${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val} €`
                          : curveMetric === "occupancy"
                          ? `${val}%`
                          : val
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "12px",
                        color: "#f8fafc",
                      }}
                      itemStyle={{ color: "#f8fafc" }}
                      labelStyle={{ color: "#94a3b8", fontWeight: 600, marginBottom: "4px" }}
                      formatter={(value: any, name: any) => {
                        if (value === null || value === undefined) return ["—", name];
                        if (curveMetric === "revenue") {
                          return [`${Number(value).toLocaleString()} €`, name];
                        }
                        if (curveMetric === "occupancy") {
                          return [`${value}%`, name];
                        }
                        return [value, name];
                      }}
                    />
                    <Legend wrapperStyle={{ paddingTop: "15px" }} />

                    {/* Shaded Forecast Uncertainty Range Area */}
                    {curveMetric === "revenue" && !forecastData?.is_day_complete && (
                      <Area
                        type="monotone"
                        dataKey="forecast_high"
                        stroke="none"
                        fill="url(#forecastAreaGrad)"
                        name="Forecast Range (Upper Bound)"
                        legendType="none"
                      />
                    )}

                    {/* Target Actual Line */}
                    {curveMetric === "revenue" && !forecastData?.is_day_complete ? (
                      <Line
                        type="monotone"
                        dataKey="today_revenue_actual"
                        name={`Actual (${selectedDate})`}
                        stroke="#f59e0b"
                        strokeWidth={3.5}
                        dot={{ r: 3, fill: "#f59e0b" }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    ) : (
                      <Line
                        type="monotone"
                        dataKey={
                          curveMetric === "revenue"
                            ? "today_revenue"
                            : curveMetric === "admissions"
                            ? "today_admissions"
                            : curveMetric === "occupancy"
                            ? "today_occupancy"
                            : "today_velocity"
                        }
                        name={`Target (${selectedDate})`}
                        stroke="#f59e0b"
                        strokeWidth={3.5}
                        dot={{ r: 3, fill: "#f59e0b" }}
                        activeDot={{ r: 6 }}
                      />
                    )}

                    {/* Projected Forecast Trajectory Line (Dashed) */}
                    {curveMetric === "revenue" && !forecastData?.is_day_complete && (
                      <Line
                        type="monotone"
                        dataKey="forecast_revenue"
                        name={`EOD Forecast (Exp: ${
                          forecastData?.forecast?.expected
                            ? forecastData.forecast.expected >= 1000
                              ? (forecastData.forecast.expected / 1000).toFixed(1) + "k €"
                              : forecastData.forecast.expected.toLocaleString() + " €"
                            : "—"
                        })`}
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        strokeDasharray="5 5"
                        dot={{ r: 3, fill: "#fbbf24", strokeDasharray: "none" }}
                        connectNulls={false}
                      />
                    )}

                    {/* Yesterday Curve */}
                    <Line
                      type="monotone"
                      dataKey={
                        curveMetric === "revenue"
                          ? "yesterday_revenue"
                          : curveMetric === "admissions"
                          ? "yesterday_admissions"
                          : curveMetric === "occupancy"
                          ? "yesterday_occupancy"
                          : "yesterday_velocity"
                      }
                      name={`Yesterday (${curvesData.yesterday_date})`}
                      stroke="#06b6d4"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                    />

                    {/* Same Weekday Last Week Curve */}
                    <Line
                      type="monotone"
                      dataKey={
                        curveMetric === "revenue"
                          ? "last_week_revenue"
                          : curveMetric === "admissions"
                          ? "last_week_admissions"
                          : curveMetric === "occupancy"
                          ? "last_week_occupancy"
                          : "last_week_velocity"
                      }
                      name={`Same Weekday Last Week (${curvesData.last_week_date})`}
                      stroke="#a855f7"
                      strokeWidth={2}
                      strokeDasharray="6 6"
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Intraday Progression Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow w-full">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <div>
                <h3 className="font-bold text-slate-200 text-sm">
                  Intraday Sweep Progression Log ({selectedDate})
                </h3>
                <p className="text-xs text-slate-400">Chronological observation sweeps stored per collection run</p>
              </div>
              <span className="text-xs font-mono text-cyan-400 bg-slate-800 px-2.5 py-1 rounded-lg">
                {progressionData.length} Observations
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs table-auto">
                <thead className="bg-slate-800/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 text-[10px] sm:text-xs">
                  <tr>
                    <th className="py-2 px-2 sm:py-3 sm:px-3">Time</th>
                    <th className="py-2 px-2 sm:py-3 sm:px-3 text-center">Shows</th>
                    <th className="py-2 px-2 sm:py-3 sm:px-3 text-right">Capacity</th>
                    <th className="py-2 px-2 sm:py-3 sm:px-3 text-right">Admissions</th>
                    <th className="py-2 px-2 sm:py-3 sm:px-3 text-right">Occ %</th>
                    <th className="py-2 px-2 sm:py-3 sm:px-3 text-right">Revenue</th>
                    <th className="py-2 px-2 sm:py-3 sm:px-3 text-right">Rev/Show</th>
                    <th className="py-2 px-2 sm:py-3 sm:px-3 text-right">Velocity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200 font-mono text-[11px] sm:text-xs">
                  {progressionData.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                        No collection sweeps recorded for {selectedDate} yet.
                      </td>
                    </tr>
                  ) : (
                    progressionData.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/50 transition">
                        <td className="py-2 px-2 sm:py-3 sm:px-3 font-bold text-amber-400 font-sans whitespace-nowrap">
                          {item.time}
                          <span className="text-[9px] sm:text-[10px] text-slate-500 font-mono block mt-0.5">
                            {new Date(item.snapshot_timestamp || item.timestamp || item.created_at || item.date).toLocaleDateString(undefined, { timeZone: "Europe/Lisbon" })}
                          </span>
                        </td>
                        <td className="py-2 px-2 sm:py-3 sm:px-3 text-center font-sans whitespace-nowrap">
                          <span className="font-bold text-slate-200">{item.showcount_total}</span>
                          <span className="text-slate-500 text-[9px] sm:text-[10px] block mt-0.5 leading-tight">
                            ({item.shows_started} start / {item.shows_completed} comp)
                          </span>
                        </td>
                        <td className="py-2 px-2 sm:py-3 sm:px-3 text-right text-slate-400">{item.sellable_capacity.toLocaleString()}</td>
                        <td className="py-2 px-2 sm:py-3 sm:px-3 text-right text-cyan-300 font-bold">{item.estimated_admissions.toLocaleString()}</td>
                        <td className="py-2 px-2 sm:py-3 sm:px-3 text-right">
                          <span className={(item.occupancy_proxy * 100) > 40 ? "text-amber-400 font-bold" : "text-slate-300"}>
                            {(item.occupancy_proxy * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2 px-2 sm:py-3 sm:px-3 text-right text-emerald-400 font-bold whitespace-nowrap">
                          {item.estimated_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </td>
                        <td className="py-2 px-2 sm:py-3 sm:px-3 text-right text-slate-300 whitespace-nowrap">{item.revenue_per_show.toFixed(2)} €</td>
                        <td className="py-2 px-2 sm:py-3 sm:px-3 text-right text-cyan-400 whitespace-nowrap">{item.sales_velocity.toFixed(1)} /hr</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: HOURLY BREAKDOWN & COMPARISON */}
      {activeTab === "hourly" && (
        <HourlyBreakdownView
          movieId={movie.id}
          movieTitle={movie.title}
          historyDates={historyDates}
          defaultDate={selectedDate}
        />
      )}

      {/* TAB 2: TIMELINE & GROWTH CURVES (Historical Sweeps) */}
      {activeTab === "timeline" && (
        <div className="space-y-6">
          {timeline.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
              <Clock className="w-10 h-10 mx-auto text-slate-600 mb-3" />
              <h4 className="text-base font-semibold text-slate-300">No historical sweeps recorded yet</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Trigger collection runs to build the historical time-series curves of unavailable seats,
                seat transitions, and occupancy velocity.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 1: Cumulative Sales Proxy Curve */}
              <div id="chart-cumulative-unavailable" className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-slate-100 text-base">Cumulative Reservations Proxy</h3>
                    <p className="text-xs text-slate-400">Strictly non-decreasing cumulative reservations across sweeps</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-cyan-400 font-semibold">
                    Cumulative Growth
                  </span>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeline} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="time_label" stroke="#94a3b8" fontSize={12} />
                      <YAxis stroke="#94a3b8" fontSize={12} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px", color: "#f8fafc" }}
                        itemStyle={{ color: "#f8fafc" }}
                        labelStyle={{ color: "#94a3b8", fontWeight: 600, marginBottom: "4px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total_unavailable"
                        name="Unavailable Seats"
                        stroke="#06b6d4"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "#06b6d4" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 2: Occupancy Proxy % */}
              <div id="chart-occupancy-proxy" className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-slate-100 text-base">Occupancy Proxy % Trajectory</h3>
                    <p className="text-xs text-slate-400">Ratio of unavailable seats over total sellable room capacity</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-amber-400 font-semibold">
                    Occupancy Rate
                  </span>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeline} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="time_label" stroke="#94a3b8" fontSize={12} />
                      <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(val) => `${(val * 100).toFixed(0)}%`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px", color: "#f8fafc" }}
                        itemStyle={{ color: "#f8fafc" }}
                        labelStyle={{ color: "#94a3b8", fontWeight: 600, marginBottom: "4px" }}
                        formatter={(val: any) => [`${(Number(val) * 100).toFixed(1)}%`, "Occupancy Proxy"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="occupancy_proxy"
                        name="Occupancy %"
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "#f59e0b" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: INDIVIDUAL SESSIONS */}
      {activeTab === "sessions" && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                id="session-search-input"
                type="text"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="Search cinema name or room..."
                className="w-full bg-slate-800 border border-slate-700 pl-9 pr-3 py-2 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs">
              {/* Date Filter */}
              <select
                id="session-date-filter"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-300 rounded-xl px-3 py-2 outline-none font-medium"
              >
                <option value="ALL">All Dates</option>
                {uniqueDates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                id="session-status-filter"
                value={statusFilter}
                onChange={(e: any) => setStatusFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-300 rounded-xl px-3 py-2 outline-none font-medium"
              >
                <option value="ALL">All Statuses (Current & Historical)</option>
                <option value="CURRENT">Active / Upcoming Only</option>
                <option value="HISTORICAL">Completed / Historical Only</option>
              </select>

              {/* Format Filter */}
              <select
                id="session-format-filter"
                value={formatFilter}
                onChange={(e) => setFormatFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-300 rounded-xl px-3 py-2 outline-none font-medium"
              >
                <option value="ALL">All Formats</option>
                {uniqueFormats.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>

              {/* Sort By */}
              <select
                id="session-sort-by"
                value={sortBy}
                onChange={(e: any) => setSortBy(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-300 rounded-xl px-3 py-2 outline-none font-medium"
              >
                <option value="occupancy">Sort by Occupancy %</option>
                <option value="unavailable">Sort by Unavailable Seats</option>
                <option value="time">Sort by Start Time</option>
              </select>
            </div>
          </div>

          {/* Sessions Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-800/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Status & Cinema</th>
                    <th className="py-3 px-3">Date & Time</th>
                    <th className="py-3 px-3">Format</th>
                    <th className="py-3 px-3 text-right">Capacity</th>
                    <th className="py-3 px-3 text-right">Available</th>
                    <th className="py-3 px-3 text-right">Unavailable</th>
                    <th className="py-3 px-3 text-right">Occupancy %</th>
                    <th className="py-3 px-3 text-right">Est. Rev</th>
                    <th className="py-3 px-3 text-center">History</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {filteredSessions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        No sessions match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredSessions.map((sess) => {
                      const blocked = sess.structural_blocked_seats || 0;
                      const rawOcc = sess.sellable_seats > 0 ? (sess.unavailable_seats / sess.sellable_seats) * 100 : (sess.occupancy_proxy * 100);
                      const effectiveCapacity = Math.max(1, sess.sellable_seats - blocked);
                      const effectiveUnavailable = Math.max(0, sess.unavailable_seats - blocked);
                      const effectiveOcc = (effectiveUnavailable / effectiveCapacity) * 100;
                      return (
                        <tr
                          key={sess.session_id}
                          onClick={() => setSelectedSessionId(sess.session_id)}
                          className="hover:bg-slate-800/70 transition cursor-pointer group"
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 mb-0.5">
                              {sess.is_current ? (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  Upcoming
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                                  Historical
                                </span>
                              )}
                              <span className="font-semibold text-slate-100 group-hover:text-amber-400 transition-colors">
                                {sess.cinema_name}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">
                              {sess.room_name} • {sess.cinema_city || "Portugal"}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-200">
                              {new Date(sess.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" })}
                            </div>
                            <div className="text-[11px] text-slate-500">{sess.operational_date}</div>
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                sess.format.toUpperCase().includes("IMAX")
                                  ? "bg-purple-900/60 text-purple-300 border border-purple-700"
                                  : "bg-slate-800 text-slate-300 border border-slate-700"
                              }`}
                            >
                              {sess.format}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right text-slate-400 font-mono">
                            {sess.sellable_seats}
                          </td>
                          <td className="py-3 px-3 text-right text-emerald-400 font-mono">
                            {sess.available_seats}
                          </td>
                          <td className="py-3 px-3 text-right font-mono">
                            <div className="font-bold text-cyan-300">
                              {sess.unavailable_seats}
                            </div>
                            {sess.structural_blocked_seats !== undefined && sess.structural_blocked_seats > 0 && (
                              <div className="text-[10px] text-amber-400/90 font-sans tracking-tight">
                                of which {sess.structural_blocked_seats} blocked
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono">
                            {sess.structural_blocked_seats !== undefined && sess.structural_blocked_seats > 0 ? (
                              <div>
                                <div
                                  className={`font-semibold ${
                                    effectiveOcc > 50 ? "text-amber-400" : effectiveOcc > 20 ? "text-cyan-400" : "text-slate-300"
                                  }`}
                                >
                                  {effectiveOcc.toFixed(1)}%
                                </div>
                                <div className="text-[10px] text-slate-500 font-sans tracking-tight">
                                  {rawOcc.toFixed(1)}% raw
                                </div>
                              </div>
                            ) : (
                              <span
                                className={`font-semibold ${
                                  rawOcc > 50 ? "text-amber-400" : rawOcc > 20 ? "text-cyan-400" : "text-slate-300"
                                }`}
                              >
                                {rawOcc.toFixed(1)}%
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-emerald-400">
                            {sess.estimated_revenue.toFixed(2)} €
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-400 group-hover:underline">
                              History <ChevronRight className="w-3.5 h-3.5" />
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: CINEMA BREAKDOWN */}
      {activeTab === "cinemas" && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-800/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Cinema Venue</th>
                  <th className="py-3 px-3">City / Region</th>
                  <th className="py-3 px-3 text-right">Current Sessions</th>
                  <th className="py-3 px-3 text-right">Sellable Capacity</th>
                  <th className="py-3 px-3 text-right">Available</th>
                  <th className="py-3 px-3 text-right">Unavailable</th>
                  <th className="py-3 px-3 text-right">Occupancy Proxy</th>
                  <th className="py-3 px-3 text-right">Est. Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {cinemas.map((cin) => {
                  const occ = cin.occupancy_proxy * 100;
                  return (
                    <tr key={cin.cinema_id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-semibold text-slate-100">{cin.cinema_name}</td>
                      <td className="py-3 px-3 text-slate-400">{cin.city || cin.region || "Portugal"}</td>
                      <td className="py-3 px-3 text-right font-mono text-slate-300">{cin.sessions_count}</td>
                      <td className="py-3 px-3 text-right font-mono text-slate-400">{cin.sellable_capacity}</td>
                      <td className="py-3 px-3 text-right font-mono text-emerald-400">{cin.available_seats}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-cyan-300">
                        {cin.unavailable_seats}
                      </td>
                      <td className="py-3 px-3 text-right font-mono">
                        <span className={`font-semibold ${occ > 40 ? "text-amber-400" : "text-slate-300"}`}>
                          {occ.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-emerald-400 font-semibold">
                        {cin.estimated_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
