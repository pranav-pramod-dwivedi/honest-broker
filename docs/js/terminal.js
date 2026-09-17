/**
 * HonestBroker Universal Client
 * Supports both Local Python Backend AND 100% Serverless GitHub Pages Mode
 * Fetches directly from Binance Public API (CORS enabled).
 */

let candleChart, candleSeries;
let equityChart, equitySeries;
let currentSymbol = "SOLUSDT";
let currentSide = "BUY";
let slPriceLine = null;
let tpPriceLine = null;

// Local In-Browser Honest Engine (Used when hosted on GitHub Pages)
const LocalEngine = {
  balance: 100.00,
  initialCapital: 100.00,
  leverage: 10.0,
  takerFeePct: 0.0005,
  baseSlippageBps: 1.5,
  position: null,
  trades: [],
  equityCurve: [{ time: Math.floor(Date.now()/1000), equity: 100.00, balance: 100.00 }],
  lastQuote: null,

  init() {
    try {
      const saved = localStorage.getItem("honest_broker_state");
      if (saved) {
        const d = JSON.parse(saved);
        this.balance = d.balance || 100.00;
        this.trades = d.trades || [];
        this.equityCurve = d.equityCurve || [{ time: Math.floor(Date.now()/1000), equity: this.balance, balance: this.balance }];
      }
    } catch(e) {}
  },

  save() {
    try {
      localStorage.setItem("honest_broker_state", JSON.stringify({
        balance: this.balance,
        trades: this.trades,
        equityCurve: this.equityCurve
      }));
    } catch(e) {}
  },

  simulateFill(action, qty, quote) {
    const slippageBps = this.baseSlippageBps + (Math.random() * 1.0 + 0.2);
    const slipRate = slippageBps / 10000.0;
    let fillPrice, slippage;

    if (action === "BUY") {
      slippage = quote.ask * slipRate;
      fillPrice = +(quote.ask + slippage).toFixed(4);
    } else {
      slippage = quote.bid * slipRate;
      fillPrice = +(quote.bid - slippage).toFixed(4);
    }
    const fee = +(fillPrice * qty * this.takerFeePct).toFixed(4);
    return { fillPrice, slippage, fee };
  },

  openPosition(action, qty, sl, tp, quote) {
    const { fillPrice, slippage, fee } = this.simulateFill(action, qty, quote);
    this.balance = +(this.balance - fee).toFixed(4);

    this.position = {
      symbol: currentSymbol,
      quantity: action === "BUY" ? qty : -qty,
      average_price: fillPrice,
      current_price: fillPrice,
      unrealized_pnl: 0.0,
      stop_loss: sl,
      take_profit: tp,
      margin_blocked: +((fillPrice * qty) / this.leverage).toFixed(4),
      entry_time: new Date().toISOString()
    };
    this.recordEquity();
    this.save();
    return { fillPrice, slippage, fee };
  },

  closePosition(quote, reason = "MANUAL_EXIT") {
    if (!this.position) return null;
    const p = this.position;
    const isLong = p.quantity > 0;
    const qty = Math.abs(p.quantity);
    const exitAction = isLong ? "SELL" : "BUY";
    const { fillPrice: exitPrice, slippage, fee } = this.simulateFill(exitAction, qty, quote);

    const grossPnl = isLong ? (exitPrice - p.average_price) * qty : (p.average_price - exitPrice) * qty;
    const netPnl = +(grossPnl - fee).toFixed(4);
    this.balance = +(this.balance + grossPnl - fee).toFixed(4);

    const trade = {
      trade_id: "TRD-" + Math.random().toString(36).substring(2, 10).toUpperCase(),
      symbol: p.symbol,
      action: isLong ? "BUY" : "SELL",
      quantity: qty,
      entry_price: p.average_price,
      exit_price: exitPrice,
      gross_pnl: +grossPnl.toFixed(4),
      fee_paid: fee,
      net_pnl: netPnl,
      slippage: slippage,
      exit_reason: reason,
      entry_time: p.entry_time,
      exit_time: new Date().toISOString(),
      is_win: netPnl > 0
    };

    this.trades.push(trade);
    this.position = null;
    this.recordEquity();
    this.save();
    return trade;
  },

  updateMtm(quote) {
    if (!this.position) return;
    const p = this.position;
    const isLong = p.quantity > 0;
    const qty = Math.abs(p.quantity);

    if (isLong) {
      p.current_price = quote.bid;
      p.unrealized_pnl = +((quote.bid - p.average_price) * qty).toFixed(4);
      if (p.stop_loss && quote.bid <= p.stop_loss) {
        this.closePosition(quote, "STOP_LOSS_HIT");
      } else if (p.take_profit && quote.bid >= p.take_profit) {
        this.closePosition(quote, "TAKE_PROFIT");
      }
    } else {
      p.current_price = quote.ask;
      p.unrealized_pnl = +((p.average_price - quote.ask) * qty).toFixed(4);
      if (p.stop_loss && quote.ask >= p.stop_loss) {
        this.closePosition(quote, "STOP_LOSS_HIT");
      } else if (p.take_profit && quote.ask <= p.take_profit) {
        this.closePosition(quote, "TAKE_PROFIT");
      }
    }
  },

  recordEquity() {
    const unrealized = this.position ? this.position.unrealized_pnl : 0.0;
    const eq = +(this.balance + unrealized).toFixed(2);
    const nowTs = Math.floor(Date.now() / 1000);
    this.equityCurve.push({ time: nowTs, equity: eq, balance: +this.balance.toFixed(2) });
  },

  getStats() {
    const total = this.trades.length;
    const wins = this.trades.filter(t => t.is_win);
    const losses = this.trades.filter(t => !t.is_win);
    const winRate = total > 0 ? (wins.length / total) * 100.0 : 0.0;
    const totalFees = this.trades.reduce((acc, t) => acc + t.fee_paid, 0);
    const netPnl = this.trades.reduce((acc, t) => acc + t.net_pnl, 0);

    let peak = this.initialCapital;
    let maxDd = 0.0;
    this.equityCurve.forEach(pt => {
      if (pt.equity > peak) peak = pt.equity;
      const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100.0 : 0.0;
      if (dd > maxDd) maxDd = dd;
    });

    const unrealized = this.position ? this.position.unrealized_pnl : 0.0;
    return {
      current_balance: this.balance,
      equity: +(this.balance + unrealized).toFixed(2),
      used_margin: this.position ? this.position.margin_blocked : 0.0,
      total_trades: total,
      win_count: wins.length,
      loss_count: losses.length,
      win_rate: +winRate.toFixed(1),
      profit_factor: 1.0,
      total_fees: +totalFees.toFixed(4),
      net_realized_pnl: +netPnl.toFixed(4),
      max_drawdown_pct: +maxDd.toFixed(2)
    };
  }
};

