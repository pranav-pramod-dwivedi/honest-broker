#!/usr/bin/env python3
"""
HonestBroker Server - The Uncompromising Real-Market Simulation Terminal
Runs a Flask server providing:
- Web GUI with TradingView Lightweight Charts & Real-time Equity Curve
- Live public order book feeds directly from Binance
- Brutally honest matching engine with spreads, slippage, and taker fees
- Automated SL/TP continuous trigger loop
"""

import os
import sys
import time
import threading
from flask import Flask, render_template, jsonify, request
from honest_core.market_feed import MarketFeed
from honest_core.matching_engine import HonestMatchingEngine
from honest_core.account_manager import HonestAccountManager
from honest_core.order_types import Order

app = Flask(__name__, template_folder="templates", static_folder="static")

# Shared singletons
feed = MarketFeed()
engine = HonestMatchingEngine(taker_fee_pct=0.0005, base_slippage_bps=1.5)
account = HonestAccountManager(initial_capital=100.00, leverage=10.0)

# Global lock for thread safety
lock = threading.Lock()

def background_price_and_trigger_monitor():
    """
    Background daemon:
    - Continuously updates active positions MTM
    - Checks for Stop-Loss and Take-Profit triggers against live Binance prices
    - If SL is hit, executes the market exit and records the loss honestly
    """
    while True:
        try:
            with lock:
                open_syms = list(account.positions.keys())
            
            for sym in open_syms:
                q = feed.get_live_quote(sym, "CRYPTO")
                if not q:
                    continue

                with lock:
                    if sym in account.positions:
                        pos = account.positions[sym]
                        account.update_positions_mtm(q)
                        
                        # Check SL / TP
                        trigger = engine.check_sl_tp_triggers(pos, q)
                        if trigger:
                            reason = trigger["reason"]
                            exit_p = trigger["exit_price"]
                            fee = trigger["fee"]
                            slip = trigger["slippage"]
                            
                            t = account.close_position(sym, exit_p, fee, slip, reason)
                            if t:
                                print(f"[{t.exit_time}] {reason}: {sym} closed @ ${exit_p:.2f} (Net: ${t.net_pnl:+.4f})", flush=True)

        except Exception as e:
            print(f"Monitor error: {e}", flush=True)

        time.sleep(0.5)

# Start background monitor thread
monitor_thread = threading.Thread(target=background_price_and_trigger_monitor, daemon=True)
monitor_thread.start()

# ----------------- HTTP Routes -----------------

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/quote")
def get_quote():
    symbol = request.args.get("symbol", "SOLUSDT")
    q = feed.get_live_quote(symbol, "CRYPTO")
    return jsonify(q or {})

@app.route("/api/candles")
def get_candles():
    symbol = request.args.get("symbol", "SOLUSDT")
    candles = feed.get_candles(symbol, interval="1m", limit=75)
    return jsonify(candles)

@app.route("/api/state")
def get_state():
    with lock:
        positions_data = {}
        for sym, p in account.positions.items():
            positions_data[sym] = {
                "symbol": p.symbol,
                "quantity": p.quantity,
                "average_price": p.average_price,
                "current_price": p.current_price,
                "unrealized_pnl": p.unrealized_pnl,
                "stop_loss": p.stop_loss,
                "take_profit": p.take_profit,
                "margin_blocked": p.margin_blocked,
                "entry_time": p.entry_time,
            }

        trades_data = []
        for t in account.trades:
            trades_data.append({
                "trade_id": t.trade_id,
                "symbol": t.symbol,
                "action": t.action,
                "quantity": t.quantity,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "gross_pnl": t.gross_pnl,
                "fee_paid": t.fee_paid,
                "net_pnl": t.net_pnl,
                "slippage": t.slippage,
                "exit_reason": t.exit_reason,
                "entry_time": t.entry_time,
                "exit_time": t.exit_time,
                "is_win": t.is_win,
            })

        stats = account.get_stats()
        equity_curve = account.equity_curve

    return jsonify({
        "stats": stats,
        "positions": positions_data,
        "trades": trades_data,
        "equity_curve": equity_curve,
    })

@app.route("/api/order", methods=["POST"])
def place_order():
    data = request.json or {}
    symbol = data.get("symbol", "SOLUSDT").upper()
    action = data.get("action", "BUY").upper()
    quantity = float(data.get("quantity", 2.0))
    sl = float(data.get("stop_loss")) if data.get("stop_loss") else None
    tp = float(data.get("take_profit")) if data.get("take_profit") else None

    # Fetch live order book quote
    q = feed.get_live_quote(symbol, "CRYPTO")
    if not q:
        return jsonify({"status": "error", "message": "Failed to fetch live market quote"}), 400

    with lock:
        # Check margin
        fill_price, slippage, fee = engine.simulate_fill(
            Order(order_id="temp", symbol=symbol, exchange="CRYPTO", action=action, quantity=quantity, order_type="MARKET"),
            q
        )
        notional = fill_price * quantity
        required_margin = notional / account.leverage
        
        if (account.balance - fee) < required_margin:
            return jsonify({"status": "error", "message": f"Insufficient margin. Required: ${required_margin:.2f}, Available: ${account.balance:.2f}"}), 400

        order = Order(
            order_id=f"ORD-{int(time.time()*1000)}",
            symbol=symbol,
            exchange="CRYPTO",
            action=action,
            quantity=quantity,
            order_type="MARKET",
            price=fill_price,
            stop_loss=sl,
            take_profit=tp
        )

        pos = account.open_position(order, fill_price, fee, slippage)

    return jsonify({
        "status": "success",
        "order_id": order.order_id,
        "fill_price": fill_price,
        "slippage": slippage,
        "fee": fee
    })

