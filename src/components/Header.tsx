import React from "react";
import {
  Film,
  RefreshCw,
  Activity,
  Database,
  Clock,
  PlusCircle,
  TrendingUp,
  Calendar,
} from "lucide-react";
import { CollectorStatusResponse } from "../types";

interface HeaderProps {
  status: CollectorStatusResponse | null;
  isTriggering: boolean;
  onTriggerRun: () => void;
  onOpenCatalog: () => void;
  onOpenStatus: () => void;
  onHomeClick: () => void;
  onOpenDailyHistory: () => void;
  onOpenWeekendHistory?: () => void;
  onOpenWeeklyHistory?: () => void;
  activeView: "tracked" | "daily-history" | "weekend-history" | "weekly-history" | "detail";
}

function formatNextRunTime(nextRunStr: string | null | undefined): string {
  if (!nextRunStr) return "scheduled";
  try {
    const d = new Date(nextRunStr);
    if (isNaN(d.getTime())) return "scheduled";
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return isToday ? `today at ${timeStr}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeStr}`;
  } catch {
    return "scheduled";
  }
}

export const Header: React.FC<HeaderProps> = ({
  status,
  isTriggering,
  onTriggerRun,
  onOpenCatalog,
  onOpenStatus,
  onHomeClick,
  onOpenDailyHistory,
  onOpenWeekendHistory,
  onOpenWeeklyHistory,
  activeView,
}) => {
  const isCollecting = status?.scheduler?.isCollecting || isTriggering;
  const snapshotsCount = status?.totals?.snapshots || 0;
  const intervalMins = status?.scheduler?.intervalMinutes || 15;
  const nextRunFormatted = formatNextRunTime(status?.scheduler?.nextRunTime);

  return (
    <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 text-white shadow-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* ================= ROW 1 (TOP): Logo/Brand & Primary Actions ================= */}
        <div className="flex items-center justify-between h-16 border-b border-slate-800/60">
          {/* Left: Brand Logo + Title + Badge + Subtitle */}
          <div
            id="brand-logo-btn"
            onClick={onHomeClick}
            className="flex items-center space-x-3.5 cursor-pointer group select-none"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:bg-amber-500/20 group-hover:border-amber-500/50 transition">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight text-slate-100 group-hover:text-amber-400 transition">
                  NOS Portugal
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Phase 2 Box Office
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Seat-State Persistence & Telemetry
              </p>
            </div>
          </div>

          {/* Right: Action Buttons Only */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            <button
              id="browse-catalog-btn"
              onClick={onOpenCatalog}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs sm:text-sm font-medium text-slate-200 transition active:scale-95 shadow-sm"
            >
              <PlusCircle className="w-4 h-4 text-amber-400" />
              <span>Track Movies</span>
            </button>

            <button
              id="system-status-btn"
              onClick={onOpenStatus}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs sm:text-sm font-medium text-slate-200 transition active:scale-95 shadow-sm"
            >
              <Activity className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Telemetry</span>
            </button>

            <button
              id="trigger-collection-btn"
              onClick={onTriggerRun}
              disabled={isCollecting}
              className={`inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition ${
                isCollecting
                  ? "bg-amber-600/50 text-amber-200 cursor-not-allowed"
                  : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md hover:shadow-amber-500/20 active:scale-95"
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isCollecting ? "animate-spin" : ""}`} />
              <span>{isCollecting ? "Collecting..." : "Run Collection"}</span>
            </button>
          </div>
        </div>

        {/* ================= ROW 2 (BOTTOM): Primary Nav Tabs & Compact Status ================= */}
        <div className="flex items-center justify-between text-xs overflow-x-auto no-scrollbar py-0.5">
          {/* Left: Navigation Tabs (Underlined Active Tab Pattern) */}
          <nav className="flex space-x-6 font-medium">
            <button
              id="nav-tracked-movies-tab"
              onClick={onHomeClick}
              className={`py-2.5 transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeView === "tracked" || activeView === "detail"
                  ? "border-amber-500 text-amber-400 font-semibold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Film className="w-4 h-4 text-amber-400" />
              <span>Tracked Movies</span>
            </button>

            <button
              id="nav-daily-boxoffice-tab"
              onClick={onOpenDailyHistory}
              className={`py-2.5 transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeView === "daily-history"
                  ? "border-amber-500 text-amber-400 font-semibold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <TrendingUp className="w-4 h-4 text-amber-400" />
              <span>Daily Box Office</span>
            </button>

            {onOpenWeekendHistory && (
              <button
                id="nav-weekend-boxoffice-tab"
                onClick={onOpenWeekendHistory}
                className={`py-2.5 transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                  activeView === "weekend-history"
                    ? "border-amber-500 text-amber-400 font-semibold"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Calendar className="w-4 h-4 text-amber-400" />
                <span>Weekend Box Office</span>
              </button>
            )}

            {onOpenWeeklyHistory && (
              <button
                id="nav-weekly-boxoffice-tab"
                onClick={onOpenWeeklyHistory}
                className={`py-2.5 transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                  activeView === "weekly-history"
                    ? "border-amber-500 text-amber-400 font-semibold"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Calendar className="w-4 h-4 text-cyan-400" />
                <span>Weekly Box Office</span>
              </button>
            )}
          </nav>

          {/* Right: De-emphasized Compact Status Badges */}
          <div
            id="compact-status-bar"
            onClick={onOpenStatus}
            className="hidden md:flex items-center space-x-2 text-slate-400 hover:text-slate-200 cursor-pointer transition py-2 text-[11px] whitespace-nowrap select-none"
            title="Click to view detailed system telemetry"
          >
            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-slate-950/80 border border-slate-800">
              <Database className="w-3 h-3 text-emerald-400" />
              <span>
                Neon PostgreSQL: <strong className="text-emerald-400 font-mono">{snapshotsCount}</strong> Snapshots
              </span>
            </div>

            <span className="text-slate-600">•</span>

            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-slate-950/80 border border-slate-800">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>
                Interval: <strong className="text-slate-200 font-mono">{intervalMins}m</strong>
              </span>
            </div>

            <span className="text-slate-600">•</span>

            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-slate-950/80 border border-slate-800">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>
                Next run: <strong className="text-slate-300">{nextRunFormatted}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
