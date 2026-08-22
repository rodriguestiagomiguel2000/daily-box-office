import { query } from "./db";
import { getSessionPricesSqlCte } from "./revenue";
import {
  getOperationalDateStr,
  parseLisbonLocalToUTC,
  getOrComputeMovieSnapshotsBatch,
  getOrComputeMovieSnapshotAtTime,
} from "./api";
import {
  getDayOfWeek,
  getDayOfWeekName,
  getMovieRunDay,
  calculatePercentChange,
  isTheatricalWeekend,
  addDays,
  normalizeDateStr,
} from "./boxoffice";

export const FORECAST_MODEL_VERSION = "curve_completion_v2";

export type ForecastConfidence = "High" | "Medium" | "Low";

export interface ForecastPoint {
  time: string; // e.g. "08:00", "14:00", "05:59 (EOD)"
  today_revenue: number | null;
  forecast_revenue: number | null;
  forecast_low: number | null;
  forecast_high: number | null;
}

export interface ComparableCurveInfo {
  date: string;
  label: string;
  weight: number;
  eod_revenue: number;
  cutoff_revenue: number;
  fraction_achieved_at_cutoff: number;
  remaining_ratio: number;
  projected_eod: number;
  similarity_rank?: number;
}

export interface ForecastModelDiagnostics {
  modelVersion: string;
  currentRevenue: number;
  latestDataTime: string;
  cutoffTime: string;
  runDay: number;
  runDayLabel: string;
  operationalDate: string;
  
  // Historical Completion Evidence
  comparableDaysCount: number;
  medianCompletionRatio: number;
  completionRatioIQR: number;
  minCompletionRatio: number;
  maxCompletionRatio: number;
  
  // Momentum
  baselineHistoricalCutoff: number;
  performanceRatioVsComparable: number;
  dampingFactor: number;
  dampedMomentumFactor: number;
  
  // Inventory
  remainingShows: number;
  remainingCapacity: number;
  avgUnitPrice: number;
  inventoryConstraintApplied: boolean;
  maxPlausibleRemainingRevenue: number;
  
  // Remaining vs Total
  baselineRemainingRevenue: number;
  finalRemainingRevenue: number;
  
  // Backtest Quality at this cutoff horizon
  backtestQuality: {
    cutoffTime: string;
    sampleSize: number;
    mae: number | null;
    mape: number | null;
    medianAbsoluteError: number | null;
    bias: number | null;
    errorP15: number | null;
    errorP85: number | null;
  };
}

export interface MovieForecastResponse {
  movie_id: number;
  movie_title?: string;
  operational_date: string;
  current_time_requested: string;
  latest_data_time: string;
  is_day_complete: boolean;
  actual_revenue: number;
  actual_admissions: number;
  actual_occupancy: number;
  actual_shows: number;
  remaining_shows: number;
  remaining_capacity: number;

  forecast: {
    low: number;
    expected: number;
    high: number;
    confidence: ForecastConfidence;
    confidence_reasons: string[];
    uncertainty_pct: number;
    median_completion_ratio: number;
    damped_momentum: number;
  } | null;

  diagnostics: ForecastModelDiagnostics | null;

  comparisons: {
    yesterday_eod_revenue: number | null;
    yesterday_date: string | null;
    change_vs_yesterday_eod: number | null;

    last_week_eod_revenue: number | null;
    last_week_date: string | null;
    change_vs_last_week_eod: number | null;
  };

  comparable_curves: ComparableCurveInfo[];
  curve: ForecastPoint[];
}

export interface ForecastEngineHistoricalDay {
  operationalDate: string;
  dayOfWeek: number;
  dayOfWeekName: string;
  runDay: number;
  daysAgo: number;
  cutoffRevenue: number; // Historical revenue at the exact same cutoff time
  eodRevenue: number; // Final EOD revenue at 05:59
  cutoffAdmissions?: number;
  eodAdmissions?: number;
}

export interface ForecastEngineInput {
  movieId: number;
  operationalDate: string;
  cutoffTime: string;
  latestDataTime: string;
  currentRevenue: number;
  currentAdmissions: number;
  currentOccupancy: number;
  currentShows: number;
  remainingShows: number;
  remainingCapacity: number;
  avgUnitPrice: number;
  runDay: number;
  runDayLabel: string;
  
  // Completed historical days strictly before target operationalDate
  historicalDays: ForecastEngineHistoricalDay[];

  // Historical backtest calibration stats for this cutoff
  historicalCutoffCalibration?: {
    cutoff_time: string;
    mae: number;
    mape: number;
    median_absolute_error: number;
    bias: number;
    error_p15: number;
    error_p85: number;
    backtest_count: number;
  } | null;
}

export interface ForecastEngineOutput {
  expected: number;
  low: number;
  high: number;
  confidence: ForecastConfidence;
  confidenceReasons: string[];
  uncertaintyPct: number;
  medianCompletionRatio: number;
  dampedMomentum: number;
  diagnostics: ForecastModelDiagnostics;
  comparableCurves: ComparableCurveInfo[];
}

export const STANDARD_HOURLY_SLOTS = [
  "08:00",
  "10:00",
  "12:00",
  "14:00",
  "16:00",
  "18:00",
  "20:00",
  "22:00",
  "23:59",
  "02:00",
  "05:59",
];

/**
 * Standard Portuguese Theatrical Baseline Cumulative Completion Fractions (06:00 to 05:59).
 * Segmented by Weekdays (Mon-Thu) vs Theatrical Weekends (Fri-Sun).
 */
export const BASELINE_WEEKDAY_FRACTIONS: Record<string, number> = {
  "08:00": 0.04,
  "10:00": 0.08,
  "12:00": 0.15,
  "14:00": 0.28,
  "16:00": 0.42,
  "18:00": 0.58,
  "20:00": 0.78,
  "22:00": 0.92,
  "23:59": 0.97,
  "02:00": 0.99,
  "05:59": 1.00,
};

export const BASELINE_WEEKEND_FRACTIONS: Record<string, number> = {
  "08:00": 0.06,
  "10:00": 0.18,
  "12:00": 0.32,
  "14:00": 0.48,
  "16:00": 0.65,
  "18:00": 0.78,
  "20:00": 0.88,
  "22:00": 0.95,
  "23:59": 0.98,
  "02:00": 0.99,
  "05:59": 1.00,
};

export const BASELINE_CUMULATIVE_FRACTIONS: Record<string, number> = BASELINE_WEEKDAY_FRACTIONS;

/**
 * Converts a Lisbon local time string (HH:mm) into minutes elapsed within
 * the Theatrical Operational Day (06:00 -> 05:59 Lisbon).
 */