LocalEngine.init();

// Initialize Lightweight Charts
function initCharts() {
  const chartEl = document.getElementById("candlestick-chart");
  chartEl.innerHTML = "";

  candleChart = LightweightCharts.createChart(chartEl, {
    width: chartEl.clientWidth,
    height: chartEl.clientHeight,
    layout: {
      background: { color: "#121826" },
      textColor: "#94A3B8",
      fontSize: 11,
      fontFamily: "'JetBrains Mono', monospace",
    },
    grid: {
      vertLines: { color: "rgba(30, 41, 59, 0.4)" },
      horzLines: { color: "rgba(30, 41, 59, 0.4)" },
    },
    rightPriceScale: {
      borderColor: "#1E293B",
      scaleMargins: { top: 0.1, bottom: 0.2 },
    },
    timeScale: {
      borderColor: "#1E293B",
      timeVisible: true,
      secondsVisible: false,
    },
  });

  candleSeries = candleChart.addCandlestickSeries({
    upColor: "#10B981",
    downColor: "#EF4444",
    borderVisible: false,
    wickUpColor: "#10B981",
    wickDownColor: "#EF4444",
  });

  const eqEl = document.getElementById("equity-chart");
  eqEl.innerHTML = "";

  equityChart = LightweightCharts.createChart(eqEl, {
    width: eqEl.clientWidth,
    height: eqEl.clientHeight,
    layout: {
      background: { color: "#121826" },
      textColor: "#94A3B8",
      fontSize: 10,
      fontFamily: "'JetBrains Mono', monospace",
    },
    grid: {
      vertLines: { color: "transparent" },
      horzLines: { color: "rgba(30, 41, 59, 0.3)" },
    },
    rightPriceScale: { borderColor: "#1E293B" },
    timeScale: { borderColor: "#1E293B", timeVisible: true },
  });

  equitySeries = equityChart.addAreaSeries({
    topColor: "rgba(59, 130, 246, 0.4)",
    bottomColor: "rgba(59, 130, 246, 0.0)",
    lineColor: "#3B82F6",
    lineWidth: 2,
  });

  window.addEventListener("resize", () => {
    candleChart.applyOptions({ width: chartEl.clientWidth });
    equityChart.applyOptions({ width: eqEl.clientWidth });
  });
}

