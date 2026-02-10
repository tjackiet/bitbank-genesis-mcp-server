/**
 * lib/backtest_engine.ts - 汎用バックテストエンジン
 *
 * シグナルからトレードを生成し、エクイティ・ドローダウンを計算
 */

import type { Candle, Trade, EquityPoint, DrawdownPoint } from '../types.js';
import type { Signal, Strategy, StrategyConfig, Overlay } from './strategies/types.js';
import { calculateEquityAndDrawdown } from './equity.js';

/**
 * バックテスト入力
 */
export interface BacktestEngineInput {
  pair: string;
  timeframe: string;
  period: string;
  strategy: StrategyConfig;
  fee_bp: number;
  execution: 't+1_open';
}

/**
 * バックテストサマリー
 */
export interface BacktestEngineSummary {
  /** 複利計算による総損益[%] */
  total_pnl_pct: number;
  trade_count: number;
  win_rate: number;
  /** 0以上。最大ドローダウン[%] */
  max_drawdown_pct: number;
  /** Buy&Hold との比較 */
  buy_hold_pnl_pct: number;
  /** 超過リターン（戦略 - Buy&Hold） */
  excess_return_pct: number;
  /** Profit Factor: 総利益 / 総損失（損失がない場合 null） */
  profit_factor: number | null;
  /** 年率換算 Sharpe Ratio（日次リターンベース） */
  sharpe_ratio: number | null;
  /** 1トレードあたり平均損益[%] */
  avg_pnl_pct: number;
}

/**
 * バックテスト結果
 */
export interface BacktestEngineResult {
  input: BacktestEngineInput;
  summary: BacktestEngineSummary;
  trades: Trade[];
  equity_curve: EquityPoint[];
  drawdown_curve: DrawdownPoint[];
  overlays: Overlay[];
}

/**
 * シグナル配列からトレードを実行
 *
 * @param candles ローソク足データ
 * @param signals シグナル配列
 * @param fee_bp 片道手数料（basis points）
 * @returns トレード配列
 */
export function executeTradesFromSignals(
  candles: Candle[],
  signals: Signal[],
  fee_bp: number
): Trade[] {
  const trades: Trade[] = [];
  let position: 'none' | 'long' = 'none';
  let entryTime = '';
  let entryPrice = 0;

  for (let i = 0; i < signals.length - 1; i++) {
    const signal = signals[i];
    const nextCandle = candles[i + 1];

    if (!nextCandle) continue;

    // t+1 open で執行
    const execPrice = nextCandle.open;
    const execTime = nextCandle.time;

    // エントリー
    if (position === 'none' && signal.action === 'buy') {
      position = 'long';
      entryTime = execTime;
      entryPrice = execPrice;
    }
    // エグジット
    else if (position === 'long' && signal.action === 'sell') {
      // 往復手数料率（乗数）
      const feeMultiplier = 1 - (fee_bp / 10000) * 2;

      // グロスリターン乗数
      const grossReturn = execPrice / entryPrice;

      // ネットリターン乗数（手数料控除後）
      const netReturn = grossReturn * feeMultiplier;

      // 表示用パーセント
      const pnlPct = (netReturn - 1) * 100;
      const feePct = (1 - feeMultiplier) * 100;

      trades.push({
        entry_time: entryTime,
        entry_price: entryPrice,
        exit_time: execTime,
        exit_price: execPrice,
        pnl_pct: Number(pnlPct.toFixed(4)),
        fee_pct: Number(feePct.toFixed(4)),
        net_return: Number(netReturn.toFixed(6)),
      });

      position = 'none';
    }
  }

  return trades;
}

/**
 * Profit Factor を計算
 * 総利益 / 総損失（abs）。損失がゼロの場合 null。
 */
function calcProfitFactor(trades: Trade[]): number | null {
  let grossProfit = 0;
  let grossLoss = 0;
  for (const t of trades) {
    if (t.pnl_pct > 0) grossProfit += t.pnl_pct;
    else if (t.pnl_pct < 0) grossLoss += Math.abs(t.pnl_pct);
  }
  if (grossLoss === 0) return grossProfit > 0 ? null : null; // 全勝 or トレードなし
  return Number((grossProfit / grossLoss).toFixed(2));
}