export function timeToOperationalMinutes(timeStr: string): number {
  const clean = timeStr.replace(" (EOD)", "").replace(" (+1d)", "").trim();
  const parts = clean.split(":");
  const hour = parseInt(parts[0], 10) || 0;
  const min = parseInt(parts[1], 10) || 0;

  if (hour >= 6) {
    return (hour - 6) * 60 + min;
  } else {
    return (hour + 18) * 60 + min;
  }
}

/**
 * Helper to calculate median and quantiles of an array of numbers.
 */
function getMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getQuantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * UNIFIED DETERMINISTIC FORECASTING ENGINE
 *
 * Used by BOTH production live API queries and walk-forward historical backtesting.
 * Guarantees zero look-ahead bias and identical mathematical behavior.
 */
export function forecastEngine(input: ForecastEngineInput): ForecastEngineOutput {
  const {
    movieId,
    operationalDate,
    cutoffTime,
    latestDataTime,
    currentRevenue,
    currentShows,
    remainingShows,
    remainingCapacity,
    avgUnitPrice,
    runDay,
    runDayLabel,
    historicalDays,
    historicalCutoffCalibration,
  } = input;

  const currentOpMinutes = timeToOperationalMinutes(latestDataTime);
  const confidenceReasons: string[] = [];
  const targetIsWeekend = isTheatricalWeekend(operationalDate);
  const baselineCurve = targetIsWeekend ? BASELINE_WEEKEND_FRACTIONS : BASELINE_WEEKDAY_FRACTIONS;

  // 1. Process and rank historical comparable days strictly preceding the target day
  interface RankedComparable {
    day: ForecastEngineHistoricalDay;
    completionRatio: number;
    remainingRatio: number;
    projectedRemaining: number;
    projectedEOD: number;
    similarityScore: number;
    label: string;
  }

  const validComparables: RankedComparable[] = [];

  for (const hDay of historicalDays) {
    if (hDay.eodRevenue <= 0) continue;

    const hIsWeekend = isTheatricalWeekend(hDay.operationalDate);
    const hBaselineCurve = hIsWeekend ? BASELINE_WEEKEND_FRACTIONS : BASELINE_WEEKDAY_FRACTIONS;
    const hBaselineFraction = hBaselineCurve[cutoffTime] || 0.25;

    // completionRatio = revenueAtCutoff / finalEodRevenue
    let rawRatio = hDay.cutoffRevenue / hDay.eodRevenue;
    if (rawRatio < 0.05 && hBaselineFraction >= 0.05) {
      rawRatio = Math.max(rawRatio, hBaselineFraction * 0.75);
    }

    const completionRatio = Math.max(0.03, Math.min(1.0, rawRatio));
    const remainingRatio = Math.max(0, (1 - completionRatio) / completionRatio);

    // Relevance scoring hierarchy:
    // 1. Same weekday previous week (-7d, -14d): Score = 100 / 90
    // 2. Same day-type (Weekend vs Weekday): Score = 75-85
    // 3. Previous operational day (-1d): Score = 70-80
    // 4. Other historical days
    let similarityScore = 40;
    let label = `Historical Day (${hDay.operationalDate})`;

    if (hDay.daysAgo === 7) {
      similarityScore = 100;
      label = `Same Weekday Last Week (${hDay.operationalDate}, -7d)`;
    } else if (hDay.daysAgo % 7 === 0 && hDay.daysAgo <= 28) {
      similarityScore = 90 - (hDay.daysAgo / 7) * 4;
      label = `Same Weekday (${hDay.operationalDate}, -${hDay.daysAgo}d)`;
    } else if (targetIsWeekend === hIsWeekend) {
      if (hDay.daysAgo === 1) {
        similarityScore = 82;
        label = `Previous Operational Day (${hDay.operationalDate}, -1d)`;
      } else {
        similarityScore = Math.max(50, 78 - hDay.daysAgo * 2);
        label = targetIsWeekend ? `Recent Weekend (${hDay.operationalDate}, -${hDay.daysAgo}d)` : `Recent Weekday (${hDay.operationalDate}, -${hDay.daysAgo}d)`;
      }
    } else if (hDay.daysAgo === 1) {
      similarityScore = 70;
      label = `Previous Operational Day (${hDay.operationalDate}, -1d)`;
    } else {
      similarityScore = Math.max(15, 50 - hDay.daysAgo * 2);
      label = `Historical Day (${hDay.operationalDate}, -${hDay.daysAgo}d)`;
    }

    // Run day decay penalty if distant in run
    const runDayDiff = Math.abs(hDay.runDay - runDay);
    if (runDayDiff > 7) {
      similarityScore = Math.max(10, similarityScore - (runDayDiff - 7) * 2);
    }

    const projectedRemaining = currentRevenue > 0 ? currentRevenue * remainingRatio : Math.max(0, hDay.eodRevenue - hDay.cutoffRevenue);
    const projectedEOD = currentRevenue > 0 ? Math.round(currentRevenue + projectedRemaining) : hDay.eodRevenue;

    validComparables.push({
      day: hDay,
      completionRatio,
      remainingRatio,
      projectedRemaining,
      projectedEOD,
      similarityScore,
      label,
    });
  }

  // Sort comparables by similarity score descending (most relevant first)
  validComparables.sort((a, b) => b.similarityScore - a.similarityScore);

  // 2. Derive robust central estimate of completion ratio across comparable days
  let medianCompletionRatio = 0.35;
  let completionRatioIQR = 0;
  let minCompletionRatio = 0.05;
  let maxCompletionRatio = 1.0;
  let baselineHistoricalCutoff = currentRevenue;
  const comparableCurves: ComparableCurveInfo[] = [];

  if (validComparables.length > 0) {
    const ratios = validComparables.map((c) => c.completionRatio);
    const rawMedian = getMedian(ratios);
    const q25 = getQuantile(ratios, 0.25);
    const q75 = getQuantile(ratios, 0.75);
    completionRatioIQR = Math.round((q75 - q25) * 1000) / 1000;
    minCompletionRatio = Math.min(...ratios);
    maxCompletionRatio = Math.max(...ratios);

    const cutoffRevs = validComparables.map((c) => c.day.cutoffRevenue);
    baselineHistoricalCutoff = getMedian(cutoffRevs);

    // Weighted blend with top comparables
    const topComparables = validComparables.slice(0, 5);
    const totalSim = topComparables.reduce((sum, c) => sum + c.similarityScore, 0);
    const weightedRatio = totalSim > 0 ? topComparables.reduce((sum, c) => sum + c.completionRatio * c.similarityScore, 0) / totalSim : rawMedian;

    medianCompletionRatio = Math.round((0.4 * rawMedian + 0.6 * weightedRatio) * 1000) / 1000;

    for (let i = 0; i < topComparables.length; i++) {
      const c = topComparables[i];
      const weight = totalSim > 0 ? Math.round((c.similarityScore / totalSim) * 1000) / 1000 : 1 / topComparables.length;
      comparableCurves.push({
        date: c.day.operationalDate,
        label: c.label,
        weight,
        eod_revenue: c.day.eodRevenue,
        cutoff_revenue: c.day.cutoffRevenue,
        fraction_achieved_at_cutoff: Math.round(c.completionRatio * 1000) / 1000,
        remaining_ratio: Math.round(c.remainingRatio * 100) / 100,
        projected_eod: c.projectedEOD,
        similarity_rank: i + 1,
      });
    }

    if (validComparables.some((c) => c.day.daysAgo === 7)) {
      confidenceReasons.push("Same weekday baseline from previous week matched");
    }
    if (validComparables.length >= 3) {
      confidenceReasons.push(`${validComparables.length} historical comparable operational days synthesized`);
    } else {
      confidenceReasons.push(`${validComparables.length} historical operational days available`);
    }
  } else {
    // Fallback: Opening Day / Run Day 1 with no prior days
    let baselineFraction = 0.35;
    for (const h of STANDARD_HOURLY_SLOTS) {
      if (currentOpMinutes <= timeToOperationalMinutes(h)) {
        baselineFraction = baselineCurve[h] || 0.35;
        break;
      }
    }
    medianCompletionRatio = baselineFraction;
    minCompletionRatio = baselineFraction;
    maxCompletionRatio = baselineFraction;
    baselineHistoricalCutoff = currentRevenue;

    const baselineEod = currentRevenue > 0 ? Math.round(currentRevenue / baselineFraction) : 0;
    comparableCurves.push({
      date: operationalDate,
      label: `Opening Day Baseline Progression (${runDayLabel})`,
      weight: 1.0,
      eod_revenue: baselineEod,
      cutoff_revenue: currentRevenue,
      fraction_achieved_at_cutoff: baselineFraction,
      remaining_ratio: Math.round(((1 - baselineFraction) / baselineFraction) * 100) / 100,
      projected_eod: baselineEod,
      similarity_rank: 1,
    });
    confidenceReasons.push(`Early movie run (${runDayLabel}): using theatrical baseline completion profile`);
  }

  // 3. Baseline Remaining Revenue Calculation
  // Expected Remaining Revenue = Current Revenue * ((1 - completionRatio) / completionRatio)
  let baselineRemainingRevenue = 0;
  if (currentRevenue > 0 && medianCompletionRatio > 0 && medianCompletionRatio < 1.0) {
    baselineRemainingRevenue = currentRevenue * ((1 - medianCompletionRatio) / medianCompletionRatio);
  } else if (currentRevenue === 0 && validComparables.length > 0) {
    // If current revenue is zero (very early morning), use median remaining of historical days
    const histRemainings = validComparables.map((c) => Math.max(0, c.day.eodRevenue - c.day.cutoffRevenue));
    baselineRemainingRevenue = getMedian(histRemainings);
  }

  // 4. Controlled Momentum Adjustment
  // Performance ratio at cutoff = currentRevenue / baselineHistoricalCutoff
  let performanceRatio = 1.0;
  if (baselineHistoricalCutoff > 0 && currentRevenue > 0) {
    performanceRatio = currentRevenue / baselineHistoricalCutoff;
  }

  // Dampen momentum so it doesn't assume wild outperformance throughout the entire remaining day
  // Damping factor is bounded (e.g. 0.30)
  const dampingFactor = 0.30;
  const rawMomentumDelta = performanceRatio - 1.0;
  const clampedMomentumDelta = Math.max(-0.6, Math.min(0.8, rawMomentumDelta));
  const dampedMomentumFactor = Math.max(0.75, Math.min(1.35, 1.0 + clampedMomentumDelta * dampingFactor));

  let momentumRemainingRevenue = baselineRemainingRevenue * dampedMomentumFactor;

  // 5. Remaining Session Inventory as Secondary Signal
  // Constrain remaining forecast to what is physically plausible given remaining scheduled seats
  let inventoryConstraintApplied = false;
  const unitPrice = avgUnitPrice > 0 ? avgUnitPrice : 8.75;
  const maxPlausibleRemainingRevenue = remainingCapacity > 0 ? remainingCapacity * unitPrice * 0.95 : Infinity;

  if (remainingCapacity > 0 && momentumRemainingRevenue > maxPlausibleRemainingRevenue) {
    momentumRemainingRevenue = maxPlausibleRemainingRevenue;
    inventoryConstraintApplied = true;
    confidenceReasons.push("Remaining revenue capped by scheduled seating capacity");
  }

  // If no remaining sessions and late in the operational day (past 23:30), remaining revenue must taper to 0
  if (remainingShows === 0 && currentOpMinutes >= 1050) {
    const lateFactor = Math.max(0, (1440 - currentOpMinutes) / 390);
    momentumRemainingRevenue = Math.min(momentumRemainingRevenue, currentRevenue * 0.05 * lateFactor);
    if (momentumRemainingRevenue < 10) momentumRemainingRevenue = 0;
  }

  // 6. Final Expected EOD Revenue
  const finalRemainingRevenue = Math.max(0, Math.round(momentumRemainingRevenue));
  const expectedEOD = Math.max(currentRevenue, Math.round(currentRevenue + finalRemainingRevenue));

  // 7. Data-Driven Forecast Range & Empirical Uncertainty
  // Derive range from empirical backtest errors at this cutoff horizon when available,
  // contracting naturally as time-of-day advances.
  let deltaLow = 0;
  let deltaHigh = 0;
  let uncertaintyPct = 0.15;

  if (historicalCutoffCalibration && historicalCutoffCalibration.backtest_count >= 3) {
    // Empirical error-based bounds from actual historical backtesting
    const mae = historicalCutoffCalibration.mae;
    const p15 = Math.abs(historicalCutoffCalibration.error_p15);
    const p85 = Math.abs(historicalCutoffCalibration.error_p85);

    deltaLow = Math.max(mae * 1.1, p15 > 0 ? p15 : mae);
    deltaHigh = Math.max(mae * 1.1, p85 > 0 ? p85 : mae);
    uncertaintyPct = expectedEOD > 0 ? Math.round(((deltaLow + deltaHigh) / 2 / expectedEOD) * 1000) / 1000 : 0.15;
    confidenceReasons.push(`Empirical backtest error calibrated at ${cutoffTime} (MAE: €${Math.round(mae).toLocaleString()})`);
  } else {
    // Natural day-progress uncertainty contraction
    const dayProgressRatio = Math.max(0, Math.min(1.0, currentOpMinutes / 1440));
    const baseUncertainty = 0.28 * Math.pow(1 - dayProgressRatio, 1.25) + 0.03;
    const dispersionPenalty = Math.min(0.12, completionRatioIQR * 0.5);
    uncertaintyPct = Math.min(0.40, Math.max(0.03, baseUncertainty + dispersionPenalty));

    deltaLow = expectedEOD * uncertaintyPct;
    deltaHigh = expectedEOD * uncertaintyPct;
  }

  // Sanity checks: Low cannot be lower than current actual, High >= Expected >= Low
  const forecastLow = Math.max(currentRevenue, Math.round(expectedEOD - deltaLow));
  const forecastHigh = Math.max(expectedEOD, Math.round(expectedEOD + deltaHigh));

  // 8. Confidence Level Calculation
  let confidence: ForecastConfidence = "Medium";
  const hasSameWeekday = validComparables.some((c) => c.day.daysAgo === 7);
  const hasYesterday = validComparables.some((c) => c.day.daysAgo === 1);

  if (runDay <= 1 || (currentOpMinutes < 240 && currentRevenue < 500) || validComparables.length === 0) {
    confidence = "Low";
    if (runDay <= 1) confidenceReasons.push("Opening run day: baseline curves applied");
  } else if (hasSameWeekday && validComparables.length >= 3 && currentOpMinutes >= 360 && completionRatioIQR < 0.15) {
    confidence = "High";
    confidenceReasons.push("High historical completion ratio agreement & mature intraday tracking");
  } else if (hasYesterday || hasSameWeekday || validComparables.length >= 2) {
    confidence = "Medium";
    confidenceReasons.push("Moderate historical comparison evidence available");
  } else {
    confidence = "Low";
  }

  const diagnostics: ForecastModelDiagnostics = {
    modelVersion: FORECAST_MODEL_VERSION,
    currentRevenue,
    latestDataTime,
    cutoffTime,
    runDay,
    runDayLabel,
    operationalDate,
    comparableDaysCount: validComparables.length,
    medianCompletionRatio: Math.round(medianCompletionRatio * 1000) / 1000,
    completionRatioIQR,
    minCompletionRatio: Math.round(minCompletionRatio * 1000) / 1000,
    maxCompletionRatio: Math.round(maxCompletionRatio * 1000) / 1000,
    baselineHistoricalCutoff: Math.round(baselineHistoricalCutoff),
    performanceRatioVsComparable: Math.round(performanceRatio * 100) / 100,
    dampingFactor,
    dampedMomentumFactor: Math.round(dampedMomentumFactor * 100) / 100,
    remainingShows,
    remainingCapacity,
    avgUnitPrice: Math.round(unitPrice * 100) / 100,
    inventoryConstraintApplied,
    maxPlausibleRemainingRevenue: isFinite(maxPlausibleRemainingRevenue) ? Math.round(maxPlausibleRemainingRevenue) : -1,
    baselineRemainingRevenue: Math.round(baselineRemainingRevenue),
    finalRemainingRevenue,
    backtestQuality: {
      cutoffTime,
      sampleSize: historicalCutoffCalibration?.backtest_count || 0,
      mae: historicalCutoffCalibration?.mae ? Math.round(historicalCutoffCalibration.mae * 100) / 100 : null,
      mape: historicalCutoffCalibration?.mape ? Math.round(historicalCutoffCalibration.mape * 10) / 10 : null,
      medianAbsoluteError: historicalCutoffCalibration?.median_absolute_error ? Math.round(historicalCutoffCalibration.median_absolute_error * 100) / 100 : null,
      bias: historicalCutoffCalibration?.bias ? Math.round(historicalCutoffCalibration.bias * 100) / 100 : null,
      errorP15: historicalCutoffCalibration?.error_p15 ? Math.round(historicalCutoffCalibration.error_p15 * 100) / 100 : null,
      errorP85: historicalCutoffCalibration?.error_p85 ? Math.round(historicalCutoffCalibration.error_p85 * 100) / 100 : null,
    },
  };

  return {
    expected: expectedEOD,
    low: forecastLow,
    high: forecastHigh,
    confidence,
    confidenceReasons,
    uncertaintyPct: Math.round(uncertaintyPct * 1000) / 10,
    medianCompletionRatio: Math.round(medianCompletionRatio * 1000) / 1000,
    dampedMomentum: Math.round(dampedMomentumFactor * 100) / 100,
    diagnostics,
    comparableCurves,
  };
}

