#!/usr/bin/env python3
"""
Portugal Box Office Tracker - NOS Cinemas Scraper & Telemetry Collector
Pure HTTP Scraper & Invariant-Validated Data Pipeline.

OutSystems Multi-Step Protocol:
1. Fetch active movies via GraphQL / getMoviesInTheaters.
2. Fetch cinema sessions via getMovieSessions.getMovieSessionsAggregator.json.
3. Trigger OutSystems session cookies (nr1Users, nr2Users) and extract CSRF token.
4. DT00_GetConfig_and_SessionVars: Resolve room UUID and session metadata.
5. DT03_CreateBooking: Establish session-specific booking reservation context.
6. DT04_Get_SessionTicketTypes: Fetch ticket prices (e.g. Normal, IMAX, 3D).
7. SeatsGet (DataActionFetch_SeatsGet_ForRoomWithRows): Fetch live seat matrix.
8. Parse, preserve raw states, validate invariant, and generate immutable SeatSnapshot.
"""

import http.cookiejar
import json
import logging
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from nos_collector_models import (
    COLLECTOR_VERSION,
    SOURCE_NAME,
    CollectionRun,
    MovieDailyAggregation,
    SeatClassification,
    SeatSnapshot,
)
from nos_collector_parser import calculate_occupancy_proxy, parse_seat_map
from nos_collector_revenue import RevenueEstimator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("nos_scraper")

BASE_SITE = "https://www.cinemas.nos.pt"
BASE_TICKET = "https://bilheteira.cinemas.nos.pt"

COMMON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}

# OutSystems API Version Hashes extracted from client bundle
DT00_API_VERSION = "dfNuAd5RFhuYVM72Ag+GNg"
DT03_API_VERSION = "Q27XB3DyLHQNg9J_PVl5mw"
DT04_API_VERSION = "zpGcufXGtauwGRXL6xF9Uw"
SEATS_API_VERSION = "jDwh+jx3g7GikaonAE6Qgg"


