"""
Modular Revenue Estimator for Portuguese Cinema Box Office.
Separates admissions from revenue estimates using collected ticket types,
filtering out 0.0 EUR voucher placeholders and accounting for special formats (IMAX, 3D, VIP).
"""

import logging
from typing import Any, List, Optional, Tuple

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
    def get_effective_ticket_price(
        ticket_types: List[Any],
        format_hint: str = ""
    ) -> float:
        """
        Determines the representative ticket price from collected ticket types,
        normalizing and deduplicating distinct non-zero price points.
        """
        paid_prices: List[float] = []
        for item in ticket_types:
            if isinstance(item, dict):
                p = float(item.get("price", 0))
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                p = float(item[1])
            else:
                continue
            if p > 0.0:
                paid_prices.append(round(p, 2))
        
        if paid_prices:
            # Deduplicate distinct prices
            distinct_prices = list(set(paid_prices))
            return round(sum(distinct_prices) / len(distinct_prices), 2)

        # Fallbacks based on format
        format_lower = format_hint.lower()
        if "imax" in format_lower:
            return DEFAULT_IMAX_PRICE
        elif "3d" in format_lower:
            return DEFAULT_3D_PRICE
        elif "vip" in format_lower:
            return DEFAULT_VIP_PRICE

        return DEFAULT_STANDARD_PRICE

    @classmethod
    def estimate_session_revenue(
        cls,
        sold_seats: int,
        ticket_types: List[Tuple[str, float]],
        format_hint: str = ""
    ) -> float:
        """
        Estimates total gross revenue for a session given sold admissions.
        """
        if sold_seats <= 0:
            return 0.0
        unit_price = cls.get_effective_ticket_price(ticket_types, format_hint)
        return round(sold_seats * unit_price, 2)
