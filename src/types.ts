export interface Movie {
  id: number | null;
  external_id: string;
  title: string;
  poster_url: string;
  duration: number | null;
  age_rating: string;
  release_date: string;
  tracking_enabled: boolean;
  updated_at?: string;
  formats?: string[];
  status?: "CURRENTLY_PLAYING" | "UPCOMING" | "NO_LONGER_PLAYING";
  is_currently_playing?: boolean;
  is_upcoming?: boolean;
}

export interface CatalogMovie extends Movie {
  formats?: string[];
}

export interface TrackedMovieSummary {
  id: number;
  external_id: string;
  title: string;
  poster_url: string;
  duration: number | null;
  age_rating: string;
  release_date: string;
  sessions_count: number;
  cinemas_count: number;
  total_sellable_capacity: number;
  available_seats: number;
  unavailable_seats: number;
  safety_seats: number;
  occupancy_proxy: number;
  newly_unavailable: number;
  newly_available: number;
  sales_velocity_proxy: number;
  estimated_revenue: number;
  latest_collection_time: string | null;
}

export interface SessionTicketPrice {
  ticket_type: string;
  price: number;
}

export interface SessionDetail {
  session_id: number;
  external_session_id: string;
  cinema_name: string;
  cinema_city: string;
  room_name: string;
  starts_at: string;
  operational_date: string;
  format: string;
  sellable_seats: number;
  available_seats: number;
  unavailable_seats: number;
  occupancy_proxy: number;
  invariant_valid: boolean;
  estimated_revenue: number;
  ticket_prices: SessionTicketPrice[];
  latest_update: string | null;
  is_current?: boolean;
}

export interface SessionSnapshotHistory {
  id: number;
  collected_at: string;
  total_seats: number;
  sellable_seats: number;
  available_seats: number;
  unavailable_seats: number;
  safety_seats: number;
  unknown_seats: number;
  occupancy_proxy: number;
  invariant_valid: boolean;
  newly_unavailable: number;
  newly_available: number;
  sales_velocity_proxy: number;
}

export interface SessionHistoryResponse {
  session: {
    session_id: number;
    external_session_id: string;
    cinema_name: string;
    cinema_city: string;
    room_name: string;
    format: string;
    starts_at: string;
    operational_date: string;
    sellable_capacity: number;
    available_seats: number;
    unavailable_seats: number;
    occupancy_proxy: number;
    latest_collected_at: string | null;
    movie_title?: string;
  };
  snapshots: SessionSnapshotHistory[];
}

export interface CinemaBreakdown {
  cinema_id: number;
  cinema_name: string;
  city: string;
  region: string;
  sessions_count: number;
  sellable_capacity: number;
  available_seats: number;
  unavailable_seats: number;
  occupancy_proxy: number;
  estimated_revenue: number;
}

export interface TimelinePoint {
  timestamp: string;
  time_label: string;
  total_unavailable: number;
  total_available: number;
  total_sellable: number;
  occupancy_proxy: number;
  newly_unavailable: number;
  newly_available: number;
  sales_velocity_proxy: number;
  sessions_count: number;
  cumulative_sales_proxy?: number;
}

export interface MovieDetailResponse {
  movie: Movie;
  overview: {
    sessions_count: number;
    cinemas_count: number;
    sellable_capacity: number;
    available_seats: number;
    unavailable_seats: number;
    occupancy_proxy: number;
    newly_unavailable: number;
    estimated_revenue: number;
    latest_update: string | null;
  };
  timeline: TimelinePoint[];
  sessions: SessionDetail[];
  cinemas: CinemaBreakdown[];
}

export interface CollectionRunRecord {
  id: number;
  run_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  movies_found: number;
  sessions_found: number;
  sessions_attempted: number;
  sessions_successful: number;
  sessions_failed: number;
  snapshots_created: number;
  errors: string[];
  collector_version: string;
}

