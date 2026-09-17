/**
 * HonestBroker Terminal Client
 * Connects to the live honest engine, renders TradingView charts with markers,
 * plots the real-time equity curve, and updates the trade ledger.
 */

let candleChart, candleSeries, volumeSeries;
let equityChart, equitySeries;
let currentSymbol = "SOLUSDT";
let currentSide = "BUY";
let slPriceLine = null;
let tpPriceLine = null;

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
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
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

  // Equity Curve Chart
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
    rightPriceScale: {
      borderColor: "#1E293B",
    },
    timeScale: {
      borderColor: "#1E293B",
      timeVisible: true,
    },
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

// Fetch historical candles and populate
async function loadCandles() {
  try {
    const res = await fetch(`/api/candles?symbol=${currentSymbol}`);
    const data = await res.json();
    if (data && data.length > 0) {
      candleSeries.setData(data);
    }
  } catch (err) {
    console.error("Failed to load candles:", err);
  }
}

// Fetch live quotes and update HUD
async function pollQuote() {
  try {
    const res = await fetch(`/api/quote?symbol=${currentSymbol}`);
    const q = await res.json();
    if (q && q.ltp) {
      document.getElementById("header-ltp").textContent = `$${q.ltp.toFixed(2)}`;
      document.getElementById("header-spread").textContent = `Spread: $${q.spread.toFixed(4)}`;
      
      // Update candle stream
      const lastCandle = {
        time: Math.floor(Date.now() / 60000) * 60,
        open: q.ltp,
        high: q.ltp,
        low: q.ltp,
        close: q.ltp
      };
      candleSeries.update(lastCandle);
    }
  } catch (err) {
    console.error("Quote poll error:", err);
  }
}

// Fetch full broker state (Account, Positions, Trades, Equity)
async function pollState() {
  try {
    const res = await fetch("/api/state");
    const state = await res.json();
    if (!state) return;

    // 1. Update HUD metrics
    const stats = state.stats;
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

    // 2. Update Equity Curve
    if (state.equity_curve && state.equity_curve.length > 0) {
      const eqData = state.equity_curve.map(pt => ({
        time: pt.time,
        value: pt.equity
      }));
      equitySeries.setData(eqData);
    }

    // 3. Update Positions & SL/TP lines
    updatePositions(state.positions);

    // 4. Update Tradebook Ledger & Chart Markers
    updateTradebook(state.trades);

  } catch (err) {
    console.error("State poll error:", err);
  }
}

function updatePositions(positions) {
  const container = document.getElementById("positions-list");
  const posKeys = Object.keys(positions);

  if (posKeys.length === 0) {
    container.innerHTML = '<div class="empty-state">No open positions. Ready for next order.</div>';
    if (slPriceLine) { candleSeries.removePriceLine(slPriceLine); slPriceLine = null; }
    if (tpPriceLine) { candleSeries.removePriceLine(tpPriceLine); tpPriceLine = null; }
    return;
  }

  container.innerHTML = "";
  posKeys.forEach(sym => {
    const p = positions[sym];
    const isLong = p.quantity > 0;
    const pnlClass = p.unrealized_pnl >= 0 ? "text-win" : "text-loss";

    const card = document.createElement("div");
    card.className = "pos-card";
    card.innerHTML = `
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
      <button class="btn-close-pos" onclick="closePosition('${p.symbol}')">CLOSE AT MARKET</button>
    `;
    container.appendChild(card);

    // Draw SL line on chart
    if (p.stop_loss) {
      if (!slPriceLine) {
        slPriceLine = candleSeries.createPriceLine({
          price: p.stop_loss,
          color: "#EF4444",
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: "STOP LOSS",
        });
      } else {
        slPriceLine.applyOptions({ price: p.stop_loss });
      }
    }

    // Draw TP line on chart
    if (p.take_profit) {
      if (!tpPriceLine) {
        tpPriceLine = candleSeries.createPriceLine({
          price: p.take_profit,
          color: "#10B981",
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: "TAKE PROFIT",
        });
      } else {
        tpPriceLine.applyOptions({ price: p.take_profit });
      }
    }
  });
}

