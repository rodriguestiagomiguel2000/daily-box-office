"""
Deterministic seat map parser and raw state classifier for NOS Cinemas Portugal.
Strictly preserves raw NOS OutSystems fields without assuming unproven semantics.
"""

import logging
from typing import Any, Dict, Optional
from nos_collector_models import RawSeat, SeatClassification, SeatState

log = logging.getLogger("nos_parser")


def build_seat_key(
    theater_room_uuid: str,
    queue: str,
    row: int,
    col: int,
    seat_number: int
) -> str:
    """
    Constructs a deterministic, immutable physical seat identifier.
    Guarantees reliable cross-snapshot seat comparison independent of array index or layout ordering.
    """
    clean_room = (theater_room_uuid or "").strip()
    clean_queue = (queue or "").strip().upper()
    return f"{clean_room}:{clean_queue}:{row}:{col}:{seat_number}"


def parse_seat_map(
    data: Dict[str, Any],
    fallback_room_uuid: str = ""
) -> SeatClassification:
    """
    Parses raw NOS OutSystems 'DataActionFetch_SeatsGet_ForRoomWithRows' response.
    
    Classification Rules (Strict & Proven):
    1. if not isSeat: NON_SEAT (aisles, empty grid cells, structural dividers).
    2. total_seats tracks the total physical seat count in the room where isSeat is True.
    3. if IsSafetySeat is True: SAFETY
    4. elif isAvailable is True: AVAILABLE
    5. elif isAvailable is False: UNAVAILABLE (cannot be booked; includes sales, active holds, cinema locks)
    6. else: UNKNOWN (missing, null, or corrupted isAvailable field)
    
    Invariant Validation:
        sellable_seats == available_seats + unavailable_seats + safety_seats + unknown_seats
    """
    rows = data.get("QueuesAndSeats_LR", {}).get("List", [])
    if not rows and "List" in data:
        rows = data["List"]

    total_seats = 0
    sellable_seats = 0
    available_seats = 0
    unavailable_seats = 0
    safety_seats = 0
    unknown_seats = 0
    seats_dict: Dict[str, RawSeat] = {}

    for row_obj in rows:
        seats_in_row = row_obj.get("LocalSeats", {}).get("List", [])
        if not seats_in_row and isinstance(row_obj.get("LocalSeats"), list):
            seats_in_row = row_obj["LocalSeats"]

        for s in seats_in_row:
            is_seat = bool(s.get("isSeat"))
            if not is_seat:
                continue

            total_seats += 1
            sellable_seats += 1

            room_uuid = s.get("TheaterRoomUUID") or fallback_room_uuid or ""
            queue = str(s.get("Queue") or "").strip()
            row_num = int(s.get("Row") or 0)
            col_num = int(s.get("Col") or 0)
            seat_num = int(s.get("SeatNumber") or 0)

            is_safety = s.get("IsSafetySeat")
            is_avail = s.get("isAvailable")
            is_premium = bool(s.get("IsPremium", False))
            is_vip = bool(s.get("isVip", False))
            is_love = bool(s.get("isLoveSeat", False))
            is_handicapped = bool(s.get("isHandicapped", False))
            is_selected = bool(s.get("isSelected", False))

            if is_safety is True:
                state = SeatState.SAFETY.value
                safety_seats += 1
            elif is_avail is True:
                state = SeatState.AVAILABLE.value
                available_seats += 1
            elif is_avail is False:
                state = SeatState.UNAVAILABLE.value
                unavailable_seats += 1
            else:
                state = SeatState.UNKNOWN.value
                unknown_seats += 1
                log.warning(
                    f"Unexpected seat state encountered at Queue={queue}, "
                    f"Row={row_num}, Col={col_num}: isAvailable={is_avail}, "
                    f"IsSafetySeat={is_safety}. Classified as UNKNOWN."
                )

            seat_key = build_seat_key(room_uuid, queue, row_num, col_num, seat_num)
            raw_seat = RawSeat(
                seat_key=seat_key,
                theater_room_uuid=room_uuid,
                queue=queue,
                row=row_num,
                col=col_num,
                seat_number=seat_num,
                is_seat=is_seat,
                is_available=is_avail if isinstance(is_avail, bool) else None,
                is_safety_seat=bool(is_safety),
                is_premium=is_premium,
                is_vip=is_vip,
                is_love_seat=is_love,
                is_handicapped=is_handicapped,
                is_selected=is_selected,
                state=state,
            )
            seats_dict[seat_key] = raw_seat

    # Invariant validation
    calculated_sum = available_seats + unavailable_seats + safety_seats + unknown_seats
    is_invariant_valid = (sellable_seats == calculated_sum)
    invariant_error_msg = None

    if not is_invariant_valid:
        invariant_error_msg = (
            f"Seat invariant failed: sellable_seats ({sellable_seats}) != "
            f"sum of states ({calculated_sum}) [avail={available_seats}, "
            f"unavail={unavailable_seats}, safety={safety_seats}, unknown={unknown_seats}]"
        )
        log.error(invariant_error_msg)

    return SeatClassification(
        total_seats=total_seats,
        sellable_seats=sellable_seats,
        available_seats=available_seats,
        unavailable_seats=unavailable_seats,
        safety_seats=safety_seats,
        unknown_seats=unknown_seats,
        is_invariant_valid=is_invariant_valid,
        invariant_error_msg=invariant_error_msg,
        seats=seats_dict,
    )


def calculate_occupancy_proxy(unavailable_seats: int, sellable_seats: int) -> float:
    """
    Computes the seat occupancy proxy strictly based on sellable inventory.
    Formula: unavailable_seats / sellable_seats
    Labeled as an occupancy proxy, not confirmed admissions.
    """
    if sellable_seats <= 0:
        return 0.0
    return max(0.0, min(1.0, unavailable_seats / sellable_seats))


# Backward compatibility alias
calculate_occupancy = calculate_occupancy_proxy