export interface ActiveRunProgress {
  run_id: string;
  status: string;
  current_movie: string;
  movies_total: number;
  movies_completed: number;
  sessions_found: number;
  sessions_attempted: number;
  sessions_completed: number;
  sessions_successful: number;
  sessions_failed: number;
  snapshots_created: number;
  current_session: string;
  started_at: string;
  elapsed_seconds: number;
  last_error: string | null;
}

export interface CollectorStatusResponse {
  scheduler: {
    isRunning: boolean;
    isCollecting: boolean;
    intervalMinutes: number;
    lastRunTime: string | null;
    nextRunTime: string | null;
    lastRunResult: any;
    collectorVersion: string;
  };
  active_progress?: ActiveRunProgress | null;
  is_collecting?: boolean;
  recent_runs: CollectionRunRecord[];
  totals: {
    snapshots: number;
    individual_seat_states: number;
    transitions_recorded: number;
  };
}

export interface IntradaySnapshot {
  date: string;
  snapshot_timestamp?: string;
  timestamp?: string;
  created_at?: string;
  time: string;
  showcount_total: number;
  shows_started: number;
  shows_completed: number;
  shows_remaining: number;
  sellable_capacity: number;
  available_seats: number;
  unavailable_seats: number;
  occupancy_proxy: number;
  estimated_admissions: number;
  estimated_revenue: number;
  revenue_per_show: number;
  admissions_per_show: number;
  newly_unavailable: number;
  newly_available: number;
  sales_velocity: number;
  is_fallback?: boolean;
}

export interface IntradayComparisonResponse {
  target_date: string;
  target_time: string;
  today: IntradaySnapshot;
  yesterday: IntradaySnapshot;
  last_week: IntradaySnapshot;
}

export interface IntradayCurvePoint {
  time: string;
  today_revenue: number;
  today_admissions: number;
  today_occupancy: number;
  today_velocity: number;
  today_shows: number;
  today_completed: number;

  yesterday_revenue: number;
  yesterday_admissions: number;
  yesterday_occupancy: number;
  yesterday_velocity: number;
  yesterday_shows: number;
  yesterday_completed: number;

  last_week_revenue: number;
  last_week_admissions: number;
  last_week_occupancy: number;
  last_week_velocity: number;
  last_week_shows: number;
  last_week_completed: number;
}

export interface IntradayCurvesResponse {
  target_date: string;
  yesterday_date: string;
  last_week_date: string;
  curve: IntradayCurvePoint[];
}

export interface HistoryDatesResponse {
  dates: string[];
}

export interface IntradayProgressionResponse {
  date: string;
  items: IntradaySnapshot[];
}

export interface DailyBoxOfficeMovieData {
  movie_id: number;
  revenue: number;
  admissions: number;
  capacity: number;
  occupancy: number;
  shows: number;
  snapshot_timestamp?: string;
  is_live: boolean;
}

export interface DailyBoxOfficeRow {
  operational_date: string;
  is_today: boolean;
  total_revenue: number;
  total_admissions: number;
  movie_data: Record<number, DailyBoxOfficeMovieData>;
}

export interface DailyBoxOfficeSummary {
  totals_per_movie: Record<number, { total_revenue: number; total_admissions: number; days_tracked: number }>;
  grand_total_revenue: number;
  grand_total_admissions: number;
}

export interface DailyBoxOfficeHistoryResponse {
  movies: Movie[];
  rows: DailyBoxOfficeRow[];
  summary: DailyBoxOfficeSummary;
}

export interface HourlyBucketItem {
  hour: string;
  raw_hour: number;
  tickets_sold: number;
  estimated_revenue: number;
  gross_tickets_sold?: number;
  gross_revenue?: number;
  returns_tickets?: number;
  returns_revenue?: number;
  cumulative_tickets: number;
  cumulative_revenue: number;
  is_baseline?: boolean;
  is_reconciliation?: boolean;
  compare_tickets_sold?: number;
  compare_estimated_revenue?: number;
  compare_gross_tickets_sold?: number;
  compare_gross_revenue?: number;
  compare_cumulative_tickets?: number;
  compare_cumulative_revenue?: number;
  delta_tickets?: number;
  delta_revenue?: number;
  delta_cumulative_tickets?: number;
  delta_cumulative_revenue?: number;
}

