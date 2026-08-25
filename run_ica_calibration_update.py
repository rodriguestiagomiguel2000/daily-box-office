#!/usr/bin/env python3
"""
CLI Script: Run ICA Calibration Update Pipeline.

Responsibilities:
1. Calls ingest_ica_with_raw_log() to download & parse the latest official ICA box office report.
2. Accepts per-movie resolved unit prices from Postgres (via CLI argument or stdin) so gamma is calibrated
   against each movie's actual admissions-weighted standard ticket price.
3. Updates CalibrationService with EMA accumulation, [0.50, 1.30] clipping, and category sample guards.
4. Outputs a structured JSON summary to stdout for server/api.ts consumption and Postgres persistence.
"""

import argparse
from datetime import datetime, timezone
import json
import os
import sys
from typing import Any, Dict, List, Optional

from ica_ingestion import (
    ICAMovieRecord,
    ingest_ica_data,
    ingest_ica_with_raw_log,
    normalize_title,
    calculate_title_similarity,
    are_titles_lenient_match,
    extract_title_tokens
)
from calibration_service import (
    CalibrationService,
    classify_movie_category,
    DEFAULT_CALIBRATION_FACTORS,
    DEFAULT_ADULT_PRICE_BASELINE
)


def parse_args():
    parser = argparse.ArgumentParser(description="Run ICA Calibration Update Pipeline")
    parser.add_argument(
        "--prices-json",
        type=str,
        default=None,
        help="JSON string or file path containing per-movie resolved prices mapping"
    )
    parser.add_argument(
        "--default-price",
        type=float,
        default=DEFAULT_ADULT_PRICE_BASELINE,
        help="Fallback reference price baseline when movie is not in database (default: 7.60)"
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=3,
        help="Minimum qualifying sample count before updating category factor (default: 3)"
    )
    parser.add_argument(
        "--min-admissions",
        type=int,
        default=500,
        help="Admissions floor for a movie to count toward category calibration (default: 500)"
    )
    parser.add_argument(
        "--ema-alpha",
        type=float,
        default=0.70,
        help="Exponential moving average weight for current week vs history (default: 0.70)"
    )
    parser.add_argument(
        "--weekly-only",
        action="store_true",
        help="Filter ICA records to weekly (non-weekend) reports only"
    )
    parser.add_argument(
        "--reset-first",
        action="store_true",
        help="Reset stored calibration factors state to baseline defaults before processing"
    )
    return parser.parse_args()


def load_movie_prices(prices_arg: Optional[str]) -> Dict[str, Any]:
    """Loads movie baseline prices from CLI argument or stdin, supporting period-keyed or flat mappings."""
    prices: Dict[str, Any] = {}
    raw_text = None

    if prices_arg:
        if prices_arg == "-":
            try:
                raw_text = sys.stdin.read().strip()
            except Exception:
                pass
        elif os.path.exists(prices_arg):
            try:
                with open(prices_arg, "r", encoding="utf-8") as f:
                    raw_text = f.read()
            except Exception as e:
                print(f"[run_ica_calibration] Failed to read prices file {prices_arg}: {e}", file=sys.stderr)
        else:
            raw_text = prices_arg
    else:
        # Check non-blocking if stdin has data ready
        try:
            import select
            if not sys.stdin.isatty() and select.select([sys.stdin], [], [], 0.0)[0]:
                raw_text = sys.stdin.read().strip()
        except Exception:
            pass

    if raw_text:
        try:
            parsed = json.loads(raw_text)
            if isinstance(parsed, dict):
                # Handle direct dict or wrapped in { "movie_prices": { ... } }
                movie_dict = parsed.get("movie_prices", parsed)
                if isinstance(movie_dict, dict):
                    if "weekly" in movie_dict or "weekend" in movie_dict:
                        prices["weekly"] = {str(k): float(v) for k, v in movie_dict.get("weekly", {}).items() if v is not None and float(v) > 0}
                        prices["weekend"] = {str(k): float(v) for k, v in movie_dict.get("weekend", {}).items() if v is not None and float(v) > 0}
                    else:
                        for k, v in movie_dict.items():
                            try:
                                prices[str(k)] = float(v)
                            except (ValueError, TypeError):
                                continue
                elif isinstance(movie_dict, list):
                    # Handle array of { "title": ..., "resolved_unit_price": ... }
                    for item in movie_dict:
                        if isinstance(item, dict):
                            t = item.get("title") or item.get("normalized_title") or str(item.get("movie_id"))
                            p = item.get("resolved_unit_price") or item.get("unit_price") or item.get("price")
                            if t and p:
                                prices[str(t)] = float(p)
        except Exception as e:
            print(f"[run_ica_calibration] Could not parse prices JSON: {e}", file=sys.stderr)

    return prices


