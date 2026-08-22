import React, { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  Ticket,
  Euro,
  Calendar,
  Building,
  Layers,
  Sparkles,
  RefreshCw,
  Info,
  ArrowUpRight,
  Clock,
  CheckCircle,
  HelpCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { MoviePresaleCurveResponse, PresaleBucket } from "../types";
import { fetchJson } from "../utils/api";

interface MoviePresaleCurveViewProps {
  movieId: number;
  movieTitle: string;
}

export const MoviePresaleCurveView: React.FC<MoviePresaleCurveViewProps> = ({
  movieId,
  movieTitle,
}) => {
  const [data, setData] = useState<MoviePresaleCurveResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [metricView, setMetricView] = useState<"tickets" | "revenue" | "growth">("tickets");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchPresaleCurve = useCallback(async () => {
    if (!movieId) return;
    try {
      setLoading(true);
      setError(null);
      const json = await fetchJson<MoviePresaleCurveResponse>(`/api/movies/${movieId}/presale-curve`);
      setData(json);
    } catch (err: any) {
      console.error("Error fetching presale curve:", err);
      setError(err.message || "Failed to load presale curve data");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [movieId]);

  useEffect(() => {
    fetchPresaleCurve();
  }, [fetchPresaleCurve]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchPresaleCurve();
  };

  if (loading && !data) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-amber-500 border-t-transparent mb-4"></div>
        <p className="text-slate-400 text-sm">Computing opening day presale trajectory...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto">
          <Info className="w-6 h-6" />
        </div>
        <h3 className="text-white font-medium">Unable to load presale data</h3>
        <p className="text-slate-400 text-sm max-w-md mx-auto">{error || "No data available."}</p>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-medium transition cursor-pointer"
        >
          Try Again
        </button>
      </div>
    );
  }

  const { movie, opening_day, has_presale_data, buckets, cinemas_breakdown } = data;
  const latestBucket: PresaleBucket | null = buckets.length > 0 ? buckets[buckets.length - 1] : null;

  return (
    <div className="space-y-6">
      {/* Header Info & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Opening Day Pre-Sale Trajectory
            </span>
            {opening_day && (
              <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                Opening Date: {opening_day.operational_date}
                {opening_day.is_release_date_match ? " (Official Release)" : " (Earliest Session)"}
              </span>
            )}
            {data.tracking_start_bucket && (
              <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Window: {data.tracking_start_bucket} &rarr; T-0 ({buckets.length} observations)
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-white mt-2">
            {movieTitle} &mdash; Opening Day Pre-Sale Curve
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Tracks cumulative advance ticket sales and estimated gross for opening day sessions across time-series snapshots taken prior to showtime (<span className="text-amber-300 font-medium">T-14 &rarr; T-0</span>).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="presale-refresh-btn"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-amber-400" : "text-slate-400"}`} />
            <span>{isRefreshing ? "Refreshing..." : "Refresh Curve"}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Presale Admissions</span>
            <Ticket className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {latestBucket ? latestBucket.cumulative_tickets.toLocaleString() : "0"}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            <span>Cumulative tickets sold</span>
            {latestBucket && latestBucket.occupancy_rate > 0 && (
              <span className="text-amber-400 font-medium">
                ({(latestBucket.occupancy_rate * 100).toFixed(1)}% cap)
              </span>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Estimated Presale Gross</span>
            <Euro className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {latestBucket ? `€${latestBucket.cumulative_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "€0.00"}
          </div>
          <div className="text-[11px] text-emerald-400/90 mt-1">
            Based on resolved NOS seat pricing
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Opening Sessions</span>
            <Layers className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {opening_day ? opening_day.total_opening_sessions : 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Across {opening_day ? opening_day.total_opening_cinemas : 0} cinema venues
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Total Opening Capacity</span>
            <Building className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {opening_day ? opening_day.total_opening_capacity.toLocaleString() : "0"}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Sellable room seats available
          </div>
        </div>
      </div>

      {!has_presale_data ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="text-white font-semibold text-base">No advance presale observations recorded</h3>
          <p className="text-slate-400 text-xs max-w-lg mx-auto leading-relaxed">
            {opening_day && opening_day.total_opening_sessions > 0
              ? `There are ${opening_day.total_opening_sessions} opening day sessions recorded for ${opening_day.operational_date}, but no seat snapshots were collected prior to showtime.`
              : "No opening day sessions have been scraped or tracked for this title yet."}
          </p>
        </div>
      ) : (
        <>
          {/* Main Chart Section */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-amber-400" />
                  <span>Advance Presale Progression Curve</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Cumulative seats sold as of each day before release (<span className="text-slate-300">T-N bucket</span>)
                </p>
              </div>

              {/* Metric Toggle */}
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  id="presale-metric-tickets-btn"
                  onClick={() => setMetricView("tickets")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    metricView === "tickets"
                      ? "bg-amber-500 text-slate-950 font-semibold shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Admissions (Tickets)
                </button>
                <button
                  id="presale-metric-revenue-btn"
                  onClick={() => setMetricView("revenue")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    metricView === "revenue"
                      ? "bg-amber-500 text-slate-950 font-semibold shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Gross Revenue (€)
                </button>
                <button
                  id="presale-metric-growth-btn"
                  onClick={() => setMetricView("growth")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    metricView === "growth"
                      ? "bg-amber-500 text-slate-950 font-semibold shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Day-over-Day Pace
                </button>
              </div>
            </div>

            {/* Recharts Trajectory Graph */}
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={buckets}
                  margin={{ top: 10, right: 20, left: 10, bottom: 25 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                  <XAxis
                    dataKey="t_label"
                    stroke="#94a3b8"
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    tickLine={{ stroke: "#475569" }}
                    label={{
                      value: "Days Before Release (T-Bucket)",
                      position: "insideBottom",
                      offset: -15,
                      fill: "#64748b",
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="#94a3b8"
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    tickLine={{ stroke: "#475569" }}
                    tickFormatter={(val) =>
                      metricView === "revenue"
                        ? `€${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}`
                        : val.toLocaleString()
                    }
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#06b6d4"
                    tick={{ fill: "#06b6d4", fontSize: 10 }}
                    tickLine={{ stroke: "#06b6d4" }}
                    tickFormatter={(val) => `+${val}`}
                    domain={[0, "auto"]}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || !payload.length) return null;
                      const bucketData = payload[0].payload as PresaleBucket;
                      return (
                        <div className="bg-slate-950/95 border border-slate-700 rounded-xl p-3.5 shadow-2xl backdrop-blur-md text-xs space-y-2 min-w-[200px]">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                            <span className="font-bold text-amber-400 text-sm">{bucketData.t_label}</span>
                            <span className="text-slate-400 text-[11px]">{bucketData.calendar_date}</span>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Cumulative Tickets:</span>
                              <span className="font-semibold text-white">
                                {bucketData.cumulative_tickets.toLocaleString()}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Cumulative Revenue:</span>
                              <span className="font-semibold text-emerald-400">
                                €{bucketData.cumulative_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Occupancy Proxy:</span>
                              <span className="font-medium text-cyan-400">
                                {(bucketData.occupancy_rate * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Sessions / Venues:</span>
                              <span className="text-slate-300">
                                {bucketData.sessions_count} shows / {bucketData.cinemas_count} cinemas
                              </span>
                            </div>
                            {bucketData.dod_tickets_growth > 0 && (
                              <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[11px]">
                                <span className="text-amber-400 font-medium">DoD Acceleration:</span>
                                <span className="font-semibold text-amber-300">
                                  +{bucketData.dod_tickets_growth} tickets
                                  {bucketData.dod_tickets_growth_pct !== null && ` (+${bucketData.dod_tickets_growth_pct}%)`}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 12 }} />

                  {metricView === "tickets" && (
                    <>
                      <Bar
                        yAxisId="right"
                        dataKey="dod_tickets_growth"
                        name="Daily Added Tickets (DoD Pace)"
                        fill="#06b6d4"
                        opacity={0.35}
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="cumulative_tickets"
                        name="Cumulative Tickets Sold"
                        stroke="#f59e0b"
                        strokeWidth={3}
                        dot={{ r: 4, fill: "#f59e0b", strokeWidth: 2, stroke: "#1e293b" }}
                        activeDot={{ r: 6, fill: "#fbbf24" }}
                      />
                    </>
                  )}

                  {metricView === "revenue" && (
                    <>
                      <Bar
                        yAxisId="right"
                        dataKey="dod_revenue_growth"
                        name="Daily Added Revenue (€)"
                        fill="#10b981"
                        opacity={0.3}
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="cumulative_revenue"
                        name="Cumulative Gross (€)"
                        stroke="#10b981"
                        strokeWidth={3}
                        dot={{ r: 4, fill: "#10b981", strokeWidth: 2, stroke: "#1e293b" }}
                        activeDot={{ r: 6, fill: "#34d399" }}
                      />
                    </>
                  )}

                  {metricView === "growth" && (
                    <>
                      <Bar
                        yAxisId="left"
                        dataKey="dod_tickets_growth"
                        name="Daily Tickets Added"
                        fill="#f59e0b"
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="dod_tickets_growth_pct"
                        name="DoD Growth %"
                        stroke="#06b6d4"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "#06b6d4" }}
                      />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detailed Data Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Pre-Sale Velocity & Day-over-Day Breakdown</h3>
                <p className="text-xs text-slate-400 mt-0.5">Observation metrics captured per T-bucket</p>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {buckets.length} Data Points
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">T-Bucket</th>
                    <th className="py-3 px-4">Calendar Date</th>
                    <th className="py-3 px-4 text-right">Cumulative Tickets</th>
                    <th className="py-3 px-4 text-right">Daily Added Tickets</th>
                    <th className="py-3 px-4 text-right">DoD Growth %</th>
                    <th className="py-3 px-4 text-right">Cumulative Revenue</th>
                    <th className="py-3 px-4 text-right">Occupancy</th>
                    <th className="py-3 px-4 text-right">Sessions</th>
                    <th className="py-3 px-4 text-right">Cinemas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {buckets.map((b, idx) => {
                    const isOpeningDay = b.days_before_release === 0;
                    return (
                      <tr
                        key={b.t_label}
                        className={`hover:bg-slate-800/40 transition ${
                          isOpeningDay ? "bg-amber-500/5 font-semibold text-amber-200" : ""
                        }`}
                      >
                        <td className="py-3 px-4 font-sans font-medium">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                              isOpeningDay
                                ? "bg-amber-500 text-slate-950"
                                : "bg-slate-800 text-slate-200 border border-slate-700"
                            }`}
                          >
                            {b.t_label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-400 font-sans">{b.calendar_date}</td>
                        <td className="py-3 px-4 text-right font-bold text-white">
                          {b.cumulative_tickets.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {idx === 0 ? (
                            <span className="text-slate-500 font-sans italic">Baseline</span>
                          ) : b.dod_tickets_growth > 0 ? (
                            <span className="text-cyan-400 font-semibold">
                              +{b.dod_tickets_growth.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {idx === 0 || b.dod_tickets_growth_pct === null ? (
                            <span className="text-slate-500 font-sans">&mdash;</span>
                          ) : b.dod_tickets_growth_pct > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-400 font-semibold">
                              <ArrowUpRight className="w-3 h-3 inline" />
                              +{b.dod_tickets_growth_pct}%
                            </span>
                          ) : (
                            <span className="text-slate-500">0.0%</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-emerald-400">
                          €{b.cumulative_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {(b.occupancy_rate * 100).toFixed(1)}%
                        </td>
                        <td className="py-3 px-4 text-right text-slate-400">{b.sessions_count}</td>
                        <td className="py-3 px-4 text-right text-slate-400">{b.cinemas_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cinema Contribution Breakdown */}
          {cinemas_breakdown && cinemas_breakdown.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Building className="w-4 h-4 text-purple-400" />
                  <span>Opening Day Cinema Breakdown (Latest Presale Snapshot)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Advance bookings distribution across Portuguese theatrical venues
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {cinemas_breakdown.map((c) => (
                  <div
                    key={c.cinema_id}
                    className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 space-y-2 hover:border-slate-700 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-white text-xs">{c.cinema_name}</div>
                        <div className="text-[11px] text-slate-400">{c.cinema_city || "NOS Cinema"}</div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/20">
                        {c.sessions_count} {c.sessions_count === 1 ? "show" : "shows"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/60 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Tickets Sold</span>
                        <span className="font-bold text-amber-400">{c.unavailable_seats}</span>
                        <span className="text-[10px] text-slate-500 block">
                          / {c.sellable_capacity} seats ({(c.occupancy_proxy * 100).toFixed(0)}%)
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block uppercase">Est. Revenue</span>
                        <span className="font-bold text-emerald-400">
                          €{c.estimated_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