export interface HourlyBreakdownSummary {
  total_tickets: number;
  total_revenue: number;
  baseline_tickets?: number;
  baseline_revenue?: number;
  baseline_pct?: number;
  walkup_tickets?: number;
  walkup_revenue?: number;
  walkup_pct?: number;
  gross_tickets?: number;
  gross_revenue?: number;
  returns_tickets?: number;
  returns_revenue?: number;
  peak_hour: string | null;
  peak_tickets: number;
  peak_revenue?: number;
  avg_hourly_tickets?: number;
}

export interface HourlyBreakdownResponse {
  movie_id: number;
  date: string;
  compare_date?: string | null;
  has_data: boolean;
  compare_has_data?: boolean;
  summary: HourlyBreakdownSummary;
  compare_summary?: HourlyBreakdownSummary | null;
  hourly: HourlyBucketItem[];
}

export interface MovieDailyBreakdownDay {
  operational_date: string;
  run_day: number;
  run_day_label?: string;
  day_of_week: string;
  day_of_week_short: string;
  is_weekend: boolean;
  is_today: boolean;
  is_live: boolean;
  revenue: number;
  admissions: number;
  cinemas_count: number;
  sessions_count: number;
  prev_day_date: string | null;
  revenue_change_pct: number | null;
  admissions_change_pct: number | null;
  cinemas_change_pct: number | null;
  sessions_change_pct: number | null;
  prev_week_date: string | null;
  prev_week_revenue_change_pct: number | null;
  prev_week_admissions_change_pct: number | null;
}

export interface MovieDailyBreakdownResponse {
  movie: Movie;
  days: MovieDailyBreakdownDay[];
  summary: {
    total_days: number;
    total_revenue: number;
    total_admissions: number;
    total_sessions: number;
    max_cinemas: number;
  };
}

export interface WeekendBoxOfficeMovieItem {
  movie_id: number;
  title: string;
  poster_url: string;
  release_date: string;
  tracking_enabled: boolean;
  weekend_number: number;
  weekend_number_label?: string;
  revenue: number;
  admissions: number;
  cinemas_count: number;
  sessions_count: number;
  days_with_data_count: number;
  prev_weekend_revenue_change_pct: number | null;
  prev_weekend_admissions_change_pct: number | null;
  prev_weekend_cinemas_change_pct: number | null;
  prev_weekend_sessions_change_pct: number | null;
}

export interface WeekendBoxOfficePeriod {
  weekend_id: string;
  start_date: string;
  end_date: string;
  label: string;
  is_live: boolean;
  total_revenue: number;
  total_admissions: number;
  total_sessions: number;
  movies: WeekendBoxOfficeMovieItem[];
}

export interface WeekendBoxOfficeResponse {
  weekends: WeekendBoxOfficePeriod[];
}

export interface WeeklyBoxOfficeMovieItem {
  movie_id: number;
  title: string;
  poster_url: string;
  release_date: string;
  tracking_enabled: boolean;
  week_number: number;
  week_number_label?: string;
  revenue: number;
  admissions: number;
  cinemas_count: number;
  sessions_count: number;
  days_with_data_count: number;
  prev_week_revenue_change_pct: number | null;
  prev_week_admissions_change_pct: number | null;
  prev_week_cinemas_change_pct: number | null;
  prev_week_sessions_change_pct: number | null;
}

export interface WeeklyBoxOfficePeriod {
  week_id: string;
  start_date: string;
  end_date: string;
  label: string;
  is_live: boolean;
  total_revenue: number;
  total_admissions: number;
  total_sessions: number;
  movies: WeeklyBoxOfficeMovieItem[];
}

export interface WeeklyBoxOfficeResponse {
  weeks: WeeklyBoxOfficePeriod[];
}