function updateTradebook(trades) {
  const tbody = document.getElementById("trade-log-body");
  if (!trades || trades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No trades executed yet.</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  const markers = [];

  // Show newest on top
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

    // Chart Markers
    markers.push({
      time: Math.floor(new Date(t.entry_time).getTime() / 1000),
      position: t.action === "BUY" ? "belowBar" : "aboveBar",
      color: t.action === "BUY" ? "#10B981" : "#EF4444",
      shape: t.action === "BUY" ? "arrowUp" : "arrowDown",
      text: `${t.action} @ $${t.entry_price.toFixed(2)}`,
    });

    markers.push({
      time: Math.floor(new Date(t.exit_time).getTime() / 1000),
      position: isWin ? "aboveBar" : "belowBar",
      color: isWin ? "#10B981" : "#EF4444",
      shape: "circle",
      text: `${isWin ? '+' : ''}$${t.net_pnl.toFixed(2)} (${t.exit_reason})`,
    });
  });

  if (candleSeries && markers.length > 0) {
    try {
      candleSeries.setMarkers(markers);
    } catch (e) {}
  }
}

// Order Handlers
document.getElementById("btn-side-buy").addEventListener("click", () => {
  currentSide = "BUY";
  document.getElementById("btn-side-buy").classList.add("active");
  document.getElementById("btn-side-sell").classList.remove("active");
});

document.getElementById("btn-side-sell").addEventListener("click", () => {
  currentSide = "SELL";
  document.getElementById("btn-side-sell").classList.add("active");
  document.getElementById("btn-side-buy").classList.remove("active");
});

document.getElementById("order-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const qty = parseFloat(document.getElementById("order-qty").value) || 2;
  const tp = parseFloat(document.getElementById("order-tp").value) || null;
  const sl = parseFloat(document.getElementById("order-sl").value) || null;

  try {
    const res = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: currentSymbol,
        action: currentSide,
        quantity: qty,
        take_profit: tp,
        stop_loss: sl,
      }),
    });
    const data = await res.json();
    if (data.status === "success") {
      pollState();
    } else {
      alert("Order Rejected: " + data.message);
    }
  } catch (err) {
    alert("Order submission error: " + err);
  }
});

// Autonomous Agent Scalper Trigger
document.getElementById("btn-trigger-agent").addEventListener("click", async () => {
  const btn = document.getElementById("btn-trigger-agent");
  btn.textContent = "SNIPING TICKS ON BINANCE...";
  btn.disabled = true;

  try {
    const res = await fetch("/api/agent/trade", { method: "POST" });
    const data = await res.json();
    await pollState();
    alert(`Bot Trade Complete!\nResult: ${data.verdict}\nNet PnL: $${data.net_pnl}\nReason: ${data.reason}`);
  } catch (err) {
    alert("Bot execution failed: " + err);
  } finally {
    btn.textContent = "RUN BOT TRADE (AUTO-EXIT)";
    btn.disabled = false;
  }
});

async function closePosition(symbol) {
  try {
    await fetch("/api/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    pollState();
  } catch (err) {
    console.error("Close position error:", err);
  }
}

document.getElementById("btn-reset-demo").addEventListener("click", async () => {
  if (confirm("Reset account balance to $100.00 and clear trades?")) {
    await fetch("/api/reset", { method: "POST" });
    pollState();
  }
});

document.getElementById("btn-refresh-data").addEventListener("click", () => {
  loadCandles();
  pollState();
  pollQuote();
});

// Bootstrap
window.addEventListener("DOMContentLoaded", () => {
  initCharts();
  loadCandles();
  pollState();
  pollQuote();

  // Tick poll every 1 second
  setInterval(pollQuote, 1000);
  // State poll every 1.5 seconds
  setInterval(pollState, 1500);
});
