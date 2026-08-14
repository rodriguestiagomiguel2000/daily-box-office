#!/usr/bin/env python3
"""
NOS Cinemas Collector Job Script.
Executes targeted collection for tracked movies, discovers sessions, fetches raw seat states,
and outputs complete structured JSON for the PostgreSQL persistence layer.
Supports real-time progress streaming via stdout line-by-line JSON events.
"""

import argparse
import json
import re
import sys
import os
import subprocess
import tempfile
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set
from zoneinfo import ZoneInfo

from nos_scraper import NOSScraper
from nos_collector_models import (
    COLLECTOR_VERSION,
    SOURCE_NAME,
    CollectionRun,
    SeatSnapshot,
)

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("collector_job")

LISBON_TZ = ZoneInfo("Europe/Lisbon")
BUSINESS_DAY_CUTOFF_HOUR = 2


def compute_business_date(starts_at_utc: datetime) -> str:
    lisbon_dt = starts_at_utc.astimezone(LISBON_TZ)
    shifted = lisbon_dt - timedelta(hours=BUSINESS_DAY_CUTOFF_HOUR)
    return shifted.strftime("%Y-%m-%d")


def parse_portugal_session_time(op_date_str: str, time_str: str) -> datetime:
    """
    Parses Portugal local time string and converts it to a timezone-aware UTC datetime.
    op_date_str e.g. "2026-08-13" or "2026-08-13T00:00:00" or "2026-08-21+01:00"
    time_str e.g. "21:30" or "2026-08-13T21:30:00"
    """
    if "T" in time_str and len(time_str) > 10:
        clean_ts = time_str.split("Z")[0].split("+")[0]
        try:
            dt_naive = datetime.fromisoformat(clean_ts)
            dt_local = dt_naive.replace(tzinfo=LISBON_TZ)
            return dt_local.astimezone(timezone.utc)
        except Exception:
            pass

    clean_date = op_date_str[:10] if op_date_str else datetime.now(LISBON_TZ).strftime("%Y-%m-%d")
    raw_time = time_str.strip()
    if len(raw_time) == 5:
        raw_time = f"{raw_time}:00"

    try:
        dt_str = f"{clean_date} {raw_time}"
        dt_naive = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
        dt_local = dt_naive.replace(tzinfo=LISBON_TZ)
        return dt_local.astimezone(timezone.utc)
    except Exception as e:
        log.error(f"Failed to parse session time: op_date='{op_date_str}', time='{time_str}'. Error: {e}")
        raise ValueError(f"Could not parse session time: {op_date_str} {time_str}")


def emit_progress(
    run_id: str,
    status: str,
    current_movie: str,
    movies_total: int,
    movies_completed: int,
    sessions_found: int,
    sessions_attempted: int,
    sessions_completed: int,
    sessions_successful: int,
    sessions_failed: int,
    snapshots_created: int,
    current_session: str,
    started_at: str,
    elapsed_seconds: float,
    last_error: Optional[str] = None
):
    progress_event = {
        "type": "progress",
        "data": {
            "run_id": run_id,
            "status": status,
            "current_movie": current_movie,
            "movies_total": movies_total,
            "movies_completed": movies_completed,
            "sessions_found": sessions_found,
            "sessions_attempted": sessions_attempted,
            "sessions_completed": sessions_completed,
            "sessions_successful": sessions_successful,
            "sessions_failed": sessions_failed,
            "snapshots_created": snapshots_created,
            "current_session": current_session,
            "started_at": started_at,
            "elapsed_seconds": round(elapsed_seconds, 1),
            "last_error": last_error
        }
    }
    print(json.dumps(progress_event), flush=True)


