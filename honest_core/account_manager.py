"""
Account Manager - Tracks balances, positions, margin, fee expenses,
and logs the time-series equity curve for the graph GUI.
"""
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional
from honest_core.order_types import Order, Trade, Position

class HonestAccountManager:
    def __init__(self, initial_capital: float = 100.00, leverage: float = 10.0):
        self.initial_capital = initial_capital
        self.balance = initial_capital
        self.used_margin = 0.0
        self.leverage = leverage
        self.positions: Dict[str, Position] = {}
        self.orders: List[Order] = []
        self.trades: List[Trade] = []
        
        # Time-series for Equity Curve GUI
        self.equity_curve: List[Dict[str, float]] = [
            {"time": int(datetime.now(timezone.utc).timestamp()), "equity": initial_capital, "balance": initial_capital}
        ]

    def get_stats(self) -> Dict[str, any]:
        total_trades = len(self.trades)
        wins = [t for t in self.trades if t.is_win]
        losses = [t for t in self.trades if not t.is_win]
        
        win_count = len(wins)
        loss_count = len(losses)
        win_rate = (win_count / total_trades * 100.0) if total_trades > 0 else 0.0

        gross_profits = sum(t.gross_pnl for t in wins)
        gross_losses = abs(sum(t.gross_pnl for t in losses))
        profit_factor = (gross_profits / gross_losses) if gross_losses > 0 else (gross_profits if gross_profits > 0 else 1.0)
        
        total_fees = sum(t.fee_paid for t in self.trades)
        total_net_pnl = sum(t.net_pnl for t in self.trades)

        # Max Drawdown from equity curve
        peak = self.initial_capital
        max_dd = 0.0
        for pt in self.equity_curve:
            eq = pt["equity"]
            if eq > peak:
                peak = eq
            dd = ((peak - eq) / peak * 100.0) if peak > 0 else 0.0
            if dd > max_dd:
                max_dd = dd

        return {
            "initial_capital": self.initial_capital,
            "current_balance": round(self.balance, 2),
            "equity": round(self.get_total_equity(), 2),
            "used_margin": round(self.used_margin, 2),
            "total_trades": total_trades,
            "win_count": win_count,
            "loss_count": loss_count,
            "win_rate": round(win_rate, 1),
            "profit_factor": round(profit_factor, 2),
            "total_fees": round(total_fees, 4),
            "net_realized_pnl": round(total_net_pnl, 4),
            "max_drawdown_pct": round(max_dd, 2)
        }

    def get_total_equity(self) -> float:
        unrealized = sum(p.unrealized_pnl for p in self.positions.values())
        return self.balance + unrealized

    def open_position(self, order: Order, fill_price: float, fee: float, slippage: float) -> Position:
        order.status = "FILLED"
        order.filled_price = fill_price
        order.filled_time = datetime.now(timezone.utc).isoformat()
        order.fee_paid = fee
        order.slippage = slippage
        self.orders.append(order)

        # Deduct entry fee directly from balance
        self.balance -= fee

        qty = order.quantity if order.action == "BUY" else -order.quantity
        notional = fill_price * order.quantity
        margin = round(notional / self.leverage, 4)
        self.used_margin += margin

        pos = Position(
            symbol=order.symbol,
            quantity=qty,
            average_price=fill_price,
            current_price=fill_price,
            unrealized_pnl=0.0,
            stop_loss=order.stop_loss,
            take_profit=order.take_profit,
            margin_blocked=margin,
            entry_time=order.filled_time,
            order_id=order.order_id
        )
        self.positions[order.symbol] = pos
        self._record_equity()
        return pos

    def close_position(self, symbol: str, exit_price: float, fee: float, slippage: float, reason: str) -> Optional[Trade]:
        if symbol not in self.positions:
            return None

        pos = self.positions.pop(symbol)
        self.used_margin = max(0.0, self.used_margin - pos.margin_blocked)

        is_long = pos.quantity > 0
        qty = abs(pos.quantity)

        # Gross PnL
        if is_long:
            gross_pnl = (exit_price - pos.average_price) * qty
        else:
            gross_pnl = (pos.average_price - exit_price) * qty

        # Total fee = entry fee (already deducted from balance) + exit fee
        total_fee = fee  # exit fee
        net_pnl = round(gross_pnl - total_fee, 4)

        # Update cash balance with gross PnL minus exit fee
        self.balance += (gross_pnl - fee)

        trade = Trade(
            trade_id=f"TRD-{uuid.uuid4().hex[:8].upper()}",
            order_id=pos.order_id,
            symbol=symbol,
            action="BUY" if is_long else "SELL",
            quantity=qty,
            entry_price=pos.average_price,
            exit_price=exit_price,
            gross_pnl=round(gross_pnl, 4),
            fee_paid=round(pos.margin_blocked * 0.0005 + fee, 4), # approximate both legs
            net_pnl=net_pnl,
            slippage=slippage,
            exit_reason=reason,
            entry_time=pos.entry_time,
            exit_time=datetime.now(timezone.utc).isoformat()
        )
        self.trades.append(trade)
        self._record_equity()
        return trade

    def update_positions_mtm(self, current_quote: Dict[str, any]):
        sym = current_quote["symbol"]
        if sym in self.positions:
            pos = self.positions[sym]
            bid = current_quote["bid"]
            ask = current_quote["ask"]
            
            if pos.quantity > 0: # Long
                pos.current_price = bid
                pos.unrealized_pnl = round((bid - pos.average_price) * pos.quantity, 4)
            else: # Short
                pos.current_price = ask
                pos.unrealized_pnl = round((pos.average_price - ask) * abs(pos.quantity), 4)

    def _record_equity(self):
        now_ts = int(datetime.now(timezone.utc).timestamp())
        total_eq = round(self.get_total_equity(), 2)
        # Avoid duplicate timestamps
        if self.equity_curve and self.equity_curve[-1]["time"] == now_ts:
            self.equity_curve[-1]["equity"] = total_eq
            self.equity_curve[-1]["balance"] = round(self.balance, 2)
        else:
            self.equity_curve.append({
                "time": now_ts,
                "equity": total_eq,
                "balance": round(self.balance, 2)
            })
