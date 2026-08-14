"""
Box Office Aggregator.
Implements the aggregation hierarchy:
    Seat snapshot -> Session -> Cinema -> Movie -> Movie + Date

CRITICAL REQUIREMENT: Avoid double counting!
A movie's daily admissions and box office must be calculated from the LATEST valid
snapshot for each individual session, NEVER by summing across historical snapshots.
"""

from datetime import datetime
from typing import Dict, List
from nos_collector_models import SeatSnapshot, MovieDailyAggregation
from nos_collector_revenue import RevenueEstimator


class BoxOfficeAggregator:
    """
    Aggregates seat snapshots into movie-level and cinema-level box office statistics.
    """

    @staticmethod
    def get_latest_snapshots_by_session(
        snapshots: List[SeatSnapshot]
    ) -> Dict[str, SeatSnapshot]:
        """
        Deduplicates historical snapshots to keep only the latest valid snapshot
        for each distinct session_id.
        """
        latest_by_session: Dict[str, SeatSnapshot] = {}
        for snap in snapshots:
            # Skip corrupted snapshots if marked invalid
            if not snap.is_invariant_valid:
                continue

            sid = snap.session_id
            if sid not in latest_by_session:
                latest_by_session[sid] = snap
            else:
                if snap.collected_at > latest_by_session[sid].collected_at:
                    latest_by_session[sid] = snap

        return latest_by_session

    @classmethod
    def aggregate_movie_daily(
        cls,
        movie_title: str,
        target_date: str,
        all_snapshots: List[SeatSnapshot]
    ) -> MovieDailyAggregation:
        """
        Aggregates daily box office for a movie on a given date across all cinemas/sessions.
        Selects strictly the latest snapshot per session.
        """
        # Filter snapshots matching this movie and date
        matching_snapshots = [
            s for s in all_snapshots
            if s.movie_title.strip().lower() == movie_title.strip().lower()
            and (s.session_time.startswith(target_date) or target_date in s.session_time)
        ]

        latest_sessions = cls.get_latest_snapshots_by_session(matching_snapshots)

        total_sellable = 0
        total_available = 0
        total_unavailable = 0
        total_safety = 0
        total_unknown = 0
        total_revenue = 0.0
        unique_theaters = set()

        for s in latest_sessions.values():
            total_sellable += s.sellable_seats
            total_available += s.available_seats
            total_unavailable += s.unavailable_seats
            total_safety += s.safety_seats
            total_unknown += s.unknown_seats
            
            # Revenue calculation (derived estimate)
            effective_sold = s.estimated_sold_seats if s.estimated_sold_seats > 0 else s.unavailable_seats
            total_revenue += RevenueEstimator.estimate_session_revenue(
                effective_sold, s.ticket_types, s.movie_title
            )
            if s.theater_name:
                unique_theaters.add(s.theater_name)

        overall_occupancy_proxy = (
            total_unavailable / total_sellable if total_sellable > 0 else 0.0
        )

        return MovieDailyAggregation(
            movie_title=movie_title,
            date=target_date,
            total_theaters=len(unique_theaters),
            total_sessions=len(latest_sessions),
            total_sellable_capacity=total_sellable,
            total_available_seats=total_available,
            total_unavailable_seats=total_unavailable,
            total_safety_seats=total_safety,
            total_unknown_seats=total_unknown,
            overall_occupancy_proxy=overall_occupancy_proxy,
            estimated_sold_admissions=total_unavailable,
            estimated_revenue=total_revenue,
            session_count_with_snapshots=len(latest_sessions),
            aggregated_at=datetime.utcnow()
        )
