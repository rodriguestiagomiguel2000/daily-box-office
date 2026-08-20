"""
Modular Revenue Estimator for Portuguese Cinema Box Office.
Separates admissions from revenue estimates using collected ticket types,
filtering out 0.0 EUR voucher placeholders and accounting for special formats (IMAX, 3D, VIP).
"""

import logging
from typing import Any, List, Optional, Tuple

from calibration_service import (
    CalibrationService,
    get_calibration_factor,
    classify_movie_category,
    CATEGORY_FAMILY_ANIMATION,
    CATEGORY_ACTION_GENERAL,
    CATEGORY_DRAMA_ADULT,
    DEFAULT_CALIBRATION_FACTORS
)

log = logging.getLogger("nos_revenue")

# Reference fallback price baselines in Portugal (NOS Cinemas, 2026)
DEFAULT_STANDARD_PRICE = 7.60
DEFAULT_IMAX_PRICE = 13.50
DEFAULT_3D_PRICE = 9.80
DEFAULT_VIP_PRICE = 12.00


class RevenueEstimator:
    """
    Modular revenue estimator.
    Can be configured or enhanced with historical sales distributions.
    """

    @staticmethod
    def get_effective_ticket_price_with_metadata(
        ticket_types: List[Any],
        format_hint: str = ""
    ) -> Tuple[float, str]:
        """
        Determines the representative ticket price from collected ticket types,
        returning both the effective price and the resolution method:
        - "DEFAULT_FLAG"
        - "STANDARD_NAME"
        - "SINGLE_NON_CONCESSION"
        - "NON_ZERO_AVERAGE" (the unweighted fallback path)
        - "FORMAT_FALLBACK"
        """
        parsed_tickets: List[dict] = []
        for item in ticket_types:
            if isinstance(item, dict):
                desc = str(item.get("ticket_type") or item.get("Description") or "").strip()
                p = float(item.get("price", 0))
                is_def = bool(item.get("is_default") or item.get("IsDefault") or False)
                seats = int(item.get("seats_count") or item.get("SeatsCount") or 1)
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                desc = str(item[0]).strip()
                p = float(item[1])
                is_def = bool(item[2]) if len(item) >= 3 else False
                seats = 1
            else:
                continue

            if p > 0.0:
                parsed_tickets.append({
                    "ticket_type": desc,
                    "price": round(p, 2),
                    "is_default": is_def,
                    "seats_count": seats,
                })

        if parsed_tickets:
            # 1. Prefer single ticket type explicitly marked as default (is_default = True)
            default_prices = [t["price"] for t in parsed_tickets if t["is_default"]]
            if default_prices:
                return min(default_prices), "DEFAULT_FLAG"

            # 2. Prefer standard adult ticket types ("Normal", "Adulto", "Inteiro", "Standard")
            standard_prices = [
                t["price"] for t in parsed_tickets
                if any(k in t["ticket_type"].lower() for k in ["normal", "adulto", "inteiro", "standard"])
                and not any(k in t["ticket_type"].lower() for k in ["fam", "pax"])
                and t["seats_count"] <= 1
            ]
            if standard_prices:
                return min(standard_prices), "STANDARD_NAME"

            # 3. Prefer single-seat non-family/pax tickets (excluding known concession/discount tiers)
            single_seat_prices = [
                t["price"] for t in parsed_tickets
                if not any(k in t["ticket_type"].lower() for k in ["fam", "pax", "criança", "crianca", "estudante", "sénior", "senior", "jovem"])
                and t["seats_count"] <= 1
            ]
            if single_seat_prices:
                return min(single_seat_prices), "SINGLE_NON_CONCESSION"

            # 4. Fallback: unweighted average across all non-zero prices as a last resort (with audit warning)
            non_zero_prices = [t["price"] for t in parsed_tickets]
            distinct_prices = list(set(non_zero_prices))
            fallback_avg = round(sum(distinct_prices) / len(distinct_prices), 2)
            log.warning(
                f"[nos_revenue] No default/standard ticket price found for session (format='{format_hint}'). "
                f"Falling back to unweighted average across non-zero ticket types: {distinct_prices} -> {fallback_avg} EUR."
            )
            return fallback_avg, "NON_ZERO_AVERAGE"

        # Fallbacks based on format
        format_lower = format_hint.lower()
        if "imax" in format_lower:
            return DEFAULT_IMAX_PRICE, "FORMAT_FALLBACK"
        elif "3d" in format_lower:
            return DEFAULT_3D_PRICE, "FORMAT_FALLBACK"
        elif "vip" in format_lower:
            return DEFAULT_VIP_PRICE, "FORMAT_FALLBACK"

        return DEFAULT_STANDARD_PRICE, "FORMAT_FALLBACK"

    @classmethod
    def get_effective_ticket_price(
        cls,
        ticket_types: List[Any],
        format_hint: str = ""
    ) -> float:
        """
        Determines the representative ticket price from collected ticket types.
        
        Why unweighted averaging was wrong:
        Taking all distinct non-zero ticket prices offered for a session (e.g. Normal, Estudante,
        Sénior, Criança, 3D) and computing an unweighted arithmetic mean systematically overestimates
        revenue and average ticket price. Discounted ticket types (child/student/senior/promo) typically
        represent a large share of real admissions but got equal weight to the standard adult price
        in an unweighted average — especially visible on family/animated titles.

        Correct approach:
        Prefer the single ticket type explicitly marked as the standard/default adult price
        ("Normal" / is_default = True, picking the lowest/first match rather than averaging).
        Only fall back to an average across all non-zero prices as a last resort when no default/standard
        type is present, and log a warning for auditing.
        """
        price, _ = cls.get_effective_ticket_price_with_metadata(ticket_types, format_hint)
        return price

    @classmethod
    def estimate_session_revenue(
        cls,
        sold_seats: int,
        ticket_types: List[Any],
        format_hint: str = "",
        movie_title: Optional[str] = None,
        category: Optional[str] = None,
        genres: Optional[List[str]] = None,
        apply_calibration: bool = True
    ) -> float:
        """
        Estimates total gross revenue for a session given sold admissions,
        calibrated by the category discount factor (gamma):
            Estimated Revenue = Sold Seats * P_adult * gamma_category
        """
        if sold_seats <= 0:
            return 0.0
        unit_price = cls.get_effective_ticket_price(ticket_types, format_hint)
        gamma = 1.0
        if apply_calibration:
            gamma = get_calibration_factor(category=category, movie_title=movie_title, genres=genres)
        return round(sold_seats * unit_price * gamma, 2)