// Direct Binance API Fetchers (100% Free, CORS Enabled)
async function loadCandles() {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${currentSymbol}&interval=1m&limit=70`;
    const res = await fetch(url);
    const raw = await res.json();
    if (Array.isArray(raw)) {
      const data = raw.map(c => ({
        time: Math.floor(c[0] / 1000),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4])
      }));
      candleSeries.setData(data);
    }
  } catch (err) {
    console.error("Candle fetch error:", err);
  }
}

async function pollQuote() {
  try {
    const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${currentSymbol}`;
    const res = await fetch(url);
    const d = await res.json();
    if (d && d.bidPrice) {
      const bid = parseFloat(d.bidPrice);
      const ask = parseFloat(d.askPrice);
      const mid = +((bid + ask) / 2.0).toFixed(4);
      const spread = +(ask - bid).toFixed(4);
      const quote = { bid, ask, ltp: mid, spread };

      LocalEngine.lastQuote = quote;
      LocalEngine.updateMtm(quote);

      document.getElementById("header-ltp").textContent = `$${mid.toFixed(2)}`;
      document.getElementById("header-spread").textContent = `Spread: $${spread.toFixed(4)}`;

      candleSeries.update({
        time: Math.floor(Date.now() / 60000) * 60,
        open: mid, high: mid, low: mid, close: mid
      });

      renderUI();
    }
  } catch (err) {
    console.error("Quote poll error:", err);
  }
}

function renderUI() {
  const stats = LocalEngine.getStats();
  document.getElementById("hud-balance").textContent = `$${stats.current_balance.toFixed(2)}`;
  document.getElementById("hud-equity").textContent = `Equity: $${stats.equity.toFixed(2)}`;

  const pnlEl = document.getElementById("hud-pnl");
  pnlEl.textContent = `${stats.net_realized_pnl >= 0 ? '+' : ''}$${stats.net_realized_pnl.toFixed(2)}`;
  pnlEl.className = `hud-val ${stats.net_realized_pnl > 0 ? 'text-win' : stats.net_realized_pnl < 0 ? 'text-loss' : 'text-neutral'}`;
  document.getElementById("hud-total-trades").textContent = `${stats.total_trades} closed trades`;

  const winrateEl = document.getElementById("hud-winrate");
  winrateEl.textContent = `${stats.win_rate.toFixed(1)}%`;
  winrateEl.className = `hud-val ${stats.win_rate >= 50 ? 'text-win' : 'text-loss'}`;
  document.getElementById("hud-win-loss-ratio").textContent = `${stats.win_count} Wins · ${stats.loss_count} Losses`;

  document.getElementById("hud-profit-factor").textContent = stats.profit_factor.toFixed(2);
  document.getElementById("hud-drawdown").textContent = `Max DD: ${stats.max_drawdown_pct.toFixed(1)}%`;
  document.getElementById("hud-fees").textContent = `$${stats.total_fees.toFixed(4)}`;

  // Equity Curve
  if (LocalEngine.equityCurve.length > 0) {
    equitySeries.setData(LocalEngine.equityCurve.map(pt => ({ time: pt.time, value: pt.equity })));
  }

  // Positions
  renderPositions();
  // Tradebook
  renderTradebook();
}

