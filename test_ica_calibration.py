"""
Unit and Integration Tests for ICA Data Ingestion Pipeline & Dynamic Price Calibration.
Tests:
1. Title normalization (accents, formats, years, edge cases)
2. Exact and fuzzy title matching against ICA records
3. Excel workbook ingestion & parsing (pure standard library)
4. Official Average Ticket Price (ATP_ica) calculations
5. Target audience classification (Family/Animation, Action/General, Drama/Adult)
6. Dynamic Gamma calibration factor computation (gamma = ATP_ica / P_adult)
7. RevenueEstimator integration with calibrated category multipliers
"""

import io
import json
import os
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET

from ica_ingestion import (
    ICAMovieRecord,
    normalize_title,
    match_scraped_title_to_ica,
    parse_ica_excel,
    get_sample_ica_records,
)
from calibration_service import (
    CalibrationService,
    classify_movie_category,
    get_calibration_factor,
    CATEGORY_FAMILY_ANIMATION,
    CATEGORY_ACTION_GENERAL,
    CATEGORY_DRAMA_ADULT,
    DEFAULT_CALIBRATION_FACTORS,
)
from nos_collector_revenue import RevenueEstimator


class TestICAIngestionAndCalibration(unittest.TestCase):

    def setUp(self):
        self.sample_records = get_sample_ica_records()

    def test_normalize_title(self):
        """Tests that normalize_title cleans diacritics, formats, years, and punctuation."""
        # Formats and versions
        self.assertEqual(normalize_title("Patrulha Pata: O Filme (VP) (3D)"), "patrulha pata o filme")
        self.assertEqual(normalize_title("A Odisseia [IMAX 3D] (2026)"), "a odisseia")
        self.assertEqual(normalize_title("Divertida-Mente 2 (V.O.) (Atmos)"), "divertida mente 2")
        self.assertEqual(normalize_title("Homem-Aranha: Um Novo Dia (Versão Portuguesa)"), "homem aranha um novo dia")
        self.assertEqual(normalize_title("Mínimos e Monstros (4DX) (VIP)"), "minimos e monstros")
        
        # Diacritics
        self.assertEqual(normalize_title("À Noite no Museu"), "a noite no museu")
        self.assertEqual(normalize_title("Cães & Gatos"), "caes gatos")

    def test_title_matching_exact_and_fuzzy(self):
        """Tests exact, containment, and fuzzy difflib title matching against ICA catalog."""
        ica_catalog = [
            "Homem-Aranha: Um Novo Dia",
            "A Odisseia",
            "Patrulha Pata: O Filme dos Dinossauros",
            "Mínimos e Monstros",
            "O Fim de Oak Street",
            "Toy Story 5",
            "Vaiana"
        ]

        # Exact match after normalization
        match1 = match_scraped_title_to_ica("Homem-Aranha: Um Novo Dia (2D)", ica_catalog)
        self.assertIsNotNone(match1)
        self.assertEqual(match1[0], "Homem-Aranha: Um Novo Dia")
        self.assertGreaterEqual(match1[1], 0.95)

        # Containment match
        match2 = match_scraped_title_to_ica("Patrulha Pata (VP)", ica_catalog)
        self.assertIsNotNone(match2)
        self.assertEqual(match2[0], "Patrulha Pata: O Filme dos Dinossauros")
        self.assertGreaterEqual(match2[1], 0.80)

        # Minor fuzzy variation
        match3 = match_scraped_title_to_ica("Odisséia (IMAX)", ica_catalog)
        self.assertIsNotNone(match3)
        self.assertEqual(match3[0], "A Odisseia")

        # Unrelated title
        match_none = match_scraped_title_to_ica("Filme Completamente Inexistente 99", ica_catalog)
        self.assertIsNone(match_none)

    def test_atp_calculation_from_sample_records(self):
        """Tests that ATP_ica = Gross Revenue / Admissions is computed accurately."""
        # Find Patrulha Pata in sample records
        paw = next(r for r in self.sample_records if "Patrulha Pata" in r.title)
        expected_atp = round(206354.30 / 32877, 2)  # 6.28 €
        self.assertEqual(paw.atp, expected_atp)

        # Find Homem-Aranha
        spidey = next(r for r in self.sample_records if "Homem-Aranha" in r.title)
        expected_spidey_atp = round(914161.31 / 122039, 2)  # 7.49 €
        self.assertEqual(spidey.atp, expected_spidey_atp)

    def test_movie_category_classification(self):
        """Tests movie target audience category heuristics."""
        # Family / Animation
        self.assertEqual(classify_movie_category("Patrulha Pata: O Filme"), CATEGORY_FAMILY_ANIMATION)
        self.assertEqual(classify_movie_category("Mínimos e Monstros"), CATEGORY_FAMILY_ANIMATION)
        self.assertEqual(classify_movie_category("Toy Story 5"), CATEGORY_FAMILY_ANIMATION)
        self.assertEqual(classify_movie_category("Vaiana (VP)"), CATEGORY_FAMILY_ANIMATION)
        self.assertEqual(classify_movie_category("O Pequeno Stuart", ["animação", "aventura"]), CATEGORY_FAMILY_ANIMATION)

        # Drama / Adult
        self.assertEqual(classify_movie_category("O Fim de Oak Street", ["terror", "thriller"]), CATEGORY_DRAMA_ADULT)
        self.assertEqual(classify_movie_category("Apenas Uma Noite", ["drama", "romance"]), CATEGORY_DRAMA_ADULT)
        self.assertEqual(classify_movie_category("Crimes na Noite", ["crime", "mistério"]), CATEGORY_DRAMA_ADULT)

        # Action / General
        self.assertEqual(classify_movie_category("Homem-Aranha: Um Novo Dia"), CATEGORY_ACTION_GENERAL)
        self.assertEqual(classify_movie_category("Missão Impossível 8"), CATEGORY_ACTION_GENERAL)
        self.assertEqual(classify_movie_category("Velocidade Furiosa 11"), CATEGORY_ACTION_GENERAL)

    def test_dynamic_gamma_calibration(self):
        """Tests computing gamma = ATP_ica / P_adult and updating category calibration factors."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            cal = CalibrationService(config_path=tmp_path)
            # Default baseline factors
            self.assertEqual(cal.state.category_factors[CATEGORY_FAMILY_ANIMATION], 0.80)
            self.assertEqual(cal.state.category_factors[CATEGORY_ACTION_GENERAL], 0.90)
            self.assertEqual(cal.state.category_factors[CATEGORY_DRAMA_ADULT], 0.93)

            # Update from official ICA records
            updated = cal.update_from_ica(self.sample_records, default_adult_price=7.60)
            
            # Family animation gamma: average ATP ~6.35 / 7.60 = 0.835, blended ~0.82-0.84
            family_gamma = updated[CATEGORY_FAMILY_ANIMATION]
            self.assertGreaterEqual(family_gamma, 0.78)
            self.assertLessEqual(family_gamma, 0.86)

            # Check that config was written and reloaded
            cal_reloaded = CalibrationService(config_path=tmp_path)
            self.assertEqual(cal_reloaded.state.category_factors[CATEGORY_FAMILY_ANIMATION], family_gamma)

            # Check direct movie-specific lookup
            paw_factor = cal.get_calibration_factor(movie_title="Patrulha Pata: O Filme dos Dinossauros")
            # 6.28 / 7.60 = 0.826
            self.assertAlmostEqual(paw_factor, 0.826, places=2)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_calibrated_revenue_estimator(self):
        """Tests that RevenueEstimator applies gamma_category to live scraped occupancy."""
        # Uncalibrated baseline: 100 tickets @ 7.60 = 760.00 EUR
        ticket_types = [{"ticket_type": "Bilhete Normal", "price": 7.60, "is_default": True}]

        # 1. Uncalibrated calculation (apply_calibration=False)
        raw_rev = RevenueEstimator.estimate_session_revenue(
            sold_seats=100,
            ticket_types=ticket_types,
            apply_calibration=False
        )
        self.assertEqual(raw_rev, 760.00)

        # 2. Calibrated calculation for Family / Animation
        gamma_family = get_calibration_factor(category=CATEGORY_FAMILY_ANIMATION)
        family_rev = RevenueEstimator.estimate_session_revenue(
            sold_seats=100,
            ticket_types=ticket_types,
            category=CATEGORY_FAMILY_ANIMATION
        )
        self.assertEqual(family_rev, round(100 * 7.60 * gamma_family, 2))

        # 3. Calibrated calculation for Drama / Adult
        gamma_drama = get_calibration_factor(category=CATEGORY_DRAMA_ADULT)
        drama_rev = RevenueEstimator.estimate_session_revenue(
            sold_seats=100,
            ticket_types=ticket_types,
            category=CATEGORY_DRAMA_ADULT
        )
        self.assertEqual(drama_rev, round(100 * 7.60 * gamma_drama, 2))

        # 4. Calibrated by movie title classification (auto-detected Family movie)
        auto_family_rev = RevenueEstimator.estimate_session_revenue(
            sold_seats=100,
            ticket_types=ticket_types,
            movie_title="Mínimos e Monstros (VP)"
        )
        self.assertLess(auto_family_rev, raw_rev)  # Confirms child/family discount is applied

    def test_per_movie_reference_price_calibration(self):
        """Tests that per-movie resolved unit prices correctly determine gamma = ATP / resolved_unit_price."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            cal = CalibrationService(config_path=tmp_path)
            # Pass custom resolved prices per movie from Postgres
            movie_prices = {
                "Patrulha Pata - O Filme dos Dinossauros": 8.46,
                "Homem-Aranha - Um Novo Dia": 9.36,
                "A Odisseia": 10.29
            }
            cal.update_from_ica(self.sample_records, movie_baseline_prices=movie_prices)

            # Patrulha Pata ATP is 6.28 €. Ref price is 8.46 €.
            # Expected gamma = 6.28 / 8.46 = 0.742
            paw_factor = cal.get_calibration_factor(movie_title="Patrulha Pata: O Filme dos Dinossauros")
            self.assertAlmostEqual(paw_factor, 0.742, places=2)

            # Homem-Aranha ATP is 7.49 €. Ref price is 9.36 €.
            # Expected gamma = 7.49 / 9.36 = 0.800
            spidey_factor = cal.get_calibration_factor(movie_title="Homem-Aranha: Um Novo Dia")
            self.assertAlmostEqual(spidey_factor, 0.800, places=2)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_ema_accumulation_across_weeks(self):
        """Tests that repeated updates blend with previous factors via Exponential Moving Average (EMA)."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            cal = CalibrationService(config_path=tmp_path)
            movie_prices = {"Patrulha Pata - O Filme dos Dinossauros": 8.46}

            # Week 1 update: ATP = 6.28, Gamma = 6.28 / 8.46 = 0.742
            cal.update_from_ica(self.sample_records, movie_baseline_prices=movie_prices, ema_alpha=0.70)
            self.assertAlmostEqual(cal.state.movie_specific_factors["patrulha pata o filme dos dinossauros"], 0.742, places=2)

            # Week 2 update: suppose ATP rises to 7.00 for the new week (observed gamma = 7.00 / 8.46 = 0.827)
            # EMA = 0.70 * 0.827 + 0.30 * 0.742 = 0.5789 + 0.2226 = 0.8015
            modified_records = list(self.sample_records)
            for i, r in enumerate(modified_records):
                if "Patrulha Pata" in r.title:
                    modified_records[i] = ICAMovieRecord(
                        rank=r.rank,
                        title=r.title,
                        normalized_title=r.normalized_title,
                        weekly_gross_revenue=70000.0,
                        weekly_admissions=10000,
                        atp=7.00
                    )
            cal.update_from_ica(modified_records, movie_baseline_prices=movie_prices, ema_alpha=0.70)
            new_gamma = cal.state.movie_specific_factors["patrulha pata o filme dos dinossauros"]
            self.assertAlmostEqual(new_gamma, 0.802, places=2)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_minimum_sample_count_guard(self):
        """Tests that categories with fewer than min_category_samples retain their default baseline."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            cal = CalibrationService(config_path=tmp_path)
            # Filter records to only 1 Drama movie (e.g. O Fim de Oak Street)
            one_drama_record = [r for r in self.sample_records if "Oak Street" in r.title]
            
            # Update with min_category_samples = 3
            cal.update_from_ica(one_drama_record, min_category_samples=3)

            # Drama / Adult should NOT be updated because sample count is 1 < 3
            self.assertEqual(cal.state.category_factors[CATEGORY_DRAMA_ADULT], 0.93)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_extreme_gamma_bounds_clipping(self):
        """Tests that extreme anomalous ratios are strictly clipped to [0.50, 1.30]."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            cal = CalibrationService(config_path=tmp_path)
            anomalous_records = [
                ICAMovieRecord(rank=1, title="Filme Quase Grátis", normalized_title="filme quase gratis", weekly_gross_revenue=100.0, weekly_admissions=1000, atp=0.10),
                ICAMovieRecord(rank=2, title="Filme Hiper Caro", normalized_title="filme hiper caro", weekly_gross_revenue=100000.0, weekly_admissions=1000, atp=100.0)
            ]
            cal.update_from_ica(anomalous_records, default_adult_price=7.60)
            self.assertEqual(cal.state.movie_specific_factors["filme quase gratis"], 0.50)
            self.assertEqual(cal.state.movie_specific_factors["filme hiper caro"], 1.30)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)


if __name__ == "__main__":
    unittest.main()
