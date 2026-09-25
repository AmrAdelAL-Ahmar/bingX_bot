---
name: quant-trading-suite
description: >-
  Production-grade architectural framework, mathematical formulas, and algorithmic design patterns
  for building automated quantitative crypto trading bots and modular analysis engines (V1-V16+).
  Covers multi-timeframe analysis, SMC/ICT concepts, CCXT exchange execution, dynamic risk sizing,
  auto break-even, and Telegram bot interfaces.
---

# Quantitative Trading Suite: Production Design Patterns & Engine Architecture

This skill captures the complete architectural patterns, mathematical modeling, algorithmic trading engines, and risk management systems developed for automated cryptocurrency futures trading bots (utilizing **TypeScript**, **CCXT**, **TechnicalIndicators**, **Telegraf**, and **MongoDB**).

Use this skill whenever you are designing, building, testing, backtesting, or refactoring algorithmic trading systems, sniper engines, or automated exchange execution services.

---

## 1. System Architecture & Layered Separation

Always maintain strict separation of concerns across distinct architectural layers:

```
src/
├── config/             # Environment variables, exchange keys, risk parameters
├── core/               # Algorithmic trading brains & quantitative calculations
│   ├── analysis/       # Multi-Timeframe & multi-indicator analysis engines (V1 - V16)
│   ├── sniper/         # Real-time high-speed entry/exit sniper engines
│   ├── radar/          # Market scanner and opportunity discovery across pairs
│   ├── backtest/       # Historical simulation & backtesting frameworks
│   └── shared/         # Common interfaces (IEngine, ISniper, ITradeSignal)
├── services/           # External execution & business logic
│   ├── exchange/       # CCXT wrappers (BingXService, BinanceService, etc.)
│   ├── tradeManager.ts # Dynamic position sizing, risk budgeting, order placement
│   ├── positionMonitor.ts # Background poller (Auto Break-Even, Trailing SL, PnL alerts)
│   └── signalParser.ts # Regex-based multi-language trading signal parser
├── bot/                # User interface layer (Telegram / Webhook)
│   ├── keyboards/      # Interactive inline and reply keyboards
│   ├── handlers/       # Command, callback query, and signal listeners
│   └── middleware/     # Auth whitelist and rate-limiting
└── models/             # Database schemas (Trade.ts, User.ts, EngineConfig.ts)
```

---

## 2. Standard Engine Contract (Modular "Engine-as-a-Skill")

Every analysis or sniper engine must implement a standardized, decoupled interface. This enables seamless plug-and-play addition of new engines (e.g., `V17Engine`).

### Standard Engine Interface (`IEngine.ts`)

```typescript
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EngineInput {
  symbol: string;
  timeframes: {
    '1m'?: Candle[];
    '5m'?: Candle[];
    '15m'?: Candle[];
    '1h'?: Candle[];
    '4h'?: Candle[];
    '1d'?: Candle[];
  };
  currentPrice: number;
  additionalMetrics?: Record<string, any>;
}

export type SignalAction = 'BUY' | 'SELL' | 'NEUTRAL';

export interface EngineOutput {
  engineId: string;
  symbol: string;
  action: SignalAction;
  confidence: number; // 0 to 100%
  entryPrice: number;
  stopLoss: number;
  takeProfits: number[]; // [TP1, TP2, TP3, TP4]
  riskRewardRatio: number;
  reasons: string[];
  metadata: {
    regime?: string;
    confluenceScore?: number;
    indicators?: Record<string, number | string>;
  };
}

export interface ITradingEngine {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  analyze(input: EngineInput): Promise<EngineOutput>;
}
```

---

## 3. Mathematical & Quantitative Indicators Reference

When computing indicator-based signals, adhere strictly to these quantitative formulas:

### A. Relative Strength Index (RSI - 14)
$$\text{Gain} = \max(0, C_t - C_{t-1}), \quad \text{Loss} = \max(0, C_{t-1} - C_t)$$
$$\text{AvgGain}_N = \frac{\text{PriorAvgGain} \times (N - 1) + \text{Gain}}{N}$$
$$\text{AvgLoss}_N = \frac{\text{PriorAvgLoss} \times (N - 1) + \text{Loss}}{N}$$
$$RS = \frac{\text{AvgGain}_N}{\text{AvgLoss}_N}, \quad RSI = 100 - \frac{100}{1 + RS}$$
* **Oversold Threshold**: $RSI < 30$ (Bullish pullback)
* **Overbought Threshold**: $RSI > 70$ (Bearish exhaustion)

### B. Moving Average Convergence Divergence (MACD)
$$\text{MACD Line} = \text{EMA}_{12}(\text{Close}) - \text{EMA}_{26}(\text{Close})$$
$$\text{Signal Line} = \text{EMA}_9(\text{MACD Line})$$
$$\text{Histogram} = \text{MACD Line} - \text{Signal Line}$$

### C. Stochastic RSI (StochRSI)
$$\text{StochRSI} = \frac{RSI_{14} - \min(RSI_{14}, 14)}{\max(RSI_{14}, 14) - \min(RSI_{14}, 14)} \times 100$$
$$\%K = \text{SMA}_3(\text{StochRSI}), \quad \%D = \text{SMA}_3(\%K)$$

