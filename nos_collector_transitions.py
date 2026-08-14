"""
Seat-Level Transition Tracker and Sales Velocity Engine.
Compares physical seat states across consecutive snapshots for the same session
using stable physical seat identifiers (roomUUID + queue + row + col + seatNumber).
"""

import logging
from datetime import datetime
from typing import List, Optional
from nos_collector_models import (
    RawSeat,
    SeatSnapshot,
    SeatState,
    SeatTransition,
    SeatTransitionsReport,
)

log = logging.getLogger("nos_transitions")


def compute_seat_transitions(
    prev_snapshot: SeatSnapshot,
    curr_snapshot: SeatSnapshot
) -> SeatTransitionsReport:
    """
    Computes exact physical seat state transitions and sales velocity proxy
    between two consecutive snapshots of the same session.

    Identifies:
    - newly_unavailable: AVAILABLE -> UNAVAILABLE (direct indicator of newly placed holds/tickets)
    - newly_available: UNAVAILABLE -> AVAILABLE (cart timeout / inventory release, not assumed refund)
    - newly_safety: -> SAFETY
    - state_changes: Total number of seat state transitions
    - sales_velocity_proxy: newly_unavailable / delta_time_hours (tickets/hour)
    """
    if prev_snapshot.session_id != curr_snapshot.session_id:
        raise ValueError(
            f"Cannot compute transitions between different sessions: "
            f"{prev_snapshot.session_id} vs {curr_snapshot.session_id}"
        )

    time_diff_sec = (curr_snapshot.collected_at - prev_snapshot.collected_at).total_seconds()
    delta_time_hours = max(0.0001, time_diff_sec / 3600.0)

    transitions: List[SeatTransition] = []
    newly_unavailable = 0
    newly_available = 0
    newly_safety = 0
    state_changes = 0

    # Physical seat-level comparison if detailed seat maps are present
    if prev_snapshot.seats and curr_snapshot.seats:
        all_keys = set(prev_snapshot.seats.keys()).union(curr_snapshot.seats.keys())
        for key in sorted(all_keys):
            prev_seat = prev_snapshot.seats.get(key)
            curr_seat = curr_snapshot.seats.get(key)

            if not prev_seat or not curr_seat:
                continue

            if prev_seat.state != curr_seat.state:
                state_changes += 1
                trans = SeatTransition(
                    seat_key=key,
                    queue=curr_seat.queue,
                    row=curr_seat.row,
                    col=curr_seat.col,
                    seat_number=curr_seat.seat_number,
                    from_state=prev_seat.state,
                    to_state=curr_seat.state,
                )
                transitions.append(trans)

                if prev_seat.state == SeatState.AVAILABLE.value and curr_seat.state == SeatState.UNAVAILABLE.value:
                    newly_unavailable += 1
                elif (
                    prev_seat.state in (SeatState.UNAVAILABLE.value, SeatState.SAFETY.value)
                    and curr_seat.state == SeatState.AVAILABLE.value
                ):
                    newly_available += 1
                elif curr_seat.state == SeatState.SAFETY.value and prev_seat.state != SeatState.SAFETY.value:
                    newly_safety += 1
    else:
        # Fallback to aggregate delta if detailed seats map was not captured
        delta_unavail = curr_snapshot.unavailable_seats - prev_snapshot.unavailable_seats
        if delta_unavail >= 0:
            newly_unavailable = delta_unavail
        else:
            newly_available = -delta_unavail
        state_changes = abs(delta_unavail)

    sales_velocity_proxy = newly_unavailable / delta_time_hours

    return SeatTransitionsReport(
        session_id=curr_snapshot.session_id,
        prev_collected_at=prev_snapshot.collected_at,
        curr_collected_at=curr_snapshot.collected_at,
        delta_time_hours=delta_time_hours,
        newly_unavailable=newly_unavailable,
        newly_available=newly_available,
        newly_safety=newly_safety,
        state_changes=state_changes,
        sales_velocity_proxy=sales_velocity_proxy,
        transitions=transitions,
    )


# Backward compatibility alias
compute_sales_delta = compute_seat_transitions
