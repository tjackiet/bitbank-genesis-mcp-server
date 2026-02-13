/**
 * render_backtest_chart.ts - バックテスト結果の固定4段チャート描画
 *
 * 構成（固定）:
 * - 上段: 価格チャート（終値 + SMA + 売買シグナル）
 * - 中段1: エクイティカーブ（Strategy vs Buy & Hold）- 含み損益ベース
 * - 中段2: ドローダウン（%）- 負の値で表示、新ピーク更新で0に回復
 * - 下段: ポジション状態（Long / No Position）
 *
 * 【重要】
 * - 売買マーカーは exec足（entry_time/exit_time）の **open 価格** に描画
 * - エクイティは含み損益ベース（ポジション中は時価評価）
 * - ドローダウンは負の値で表示（0が上、-20%が下）
 * - 配色・レイアウトは固定し、LLMに判断させない
 */

import type { BacktestChartData, Trade, Candle } from './types.js';
import { dayjs } from '../../lib/datetime.js';

// === 固定配色 ===
const COLORS = {
  background: '#1a1a2e',
  grid: '#2d2d44',
  text: '#e0e0e0',
  textMuted: '#888899',
  // 価格チャート
  price: '#60a5fa',           // 終値ライン（青）
  smaShort: '#fbbf24',        // 短期SMA（黄）
  smaLong: '#a78bfa',         // 長期SMA（紫）
  entryMarker: '#22c55e',     // エントリー（緑）
  exitMarker: '#ef4444',      // エグジット（赤）
  // エクイティ
  strategy: '#3b82f6',        // 戦略エクイティ（青）
  buyHold: '#9ca3af',         // Buy & Hold（グレー）
  // ドローダウン
  drawdown: '#f87171',        // ドローダウン（赤）
  drawdownFill: 'rgba(248, 113, 113, 0.4)',
  // ポジション
  positionLong: '#4ade80',    // ロングポジション（緑）
  zeroline: '#4b5563',
};

// === 固定レイアウト ===
const LAYOUT = {
  width: 1000,
  height: 800,
  margin: { top: 70, right: 120, bottom: 40, left: 80 },
  // 4段の高さ配分
  priceHeight: 250,
  equityHeight: 180,
  drawdownHeight: 100,
  positionHeight: 50,
  gapBetweenPanels: 25,
};

/**
 * 数値を価格フォーマット
 */
function formatPrice(price: number): string {
  if (price >= 1000000) {
    return `${(price / 1000000).toFixed(2)}M`;
  }
  if (price >= 1000) {
    return `${(price / 1000).toFixed(1)}K`;
  }
  return price.toFixed(0);
}

/**
 * パーセントフォーマット
 */
function formatPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/**
 * 日付フォーマット（YYYY-MM）
 */
function formatDateShort(isoTime: string): string {
  return dayjs(isoTime).format('YYYY-MM');
}

/**
 * Y軸のグリッドラインを生成
 */
function generateYTicks(min: number, max: number, count: number): number[] {
  const range = max - min;
  const step = range / (count - 1);
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push(min + step * i);
  }
  return ticks;
}

/**
 * Buy & Hold エクイティを計算（含み損益ベース）
 * 
 * 【重要】最初のキャンドルから計算開始（Strategy と同じ基準点）
 */
function calculateBuyHoldEquity(candles: { close: number }[]): number[] {
  const result: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return result;

  // 最初のキャンドルを基準に計算
  const basePrice = candles[0].close;
  for (let i = 0; i < candles.length; i++) {
    result[i] = ((candles[i].close - basePrice) / basePrice) * 100;
  }
  return result;
}

/**
 * ポジション状態を計算（各キャンドルでLong or None）
 */
function calculatePositionState(
  candles: { time: string }[],
  trades: Trade[]
): ('long' | 'none')[] {
  const result: ('long' | 'none')[] = new Array(candles.length).fill('none');

  for (const trade of trades) {
    const entryIdx = candles.findIndex(c => c.time === trade.entry_time);
    const exitIdx = candles.findIndex(c => c.time === trade.exit_time);

    if (entryIdx >= 0 && exitIdx >= 0) {
      for (let i = entryIdx; i <= exitIdx; i++) {
        result[i] = 'long';
      }
    }
  }

  return result;
}