/**
 * Computes an end-of-day revenue forecast for a movie on a given operational date & cutoff time.
 */
export async function computeMovieEODForecast(
  movieId: number,
  operationalDateStr: string,
  cutoffTimeStr: string
): Promise<MovieForecastResponse> {
  const currentOpDate = getOperationalDateStr();

  // 1. Fetch movie metadata
  const movieRes = await query(
    `SELECT id, title, release_date FROM movies WHERE id = $1;`,
    [movieId]
  );
  const movie = movieRes.rows[0];
  const movieTitle = movie ? movie.title : undefined;
  const releaseDate = movie ? movie.release_date : null;
  const { run_day, run_day_label } = getMovieRunDay(releaseDate, operationalDateStr);

  // 2. Determine target cutoff timestamp and fetch the latest snapshot available on or before cutoff
  const targetTs = parseLisbonLocalToUTC(operationalDateStr, cutoffTimeStr);

  const latestSnapRes = await query(
    `SELECT *
     FROM movie_performance_snapshots
     WHERE movie_id = $1
       AND operational_date = $2
       AND snapshot_timestamp <= $3
     ORDER BY snapshot_timestamp DESC
     LIMIT 1;`,
    [movieId, operationalDateStr, targetTs.toISOString()]
  );

  let currentRevenue = 0;
  let currentAdmissions = 0;
  let currentOccupancy = 0;
  let currentShows = 0;
  let remainingShows = 0;
  let latestDataTime = cutoffTimeStr;

  if (latestSnapRes.rows.length > 0) {
    const s = latestSnapRes.rows[0];
    currentRevenue = parseFloat(s.estimated_revenue) || 0;
    currentAdmissions = parseInt(s.estimated_admissions, 10) || 0;
    currentOccupancy = parseFloat(s.occupancy_proxy) || 0;
    currentShows = parseInt(s.showcount_total, 10) || 0;
    remainingShows = parseInt(s.shows_remaining, 10) || 0;
    latestDataTime = new Date(s.snapshot_timestamp).toLocaleTimeString("pt-PT", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Lisbon",
    });
  } else {
    // Compute dynamically at targetTs if snapshot not pre-materialized
    const dynamicSnap = await getOrComputeMovieSnapshotAtTime(movieId, operationalDateStr, targetTs);
    if (dynamicSnap) {
      currentRevenue = dynamicSnap.estimated_revenue;
      currentAdmissions = dynamicSnap.estimated_admissions;
      currentOccupancy = dynamicSnap.occupancy_proxy;
      currentShows = dynamicSnap.showcount_total;
      remainingShows = dynamicSnap.shows_remaining;
      latestDataTime = dynamicSnap.time;
    }
  }

  // 3. Query remaining session inventory strictly after cutoff
  const inventoryRes = await query(
    `WITH ${getSessionPricesSqlCte()}
     SELECT 
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN s_latest.starts_at > $3 THEN 1 END) as future_sessions,
        COALESCE(SUM(CASE WHEN s_latest.starts_at > $3 THEN s_latest.sellable_seats ELSE 0 END), 0) as remaining_capacity,
        AVG(COALESCE(sp.resolved_unit_price, 8.75)) as avg_price
      FROM (
        SELECT DISTINCT ON (s.id)
          s.id,
          s.starts_at,
          COALESCE(ss.sellable_seats, 150) as sellable_seats
        FROM sessions s
        LEFT JOIN seat_snapshots ss ON ss.session_id = s.id
        WHERE s.movie_id = $1
          AND (s.operational_date = $2 OR TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD') = $2)
        ORDER BY s.id, ss.collected_at DESC
      ) s_latest
      LEFT JOIN session_prices sp ON sp.session_id = s_latest.id;`,
    [movieId, operationalDateStr, targetTs.toISOString()]
  );

  const remainingCapacity = parseInt(inventoryRes.rows[0]?.remaining_capacity, 10) || 0;
  const avgUnitPrice = parseFloat(inventoryRes.rows[0]?.avg_price) || 8.75;
  if (remainingShows === 0) {
    remainingShows = parseInt(inventoryRes.rows[0]?.future_sessions, 10) || 0;
  }

  // 4. Operational day completion check
  const isPastDay = operationalDateStr < currentOpDate;
  const isEOD = cutoffTimeStr === "05:59" || cutoffTimeStr === "05:59 (EOD)";
  const isDayComplete = isPastDay || (operationalDateStr === currentOpDate && isEOD && timeToOperationalMinutes(cutoffTimeStr) >= 1439);

  // 5. Fetch actual curve points for the selected operational date (08:00 to 05:59)
  const targetTargets = STANDARD_HOURLY_SLOTS.map((h) => ({
    date: operationalDateStr,
    targetTs: parseLisbonLocalToUTC(operationalDateStr, h),
  }));
  const targetSnaps = await getOrComputeMovieSnapshotsBatch(movieId, targetTargets);

  // 6. Fetch Yesterday & Same Weekday Last Week completed EOD
  const yesterdayStr = addDays(operationalDateStr, -1);
  const lastWeekStr = addDays(operationalDateStr, -7);

  const compTargets = [
    { date: yesterdayStr, targetTs: parseLisbonLocalToUTC(yesterdayStr, "05:59") },
    { date: lastWeekStr, targetTs: parseLisbonLocalToUTC(lastWeekStr, "05:59") },
  ];
  const [yesterdayEODSnap, lastWeekEODSnap] = await getOrComputeMovieSnapshotsBatch(movieId, compTargets);

  const yesterdayEODRev = yesterdayEODSnap && yesterdayEODSnap.estimated_revenue > 0 ? yesterdayEODSnap.estimated_revenue : null;
  const lastWeekEODRev = lastWeekEODSnap && lastWeekEODSnap.estimated_revenue > 0 ? lastWeekEODSnap.estimated_revenue : null;

  // 7. If day is complete, return finalized view
  if (isDayComplete) {
    const finalRevenue = targetSnaps[targetSnaps.length - 1]?.estimated_revenue || currentRevenue;
    const curvePoints: ForecastPoint[] = STANDARD_HOURLY_SLOTS.map((h, idx) => ({
      time: h === "05:59" ? "05:59 (EOD)" : h === "02:00" ? "02:00 (+1d)" : h,
      today_revenue: targetSnaps[idx]?.estimated_revenue || 0,
      forecast_revenue: null,
      forecast_low: null,
      forecast_high: null,
    }));

    return {
      movie_id: movieId,
      movie_title: movieTitle,
      operational_date: operationalDateStr,
      current_time_requested: cutoffTimeStr,
      latest_data_time: latestDataTime,
      is_day_complete: true,
      actual_revenue: finalRevenue,
      actual_admissions: currentAdmissions,
      actual_occupancy: currentOccupancy,
      actual_shows: currentShows,
      remaining_shows: 0,
      remaining_capacity: 0,
      forecast: null,
      diagnostics: null,
      comparisons: {
        yesterday_eod_revenue: yesterdayEODRev,
        yesterday_date: yesterdayStr,
        change_vs_yesterday_eod: calculatePercentChange(finalRevenue, yesterdayEODRev),
        last_week_eod_revenue: lastWeekEODRev,
        last_week_date: lastWeekStr,
        change_vs_last_week_eod: calculatePercentChange(finalRevenue, lastWeekEODRev),
      },
      comparable_curves: [],
      curve: curvePoints,
    };
  }

  // 8. Fetch completed historical operational days strictly prior to target operationalDate
  const histDatesRes = await query(
    `SELECT DISTINCT operational_date 
     FROM movie_performance_snapshots
     WHERE movie_id = $1 
       AND operational_date < $2
     ORDER BY operational_date DESC;`,
    [movieId, operationalDateStr]
  );

  const historicalDays: ForecastEngineHistoricalDay[] = [];
  if (histDatesRes.rows.length > 0) {
    const histDates = histDatesRes.rows.map((r) => r.operational_date);
    const histBatchTargets: Array<{ date: string; targetTs: Date }> = [];

    for (const hd of histDates) {
      histBatchTargets.push({ date: hd, targetTs: parseLisbonLocalToUTC(hd, latestDataTime) });
      histBatchTargets.push({ date: hd, targetTs: parseLisbonLocalToUTC(hd, "05:59") });
    }

    const histSnaps = await getOrComputeMovieSnapshotsBatch(movieId, histBatchTargets);

    for (let i = 0; i < histDates.length; i++) {
      const hd = histDates[i];
      const cSnap = histSnaps[i * 2];
      const eSnap = histSnaps[i * 2 + 1];

      if (eSnap && eSnap.estimated_revenue > 0) {
        const hRunDay = getMovieRunDay(releaseDate, hd).run_day;
        const [y1, m1, d1] = hd.split("-").map(Number);
        const [y2, m2, d2] = operationalDateStr.split("-").map(Number);
        const daysAgo = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);

        historicalDays.push({
          operationalDate: hd,
          dayOfWeek: getDayOfWeek(hd),
          dayOfWeekName: getDayOfWeekName(hd),
          runDay: hRunDay,
          daysAgo,
          cutoffRevenue: cSnap ? cSnap.estimated_revenue : 0,
          eodRevenue: eSnap.estimated_revenue,
          cutoffAdmissions: cSnap ? cSnap.estimated_admissions : 0,
          eodAdmissions: eSnap.estimated_admissions,
        });
      }
    }
  }

  // 9. Fetch historical backtest error calibration at this cutoff horizon
  const calibRes = await query(
    `SELECT 
       cutoff_time,
       COUNT(*)::int as backtest_count,
       AVG(error_absolute)::float as mae,
       AVG(ABS(error_percentage))::float as mape,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY error_absolute)::float as median_absolute_error,
       AVG(error_percentage)::float as bias,
       PERCENTILE_CONT(0.15) WITHIN GROUP (ORDER BY (forecast_expected - actual_eod_revenue))::float as error_p15,
       PERCENTILE_CONT(0.85) WITHIN GROUP (ORDER BY (forecast_expected - actual_eod_revenue))::float as error_p85
     FROM forecast_backtests
     WHERE model_version = $1
       AND cutoff_time = $2
       AND operational_date < $3
     GROUP BY cutoff_time;`,
    [FORECAST_MODEL_VERSION, cutoffTimeStr, operationalDateStr]
  );

  const historicalCutoffCalibration = calibRes.rows.length > 0 ? calibRes.rows[0] : null;

  // 10. Call Unified Forecast Engine
  const engineResult = forecastEngine({
    movieId,
    operationalDate: operationalDateStr,
    cutoffTime: cutoffTimeStr,
    latestDataTime,
    currentRevenue,
    currentAdmissions,
    currentOccupancy,
    currentShows,
    remainingShows,
    remainingCapacity,
    avgUnitPrice,
    runDay: run_day,
    runDayLabel: run_day_label,
    historicalDays,
    historicalCutoffCalibration,
  });

  // 11. Build Chart Curve Series (Actual solid -> Transition -> Dashed projection with uncertainty range)
  const currentOpMinutes = timeToOperationalMinutes(latestDataTime);
  const curvePoints: ForecastPoint[] = [];

  let transitionIdx = 0;
  for (let i = 0; i < STANDARD_HOURLY_SLOTS.length; i++) {
    const slotMins = timeToOperationalMinutes(STANDARD_HOURLY_SLOTS[i]);
    if (slotMins <= currentOpMinutes) {
      transitionIdx = i;
    }
  }

  for (let i = 0; i < STANDARD_HOURLY_SLOTS.length; i++) {
    const h = STANDARD_HOURLY_SLOTS[i];
    const slotMins = timeToOperationalMinutes(h);
    const label = h === "05:59" ? "05:59 (EOD)" : h === "02:00" ? "02:00 (+1d)" : h;

    if (slotMins < currentOpMinutes) {
      // Historical actual segment
      const actualVal = targetSnaps[i]?.estimated_revenue || 0;
      curvePoints.push({
        time: label,
        today_revenue: actualVal,
        forecast_revenue: null,
        forecast_low: null,
        forecast_high: null,
      });
    } else if (i === transitionIdx || (slotMins >= currentOpMinutes && i === 0)) {
      // Transition point: connect actual and forecast seamlessly at the latest actual revenue
      curvePoints.push({
        time: label,
        today_revenue: currentRevenue,
        forecast_revenue: currentRevenue,
        forecast_low: currentRevenue,
        forecast_high: currentRevenue,
      });
    } else {
      // Future projection segment: interpolate progress from currentOpMinutes to EOD (1440 mins)
      const remainingMinutes = 1440 - currentOpMinutes;
      const progressFromCutoff = remainingMinutes > 0 ? (slotMins - currentOpMinutes) / remainingMinutes : 1.0;
      const sCurveProgress = Math.pow(progressFromCutoff, 1.15);

      const projExpected = Math.round(currentRevenue + (engineResult.expected - currentRevenue) * sCurveProgress);
      const projLow = Math.max(currentRevenue, Math.round(currentRevenue + (engineResult.low - currentRevenue) * sCurveProgress));
      const projHigh = Math.round(currentRevenue + (engineResult.high - currentRevenue) * sCurveProgress);

      curvePoints.push({
        time: label,
        today_revenue: null,
        forecast_revenue: projExpected,
        forecast_low: projLow,
        forecast_high: projHigh,
      });
    }
  }

  return {
    movie_id: movieId,
    movie_title: movieTitle,
    operational_date: operationalDateStr,
    current_time_requested: cutoffTimeStr,
    latest_data_time: latestDataTime,
    is_day_complete: false,
    actual_revenue: currentRevenue,
    actual_admissions: currentAdmissions,
    actual_occupancy: currentOccupancy,
    actual_shows: currentShows,
    remaining_shows: remainingShows,
    remaining_capacity: remainingCapacity,
    forecast: {
      low: engineResult.low,
      expected: engineResult.expected,
      high: engineResult.high,
      confidence: engineResult.confidence,
      confidence_reasons: engineResult.confidenceReasons,
      uncertainty_pct: engineResult.uncertaintyPct,
      median_completion_ratio: engineResult.medianCompletionRatio,
      damped_momentum: engineResult.dampedMomentum,
    },
    diagnostics: engineResult.diagnostics,
    comparisons: {
      yesterday_eod_revenue: yesterdayEODRev,
      yesterday_date: yesterdayStr,
      change_vs_yesterday_eod: calculatePercentChange(engineResult.expected, yesterdayEODRev),
      last_week_eod_revenue: lastWeekEODRev,
      last_week_date: lastWeekStr,
      change_vs_last_week_eod: calculatePercentChange(engineResult.expected, lastWeekEODRev),
    },
    comparable_curves: engineResult.comparableCurves,
    curve: curvePoints,
  };
}

