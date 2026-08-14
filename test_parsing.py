from datetime import datetime, timezone
from nos_collector_job import parse_portugal_session_time

def test_parse_portugal_session_time():
    # Test case 1: "2026-08-21+01:00", "20:10"
    op_date_str = "2026-08-21+01:00"
    time_str = "20:10"
    result = parse_portugal_session_time(op_date_str, time_str)
    expected = datetime(2026, 8, 21, 19, 10, tzinfo=timezone.utc)
    assert result == expected, f"Expected {expected}, got {result}"

    # Test case 2: "2026-08-13T00:00:00", "21:30"
    op_date_str = "2026-08-13T00:00:00"
    time_str = "21:30"
    result = parse_portugal_session_time(op_date_str, time_str)
    expected = datetime(2026, 8, 13, 20, 30, tzinfo=timezone.utc)
    assert result == expected, f"Expected {expected}, got {result}"
    print("Tests passed!")

if __name__ == "__main__":
    try:
        test_parse_portugal_session_time()
    except Exception as e:
        print(f"Test failed: {e}")
