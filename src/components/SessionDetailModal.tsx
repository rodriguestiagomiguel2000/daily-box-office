import React, { useEffect, useState } from "react";
import { X, Calendar, Clock, Film, ShieldCheck, ShieldAlert, BarChart2, TrendingUp, Users, Ticket, RefreshCw } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { SessionHistoryResponse, SessionSnapshotHistory } from "../types";
import { fetchJson } from "../utils/api";

interface SessionDetailModalProps {
  sessionId: number | null;
  onClose: () => void;
}

export const SessionDetailModal: React.FC<SessionDetailModalProps> = ({ sessionId, onClose }) => {
  const [data, setData] = useState<SessionHistoryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetchSessionHistory();
  }, [sessionId]);

  const fetchSessionHistory = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchJson<SessionHistoryResponse>(`/api/sessions/${sessionId}/history`);
      setData(json);
    } catch (err: any) {
      setError(err.message || "An error occurred fetching session details");
    } finally {
      setLoading(false);
    }
  };

  if (!sessionId) return null;

  const session = data?.session;
  const snapshots = data?.snapshots || [];

  // Format chart data points
  const chartData = snapshots.map((s) => {
    const d = new Date(s.collected_at);
    return {
      time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }),
      unavailable: s.unavailable_seats,
      available: s.available_seats,
      newly_unavailable: s.newly_unavailable,
      occupancy_pct: Math.round(s.occupancy_proxy * 1000) / 10,
      velocity: Math.round(s.sales_velocity_proxy * 10) / 10,
    };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800/80 bg-slate-900/90">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Session Telemetry
              </span>
              {session?.format && (
                <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-slate-800 text-cyan-400 border border-slate-700">
                  {session.format}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              {session?.movie_title || "Session Detail"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
              <span>{session?.cinema_name} ({session?.cinema_city})</span>
              <span>•</span>
              <span>{session?.room_name}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchSessionHistory}
              disabled={loading}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Refresh session data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-20 text-center text-slate-400 flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
              <p>Loading session trajectory history...</p>
            </div>
          ) : error ? (
            <div className="p-6 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
              {error}
            </div>
          ) : session ? (
            <>
              {/* Session Overview KPI Bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5">
                  <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5 mb-1">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    Start Time
                  </div>
                  <div className="text-sm font-semibold text-slate-200">
                    {session.starts_at ? new Date(session.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }) : "N/A"}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{session.operational_date}</div>
                </div>

                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5">
                  <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5 mb-1">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    Capacity
                  </div>
                  <div className="text-base font-bold text-slate-200">{session.sellable_capacity}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Sellable Seats</div>
                </div>

                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5">
                  <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5 mb-1">
                    <Ticket className="w-3.5 h-3.5 text-emerald-400" />
                    Available
                  </div>
                  <div className="text-base font-bold text-emerald-400">{session.available_seats}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Current Unreserved</div>
                </div>

                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5">
                  <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5 mb-1">
                    <Ticket className="w-3.5 h-3.5 text-amber-400" />
                    Unavailable
                  </div>
                  <div className="text-base font-bold text-amber-400">{session.unavailable_seats}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Occupied Proxy</div>
                </div>

                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5">
                  <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                    Occupancy
                  </div>
                  <div className="text-base font-bold text-cyan-400">
                    {(session.occupancy_proxy * 100).toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Seat Matrix Ratio</div>
                </div>

                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5">
                  <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5 mb-1">
                    <RefreshCw className="w-3.5 h-3.5 text-purple-400" />
                    Last Sweep
                  </div>
                  <div className="text-xs font-medium text-slate-300">
                    {session.latest_collected_at ? new Date(session.latest_collected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }) : "N/A"}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{snapshots.length} total sweeps</div>
                </div>
              </div>

              {/* Session Trajectory Charts */}
              {chartData.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-cyan-400" />
                    Session Trajectory Charts
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Unavailable Seats (Occupancy) Chart */}
                    <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-4">
                      <div className="text-xs font-semibold text-amber-400 mb-3 flex items-center justify-between">
                        <span>Unavailable Seats (Occupancy)</span>
                        <span className="text-[10px] font-normal text-slate-500">time → unavailable</span>
                      </div>
                      <div className="h-40 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                            <YAxis stroke="#64748b" fontSize={11} />
                            <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px", fontSize: "12px", color: "#f8fafc" }} itemStyle={{ color: "#f8fafc" }} labelStyle={{ color: "#94a3b8", fontWeight: 600, marginBottom: "4px" }} />
                            <Line type="monotone" dataKey="unavailable" name="Unavailable" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Available Seats Chart */}
                    <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-4">
                      <div className="text-xs font-semibold text-emerald-400 mb-3 flex items-center justify-between">
                        <span>Available Seats</span>
                        <span className="text-[10px] font-normal text-slate-500">time → available</span>
                      </div>
                      <div className="h-40 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                            <YAxis stroke="#64748b" fontSize={11} />
                            <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px", fontSize: "12px", color: "#f8fafc" }} itemStyle={{ color: "#f8fafc" }} labelStyle={{ color: "#94a3b8", fontWeight: 600, marginBottom: "4px" }} />
                            <Line type="monotone" dataKey="available" name="Available" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* New Unavailable (Reservation Deltas) Chart */}
                    <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-4">
                      <div className="text-xs font-semibold text-cyan-400 mb-3 flex items-center justify-between">
                        <span>Newly Unavailable Seats</span>
                        <span className="text-[10px] font-normal text-slate-500">time → new unavailable</span>
                      </div>
                      <div className="h-40 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                            <YAxis stroke="#64748b" fontSize={11} />
                            <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px", fontSize: "12px", color: "#f8fafc" }} itemStyle={{ color: "#f8fafc" }} labelStyle={{ color: "#94a3b8", fontWeight: 600, marginBottom: "4px" }} />
                            <Bar dataKey="newly_unavailable" name="Newly Unavailable" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Velocity Proxy Chart */}
                    <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-4">
                      <div className="text-xs font-semibold text-purple-400 mb-3 flex items-center justify-between">
                        <span>Sales Velocity Proxy (tix/hr)</span>
                        <span className="text-[10px] font-normal text-slate-500">time → tix/hr</span>
                      </div>
                      <div className="h-40 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                            <YAxis stroke="#64748b" fontSize={11} />
                            <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px", fontSize: "12px", color: "#f8fafc" }} itemStyle={{ color: "#f8fafc" }} labelStyle={{ color: "#94a3b8", fontWeight: 600, marginBottom: "4px" }} />
                            <Line type="monotone" dataKey="velocity" name="Velocity (tix/hr)" stroke="#a855f7" strokeWidth={2} dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tracking History Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                    Tracking History ({snapshots.length} Chronological Sweeps)
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">Ordered: Oldest → Newest</span>
                </div>

                <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-900/60">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-800/50 text-slate-400 uppercase text-[10px] font-mono tracking-wider">
                        <th className="py-2.5 px-3">Time</th>
                        <th className="py-2.5 px-3 text-right">Available</th>
                        <th className="py-2.5 px-3 text-right">Unavailable</th>
                        <th className="py-2.5 px-3 text-right">Occupancy %</th>
                        <th className="py-2.5 px-3 text-right">Newly Unavail</th>
                        <th className="py-2.5 px-3 text-right">Newly Avail</th>
                        <th className="py-2.5 px-3 text-right">Velocity</th>
                        <th className="py-2.5 px-3 text-center">Invariant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {snapshots.map((s) => {
                        const dateObj = new Date(s.collected_at);
                        const timeStr = dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Lisbon" });
                        const dateStr = dateObj.toLocaleDateString([], { month: "short", day: "numeric", timeZone: "Europe/Lisbon" });
                        const occPct = (s.occupancy_proxy * 100).toFixed(1);

                        return (
                          <tr key={s.id} className="hover:bg-slate-800/40 transition-colors text-slate-300">
                            <td className="py-2 px-3 text-slate-400">
                              <span className="text-slate-200 font-semibold">{timeStr}</span>
                              <span className="text-[10px] text-slate-500 ml-1.5">{dateStr}</span>
                            </td>
                            <td className="py-2 px-3 text-right text-emerald-400 font-medium">{s.available_seats}</td>
                            <td className="py-2 px-3 text-right text-amber-400 font-medium">{s.unavailable_seats}</td>
                            <td className="py-2 px-3 text-right font-bold text-cyan-400">{occPct}%</td>
                            <td className="py-2 px-3 text-right font-medium text-cyan-300">
                              {s.newly_unavailable > 0 ? `+${s.newly_unavailable}` : "0"}
                            </td>
                            <td className="py-2 px-3 text-right font-medium text-slate-400">
                              {s.newly_available > 0 ? `-${s.newly_available}` : "0"}
                            </td>
                            <td className="py-2 px-3 text-right text-purple-400">
                              {s.sales_velocity_proxy > 0 ? `${s.sales_velocity_proxy.toFixed(1)}/h` : "0"}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {s.invariant_valid ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-sans px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  <ShieldCheck className="w-3 h-3" /> Valid
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-sans px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                  <ShieldAlert className="w-3 h-3" /> Fail
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>

      </div>
    </div>
  );
};