class NOSScraper:
    """
    Robust HTTP scraper for NOS Cinemas Portugal.
    Manages OutSystems session state, CSRF tokens, and session-specific booking reservation lifecycles.
    """

    def __init__(self):
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar)
        )
        self.csrf_token: Optional[str] = None
        self._init_lock = threading.Lock()

    def init_session(self, sample_session_uuid: str) -> str:
        """
        Triggers OutSystems cookie issuance (nr1Users and nr2Users) by making an initial
        POST request to DataActionDT00. Extracts the unquoted 'crf=' CSRF token from nr2Users.
        Thread-safe: guarded by self._init_lock.
        """
        with self._init_lock:
            if self.csrf_token:
                return self.csrf_token

            url = f"{BASE_TICKET}/Cinemas/screenservices/Cinemas/MainFlow/Ticket/DataActionDT00_GetConfig_and_SessionVars"
            headers = {
                **COMMON_HEADERS,
                "Content-Type": "application/json; charset=UTF-8",
                "Origin": BASE_TICKET,
                "Referer": f"{BASE_TICKET}/Cinemas/Ticket?SessionUUID={sample_session_uuid}",
            }
            body = json.dumps({
                "versionInfo": {"moduleVersion": DT00_API_VERSION, "apiVersion": DT00_API_VERSION},
                "viewName": "MainFlow.Ticket",
                "screenData": {"variables": {"SessionUUID": sample_session_uuid}}
            }).encode("utf-8")

            req = urllib.request.Request(url, data=body, headers=headers)
            try:
                with self.opener.open(req, timeout=12) as resp:
                    pass
            except urllib.error.HTTPError:
                # 403 Invalid Login on initial anonymous call is expected while cookies are being set
                pass

            for cookie in self.cookie_jar:
                if cookie.name == "nr2Users":
                    decoded = urllib.parse.unquote(cookie.value)
                    if "crf=" in decoded:
                        self.csrf_token = decoded.split("crf=")[1].split(";")[0]
                        log.info("OutSystems session initialized. CSRF token acquired.")
                        return self.csrf_token

            raise RuntimeError("Failed to extract 'crf=' CSRF token from nr2Users cookie.")

    def _get_ticket_headers(self, session_uuid: str) -> Dict[str, str]:
        if not self.csrf_token:
            self.init_session(session_uuid)
        return {
            **COMMON_HEADERS,
            "Content-Type": "application/json; charset=UTF-8",
            "Origin": BASE_TICKET,
            "Referer": f"{BASE_TICKET}/Cinemas/Ticket?SessionUUID={session_uuid}",
            "x-csrftoken": self.csrf_token or "",
        }

    def get_movies_in_theaters(self) -> List[Dict[str, Any]]:
        """Lists all active movies currently in Portuguese theaters."""
        url = f"{BASE_SITE}/graphql/execute.json/cinemas/getMoviesInTheaters"
        req = urllib.request.Request(url, headers=COMMON_HEADERS)
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            return data.get("data", {}).get("movieList", {}).get("items", [])

    def get_all_movies(self) -> List[Dict[str, Any]]:
        """Lists all catalog movies (in theaters and coming soon) from NOS GraphQL API."""
        url = f"{BASE_SITE}/graphql/execute.json/cinemas/getAllMovies"
        req = urllib.request.Request(url, headers=COMMON_HEADERS)
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            return data.get("data", {}).get("movieList", {}).get("items", [])

    def get_movies_soon(self) -> List[Dict[str, Any]]:
        """Lists upcoming 'Soon' / 'Em Breve' movies from NOS GraphQL API."""
        url = f"{BASE_SITE}/graphql/execute.json/cinemas/getMoviesSoon"
        req = urllib.request.Request(url, headers=COMMON_HEADERS)
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            return data.get("data", {}).get("movieList", {}).get("items", [])

    def get_complete_catalog(self) -> List[Dict[str, Any]]:
        """
        Fetches and normalizes the full theatrical catalog across NOS endpoints.
        Deduplicates strictly by canonical aggregateformatnumber.
        Groups format variants (2D, IMAX, 3D, 4DX, ScreenX, ATMOS, VP, VO) into metadata.
        Assigns theatrical status: CURRENTLY_PLAYING, UPCOMING, or NO_LONGER_PLAYING.
        """
        all_items = self.get_all_movies()
        in_theaters_items = self.get_movies_in_theaters()
        soon_items = self.get_movies_soon()

        in_theaters_aggs = {
            str(m.get("aggregateformatnumber")).strip()
            for m in in_theaters_items
            if m.get("aggregateformatnumber")
        }
        soon_aggs = {
            str(m.get("aggregateformatnumber")).strip()
            for m in soon_items
            if m.get("aggregateformatnumber")
        }

        catalog_map: Dict[str, Dict[str, Any]] = {}

        def parse_title_format(title: str, raw_fmt: Optional[str]) -> Tuple[str, str]:
            title = (title or "").strip()
            match = re.search(r"\s*\(([^)]+)\)\s*$", title)
            fmt_tag = (raw_fmt or "2D").strip()
            if match:
                fmt_candidate = match.group(1).strip()
                if fmt_candidate:
                    fmt_tag = fmt_candidate

            base_title = re.sub(r"\s*[\(\[]\s*(?:VO|VP|V\.O\.|V\.P\.|Dob\.|Sub\.|Dobrado|Legendado|Vers[ãa]o\s+(?:Original|Portuguesa))(?:\s*[\/\\]\s*[\w\d]+)?\s*[\)\]]", "", title, flags=re.IGNORECASE)
            base_title = re.sub(r"\s*[-–—]\s*(?:VO|VP|V\.O\.|V\.P\.|Dob\.|Sub\.|Dobrado|Legendado|Vers[ãa]o\s+(?:Original|Portuguesa))\b", "", base_title, flags=re.IGNORECASE)
            base_title = re.sub(r"\s+\b(?:VO|VP|V\.O\.|V\.P\.|Dob\.|Sub\.|Dobrado|Legendado|Vers[ãa]o\s+(?:Original|Portuguesa))\b$", "", base_title, flags=re.IGNORECASE)
            base_title = re.sub(r"\s+", " ", base_title).strip()

            if not fmt_tag or fmt_tag.upper() in ["2D", "NORMAL"]:
                fmt_tag = "2D"
            elif fmt_tag.upper() == "3D":
                fmt_tag = "3D"

            return base_title or title, fmt_tag

        combined_raw = all_items + in_theaters_items + soon_items

        for m in combined_raw:
            agg_id = m.get("aggregateformatnumber") or m.get("uuid") or m.get("id")
            if not agg_id:
                continue
            agg_str = str(agg_id).strip()

            raw_title = m.get("title") or ""
            base_title, fmt_tag = parse_title_format(raw_title, m.get("format"))

            portrait = m.get("portraitimages")
            poster_url = ""
            if isinstance(portrait, dict):
                poster_url = portrait.get("path") or ""
            elif isinstance(portrait, str):
                poster_url = portrait

            if poster_url and poster_url.startswith("//"):
                poster_url = "https:" + poster_url
            elif not poster_url:
                poster_url = m.get("imageportraiturl") or m.get("imagelandscapeurl") or ""
                if poster_url and poster_url.startswith("//"):
                    poster_url = "https:" + poster_url

            is_in_th = (
                (agg_str in in_theaters_aggs)
                or bool(m.get("intheaters"))
                or (m.get("moviestate") in ["InTheaters", "Premiere"])
            )
            is_soon = (
                (agg_str in soon_aggs)
                or bool(m.get("soon"))
                or (m.get("moviestate") in ["Soon", "PreSale", "Presales"])
            )

            if is_in_th:
                status = "CURRENTLY_PLAYING"
            elif is_soon:
                status = "UPCOMING"
            else:
                status = "NO_LONGER_PLAYING"

            age_rating = m.get("classification") or m.get("certificatedescription") or m.get("certificate") or ""

            duration = None
            if m.get("duration") and str(m.get("duration")).isdigit():
                duration = int(m.get("duration"))

            rel_date = m.get("releasedate") or ""
            if rel_date and "T" in rel_date:
                rel_date = rel_date.split("T")[0]

            if agg_str not in catalog_map:
                catalog_map[agg_str] = {
                    "external_id": agg_str,
                    "title": base_title,
                    "original_title": m.get("originaltitle") or "",
                    "poster_url": poster_url,
                    "duration": duration,
                    "age_rating": age_rating,
                    "release_date": rel_date,
                    "formats": set([fmt_tag]),
                    "status": status,
                    "is_currently_playing": is_in_th,
                    "is_upcoming": is_soon,
                }
            else:
                entry = catalog_map[agg_str]
                entry["formats"].add(fmt_tag)
                if not entry["poster_url"] and poster_url:
                    entry["poster_url"] = poster_url
                if is_in_th:
                    entry["is_currently_playing"] = True
                if is_soon:
                    entry["is_upcoming"] = True

                if entry["is_currently_playing"]:
                    entry["status"] = "CURRENTLY_PLAYING"
                elif entry["is_upcoming"]:
                    entry["status"] = "UPCOMING"

        result_catalog = []
        for agg_str, item in catalog_map.items():
            item["formats"] = sorted(list(item["formats"]))
            result_catalog.append(item)

        return result_catalog

    def get_all_theaters(self) -> List[Dict[str, Any]]:
        """Lists all 29 NOS cinema theaters with UUIDs, locations and room counts."""
        url = f"{BASE_SITE}/graphql/execute.json/cinemas/getAllTheatersWithoutRegion"
        req = urllib.request.Request(url, headers=COMMON_HEADERS)
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            return data.get("data", {}).get("theaterList", {}).get("items", [])

    def get_movie_sessions(self, aggregate_movie_id: str, max_retries: int = 2, timeout_sec: int = 20) -> Dict[str, Any]:
        """
        Fetches structured session timetable for a movie by aggregate format number.
        Includes single retry logic (max 1 retry / 2 attempts total) with a 2.5s delay
        when NOS returns non-JSON/HTML error pages or transient network drops.
        """
        url = f"{BASE_SITE}/bin/cinemas/render/getMovieSessions.getMovieSessionsAggregator.json?aggregateMovieId={aggregate_movie_id}"
        req = urllib.request.Request(url, headers={**COMMON_HEADERS, "X-Requested-With": "XMLHttpRequest"})
        
        last_exception: Optional[Exception] = None
        for attempt in range(1, max_retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                    raw = resp.read()
                    try:
                        text = raw.decode("utf-8")
                    except UnicodeDecodeError:
                        text = raw.decode("latin-1", errors="replace")
                    data = json.loads(text)
                    if attempt > 1:
                        log.info(f"Successfully fetched schedule for movie {aggregate_movie_id} on retry attempt {attempt}/{max_retries}.")
                    return data
            except Exception as e:
                last_exception = e
                if attempt < max_retries:
                    retry_delay_sec = 2.5
                    log.info(
                        f"Schedule discovery for movie {aggregate_movie_id} failed on attempt {attempt}/{max_retries} ({type(e).__name__}: {e}). "
                        f"Waiting {retry_delay_sec}s and retrying once..."
                    )
                    time.sleep(retry_delay_sec)
                else:
                    log.warning(
                        f"Schedule discovery for movie {aggregate_movie_id} failed after {max_retries} attempts (1 retry). "
                        f"Last error: {type(e).__name__}: {e}"
                    )
                    raise last_exception if last_exception is not None else e

    def get_session_config(self, session_uuid: str) -> Dict[str, Any]:
        """Resolves Room UUID, movie title, room name, and cinema metadata for a session."""
        url = f"{BASE_TICKET}/Cinemas/screenservices/Cinemas/MainFlow/Ticket/DataActionDT00_GetConfig_and_SessionVars"
        headers = self._get_ticket_headers(session_uuid)
        body = json.dumps({
            "versionInfo": {"moduleVersion": DT00_API_VERSION, "apiVersion": DT00_API_VERSION},
            "viewName": "MainFlow.Ticket",
            "screenData": {"variables": {"SessionUUID": session_uuid}}
        }).encode("utf-8")

        req = urllib.request.Request(url, data=body, headers=headers)
        with self.opener.open(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            return data.get("data", {})

    def create_booking(
        self,
        session_uuid: str,
        theater_uuid: str,
        movie_uuid: str,
        theater_room_uuid: str
    ) -> Optional[str]:
        """
        Calls DataActionDT03_CreateBooking to register a temporary booking reservation context.
        This step is required by the NOS OutSystems backend to initialize live seat availability.
        Each session creates its own booking UUID to ensure complete state isolation.
        """
        url = f"{BASE_TICKET}/Cinemas/screenservices/Cinemas/MainFlow/Ticket/DataActionDT03_CreateBooking"
        headers = self._get_ticket_headers(session_uuid)
        body = json.dumps({
            "versionInfo": {"moduleVersion": DT03_API_VERSION, "apiVersion": DT03_API_VERSION},
            "viewName": "MainFlow.Ticket",
            "screenData": {
                "variables": {
                    "SessionUUID": session_uuid,
                    "Local_Purchase": {
                        "SessionUUID": session_uuid,
                        "TheaterUUID": theater_uuid,
                        "MovieUUID": movie_uuid,
                        "TheaterRoomUUID": theater_room_uuid,
                        "SelectedTicketsCount": 1,
                        "SeatCount": 1
                    }
                }
            },
            "clientVariables": {
                "DeviceType": "desktop",
                "TheaterUUID": theater_uuid or ""
            }
        }).encode("utf-8")

        req = urllib.request.Request(url, data=body, headers=headers)
        try:
            with self.opener.open(req, timeout=12) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace"))
                return data.get("data", {}).get("BookingUUID")
        except Exception as e:
            log.warning(f"Could not create booking for session {session_uuid}: {e}")
            return None

    def get_ticket_types(self, session_uuid: str) -> List[Dict[str, Any]]:
        """Fetches available ticket types and prices normalized per seat."""
        url = f"{BASE_TICKET}/Cinemas/screenservices/Cinemas/MainFlow/Ticket/DataActionDT04_Get_SessionTicketTypes"
        headers = self._get_ticket_headers(session_uuid)
        body = json.dumps({
            "versionInfo": {"moduleVersion": DT04_API_VERSION, "apiVersion": DT04_API_VERSION},
            "viewName": "MainFlow.Ticket",
            "screenData": {"variables": {"SessionUUID": session_uuid}}
        }).encode("utf-8")

        req = urllib.request.Request(url, data=body, headers=headers)
        with self.opener.open(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            types = data.get("data", {}).get("LocalTicketTypes_All", {}).get("List", [])
            results = []
            for t in types:
                desc = t.get("Description") or "Bilhete"
                raw_price = float(t.get("Price") or 0)
                seats_count = max(1, int(t.get("SeatsCount") or 1))
                is_default = bool(t.get("IsDefault") or False)
                price_per_seat = round(raw_price / seats_count, 2)
                results.append({
                    "ticket_type": desc,
                    "price": price_per_seat,
                    "raw_price": raw_price,
                    "seats_count": seats_count,
                    "is_default": is_default,
                })
            return results

    def get_seats_raw(
        self,
        session_uuid: str,
        theater_room_uuid: str,
        theater_uuid: str = "",
        movie_uuid: str = "",
        booking_uuid: Optional[str] = None,
        selected_tickets_count: int = 1
    ) -> Dict[str, Any]:
        """Fetches raw live seat map payload from OutSystems."""
        url = f"{BASE_TICKET}/Cinemas/screenservices/Cinemas_Bilheteiras_BLOCKS/Blocks/TicketStep2_SelectSeats/DataActionFetch_SeatsGet_ForRoomWithRows"
        headers = self._get_ticket_headers(session_uuid)
        payload = {
            "versionInfo": {"moduleVersion": SEATS_API_VERSION, "apiVersion": SEATS_API_VERSION},
            "viewName": "MainFlow.Ticket",
            "screenData": {
                "variables": {
                    "IsMainContentVisible": True,
                    "IsZoom": False,
                    "ZoomValue": "1",
                    "SeatDimension": "0",
                    "IsInfoSeats": False,
                    "SelectedSeats_String": "",
                    "Is_IOS": False,
                    "QueuesAndSeats": {"List": []},
                    "NumberOfSelectedSeats": 0,
                    "Availiable_SafetySeats": {"List": []},
                    "IsDataFetched": False,
                    "SessionUUID": session_uuid,
                    "TheaterRoomUUID": theater_room_uuid,
                    "IsToFetchSuggestsRoomSeats": True,
                    "SelectedTicketsCount": selected_tickets_count,
                    "QueuesAndSeats_PreviousSelected": {"List": []},
                    "Local_Purchase": {
                        "SessionUUID": session_uuid,
                        "TheaterUUID": theater_uuid,
                        "MovieUUID": movie_uuid,
                        "TheaterRoomUUID": theater_room_uuid,
                        "BookingId": booking_uuid or "",
                        "SelectedTicketsCount": selected_tickets_count,
                        "SeatCount": selected_tickets_count
                    }
                }
            },
            "clientVariables": {
                "DeviceType": "desktop",
                "HasSeenVIPPopUp": False,
                "LastBooking": booking_uuid or "",
                "TheaterUUID": theater_uuid or ""
            }
        }

        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with self.opener.open(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            return data.get("data", {})

    def process_session(
        self,
        session_uuid: str,
        theater_room_uuid: Optional[str] = None,
        fetch_ticket_types: bool = True,
        max_retries: int = 1
    ) -> SeatSnapshot:
        """
        Executes end-to-end collection for a single session:
        1. DT00: Resolve metadata and room UUID
        2. DT03: Create booking context
        3. SeatsGet: Retrieve live seat grid
        4. Parse and validate seat classification invariant
        5. DT04: Retrieve ticket prices (optional, skipped if already known)
        6. Return immutable SeatSnapshot

        Includes single-retry recovery (max 1 retry / 2 attempts total) when an
        individual session's socket read (urllib.request 12-15s) times out.
        """
        for attempt in range(max_retries + 1):
            try:
                config = self.get_session_config(session_uuid)
                if not theater_room_uuid:
                    theater_room_uuid = config.get("out_TheaterRoomUUID", "")

                theater_uuid = config.get("out_TheaterUUID", "")
                movie_uuid = config.get("out_MovieUUID", "")
                movie_title = config.get("out_MovieTitle", "")
                theater_name = config.get("out_TheaterName", "")
                room_name = config.get("out_RoomName", "")
                session_time = config.get("out_SessionStartDateTime", "")

                if not theater_room_uuid:
                    raise ValueError(f"Could not resolve theater room UUID for session {session_uuid}")

                # Establish booking reservation context required for accurate seat availability
                booking_uuid = self.create_booking(session_uuid, theater_uuid, movie_uuid, theater_room_uuid)

                raw_seats_data = self.get_seats_raw(
                    session_uuid=session_uuid,
                    theater_room_uuid=theater_room_uuid,
                    theater_uuid=theater_uuid,
                    movie_uuid=movie_uuid,
                    booking_uuid=booking_uuid
                )

                parsed_seats: SeatClassification = parse_seat_map(
                    raw_seats_data,
                    fallback_room_uuid=theater_room_uuid
                )

                ticket_types = []
                if fetch_ticket_types:
                    try:
                        ticket_types = self.get_ticket_types(session_uuid)
                    except Exception as e:
                        log.warning(f"Could not fetch ticket types for session {session_uuid}: {e}")

                occupancy_proxy = calculate_occupancy_proxy(
                    unavailable_seats=parsed_seats.unavailable_seats,
                    sellable_seats=parsed_seats.sellable_seats
                )

                # Derived box office estimates (clearly marked as estimated)
                estimated_sold = parsed_seats.unavailable_seats
                estimated_revenue = RevenueEstimator.estimate_session_revenue(
                    sold_seats=estimated_sold,
                    ticket_types=ticket_types,
                    format_hint=movie_title
                )

                return SeatSnapshot(
                    session_id=session_uuid,
                    theater_room_uuid=theater_room_uuid,
                    movie_title=movie_title,
                    theater_name=theater_name,
                    room_name=room_name,
                    session_time=session_time,
                    total_seats=parsed_seats.total_seats,
                    sellable_seats=parsed_seats.sellable_seats,
                    available_seats=parsed_seats.available_seats,
                    unavailable_seats=parsed_seats.unavailable_seats,
                    safety_seats=parsed_seats.safety_seats,
                    unknown_seats=parsed_seats.unknown_seats,
                    occupancy_proxy=occupancy_proxy,
                    is_invariant_valid=parsed_seats.is_invariant_valid,
                    invariant_error_msg=parsed_seats.invariant_error_msg,
                    seats=parsed_seats.seats,
                    estimated_sold_seats=estimated_sold,
                    estimated_revenue=estimated_revenue,
                    ticket_types=ticket_types,
                    collected_at=datetime.utcnow(),
                    source=SOURCE_NAME,
                    collector_version=COLLECTOR_VERSION
                )
            except Exception as e:
                err_str = str(e).lower()
                is_socket_timeout = (
                    isinstance(e, (socket.timeout, TimeoutError)) or
                    "timed out" in err_str or
                    "the read operation timed out" in err_str or
                    (isinstance(e, urllib.error.URLError) and "timed out" in str(e.reason).lower())
                )
                if is_socket_timeout and attempt < max_retries:
                    log.info(
                        f"Session {session_uuid} hit transient socket timeout on attempt {attempt + 1}/{max_retries + 1} ({e}). "
                        f"Retrying once with same timeout..."
                    )
                    time.sleep(1.0)
                    continue
                raise

    def run_collection_cycle(
        self,
        max_movies: Optional[int] = None,
        max_sessions_per_movie: Optional[int] = None
    ) -> Tuple[CollectionRun, List[SeatSnapshot]]:
        """
        Runs a comprehensive collection sweep across active Portuguese cinema sessions,
        recording full telemetry and creating immutable seat snapshots.
        """
        run = CollectionRun()
        snapshots: List[SeatSnapshot] = []

        try:
            movies = self.get_movies_in_theaters()
            run.movies_found = len(movies)
            log.info(f"Collection Run {run.collection_run_id}: Found {len(movies)} active movies.")

            selected_movies = movies[:max_movies] if max_movies else movies

            all_session_tasks: List[Tuple[str, str, str]] = []  # (title, agg_id, session_uuid)
            for m in selected_movies:
                agg_id = m.get("aggregateformatnumber")
                if not agg_id:
                    continue
                try:
                    sched = self.get_movie_sessions(agg_id)
                    days = sched.get("days", []) if isinstance(sched, dict) else []
                    session_count_for_movie = 0
                    for day in days:
                        for theater in day.get("theaters", []):
                            for s in theater.get("sessions", []):
                                s_uuid = s.get("uuid")
                                if s_uuid:
                                    all_session_tasks.append((m.get("title", ""), agg_id, s_uuid))
                                    session_count_for_movie += 1
                                    if (
                                        max_sessions_per_movie
                                        and session_count_for_movie >= max_sessions_per_movie
                                    ):
                                        break
                            if (
                                max_sessions_per_movie
                                and session_count_for_movie >= max_sessions_per_movie
                            ):
                                break
                        if (
                            max_sessions_per_movie
                            and session_count_for_movie >= max_sessions_per_movie
                        ):
                            break
                except Exception as e:
                    err_msg = f"Failed to retrieve sessions for movie '{m.get('title')}': {e}"
                    log.warning(err_msg)
                    run.errors.append(err_msg)

            run.sessions_found = len(all_session_tasks)
            log.info(f"Total session targets identified: {len(all_session_tasks)}")

            for title, agg_id, session_uuid in all_session_tasks:
                run.sessions_attempted += 1
                try:
                    snap = self.process_session(session_uuid)
                    snapshots.append(snap)
                    run.sessions_successful += 1
                    run.seat_snapshots_created += 1
                except Exception as e:
                    run.sessions_failed += 1
                    err_msg = f"Session {session_uuid} ({title}) failed: {e}"
                    log.warning(err_msg)
                    run.errors.append(err_msg)

            run.finish()
            log.info(
                f"Collection Run {run.collection_run_id} completed with status {run.status}: "
                f"{run.sessions_successful} succeeded, {run.sessions_failed} failed."
            )

        except Exception as e:
            run.errors.append(f"Fatal collection cycle error: {e}")
            run.finish(status="FAILED")
            log.error(f"Collection Run {run.collection_run_id} failed: {e}")

        return run, snapshots


if __name__ == "__main__":
    print("Running NOS Cinemas Production-Grade Seat Collector...")
    scraper = NOSScraper()

    # Step 1: List all active movies
    movies = scraper.get_movies_in_theaters()
    print(f"Retrieved {len(movies)} active movies playing in Portugal.")

    target_movie = next((m for m in movies if m.get("aggregateformatnumber")), None)
    if not target_movie:
        print("No active movies with format aggregator found.")
        exit(1)

    agg_id = target_movie["aggregateformatnumber"]
    print(f"Inspecting schedule for: '{target_movie.get('title')}' (Aggregator: {agg_id})")

    schedule = scraper.get_movie_sessions(agg_id)
    days = schedule.get("days", []) if isinstance(schedule, dict) else []

    sample_session_uuid = None
    for day in days:
        for t in day.get("theaters", []):
            if t.get("sessions"):
                sample_session_uuid = t["sessions"][0]["uuid"]
                break
        if sample_session_uuid:
            break

    if not sample_session_uuid:
        print("No active sessions found for movie.")
        exit(1)

    print(f"Collecting session snapshot for SessionUUID: {sample_session_uuid}...")
    snapshot = scraper.process_session(sample_session_uuid)

    print("\n" + "="*65)
    print("IMMUTABLE NOS SEAT SNAPSHOT:")
    print("="*65)
    print(f"Movie:             {snapshot.movie_title}")
    print(f"Cinema:            {snapshot.theater_name}")
    print(f"Room:              {snapshot.room_name} (UUID: {snapshot.theater_room_uuid})")
    print(f"Session time:      {snapshot.session_time}")
    print(f"Total seats:       {snapshot.total_seats}")
    print(f"Sellable seats:    {snapshot.sellable_seats}")
    print(f"Available seats:   {snapshot.available_seats}")
    print(f"Unavailable seats: {snapshot.unavailable_seats}")
    print(f"Safety seats:      {snapshot.safety_seats}")
    print(f"Unknown seats:     {snapshot.unknown_seats}")
    print(f"Occupancy Proxy:   {snapshot.occupancy_proxy * 100:.2f}%")
    print(f"Invariant valid:   {snapshot.is_invariant_valid}")
    print(f"Tracked seats #:   {len(snapshot.seats)}")
    print(f"Ticket prices:     {snapshot.ticket_types}")
    print(f"Estimated rev:     €{snapshot.estimated_revenue:.2f}")
    print(f"Collected at:      {snapshot.collected_at.isoformat()}Z")
    print(f"Source/Version:    {snapshot.source} v{snapshot.collector_version}")
    print("="*65)
