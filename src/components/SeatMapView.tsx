import React, { useEffect, useState, useMemo, useRef } from "react";
import { SeatMapResponse, SeatMapSeat } from "../types";
import { X, RefreshCw, AlertCircle, Info, Armchair, Shield } from "lucide-react";

interface SeatMapViewProps {
  sessionId: number;
  date?: string;
  onClose?: () => void;
  inline?: boolean;
}

export const SeatMapView: React.FC<SeatMapViewProps> = ({
  sessionId,
  date,
  onClose,
  inline = false,
}) => {
  const [data, setData] = useState<SeatMapResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredSeat, setHoveredSeat] = useState<SeatMapSeat | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 850,
    height: 480,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      if (el.clientWidth && el.clientHeight) {
        setContainerSize({
          width: el.clientWidth,
          height: el.clientHeight,
        });
      }
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, []);

  const fetchSeatMap = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/sessions/${sessionId}/seat-map${date ? `?date=${encodeURIComponent(date)}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}`);
      }
      const json: SeatMapResponse = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to load session seat map.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sessionId) {
      fetchSeatMap();
    }
  }, [sessionId, date]);

  // Map seats into grid rows & columns
  const gridInfo = useMemo(() => {
    if (!data || !data.seats || data.seats.length === 0) {
      return null;
    }

    const physicalSeats = data.seats.filter((s) => s.is_seat);
    if (physicalSeats.length === 0) return null;

    // Group seats by row/queue
    const rowGroupsMap = new Map<string, SeatMapSeat[]>();
    physicalSeats.forEach((seat) => {
      const key = seat.queue || `Row ${seat.row}`;
      if (!rowGroupsMap.has(key)) {
        rowGroupsMap.set(key, []);
      }
      rowGroupsMap.get(key)!.push(seat);
    });

    // Determine min/max col and sorted unique rows
    let minCol = Infinity;
    let maxCol = -Infinity;
    physicalSeats.forEach((s) => {
      const c = s.col !== undefined && s.col !== null ? s.col : (s.seat_number ?? 0);
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
    });

    if (minCol === Infinity) minCol = 0;
    if (maxCol === -Infinity) maxCol = 20;

    // Sort rows screen-adjacent (front/closest to screen) -> back of room
    // In NOS OutSystems data, row numbers are highest at the front (Row A) and 0 at the back (Row P)
    const sortedRowKeys = Array.from(rowGroupsMap.keys()).sort((a, b) => {
      const seatA = rowGroupsMap.get(a)![0];
      const seatB = rowGroupsMap.get(b)![0];
      const diff = (seatB.row ?? 0) - (seatA.row ?? 0);
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    });

    return {
      rowGroupsMap,
      sortedRowKeys,
      minCol,
      maxCol,
      totalColsCount: maxCol - minCol + 1,
    };
  }, [data]);

  // Dynamic layout calculations for SVG grid based on container budget
  const layoutParams = useMemo(() => {
    if (!gridInfo) {
      return {
        cellSize: 24,
        gapX: 5,
        gapY: 6,
        labelWidth: 40,
        paddingTop: 55,
        paddingBottom: 20,
        paddingX: 16,
        svgWidth: 800,
        svgHeight: 500,
        fontSizeSeat: 9,
        showSeatNumbers: true,
      };
    }

    const { totalColsCount, sortedRowKeys } = gridInfo;
    const rowCount = sortedRowKeys.length;

    const paddingTop = 55; // Screen banner space
    const paddingBottom = 20;
    const paddingX = 16;
    const labelWidth = 38; // Row labels on left & right

    const availWidth = Math.max(280, containerSize.width - paddingX * 2 - labelWidth * 2 - 32);
    const availHeight = Math.max(200, containerSize.height - paddingTop - paddingBottom - 32);

    // Dynamic S calculation:
    // width = cols * S + (cols - 1) * 0.2 S = (1.2 cols - 0.2) S
    // height = rows * S + (rows - 1) * 0.25 S = (1.25 rows - 0.25) S
    const rawSWidth = availWidth / Math.max(1, totalColsCount * 1.2 - 0.2);
    const rawSHeight = availHeight / Math.max(1, rowCount * 1.25 - 0.25);

    const rawS = Math.min(rawSWidth, rawSHeight);
    // Clamp cell size between 14px and 26px
    const cellSize = Math.max(14, Math.min(26, rawS));

    const gapX = Math.max(2, Math.round(cellSize * 0.2));
    const gapY = Math.max(3, Math.round(cellSize * 0.25));

    const gridWidth = totalColsCount * cellSize + (totalColsCount - 1) * gapX;
    const gridHeight = rowCount * cellSize + (rowCount - 1) * gapY;

    const svgWidth = Math.max(containerSize.width - 32, labelWidth * 2 + gridWidth + paddingX * 2);
    const svgHeight = paddingTop + gridHeight + paddingBottom;

    const showSeatNumbers = cellSize >= 18;
    const fontSizeSeat = Math.max(7, Math.round(cellSize * 0.45));

    return {
      cellSize,
      gapX,
      gapY,
      labelWidth,
      paddingTop,
      paddingBottom,
      paddingX,
      svgWidth,
      svgHeight,
      fontSizeSeat,
      showSeatNumbers,
    };
  }, [gridInfo, containerSize]);

  const content = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-950/80 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Armchair className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">Session Seat Map</h2>
              {data?.session.format && (
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-cyan-950/80 border border-cyan-800/80 text-cyan-300 rounded-md">
                  {data.session.format}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {data?.session.movie_title || "Loading..."} &bull; {data?.session.cinema_name} ({data?.session.room_name})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchSeatMap}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            title="Refresh map"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-cyan-400" : ""}`} />
          </button>
          {!inline && onClose && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Bar */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-slate-950/40 border-b border-slate-800 text-xs">
          <div className="bg-slate-800/50 border border-slate-800 rounded-xl p-2.5 text-center">
            <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Capacity</span>
            <span className="text-sm font-bold text-slate-200">{data.session.total_seats}</span>
          </div>
          <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-xl p-2.5 text-center">
            <span className="text-emerald-400 block text-[10px] uppercase tracking-wider">Available</span>
            <span className="text-sm font-bold text-emerald-400">{data.session.free_count}</span>
          </div>
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-2.5 text-center">
            <span className="text-slate-300 block text-[10px] uppercase tracking-wider">Sold</span>
            <span className="text-sm font-bold text-slate-100">{data.session.sold_count}</span>
          </div>
          <div className="bg-amber-950/30 border border-amber-900/50 rounded-xl p-2.5 text-center">
            <span className="text-amber-400 block text-[10px] uppercase tracking-wider">Structural Blocks</span>
            <span className="text-sm font-bold text-amber-400">{data.session.blocked_count}</span>
          </div>
          <div className="bg-cyan-950/30 border border-cyan-900/50 rounded-xl p-2.5 text-center col-span-2 sm:col-span-1">
            <span className="text-cyan-400 block text-[10px] uppercase tracking-wider">Accessible</span>
            <span className="text-sm font-bold text-cyan-300">{data.session.accessible_count}</span>
          </div>
        </div>
      )}

      {/* Main View Area */}
      <div ref={containerRef} className="flex-1 overflow-auto p-4 relative flex flex-col items-center min-h-[300px]">
        {loading && !data ? (
          <div className="flex flex-col items-center justify-center my-auto py-16 text-slate-400 gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
            <span className="text-sm font-medium">Loading session seat map...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center my-auto py-16 text-rose-400 gap-3 text-center">
            <AlertCircle className="w-10 h-10" />
            <span className="text-sm font-semibold">{error}</span>
            <button
              onClick={fetchSeatMap}
              className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors"
            >
              Retry
            </button>
          </div>
        ) : !gridInfo || data?.seats.length === 0 ? (
          <div className="flex flex-col items-center justify-center my-auto py-16 text-slate-400 gap-3 text-center">
            <Info className="w-10 h-10 text-slate-500" />
            <span className="text-sm font-medium text-slate-300">No seat map recorded for this session.</span>
            <span className="text-xs text-slate-500">Seat observations will appear after data sweeps from NOS.</span>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center max-w-full overflow-x-auto my-auto">
            {/* SVG Canvas */}
            <div className="relative inline-block border border-slate-800/80 rounded-2xl p-3 bg-slate-950/60 shadow-inner">
              <svg width={layoutParams.svgWidth} height={layoutParams.svgHeight} className="select-none font-sans">
                <defs>
                  {/* Structural Block Hatching Pattern */}
                  <pattern
                    id="structuralHatch"
                    patternUnits="userSpaceOnUse"
                    width="8"
                    height="8"
                    patternTransform="rotate(45)"
                  >
                    <rect width="8" height="8" fill="#1e293b" />
                    <line x1="0" y1="0" x2="0" y2="8" stroke="#f59e0b" strokeWidth="2.5" opacity="0.75" />
                  </pattern>

                  {/* Safety Buffer Pattern */}
                  <pattern
                    id="safetyPattern"
                    patternUnits="userSpaceOnUse"
                    width="6"
                    height="6"
                    patternTransform="rotate(135)"
                  >
                    <rect width="6" height="6" fill="#0f172a" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#64748b" strokeWidth="1.5" opacity="0.6" />
                  </pattern>
                </defs>

                {/* Cinema Screen Banner */}
                <g transform={`translate(${layoutParams.svgWidth / 2}, 18)`}>
                  <path
                    d={`M -${Math.min(180, layoutParams.svgWidth * 0.25)} 0 Q 0 10 ${Math.min(180, layoutParams.svgWidth * 0.25)} 0 L ${Math.min(170, layoutParams.svgWidth * 0.24)} 12 Q 0 20 -${Math.min(170, layoutParams.svgWidth * 0.24)} 12 Z`}
                    fill="url(#screenGrad)"
                    className="fill-cyan-500/20 stroke-cyan-400/40"
                    strokeWidth="1.5"
                  />
                  <linearGradient id="screenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#0284c7" stopOpacity="0.05" />
                  </linearGradient>
                  <text
                    x="0"
                    y="18"
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10"
                    fontWeight="700"
                    letterSpacing="3"
                    className="uppercase"
                  >
                    ECRÃ / SCREEN
                  </text>
                </g>

                {/* Seat Rows & Grid */}
                {gridInfo.sortedRowKeys.map((rowKey, rowIndex) => {
                  const seatsInRow = gridInfo.rowGroupsMap.get(rowKey) || [];
                  const yPos = layoutParams.paddingTop + rowIndex * (layoutParams.cellSize + layoutParams.gapY);

                  return (
                    <g key={rowKey} transform={`translate(0, ${yPos})`}>
                      {/* Left Row Label */}
                      <text
                        x={layoutParams.paddingX + layoutParams.labelWidth - 8}
                        y={layoutParams.cellSize / 2 + Math.max(3, layoutParams.cellSize * 0.15)}
                        textAnchor="end"
                        fill="#94a3b8"
                        fontSize={Math.max(9, Math.round(layoutParams.cellSize * 0.45))}
                        fontWeight="700"
                      >
                        {rowKey}
                      </text>

                      {/* Right Row Label */}
                      <text
                        x={layoutParams.svgWidth - layoutParams.paddingX - layoutParams.labelWidth + 8}
                        y={layoutParams.cellSize / 2 + Math.max(3, layoutParams.cellSize * 0.15)}
                        textAnchor="start"
                        fill="#94a3b8"
                        fontSize={Math.max(9, Math.round(layoutParams.cellSize * 0.45))}
                        fontWeight="700"
                      >
                        {rowKey}
                      </text>

                      {/* Seats in this row */}
                      {seatsInRow.map((seat) => {
                        const seatCol = seat.col !== undefined && seat.col !== null ? seat.col : (seat.seat_number ?? 0);
                        // In NOS OutSystems data, Col=maxCol is the physical left and Col=0 is the physical right when facing the screen
                        const colIdx = gridInfo.maxCol - seatCol;
                        const xPos = layoutParams.paddingX + layoutParams.labelWidth + colIdx * (layoutParams.cellSize + layoutParams.gapX);
                        const isHovered = hoveredSeat?.id === seat.id;

                        // Fill and stroke selection based on classification
                        let fillAttr = "#059669";
                        let strokeAttr = "#10b981";
                        let fillOpacity = "0.25";

                        if (seat.classification === "sold") {
                          fillAttr = "#1e293b";
                          strokeAttr = "#475569";
                          fillOpacity = "0.85";
                        } else if (seat.classification === "blocked") {
                          fillAttr = "url(#structuralHatch)";
                          strokeAttr = "#f59e0b";
                          fillOpacity = "1.0";
                        } else if (seat.classification === "safety") {
                          fillAttr = "url(#safetyPattern)";
                          strokeAttr = "#64748b";
                          fillOpacity = "0.9";
                        }

                        const iconSize = Math.min(12, layoutParams.cellSize * 0.55);

                        return (
                          <g
                            key={seat.id}
                            transform={`translate(${xPos}, 0)`}
                            className="cursor-pointer transition-transform duration-100"
                            onMouseEnter={() => setHoveredSeat(seat)}
                            onMouseLeave={() => setHoveredSeat(null)}
                          >
                            {/* Seat Base Rect */}
                            <rect
                              width={layoutParams.cellSize}
                              height={layoutParams.cellSize}
                              rx={Math.max(2, Math.round(layoutParams.cellSize * 0.15))}
                              fill={fillAttr}
                              fillOpacity={fillOpacity}
                              stroke={isHovered ? "#38bdf8" : strokeAttr}
                              strokeWidth={isHovered ? 2.5 : Math.max(1, layoutParams.cellSize * 0.08)}
                            />

                            {/* Glyphs for Sold (X) */}
                            {seat.classification === "sold" && (
                              <path
                                d={`M ${layoutParams.cellSize * 0.25} ${layoutParams.cellSize * 0.25} L ${layoutParams.cellSize * 0.75} ${layoutParams.cellSize * 0.75} M ${layoutParams.cellSize * 0.75} ${layoutParams.cellSize * 0.25} L ${layoutParams.cellSize * 0.25} ${layoutParams.cellSize * 0.75}`}
                                stroke="#94a3b8"
                                strokeWidth={Math.max(1.2, layoutParams.cellSize * 0.08)}
                                strokeLinecap="round"
                                opacity="0.75"
                              />
                            )}

                            {/* Accessible Overlay Icon */}
                            {seat.is_accessible && (
                              <g transform={`translate(${layoutParams.cellSize / 2 - iconSize / 2}, ${layoutParams.cellSize / 2 - iconSize / 2})`}>
                                <svg
                                  width={iconSize}
                                  height={iconSize}
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="#38bdf8"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <circle cx="12" cy="4" r="2" />
                                  <path d="M12 7v5l3 3" />
                                  <path d="M10 13a4 4 0 1 0 5.6 3.6" />
                                </svg>
                              </g>
                            )}

                            {/* Seat Number Text inside box if room permits */}
                            {seat.seat_number && !seat.is_accessible && layoutParams.showSeatNumbers && (
                              <text
                                x={layoutParams.cellSize / 2}
                                y={layoutParams.cellSize / 2 + layoutParams.fontSizeSeat * 0.35}
                                textAnchor="middle"
                                fill={seat.classification === "free" ? "#a7f3d0" : "#64748b"}
                                fontSize={layoutParams.fontSizeSeat}
                                fontWeight="600"
                                pointerEvents="none"
                              >
                                {seat.seat_number}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </svg>

              {/* Hover Tooltip Overlay */}
              {hoveredSeat && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-700 px-4 py-2.5 rounded-xl shadow-2xl text-xs z-20 flex items-center gap-3 backdrop-blur-md">
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-100">
                      {hoveredSeat.queue ? `Row ${hoveredSeat.queue}` : `Row ${hoveredSeat.row}`}, Seat {hoveredSeat.seat_number || hoveredSeat.col}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Key: <code className="text-cyan-300 font-mono text-[10px]">{hoveredSeat.stable_seat_key}</code>
                    </span>
                  </div>

                  <div className="h-6 w-px bg-slate-800" />

                  <div className="flex items-center gap-1.5 font-medium">
                    {hoveredSeat.classification === "free" && (
                      <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-md">
                        Available
                      </span>
                    )}
                    {hoveredSeat.classification === "sold" && (
                      <span className="px-2 py-0.5 bg-slate-800 text-slate-300 border border-slate-700 rounded-md">
                        Sold
                      </span>
                    )}
                    {hoveredSeat.classification === "blocked" && (
                      <span className="px-2 py-0.5 bg-amber-950 text-amber-300 border border-amber-800 rounded-md font-semibold">
                        Structural block — excluded from revenue
                      </span>
                    )}
                    {hoveredSeat.classification === "safety" && (
                      <span className="px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-md">
                        Safety Buffer Seat
                      </span>
                    )}
                    {hoveredSeat.is_accessible && (
                      <span className="px-2 py-0.5 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded-md">
                        ♿ Accessible (Wheelchair)
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend Footer */}
      <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-5">
          {/* Free Legend */}
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-emerald-950/40 border border-emerald-500/80 flex items-center justify-center text-[10px] text-emerald-300">
              12
            </div>
            <span className="text-slate-300 font-medium">Available</span>
          </div>

          {/* Sold Legend */}
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-slate-800 border border-slate-600 flex items-center justify-center text-slate-400 text-[10px]">
              ✕
            </div>
            <span className="text-slate-300 font-medium">Sold</span>
          </div>

          {/* Structural Block Legend */}
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-slate-800 border border-amber-500 overflow-hidden relative">
              <svg width="20" height="20">
                <rect width="20" height="20" fill="url(#structuralHatch)" />
              </svg>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-amber-300 font-medium">Structural Block</span>
              <span className="text-[10px] text-amber-400/80 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.2 rounded">
                Excluded from revenue
              </span>
            </div>
          </div>

          {/* Accessible Legend */}
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-emerald-950/40 border border-emerald-500/80 flex items-center justify-center text-cyan-400">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="4" r="2" />
                <path d="M12 7v5l3 3" />
                <path d="M10 13a4 4 0 1 0 5.6 3.6" />
              </svg>
            </div>
            <span className="text-slate-300 font-medium">Accessible (Wheelchair)</span>
          </div>
        </div>

        {data?.session.snapshot_collected_at && (
          <div className="text-[11px] text-slate-500 font-mono">
            Last sweep: {new Date(data.session.snapshot_collected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Lisbon" })} ({new Date(data.session.snapshot_collected_at).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "Europe/Lisbon" })})
          </div>
        )}
      </div>
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-5xl h-[88vh] max-h-[850px] shadow-2xl">
        {content}
      </div>
    </div>
  );
};
