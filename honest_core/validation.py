"""Validation helpers for externally supplied order parameters."""

import math


def validate_order_inputs(action, quantity):
    """Validate and normalize order action and quantity from API input."""
    action = str(action or "").upper()
    try:
        quantity = float(quantity)
    except (TypeError, ValueError) as exc:
        raise ValueError("Quantity must be a finite positive number") from exc

    if action not in {"BUY", "SELL"}:
        raise ValueError("Action must be BUY or SELL")
    if not math.isfinite(quantity) or quantity <= 0:
        raise ValueError("Quantity must be a finite positive number")

    return action, quantity