def main():
    args = parse_args()
    movie_prices = load_movie_prices(args.prices_json)

    # 1. Ingest fresh ICA data (with raw log output for dashboard auditing)
    try:
        raw_log = ingest_ica_with_raw_log()
    except Exception as e:
        print(f"[run_ica_calibration] Error during ICA ingestion: {e}", file=sys.stderr)
        raw_log = {
            "id": f"ica-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "source": "ICA",
            "collectedAt": datetime.now(timezone.utc).isoformat(),
            "fileName": "ica_ranking_box_office_semanal.xlsx",
            "recordCount": 0,
            "status": "FAILED",
            "rawDetails": {"error": str(e)}
        }

    # Extract parsed ICAMovieRecord items
    records: List[ICAMovieRecord] = []
    raw_movies = raw_log.get("rawDetails", {}).get("movies", [])
    for rm in raw_movies:
        records.append(ICAMovieRecord(
            rank=rm.get("rank", 0),
            title=rm.get("title", ""),
            normalized_title=rm.get("normalized_title", normalize_title(rm.get("title", ""))),
            distributor=rm.get("distributor", ""),
            director=rm.get("director", ""),
            weekly_gross_revenue=float(rm.get("weekly_gross_revenue", 0.0)),
            weekly_admissions=int(rm.get("weekly_admissions", 0)),
            weekly_screens=int(rm.get("weekly_screens", 0)),
            accumulated_gross_revenue=float(rm.get("accumulated_gross_revenue", 0.0)),
            accumulated_admissions=int(rm.get("accumulated_admissions", 0)),
            days_in_release=int(rm.get("days_in_release", 0)),
            period_label=rm.get("period_label", ""),
            period_type=rm.get("period_type", "weekly"),
            atp=float(rm.get("atp", 0.0))
        ))

    if not records:
        records = ingest_ica_data()

    if args.weekly_only:
        records = [r for r in records if getattr(r, "period_type", "weekly") != "weekend"]
        print(f"[run_ica_calibration] Filtered to {len(records)} weekly records.", file=sys.stderr)

    # 2. Update Calibration Service
    cal_service = CalibrationService.get_instance()
    if args.reset_first:
        cal_service.state.movie_specific_factors = {}
        cal_service.state.category_factors = dict(DEFAULT_CALIBRATION_FACTORS)
        cal_service.state.sample_counts = {}
        cal_service.save_factors()
        print("[run_ica_calibration] Reset calibration state to baseline defaults.", file=sys.stderr)

    updated_categories = cal_service.update_from_ica(
        ica_records=records,
        movie_baseline_prices=movie_prices,
        default_adult_price=args.default_price,
        min_category_samples=args.min_samples,
        min_admissions_floor=args.min_admissions,
        ema_alpha=args.ema_alpha
    )

    # 3. Build detailed report of all updated movies
    movies_updated: List[Dict[str, Any]] = []

    def get_norm_map(p_map: Dict[str, Any]) -> Dict[str, float]:
        if not isinstance(p_map, dict):
            return {}
        return {normalize_title(k): float(v) for k, v in p_map.items() if v is not None and float(v) > 0}

    if "weekly" in movie_prices or "weekend" in movie_prices:
        weekly_norm = get_norm_map(movie_prices.get("weekly", {}))
        weekend_norm = get_norm_map(movie_prices.get("weekend", {}))
    else:
        flat_norm = get_norm_map(movie_prices)
        weekly_norm = flat_norm
        weekend_norm = flat_norm

    for rec in records:
        norm_t = normalize_title(rec.title)
        p_type = getattr(rec, "period_type", "weekly")
        active_norm = weekend_norm if p_type == "weekend" else weekly_norm
        fallback_norm = weekly_norm if p_type == "weekend" else weekend_norm

        ref_price = None
        if norm_t in active_norm:
            ref_price = active_norm[norm_t]
        else:
            core_t = " ".join(extract_title_tokens(norm_t, strip_stopwords=True))
            matched_price = None
            if core_t:
                for bp_k, bp_v in active_norm.items():
                    if " ".join(extract_title_tokens(bp_k, strip_stopwords=True)) == core_t:
                        matched_price = bp_v
                        break
            if matched_price is not None:
                ref_price = matched_price
            else:
                for bp_k, bp_v in active_norm.items():
                    if bp_k and (bp_k in norm_t or norm_t in bp_k):
                        ref_price = bp_v
                        break
                else:
                    # Lenient fuzzy / stopword-relaxed matching in active map
                    best_k: Optional[str] = None
                    best_sim: float = 0.0
                    for bp_k in active_norm:
                        sim = calculate_title_similarity(norm_t, bp_k)
                        if sim > best_sim:
                            best_sim = sim
                            best_k = bp_k
                    if best_k and best_sim >= 0.70:
                        ref_price = active_norm[best_k]
                    elif norm_t in fallback_norm:
                        ref_price = fallback_norm[norm_t]
                    else:
                        if core_t:
                            for bp_k, bp_v in fallback_norm.items():
                                if " ".join(extract_title_tokens(bp_k, strip_stopwords=True)) == core_t:
                                    matched_price = bp_v
                                    break
                        if matched_price is not None:
                            ref_price = matched_price
                        else:
                            for bp_k, bp_v in fallback_norm.items():
                                if bp_k and (bp_k in norm_t or norm_t in bp_k):
                                    ref_price = bp_v
                                    break
                            else:
                                best_k = None
                                best_sim = 0.0
                                for bp_k in fallback_norm:
                                    sim = calculate_title_similarity(norm_t, bp_k)
                                    if sim > best_sim:
                                        best_sim = sim
                                        best_k = bp_k
                                if best_k and best_sim >= 0.70:
                                    ref_price = fallback_norm[best_k]

        cat = classify_movie_category(rec.title)
        if ref_price is not None and ref_price > 0:
            gamma_obs = round(rec.atp / ref_price, 3)
            gamma_obs = max(0.50, min(1.30, gamma_obs))
            qualifies = rec.weekly_admissions >= args.min_admissions
        else:
            gamma_obs = None
            qualifies = False

        # Lookup gamma final with lenient fallback
        gamma_final = cal_service.state.movie_specific_factors.get(norm_t)
        if gamma_final is None:
            for k_factor, v_factor in cal_service.state.movie_specific_factors.items():
                if are_titles_lenient_match(norm_t, k_factor):
                    gamma_final = v_factor
                    break
            else:
                gamma_final = gamma_obs

        movies_updated.append({
            "rank": rec.rank,
            "title": rec.title,
            "normalized_title": norm_t,
            "category": cat,
            "period_type": p_type,
            "atp": rec.atp,
            "resolved_reference_price": ref_price,
            "gamma_observed": gamma_obs,
            "gamma_final": gamma_final,
            "weekly_admissions": rec.weekly_admissions,
            "weekly_gross_revenue": rec.weekly_gross_revenue,
            "qualifies_for_category_sample": qualifies
        })

    result_payload = {
        "success": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "category_factors": cal_service.state.category_factors,
        "sample_counts": cal_service.state.sample_counts,
        "movie_factors": cal_service.state.movie_specific_factors,
        "movies_updated": movies_updated,
        "total_records_processed": len(records),
        "raw_log": raw_log
    }

    print(json.dumps(result_payload, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
