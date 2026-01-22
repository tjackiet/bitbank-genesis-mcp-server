/**
 * run_backtest_sma.ts - SMAクロスオーバー戦略のバックテスト
 *
 * 入力:
 * - pair: 通貨ペア (例: "btc_jpy")
 * - timeframe: 時間軸 (現状 "1D" のみ)
 * - period: 期間 ("1M" | "3M" | "6M")
 * - sma_short: 短期SMA期間
 * - sma_long: 長期SMA期間
 * - fee_bp: 片道手数料 (basis points)
 * - execution: 執行タイミング ("t+1_open" 固定)
 *
 * 戦略:
 * - エントリー: sma_short > sma_long にクロス（ゴールデンクロス）
 * - エグジット: sma_short < sma_long にクロス（デッドクロス）
 * - 売買は翌足始値(t+1 open)で執行
 *
 * 計算仕様:
 * - エクイティは複利で計算（equity *= net_return）
 * - 総損益は Π(net_return) - 1 で計算
 * - ドローダウンはエクイティベースの割合
 *
 * 出力:
 * - サマリー: 総損益, トレード回数, 勝率, 最大ドローダウン
 * - トレード一覧
 * - エクイティカーブ
 * - ドローダウンカーブ
 * - 固定4段チャート(SVG)
 */

import { fetchCandlesForBacktest } from './lib/fetch_candles.js';
import { calculateSMA } from './lib/sma.js';
import { calculateEquityAndDrawdown } from './lib/equity.js';
import { renderBacktestChart } from './render_backtest_chart.js';
import type {
  BacktestInput,
  BacktestResult,
  BacktestSummary,
  Trade,
  Candle,
  Timeframe,
  Period,
} from './types.js';

export interface RunBacktestSmaOutput {
  ok: true;
  summary: string;
  data: BacktestResult;
  svg: string;
}

export interface RunBacktestSmaError {
  ok: false;
  error: string;
}

export type RunBacktestSmaResult = RunBacktestSmaOutput | RunBacktestSmaError;

/**
 * SMAクロスオーバー戦略のバックテストを実行
 */
