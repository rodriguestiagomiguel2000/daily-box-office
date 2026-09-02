#!/usr/bin/env python3
"""
NOS Cinemas Collector Job Script.
Executes targeted collection for tracked movies, discovers sessions, fetches raw seat states,
and outputs complete structured JSON for the PostgreSQL persistence layer.
Supports real-time progress streaming via stdout line-by-line JSON events.
"""

import argparse
import concurrent.futures
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
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
from nos_collector_revenue import RevenueEstimator

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("collector_job")

LISBON_TZ = ZoneInfo("Europe/Lisbon")
BUSINESS_DAY_CUTOFF_HOUR = 6


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


def emit_session(run_id: str, session_data: Dict[str, Any]):
    session_event = {
        "type": "session",
        "run_id": run_id,
        "data": session_data
    }
    print(json.dumps(session_event), flush=True)


def emit_movie_schedule_success(run_id: str, movie_meta: Dict[str, Any]):
    event = {
        "type": "movie_schedule_success",
        "run_id": run_id,
        "data": movie_meta
    }
    print(json.dumps(event), flush=True)


def emit_movie_schedule_failure(run_id: str, format_external_id: str, movie_title: str, detail: str):
    event = {
        "type": "movie_schedule_failure",
        "run_id": run_id,
        "data": {
            "format_external_id": format_external_id,
            "movie_title": movie_title,
            "detail": detail
        }
    }
    print(json.dumps(event), flush=True)


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
    tracked_movie_ids: Optional[List[str]] = None,
    limit_sessions_per_movie: Optional[int] = None,
    lookback_minutes: int = 30,
    known_ticket_sessions: Optional[Set[str]] = None
) -> Dict[str, Any]:
    scraper = NOSScraper()
    run = CollectionRun()
    if run_id:
        run.collection_run_id = run_id

    start_time_dt = datetime.now(timezone.utc)
    started_at_iso = start_time_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    movies_raw = scraper.get_complete_catalog()

    # Tracked movies set for presale eligibility
    tracked_set: Set[str] = set()
    if tracked_movie_ids is not None:
        tracked_set = set(str(x).strip() for x in tracked_movie_ids if str(x).strip())
    elif movie_external_ids is not None:
        tracked_set = set(str(x).strip() for x in movie_external_ids if str(x).strip())

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

    # Temporary debug logging of the exact movie processing sequence per run
    target_sequence_log = [
        f"[{idx+1}/{movies_total}] '{m.get('title')}' (id={m.get('external_id') or m.get('aggregateformatnumber')})"
        for idx, m in enumerate(target_movies)
    ]
    log.info(f"Target movie processing sequence ({movies_total} total): {' -> '.join(target_sequence_log)}")

    collected_sessions: List[Dict[str, Any]] = []
    seen_session_uuids_in_run: Set[str] = set()
    sessions_with_ticket_prices: Set[str] = set(known_ticket_sessions or [])

    # Cutoff time for historical session filtering (REQUIREMENT 2 & 7)
    cutoff_utc = start_time_dt - timedelta(minutes=lookback_minutes)

    # Theatrical Operational Day Filter (6:00 AM Lisbon Cutoff):
    now_lisbon = datetime.now(LISBON_TZ)
    current_op_date_str = (now_lisbon - timedelta(hours=BUSINESS_DAY_CUTOFF_HOUR)).strftime("%Y-%m-%d")

    movies_completed = 0
    last_err: Optional[str] = None
    timed_out = False
    progress_lock = threading.Lock()

    # Diagnostic pricing resolution telemetry per movie
    # Format: movie_title -> {"clean_default_prices": List[float], "fallback_avg_prices": List[float]}
    pricing_diagnostics: Dict[str, Dict[str, List[float]]] = {}

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
        if timed_out:
            break

        agg_id = str(m.get("external_id") or m.get("aggregateformatnumber") or "").strip()
        if not agg_id:
            continue

        raw_title = (m.get("title") or "").strip()
        # Clean canonical title
        match = re.search(r"\s*\(([^)]+)\)\s*$", raw_title)
        movie_title = raw_title[:match.start()].strip() if match else raw_title

        # Determine tracking status for movie
        movie_is_tracked = bool(
            agg_id in tracked_set
            or str(m.get("id") or "").strip() in tracked_set
            or str(m.get("uuid") or "").strip() in tracked_set
            or m.get("tracking_enabled") is True
        )

        # Normalize release date to YYYY-MM-DD if present
        raw_rel_date = str(m.get("release_date") or m.get("releasedate") or "").strip()
        if "T" in raw_rel_date:
            raw_rel_date = raw_rel_date.split("T")[0].strip()
        if " " in raw_rel_date:
            raw_rel_date = raw_rel_date.split(" ")[0].strip()
        movie_release_date = raw_rel_date if re.match(r"^\d{4}-\d{2}-\d{2}$", raw_rel_date) else None

        movie_meta = {
            "external_id": str(agg_id),
            "format_external_id": str(agg_id),
            "title": movie_title,
            "display_title": raw_title or movie_title,
            "poster_url": m.get("poster_url") or m.get("imageportraiturl") or m.get("imagelandscapeurl") or "",
            "duration": int(m.get("duration") or 0) if str(m.get("duration") or "").isdigit() else None,
            "age_rating": m.get("age_rating") or m.get("certificatedescription") or m.get("certificate") or "",
            "release_date": movie_release_date or "",
        }

        try:
            sched = scraper.get_movie_sessions(agg_id, max_retries=2, timeout_sec=35)
            days = sched.get("days", []) if isinstance(sched, dict) else []
            # Emit movie schedule discovery success event for health tracking
            emit_movie_schedule_success(run.collection_run_id, movie_meta)

            # 1. Discover all candidate sessions for this movie (Current day + Tracked opening-day presale)
            movie_candidates: List[Dict[str, Any]] = []
            future_rejected_count = 0
            current_accepted_count = 0
            presale_accepted_count = 0

            for day in days:
                for theater in day.get("theaters", []):
                    theater_name = theater.get("name") or "NOS Cinema"
                    theater_uuid = theater.get("theaterId") or theater.get("uuid") or ""
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
                        op_date = s.get("operationalDate") or day.get("date") or ""
                        try:
                            starts_at_utc = parse_portugal_session_time(op_date, raw_time)
                        except Exception:
                            continue

                        # STRICT THEATRICAL OPERATIONAL DAY FILTER (6:00 AM Lisbon Cutoff):
                        sess_op_date_str = compute_business_date(starts_at_utc)

                        is_current_day = (sess_op_date_str == current_op_date_str)
                        is_opening_day_presale = bool(
                            movie_is_tracked
                            and movie_release_date is not None
                            and current_op_date_str < movie_release_date
                            and sess_op_date_str == movie_release_date
                        )

                        if not (is_current_day or is_opening_day_presale):
                            if sess_op_date_str > current_op_date_str:
                                future_rejected_count += 1
                            continue

                        # Filter out past sessions older than lookback_minutes (only applies to current-day sessions)
                        if is_current_day and starts_at_utc < cutoff_utc:
                            continue

                        seen_session_uuids_in_run.add(s_uuid)
                        run.sessions_found += 1

                        if is_opening_day_presale:
                            presale_accepted_count += 1
                            log.info(
                                f"[PRESALE] Movie '{movie_title}' | operational_date={sess_op_date_str} | "
                                f"current={current_op_date_str} | eligible=true | reason=tracked_opening_day | "
                                f"theater='{theater_name}' | session={s_uuid}"
                            )
                        else:
                            current_accepted_count += 1

                        movie_candidates.append({
                            "s_uuid": s_uuid,
                            "starts_at_utc": starts_at_utc,
                            "op_date": op_date,
                            "raw_session": s,
                            "movie_title": movie_title,
                            "movie_meta": movie_meta,
                            "theater_name": theater_name,
                            "cinema_meta": cinema_meta,
                        })

            if presale_accepted_count > 0 or future_rejected_count > 0:
                log.info(
                    f"[PRESALE SUMMARY] Movie '{movie_title}' | release_date={movie_release_date} | "
                    f"current_op_date={current_op_date_str} | is_tracked={movie_is_tracked} | "
                    f"current_accepted={current_accepted_count} | presale_accepted={presale_accepted_count} | "
                    f"other_future_rejected={future_rejected_count}"
                )

            # Sort candidate sessions chronologically for today
            movie_candidates.sort(key=lambda c: c["starts_at_utc"])

            if limit_sessions_per_movie:
                movie_candidates = movie_candidates[:limit_sessions_per_movie]

            # 2. Parallel Session Scraping with Bounded Concurrency (batch of 5-8 workers)
            if movie_candidates:
                # Pre-initialize session/CSRF token on the main scraper
                try:
                    scraper.init_session(movie_candidates[0]["s_uuid"])
                except Exception as init_err:
                    log.warning(f"Initial session setup warning: {init_err}")

                def process_candidate(candidate: Dict[str, Any]) -> Dict[str, Any]:
                    # Stale run auto-cleanup check: 13 minute timeout (780s)
                    elapsed_check = (datetime.now(timezone.utc) - start_time_dt).total_seconds()
                    if elapsed_check > 780:
                        raise TimeoutError("Terminated due to timeout")

                    cand_uuid = candidate["s_uuid"]
                    with progress_lock:
                        should_fetch_tickets = cand_uuid not in sessions_with_ticket_prices

                    snap = scraper.process_session(cand_uuid, fetch_ticket_types=should_fetch_tickets)

                    if should_fetch_tickets and snap.ticket_types:
                        with progress_lock:
                            sessions_with_ticket_prices.add(cand_uuid)

                    room_meta = {
                        "external_id": snap.theater_room_uuid or f"room-{snap.room_name}",
                        "name": snap.room_name or "Sala",
                        "capacity": snap.total_seats
                    }

                    full_starts_at = candidate["starts_at_utc"].strftime("%Y-%m-%dT%H:%M:%SZ")

                    session_meta = {
                        "external_session_id": cand_uuid,
                        "starts_at": full_starts_at,
                        "operational_date": compute_business_date(candidate["starts_at_utc"]),
                        "format": candidate["raw_session"].get("format") or ("IMAX" if "imax" in candidate["movie_title"].lower() else "2D"),
                        "description": candidate["raw_session"].get("description") or f"{candidate['movie_title']} @ {candidate['theater_name']}"
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

                    prices_list = []
                    for item in snap.ticket_types:
                        if isinstance(item, dict):
                            # Explicit validation: require raw_price to avoid double-normalization
                            if "raw_price" not in item or item.get("raw_price") is None:
                                log.warning(
                                    f"Ticket type entry missing required 'raw_price' (skipping item): {item}"
                                )
                                continue

                            try:
                                raw_price_val = float(item["raw_price"])
                            except (ValueError, TypeError):
                                log.warning(
                                    f"Malformed 'raw_price' value in ticket type entry (skipping item): {item}"
                                )
                                continue

                            seats_count_val = max(1, int(item.get("seats_count", 1)))
                            price_val = float(item.get("price", round(raw_price_val / seats_count_val, 2)))

                            prices_list.append({
                                "ticket_type": str(item.get("ticket_type", "Bilhete")),
                                "price": price_val,
                                "raw_price": raw_price_val,
                                "seats_count": seats_count_val,
                                "is_default": bool(item.get("is_default", False))
                            })
                        elif isinstance(item, (list, tuple)) and len(item) >= 2:
                            # Note: Legacy / test fixture tuple representation (ticket_type, price).
                            # item[1] is assumed to be a PER-SEAT price (matching the ticket_types type hint
                            # in nos_collector_models.py). seats_count=1 and raw_price=price are intentional
                            # for this path.
                            try:
                                price_val = float(item[1])
                                prices_list.append({
                                    "ticket_type": str(item[0]),
                                    "price": price_val,
                                    "raw_price": price_val,
                                    "seats_count": 1,
                                    "is_default": False
                                })
                            except (ValueError, TypeError):
                                log.warning(f"Malformed price value in tuple ticket item (skipping item): {item}")
                                continue
                        else:
                            log.warning(f"Unrecognized ticket type item format (skipping item): {item}")

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

                    return {
                        "movie": candidate["movie_meta"],
                        "cinema": candidate["cinema_meta"],
                        "room": room_meta,
                        "session": session_meta,
                        "snapshot": snapshot_data
                    }

                # Bounded concurrency: 5 parallel workers for balanced throughput & high reliability
                MAX_CONCURRENT_SCRAPERS = 5
                with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENT_SCRAPERS) as executor:
                    future_to_cand = {
                        executor.submit(process_candidate, cand): cand
                        for cand in movie_candidates
                    }

                    run.sessions_attempted += len(movie_candidates)

                    for future in concurrent.futures.as_completed(future_to_cand):
                        cand = future_to_cand[future]
                        current_sess_label = f"{cand['theater_name']} - {cand['raw_session'].get('format') or '2D'} - {cand['starts_at_utc'].strftime('%H:%M')}"
                        try:
                            res_item = future.result()
                            with progress_lock:
                                run.sessions_successful += 1
                                run.seat_snapshots_created += 1

                                # Track diagnostic price resolution telemetry per movie
                                snap_prices = res_item.get("snapshot", {}).get("ticket_prices", [])
                                sess_fmt = res_item.get("session", {}).get("format", "")
                                if snap_prices:
                                    eff_price, res_method = RevenueEstimator.get_effective_ticket_price_with_metadata(
                                        snap_prices,
                                        sess_fmt
                                    )
                                    m_title = cand["movie_title"]
                                    if m_title not in pricing_diagnostics:
                                        pricing_diagnostics[m_title] = {
                                            "clean_default_prices": [],
                                            "fallback_avg_prices": []
                                        }
                                    if res_method == "NON_ZERO_AVERAGE":
                                        pricing_diagnostics[m_title]["fallback_avg_prices"].append(eff_price)
                                    else:
                                        pricing_diagnostics[m_title]["clean_default_prices"].append(eff_price)

                                # Immediately stream individual session to parent supervisor for incremental DB persistence
                                emit_session(run.collection_run_id, res_item)
                                del res_item
                        except Exception as sess_err:
                            err_str = str(sess_err)
                            if "Terminated due to timeout" in err_str:
                                timed_out = True
                            with progress_lock:
                                run.sessions_failed += 1
                                err_msg = f"Session {cand['s_uuid']} failed ({cand['movie_title']} @ {cand['theater_name']}): {err_str}"
                                log.warning(err_msg)
                                run.errors.append(err_msg)
                                last_err = err_msg

                        elapsed = (datetime.now(timezone.utc) - start_time_dt).total_seconds()
                        if elapsed > 780:
                            timed_out = True

                        with progress_lock:
                            emit_progress(
                                run_id=run.collection_run_id,
                                status="RUNNING" if not timed_out else "FAILED",
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

                        if timed_out:
                            # Cancel remaining futures if timeout exceeded
                            for pending_f in future_to_cand:
                                pending_f.cancel()
                            break

        except Exception as e:
            err_msg = f"Movie '{movie_title}' schedule discovery failed: {str(e)}"
            log.warning(err_msg)
            run.errors.append(err_msg)
            last_err = err_msg
            emit_movie_schedule_failure(
                run.collection_run_id,
                format_external_id=agg_id,
                movie_title=raw_title or movie_title,
                detail=str(e)
            )

        movies_completed += 1

    run.finish()
    if timed_out or (datetime.now(timezone.utc) - start_time_dt).total_seconds() > 780:
        final_status = "FAILED"
        if "Terminated due to timeout" not in run.errors:
            run.errors.append("Terminated due to timeout")
    else:
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
        "pricing_diagnostics": pricing_diagnostics,
        "sessions": []
    }
    return final_payload


