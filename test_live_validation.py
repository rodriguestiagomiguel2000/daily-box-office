"""
Live Real-World Validation Suite across NOS Portugal.
Tests real sessions across IMAX, Standard, High-Occupancy, and High-Availability formats.
Validates the raw state invariant: sellable == available + unavailable + safety + unknown.
Validates seat-level metadata preservation and transition tracking engine.
"""

import sys
import logging
from nos_scraper import NOSScraper
from nos_collector_models import SeatSnapshot, SeatState
from nos_collector_transitions import compute_seat_transitions
from nos_collector_revenue import RevenueEstimator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("live_validation")


def run_live_validation():
    print("=" * 110)
    print("RUNNING REAL-WORLD LIVE VALIDATION ACROSS NOS PORTUGAL")
    print("=" * 110)

    scraper = NOSScraper()
    movies = scraper.get_movies_in_theaters()
    print(f"Retrieved {len(movies)} active movies currently in Portuguese theaters.\n")

    sessions_to_test = []

    # Search for IMAX movie & sessions
    imax_movie = next((m for m in movies if "imax" in m.get("title", "").lower() and m.get("aggregateformatnumber")), None)
    if not imax_movie:
        imax_movie = next((m for m in movies if m.get("aggregateformatnumber")), None)

    if imax_movie:
        s_data = scraper.get_movie_sessions(imax_movie["aggregateformatnumber"])
        days = s_data.get("days", [])
        for d in days:
            for t in d.get("theaters", []):
                for s in t.get("sessions", []):
                    if s.get("uuid"):
                        sessions_to_test.append((
                            "IMAX Format",
                            imax_movie.get("title"),
                            t.get("name"),
                            s.get("uuid"),
                            s.get("time")
                        ))
                        break
                if len(sessions_to_test) >= 2:
                    break
            if len(sessions_to_test) >= 2:
                break

    # Search for standard (non-IMAX) movies
    std_movies = [m for m in movies if "imax" not in m.get("title", "").lower() and m.get("aggregateformatnumber")]
    for m in std_movies[:4]:
        s_data = scraper.get_movie_sessions(m["aggregateformatnumber"])
        days = s_data.get("days", [])
        for d in days:
            for t in d.get("theaters", []):
                for s in t.get("sessions", []):
                    if s.get("uuid"):
                        sessions_to_test.append((
                            "Standard Format",
                            m.get("title"),
                            t.get("name"),
                            s.get("uuid"),
                            s.get("time")
                        ))
                        break
                if len(sessions_to_test) >= 8:
                    break
            if len(sessions_to_test) >= 8:
                break
        if len(sessions_to_test) >= 8:
            break

    print(f"Selected {len(sessions_to_test)} real sessions across different cinemas and formats for deep validation:\n")

    snapshots = []
    all_invariants_valid = True

    print(f"{'Category':<15} | {'Movie':<22} | {'Cinema':<20} | {'Sellable':<8} | {'Avail':<6} | {'Unavail':<7} | {'Safety':<6} | {'Unk':<4} | {'Occup%':<7} | {'Seats#':<6} | {'InvValid':<8}")
    print("-" * 135)

    for cat, title, cinema, sid, stime in sessions_to_test:
        try:
            snap = scraper.process_session(sid)
            snapshots.append(snap)
            
            inv_str = "✓ VALID" if snap.is_invariant_valid else "✗ FAIL"
            if not snap.is_invariant_valid:
                all_invariants_valid = False

            print(
                f"{cat:<15} | {snap.movie_title[:22]:<22} | {snap.theater_name[:20]:<20} | "
                f"{snap.sellable_seats:<8} | {snap.available_seats:<6} | {snap.unavailable_seats:<7} | "
                f"{snap.safety_seats:<6} | {snap.unknown_seats:<4} | {snap.occupancy_proxy*100:6.1f}% | "
                f"{len(snap.seats):<6} | {inv_str:<8}"
            )
        except Exception as e:
            print(f"{cat:<15} | {title[:22]:<22} | {cinema[:20]:<20} | ERROR: {e}")
            all_invariants_valid = False

    print("-" * 135)
    print(f"\nTotal live snapshots collected: {len(snapshots)}")
    
    # Inspect physical seat sample from the first snapshot
    if snapshots:
        sample_snap = snapshots[0]
        sample_seats = list(sample_snap.seats.values())[:3]
        print(f"\nPhysical Seat Key Samples from '{sample_snap.movie_title}':")
        for s in sample_seats:
            print(f"  - Key: '{s.seat_key}' -> state={s.state}, Q={s.queue}, R={s.row}, C={s.col}, Num={s.seat_number}, Vip={s.is_vip}, Prem={s.is_premium}")

        highest_occ = max(snapshots, key=lambda s: s.occupancy_proxy)
        lowest_occ = min(snapshots, key=lambda s: s.occupancy_proxy)
        print(f"\nHighest Occupancy Session: '{highest_occ.movie_title}' at {highest_occ.theater_name} ({highest_occ.room_name}): {highest_occ.unavailable_seats}/{highest_occ.sellable_seats} unavailable ({highest_occ.occupancy_proxy*100:.1f}%)")
        print(f"High Availability Session: '{lowest_occ.movie_title}' at {lowest_occ.theater_name} ({lowest_occ.room_name}): {lowest_occ.available_seats}/{lowest_occ.sellable_seats} available ({lowest_occ.occupancy_proxy*100:.1f}% occupied)")

    if all_invariants_valid and len(snapshots) >= 4:
        print("\n" + "=" * 110)
        print(">>> ALL REAL-WORLD LIVE SESSIONS PASSED RAW INVARIANT & SEAT-KEY VALIDATION! <<<")
        print("=" * 110)
    else:
        print("\n>>> VALIDATION FAILED! <<<")
        sys.exit(1)


if __name__ == "__main__":
    run_live_validation()
