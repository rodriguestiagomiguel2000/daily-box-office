import React, { useState, useEffect } from "react";
import { Film, Users, Building, Calendar, Clock, TrendingUp, Euro, ChevronRight, EyeOff, AlertCircle, Info, RefreshCw } from "lucide-react";
import { TrackedMovieSummary } from "../types";
import { getNextScheduledTime, formatToPortugal, getCurrentTheatricalOperationalDate } from "../utils/scheduling";
import { cleanMovieTitle } from "../utils/title";

interface TrackedMoviesViewProps {
  movies: TrackedMovieSummary[];
  onSelectMovie: (movieId: number) => void;
  onUntrackMovie: (movieId: number, externalId: string, title?: string) => void;
  onOpenCatalog: () => void;
  onRefreshMovies: () => void;
  isLoading: boolean;
}

export const TrackedMoviesView: React.FC<TrackedMoviesViewProps> = ({
  movies,
  onSelectMovie,
  onUntrackMovie,
  onOpenCatalog,
  onRefreshMovies,
  isLoading,
}) => {
  const currentOperationalDate = getCurrentTheatricalOperationalDate();

  // Compute overall aggregated totals
  const totalSellable = movies.reduce((acc, m) => acc + m.total_sellable_capacity, 0);
  const totalUnavailable = movies.reduce((acc, m) => acc + m.unavailable_seats, 0);
  const totalAvailable = movies.reduce((acc, m) => acc + m.available_seats, 0);
  const totalSessions = movies.reduce((acc, m) => acc + m.sessions_count, 0);
  const totalNewlyUnavailable = movies.reduce((acc, m) => acc + m.newly_unavailable, 0);
  const totalEstimatedRevenue = movies.reduce((acc, m) => acc + m.estimated_revenue, 0);
  const overallOccupancy = totalSellable > 0 ? (totalUnavailable / totalSellable) * 100 : 0;
  
  const [nextRunText, setNextRunText] = useState<string>("");

  useEffect(() => {
    const updateNextRun = () => {
      setNextRunText(formatToPortugal(getNextScheduledTime()));
    };

    updateNextRun();
    const interval = setInterval(updateNextRun, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8">
      {/* Prediction Engine Disclaimer Notice */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3.5 flex items-start sm:items-center gap-3 text-amber-300 text-xs">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
        <div>
          <span className="font-semibold text-amber-200">Telemetry Tracking Active: </span>
          The Box-Office Forecasting / ML Prediction Engine is <strong className="underline">not implemented yet</strong>. Metrics below reflect real-time active session seat-map tracking and collection sweep telemetry.
        </div>
      </div>

      {/* Top Banner KPI summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div id="stat-card-movies" className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Tracked Movies</span>
            <Film className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-slate-100">{movies.length}</div>
          <div className="text-xs text-slate-500 mt-1">{totalSessions} active sessions</div>
        </div>

        <div id="stat-card-occupancy" className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Occupancy Proxy</span>
            <TrendingUp className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-cyan-300">{overallOccupancy.toFixed(1)}%</div>
          <div className="text-xs text-slate-500 mt-1">
            {totalUnavailable.toLocaleString()} / {totalSellable.toLocaleString()} seats
          </div>
        </div>

        <div id="stat-card-capacity" className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Available Seats</span>
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">{totalAvailable.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-1">Unreserved inventory</div>
        </div>

        <div id="stat-card-newly-unavail" className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Newly Unavailable</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400">
            {totalNewlyUnavailable > 0 ? `+${totalNewlyUnavailable}` : totalNewlyUnavailable}
          </div>
          <div className="text-xs text-slate-500 mt-1">Since last sweep</div>
        </div>

        <div id="stat-card-revenue" className="col-span-2 lg:col-span-1 bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Estimated Revenue</span>
            <Euro className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-slate-100">
            €{totalEstimatedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-amber-500/80 mt-1">Real NOS ticket proxy</div>
        </div>
      </div>

      {/* Main Section Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Tracked Theatrical Titles</h1>
          <p className="text-sm text-slate-400">
            Real-time physical seat telemetry and latest snapshot aggregation
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div
            id="next-run-badge"
            title="Approximate time: Background cron execution may run a few minutes after the scheduled time."
            className="flex items-center space-x-1.5 text-xs text-slate-400"
          >
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-medium text-slate-300">Next run:</span>
            <span className="text-amber-300 font-semibold">{nextRunText || "..."}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="refresh-movies-btn"
              onClick={onRefreshMovies}
              disabled={isLoading}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-800 text-slate-200 border border-slate-700 font-medium text-sm transition shadow disabled:opacity-50 cursor-pointer"
              title="Refresh tracked catalog metrics without triggering collector sweeps"
            >
              <RefreshCw className={`w-4 h-4 text-amber-400 ${isLoading ? "animate-spin" : ""}`} />
              <span>{isLoading ? "Refreshing..." : "Refresh Movies"}</span>
            </button>

            <button
              id="add-movie-tracking-btn"
              onClick={onOpenCatalog}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition shadow cursor-pointer"
            >
              <Film className="w-4 h-4" />
              <span>Add Movies to Track</span>
            </button>
          </div>
        </div>
      </div>

      {/* Movies Cards Grid */}
      {isLoading && movies.length === 0 ? (
        <div className="py-20 text-center text-slate-400">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mb-4"></div>
          <p>Loading tracked box office telemetry from Neon PostgreSQL...</p>
        </div>
      ) : movies.length === 0 ? (
        <div id="empty-tracked-state" className="bg-slate-900/60 border border-dashed border-slate-800 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
            <Film className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-200">No movies are currently tracked</h3>
          <p className="text-slate-400 text-sm max-w-md mx-auto mt-2 mb-6">
            Select 1 or 2 active NOS movies from the catalog to initialize high-frequency seat tracking,
            transitions detection, and historical timeline accumulation.
          </p>
          <button
            id="empty-browse-catalog-btn"
            onClick={onOpenCatalog}
            className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition"
          >
            <span>Browse Active NOS Movies</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {movies.map((movie) => {
            const occPct = movie.total_sellable_capacity > 0
              ? (movie.unavailable_seats / movie.total_sellable_capacity) * 100
              : 0;

            return (
              <div
                key={movie.id}
                id={`movie-card-${movie.id}`}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg hover:border-slate-700 transition flex flex-col justify-between group"
              >
                <div>
                  {/* Card Header & Poster */}
                  <div className="p-5 border-b border-slate-800/80 bg-slate-900/50">
                    <div className="flex items-start gap-3.5">
                      {/* Poster Thumbnail */}
                      {movie.poster_url ? (
                        <div className="w-14 h-20 bg-slate-800 rounded-xl overflow-hidden flex-shrink-0 border border-slate-700/80 shadow-md">
                          <img
                            src={movie.poster_url}
                            alt={movie.title}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              const parent = (e.target as HTMLElement).parentElement;
                              if (parent) parent.style.display = "none";
                            }}
                          />
                        </div>
                      ) : null}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1.5 flex-wrap gap-y-1">
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium border border-slate-700">
                            {movie.age_rating || "M/12"}
                          </span>
                          {movie.duration && (
                            <span className="text-xs text-slate-400 flex items-center">
                              <Clock className="w-3 h-3 mr-1" />
                              {movie.duration} min
                            </span>
                          )}
                          {(() => {
                            const endDate = movie.tracking_end_date ? movie.tracking_end_date.slice(0, 10) : null;
                            if (!endDate) {
                              return (
                                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20 flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-emerald-400" />
                                  <span>Unlimited</span>
                                </span>
                              );
                            }
                            const isEnded = currentOperationalDate > endDate;
                            if (isEnded) {
                              return (
                                <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium border border-amber-500/20 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-amber-400" />
                                  <span>Ended {endDate}</span>
                                </span>
                              );
                            }
                            return (
                              <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium border border-cyan-500/20 flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-cyan-400" />
                                <span>Until {endDate}</span>
                              </span>
                            );
                          })()}
                          {(() => {
                            const lastSuccess = movie.last_schedule_discovery_success_at;
                            if (!lastSuccess) return null;
                            const diffHours = (Date.now() - new Date(lastSuccess).getTime()) / (1000 * 60 * 60);
                            if (diffHours >= 2.0) {
                              return (
                                <span
                                  title={`Schedule discovery delayed. Last success: ${new Date(lastSuccess).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`}
                                  className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium border border-amber-500/20 flex items-center gap-1"
                                >
                                  <AlertCircle className="w-3 h-3 text-amber-400" />
                                  <span>Schedule Delayed</span>
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>
                        <h3
                          id={`movie-title-${movie.id}`}
                          onClick={() => onSelectMovie(movie.id)}
                          className="font-bold text-slate-100 text-base sm:text-lg hover:text-amber-400 cursor-pointer transition line-clamp-2 leading-snug"
                        >
                          {cleanMovieTitle(movie.title)}
                        </h3>
                      </div>

                      <button
                        title="Disable Tracking"
                        onClick={() => onUntrackMovie(movie.id, movie.external_id, movie.title)}
                        className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-800 transition flex-shrink-0"
                      >
                        <EyeOff className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Body Metrics */}
                  <div className="p-5 space-y-4">
                    {/* Occupancy Progress Bar */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-slate-400 font-medium">Occupancy Proxy</span>
                        <span className="text-cyan-300 font-bold">{occPct.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-500 to-amber-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(0, occPct))}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Stats 2x2 Grid */}
                    <div className="grid grid-cols-2 gap-3 pt-1 text-sm">
                      <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800">
                        <div className="text-xs text-slate-400">Unavailable (Proxy)</div>
                        <div className="text-lg font-bold text-slate-100 mt-0.5">
                          {movie.unavailable_seats.toLocaleString()}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          of {movie.total_sellable_capacity.toLocaleString()} sellable
                        </div>
                      </div>

                      <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800">
                        <div className="text-xs text-slate-400">Newly Unavailable</div>
                        <div className="text-lg font-bold text-amber-400 mt-0.5">
                          {movie.newly_unavailable > 0 ? `+${movie.newly_unavailable}` : movie.newly_unavailable}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {movie.sales_velocity_proxy > 0
                            ? `${movie.sales_velocity_proxy.toFixed(1)} tix/hr`
                            : "Stable"}
                        </div>
                      </div>

                      <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800">
                        <div className="text-xs text-slate-400">Cinemas / Sessions</div>
                        <div className="text-lg font-bold text-slate-100 mt-0.5">
                          {movie.cinemas_count} <span className="text-xs text-slate-400 font-normal">cinemas</span>
                        </div>
                        <div className="text-[11px] text-slate-500">{movie.sessions_count} sessions</div>
                      </div>

                      <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800">
                        <div className="text-xs text-slate-400">Estimated Rev</div>
                        <div className="text-lg font-bold text-emerald-400 mt-0.5">
                          {movie.estimated_revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {movie.unavailable_seats > 0
                            ? `ATP ${(movie.estimated_revenue / movie.unavailable_seats).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                            : "—"}
                        </div>
                      </div>
                    </div>

                    {/* Last Update */}
                    <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-800/50">
                      <span>Latest Snapshot:</span>
                      <span className="text-slate-400 font-medium">
                        {movie.latest_collection_time
                          ? new Date(movie.latest_collection_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" })
                          : "Pending sweep"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Footer Action */}
                <div className="p-4 bg-slate-900/90 border-t border-slate-800">
                  <button
                    id={`view-movie-details-btn-${movie.id}`}
                    onClick={() => onSelectMovie(movie.id)}
                    className="w-full inline-flex items-center justify-center space-x-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-medium text-sm transition group-hover:bg-amber-500 group-hover:text-slate-950"
                  >
                    <span>View Analytics & Sessions</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
