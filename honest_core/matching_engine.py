"""
The Brutally Honest Matching Engine.
Features:
- Mandatory Bid/Ask spread penalty (never fills at mid or LTP)
- Dynamic micro-slippage model (simulating queue position and execution latency)
- Exchange taker/maker fee deduction (0.05% default)
- Realistic Stop-Loss trigger with negative adverse slippage
"""
import random
import time
import uuid
from datetime import datetime
from typing import Dict, Any, Tuple, Optional
from honest_core.order_types import Order, Trade, Position

class HonestMatchingEngine:
    def __init__(self, taker_fee_pct: float = 0.0005, base_slippage_bps: float = 1.5):
        """
        :param taker_fee_pct: 0.0005 = 0.05% fee per side (industry standard)
        :param base_slippage_bps: 1.5 basis points baseline slippage
        """
        self.taker_fee_pct = taker_fee_pct
        self.base_slippage_bps = base_slippage_bps

    def simulate_fill(self, order: Order, quote: Dict[str, Any]) -> Tuple[float, float, float]:
        """
        Calculates the honest fill price, slippage, and fee.
        BUY market fills at Ask + slippage.
        SELL market fills at Bid - slippage.
        Returns: (fill_price, slippage_amount, fee_paid)
        """
        bid = quote["bid"]
        ask = quote["ask"]
        ltp = quote["ltp"]

        # Calculate dynamic latency & queue slippage (0.5 to 2.5 basis points)
        slippage_bps = self.base_slippage_bps + random.uniform(0.2, 1.2)
        slippage_rate = slippage_bps / 10000.0

        if order.action.upper() == "BUY":
            base_price = ask
            slippage = base_price * slippage_rate
            fill_price = round(base_price + slippage, 4)
        else: # SELL
            base_price = bid
            slippage = base_price * slippage_rate
            fill_price = round(base_price - slippage, 4)

        # Exchange Taker Fee: notional * fee_pct
        notional = fill_price * order.quantity
        fee = round(notional * self.taker_fee_pct, 4)

        return fill_price, slippage, fee

    def check_sl_tp_triggers(self, position: Position, quote: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Evaluates active position against current live market prices.
        Checks if Stop-Loss or Take-Profit has been triggered.
        Returns trigger event dict if hit, else None.
        """
        bid = quote["bid"]
        ask = quote["ask"]

        is_long = position.quantity > 0
        qty = abs(position.quantity)

        # Check Stop Loss
        if position.stop_loss is not None:
            if is_long and bid <= position.stop_loss:
                # Long SL hit on Bid
                # Fast liquidations experience adverse slippage (slips below SL)
                slippage = position.stop_loss * (self.base_slippage_bps * 1.5 / 10000.0)
                exit_price = round(min(bid, position.stop_loss) - slippage, 4)
                fee = round(exit_price * qty * self.taker_fee_pct, 4)
                return {
                    "reason": "STOP_LOSS_HIT",
                    "exit_price": exit_price,
                    "fee": fee,
                    "slippage": slippage
                }
            elif not is_long and ask >= position.stop_loss:
                # Short SL hit on Ask (slips above SL)
                slippage = position.stop_loss * (self.base_slippage_bps * 1.5 / 10000.0)
                exit_price = round(max(ask, position.stop_loss) + slippage, 4)
                fee = round(exit_price * qty * self.taker_fee_pct, 4)
                return {
                    "reason": "STOP_LOSS_HIT",
                    "exit_price": exit_price,
                    "fee": fee,
                    "slippage": slippage
                }

        # Check Take Profit
        if position.take_profit is not None:
            if is_long and bid >= position.take_profit:
                exit_price = position.take_profit
                fee = round(exit_price * qty * self.taker_fee_pct, 4)
                return {
                    "reason": "TAKE_PROFIT",
                    "exit_price": exit_price,
                    "fee": fee,
                    "slippage": 0.0
                }
            elif not is_long and ask <= position.take_profit:
                exit_price = position.take_profit
                fee = round(exit_price * qty * self.taker_fee_pct, 4)
                return {
                    "reason": "TAKE_PROFIT",
                    "exit_price": exit_price,
                    "fee": fee,
                    "slippage": 0.0
                }

        return None
