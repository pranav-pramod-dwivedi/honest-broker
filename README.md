# ⚡ HonestBroker — The Uncompromising Real-Market Simulation Terminal

> **Why most paper trading is a lie:**  
> Standard sandbox environments fill trades at Mid/LTP with zero spread, zero slippage, zero queue delay, and zero exchange fees. Strategies that seem to have "100% win rates" in fake sandboxes collapse in live trading.
>
> **HonestBroker changes that.** Built with brutal realism: mandatory Bid/Ask spread penalties, dynamic latency slippage, exchange taker fees, hard stop-loss slip mechanics, and an interactive TradingView graph GUI with real-time equity curve tracking.

---

## 📸 Key Features

- 📊 **TradingView Lightweight Charts GUI**: Real-time candlestick charting directly from the Binance public order book.
- 🎯 **Visual Order Markers**:
  - Green/Red arrows for Long and Short entries.
  - Dashed Stop-Loss (`-- SL`) and Take-Profit (`-- TP`) lines directly on the chart.
  - Exit markers showing exact net dollar PnL.
- 📉 **Real-Time Mathematical Equity Curve**: Watch your virtual balance rise on winning scalps and honestly drawdown on stop-losses.
- ⚖️ **Brutally Honest Matching Engine**:
  - **No mid-market fills**: Buys fill at `Ask + Slippage`; Sells fill at `Bid - Slippage`.
  - **Exchange Taker Fees**: Deducts realistic 0.05% fee per leg.
  - **Hard Stop-Loss Slipper**: Fast market crashes slip past your stop-loss, booking authentic losses.
- 🤖 **Autonomous Scalper Agent**: 1-click execution testing momentum bots against live market conditions.

---

## 🚀 Quick Start

### 1. Installation
```bash
git clone https://github.com/<your-username>/honest-broker.git
cd honest-broker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Launch the Terminal GUI
```bash
python server.py
```
Open your browser at:
👉 **`http://localhost:5050`**

---

## 🏛️ Architecture

```
honest-broker/
├── honest_core/
│   ├── market_feed.py       # Direct Binance Public BookTicker & Klines
│   ├── matching_engine.py   # Spreads, Latency Slippage & Fee Deductions
│   ├── account_manager.py   # Balance, Margins, PnL, Time-Series Equity Curve
│   └── order_types.py       # Order, Trade, and Position Data Models
├── templates/
│   └── index.html           # Institutional Dark-Mode Trading Terminal
├── static/
│   ├── css/terminal.css     # High-density UI styling
│   └── js/terminal.js       # TradingView Lightweight Charts & Event Loop
└── server.py                # Flask HTTP & REST API Engine
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/quote?symbol=SOLUSDT` | Live Bid, Ask, Spread & LTP from Binance |
| `GET` | `/api/candles?symbol=SOLUSDT` | 1-minute historical candlestick data |
| `GET` | `/api/state` | Live Account Balance, Equity Curve, Win/Loss Stats |
| `POST` | `/api/order` | Place a Market Order with custom SL / TP |
| `POST` | `/api/close` | Close an active position at market |
| `POST` | `/api/agent/trade` | Run an automated momentum scalp against live tape |
| `POST` | `/api/reset` | Reset virtual account back to $100.00 |

---

## 📄 License
MIT License. Free to use, modify, and integrate into OpenAlgo or private trading bots.