/**
 * メイン描画関数
 */
export function renderBacktestChart(data: BacktestChartData): string {
  const { candles, smaShort, smaLong, trades, equity_curve, drawdown_curve, input, summary } = data;

  const { width, height, margin, priceHeight, equityHeight, drawdownHeight, positionHeight, gapBetweenPanels } = LAYOUT;

  // 描画範囲
  const plotWidth = width - margin.left - margin.right;

  // X軸スケール（インデックスベース）
  const xScale = (i: number) => margin.left + (i / (candles.length - 1)) * plotWidth;

  // 戦略開始インデックス（SMA long が計算可能になる点）
  const strategyStartIdx = input.sma_long;

  // Buy & Hold エクイティを計算
  const buyHoldEquity = calculateBuyHoldEquity(candles);
  const finalBuyHold = buyHoldEquity[buyHoldEquity.length - 1] || 0;

  // ポジション状態を計算
  const positionState = calculatePositionState(candles, trades);

  // トレードの exec足インデックスと価格のマッピング
  const tradeEntryMarkers: { idx: number; price: number; trade: Trade }[] = [];
  const tradeExitMarkers: { idx: number; price: number; trade: Trade }[] = [];
  for (const t of trades) {
    const entryIdx = candles.findIndex(c => c.time === t.entry_time);
    const exitIdx = candles.findIndex(c => c.time === t.exit_time);
    if (entryIdx >= 0) {
      tradeEntryMarkers.push({ idx: entryIdx, price: t.entry_price, trade: t });
    }
    if (exitIdx >= 0) {
      tradeExitMarkers.push({ idx: exitIdx, price: t.exit_price, trade: t });
    }
  }

  // === パネル位置計算 ===
  const priceTop = margin.top;
  const priceBottom = priceTop + priceHeight;

  const equityTop = priceBottom + gapBetweenPanels;
  const equityBottom = equityTop + equityHeight;

  const ddTop = equityBottom + gapBetweenPanels;
  const ddBottom = ddTop + drawdownHeight;

  const posTop = ddBottom + gapBetweenPanels;
  const posBottom = posTop + positionHeight;

  // === 価格チャートのスケール ===
  const validPrices = candles.map(c => c.close);
  const validSmaShort = smaShort.filter(v => !isNaN(v));
  const validSmaLong = smaLong.filter(v => !isNaN(v));
  const markerPrices = [
    ...tradeEntryMarkers.map(m => m.price),
    ...tradeExitMarkers.map(m => m.price),
  ];
  const allPrices = [...validPrices, ...validSmaShort, ...validSmaLong, ...markerPrices];
  const priceMin = Math.min(...allPrices) * 0.995;
  const priceMax = Math.max(...allPrices) * 1.005;
  const priceYScale = (p: number) => priceBottom - ((p - priceMin) / (priceMax - priceMin)) * priceHeight;

  // === エクイティのスケール ===
  const strategyEquity = equity_curve.map(e => e.equity_pct);
  const allEquity = [...strategyEquity, ...buyHoldEquity];
  const equityMin = Math.min(...allEquity, 0) * 1.1;
  const equityMax = Math.max(...allEquity, 0) * 1.1;
  const equityRange = Math.max(equityMax - equityMin, 10);
  const equityYScale = (pct: number) => equityBottom - ((pct - equityMin) / equityRange) * equityHeight;

  // === ドローダウンのスケール ===
  // drawdown_pct は 0以上の値。表示は負の値（0が上、-maxが下）
  const ddValues = drawdown_curve.map(d => d.drawdown_pct);
  const ddMax = Math.max(...ddValues, 5);
  // ddNegative: 負の値に変換した表示用（0 → 0, 17.5 → -17.5）
  // Y軸: 0が上端(ddTop)、-ddMaxが下端(ddBottom)
  const ddYScale = (ddPositive: number) => ddTop + (ddPositive / ddMax) * (drawdownHeight - 10);

  // === SVG構築（レスポンシブ: viewBox のみ指定）===
  const svg: string[] = [];

  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="max-width:100%;height:auto;">`);

  // 背景
  svg.push(`<rect width="${width}" height="${height}" fill="${COLORS.background}"/>`);

  // === タイトル ===
  const finalStrategy = summary?.total_pnl_pct ?? strategyEquity[strategyEquity.length - 1] ?? 0;
  const tradeCount = summary?.trade_count ?? trades.length;
  const winRate = summary?.win_rate ?? (trades.length > 0 ? trades.filter(t => t.pnl_pct > 0).length / trades.length : 0);
  const maxDD = summary?.max_drawdown_pct ?? Math.max(...ddValues);

  svg.push(`<text x="${width / 2}" y="25" fill="${COLORS.text}" font-size="16" font-weight="bold" text-anchor="middle">`);
  svg.push(`SMA Cross Strategy Backtest (SMA${input.sma_short} x SMA${input.sma_long})</text>`);

  svg.push(`<text x="${width / 2}" y="48" fill="${COLORS.textMuted}" font-size="12" text-anchor="middle">`);
  svg.push(`${input.pair.toUpperCase()} | ${input.period} | Trades: ${tradeCount} | Win Rate: ${(winRate * 100).toFixed(1)}% | Max DD: -${maxDD.toFixed(1)}%</text>`);

  // === 上段: 価格チャート ===
  const priceTicks = generateYTicks(priceMin, priceMax, 5);
  for (const tick of priceTicks) {
    const y = priceYScale(tick);
    svg.push(`<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="${COLORS.grid}" stroke-dasharray="2,2"/>`);
    svg.push(`<text x="${width - margin.right + 5}" y="${y + 4}" fill="${COLORS.textMuted}" font-size="10">${formatPrice(tick)}</text>`);
  }

  // 終値ライン
  const pricePath = candles.map((c, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${priceYScale(c.close).toFixed(1)}`).join(' ');
  svg.push(`<path d="${pricePath}" fill="none" stroke="${COLORS.price}" stroke-width="1.5"/>`);

  // SMA Short
  const smaShortPath = smaShort.map((v, i) => {
    if (isNaN(v)) return '';
    const x = xScale(i).toFixed(1);
    const y = priceYScale(v).toFixed(1);
    return `${i === input.sma_short - 1 ? 'M' : 'L'}${x},${y}`;
  }).filter(Boolean).join(' ');
  if (smaShortPath) {
    svg.push(`<path d="${smaShortPath}" fill="none" stroke="${COLORS.smaShort}" stroke-width="1.5"/>`);
  }

  // SMA Long
  const smaLongPath = smaLong.map((v, i) => {
    if (isNaN(v)) return '';
    const x = xScale(i).toFixed(1);
    const y = priceYScale(v).toFixed(1);
    return `${i === input.sma_long - 1 ? 'M' : 'L'}${x},${y}`;
  }).filter(Boolean).join(' ');
  if (smaLongPath) {
    svg.push(`<path d="${smaLongPath}" fill="none" stroke="${COLORS.smaLong}" stroke-width="1.5"/>`);
  }

  // エントリーマーカー
  for (const marker of tradeEntryMarkers) {
    const x = xScale(marker.idx);
    const y = priceYScale(marker.price);
    svg.push(`<circle cx="${x}" cy="${y}" r="6" fill="${COLORS.entryMarker}" stroke="#fff" stroke-width="1.5"/>`);
    svg.push(`<text x="${x}" y="${y - 12}" fill="${COLORS.entryMarker}" font-size="10" font-weight="bold" text-anchor="middle">▲</text>`);
  }

  // エグジットマーカー
  for (const marker of tradeExitMarkers) {
    const x = xScale(marker.idx);
    const y = priceYScale(marker.price);
    svg.push(`<circle cx="${x}" cy="${y}" r="6" fill="${COLORS.exitMarker}" stroke="#fff" stroke-width="1.5"/>`);
    svg.push(`<text x="${x}" y="${y + 18}" fill="${COLORS.exitMarker}" font-size="10" font-weight="bold" text-anchor="middle">▼</text>`);
  }

  // 価格チャート凡例
  svg.push(`<text x="${margin.left + 10}" y="${priceTop + 15}" fill="${COLORS.price}" font-size="10">● Close</text>`);
  svg.push(`<text x="${margin.left + 70}" y="${priceTop + 15}" fill="${COLORS.smaShort}" font-size="10">● SMA${input.sma_short}</text>`);
  svg.push(`<text x="${margin.left + 140}" y="${priceTop + 15}" fill="${COLORS.smaLong}" font-size="10">● SMA${input.sma_long}</text>`);
  svg.push(`<text x="${margin.left + 210}" y="${priceTop + 15}" fill="${COLORS.entryMarker}" font-size="10">▲ Entry</text>`);
  svg.push(`<text x="${margin.left + 280}" y="${priceTop + 15}" fill="${COLORS.exitMarker}" font-size="10">▼ Exit</text>`);

  // === 中段1: エクイティカーブ ===
  // タイトルと凡例を横並びに配置
  svg.push(`<text x="${margin.left}" y="${equityTop - 5}" fill="${COLORS.text}" font-size="11" font-weight="bold">Equity (%)</text>`);
  svg.push(`<circle cx="${margin.left + 80}" cy="${equityTop - 9}" r="4" fill="${COLORS.strategy}"/>`);
  svg.push(`<text x="${margin.left + 90}" y="${equityTop - 5}" fill="${COLORS.strategy}" font-size="10">Strategy (${formatPct(finalStrategy)})</text>`);
  svg.push(`<circle cx="${margin.left + 220}" cy="${equityTop - 9}" r="4" fill="${COLORS.buyHold}"/>`);
  svg.push(`<text x="${margin.left + 230}" y="${equityTop - 5}" fill="${COLORS.buyHold}" font-size="10">Buy&amp;Hold (${formatPct(finalBuyHold)})</text>`);

  const equityTicks = generateYTicks(equityMin, equityMax, 4);
  for (const tick of equityTicks) {
    const y = equityYScale(tick);
    svg.push(`<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="${COLORS.grid}" stroke-dasharray="2,2"/>`);
    svg.push(`<text x="${margin.left - 10}" y="${y + 4}" fill="${COLORS.textMuted}" font-size="9" text-anchor="end">${tick.toFixed(0)}%</text>`);
  }

  // Buy & Hold ライン
  const buyHoldPath: string[] = [];
  for (let i = 0; i < candles.length; i++) {
    const x = xScale(i).toFixed(1);
    const y = equityYScale(buyHoldEquity[i]).toFixed(1);
    buyHoldPath.push(`${i === 0 ? 'M' : 'L'}${x},${y}`);
  }
  if (buyHoldPath.length > 0) {
    svg.push(`<path d="${buyHoldPath.join(' ')}" fill="none" stroke="${COLORS.buyHold}" stroke-width="2"/>`);
  }

  // Strategy ライン
  if (equity_curve.length > 0) {
    const strategyPath = equity_curve.map((e, i) => {
      const x = xScale(i).toFixed(1);
      const y = equityYScale(e.equity_pct).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
    svg.push(`<path d="${strategyPath}" fill="none" stroke="${COLORS.strategy}" stroke-width="2.5"/>`);
  }

  // 凡例はタイトル行に移動済み

  // === 中段2: ドローダウン ===
  svg.push(`<text x="${margin.left - 10}" y="${ddTop - 5}" fill="${COLORS.text}" font-size="11" font-weight="bold">Drawdown (%)</text>`);

  // ゼロライン（上端）
  svg.push(`<line x1="${margin.left}" y1="${ddTop}" x2="${width - margin.right}" y2="${ddTop}" stroke="${COLORS.zeroline}" stroke-width="1"/>`);

  // ドローダウン塗りつぶし
  if (drawdown_curve.length > 0) {
    const ddPathPoints: string[] = [];
    for (let i = 0; i < drawdown_curve.length; i++) {
      const x = xScale(i).toFixed(1);
      const y = ddYScale(drawdown_curve[i].drawdown_pct).toFixed(1);
      ddPathPoints.push(`${i === 0 ? 'M' : 'L'}${x},${y}`);
    }

    // 塗りつぶし（上端から下に向かって）
    const lastX = xScale(drawdown_curve.length - 1).toFixed(1);
    const firstX = xScale(0).toFixed(1);
    const fillPath = ddPathPoints.join(' ') + ` L${lastX},${ddTop} L${firstX},${ddTop} Z`;
    svg.push(`<path d="${fillPath}" fill="${COLORS.drawdownFill}"/>`);

    // DDライン（エッジを強調）
    svg.push(`<path d="${ddPathPoints.join(' ')}" fill="none" stroke="${COLORS.drawdown}" stroke-width="1.5"/>`);
  }

  // Y軸目盛り（負の値で表示: 0%, -10%, -20%）
  const ddTickStep = Math.ceil(ddMax / 3);
  const ddTickValues = [0];
  for (let v = ddTickStep; v <= ddMax + ddTickStep; v += ddTickStep) {
    if (v <= ddMax * 1.2) ddTickValues.push(v);
  }
  for (const tick of ddTickValues) {
    const y = ddYScale(tick);
    if (y <= ddBottom && y >= ddTop) {
      const displayValue = tick === 0 ? '0%' : `-${tick.toFixed(0)}%`;
      svg.push(`<text x="${margin.left - 10}" y="${y + 4}" fill="${COLORS.textMuted}" font-size="9" text-anchor="end">${displayValue}</text>`);
    }
  }

  // DD凡例
  svg.push(`<rect x="${margin.left + 10}" y="${ddTop + 8}" width="12" height="12" fill="${COLORS.drawdownFill}" stroke="${COLORS.drawdown}"/>`);
  svg.push(`<text x="${margin.left + 28}" y="${ddTop + 18}" fill="${COLORS.drawdown}" font-size="9">Drawdown</text>`);

  // === 下段: ポジション状態 ===
  svg.push(`<text x="${margin.left - 10}" y="${posTop - 5}" fill="${COLORS.text}" font-size="11" font-weight="bold">Position</text>`);

  // 背景枠
  svg.push(`<rect x="${margin.left}" y="${posTop}" width="${plotWidth}" height="${positionHeight}" fill="none" stroke="${COLORS.grid}"/>`);

  // ポジションバー
  const barWidth = plotWidth / candles.length;
  for (let i = 0; i < candles.length; i++) {
    if (positionState[i] === 'long') {
      const x = margin.left + (i / candles.length) * plotWidth;
      svg.push(`<rect x="${x.toFixed(1)}" y="${posTop + 3}" width="${Math.max(barWidth, 1).toFixed(1)}" height="${positionHeight - 6}" fill="${COLORS.positionLong}" opacity="0.7"/>`);
    }
  }

  // 凡例
  svg.push(`<rect x="${width - margin.right + 10}" y="${posTop + 5}" width="12" height="12" fill="${COLORS.positionLong}" opacity="0.7"/>`);
  svg.push(`<text x="${width - margin.right + 28}" y="${posTop + 15}" fill="${COLORS.positionLong}" font-size="9">Long</text>`);

  // === X軸ラベル（日付） ===
  const xLabelInterval = Math.max(1, Math.floor(candles.length / 8));
  for (let i = 0; i < candles.length; i += xLabelInterval) {
    const x = xScale(i);
    svg.push(`<text x="${x}" y="${posBottom + 15}" fill="${COLORS.textMuted}" font-size="9" text-anchor="middle">${formatDateShort(candles[i].time)}</text>`);
  }

  svg.push('</svg>');

  return svg.join('\n');
}
