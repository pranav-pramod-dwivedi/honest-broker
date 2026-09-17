"""
Data structures for HonestBroker orders, trades, and positions.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List

@dataclass
class Order:
    order_id: str
    symbol: str
    exchange: str
    action: str          # BUY or SELL
    quantity: float
    order_type: str      # MARKET, LIMIT, STOP_LOSS
    price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    status: str = "PENDING"  # PENDING, FILLED, REJECTED, CANCELLED
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    filled_price: Optional[float] = None
    filled_time: Optional[str] = None
    fee_paid: float = 0.0
    slippage: float = 0.0

@dataclass
class Trade:
    trade_id: str
    order_id: str
    symbol: str
    action: str          # BUY or SELL
    quantity: float
    entry_price: float
    exit_price: float
    gross_pnl: float
    fee_paid: float
    net_pnl: float
    slippage: float
    exit_reason: str     # TAKE_PROFIT, STOP_LOSS_HIT, MANUAL_EXIT
    entry_time: str
    exit_time: str
    is_win: bool = field(init=False)

    def __post_init__(self):
        self.is_win = self.net_pnl > 0

@dataclass
class Position:
    symbol: str
    quantity: float       # Positive for LONG, Negative for SHORT
    average_price: float
    current_price: float = 0.0
    unrealized_pnl: float = 0.0
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    margin_blocked: float = 0.0
    entry_time: str = ""
    order_id: str = ""