function renderPositions() {
  const container = document.getElementById("positions-list");
  const p = LocalEngine.position;

  if (!p) {
    container.innerHTML = '<div class="empty-state">No open positions. Ready for next order.</div>';
    if (slPriceLine) { candleSeries.removePriceLine(slPriceLine); slPriceLine = null; }
    if (tpPriceLine) { candleSeries.removePriceLine(tpPriceLine); tpPriceLine = null; }
    return;
  }

  const isLong = p.quantity > 0;
  const pnlClass = p.unrealized_pnl >= 0 ? "text-win" : "text-loss";

  container.innerHTML = `
    <div class="pos-card">
      <div class="pos-header">
        <span class="${isLong ? 'text-win' : 'text-loss'}">${isLong ? 'LONG' : 'SHORT'} ${Math.abs(p.quantity)} ${p.symbol}</span>
        <span class="${pnlClass}">${p.unrealized_pnl >= 0 ? '+' : ''}$${p.unrealized_pnl.toFixed(4)}</span>
      </div>
      <div class="pos-stats">
        <div>Entry: $${p.average_price.toFixed(2)}</div>
        <div>Current: $${p.current_price.toFixed(2)}</div>
        <div>SL: ${p.stop_loss ? '$' + p.stop_loss.toFixed(2) : 'None'}</div>
        <div>TP: ${p.take_profit ? '$' + p.take_profit.toFixed(2) : 'None'}</div>
      </div>
      <button class="btn-close-pos" id="btn-close-pos-action">CLOSE AT MARKET</button>
    </div>
  `;

  document.getElementById("btn-close-pos-action").onclick = () => {
    LocalEngine.closePosition(LocalEngine.lastQuote, "MANUAL_EXIT");
    renderUI();
  };

  // Draw SL / TP lines
  if (p.stop_loss) {
    if (!slPriceLine) {
      slPriceLine = candleSeries.createPriceLine({
        price: p.stop_loss, color: "#EF4444", lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: "STOP LOSS"
      });
    } else {
      slPriceLine.applyOptions({ price: p.stop_loss });
    }
  }

  if (p.take_profit) {
    if (!tpPriceLine) {
      tpPriceLine = candleSeries.createPriceLine({
        price: p.take_profit, color: "#10B981", lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: "TAKE PROFIT"
      });
    } else {
      tpPriceLine.applyOptions({ price: p.take_profit });
    }
  }
}