/**
 * 年率換算 Sharpe Ratio を日次エクイティカーブから計算
 * Sharpe = mean(daily_return) / stdev(daily_return) * sqrt(365)
 */
function calcSharpeRatio(equityCurve: EquityPoint[]): number | null {
  if (equityCurve.length < 2) return null;

  // 日次リターン（equity_pct の差分をパーセントで）
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prevEq = 1 + equityCurve[i - 1].equity_pct / 100;
    const currEq = 1 + equityCurve[i].equity_pct / 100;
    if (prevEq > 0) {
      dailyReturns.push((currEq / prevEq) - 1);
    }
  }
  if (dailyReturns.length < 2) return null;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return null;

  // 暗号資産: 年間 365 日
  const sharpe = (mean / stdev) * Math.sqrt(365);
  return Number(sharpe.toFixed(2));
}

/**
 * サマリー統計を計算（複利）
 */
export function calculateSummary(
  trades: Trade[],
  maxDrawdown: number,
  candles: Candle[],
  equityCurve: EquityPoint[]
): BacktestEngineSummary {
  // Buy&Hold の計算
  let buyHoldPnlPct = 0;
  if (candles.length >= 2) {
    const firstClose = candles[0].close;
    const lastClose = candles[candles.length - 1].close;
    buyHoldPnlPct = ((lastClose - firstClose) / firstClose) * 100;
  }

  if (trades.length === 0) {
    return {
      total_pnl_pct: 0,
      trade_count: 0,
      win_rate: 0,
      max_drawdown_pct: 0,
      buy_hold_pnl_pct: Number(buyHoldPnlPct.toFixed(2)),
      excess_return_pct: Number((-buyHoldPnlPct).toFixed(2)),
      profit_factor: null,
      sharpe_ratio: calcSharpeRatio(equityCurve),
      avg_pnl_pct: 0,
    };
  }

  // 複利で総損益を計算
  const totalReturn = trades.reduce((acc, t) => acc * t.net_return, 1.0);
  const totalPnlPct = (totalReturn - 1) * 100;

  const wins = trades.filter(t => t.pnl_pct > 0).length;
  const excessReturn = totalPnlPct - buyHoldPnlPct;
  const avgPnl = trades.reduce((s, t) => s + t.pnl_pct, 0) / trades.length;

  return {
    total_pnl_pct: Number(totalPnlPct.toFixed(2)),
    trade_count: trades.length,
    win_rate: Number((wins / trades.length).toFixed(4)),
    max_drawdown_pct: Number(maxDrawdown.toFixed(2)),
    buy_hold_pnl_pct: Number(buyHoldPnlPct.toFixed(2)),
    excess_return_pct: Number(excessReturn.toFixed(2)),
    profit_factor: calcProfitFactor(trades),
    sharpe_ratio: calcSharpeRatio(equityCurve),
    avg_pnl_pct: Number(avgPnl.toFixed(2)),
  };
}

/**
 * バックテストを実行
 *
 * @param candles ローソク足データ
 * @param strategy 戦略オブジェクト
 * @param input バックテスト入力パラメータ
 * @returns バックテスト結果
 */
export function runBacktestEngine(
  candles: Candle[],
  strategy: Strategy,
  input: BacktestEngineInput
): BacktestEngineResult {
  const params = { ...strategy.defaultParams, ...input.strategy.params };

  // 1. シグナル生成
  const signals = strategy.generate(candles, params);

  // 2. トレード実行
  const trades = executeTradesFromSignals(candles, signals, input.fee_bp);

  // 3. エクイティ・ドローダウン計算
  const { equity_curve, drawdown_curve, max_drawdown } = calculateEquityAndDrawdown(trades, candles);

  // 4. サマリー計算
  const summary = calculateSummary(trades, max_drawdown, candles, equity_curve);

  // 5. オーバーレイデータ取得
  const overlays = strategy.getOverlays(candles, params);

  return {
    input,
    summary,
    trades,
    equity_curve,
    drawdown_curve,
    overlays,
  };
}
