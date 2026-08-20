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

from ica_ingestion import ICAMovieRecord, match_scraped_title_to_ica, normalize_title

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
        default_adult_price: float = DEFAULT_ADULT_PRICE_BASELINE
    ) -> Dict[str, float]:
        """
        Updates dynamic calibration multipliers (gamma) using official ICA records.
        
        Calculates:
            gamma_movie = ATP_ica / P_adult
            gamma_category = weighted_average(gamma_movie across movies in category)
        """
        if not ica_records:
            return self.state.category_factors

        category_totals: Dict[str, float] = {cat: 0.0 for cat in DEFAULT_CALIBRATION_FACTORS}
        category_weights: Dict[str, float] = {cat: 0.0 for cat in DEFAULT_CALIBRATION_FACTORS}
        category_counts: Dict[str, int] = {cat: 0 for cat in DEFAULT_CALIBRATION_FACTORS}

        movie_factors: Dict[str, float] = {}

        for rec in ica_records:
            if rec.atp <= 0 or rec.weekly_admissions <= 0:
                continue

            # Movie specific gamma
            gamma_m = round(rec.atp / default_adult_price, 3)
            # Clip reasonable bounds [0.50, 1.30] to prevent extreme anomalies
            gamma_m = max(0.50, min(1.30, gamma_m))
            movie_factors[normalize_title(rec.title)] = gamma_m

            # Classify movie
            cat = classify_movie_category(rec.title)
            weight = rec.weekly_admissions
            category_totals[cat] += gamma_m * weight
            category_weights[cat] += weight
            category_counts[cat] += 1

        # Compute category averages
        new_category_factors: Dict[str, float] = {}
        for cat, default_gamma in DEFAULT_CALIBRATION_FACTORS.items():
            if category_weights[cat] > 0:
                weighted_gamma = round(category_totals[cat] / category_weights[cat], 3)
                # Blend 70% empirical with 30% baseline for smooth stability
                blended = round(0.70 * weighted_gamma + 0.30 * default_gamma, 3)
                new_category_factors[cat] = blended
            else:
                new_category_factors[cat] = default_gamma

        self.state.category_factors = new_category_factors
        self.state.movie_specific_factors = movie_factors
        self.state.sample_counts = category_counts
        self.save_factors()

        log.info(f"Updated dynamic calibration factors from ICA: {self.state.category_factors}")
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
            # Check direct movie-specific match
            if norm_t in self.state.movie_specific_factors:
                return self.state.movie_specific_factors[norm_t]

            # Fuzzy match against known movie factors
            for known_norm, factor in self.state.movie_specific_factors.items():
                if norm_t == known_norm or norm_t in known_norm or known_norm in norm_t:
                    return factor

            # Classify by title and genres
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
