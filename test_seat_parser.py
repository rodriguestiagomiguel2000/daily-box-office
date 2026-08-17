"""
Automated unit tests for NOS seat parser, raw state preservation, invariant validation,
seat-level transition tracking, movie aggregation, and revenue estimator.
"""

import unittest
from datetime import datetime, timedelta

from nos_collector_models import (
    RawSeat,
    SeatClassification,
    SeatSnapshot,
    SeatState,
    SeatTransition,
    SeatTransitionsReport,
)
from nos_collector_parser import (
    build_seat_key,
    calculate_occupancy_proxy,
    parse_seat_map,
)
from nos_collector_transitions import compute_seat_transitions
from nos_collector_revenue import RevenueEstimator
from nos_collector_aggregator import BoxOfficeAggregator


class TestSeatParser(unittest.TestCase):

    def test_available_seat(self):
        """Available seat: isSeat=True, isAvailable=True, IsSafetySeat=False -> AVAILABLE"""
        raw_data = {
            "QueuesAndSeats_LR": {
                "List": [
                    {
                        "LocalSeats": {
                            "List": [
                                {
                                    "TheaterRoomUUID": "room-1",
                                    "Queue": "A",
                                    "Row": 1,
                                    "Col": 1,
                                    "SeatNumber": 1,
                                    "isSeat": True,
                                    "isAvailable": True,
                                    "IsSafetySeat": False,
                                    "IsPremium": True,
                                    "isVip": False,
                                    "isLoveSeat": False,
                                    "isHandicapped": False
                                }
                            ]
                        }
                    }
                ]
            }
        }
        res = parse_seat_map(raw_data)
        self.assertEqual(res.total_seats, 1)
        self.assertEqual(res.sellable_seats, 1)
        self.assertEqual(res.available_seats, 1)
        self.assertEqual(res.unavailable_seats, 0)
        self.assertEqual(res.safety_seats, 0)
        self.assertEqual(res.unknown_seats, 0)
        self.assertTrue(res.is_invariant_valid)

        key = build_seat_key("room-1", "A", 1, 1, 1)
        self.assertIn(key, res.seats)
        seat = res.seats[key]
        self.assertEqual(seat.state, SeatState.AVAILABLE.value)
        self.assertTrue(seat.is_premium)
        self.assertFalse(seat.is_vip)

    def test_unavailable_seat(self):
        """Unavailable seat: isSeat=True, isAvailable=False, IsSafetySeat=False -> UNAVAILABLE"""
        raw_data = {
            "QueuesAndSeats_LR": {
                "List": [
                    {
                        "LocalSeats": {
                            "List": [
                                {
                                    "TheaterRoomUUID": "room-1",
                                    "Queue": "A",
                                    "Row": 1,
                                    "Col": 2,
                                    "SeatNumber": 2,
                                    "isSeat": True,
                                    "isAvailable": False,
                                    "IsSafetySeat": False,
                                    "isLoveSeat": True
                                }
                            ]
                        }
                    }
                ]
            }
        }
        res = parse_seat_map(raw_data)
        self.assertEqual(res.total_seats, 1)
        self.assertEqual(res.sellable_seats, 1)
        self.assertEqual(res.available_seats, 0)
        self.assertEqual(res.unavailable_seats, 1)
        self.assertEqual(res.safety_seats, 0)
        self.assertEqual(res.unknown_seats, 0)
        self.assertTrue(res.is_invariant_valid)

        key = build_seat_key("room-1", "A", 1, 2, 2)
        seat = res.seats[key]
        self.assertEqual(seat.state, SeatState.UNAVAILABLE.value)
        self.assertTrue(seat.is_love_seat)

    def test_safety_seat(self):
        """Safety seat: isSeat=True, IsSafetySeat=True -> SAFETY"""
        raw_data = {
            "QueuesAndSeats_LR": {
                "List": [
                    {
                        "LocalSeats": {
                            "List": [
                                {
                                    "TheaterRoomUUID": "room-1",
                                    "Queue": "A",
                                    "Row": 1,
                                    "Col": 3,
                                    "SeatNumber": 3,
                                    "isSeat": True,
                                    "isAvailable": False,
                                    "IsSafetySeat": True
                                }
                            ]
                        }
                    }
                ]
            }
        }
        res = parse_seat_map(raw_data)
        self.assertEqual(res.total_seats, 1)
        self.assertEqual(res.sellable_seats, 1)
        self.assertEqual(res.available_seats, 0)
        self.assertEqual(res.unavailable_seats, 0)
        self.assertEqual(res.safety_seats, 1)
        self.assertEqual(res.unknown_seats, 0)
        self.assertTrue(res.is_invariant_valid)

        key = build_seat_key("room-1", "A", 1, 3, 3)
        seat = res.seats[key]
        self.assertEqual(seat.state, SeatState.SAFETY.value)

    def test_non_seat_object(self):
        """Non-seat object (aisle, empty grid cell, spacer): isSeat=False"""
        raw_data = {
            "QueuesAndSeats_LR": {
                "List": [
                    {
                        "LocalSeats": {
                            "List": [
                                {"isSeat": False, "isAvailable": False, "IsSafetySeat": False},
                                {
                                    "TheaterRoomUUID": "room-1",
                                    "Queue": "A",
                                    "Row": 1,
                                    "Col": 1,
                                    "SeatNumber": 1,
                                    "isSeat": True,
                                    "isAvailable": True,
                                    "IsSafetySeat": False
                                }
                            ]
                        }
                    }
                ]
            }
        }
        res = parse_seat_map(raw_data)
        self.assertEqual(res.total_seats, 1)
        self.assertEqual(res.sellable_seats, 1)
        self.assertEqual(res.available_seats, 1)
        self.assertEqual(res.unavailable_seats, 0)
        self.assertEqual(res.safety_seats, 0)
        self.assertTrue(res.is_invariant_valid)

    def test_unknown_seat_state_not_silently_sold(self):
        """Missing or null isAvailable field must be classified as UNKNOWN, not silently as sold."""
        raw_data = {
            "QueuesAndSeats_LR": {
                "List": [
                    {
                        "LocalSeats": {
                            "List": [
                                {"TheaterRoomUUID": "room-1", "Queue": "B", "Row": 2, "Col": 1, "SeatNumber": 1, "isSeat": True, "isAvailable": None, "IsSafetySeat": False},
                                {"TheaterRoomUUID": "room-1", "Queue": "B", "Row": 2, "Col": 2, "SeatNumber": 2, "isSeat": True, "IsSafetySeat": False},  # missing isAvailable
                                {"TheaterRoomUUID": "room-1", "Queue": "B", "Row": 2, "Col": 3, "SeatNumber": 3, "isSeat": True, "isAvailable": "invalid_string", "IsSafetySeat": False},
                                {"TheaterRoomUUID": "room-1", "Queue": "B", "Row": 2, "Col": 4, "SeatNumber": 4, "isSeat": True, "isAvailable": True, "IsSafetySeat": False},
                            ]
                        }
                    }
                ]
            }
        }
        res = parse_seat_map(raw_data)
        self.assertEqual(res.sellable_seats, 4)
        self.assertEqual(res.available_seats, 1)
        self.assertEqual(res.unavailable_seats, 0)  # NOT silently marked unavailable
        self.assertEqual(res.safety_seats, 0)
        self.assertEqual(res.unknown_seats, 3)
        self.assertTrue(res.is_invariant_valid)  # 4 == 1 + 0 + 0 + 3

    def test_occupancy_proxy_calculation(self):
        """Occupancy proxy = unavailable / sellable (when sellable > 0)."""
        self.assertEqual(calculate_occupancy_proxy(252, 362), 252 / 362)
        self.assertEqual(calculate_occupancy_proxy(0, 362), 0.0)
        self.assertEqual(calculate_occupancy_proxy(362, 362), 1.0)
        self.assertEqual(calculate_occupancy_proxy(50, 0), 0.0)

    def test_seat_transitions_tracker(self):
        """
        Tests exact physical seat transitions between two consecutive snapshots of the same session.
        """
        t0 = datetime(2026, 8, 13, 12, 0, 0)
        t1 = datetime(2026, 8, 13, 12, 30, 0)  # +30 min = 0.5h

        def make_seat(room, q, r, c, num, state):
            key = build_seat_key(room, q, r, c, num)
            return RawSeat(
                seat_key=key,
                theater_room_uuid=room,
                queue=q,
                row=r,
                col=c,
                seat_number=num,
                is_seat=True,
                is_available=(state == SeatState.AVAILABLE.value),
                is_safety_seat=(state == SeatState.SAFETY.value),
                state=state
            )

        # Snapshot 0: 5 seats
        # seat1: AVAILABLE
        # seat2: UNAVAILABLE
        # seat3: AVAILABLE
        # seat4: AVAILABLE
        # seat5: UNAVAILABLE
        seats_s0 = {
            build_seat_key("r1", "A", 1, 1, 1): make_seat("r1", "A", 1, 1, 1, SeatState.AVAILABLE.value),
            build_seat_key("r1", "A", 1, 2, 2): make_seat("r1", "A", 1, 2, 2, SeatState.UNAVAILABLE.value),
            build_seat_key("r1", "A", 1, 3, 3): make_seat("r1", "A", 1, 3, 3, SeatState.AVAILABLE.value),
            build_seat_key("r1", "A", 1, 4, 4): make_seat("r1", "A", 1, 4, 4, SeatState.AVAILABLE.value),
            build_seat_key("r1", "A", 1, 5, 5): make_seat("r1", "A", 1, 5, 5, SeatState.UNAVAILABLE.value),
        }
        s0 = SeatSnapshot(
            session_id="session-123",
            theater_room_uuid="r1",
            sellable_seats=5,
            available_seats=3,
            unavailable_seats=2,
            safety_seats=0,
            seats=seats_s0,
            collected_at=t0
        )

        # Snapshot 1 (+30 min):
        # seat1: AVAILABLE -> UNAVAILABLE (newly_unavailable += 1)
        # seat2: UNAVAILABLE -> AVAILABLE (newly_available += 1: cart release)
        # seat3: AVAILABLE -> SAFETY (newly_safety += 1)
        # seat4: AVAILABLE -> AVAILABLE (unchanged)
        # seat5: UNAVAILABLE -> UNAVAILABLE (unchanged)
        seats_s1 = {
            build_seat_key("r1", "A", 1, 1, 1): make_seat("r1", "A", 1, 1, 1, SeatState.UNAVAILABLE.value),
            build_seat_key("r1", "A", 1, 2, 2): make_seat("r1", "A", 1, 2, 2, SeatState.AVAILABLE.value),
            build_seat_key("r1", "A", 1, 3, 3): make_seat("r1", "A", 1, 3, 3, SeatState.SAFETY.value),
            build_seat_key("r1", "A", 1, 4, 4): make_seat("r1", "A", 1, 4, 4, SeatState.AVAILABLE.value),
            build_seat_key("r1", "A", 1, 5, 5): make_seat("r1", "A", 1, 5, 5, SeatState.UNAVAILABLE.value),
        }
        s1 = SeatSnapshot(
            session_id="session-123",
            theater_room_uuid="r1",
            sellable_seats=5,
            available_seats=2,
            unavailable_seats=2,
            safety_seats=1,
            seats=seats_s1,
            collected_at=t1
        )

        report = compute_seat_transitions(s0, s1)
        self.assertEqual(report.session_id, "session-123")
        self.assertAlmostEqual(report.delta_time_hours, 0.5, places=3)
        self.assertEqual(report.newly_unavailable, 1)
        self.assertEqual(report.newly_available, 1)
        self.assertEqual(report.newly_safety, 1)
        self.assertEqual(report.state_changes, 3)
        self.assertAlmostEqual(report.sales_velocity_proxy, 1 / 0.5, places=1)  # 2.0 tickets/hour
        self.assertEqual(len(report.transitions), 3)

    def test_movie_aggregation_avoid_double_counting(self):
        """
        Verify that aggregating a movie uses the LATEST valid snapshot per session,
        preventing double-counting historical snapshots.
        """
        t0 = datetime(2026, 8, 13, 10, 0, 0)
        t1 = datetime(2026, 8, 13, 11, 0, 0)
        t2 = datetime(2026, 8, 13, 12, 0, 0)

        # Session A snapshots
        sa_0 = SeatSnapshot(session_id="sA", theater_room_uuid="r1", movie_title="Odisseia", theater_name="Colombo", session_time="2026-08-13T14:00:00", sellable_seats=200, unavailable_seats=50, available_seats=150, collected_at=t0)
        sa_1 = SeatSnapshot(session_id="sA", theater_room_uuid="r1", movie_title="Odisseia", theater_name="Colombo", session_time="2026-08-13T14:00:00", sellable_seats=200, unavailable_seats=80, available_seats=120, collected_at=t1)
        sa_2 = SeatSnapshot(session_id="sA", theater_room_uuid="r1", movie_title="Odisseia", theater_name="Colombo", session_time="2026-08-13T14:00:00", sellable_seats=200, unavailable_seats=120, available_seats=80, collected_at=t2)

        # Session B snapshots
        sb_0 = SeatSnapshot(session_id="sB", theater_room_uuid="r2", movie_title="Odisseia", theater_name="Colombo", session_time="2026-08-13T17:00:00", sellable_seats=150, unavailable_seats=40, available_seats=110, collected_at=t0)
        sb_1 = SeatSnapshot(session_id="sB", theater_room_uuid="r2", movie_title="Odisseia", theater_name="Colombo", session_time="2026-08-13T17:00:00", sellable_seats=150, unavailable_seats=80, available_seats=70, collected_at=t2)

        # Session C snapshots
        sc_0 = SeatSnapshot(session_id="sC", theater_room_uuid="r3", movie_title="Odisseia", theater_name="NorteShopping", session_time="2026-08-13T21:00:00", sellable_seats=100, unavailable_seats=45, available_seats=55, collected_at=t2)

        all_snaps = [sa_0, sa_1, sa_2, sb_0, sb_1, sc_0]

        agg = BoxOfficeAggregator.aggregate_movie_daily("Odisseia", "2026-08-13", all_snaps)

        # Expected: Latest unavailable for sA (120) + sB (80) + sC (45) = 245
        self.assertEqual(agg.total_unavailable_seats, 245)
        self.assertEqual(agg.estimated_sold_admissions, 245)
        # Sellable capacity: 200 + 150 + 100 = 450
        self.assertEqual(agg.total_sellable_capacity, 450)
        # 2 unique theaters: Colombo, NorteShopping
        self.assertEqual(agg.total_theaters, 2)
        self.assertEqual(agg.total_sessions, 3)
        self.assertAlmostEqual(agg.overall_occupancy_proxy, 245 / 450, places=3)

    def test_revenue_estimation(self):
        """Test revenue calculation with standard, IMAX, 3D, and filtering 0.0 EUR vouchers."""
        ticket_types_mixed = [
            ("Bilhete IMAX", 13.50),
            ("Vale de Descontos", 0.00),
            ("Bilhete Criança", 11.00)
        ]
        rev_imax = RevenueEstimator.estimate_session_revenue(100, ticket_types_mixed, "A Odisseia (IMAX)")
        # Average of paid prices (13.50 + 11.00) / 2 = 12.25 * 100 = 1225.0
        self.assertEqual(rev_imax, 1225.0)

        # Test standard fallback
        rev_std = RevenueEstimator.estimate_session_revenue(50, [], "Standard Movie")
        self.assertEqual(rev_std, 50 * 7.60)


if __name__ == "__main__":
    unittest.main()