def main():
    parser = argparse.ArgumentParser(description="NOS Cinemas Box Office Collector Job")
    parser.add_argument("--run-id", type=str, default=None, help="Collection Run ID from Node.js supervisor")
    parser.add_argument("--movie-ids", nargs="*", help="List of movie external aggregate IDs to collect")
    parser.add_argument("--tracked-movie-ids", nargs="*", help="List of movie external aggregate IDs that are tracked for presales")
    parser.add_argument("--limit-sessions", type=int, default=None, help="Limit sessions per movie (for fast testing)")
    parser.add_argument("--lookback-minutes", type=int, default=30, help="Grace window lookback in minutes for historical sessions")
    parser.add_argument("--browse-all-movies", action="store_true", help="Fetch and return full catalog of current movies")
    parser.add_argument("--known-ticket-sessions-file", type=str, default=None, help="Path to JSON file containing session UUIDs that already have ticket prices")

    args = parser.parse_args()

    if args.browse_all_movies:
        scraper = NOSScraper()
        catalog = scraper.get_complete_catalog()
        print(json.dumps({"movies": catalog}, indent=2))
        return

    database_url = os.environ.get("DATABASE_URL")
    standalone_mode = database_url is not None and args.run_id is None

    if standalone_mode:
        print("Standalone Database Orchestration Mode Detected (CLI) -> Delegating to streaming Node runner", flush=True)
        cmd = ["npx", "tsx", "server/execute_run_cli.ts"]
        env = os.environ.copy()
        proc = subprocess.run(cmd, env=env)
        sys.exit(proc.returncode)

    run_id = args.run_id
    movie_ids = args.movie_ids

    known_ticket_sessions: Set[str] = set()
    if args.known_ticket_sessions_file and os.path.exists(args.known_ticket_sessions_file):
        try:
            with open(args.known_ticket_sessions_file, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, list):
                    known_ticket_sessions = set(str(x) for x in loaded if x)
        except Exception as e:
            log.warning(f"Could not load known ticket sessions from file {args.known_ticket_sessions_file}: {e}")

    try:
        result = collect_data(
            run_id=run_id,
            movie_external_ids=movie_ids,
            tracked_movie_ids=args.tracked_movie_ids,
            limit_sessions_per_movie=args.limit_sessions,
            lookback_minutes=args.lookback_minutes,
            known_ticket_sessions=known_ticket_sessions
        )
    except Exception as scrape_error:
        print(f"Scraper execution failed with unexpected error: {str(scrape_error)}", file=sys.stderr, flush=True)
        sys.exit(1)

    # Output final JSON payload event on stdout for Node.js supervisor to consume
    print(json.dumps(result))

    # Exit with code 1 if the run failed
    if result.get("run", {}).get("status") == "FAILED":
        sys.exit(1)


if __name__ == "__main__":
    main()
