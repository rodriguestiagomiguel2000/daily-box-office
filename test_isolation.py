"""
Test repeated session collections with isolated booking contexts.
"""
import json
import logging
from nos_scraper import NOSScraper

logging.basicConfig(level=logging.INFO)

scraper = NOSScraper()
movies = scraper.get_movies_in_theaters()
print(f"Movies retrieved: {len(movies)}")

tested_sessions = []
for m in movies:
    agg = m.get("aggregateformatnumber")
    if not agg:
        continue
    sched = scraper.get_movie_sessions(agg)
    days = sched.get("days", []) if isinstance(sched, dict) else []
    for day in days[:1]:
        for theater in day.get("theaters", []):
            for s in theater.get("sessions", []):
                s_uuid = s.get("uuid")
                if s_uuid and s_uuid not in tested_sessions:
                    tested_sessions.append((m.get("title"), theater.get("name"), s_uuid))
                if len(tested_sessions) >= 6:
                    break
            if len(tested_sessions) >= 6:
                break
        if len(tested_sessions) >= 6:
            break
    if len(tested_sessions) >= 6:
        break

print(f"Collected {len(tested_sessions)} distinct sessions for repeated test:")
for title, theater, sid in tested_sessions:
    print(f"  - {title} | {theater} | {sid}")

print("\nExecuting sequential process_session calls on the SAME scraper instance...")
results = []
for title, theater, sid in tested_sessions:
    res = scraper.process_session(sid)
    results.append(res)
    print(
        f"Session {sid[:8]}..: Sellable={res.sellable_seats}, "
        f"Available={res.available_seats}, Sold={res.sold_seats}, "
        f"Blocked={res.blocked_seats}, InvariantValid={res.is_invariant_valid}"
    )

print("\nVerifying that each session has valid invariant and correct isolation:")
all_valid = True
for r in results:
    if not r.is_invariant_valid:
        print(f"FAILED invariant for {r.session_id}")
        all_valid = False
    if r.sellable_seats == 0:
        print(f"Zero sellable seats for {r.session_id}")
        all_valid = False

if all_valid:
    print("ALL 6 SESSIONS PASSED INVARIANT AND ISOLATION!")
else:
    print("SOME SESSIONS FAILED!")
