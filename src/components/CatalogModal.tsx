import React, { useState } from "react";
import { X, Search, Film, Check, Plus, Clock, Calendar, Sparkles, Tag, Link2, ArrowRight, Loader2, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Movie } from "../types";
import { cleanMovieTitle } from "../utils/title";
import { getCurrentTheatricalOperationalDate } from "../utils/scheduling";

interface CatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  movies: Movie[];
  isLoading: boolean;
  onToggleTrack: (movie: Movie) => void;
  onMergeSuccess?: () => void;
}

export const CatalogModal: React.FC<CatalogModalProps> = ({
  isOpen,
  onClose,
  movies,
  isLoading,
  onToggleTrack,
  onMergeSuccess,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"ALL" | "CURRENT" | "UPCOMING">("ALL");
  const currentOperationalDate = getCurrentTheatricalOperationalDate();

  // State for manual "Link to existing movie" flow
  const [selectedSourceMovie, setSelectedSourceMovie] = useState<Movie | null>(null);
  const [mergeTargetMovie, setMergeTargetMovie] = useState<Movie | null>(null);
  const [mergePickerSearch, setMergePickerSearch] = useState("");
  const [mergeTargetFilter, setMergeTargetFilter] = useState<"ALL" | "TRACKED">("ALL");
  const [isMerging, setIsMerging] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);
  const [mergeStatus, setMergeStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleForceResync = async () => {
    setIsResyncing(true);
    try {
      await fetch("/api/movies/resync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (onMergeSuccess) {
        onMergeSuccess();
      }
    } catch (err) {
      console.error("Force resync error:", err);
    } finally {
      setIsResyncing(false);
    }
  };

  if (!isOpen) return null;

  const handleExecuteMerge = async () => {
    if (!selectedSourceMovie || !mergeTargetMovie) return;
    setIsMerging(true);
    setMergeStatus(null);

    try {
      const sourceIdentifier = selectedSourceMovie.id || selectedSourceMovie.external_id;
      const targetIdentifier = mergeTargetMovie.id || mergeTargetMovie.external_id;

      const res = await fetch(`/api/movies/${sourceIdentifier}/merge-into`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_movie_id: targetIdentifier }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to link movie");
      }

      setMergeStatus({
        type: "success",
        message: data.message || `Linked "${cleanMovieTitle(selectedSourceMovie.title)}" to "${cleanMovieTitle(mergeTargetMovie.title)}" successfully.`
      });

      if (onMergeSuccess) {
        onMergeSuccess();
      }

      // Automatically dismiss merge picker after successful completion
      setTimeout(() => {
        setSelectedSourceMovie(null);
        setMergeTargetMovie(null);
        setMergeStatus(null);
      }, 1800);
    } catch (err: any) {
      setMergeStatus({
        type: "error",
        message: err.message || "An error occurred while linking the movie."
      });
    } finally {
      setIsMerging(false);
    }
  };

  const currentCount = movies.filter((m) => m.status === "CURRENTLY_PLAYING" || m.is_currently_playing).length;
  const upcomingCount = movies.filter((m) => m.status === "UPCOMING" || m.is_upcoming).length;

  const filtered = movies.filter((m) => {
    // Search term check
    const term = searchTerm.toLowerCase();
    const titleMatch = m.title.toLowerCase().includes(term);
    const idMatch = m.external_id.toLowerCase().includes(term);
    const formatMatch = (m.formats || []).some((f) => f.toLowerCase().includes(term));
    const matchesSearch = titleMatch || idMatch || formatMatch;

    if (!matchesSearch) return false;

    // Tab check
    if (activeTab === "CURRENT") {
      return m.status === "CURRENTLY_PLAYING" || m.is_currently_playing;
    }
    if (activeTab === "UPCOMING") {
      return m.status === "UPCOMING" || m.is_upcoming;
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div
        id="catalog-modal-content"
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center space-x-2">
              <Film className="w-5 h-5 text-amber-400" />
              <span>NOS Theatrical Catalog</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select current or upcoming Portuguese theatrical movies to enable tracking.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              id="force-resync-catalog-btn"
              onClick={handleForceResync}
              disabled={isResyncing || isLoading}
              title="Force resync and deduplicate catalog in database"
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isResyncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{isResyncing ? "Resyncing..." : "Resync"}</span>
            </button>
            <button
              id="close-catalog-btn"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
            <input
              type="text"
              placeholder="Search catalog by title, ID, or format (IMAX, 3D, 4DX)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center space-x-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/80 text-xs">
            <button
              id="tab-all-btn"
              onClick={() => setActiveTab("ALL")}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === "ALL" ? "bg-amber-500 text-slate-950 font-semibold shadow" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              All ({movies.length})
            </button>
            <button
              id="tab-current-btn"
              onClick={() => setActiveTab("CURRENT")}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === "CURRENT" ? "bg-emerald-500 text-slate-950 font-semibold shadow" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              In Theaters ({currentCount})
            </button>
            <button
              id="tab-upcoming-btn"
              onClick={() => setActiveTab("UPCOMING")}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === "UPCOMING" ? "bg-sky-500 text-slate-950 font-semibold shadow" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Upcoming ({upcomingCount})
            </button>
          </div>
        </div>

        {/* Catalog List */}
        <div className="p-4 overflow-y-auto flex-1 divide-y divide-slate-800/80 space-y-2">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400">
              <div className="inline-block animate-spin rounded-full h-7 w-7 border-t-2 border-b-2 border-amber-500 mb-3"></div>
              <p className="text-sm">Fetching complete theatrical catalog from NOS Cinemas Portugal...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              No movies found matching "{searchTerm}".
            </div>
          ) : (
            filtered.map((movie) => {
              const isCurrentlyPlaying = movie.status === "CURRENTLY_PLAYING" || movie.is_currently_playing;
              const isUpcoming = movie.status === "UPCOMING" || movie.is_upcoming;

              return (
                <div
                  key={movie.external_id}
                  id={`catalog-movie-row-${movie.external_id}`}
                  className="py-3 flex items-center justify-between gap-4 hover:bg-slate-800/40 px-3 rounded-xl transition"
                >
                  {/* Poster Thumbnail */}
                  <div className="w-10 h-14 bg-slate-800 rounded-md overflow-hidden flex-shrink-0 border border-slate-700/60 flex items-center justify-center">
                    {movie.poster_url ? (
                      <img
                        src={movie.poster_url}
                        alt={movie.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Film className="w-5 h-5 text-slate-600" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      {/* Status badge */}
                      {isCurrentlyPlaying ? (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                          In Theaters
                        </span>
                      ) : isUpcoming ? (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30">
                          Upcoming
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium border border-slate-700">
                          Archived
                        </span>
                      )}

                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium border border-slate-700">
                        {movie.age_rating || "M/12"}
                      </span>

                      {/* Formats tags */}
                      {movie.formats && movie.formats.length > 0 && (
                        <div className="flex items-center gap-1">
                          {movie.formats.map((fmt) => (
                            <span
                              key={fmt}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono"
                            >
                              {fmt}
                            </span>
                          ))}
                        </div>
                      )}

                      {movie.duration && (
                        <span className="text-xs text-slate-400 flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          {movie.duration}m
                        </span>
                      )}
                      {movie.release_date && (
                        <span className="text-xs text-slate-500 flex items-center">
                          <Calendar className="w-3 h-3 mr-1" />
                          {movie.release_date.split("T")[0]}
                        </span>
                      )}
                      {movie.tracking_enabled && (
                        (() => {
                          const endDate = movie.tracking_end_date ? movie.tracking_end_date.slice(0, 10) : null;
                          if (!endDate) {
                            return (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20">
                                Unlimited
                              </span>
                            );
                          }
                          const isEnded = currentOperationalDate > endDate;
                          if (isEnded) {
                            return (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium border border-amber-500/20">
                                Ended {endDate}
                              </span>
                            );
                          }
                          return (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium border border-cyan-500/20">
                              Until {endDate}
                            </span>
                          );
                        })()
                      )}
                    </div>

                    <h4 className="font-bold text-slate-100 text-sm truncate">{cleanMovieTitle(movie.title)}</h4>
                    <div className="text-[11px] text-slate-500 font-mono">
                      ID: {movie.external_id}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <button
                      id={`link-movie-btn-${movie.external_id}`}
                      onClick={() => {
                        setSelectedSourceMovie(movie);
                        setMergeTargetMovie(null);
                        setMergePickerSearch("");
                        setMergeTargetFilter("ALL");
                        setMergeStatus(null);
                      }}
                      title="Link to existing movie (merge release variant)"
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-cyan-300 bg-slate-800/90 hover:bg-slate-700/80 border border-slate-700 hover:border-cyan-500/40 transition cursor-pointer"
                    >
                      <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="hidden sm:inline">Link</span>
                    </button>

                    <button
                      id={`track-toggle-btn-${movie.external_id}`}
                      onClick={() => onToggleTrack(movie)}
                      className={`inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex-shrink-0 ${
                        movie.tracking_enabled
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/30"
                          : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow"
                      }`}
                    >
                      {movie.tracking_enabled ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Tracking</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          <span>Track</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90 text-xs text-slate-400 flex justify-between items-center">
          <span>
            {movies.length} complete theatrical movies from NOS Cinemas Portugal
          </span>
          <button
            id="catalog-done-btn"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium cursor-pointer"
          >
            Done
          </button>
        </div>

        {/* Manual Merge Picker Modal */}
        {selectedSourceMovie && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
            <div
              id="link-movie-modal-dialog"
              className="bg-slate-900 border border-cyan-500/40 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="p-4 border-b border-slate-800 bg-slate-900/95 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                    <Link2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-100">
                      Link Release Variant to Existing Movie
                    </h3>
                    <p className="text-xs text-slate-400">
                      Merge this catalog entry under a canonical movie to combine session telemetry.
                    </p>
                  </div>
                </div>
                <button
                  id="close-link-modal-btn"
                  onClick={() => {
                    setSelectedSourceMovie(null);
                    setMergeTargetMovie(null);
                    setMergeStatus(null);
                  }}
                  disabled={isMerging}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Source Movie Info Card */}
              <div className="p-4 bg-slate-800/50 border-b border-slate-800 flex items-center gap-3">
                <div className="w-10 h-14 bg-slate-800 rounded overflow-hidden flex-shrink-0 border border-slate-700 flex items-center justify-center">
                  {selectedSourceMovie.poster_url ? (
                    <img
                      src={selectedSourceMovie.poster_url}
                      alt={selectedSourceMovie.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Film className="w-5 h-5 text-slate-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      Source Variant
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      ID: {selectedSourceMovie.external_id}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-100 truncate mt-0.5">
                    {selectedSourceMovie.title}
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Will be linked into target. Scraper will continue checking this entry, but sessions will be credited to the target movie.
                  </p>
                </div>
              </div>

              {/* Search & Filter for Target Movie */}
              <div className="p-3 border-b border-slate-800 bg-slate-900 flex flex-col sm:flex-row gap-2 items-center">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                  <input
                    id="merge-target-search-input"
                    type="text"
                    placeholder="Search target movie by title or ID..."
                    value={mergePickerSearch}
                    onChange={(e) => setMergePickerSearch(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="flex items-center space-x-1 bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs w-full sm:w-auto">
                  <button
                    id="filter-target-all-btn"
                    onClick={() => setMergeTargetFilter("ALL")}
                    className={`flex-1 sm:flex-none px-2.5 py-1 rounded-lg font-medium transition ${
                      mergeTargetFilter === "ALL" ? "bg-cyan-500 text-slate-950 font-semibold" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    All Movies
                  </button>
                  <button
                    id="filter-target-tracked-btn"
                    onClick={() => setMergeTargetFilter("TRACKED")}
                    className={`flex-1 sm:flex-none px-2.5 py-1 rounded-lg font-medium transition ${
                      mergeTargetFilter === "TRACKED" ? "bg-cyan-500 text-slate-950 font-semibold" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Tracked Only
                  </button>
                </div>
              </div>

              {/* Candidates list */}
              <div className="p-3 overflow-y-auto flex-1 divide-y divide-slate-800/80 space-y-1">
                {(() => {
                  const targetCandidates = movies.filter((m) => {
                    // Exclude source movie
                    if (m.external_id === selectedSourceMovie.external_id) return false;
                    if (m.id && selectedSourceMovie.id && m.id === selectedSourceMovie.id) return false;

                    // Filter tracked
                    if (mergeTargetFilter === "TRACKED" && !m.tracking_enabled) return false;

                    // Search query
                    if (!mergePickerSearch.trim()) return true;
                    const q = mergePickerSearch.toLowerCase();
                    return (
                      m.title.toLowerCase().includes(q) ||
                      cleanMovieTitle(m.title).toLowerCase().includes(q) ||
                      m.external_id.toLowerCase().includes(q)
                    );
                  });

                  if (targetCandidates.length === 0) {
                    return (
                      <div className="py-8 text-center text-xs text-slate-500">
                        No target movies found matching "{mergePickerSearch}".
                      </div>
                    );
                  }

                  return targetCandidates.map((candidate) => {
                    const isSelected = mergeTargetMovie?.external_id === candidate.external_id;

                    return (
                      <div
                        key={candidate.external_id}
                        id={`merge-candidate-${candidate.external_id}`}
                        onClick={() => setMergeTargetMovie(candidate)}
                        className={`p-2 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition ${
                          isSelected
                            ? "bg-cyan-950/40 border border-cyan-500/50"
                            : "hover:bg-slate-800/60 border border-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-11 bg-slate-800 rounded overflow-hidden flex-shrink-0 border border-slate-700 flex items-center justify-center">
                            {candidate.poster_url ? (
                              <img
                                src={candidate.poster_url}
                                alt={candidate.title}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <Film className="w-4 h-4 text-slate-600" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h5 className="text-xs font-bold text-slate-100 truncate">
                                {cleanMovieTitle(candidate.title)}
                              </h5>
                              {candidate.tracking_enabled && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
                                  Tracked
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {candidate.title}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              ID: {candidate.external_id}
                            </div>
                          </div>
                        </div>

                        <div className="flex-shrink-0">
                          <div
                            className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                              isSelected
                                ? "bg-cyan-500 border-cyan-500 text-slate-950"
                                : "border-slate-600 hover:border-slate-400"
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Status Message */}
              {mergeStatus && (
                <div
                  className={`mx-4 mb-2 p-2.5 rounded-xl text-xs flex items-center space-x-2 ${
                    mergeStatus.type === "success"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  }`}
                >
                  {mergeStatus.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span>{mergeStatus.message}</span>
                </div>
              )}

              {/* Footer */}
              <div className="p-3 border-t border-slate-800 bg-slate-900 flex items-center justify-between">
                <button
                  id="cancel-link-modal-btn"
                  onClick={() => {
                    setSelectedSourceMovie(null);
                    setMergeTargetMovie(null);
                    setMergeStatus(null);
                  }}
                  disabled={isMerging}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer transition disabled:opacity-50"
                >
                  Cancel
                </button>

                <div className="flex items-center space-x-2">
                  {mergeTargetMovie && (
                    <div className="hidden sm:flex items-center space-x-1.5 text-xs text-slate-400">
                      <span className="truncate max-w-[120px] text-cyan-300 font-medium">
                        {cleanMovieTitle(selectedSourceMovie.title)}
                      </span>
                      <ArrowRight className="w-3 h-3 text-slate-500" />
                      <span className="truncate max-w-[120px] text-emerald-300 font-medium">
                        {cleanMovieTitle(mergeTargetMovie.title)}
                      </span>
                    </div>
                  )}

                  <button
                    id="confirm-link-movie-btn"
                    onClick={handleExecuteMerge}
                    disabled={!mergeTargetMovie || isMerging}
                    className="inline-flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                  >
                    {isMerging ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Linking...</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Link to Selected Movie</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
