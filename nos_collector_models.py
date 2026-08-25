"""
Data models for NOS Cinemas Box Office Collector.
Defines clean dataclasses for raw seat state preservation, seat transitions,
snapshots, movie/daily aggregations, and collection telemetry.

Strict architectural principle:
Never claim the NOS API tells us something it does not actually state.
Raw availability states (AVAILABLE, UNAVAILABLE, SAFETY, UNKNOWN) are preserved
strictly separate from derived box office estimates (estimated_sold_seats, estimated_revenue).
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple
import uuid


COLLECTOR_VERSION = "2.0.0"
SOURCE_NAME = "NOS"


class SeatState(str, Enum):
    """
    Proven raw seat states directly observed from NOS OutSystems response.
    """
    NON_SEAT = "NON_SEAT"          # isSeat == False (aisles, spacers, empty grid cells)
    AVAILABLE = "AVAILABLE"        # isSeat == True, isAvailable == True, IsSafetySeat == False
    UNAVAILABLE = "UNAVAILABLE"    # isSeat == True, isAvailable == False, IsSafetySeat == False
    SAFETY = "SAFETY"              # isSeat == True, IsSafetySeat == True (distancing / safety restriction)
    UNKNOWN = "UNKNOWN"            # isSeat == True, unexpected or missing boolean isAvailable


@dataclass
class RawSeat:
    """
    Complete raw state of an individual physical seat, identified by a stable key.
    Does not rely on array index.
    """
    seat_key: str  # Format: "{TheaterRoomUUID}:{Queue}:{Row}:{Col}:{SeatNumber}"
    theater_room_uuid: str
    queue: str
    row: int
    col: int
    seat_number: int
    is_seat: bool
    is_available: Optional[bool]
    is_safety_seat: bool
    is_premium: bool = False
    is_vip: bool = False
    is_love_seat: bool = False
    is_handicapped: bool = False
    is_selected: bool = False
    state: str = SeatState.UNKNOWN.value

    def to_dict(self) -> Dict[str, Any]:
        return {
            "seat_key": self.seat_key,
            "theater_room_uuid": self.theater_room_uuid,
            "queue": self.queue,
            "row": self.row,
            "col": self.col,
            "seat_number": self.seat_number,
            "is_seat": self.is_seat,
            "is_available": self.is_available,
            "is_safety_seat": self.is_safety_seat,
            "is_premium": self.is_premium,
            "is_vip": self.is_vip,
            "is_love_seat": self.is_love_seat,
            "is_handicapped": self.is_handicapped,
            "is_selected": self.is_selected,
            "state": self.state,
        }


@dataclass
class SeatClassification:
    """
    Raw parsed counts and seat dictionary for a seat-map response.
    """
    total_seats: int = 0
    sellable_seats: int = 0
    available_seats: int = 0
    unavailable_seats: int = 0
    safety_seats: int = 0
    unknown_seats: int = 0
    is_invariant_valid: bool = True
    invariant_error_msg: Optional[str] = None
    seats: Dict[str, RawSeat] = field(default_factory=dict)


@dataclass
class SeatSnapshot:
    """
    Immutable observation of a single session's live seat map at a specific point in time.
    Raw observations must never be overwritten.
    """
    session_id: str
    theater_room_uuid: str
    movie_title: str = ""
    theater_name: str = ""
    room_name: str = ""
    session_time: str = ""
    
    # Raw observed metrics (factual)
    total_seats: int = 0
    sellable_seats: int = 0
    available_seats: int = 0
    unavailable_seats: int = 0
    safety_seats: int = 0
    unknown_seats: int = 0
    occupancy_proxy: float = 0.0  # unavailable_seats / sellable_seats
    
    # Validation
    is_invariant_valid: bool = True
    invariant_error_msg: Optional[str] = None
    
    # Detailed seat matrix (keyed by stable seat_key)
    seats: Dict[str, RawSeat] = field(default_factory=dict)

    # Derived estimates (explicitly marked as estimated)
    estimated_sold_seats: int = 0
    estimated_revenue: float = 0.0

    ticket_types: List[Tuple[str, float]] = field(default_factory=list)
    collected_at: datetime = field(default_factory=datetime.utcnow)
    source: str = SOURCE_NAME
    collector_version: str = COLLECTOR_VERSION

    structural_blocked_seats: int = 0

    # Backward compatibility properties for code expecting sold_seats / blocked_seats
    @property
    def effective_unavailable_seats(self) -> int:
        # Structural block subtraction temporarily disabled across the app (e.g. 157/362 seats in NOS Colombo IMAX flagged falsely)
        return self.unavailable_seats

    @property
    def sold_seats(self) -> int:
        """Alias for estimated_sold_seats or effective unavailable_seats."""
        return self.estimated_sold_seats if self.estimated_sold_seats > 0 else self.effective_unavailable_seats

    @property
    def blocked_seats(self) -> int:
        """Alias for safety_seats."""
        return self.safety_seats

    @property
    def occupancy(self) -> float:
        """Alias for occupancy_proxy."""
        return self.occupancy_proxy

    def to_dict(self, include_seat_details: bool = False) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "session_id": self.session_id,
            "theater_room_uuid": self.theater_room_uuid,
            "movie_title": self.movie_title,
            "theater_name": self.theater_name,
            "room_name": self.room_name,
            "session_time": self.session_time,
            "total_seats": self.total_seats,
            "sellable_seats": self.sellable_seats,
            "available_seats": self.available_seats,
            "unavailable_seats": self.unavailable_seats,
            "safety_seats": self.safety_seats,
            "unknown_seats": self.unknown_seats,
            "occupancy_proxy": round(self.occupancy_proxy, 4),
            "estimated_sold_seats": self.estimated_sold_seats,
            "estimated_revenue": round(self.estimated_revenue, 2),
            "is_invariant_valid": self.is_invariant_valid,
            "invariant_error_msg": self.invariant_error_msg,
            "ticket_types": self.ticket_types,
            "collected_at": self.collected_at.isoformat() + "Z",
            "source": self.source,
            "collector_version": self.collector_version,
        }
        if include_seat_details:
            data["seats"] = {k: v.to_dict() for k, v in self.seats.items()}
        return data


@dataclass
class SeatTransition:
    """
    Represents a proven state transition for a specific physical seat across two snapshots.
    """
    seat_key: str
    queue: str
    row: int
    col: int
    seat_number: int
    from_state: str
    to_state: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "seat_key": self.seat_key,
            "queue": self.queue,
            "row": self.row,
            "col": self.col,
            "seat_number": self.seat_number,
            "from_state": self.from_state,
            "to_state": self.to_state,
        }


@dataclass
class SeatTransitionsReport:
    """
    Tracks seat-level transitions and sales velocity proxy between consecutive snapshots
    for a single session.
    """
    session_id: str
    prev_collected_at: datetime
    curr_collected_at: datetime
    delta_time_hours: float
    newly_unavailable: int = 0   # AVAILABLE -> UNAVAILABLE (primary proxy for new bookings/holds)
    newly_available: int = 0     # UNAVAILABLE/SAFETY -> AVAILABLE (cart expiration / hold release)
    newly_safety: int = 0        # -> SAFETY
    state_changes: int = 0       # Total seats whose state changed
    sales_velocity_proxy: float = 0.0  # newly_unavailable / delta_time_hours
    transitions: List[SeatTransition] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "prev_collected_at": self.prev_collected_at.isoformat() + "Z",
            "curr_collected_at": self.curr_collected_at.isoformat() + "Z",
            "delta_time_hours": round(self.delta_time_hours, 4),
            "newly_unavailable": self.newly_unavailable,
            "newly_available": self.newly_available,
            "newly_safety": self.newly_safety,
            "state_changes": self.state_changes,
            "sales_velocity_proxy": round(self.sales_velocity_proxy, 2),
            "transitions_count": len(self.transitions),
            "transitions": [t.to_dict() for t in self.transitions],
        }


# Retain alias for backward compatibility
HistoricalSalesDelta = SeatTransitionsReport


@dataclass
class MovieDailyAggregation:
    """
    Aggregated daily box office metrics for a movie on a given date.
    Strictly uses the latest valid snapshot per session to prevent double counting.
    """
    movie_title: str
    date: str
    total_theaters: int = 0
    total_sessions: int = 0
    total_sellable_capacity: int = 0
    total_available_seats: int = 0
    total_unavailable_seats: int = 0
    total_safety_seats: int = 0
    total_unknown_seats: int = 0
    overall_occupancy_proxy: float = 0.0
    
    # Derived analytics
    estimated_sold_admissions: int = 0
    estimated_revenue: float = 0.0
    
    session_count_with_snapshots: int = 0
    aggregated_at: datetime = field(default_factory=datetime.utcnow)

    # Backward compatibility properties
    @property
    def total_sold_admissions(self) -> int:
        return self.estimated_sold_admissions if self.estimated_sold_admissions > 0 else self.total_unavailable_seats

    @property
    def total_blocked_seats(self) -> int:
        return self.total_safety_seats

    @property
    def overall_occupancy(self) -> float:
        return self.overall_occupancy_proxy

    def to_dict(self) -> Dict[str, Any]:
        return {
            "movie_title": self.movie_title,
            "date": self.date,
            "total_theaters": self.total_theaters,
            "total_sessions": self.total_sessions,
            "total_sellable_capacity": self.total_sellable_capacity,
            "total_available_seats": self.total_available_seats,
            "total_unavailable_seats": self.total_unavailable_seats,
            "total_safety_seats": self.total_safety_seats,
            "total_unknown_seats": self.total_unknown_seats,
            "overall_occupancy_proxy": round(self.overall_occupancy_proxy, 4),
            "estimated_sold_admissions": self.estimated_sold_admissions,
            "estimated_revenue": round(self.estimated_revenue, 2),
            "session_count_with_snapshots": self.session_count_with_snapshots,
            "aggregated_at": self.aggregated_at.isoformat() + "Z",
        }


@dataclass
class CollectionRun:
    """
    Diagnostic and telemetry record for a scheduled or manual collection run.
    """
    collection_run_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    started_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    status: str = "PENDING"  # PENDING, SUCCESS, PARTIAL, FAILED
    movies_found: int = 0
    sessions_found: int = 0
    sessions_attempted: int = 0
    sessions_successful: int = 0
    sessions_failed: int = 0
    seat_snapshots_created: int = 0
    errors: List[str] = field(default_factory=list)
    collector_version: str = COLLECTOR_VERSION

    def finish(self, status: Optional[str] = None) -> None:
        self.completed_at = datetime.utcnow()
        if status:
            self.status = status
        elif self.sessions_failed == 0 and self.sessions_successful > 0:
            self.status = "SUCCESS"
        elif self.sessions_successful > 0:
            self.status = "PARTIAL"
        else:
            self.status = "FAILED"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "collection_run_id": self.collection_run_id,
            "started_at": self.started_at.isoformat() + "Z",
            "completed_at": self.completed_at.isoformat() + "Z" if self.completed_at else None,
            "status": self.status,
            "movies_found": self.movies_found,
            "sessions_found": self.sessions_found,
            "sessions_attempted": self.sessions_attempted,
            "sessions_successful": self.sessions_successful,
            "sessions_failed": self.sessions_failed,
            "seat_snapshots_created": self.seat_snapshots_created,
            "errors": self.errors,
            "collector_version": self.collector_version,
        }
