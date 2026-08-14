import React from "react";
import { Film, Play, RefreshCw, Activity, Database, Clock, PlusCircle } from "lucide-react";
import { CollectorStatusResponse } from "../types";

interface HeaderProps {
  status: CollectorStatusResponse | null;
  isTriggering: boolean;
  onTriggerRun: () => void;
  onOpenCatalog: () => void;
  onOpenStatus: () => void;
  onHomeClick: () => void;
  activeView: "tracked" | "detail";
}

export const Header: React.FC<HeaderProps> = ({
  status,
  isTriggering,
  onTriggerRun,
  onOpenCatalog,
  onOpenStatus,
  onHomeClick,
  activeView,
}) => {
  const isCollecting = status?.scheduler?.isCollecting || isTriggering;

  return (
    <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand / Logo */}
          <div
            id="brand-logo-btn"
            onClick={onHomeClick}
            className="flex items-center space-x-3 cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:bg-amber-500/20 transition">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight text-slate-100">NOS Portugal</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Phase 2 Box Office
                </span>
              </div>
              <p className="text-xs text-slate-400">Seat-State Persistence & Telemetry</p>
            </div>
          </div>

          {/* Center Info Badges */}
          <div className="hidden md:flex items-center space-x-4">
            <div
              id="neon-db-badge"
              className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-300"
            >
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span>Neon PostgreSQL:</span>
              <span className="font-semibold text-emerald-400">
                {status ? `${status.totals.snapshots} Snapshots` : "Connected"}
              </span>
            </div>

            <div
              id="scheduler-badge"
              className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-300"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Interval:</span>
              <span className="font-semibold text-slate-200">
                {status?.scheduler?.intervalMinutes || 15}m
              </span>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-3">
            <button
              id="browse-catalog-btn"
              onClick={onOpenCatalog}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium text-slate-200 transition"
            >
              <PlusCircle className="w-4 h-4 text-amber-400" />
              <span>Track Movies</span>
            </button>

            <button
              id="system-status-btn"
              onClick={onOpenStatus}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium text-slate-200 transition"
            >
              <Activity className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Telemetry</span>
            </button>

            <button
              id="trigger-collection-btn"
              onClick={onTriggerRun}
              disabled={isCollecting}
              className={`inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
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
      </div>
    </header>
  );
};
