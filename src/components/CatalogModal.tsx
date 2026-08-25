import React, { useState } from "react";
import { X, Search, Film, Check, Plus, Clock, Calendar, Sparkles, Tag } from "lucide-react";
import { Movie } from "../types";
import { cleanMovieTitle } from "../utils/title";

interface CatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  movies: Movie[];
  isLoading: boolean;
  onToggleTrack: (movie: Movie) => void;
}

export const CatalogModal: React.FC<CatalogModalProps> = ({
  isOpen,
  onClose,
  movies,
  isLoading,
  onToggleTrack,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"ALL" | "CURRENT" | "UPCOMING">("ALL");

  if (!isOpen) return null;

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
          <button
            id="close-catalog-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
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
                    </div>

                    <h4 className="font-bold text-slate-100 text-sm truncate">{cleanMovieTitle(movie.title)}</h4>
                    <div className="text-[11px] text-slate-500 font-mono">
                      ID: {movie.external_id}
                    </div>
                  </div>

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
      </div>
    </div>
  );
};
