import { query } from "./db";
import { recalculateAllPerformanceSnapshots } from "./revenue";

export async function runMigrations(): Promise<void> {
  console.log("Applying official Phase 2 PostgreSQL schema migrations...");

  // Safely drop empty legacy prototype tables if present
  await query(`
    DROP TABLE IF EXISTS recolhas CASCADE;
    DROP TABLE IF EXISTS sessoes CASCADE;
    DROP TABLE IF EXISTS salas CASCADE;
    DROP TABLE IF EXISTS filmes CASCADE;
    DROP TABLE IF EXISTS precos_assumidos CASCADE;
    DROP TABLE IF EXISTS calibracoes CASCADE;
  `);

  // If cinemas exists from legacy schema without external_id, drop and recreate
  const cinemaCheck = await query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'cinemas' AND column_name = 'external_id';
  `);
  if (cinemaCheck.rows.length === 0) {
    await query(`DROP TABLE IF EXISTS cinemas CASCADE;`);
  }

  const migrationSQL = `
    -- 1. Movies
    CREATE TABLE IF NOT EXISTS movies (
      id SERIAL PRIMARY KEY,
      external_id VARCHAR(100) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      poster_url TEXT,
      duration INT,
      age_rating VARCHAR(50),
      release_date VARCHAR(50),
      tracking_enabled BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_movies_external_id ON movies(external_id);
    CREATE INDEX IF NOT EXISTS idx_movies_tracking ON movies(tracking_enabled);

    -- 2. Cinemas
    CREATE TABLE IF NOT EXISTS cinemas (
      id SERIAL PRIMARY KEY,
      external_id VARCHAR(100) UNIQUE NOT NULL,
      name TEXT NOT NULL,
      city TEXT,
      region TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_cinemas_external_id ON cinemas(external_id);

    -- 3. Rooms
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      cinema_id INT REFERENCES cinemas(id) ON DELETE CASCADE,
      external_id VARCHAR(100) UNIQUE NOT NULL,
      name TEXT NOT NULL,
      capacity INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rooms_cinema_id ON rooms(cinema_id);
    CREATE INDEX IF NOT EXISTS idx_rooms_external_id ON rooms(external_id);

    -- 4. Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      movie_id INT REFERENCES movies(id) ON DELETE CASCADE,
      cinema_id INT REFERENCES cinemas(id) ON DELETE CASCADE,
      room_id INT REFERENCES rooms(id) ON DELETE SET NULL,
      external_session_id VARCHAR(100) UNIQUE NOT NULL,
      starts_at TIMESTAMPTZ,
      operational_date VARCHAR(20),
      format VARCHAR(50),
      description TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_movie_id ON sessions(movie_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_cinema_id ON sessions(cinema_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_external_id ON sessions(external_session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_starts_at ON sessions(starts_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_movie_starts ON sessions(movie_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_movie_opdate ON sessions(movie_id, operational_date);
    CREATE INDEX IF NOT EXISTS idx_sessions_opdate_movie_cinema ON sessions(operational_date, movie_id, cinema_id);

    -- 5. Collection Runs
    CREATE TABLE IF NOT EXISTS collection_runs (
      id SERIAL PRIMARY KEY,
      run_id VARCHAR(100) UNIQUE NOT NULL,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      status VARCHAR(50) DEFAULT 'PENDING',
      movies_found INT DEFAULT 0,
      sessions_found INT DEFAULT 0,
      sessions_attempted INT DEFAULT 0,
      sessions_successful INT DEFAULT 0,
      sessions_failed INT DEFAULT 0,
      snapshots_created INT DEFAULT 0,
      errors JSONB DEFAULT '[]'::jsonb,
      collector_version VARCHAR(50) DEFAULT '2.0.0',
      trigger_source VARCHAR(50) DEFAULT 'SCHEDULED'
    );
    ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(50) DEFAULT 'SCHEDULED';
    CREATE INDEX IF NOT EXISTS idx_collection_runs_started ON collection_runs(started_at DESC);

    -- 6. Seat Snapshots (Immutable Historical Observations)
    CREATE TABLE IF NOT EXISTS seat_snapshots (
      id SERIAL PRIMARY KEY,
      session_id INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      collected_at TIMESTAMPTZ NOT NULL,
      total_seats INT NOT NULL,
      sellable_seats INT NOT NULL,
      available_seats INT NOT NULL,
      unavailable_seats INT NOT NULL,
      safety_seats INT NOT NULL DEFAULT 0,
      unknown_seats INT NOT NULL DEFAULT 0,
      occupancy_proxy DOUBLE PRECISION NOT NULL,
      invariant_valid BOOLEAN NOT NULL DEFAULT TRUE,
      source VARCHAR(50) DEFAULT 'NOS',
      collector_version VARCHAR(50) DEFAULT '2.0.0',
      collection_run_id INT REFERENCES collection_runs(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_seat_snapshots_session_collected ON seat_snapshots(session_id, collected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_seat_snapshots_run_id ON seat_snapshots(collection_run_id);

    -- 7. Individual Physical Seat States
    CREATE TABLE IF NOT EXISTS seat_states (
      id BIGSERIAL PRIMARY KEY,
      snapshot_id INT NOT NULL REFERENCES seat_snapshots(id) ON DELETE CASCADE,
      session_id INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      theater_room_uuid VARCHAR(100),
      queue VARCHAR(20),
      row INT,
      col INT,
      seat_number INT,
      stable_seat_key VARCHAR(150) NOT NULL,
      is_seat BOOLEAN NOT NULL DEFAULT TRUE,
      is_available BOOLEAN,
      is_safety_seat BOOLEAN DEFAULT FALSE,
      is_premium BOOLEAN DEFAULT FALSE,
      is_vip BOOLEAN DEFAULT FALSE,
      is_love_seat BOOLEAN DEFAULT FALSE,
      is_handicapped BOOLEAN DEFAULT FALSE,
      state VARCHAR(30) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_seat_states_snapshot_id ON seat_states(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_seat_states_session_key ON seat_states(session_id, stable_seat_key);

    -- 8. Seat Transitions
    CREATE TABLE IF NOT EXISTS seat_transitions (
      id SERIAL PRIMARY KEY,
      session_id INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      prev_snapshot_id INT REFERENCES seat_snapshots(id) ON DELETE CASCADE,
      curr_snapshot_id INT REFERENCES seat_snapshots(id) ON DELETE CASCADE,
      transition_timestamp TIMESTAMPTZ NOT NULL,
      delta_time_hours DOUBLE PRECISION NOT NULL,
      newly_unavailable INT NOT NULL DEFAULT 0,
      newly_available INT NOT NULL DEFAULT 0,
      newly_safety INT NOT NULL DEFAULT 0,
      other_state_changes INT NOT NULL DEFAULT 0,
      sales_velocity_proxy DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      detailed_transitions JSONB DEFAULT '[]'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_seat_transitions_session_ts ON seat_transitions(session_id, transition_timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_seat_transitions_curr_snap ON seat_transitions(curr_snapshot_id);

    -- 9. Session Ticket Prices
    CREATE TABLE IF NOT EXISTS session_ticket_prices (
      id SERIAL PRIMARY KEY,
      session_id INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      collected_at TIMESTAMPTZ NOT NULL,
      ticket_type TEXT NOT NULL,
      price NUMERIC(6, 2) NOT NULL,
      seats_count INT NOT NULL DEFAULT 1,
      raw_price NUMERIC(6, 2),
      is_default BOOLEAN DEFAULT FALSE,
      source VARCHAR(50) DEFAULT 'NOS'
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_prices_session ON session_ticket_prices(session_id, collected_at DESC);

    -- Ensure schema updates for existing tables
    ALTER TABLE session_ticket_prices ADD COLUMN IF NOT EXISTS seats_count INT NOT NULL DEFAULT 1;
    ALTER TABLE session_ticket_prices ADD COLUMN IF NOT EXISTS raw_price NUMERIC(6, 2);
    ALTER TABLE session_ticket_prices ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;

    -- 10. Movie Performance Snapshots (Intraday & Historical Time-Series Aggregations)
    CREATE TABLE IF NOT EXISTS movie_performance_snapshots (
      id SERIAL PRIMARY KEY,
      movie_id INT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
      operational_date VARCHAR(20) NOT NULL,
      snapshot_timestamp TIMESTAMPTZ NOT NULL,
      collection_run_id INT REFERENCES collection_runs(id) ON DELETE SET NULL,
      showcount_total INT NOT NULL DEFAULT 0,
      shows_started INT NOT NULL DEFAULT 0,
      shows_completed INT NOT NULL DEFAULT 0,
      shows_remaining INT NOT NULL DEFAULT 0,
      sellable_capacity INT NOT NULL DEFAULT 0,
      available_seats INT NOT NULL DEFAULT 0,
      unavailable_seats INT NOT NULL DEFAULT 0,
      occupancy_proxy DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      estimated_admissions INT NOT NULL DEFAULT 0,
      estimated_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
      revenue_per_show NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
      admissions_per_show NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
      newly_unavailable INT NOT NULL DEFAULT 0,
      newly_available INT NOT NULL DEFAULT 0,
      sales_velocity DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mps_movie_date_time ON movie_performance_snapshots(movie_id, operational_date, snapshot_timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_mps_run ON movie_performance_snapshots(collection_run_id);

    -- 11. Forecast Backtests (Walk-forward historical forecast evaluation & calibration)
    CREATE TABLE IF NOT EXISTS forecast_backtests (
      id SERIAL PRIMARY KEY,
      movie_id INT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
      operational_date VARCHAR(20) NOT NULL,
      cutoff_time VARCHAR(10) NOT NULL,
      forecast_low NUMERIC(12, 2) NOT NULL,
      forecast_expected NUMERIC(12, 2) NOT NULL,
      forecast_high NUMERIC(12, 2) NOT NULL,
      actual_eod_revenue NUMERIC(12, 2) NOT NULL,
      error_absolute NUMERIC(12, 2) NOT NULL,
      error_percentage NUMERIC(8, 2),
      model_version VARCHAR(50) NOT NULL DEFAULT 'curve_completion_v2',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(movie_id, operational_date, cutoff_time, model_version)
    );
    CREATE INDEX IF NOT EXISTS idx_forecast_backtests_movie ON forecast_backtests(movie_id, operational_date, cutoff_time);
    CREATE INDEX IF NOT EXISTS idx_forecast_backtests_cutoff ON forecast_backtests(cutoff_time, model_version);

    -- Ensure columns on movies and movie_performance_snapshots
    ALTER TABLE movies ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE movie_performance_snapshots ADD COLUMN IF NOT EXISTS resolved_unit_price_raw NUMERIC(6, 2);
    ALTER TABLE movie_performance_snapshots ADD COLUMN IF NOT EXISTS resolved_unit_price NUMERIC(6, 2);
    ALTER TABLE movie_performance_snapshots ADD COLUMN IF NOT EXISTS gamma NUMERIC(5, 3) DEFAULT 1.0;

    -- 12. Raw Ingestion Logs (ICA official reports & NOS collector payloads)
    CREATE TABLE IF NOT EXISTS raw_ingestion_logs (
      id VARCHAR(100) PRIMARY KEY,
      source VARCHAR(50) NOT NULL,
      collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      file_name TEXT NOT NULL,
      record_count INT NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'SUCCESS',
      raw_details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_raw_ingestion_logs_source ON raw_ingestion_logs(source, collected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_raw_ingestion_logs_collected ON raw_ingestion_logs(collected_at DESC);

    -- 13. Calibration Factors (Empirical gamma correction factors from ICA benchmarks)
    CREATE TABLE IF NOT EXISTS calibration_factors (
      id SERIAL PRIMARY KEY,
      movie_id INT REFERENCES movies(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      gamma NUMERIC(5, 3) NOT NULL DEFAULT 1.0,
      sample_count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cal_movie ON calibration_factors(movie_id) WHERE movie_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cal_cat ON calibration_factors(category) WHERE movie_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_cal_updated ON calibration_factors(updated_at DESC);

    -- Seed initial baseline category calibration factors if not present
    INSERT INTO calibration_factors (category, gamma, sample_count, updated_at)
    VALUES 
      ('Family / Animation', 0.80, 0, NOW()),
      ('Action / General', 0.90, 0, NOW()),
      ('Drama / Adult', 0.93, 0, NOW())
    ON CONFLICT (category) WHERE movie_id IS NULL DO NOTHING;

    -- 14. Room Structural Blocks (Permanently blocked seats: broken or staff-reserved)
    CREATE TABLE IF NOT EXISTS room_structural_blocks (
      theater_room_uuid VARCHAR(100) NOT NULL,
      stable_seat_key VARCHAR(150) NOT NULL,
      low_occupancy_observations INT NOT NULL,
      first_observed_at TIMESTAMPTZ NOT NULL,
      last_observed_at TIMESTAMPTZ NOT NULL,
      removed_at TIMESTAMPTZ NULL,
      PRIMARY KEY (theater_room_uuid, stable_seat_key)
    );
    ALTER TABLE room_structural_blocks ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ NULL;
    CREATE INDEX IF NOT EXISTS idx_room_structural_blocks_room ON room_structural_blocks(theater_room_uuid);

    CREATE TABLE IF NOT EXISTS room_structural_blocks_meta (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      last_computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS room_structural_blocks_audit_log (
      id SERIAL PRIMARY KEY,
      theater_room_uuid VARCHAR(100) NOT NULL,
      stable_seat_key VARCHAR(150) NOT NULL,
      action VARCHAR(20) NOT NULL, -- 'ADDED' | 'REMOVED'
      reason TEXT,
      observed_count INT,
      qualifying_sessions INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rsb_audit_room ON room_structural_blocks_audit_log(theater_room_uuid);
    CREATE INDEX IF NOT EXISTS idx_rsb_audit_created ON room_structural_blocks_audit_log(created_at DESC);
  `;

  await query(migrationSQL);
  console.log("PostgreSQL schema migrations applied successfully.");

  try {
    const updated = await recalculateAllPerformanceSnapshots();
    console.log(`Recalculated ${updated} performance snapshots using canonical pricing.`);
  } catch (err) {
    console.warn("Snapshot recalculation warning:", err);
  }
}
