import React, { useState } from "react";
import {
  TrendingUp,
  Clock,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  CheckCircle2,
  Calendar,
  Ticket,
} from "lucide-react";
import { MovieForecastResponse, ForecastConfidence } from "../types";

interface IntradayForecastCardProps {
  forecastData: MovieForecastResponse | null;
  isLoading: boolean;
  selectedDate: string;
  targetTime: string;
  isNowActive?: boolean;
}

export const IntradayForecastCard: React.FC<IntradayForecastCardProps> = ({
  forecastData,
  isLoading,
  selectedDate,
  targetTime,
  isNowActive,
}) => {
  const [showBreakdown, setShowBreakdown] = useState<boolean>(false);

  if (isLoading && !forecastData) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl animate-pulse">
        <div className="h-6 bg-slate-800 rounded w-1/3 mb-4"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-20 bg-slate-800/60 rounded-xl"></div>
          <div className="h-20 bg-slate-800/60 rounded-xl"></div>
          <div className="h-20 bg-slate-800/60 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (!forecastData) {
    return null;
  }

  const {
    is_day_complete,
    actual_revenue,
    actual_admissions,
    actual_occupancy,
    latest_data_time,
    forecast,
    comparisons,
    comparable_curves,
    remaining_shows,
    remaining_capacity,
  } = forecastData;

  const getConfidenceBadge = (confidence: ForecastConfidence) => {
    switch (confidence) {
      case "High":
        return {
          bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
          icon: <ShieldCheck className="w-3.5 h-3.5" />,
          label: "High Confidence",
        };
      case "Medium":
        return {
          bg: "bg-amber-500/10 text-amber-400 border-amber-500/30",
          icon: <AlertCircle className="w-3.5 h-3.5" />,
          label: "Medium Confidence",
        };
      case "Low":
      default:
        return {
          bg: "bg-rose-500/10 text-rose-400 border-rose-500/30",
          icon: <HelpCircle className="w-3.5 h-3.5" />,
          label: "Low Confidence",
        };
    }
  };

  return (
    <div
      id="card-intraday-forecast"
      className="bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800/90 rounded-2xl p-6 shadow-xl relative overflow-hidden"
    >
      {/* Glow highlight */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-slate-100 text-lg tracking-tight flex items-center gap-2">
              <span>End-of-Day Revenue Forecast</span>
              <span className="text-xs font-mono font-normal text-slate-400">
                ({selectedDate})
              </span>
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
            <span>Theatrical operational day cutoff: 06:00 → 05:59 Lisbon</span>
            <span className="text-slate-600">•</span>
            <span>Deterministic curve & inventory model</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {is_day_complete ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Operational Day Finalized
            </span>
          ) : (
            forecast && (
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                  getConfidenceBadge(forecast.confidence).bg
                }`}
                title={forecast.confidence_reasons.join(" • ")}
              >
                {getConfidenceBadge(forecast.confidence).icon}
                {getConfidenceBadge(forecast.confidence).label}
              </span>
            )
          )}

          {/* Freshness Badge */}
          <div className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700 text-slate-300 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Sweep: <strong className="text-slate-100">{latest_data_time}</strong></span>
            {targetTime !== latest_data_time && (
              <span className="text-slate-500">(Target: {targetTime})</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Metric Cards Grid */}
      {is_day_complete ? (
        /* Completed Day Layout */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Final EOD Revenue
            </div>
            <div className="text-3xl font-black text-amber-400 mt-1">
              €{actual_revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {actual_admissions.toLocaleString()} admissions • {(actual_occupancy * 100).toFixed(1)}% final occupancy
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              vs Previous Day Final
            </div>
            <div className="text-xl font-bold text-slate-200 mt-1 flex items-center gap-1.5">
              {comparisons.yesterday_eod_revenue !== null ? (
                <>
                  <span>€{comparisons.yesterday_eod_revenue.toLocaleString()}</span>
                  {comparisons.change_vs_yesterday_eod !== null && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold flex items-center ${
                        comparisons.change_vs_yesterday_eod >= 0
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}
                    >
                      {comparisons.change_vs_yesterday_eod >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {Math.abs(comparisons.change_vs_yesterday_eod).toFixed(1)}%
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-500 text-sm">No previous day record</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Yesterday ({comparisons.yesterday_date})
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              vs Same Weekday Last Week Final
            </div>
            <div className="text-xl font-bold text-slate-200 mt-1 flex items-center gap-1.5">
              {comparisons.last_week_eod_revenue !== null ? (
                <>
                  <span>€{comparisons.last_week_eod_revenue.toLocaleString()}</span>
                  {comparisons.change_vs_last_week_eod !== null && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold flex items-center ${
                        comparisons.change_vs_last_week_eod >= 0
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}
                    >
                      {comparisons.change_vs_last_week_eod >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {Math.abs(comparisons.change_vs_last_week_eod).toFixed(1)}%
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-500 text-sm">No last week record</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Same weekday (-7d) ({comparisons.last_week_date})
            </div>
          </div>
        </div>
      ) : forecast ? (
        /* Active Intraday Forecast Layout */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Primary Expected Forecast Box */}
          <div className="bg-gradient-to-br from-amber-500/10 via-slate-950 to-slate-950 border border-amber-500/30 rounded-xl p-4 shadow-inner">
            <div className="flex items-center justify-between text-xs text-amber-400 font-semibold uppercase tracking-wider">
              <span>Expected EOD Revenue</span>
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div className="text-3xl font-black text-amber-400 mt-1">
              €{forecast.expected.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-slate-300 mt-1 font-medium">
              Range: €{forecast.low.toLocaleString()} – €{forecast.high.toLocaleString()}
            </div>
          </div>

          {/* Current Actual Tracked Box */}
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between">
              <span>Current Tracked</span>
              <span className="text-[11px] font-mono text-cyan-400">@ {latest_data_time}</span>
            </div>
            <div className="text-2xl font-black text-slate-100 mt-1">
              €{actual_revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {actual_admissions.toLocaleString()} admissions • {remaining_shows} future shows remaining
            </div>
          </div>

          {/* vs Yesterday Final EOD */}
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Expected vs Yesterday EOD
            </div>
            <div className="text-xl font-bold text-slate-200 mt-1 flex items-center gap-1.5">
              {comparisons.yesterday_eod_revenue !== null ? (
                <>
                  <span>€{comparisons.yesterday_eod_revenue.toLocaleString()}</span>
                  {comparisons.change_vs_yesterday_eod !== null && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold flex items-center ${
                        comparisons.change_vs_yesterday_eod >= 0
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}
                    >
                      {comparisons.change_vs_yesterday_eod >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {Math.abs(comparisons.change_vs_yesterday_eod).toFixed(1)}%
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-500 text-sm">No completed yesterday</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Yesterday final total ({comparisons.yesterday_date})
            </div>
          </div>

          {/* vs Same Weekday Last Week Final EOD */}
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Expected vs Last Week EOD
            </div>
            <div className="text-xl font-bold text-slate-200 mt-1 flex items-center gap-1.5">
              {comparisons.last_week_eod_revenue !== null ? (
                <>
                  <span>€{comparisons.last_week_eod_revenue.toLocaleString()}</span>
                  {comparisons.change_vs_last_week_eod !== null && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold flex items-center ${
                        comparisons.change_vs_last_week_eod >= 0
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}
                    >
                      {comparisons.change_vs_last_week_eod >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {Math.abs(comparisons.change_vs_last_week_eod).toFixed(1)}%
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-500 text-sm">No completed last week</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Same weekday (-7d) final ({comparisons.last_week_date})
            </div>
          </div>
        </div>
      ) : null}

      {/* Model Confidence Explanations & Comparable Curves Toggle */}
      {forecast && comparable_curves.length > 0 && !is_day_complete && (
        <div className="mt-4 pt-3 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className="font-semibold text-slate-300">Confidence Drivers:</span>
              <span>{forecast.confidence_reasons.join(" • ")}</span>
            </div>

            <button
              onClick={() => setShowBreakdown(!showBreakdown)}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 self-start sm:self-auto transition"
            >
              <span>{showBreakdown ? "Hide Model Weights" : "View Comparable Curves & Weights"}</span>
              {showBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Collapsible Model Breakdown Table */}
          {showBreakdown && (
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80 p-3">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 text-[11px]">
                    <th className="pb-2 px-2">Comparable Curve</th>
                    <th className="pb-2 px-2 text-right">Model Weight</th>
                    <th className="pb-2 px-2 text-right">Hist. EOD Final</th>
                    <th className="pb-2 px-2 text-right">Hist. @ {latest_data_time}</th>
                    <th className="pb-2 px-2 text-right">Achieved %</th>
                    <th className="pb-2 px-2 text-right">Momentum Ratio</th>
                    <th className="pb-2 px-2 text-right">Curve Projection</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                  {comparable_curves.map((curve, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/50">
                      <td className="py-2 px-2 font-sans font-medium text-slate-200">
                        {curve.label}
                      </td>
                      <td className="py-2 px-2 text-right font-bold text-amber-400">
                        {(curve.weight * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 px-2 text-right">
                        €{curve.eod_revenue.toLocaleString()}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-400">
                        €{curve.cutoff_revenue.toLocaleString()}
                      </td>
                      <td className="py-2 px-2 text-right text-cyan-400">
                        {(curve.fraction_achieved_at_cutoff * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 px-2 text-right text-purple-400">
                        {(curve.remaining_ratio ?? curve.momentum_ratio ?? 0).toFixed(2)}x
                      </td>
                      <td className="py-2 px-2 text-right font-bold text-slate-100">
                        €{curve.projected_eod.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between">
                <span>* Forecast accounts for Portuguese cinema demand distribution, historical curve fraction achieved by cutoff, bounded momentum, and future scheduled inventory capacity.</span>
                <span>Uncertainty span: ±{forecast.uncertainty_pct}%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
