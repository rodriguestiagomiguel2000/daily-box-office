import React, { useState, useEffect, useCallback } from "react";
import { Header } from "./components/Header";
import { TrackedMoviesView } from "./components/TrackedMoviesView";
import { MovieDetailView } from "./components/MovieDetailView";
import { DailyBoxOfficeHistoryView } from "./components/DailyBoxOfficeHistoryView";
import { CatalogModal } from "./components/CatalogModal";
import { CollectorStatusModal } from "./components/CollectorStatusModal";
import { TrackedMovieSummary, MovieDetailResponse, CollectorStatusResponse, Movie } from "./types";

export function App() {
  const [trackedMovies, setTrackedMovies] = useState<TrackedMovieSummary[]>([]);
  const [selectedMovieId, setSelectedMovieId] = useState<number | null>(null);
  const [movieDetail, setMovieDetail] = useState<MovieDetailResponse | null>(null);
  const [collectorStatus, setCollectorStatus] = useState<CollectorStatusResponse | null>(null);
  const [catalogMovies, setCatalogMovies] = useState<Movie[]>([]);
  const [isDailyHistoryView, setIsDailyHistoryView] = useState<boolean>(false);

  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isTriggeringRun, setIsTriggeringRun] = useState(false);

  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);

  // Fetch Dashboard Summary
  const fetchSummary = useCallback(async () => {
    setIsLoadingSummary(true);
    try {
      const res = await fetch("/api/dashboard/summary");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setTrackedMovies(data.tracked_movies || []);
      }
    } catch (err) {
      console.error("Failed to fetch dashboard summary:", err);
    } finally {
      setIsLoadingSummary(false);
    }
  }, []);

  // Fetch Collector Status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/collector/status");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setCollectorStatus(data);
      }
    } catch (err) {
      console.error("Failed to fetch collector status:", err);
    }
  }, []);

  // Fetch Movie Detail
  const fetchMovieDetail = useCallback(async (id: number) => {
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/movies/${id}/detail`);
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setMovieDetail(data);
      }
    } catch (err) {
      console.error("Failed to fetch movie detail:", err);
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  // Fetch Catalog
  const fetchCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    try {
      const res = await fetch("/api/movies/catalog");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setCatalogMovies(data.movies || []);
      }
    } catch (err) {
      console.error("Failed to fetch catalog:", err);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, []);

  // Initial load and periodic polling
  useEffect(() => {
    fetchSummary();
    fetchStatus();

    const isCollectingNow = Boolean(
      collectorStatus?.is_collecting || collectorStatus?.scheduler?.isCollecting
    );
    const pollIntervalMs = isCollectingNow ? 2000 : 15000;

    const interval = setInterval(() => {
      fetchSummary();
      fetchStatus();
      if (selectedMovieId) {
        fetchMovieDetail(selectedMovieId);
      }
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [fetchSummary, fetchStatus, fetchMovieDetail, selectedMovieId, collectorStatus?.is_collecting, collectorStatus?.scheduler?.isCollecting]);

  // Open Catalog
  const handleOpenCatalog = () => {
    setIsCatalogOpen(true);
    fetchCatalog();
  };

  // Toggle Movie Tracking
  const handleToggleTrack = async (movie: Movie) => {
    const newStatus = !movie.tracking_enabled;
    try {
      const res = await fetch("/api/movies/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_id: movie.external_id,
          title: movie.title,
          poster_url: movie.poster_url,
          duration: movie.duration,
          age_rating: movie.age_rating,
          release_date: movie.release_date,
          tracking_enabled: newStatus,
        }),
      });

      if (res.ok) {
        // Update local catalog list
        setCatalogMovies((prev) =>
          prev.map((m) =>
            m.external_id === movie.external_id ? { ...m, tracking_enabled: newStatus } : m
          )
        );
        // Refresh summary and status
        fetchSummary();
        fetchStatus();
      }
    } catch (err) {
      console.error("Failed to toggle tracking:", err);
    }
  };

  // Untrack from movie card
  const handleUntrack = async (movieId: number, externalId: string) => {
    try {
      await fetch("/api/movies/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_id: externalId,
          tracking_enabled: false,
        }),
      });
      fetchSummary();
      fetchStatus();
      if (selectedMovieId === movieId) {
        setSelectedMovieId(null);
        setMovieDetail(null);
      }
    } catch (err) {
      console.error("Failed to untrack movie:", err);
    }
  };

  // Select Movie for Detail View
  const handleSelectMovie = (id: number) => {
    setSelectedMovieId(id);
    fetchMovieDetail(id);
  };

  // Trigger manual collection sweep
  const handleTriggerRun = async () => {
    setIsTriggeringRun(true);
    try {
      await fetch("/api/collector/trigger", { method: "POST" });
      await fetchStatus();
      await fetchSummary();
      if (selectedMovieId) {
        await fetchMovieDetail(selectedMovieId);
      }
    } catch (err) {
      console.error("Failed to trigger collection run:", err);
    } finally {
      setIsTriggeringRun(false);
    }
  };

  // Update Scheduler Config
  const handleUpdateConfig = async (intervalMinutes?: number, isRunning?: boolean) => {
    try {
      const res = await fetch("/api/collector/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interval_minutes: intervalMinutes,
          is_running: isRunning,
        }),
      });
      if (res.ok) {
        fetchStatus();
      }
    } catch (err) {
      console.error("Failed to update config:", err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Top App Header */}
      <Header
        status={collectorStatus}
        isTriggering={isTriggeringRun}
        onTriggerRun={handleTriggerRun}
        onOpenCatalog={handleOpenCatalog}
        onOpenStatus={() => setIsStatusOpen(true)}
        onOpenDailyHistory={() => {
          setSelectedMovieId(null);
          setMovieDetail(null);
          setIsDailyHistoryView(true);
        }}
        onHomeClick={() => {
          setSelectedMovieId(null);
          setMovieDetail(null);
          setIsDailyHistoryView(false);
        }}
        activeView={
          selectedMovieId
            ? "detail"
            : isDailyHistoryView
            ? "daily-history"
            : "tracked"
        }
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {selectedMovieId && movieDetail ? (
          <MovieDetailView
            data={movieDetail}
            onBack={() => {
              setSelectedMovieId(null);
              setMovieDetail(null);
            }}
            onRefresh={() => fetchMovieDetail(selectedMovieId)}
            isRefreshing={isLoadingDetail}
          />
        ) : isDailyHistoryView ? (
          <DailyBoxOfficeHistoryView
            onSelectMovie={handleSelectMovie}
            onBackToDashboard={() => setIsDailyHistoryView(false)}
          />
        ) : (
          <TrackedMoviesView
            movies={trackedMovies}
            onSelectMovie={handleSelectMovie}
            onUntrackMovie={handleUntrack}
            onOpenCatalog={handleOpenCatalog}
            onRefreshMovies={fetchSummary}
            isLoading={isLoadingSummary}
          />
        )}
      </main>

      {/* Catalog Modal */}
      <CatalogModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        movies={catalogMovies}
        isLoading={isLoadingCatalog}
        onToggleTrack={handleToggleTrack}
      />

      {/* System & Collector Telemetry Modal */}
      <CollectorStatusModal
        isOpen={isStatusOpen}
        onClose={() => setIsStatusOpen(false)}
        status={collectorStatus}
        onTriggerRun={handleTriggerRun}
        onUpdateConfig={handleUpdateConfig}
        isTriggering={isTriggeringRun}
      />

      {/* Minimal Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            Portugal Theatrical Box Office Platform • Powered by Neon PostgreSQL & NOS Seat Telemetry
          </div>
          <div className="text-[11px] text-slate-600">
            Proxy Model: Seat Transitions & Velocity (Excludes €0 vouchers)
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
