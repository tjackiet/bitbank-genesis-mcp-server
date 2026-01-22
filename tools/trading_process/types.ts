/**
 * trading_process/types.ts - バックテスト用型定義
 * 
 * 【重要な定義】
 * - エクイティ: 複利で計算。初期値1.0（=100%）、表示用は (equity - 1) * 100
 * - ドローダウン: エクイティベースの割合。0以上の下落幅[%]
 * - 総損益: 複利計算 Π(1 + return) - 1
 */

export type Timeframe = '1D' | '1H' | '4H';
export type Period = '1M' | '3M' | '6M';

export interface BacktestInput {
  pair: string;
  timeframe: Timeframe;
  period: Period;
  sma_short: number;
  sma_long: number;
  fee_bp: number;
  execution: 't+1_open';
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Trade {
  entry_time: string;
  entry_price: number;
  exit_time: string;
  exit_price: number;
  /** 表示用 損益率[%]。例: -10.59 */
  pnl_pct: number;
  /** 表示用 手数料率[%] */
  fee_pct: number;
  /** 計算用 純リターン乗数。例: 0.9388 = -6.12%。equity *= net_return で複利計算 */
  net_return: number;
}

export interface EquityPoint {
  time: string;
  /** 表示用 累積損益[%] = (equity - 1) * 100。含み損益込み */
  equity_pct: number;
  /** 確定損益[%]。トレード決済時のみ更新される */
  confirmed_pct: number;
}

export interface DrawdownPoint {
  time: string;
  /** 0以上。ピークからの下落幅[%]。例: 18.31 (表示時に -18.31% とする) */
  drawdown_pct: number;
}

export interface BacktestSummary {
  /** 複利計算による総損益[%]。Π(1 + return) - 1 */
  total_pnl_pct: number;
  trade_count: number;
  win_rate: number;
  /** 0以上。最大ドローダウン[%]。表示時に -XX% とする */
  max_drawdown_pct: number;
}

export interface BacktestResult {
  input: BacktestInput;
  summary: BacktestSummary;
  trades: Trade[];
  equity_curve: EquityPoint[];
  drawdown_curve: DrawdownPoint[];
}

export interface BacktestChartData {
  candles: Candle[];
  smaShort: number[];
  smaLong: number[];
  trades: Trade[];
  equity_curve: EquityPoint[];
  drawdown_curve: DrawdownPoint[];
  input: BacktestInput;
  summary?: BacktestSummary;
}