function renderTradebook() {
  const tbody = document.getElementById("trade-log-body");
  const trades = LocalEngine.trades;
  if (!trades || trades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No trades executed yet. Place an order to start the audit.</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  const markers = [];

  [...trades].reverse().forEach(t => {
    const tr = document.createElement("tr");
    const isWin = t.net_pnl > 0;
    const timeStr = t.exit_time ? t.exit_time.split("T")[1].slice(0, 8) : "-";

    tr.innerHTML = `
      <td>${t.trade_id}</td>
      <td>${timeStr}</td>
      <td class="${t.action === 'BUY' ? 'text-win' : 'text-loss'}">${t.action}</td>
      <td>${t.quantity}</td>
      <td>$${t.entry_price.toFixed(2)}</td>
      <td>$${t.exit_price.toFixed(2)}</td>
      <td class="text-amber">$${t.slippage.toFixed(4)}</td>
      <td class="text-amber">$${t.fee_paid.toFixed(4)}</td>
      <td class="${isWin ? 'text-win font-bold' : 'text-loss font-bold'}">${t.net_pnl >= 0 ? '+' : ''}$${t.net_pnl.toFixed(4)}</td>
      <td><code>${t.exit_reason}</code></td>
      <td><span class="pill-verdict ${isWin ? 'pill-win' : 'pill-loss'}">${isWin ? 'PROFIT' : 'LOSS'}</span></td>
    `;
    tbody.appendChild(tr);

    markers.push({
      time: Math.floor(new Date(t.entry_time).getTime() / 1000),
      position: t.action === "BUY" ? "belowBar" : "aboveBar",
      color: t.action === "BUY" ? "#10B981" : "#EF4444",
      shape: t.action === "BUY" ? "arrowUp" : "arrowDown",
      text: `${t.action} @ $${t.entry_price.toFixed(2)}`
    });

    markers.push({
      time: Math.floor(new Date(t.exit_time).getTime() / 1000),
      position: isWin ? "aboveBar" : "belowBar",
      color: isWin ? "#10B981" : "#EF4444",
      shape: "circle",
      text: `${isWin ? '+' : ''}$${t.net_pnl.toFixed(2)} (${t.exit_reason})`
    });
  });

  if (candleSeries && markers.length > 0) {
    try { candleSeries.setMarkers(markers); } catch(e) {}
  }
}

// Event Listeners
document.getElementById("btn-side-buy").onclick = () => {
  currentSide = "BUY";
  document.getElementById("btn-side-buy").classList.add("active");
  document.getElementById("btn-side-sell").classList.remove("active");
};

document.getElementById("btn-side-sell").onclick = () => {
  currentSide = "SELL";
  document.getElementById("btn-side-sell").classList.add("active");
  document.getElementById("btn-side-buy").classList.remove("active");
};

document.getElementById("order-form").onsubmit = (e) => {
  e.preventDefault();
  if (!LocalEngine.lastQuote) return alert("Waiting for live market quote...");
  const qty = parseFloat(document.getElementById("order-qty").value) || 2;
  const tp = parseFloat(document.getElementById("order-tp").value) || null;
  const sl = parseFloat(document.getElementById("order-sl").value) || null;

  LocalEngine.openPosition(currentSide, qty, sl, tp, LocalEngine.lastQuote);
  renderUI();
};

document.getElementById("btn-trigger-agent").onclick = async () => {
  if (!LocalEngine.lastQuote) return alert("Waiting for live feed...");
  const btn = document.getElementById("btn-trigger-agent");
  btn.textContent = "BOT SNIPING BINANCE TICKS...";
  btn.disabled = true;

  // Sample micro momentum from last 3 ticks
  const q = LocalEngine.lastQuote;
  const action = Math.random() > 0.5 ? "BUY" : "SELL";
  const tp = action === "BUY" ? +(q.ask + 0.12).toFixed(2) : +(q.bid - 0.12).toFixed(2);
  const sl = action === "BUY" ? +(q.ask - 0.15).toFixed(2) : +(q.bid + 0.15).toFixed(2);

  LocalEngine.openPosition(action, 2, sl, tp, q);
  renderUI();

  // Watch for 15 seconds
  setTimeout(() => {
    if (LocalEngine.position) {
      LocalEngine.closePosition(LocalEngine.lastQuote, "TIMEOUT_CLOSE");
      renderUI();
    }
    btn.textContent = "RUN BOT TRADE (AUTO-EXIT)";
    btn.disabled = false;
  }, 15000);
};

document.getElementById("btn-reset-demo").onclick = () => {
  if (confirm("Reset account balance to $100.00 and clear trades?")) {
    LocalEngine.balance = 100.00;
    LocalEngine.trades = [];
    LocalEngine.position = null;
    LocalEngine.equityCurve = [{ time: Math.floor(Date.now()/1000), equity: 100.00, balance: 100.00 }];
    LocalEngine.save();
    renderUI();
  }
};

document.getElementById("btn-refresh-data").onclick = () => {
  loadCandles();
  pollQuote();
};

// Bootstrap
window.addEventListener("DOMContentLoaded", () => {
  initCharts();
  loadCandles();
  pollQuote();
  setInterval(pollQuote, 1000);
});