def collect_data(
    run_id: Optional[str] = None,
    movie_external_ids: Optional[List[str]] = None,
    limit_sessions_per_movie: Optional[int] = None,
    lookback_minutes: int = 30
) -> Dict[str, Any]:
    scraper = NOSScraper()
    run = CollectionRun()
    if run_id:
        run.collection_run_id = run_id

    start_time_dt = datetime.now(timezone.utc)
    started_at_iso = start_time_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    movies_raw = scraper.get_complete_catalog()

    # Filter movies if external_ids specified
    if movie_external_ids is not None:
        target_set = set(str(x).strip() for x in movie_external_ids if str(x).strip())
        matched_movies = [
            m for m in movies_raw
            if str(m.get("aggregateformatnumber", "")).strip() in target_set
            or str(m.get("id", "")).strip() in target_set
            or str(m.get("uuid", "")).strip() in target_set
            or str(m.get("external_id", "")).strip() in target_set
            or str(m.get("title", "")).strip().lower() in [t.lower() for t in target_set]
        ]
    else:
        matched_movies = movies_raw

    # REQUIREMENT 1: Deduplicate target movies strictly by aggregateformatnumber
    target_movies = []
    seen_agg_ids: Set[str] = set()
    for m in matched_movies:
        agg_id = str(m.get("aggregateformatnumber") or m.get("external_id") or "").strip()
        if not agg_id or agg_id in seen_agg_ids:
            continue
        seen_agg_ids.add(agg_id)
        target_movies.append(m)

    movies_total = len(target_movies)
    run.movies_found = movies_total

    collected_sessions: List[Dict[str, Any]] = []
    seen_session_uuids_in_run: Set[str] = set()

    # Cutoff time for historical session filtering (REQUIREMENT 2 & 7)
    cutoff_utc = start_time_dt - timedelta(minutes=lookback_minutes)

    movies_completed = 0
    last_err: Optional[str] = None

    emit_progress(
        run_id=run.collection_run_id,
        status="RUNNING",
        current_movie="Initializing",
        movies_total=movies_total,
        movies_completed=0,
        sessions_found=0,
        sessions_attempted=0,
        sessions_completed=0,
        sessions_successful=0,
        sessions_failed=0,
        snapshots_created=0,
        current_session="",
        started_at=started_at_iso,
        elapsed_seconds=0.0
    )

    for m in target_movies:
        agg_id = str(m.get("aggregateformatnumber") or "").strip()
        if not agg_id:
            continue

        raw_title = (m.get("title") or "").strip()
        # Clean canonical title
        match = re.search(r"\s*\(([^)]+)\)\s*$", raw_title)
        movie_title = raw_title[:match.start()].strip() if match else raw_title

        movie_meta = {
            "external_id": str(agg_id),
            "title": movie_title,
            "poster_url": m.get("imageportraiturl") or m.get("imagelandscapeurl") or "",
            "duration": int(m.get("duration") or 0) if str(m.get("duration") or "").isdigit() else None,
            "age_rating": m.get("certificatedescription") or m.get("certificate") or "",
            "release_date": m.get("releasedate") or "",
        }

        try:
            sched = scraper.get_movie_sessions(agg_id)
            days = sched.get("days", []) if isinstance(sched, dict) else []
            movie_sessions_count = 0

            for day in days:
                op_date = day.get("date") or ""
                for theater in day.get("theaters", []):
                    theater_name = theater.get("name") or "NOS Cinema"
                    theater_uuid = theater.get("uuid") or ""
                    theater_city = theater.get("city") or ""
                    theater_region = theater.get("region") or ""

                    cinema_meta = {
                        "external_id": theater_uuid or f"theater-{theater_name.lower().replace(' ', '-')}",
                        "name": theater_name,
                        "city": theater_city,
                        "region": theater_region,
                        "latitude": None,
                        "longitude": None
                    }

                    for s in theater.get("sessions", []):
                        s_uuid = s.get("uuid")
                        if not s_uuid or s_uuid in seen_session_uuids_in_run:
                            continue

                        raw_time = s.get("time") or "00:00"
                        starts_at_utc = parse_portugal_session_time(op_date, raw_time)

                        # REQUIREMENT 2: Filter out past sessions older than lookback_minutes
                        if starts_at_utc < cutoff_utc:
                            continue

                        seen_session_uuids_in_run.add(s_uuid)
                        run.sessions_found += 1

                        if limit_sessions_per_movie and movie_sessions_count >= limit_sessions_per_movie:
                            continue

                        movie_sessions_count += 1
                        run.sessions_attempted += 1

                        current_sess_label = f"{theater_name} - {s.get('format') or '2D'} - {starts_at_utc.strftime('%H:%M')}"
                        elapsed = (datetime.now(timezone.utc) - start_time_dt).total_seconds()

                        emit_progress(
                            run_id=run.collection_run_id,
                            status="RUNNING",
                            current_movie=movie_title,
                            movies_total=movies_total,
                            movies_completed=movies_completed,
                            sessions_found=run.sessions_found,
                            sessions_attempted=run.sessions_attempted,
                            sessions_completed=run.sessions_successful + run.sessions_failed,
                            sessions_successful=run.sessions_successful,
                            sessions_failed=run.sessions_failed,
                            snapshots_created=run.seat_snapshots_created,
                            current_session=current_sess_label,
                            started_at=started_at_iso,
                            elapsed_seconds=elapsed,
                            last_error=last_err
                        )

                        # REQUIREMENT 6: Session isolation and explicit error handling
                        try:
                            snap = scraper.process_session(s_uuid)

                            room_meta = {
                                "external_id": snap.theater_room_uuid or f"room-{snap.room_name}",
                                "name": snap.room_name or "Sala",
                                "capacity": snap.total_seats
                            }

                            full_starts_at = starts_at_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

                            session_meta = {
                                "external_session_id": s_uuid,
                                "starts_at": full_starts_at,
                                "operational_date": compute_business_date(starts_at_utc),
                                "format": s.get("format") or ("IMAX" if "imax" in movie_title.lower() else "2D"),
                                "description": s.get("description") or f"{movie_title} @ {theater_name}"
                            }

                            seats_list = []
                            for seat in snap.seats.values():
                                seats_list.append({
                                    "stable_seat_key": seat.seat_key,
                                    "theater_room_uuid": seat.theater_room_uuid,
                                    "queue": seat.queue,
                                    "row": seat.row,
                                    "col": seat.col,
                                    "seat_number": seat.seat_number,
                                    "is_seat": seat.is_seat,
                                    "is_available": seat.is_available,
                                    "is_safety_seat": seat.is_safety_seat,
                                    "is_premium": seat.is_premium,
                                    "is_vip": seat.is_vip,
                                    "is_love_seat": seat.is_love_seat,
                                    "is_handicapped": seat.is_handicapped,
                                    "state": seat.state
                                })

                            prices_list = [
                                {"ticket_type": desc, "price": pr}
                                for desc, pr in snap.ticket_types
                            ]

                            snapshot_data = {
                                "collected_at": snap.collected_at.isoformat() + "Z",
                                "total_seats": snap.total_seats,
                                "sellable_seats": snap.sellable_seats,
                                "available_seats": snap.available_seats,
                                "unavailable_seats": snap.unavailable_seats,
                                "safety_seats": snap.safety_seats,
                                "unknown_seats": snap.unknown_seats,
                                "occupancy_proxy": snap.occupancy_proxy,
                                "invariant_valid": snap.is_invariant_valid,
                                "source": snap.source,
                                "collector_version": snap.collector_version,
                                "seats": seats_list,
                                "ticket_prices": prices_list
                            }

                            collected_sessions.append({
                                "movie": movie_meta,
                                "cinema": cinema_meta,
                                "room": room_meta,
                                "session": session_meta,
                                "snapshot": snapshot_data
                            })

                            run.sessions_successful += 1
                            run.seat_snapshots_created += 1

                        except Exception as e:
                            run.sessions_failed += 1
                            err_msg = f"Session {s_uuid} failed ({movie_title} @ {theater_name}): {str(e)}"
                            log.warning(err_msg)
                            run.errors.append(err_msg)
                            last_err = err_msg

        except Exception as e:
            err_msg = f"Movie '{movie_title}' schedule discovery failed: {str(e)}"
            log.warning(err_msg)
            run.errors.append(err_msg)
            last_err = err_msg

        movies_completed += 1

    run.finish()
    final_status = "SUCCESS" if not run.errors else ("PARTIAL" if run.seat_snapshots_created > 0 else "FAILED")

    elapsed_final = (datetime.now(timezone.utc) - start_time_dt).total_seconds()
    emit_progress(
        run_id=run.collection_run_id,
        status=final_status,
        current_movie="Completed",
        movies_total=movies_total,
        movies_completed=movies_completed,
        sessions_found=run.sessions_found,
        sessions_attempted=run.sessions_attempted,
        sessions_completed=run.sessions_successful + run.sessions_failed,
        sessions_successful=run.sessions_successful,
        sessions_failed=run.sessions_failed,
        snapshots_created=run.seat_snapshots_created,
        current_session="",
        started_at=started_at_iso,
        elapsed_seconds=elapsed_final,
        last_error=last_err
    )

    final_payload = {
        "type": "final",
        "run": {
            "run_id": run.collection_run_id,
            "started_at": started_at_iso,
            "completed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": final_status,
            "movies_found": run.movies_found,
            "sessions_found": run.sessions_found,
            "sessions_attempted": run.sessions_attempted,
            "sessions_successful": run.sessions_successful,
            "sessions_failed": run.sessions_failed,
            "snapshots_created": run.seat_snapshots_created,
            "errors": run.errors,
            "collector_version": run.collector_version
        },
        "sessions": collected_sessions
    }
    return final_payload