### D. Volume-Weighted Average Price (VWAP)
$$VWAP = \frac{\sum (TP_i \times V_i)}{\sum V_i}, \quad TP_i = \frac{\text{High}_i + \text{Low}_i + \text{Close}_i}{3}$$

---

## 4. Smart Money Concepts (SMC) & Institutional Liquidity Patterns

Advanced engines (V7 - V16) combine structural liquidity with statistical signals:

### A. Liquidity Sweep Detection
1. **Equal Highs/Lows (EQH/EQL)**: Identify liquidity pools resting above resistance or below support.
2. **The Sweep**: A candle wick pierces the swing high/low by $>0.05\%$, but the candle close remains inside the prior range.
3. **Institutional Order Block (OB)**: The last opposite-colored candle before an aggressive displacement impulse that breaks market structure (BoS).
4. **Fair Value Gap (FVG)**:
   * **Bullish FVG**: $\text{Low}(\text{Candle}_{t}) > \text{High}(\text{Candle}_{t-2})$ (Imbalance zone).
   * **Bearish FVG**: $\text{High}(\text{Candle}_{t}) < \text{Low}(\text{Candle}_{t-2})$.

### B. Multi-Timeframe (MTF) Confluence Matrix
Never execute against the dominant higher-timeframe trend. Calculate alignment score:
* **Higher Timeframe (1D / 4H)**: Sets Macro Direction bias ($\text{Bias} \in \{+1, -1\}$).
* **Intermediate Timeframe (1H / 15m)**: Identifies structure (CHoCH / BoS / Key Levels).
* **Execution Timeframe (5m / 1m)**: Precision entry triggers (Sweep + FVG retest + Momentum confirmation).
$$\text{Confluence Score} = \sum_{tf \in TF} w_{tf} \cdot \text{Signal}_{tf}$$

---

## 5. Quantitative Risk Management & Capital Preservation Rules

Trading success relies heavily on mathematical risk rules rather than prediction accuracy alone. Enforce these constraints programmatically in `TradeManager`:

### A. Dynamic Position Sizing Formula
Never allocate arbitrary margin. Size positions based on the exact distance to stop loss:
$$\text{Risk Amount (\USD)} = \text{Wallet Balance} \times \text{Risk Percentage (e.g., 2\%)}$$
$$\text{Distance to Stop Loss} = \frac{|\text{Entry Price} - \text{Stop Loss Price}|}{\text{Entry Price}}$$
$$\text{Position Size (Notional)} = \frac{\text{Risk Amount}}{\text{Distance to Stop Loss}}$$
$$\text{Contracts / Quantity} = \frac{\text{Position Size}}{\text{Entry Price}}$$

### B. Hard Risk Caps
* **Max Total Margin Saturation**: Total active margin allocated across all trades must never exceed **10%** of total wallet equity.
* **Max Loss Per Trade**: Worst-case liquidation or full SL hit must never exceed **6%** of account balance. If the calculated position size causes $>6\%$ drawdown on SL, scale down the contracts automatically.

### C. Active Position Management (Automated Break-Even)
In `PositionMonitor`:
* **TP1 Hit Trigger**: As soon as the market price reaches Take Profit 1 ($TP1$), immediately issue an exchange order modifying the Stop Loss to **Entry Price** ($\text{SL} \leftarrow \text{Entry}$).
* **Floating Drawdown Alert**: If any open position reaches $-5\%$ unrealized PnL relative to initial wallet capital, dispatch an immediate high-priority warning to the trader.

---

## 6. Exchange Integration Guidelines (CCXT & Futures API)

When interfacing with exchanges (e.g., BingX, Binance, Bybit via CCXT):

1. **Leverage & Margin Mode**:
   * Always set `marginMode: 'isolated'` before opening positions to prevent cross-account liquidations.
   * Adjust leverage dynamically per asset volatility using `setLeverage(leverage, symbol)`.
2. **Order Execution Safety**:
   * For market orders, fetch order book tick size and precision first to prevent `InvalidPrecision` errors.
   * When attaching Stop Loss / Take Profit orders, use exchange-native bracket orders (`stopLoss`, `takeProfit`) where supported, or register conditional trigger orders immediately after market fill.
3. **Rate Limit Resilience**:
   * Enable `enableRateLimit: true` in CCXT client initialization.
   * Wrap exchange calls in exponential backoff retry loops for network timeouts.

---

## 7. Adding a New Engine (Step-by-Step Workflow)

When adding a new engine (e.g., `V17Engine.ts`):

1. **Create the Engine File**:
   * Create `src/core/analysis/engines/V17Engine.ts` implementing `ITradingEngine`.
2. **Implement Analysis Logic**:
   * Extract indicators using `technicalindicators` or custom mathematical formulas.
   * Calculate Bullish and Bearish confluence points.
   * Calculate dynamic `Stop Loss` (e.g., $1.5 \times ATR$ below entry swing) and multi-level targets based on Fibonacci or Key Levels ($1:1.5, 1:2.5, 1:4$).
3. **Register in the Engine Registry**:
   * Add the engine instance to `EngineRegistry.ts` or `SniperRegistry.ts`.
4. **Expose in User Interface**:
   * Add keyboard trigger button in `analysisKeyboards.ts`.
   * Register message handler in `analysisHandlers.ts`.
5. **Add Unit / Verification Test**:
   * Create a verification script (e.g., `test_v17_engine.ts`) passing simulated OHLCV data to confirm calculations.
