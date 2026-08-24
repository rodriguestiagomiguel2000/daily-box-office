"""
Calibration Service for Portuguese Cinema Box Office Estimator.
Calibrates default adult ticket prices (P_adult) against actual official box office data
published weekly by ICA (Instituto do Cinema e do Audiovisual).

Computes category discount calibration factors (gamma):
    gamma_movie = ATP_ica / P_adult
    Estimated Revenue = Unoccupied Seats * P_adult * gamma_category
"""

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

from ica_ingestion import (
    ICAMovieRecord,
    match_scraped_title_to_ica,
    normalize_title,
    are_titles_lenient_match,
    calculate_title_similarity
)

log = logging.getLogger("calibration_service")

# Canonical Category Definitions
CATEGORY_FAMILY_ANIMATION = "Family / Animation"
CATEGORY_ACTION_GENERAL = "Action / General"
CATEGORY_DRAMA_ADULT = "Drama / Adult"

# Default Baseline Calibration Factors (Gamma) if no historical ICA match exists
DEFAULT_CALIBRATION_FACTORS: Dict[str, float] = {
    CATEGORY_FAMILY_ANIMATION: 0.80,  # High share of child/family discounts
    CATEGORY_ACTION_GENERAL: 0.90,    # Mixed adult + student/telecom promotions
    CATEGORY_DRAMA_ADULT: 0.93,       # Mostly standard adult pricing
}

DEFAULT_ADULT_PRICE_BASELINE = 7.60
CALIBRATION_CONFIG_FILE = os.path.join(os.path.dirname(__file__), "calibration_factors.json")


# ---------------------------------------------------------------------------
# Movie Category Classification
# ---------------------------------------------------------------------------

FAMILY_KEYWORDS = [
    "animacao", "animada", "animado", "animation", "animated", "infantil",
    "familia", "family", "kids", "disney", "pixar", "dreamworks", "illumination",
    "patrulha pata", "paw patrol", "minions", "minimos", "minimo", "gru", "despicable me", "shrek",
    "toy story", "vaiana", "moana", "kung fu panda", "sonic", "mario", "inside out",
    "divertida", "divertida mente", "divertida-mente", "gato das botas", "puss in boots", "sponge",
    "paddington", "stitch", "lilo", "zootropolis", "zootopia", "frozen", "trolls",
    "madagascar", "ice age", "idade do gelo", "caras", "cars", "nemo", "dory",
    "dino", "dinossauro", "garfield", "barbie", "wonka", "luca", "coco", "encanto"
]

DRAMA_ADULT_KEYWORDS = [
    "drama", "terror", "horror", "thriller", "suspense", "crime", "misterio",
    "romance", "biografia", "biopic", "documentario", "documentary", "historico",
    "guerra", "war", "psicologico", "art house", "indie", "erotico", "adulto"
]


def classify_movie_category(
    movie_title: str,
    genres: Optional[List[str]] = None
) -> str:
    """
    Classifies a movie into a target audience category based on title keywords and genres.
    
    Categories:
    - 'Family / Animation': Higher proportion of child, junior, and family pack tickets (Gamma ~0.80)
    - 'Drama / Adult': Skews towards regular adult admissions (Gamma ~0.93)
    - 'Action / General': General audience blockbusters, action, sci-fi (Gamma ~0.90)
    """
    normalized_title = normalize_title(movie_title)
    normalized_genres = " ".join(normalize_title(g) for g in (genres or []))
    combined_text = f"{normalized_title} {normalized_genres}".lower()

    # 1. Family / Animation check
    for kw in FAMILY_KEYWORDS:
        if kw in combined_text:
            return CATEGORY_FAMILY_ANIMATION

    # 2. Drama / Adult check
    for kw in DRAMA_ADULT_KEYWORDS:
        if kw in combined_text:
            return CATEGORY_DRAMA_ADULT

    # 3. Default to Action / General
    return CATEGORY_ACTION_GENERAL


# ---------------------------------------------------------------------------
# Calibration Service Engine
# ---------------------------------------------------------------------------

@dataclass
class CalibrationState:
    """Persisted state of dynamic calibration factors."""
    category_factors: Dict[str, float] = field(default_factory=lambda: dict(DEFAULT_CALIBRATION_FACTORS))
    movie_specific_factors: Dict[str, float] = field(default_factory=dict)
    sample_counts: Dict[str, int] = field(default_factory=dict)
    last_updated: Optional[str] = None