def main():
    parser = argparse.ArgumentParser(description="NOS Cinemas Box Office Collector Job")
    parser.add_argument("--run-id", type=str, default=None, help="Collection Run ID from Node.js supervisor")
    parser.add_argument("--movie-ids", nargs="*", help="List of movie external aggregate IDs to collect")
    parser.add_argument("--limit-sessions", type=int, default=None, help="Limit sessions per movie (for fast testing)")
    parser.add_argument("--lookback-minutes", type=int, default=30, help="Grace window lookback in minutes for historical sessions")
    parser.add_argument("--browse-all-movies", action="store_true", help="Fetch and return full catalog of current movies")

    args = parser.parse_args()

    if args.browse_all_movies:
        scraper = NOSScraper()
        catalog = scraper.get_complete_catalog()
        print(json.dumps({"movies": catalog}, indent=2))
        return

    database_url = os.environ.get("DATABASE_URL")
    standalone_mode = database_url is not None and args.run_id is None

    prepared = None
    run_id = args.run_id
    movie_ids = args.movie_ids

    if standalone_mode:
        print("Standalone Database Orchestration Mode Detected (GHA or CLI)", flush=True)
        try:
            cmd = ["npx", "tsx", "server/prepare_run_cli.ts"]
            env = os.environ.copy()
            proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
            if proc.returncode != 0:
                print(f"Error preparing run. CLI stdout:\n{proc.stdout}\nStderr:\n{proc.stderr}", file=sys.stderr, flush=True)
                sys.exit(proc.returncode)
            
            prepared = json.loads(proc.stdout.strip())
            if prepared.get("skipped"):
                print(f"CONCURRENCY_LOCK: Collection run skipped. Reason: {prepared.get('reason')}", flush=True)
                sys.exit(0)

            run_id = prepared["runId"]
            # If movie-ids weren't passed on CLI, use the ones from the database
            if not movie_ids:
                movie_ids = prepared["targetIds"]
                print(f"Discovered {len(movie_ids)} tracked movies to collect from Neon database.", flush=True)
            else:
                print(f"Using explicitly specified movie IDs: {movie_ids}", flush=True)
        except Exception as e:
            print(f"Failed to prepare database run: {str(e)}", file=sys.stderr, flush=True)
            sys.exit(1)

    try:
        result = collect_data(
            run_id=run_id,
            movie_external_ids=movie_ids,
            limit_sessions_per_movie=args.limit_sessions,
            lookback_minutes=args.lookback_minutes
        )
    except Exception as scrape_error:
        print(f"Scraper execution failed with unexpected error: {str(scrape_error)}", file=sys.stderr, flush=True)
        if standalone_mode and prepared:
            fail_payload = {
                "type": "final",
                "run": {
                    "run_id": run_id,
                    "started_at": prepared.get("startedAtIso"),
                    "completed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "status": "FAILED",
                    "movies_found": len(movie_ids) if movie_ids else 0,
                    "sessions_found": 0,
                    "sessions_attempted": 0,
                    "sessions_completed": 0,
                    "sessions_successful": 0,
                    "sessions_failed": 0,
                    "seat_snapshots_created": 0,
                    "errors": [f"Scraper fatal crash: {str(scrape_error)}"]
                },
                "sessions": []
            }
            try:
                fd, temp_path = tempfile.mkstemp(suffix=".json", prefix="nos_run_err_")
                try:
                    with os.fdopen(fd, 'w') as f:
                        json.dump({"prepared": prepared, "finalPayload": fail_payload}, f)
                    cmd = ["npx", "tsx", "server/persist_payload_cli.ts", temp_path]
                    subprocess.run(cmd, env=os.environ.copy())
                finally:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
            except Exception as db_err:
                print(f"Failed to persist failure status to database: {str(db_err)}", file=sys.stderr, flush=True)
        sys.exit(1)

    if standalone_mode and prepared:
        # Write envelope JSON containing both preparation metadata and final scraper result
        envelope = {
            "prepared": prepared,
            "finalPayload": result
        }
        try:
            fd, temp_path = tempfile.mkstemp(suffix=".json", prefix="nos_run_")
            try:
                with os.fdopen(fd, 'w') as f:
                    json.dump(envelope, f)
                
                # Spawn Node.js persist script to write back data, transitions, and performance snapshots
                cmd = ["npx", "tsx", "server/persist_payload_cli.ts", temp_path]
                print(f"Persisting collected data for {run_id} to database...", flush=True)
                proc = subprocess.run(cmd, capture_output=False, env=os.environ.copy())
                if proc.returncode != 0:
                    print(f"Database persistence failed. Script exited with code {proc.returncode}", file=sys.stderr, flush=True)
                    sys.exit(proc.returncode)
                print("Database persistence completed successfully.", flush=True)
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        except Exception as e:
            print(f"Failed during database persistence: {str(e)}", file=sys.stderr, flush=True)
            sys.exit(1)
    else:
        # Output final JSON payload event on stdout for Node.js supervisor to consume
        print(json.dumps(result))

    # Exit with code 1 if the run failed
    if result.get("run", {}).get("status") == "FAILED":
         sys.exit(1)


if __name__ == "__main__":
    main()