export default async function runBacktestSma(
  pair: string,
  timeframe: Timeframe = '1D',
  period: Period = '3M',
  sma_short: number = 5,
  sma_long: number = 20,
  fee_bp: number = 12,
  execution: 't+1_open' = 't+1_open'
): Promise<RunBacktestSmaResult> {
  try {
    // バリデーション
    if (sma_short >= sma_long) {
      return { ok: false, error: 'sma_short must be less than sma_long' };
    }
    if (sma_short < 2) {
      return { ok: false, error: 'sma_short must be at least 2' };
    }
    if (fee_bp < 0) {
      return { ok: false, error: 'fee_bp must be non-negative' };
    }

    const input: BacktestInput = {
      pair,
      timeframe,
      period,
      sma_short,
      sma_long,
      fee_bp,
      execution,
    };

    // 1. ローソク足取得
    const candles = await fetchCandlesForBacktest(pair, timeframe, period, sma_long);

    if (candles.length < sma_long + 10) {
      return { ok: false, error: `Insufficient candle data: ${candles.length} bars (need at least ${sma_long + 10})` };
    }

    // 2. SMA計算
    const closes = candles.map(c => c.close);
    const smaShortValues = calculateSMA(closes, sma_short);
    const smaLongValues = calculateSMA(closes, sma_long);

    // 3. シグナル生成 & トレード実行
    const trades = executeStrategy(candles, smaShortValues, smaLongValues, input);

    // 4. エクイティ・ドローダウン計算（複利）
    const { equity_curve, drawdown_curve, max_drawdown } = calculateEquityAndDrawdown(trades, candles);

    // 5. サマリー計算（複利）
    const summary = calculateSummary(trades, max_drawdown);

    // 6. 結果オブジェクト構築
    const result: BacktestResult = {
      input,
      summary,
      trades,
      equity_curve,
      drawdown_curve,
    };

    // 7. 固定4段チャート描画
    const svg = renderBacktestChart({
      candles,
      smaShort: smaShortValues,
      smaLong: smaLongValues,
      trades,
      equity_curve,
      drawdown_curve,
      input,
      summary,
    });

    // 8. サマリーテキスト生成
    const summaryText = generateSummaryText(input, summary, trades.length > 0 ? trades : []);

    return {
      ok: true,
      summary: summaryText,
      data: result,
      svg,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

/**
 * SMAクロスオーバー戦略を実行
 * 
 * 【重要】
 * - 売買は翌足始値（t+1 open）で執行
 * - net_return は複利計算用の乗数（例: 0.9388 = -6.12%）
 * - pnl_pct は表示用のパーセント（例: -6.12）
 */
function executeStrategy(
  candles: Candle[],
  smaShort: number[],
  smaLong: number[],
  input: BacktestInput
): Trade[] {
  const trades: Trade[] = [];
  let position: 'none' | 'long' = 'none';
  let entryTime = '';
  let entryPrice = 0;

  // sma_long が有効になる最初のインデックス + 1 から開始（安全マージン）
  const startIdx = input.sma_long;

  for (let i = startIdx; i < candles.length - 1; i++) {
    const prevShort = smaShort[i - 1];
    const prevLong = smaLong[i - 1];
    const currShort = smaShort[i];
    const currLong = smaLong[i];

    // NaN チェック
    if (isNaN(prevShort) || isNaN(prevLong) || isNaN(currShort) || isNaN(currLong)) {
      continue;
    }

    // t+1 open で執行
    const execPrice = candles[i + 1].open;
    const execTime = candles[i + 1].time;

    // エントリー: ゴールデンクロス (short > long にクロス)
    if (position === 'none' && prevShort <= prevLong && currShort > currLong) {
      position = 'long';
      entryTime = execTime;
      entryPrice = execPrice;
    }
    // エグジット: デッドクロス (short < long にクロス)
    else if (position === 'long' && prevShort >= prevLong && currShort < currLong) {
      // 往復手数料率（乗数）
      // fee_bp=12 → 片道 0.12% → 往復 0.24% → 乗数 0.9976
      const feeMultiplier = 1 - (input.fee_bp / 10000) * 2;

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
 * サマリー統計を計算（複利）
 * 
 * 【計算仕様】
 * - 総損益: Π(net_return) - 1 → パーセントに変換
 * - ドローダウン: 0以上の値として受け取り、そのまま保持
 */
function calculateSummary(trades: Trade[], maxDrawdown: number): BacktestSummary {
  if (trades.length === 0) {
    return {
      total_pnl_pct: 0,
      trade_count: 0,
      win_rate: 0,
      max_drawdown_pct: 0,
    };
  }

  // 複利で総損益を計算
  const totalReturn = trades.reduce((acc, t) => acc * t.net_return, 1.0);
  const totalPnlPct = (totalReturn - 1) * 100;

  const wins = trades.filter(t => t.pnl_pct > 0).length;

  return {
    total_pnl_pct: Number(totalPnlPct.toFixed(2)),
    trade_count: trades.length,
    win_rate: Number((wins / trades.length).toFixed(4)),
    max_drawdown_pct: Number(maxDrawdown.toFixed(2)),
  };
}

/**
 * サマリーテキストを生成
 */
function generateSummaryText(
  input: BacktestInput,
  summary: BacktestSummary,
  trades: Trade[]
): string {
  const lines: string[] = [];

  lines.push(`=== SMA Backtest Result ===`);
  lines.push(`Pair: ${input.pair.toUpperCase()}`);
  lines.push(`Period: ${input.period} (${input.timeframe})`);
  lines.push(`Strategy: SMA(${input.sma_short}) x SMA(${input.sma_long}) Crossover`);
  lines.push(`Execution: ${input.execution}`);
  lines.push(`Fee: ${input.fee_bp} bp (round-trip: ${input.fee_bp * 2} bp)`);
  lines.push('');
  lines.push(`--- Summary (Compound) ---`);
  lines.push(`Total P&L: ${summary.total_pnl_pct >= 0 ? '+' : ''}${summary.total_pnl_pct.toFixed(2)}%`);
  lines.push(`Trades: ${summary.trade_count}`);
  lines.push(`Win Rate: ${(summary.win_rate * 100).toFixed(1)}%`);
  lines.push(`Max Drawdown: -${summary.max_drawdown_pct.toFixed(2)}%`);

  if (trades.length > 0) {
    lines.push('');
    lines.push(`--- Recent Trades (last 5) ---`);
    const recentTrades = trades.slice(-5);
    for (const t of recentTrades) {
      const entryDate = t.entry_time.split('T')[0];
      const exitDate = t.exit_time.split('T')[0];
      const pnlSign = t.pnl_pct >= 0 ? '+' : '';
      lines.push(`${entryDate} → ${exitDate}: ${pnlSign}${t.pnl_pct.toFixed(2)}% (×${t.net_return.toFixed(4)})`);
    }
  }

  return lines.join('\n');
}