class CalibrationService:
    """
    Maintains and applies dynamic calibration factors (gamma) per category and movie title.
    """

    _instance: Optional["CalibrationService"] = None

    def __init__(self, config_path: str = CALIBRATION_CONFIG_FILE):
        self.config_path = config_path
        self.state = CalibrationState()
        self.load_factors()

    @classmethod
    def get_instance(cls) -> "CalibrationService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def load_factors(self) -> None:
        """Loads calibrated factors from JSON config file if present, else uses defaults."""
        if os.path.exists(self.config_path) and os.path.getsize(self.config_path) > 0:
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.state.category_factors = {
                    **DEFAULT_CALIBRATION_FACTORS,
                    **data.get("category_factors", {})
                }
                self.state.movie_specific_factors = data.get("movie_specific_factors", {})
                self.state.sample_counts = data.get("sample_counts", {})
                self.state.last_updated = data.get("last_updated")
                log.info(f"Loaded calibration factors from {self.config_path}: {self.state.category_factors}")
                return
            except Exception as e:
                log.warning(f"Failed to load calibration config from {self.config_path}, using defaults: {e}")

        self.state.category_factors = dict(DEFAULT_CALIBRATION_FACTORS)

    def save_factors(self) -> None:
        """Saves active calibration state to JSON configuration."""
        try:
            from datetime import datetime
            data = {
                "category_factors": self.state.category_factors,
                "movie_specific_factors": self.state.movie_specific_factors,
                "sample_counts": self.state.sample_counts,
                "last_updated": datetime.utcnow().isoformat()
            }
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            log.info(f"Successfully saved calibration factors to {self.config_path}")
        except Exception as e:
            log.error(f"Failed to save calibration factors to {self.config_path}: {e}")

    def update_from_ica(
        self,
        ica_records: List[ICAMovieRecord],
        movie_baseline_prices: Optional[Union[Dict[str, float], Dict[str, Any]]] = None,
        default_adult_price: float = DEFAULT_ADULT_PRICE_BASELINE,
        min_category_samples: int = 3,
        min_admissions_floor: int = 500,
        ema_alpha: float = 0.70
    ) -> Dict[str, float]:
        """
        Updates dynamic calibration multipliers (gamma) using official ICA records.
        
        Supports dual-period observations per movie (weekly and weekend):
        - Matches weekly ICA records against weekly resolved reference prices.
        - Matches weekend ICA records against weekend resolved reference prices (Thu-Sun sessions).
        - Applies sequential EMA updates per movie (weekly first, then weekend on top of the updated value).
        - Counts each qualifying observation toward category sample count guards.
        """
        if not ica_records:
            return self.state.category_factors

        category_totals: Dict[str, float] = {cat: 0.0 for cat in DEFAULT_CALIBRATION_FACTORS}
        category_weights: Dict[str, float] = {cat: 0.0 for cat in DEFAULT_CALIBRATION_FACTORS}
        category_counts: Dict[str, int] = {cat: 0 for cat in DEFAULT_CALIBRATION_FACTORS}

        # Extract normalized weekly and weekend reference price maps
        weekly_prices: Dict[str, float] = {}
        weekend_prices: Dict[str, float] = {}

        if movie_baseline_prices:
            if isinstance(movie_baseline_prices, dict) and ("weekly" in movie_baseline_prices or "weekend" in movie_baseline_prices):
                raw_weekly = movie_baseline_prices.get("weekly", {})
                raw_weekend = movie_baseline_prices.get("weekend", {})
                if isinstance(raw_weekly, dict):
                    for k, v in raw_weekly.items():
                        if v is not None and float(v) > 0:
                            weekly_prices[normalize_title(str(k))] = float(v)
                if isinstance(raw_weekend, dict):
                    for k, v in raw_weekend.items():
                        if v is not None and float(v) > 0:
                            weekend_prices[normalize_title(str(k))] = float(v)
            elif isinstance(movie_baseline_prices, dict):
                # Flat map passed - use for both
                for k, v in movie_baseline_prices.items():
                    if v is not None and isinstance(v, (int, float, str)):
                        try:
                            fv = float(v)
                            if fv > 0:
                                norm_k = normalize_title(str(k))
                                weekly_prices[norm_k] = fv
                                weekend_prices[norm_k] = fv
                        except (ValueError, TypeError):
                            continue

        def lookup_ref_price(norm_t: str, p_type: str) -> float:
            target_map = weekend_prices if p_type == "weekend" else weekly_prices
            fallback_map = weekly_prices if p_type == "weekend" else weekend_prices

            # 1. Exact match in target map
            if target_map and norm_t in target_map:
                return target_map[norm_t]

            # 2. Substring match in target map
            if target_map:
                for k, v in target_map.items():
                    if k and (k in norm_t or norm_t in k):
                        return v

            # 3. Lenient fuzzy / stopword-relaxed match in target map
            if target_map:
                best_k: Optional[str] = None
                best_sim: float = 0.0
                for k in target_map:
                    sim = calculate_title_similarity(norm_t, k)
                    if sim > best_sim:
                        best_sim = sim
                        best_k = k
                if best_k and best_sim >= 0.70:
                    return target_map[best_k]

            # 4. Fallback map (exact, substring, then lenient)
            if fallback_map and norm_t in fallback_map:
                return fallback_map[norm_t]
            if fallback_map:
                for k, v in fallback_map.items():
                    if k and (k in norm_t or norm_t in k):
                        return v
                best_k = None
                best_sim = 0.0
                for k in fallback_map:
                    sim = calculate_title_similarity(norm_t, k)
                    if sim > best_sim:
                        best_sim = sim
                        best_k = k
                if best_k and best_sim >= 0.70:
                    return fallback_map[best_k]

            return default_adult_price

        # Active movie factors initialized from stored state
        movie_factors: Dict[str, float] = dict(self.state.movie_specific_factors)

        def process_record(rec: ICAMovieRecord, p_type: str):
            if rec.atp <= 0 or rec.weekly_admissions <= 0:
                return

            norm_t = normalize_title(rec.title)
            ref_price = lookup_ref_price(norm_t, p_type)

            # Observed movie gamma for this period report
            gamma_obs = round(rec.atp / ref_price, 3) if ref_price > 0 else 1.0
            # Clip reasonable bounds [0.50, 1.30] to prevent extreme anomalies
            gamma_obs = max(0.50, min(1.30, gamma_obs))

            # Exponential Moving Average with existing stored factor if present
            if norm_t in movie_factors:
                prev_gamma = movie_factors[norm_t]
                gamma_m = round(ema_alpha * gamma_obs + (1.0 - ema_alpha) * prev_gamma, 3)
            else:
                gamma_m = gamma_obs

            gamma_m = max(0.50, min(1.30, gamma_m))
            movie_factors[norm_t] = gamma_m

            # Category aggregation guard: each qualifying observation (weekly and weekend) counts separately
            cat = classify_movie_category(rec.title)
            if rec.weekly_admissions >= min_admissions_floor:
                weight = float(rec.weekly_admissions)
                category_totals[cat] += gamma_m * weight
                category_weights[cat] += weight
                category_counts[cat] += 1

        # Separate records into weekly and weekend groups for sequential processing
        weekly_records = [r for r in ica_records if getattr(r, "period_type", "weekly") != "weekend"]
        weekend_records = [r for r in ica_records if getattr(r, "period_type", "weekly") == "weekend"]

        # Step 1: Process weekly records first
        for rec in weekly_records:
            process_record(rec, "weekly")

        # Step 2: Process weekend records sequentially on top
        for rec in weekend_records:
            process_record(rec, "weekend")

        # Compute category averages with minimum sample count guard
        new_category_factors: Dict[str, float] = {}
        for cat, default_gamma in DEFAULT_CALIBRATION_FACTORS.items():
            count = category_counts[cat]
            if count >= min_category_samples and category_weights[cat] > 0:
                weighted_gamma = round(category_totals[cat] / category_weights[cat], 3)
                # Blend 70% empirical with 30% baseline for smooth stability
                blended = round(0.70 * weighted_gamma + 0.30 * default_gamma, 3)
                new_category_factors[cat] = blended
            else:
                # Retain existing factor or default if insufficient samples (< min_category_samples)
                new_category_factors[cat] = self.state.category_factors.get(cat, default_gamma)

        self.state.category_factors = new_category_factors
        self.state.movie_specific_factors = movie_factors
        self.state.sample_counts = category_counts
        self.save_factors()

        log.info(f"Updated dynamic calibration factors from ICA: {self.state.category_factors} (samples: {category_counts})")
        return self.state.category_factors

    def get_calibration_factor(
        self,
        category: Optional[str] = None,
        movie_title: Optional[str] = None,
        genres: Optional[List[str]] = None
    ) -> float:
        """
        Retrieves the calibration factor (gamma) for a given category or movie title.
        
        Priority:
        1. Explicit category factor if provided
        2. Direct movie-specific historical gamma if title matches an ICA historical record
        3. Category factor derived from classifying the movie title / genres
        4. Default category baseline fallback
        """
        if category and category in self.state.category_factors:
            return self.state.category_factors[category]

        if movie_title:
            norm_t = normalize_title(movie_title)
            # 1. Check direct movie-specific match
            if norm_t in self.state.movie_specific_factors:
                return self.state.movie_specific_factors[norm_t]

            # 2. Substring match against known movie factors
            for known_norm, factor in self.state.movie_specific_factors.items():
                if norm_t == known_norm or norm_t in known_norm or known_norm in norm_t:
                    return factor

            # 3. Lenient / stopword-relaxed similarity match against known movie factors
            best_known: Optional[str] = None
            best_sim: float = 0.0
            for known_norm in self.state.movie_specific_factors:
                sim = calculate_title_similarity(norm_t, known_norm)
                if sim > best_sim:
                    best_sim = sim
                    best_known = known_norm

            if best_known and best_sim >= 0.70:
                return self.state.movie_specific_factors[best_known]

            # 4. Classify by title and genres
            classified_cat = classify_movie_category(movie_title, genres)
            return self.state.category_factors.get(classified_cat, DEFAULT_CALIBRATION_FACTORS[classified_cat])

        return DEFAULT_CALIBRATION_FACTORS[CATEGORY_ACTION_GENERAL]


# Module level convenience functions
def get_calibration_factor(
    category: Optional[str] = None,
    movie_title: Optional[str] = None,
    genres: Optional[List[str]] = None
) -> float:
    return CalibrationService.get_instance().get_calibration_factor(category, movie_title, genres)