export const BACKTEST_CUTOFF_SLOTS = [
  "10:00",
  "12:00",
  "14:00",
  "16:00",
  "18:00",
  "20:00",
  "22:00",
];

/**
 * Runs walk-forward historical backtests across all completed operational days.
 * Strictly avoids look-ahead bias by passing only data available at each historical cutoff.
 */
export async function runHistoricalBacktests(options?: { movieIds?: number[]; overwrite?: boolean }) {
  console.log("Starting Walk-Forward Historical Backtesting Suite...");

  // 1. Fetch completed operational days that have final EOD data
  const movieWhere = options?.movieIds && options.movieIds.length > 0 ? `WHERE m.id = ANY($1)` : "";
  const movieParams = options?.movieIds && options.movieIds.length > 0 ? [options.movieIds] : [];

  const moviesRes = await query(
    `SELECT m.id, m.title, m.release_date 
     FROM movies m
     ${movieWhere}
     ORDER BY m.id ASC;`,
    movieParams
  );

  const movies = moviesRes.rows;
  let totalDaysTested = 0;
  let totalForecastsGenerated = 0;

  const resultsList: Array<{
    movie_id: number;
    movie_title: string;
    operational_date: string;
    cutoff_time: string;
    current_revenue: number;
    forecast_low: number;
    forecast_expected: number;
    forecast_high: number;
    actual_eod_revenue: number;
    error_absolute: number;
    error_percentage: number;
  }> = [];

  for (const movie of movies) {
    const movieId = movie.id;
    const releaseDate = movie.release_date;

    // Pre-fetch ALL snapshots for this movie in ONE query
    const allSnapsRes = await query(
      `SELECT * FROM movie_performance_snapshots
       WHERE movie_id = $1
       ORDER BY operational_date ASC, snapshot_timestamp ASC;`,
      [movieId]
    );

    const snapshots = allSnapsRes.rows;
    if (snapshots.length === 0) continue;

    // Group snapshots by operational_date
    const snapsByDate = new Map<string, any[]>();
    for (const s of snapshots) {
      if (!snapsByDate.has(s.operational_date)) {
        snapsByDate.set(s.operational_date, []);
      }
      snapsByDate.get(s.operational_date)!.push(s);
    }

    // Pre-fetch inventory & session price info for this movie
    const invMap = new Map<string, { future_sessions: number; remaining_capacity: number; avg_price: number }>();
    const invRes = await query(
      `WITH ${getSessionPricesSqlCte()}
       SELECT 
          COALESCE(s.operational_date, TO_CHAR((s.starts_at AT TIME ZONE 'Europe/Lisbon') - INTERVAL '6 hours', 'YYYY-MM-DD')) as op_date,
          s.starts_at,
          COALESCE(ss.sellable_seats, 150) as sellable_seats,
          COALESCE(sp.resolved_unit_price, 8.75) as resolved_unit_price
        FROM sessions s
        LEFT JOIN (
          SELECT DISTINCT ON (session_id) session_id, sellable_seats
          FROM seat_snapshots
          ORDER BY session_id, collected_at DESC
        ) ss ON ss.session_id = s.id
        LEFT JOIN session_prices sp ON sp.session_id = s.id
        WHERE s.movie_id = $1;`,
      [movieId]
    );

    const sessionRows = invRes.rows;

    const operationalDates = Array.from(snapsByDate.keys()).sort();
    if (operationalDates.length < 2) continue; // Need at least 1 prior day for comparative backtesting

    for (let dIdx = 1; dIdx < operationalDates.length; dIdx++) {
      const opDate = operationalDates[dIdx];
      const targetDaySnaps = snapsByDate.get(opDate) || [];

      // Final EOD snapshot on target day
      const eodSnap = targetDaySnaps[targetDaySnaps.length - 1];
      const actualEodRevenue = parseFloat(eodSnap?.estimated_revenue) || 0;
      if (actualEodRevenue <= 0) continue;

      const { run_day, run_day_label } = getMovieRunDay(releaseDate, opDate);
      const priorDates = operationalDates.slice(0, dIdx);

      // Helper function to find latest snapshot on or before a UTC target timestamp
      const getSnapAtOrBefore = (dateSnaps: any[], targetUtcIso: string) => {
        let matched: any = null;
        for (const s of dateSnaps) {
          if (new Date(s.snapshot_timestamp).toISOString() <= targetUtcIso) {
            matched = s;
          } else {
            break;
          }
        }
        return matched;
      };

      for (const cutoff of BACKTEST_CUTOFF_SLOTS) {
        const targetTs = parseLisbonLocalToUTC(opDate, cutoff);
        const targetTsIso = targetTs.toISOString();

        const snapAtCutoff = getSnapAtOrBefore(targetDaySnaps, targetTsIso);
        if (!snapAtCutoff) continue; // No data at or before this cutoff

        const currentRevenue = parseFloat(snapAtCutoff.estimated_revenue) || 0;
        const currentAdmissions = parseInt(snapAtCutoff.estimated_admissions, 10) || 0;
        const currentOccupancy = parseFloat(snapAtCutoff.occupancy_proxy) || 0;
        const currentShows = parseInt(snapAtCutoff.showcount_total, 10) || 0;
        let remainingShows = parseInt(snapAtCutoff.shows_remaining, 10) || 0;

        const latestDataTime = new Date(snapAtCutoff.snapshot_timestamp).toLocaleTimeString("pt-PT", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Lisbon",
        });

        // Compute remaining inventory from memory
        let remainingCapacity = 0;
        let futureSessionsCount = 0;
        let priceSum = 0;
        let priceCount = 0;

        for (const sRow of sessionRows) {
          if (sRow.op_date === opDate) {
            const startUtc = new Date(sRow.starts_at).toISOString();
            if (startUtc > targetTsIso) {
              futureSessionsCount++;
              remainingCapacity += parseInt(sRow.sellable_seats, 10) || 0;
              priceSum += parseFloat(sRow.resolved_unit_price) || 8.75;
              priceCount++;
            }
          }
        }

        const avgUnitPrice = priceCount > 0 ? priceSum / priceCount : 8.75;
        if (remainingShows === 0) remainingShows = futureSessionsCount;

        // Build historical days strictly before opDate using in-memory snapshots
        const historicalDays: ForecastEngineHistoricalDay[] = [];

        for (const hd of priorDates) {
          const hSnaps = snapsByDate.get(hd) || [];
          if (hSnaps.length === 0) continue;

          const hEodSnap = hSnaps[hSnaps.length - 1];
          const hEodRev = parseFloat(hEodSnap?.estimated_revenue) || 0;
          if (hEodRev <= 0) continue;

          const hCutoffTs = parseLisbonLocalToUTC(hd, cutoff);
          const hCutoffSnap = getSnapAtOrBefore(hSnaps, hCutoffTs.toISOString());
          const hCutoffRev = hCutoffSnap ? parseFloat(hCutoffSnap.estimated_revenue) || 0 : 0;

          const hRunDay = getMovieRunDay(releaseDate, hd).run_day;
          const [y1, m1, d1] = hd.split("-").map(Number);
          const [y2, m2, d2] = opDate.split("-").map(Number);
          const daysAgo = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);

          historicalDays.push({
            operationalDate: hd,
            dayOfWeek: getDayOfWeek(hd),
            dayOfWeekName: getDayOfWeekName(hd),
            runDay: hRunDay,
            daysAgo,
            cutoffRevenue: hCutoffRev,
            eodRevenue: hEodRev,
            cutoffAdmissions: hCutoffSnap ? parseInt(hCutoffSnap.estimated_admissions, 10) || 0 : 0,
            eodAdmissions: parseInt(hEodSnap?.estimated_admissions, 10) || 0,
          });
        }

        // Execute core unified forecasting engine
        const forecast = forecastEngine({
          movieId,
          operationalDate: opDate,
          cutoffTime: cutoff,
          latestDataTime,
          currentRevenue,
          currentAdmissions,
          currentOccupancy,
          currentShows,
          remainingShows,
          remainingCapacity,
          avgUnitPrice,
          runDay: run_day,
          runDayLabel: run_day_label,
          historicalDays,
        });

        const errorAbsolute = Math.round(Math.abs(forecast.expected - actualEodRevenue) * 100) / 100;
        const errorPct = Math.round(((forecast.expected - actualEodRevenue) / actualEodRevenue) * 10000) / 100;

        // Upsert into forecast_backtests table
        await query(
          `INSERT INTO forecast_backtests (
             movie_id, operational_date, cutoff_time,
             forecast_low, forecast_expected, forecast_high,
             actual_eod_revenue, error_absolute, error_percentage,
             model_version
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (movie_id, operational_date, cutoff_time, model_version)
           DO UPDATE SET
             forecast_low = EXCLUDED.forecast_low,
             forecast_expected = EXCLUDED.forecast_expected,
             forecast_high = EXCLUDED.forecast_high,
             actual_eod_revenue = EXCLUDED.actual_eod_revenue,
             error_absolute = EXCLUDED.error_absolute,
             error_percentage = EXCLUDED.error_percentage,
             created_at = NOW();`,
          [
            movieId,
            opDate,
            cutoff,
            forecast.low,
            forecast.expected,
            forecast.high,
            actualEodRevenue,
            errorAbsolute,
            errorPct,
            FORECAST_MODEL_VERSION,
          ]
        );

        totalForecastsGenerated++;
        resultsList.push({
          movie_id: movieId,
          movie_title: movie.title,
          operational_date: opDate,
          cutoff_time: cutoff,
          current_revenue: currentRevenue,
          forecast_low: forecast.low,
          forecast_expected: forecast.expected,
          forecast_high: forecast.high,
          actual_eod_revenue: actualEodRevenue,
          error_absolute: errorAbsolute,
          error_percentage: errorPct,
        });
      }

      totalDaysTested++;
    }
  }

  // Calculate overall evaluation summary metrics
  const backtestStats = await getBacktestSummaryMetrics();

  return {
    total_days_tested: totalDaysTested,
    total_forecasts_generated: totalForecastsGenerated,
    mae: backtestStats.overall.mae,
    mape: backtestStats.overall.mape,
    median_absolute_error: backtestStats.overall.median_absolute_error,
    mean_bias: backtestStats.overall.mean_bias,
    by_cutoff: backtestStats.by_cutoff,
    examples: resultsList.slice(0, 15),
  };
}