@app.route("/api/close", methods=["POST"])
def close_order():
    data = request.json or {}
    symbol = data.get("symbol", "SOLUSDT").upper()

    q = feed.get_live_quote(symbol, "CRYPTO")
    if not q:
        return jsonify({"status": "error", "message": "Failed to fetch live quote"}), 400

    with lock:
        if symbol not in account.positions:
            return jsonify({"status": "error", "message": "No active position for symbol"}), 400

        pos = account.positions[symbol]
        exit_action = "SELL" if pos.quantity > 0 else "BUY"
        exit_price, slippage, fee = engine.simulate_fill(
            Order(order_id="exit", symbol=symbol, exchange="CRYPTO", action=exit_action, quantity=abs(pos.quantity), order_type="MARKET"),
            q
        )

        t = account.close_position(symbol, exit_price, fee, slippage, "MANUAL_EXIT")

    return jsonify({
        "status": "success",
        "trade_id": t.trade_id if t else None,
        "net_pnl": t.net_pnl if t else 0.0
    })

@app.route("/api/agent/trade", methods=["POST"])
def run_agent_trade():
    """
    Executes a real momentum trade against live Binance ticks with realistic SL and TP.
    Actively monitors until either TP or SL is triggered, and returns the honest outcome.
    """
    symbol = "SOLUSDT"
    qty = 2.0
    
    # 1. Sample micro-trend from 5 ticks
    ticks = []
    for _ in range(5):
        q = feed.get_live_quote(symbol, "CRYPTO")
        if q:
            ticks.append(q["ltp"])
        time.sleep(0.3)
    
    if len(ticks) < 2:
        return jsonify({"status": "error", "message": "Failed to sample live ticks"}), 400

    diff = ticks[-1] - ticks[0]
    action = "BUY" if diff >= 0 else "SELL"

    q_now = feed.get_live_quote(symbol, "CRYPTO")
    with lock:
        fill_price, slippage, fee = engine.simulate_fill(
            Order(order_id="agent", symbol=symbol, exchange="CRYPTO", action=action, quantity=qty, order_type="MARKET"),
            q_now
        )
        
        # Set realistic tight scalping targets: TP = +$0.12, SL = -$0.15
        if action == "BUY":
            tp = round(fill_price + 0.12, 2)
            sl = round(fill_price - 0.15, 2)
        else:
            tp = round(fill_price - 0.12, 2)
            sl = round(fill_price + 0.15, 2)

        order = Order(
            order_id=f"BOT-{int(time.time()*1000)}",
            symbol=symbol,
            exchange="CRYPTO",
            action=action,
            quantity=qty,
            order_type="MARKET",
            price=fill_price,
            stop_loss=sl,
            take_profit=tp
        )
        account.open_position(order, fill_price, fee, slippage)

    # Monitor until exit or timeout (30 seconds max for fast demo)
    start = time.time()
    while time.time() - start < 30:
        with lock:
            if symbol not in account.positions:
                break
        time.sleep(0.4)

    # If still open after 30s, force manual close to finalize
    with lock:
        if symbol in account.positions:
            q_exit = feed.get_live_quote(symbol, "CRYPTO")
            pos = account.positions[symbol]
            exit_action = "SELL" if pos.quantity > 0 else "BUY"
            exit_price, slippage, fee = engine.simulate_fill(
                Order(order_id="force", symbol=symbol, exchange="CRYPTO", action=exit_action, quantity=qty, order_type="MARKET"),
                q_exit
            )
            account.close_position(symbol, exit_price, fee, slippage, "TIMEOUT_CLOSE")

    last_trade = account.trades[-1] if account.trades else None
    return jsonify({
        "status": "success",
        "verdict": "WIN (PROFIT)" if (last_trade and last_trade.is_win) else "LOSS (SL / DRAWDOWN)",
        "net_pnl": last_trade.net_pnl if last_trade else 0.0,
        "reason": last_trade.exit_reason if last_trade else "UNKNOWN",
        "entry_price": last_trade.entry_price if last_trade else 0.0,
        "exit_price": last_trade.exit_price if last_trade else 0.0,
        "fee": last_trade.fee_paid if last_trade else 0.0,
        "slippage": last_trade.slippage if last_trade else 0.0,
    })

@app.route("/api/reset", methods=["POST"])
def reset_account():
    global account
    with lock:
        account = HonestAccountManager(initial_capital=100.00, leverage=10.0)
    return jsonify({"status": "success", "message": "Account reset to $100.00"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print("=" * 70)
    print(f"⚡ HonestBroker Terminal running on http://127.0.0.1:{port}")
    print("   Live order book connected to Binance Public API")
    print("   Bid/Ask spreads, slippage & taker fees active")
    print("=" * 70)
    app.run(host="0.0.0.0", port=port, debug=False)
