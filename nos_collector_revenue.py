"""
Modular Revenue Estimator for Portuguese Cinema Box Office.
Separates admissions from revenue estimates using collected ticket types,
filtering out 0.0 EUR voucher placeholders and accounting for special formats (IMAX, 3D, VIP).
"""

import logging
from typing import List, Optional, Tuple

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
        ticket_types: List[Tuple[str, float]],
        format_hint: str = ""
    ) -> float:
        """
        Determines the representative ticket price from collected ticket types,
        excluding promotional discount vouchers (price <= 0.0).
        """
        # Filter non-zero paid tickets
        paid_tickets = [(name, price) for name, price in ticket_types if price > 0.0]
        
        if paid_tickets:
            # Look for standard base ticket
            base_ticket = next((price for name, price in paid_tickets if "normal" in name.lower() or "bilhete" in name.lower()), None)
            if base_ticket:
                return base_ticket
            # Otherwise use mean of non-zero paid tickets
            return sum(p for _, p in paid_tickets) / len(paid_tickets)

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