/**
 * Aggregates backtest performance metrics overall and segmented by cutoff time.
 */
export async function getBacktestSummaryMetrics(movieId?: number) {
  const params: any[] = [FORECAST_MODEL_VERSION];
  let movieWhere = "";
  if (movieId) {
    params.push(movieId);
    movieWhere = "AND movie_id = $2";
  }

  const overallRes = await query(
    `SELECT 
       COUNT(*)::int as total_forecasts,
       COUNT(DISTINCT operational_date)::int as total_days,
       COALESCE(AVG(error_absolute), 0)::float as mae,
       COALESCE(AVG(ABS(error_percentage)), 0)::float as mape,
       COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY error_absolute), 0)::float as median_absolute_error,
       COALESCE(AVG(error_percentage), 0)::float as mean_bias
     FROM forecast_backtests
     WHERE model_version = $1 ${movieWhere};`,
    params
  );

  const byCutoffRes = await query(
    `SELECT 
       cutoff_time,
       COUNT(*)::int as forecast_count,
       AVG(error_absolute)::float as mae,
       AVG(ABS(error_percentage))::float as mape,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY error_absolute)::float as median_absolute_error,
       AVG(error_percentage)::float as mean_bias,
       PERCENTILE_CONT(0.15) WITHIN GROUP (ORDER BY (forecast_expected - actual_eod_revenue))::float as error_p15,
       PERCENTILE_CONT(0.85) WITHIN GROUP (ORDER BY (forecast_expected - actual_eod_revenue))::float as error_p85
     FROM forecast_backtests
     WHERE model_version = $1 ${movieWhere}
     GROUP BY cutoff_time
     ORDER BY cutoff_time ASC;`,
    params
  );

  const overall = overallRes.rows[0] || {
    total_forecasts: 0,
    total_days: 0,
    mae: 0,
    mape: 0,
    median_absolute_error: 0,
    mean_bias: 0,
  };

  return {
    overall: {
      total_forecasts: overall.total_forecasts,
      total_days: overall.total_days,
      mae: Math.round(overall.mae * 100) / 100,
      mape: Math.round(overall.mape * 10) / 10,
      median_absolute_error: Math.round(overall.median_absolute_error * 100) / 100,
      mean_bias: Math.round(overall.mean_bias * 10) / 10,
    },
    by_cutoff: byCutoffRes.rows.map((r) => ({
      cutoff_time: r.cutoff_time,
      forecast_count: r.forecast_count,
      mae: Math.round(r.mae * 100) / 100,
      mape: Math.round(r.mape * 10) / 10,
      median_absolute_error: Math.round(r.median_absolute_error * 100) / 100,
      mean_bias: Math.round(r.mean_bias * 10) / 10,
      error_p15: Math.round(r.error_p15 * 100) / 100,
      error_p85: Math.round(r.error_p85 * 100) / 100,
    })),
  };
}
