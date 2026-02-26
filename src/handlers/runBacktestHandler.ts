import { runBacktest } from '../../tools/trading_process/index.js';
import { RunBacktestInputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';

export const toolDef: ToolDefinition = {
	name: 'run_backtest',
	description: `汎用バックテストを実行。データ取得・計算・チャート描画をすべて行い、結果をワンコールで返します。

★★★ 重要 ★★★
このツールはチャート（SVG）を含む完全な結果を返します。
get_candles でデータを取得して独自にバックテストを実装したり、
matplotlib/D3.js 等で独自にチャートを描画する必要はありません。

【利用可能な戦略】
- sma_cross: SMAクロスオーバー（params: short, long）
  - エントリーフィルター（買いシグナルのみ適用、売りはフィルターなし）:
    - sma_filter_period: SMAトレンドフィルター（例: 200 → 価格がSMA200より上の場合のみ買い）
    - rsi_filter_period: RSI計算期間（例: 14）
    - rsi_filter_max: RSIがこの値未満の場合のみ買い（例: 70）
- rsi: RSI売られすぎ/買われすぎ（params: period, overbought, oversold）
- macd_cross: MACDクロスオーバー（params: fast, slow, signal）
  - エントリーフィルター（買いシグナルのみ適用、売りはフィルターなし）:
    - sma_filter_period: SMAトレンドフィルター（例: 200 → 価格がSMA200より上の場合のみ買い）
    - zero_line_filter: -1=MACD≤0で買い（反転狙い）, 1=MACD≥0で買い（トレンド継続）
    - rsi_filter_period: RSI計算期間（例: 14）
    - rsi_filter_max: RSIがこの値未満の場合のみ買い（例: 70）
- bb_breakout: ボリンジャーバンドブレイクアウト（params: period, stddev）

【時間軸】
- 1D: 日足（デフォルト）
- 4H: 4時間足
- 1H: 1時間足

【期間（period）】
- 1M: 約1ヶ月（30日相当）
- 3M: 約3ヶ月（90日相当）
- 6M: 約6ヶ月（180日相当）
※ "30D" のような直接的な日数指定は不可。1M/3M/6M から選択してください。

【入力例】
{
  "pair": "btc_jpy",
  "period": "3M",
  "strategy": {
    "type": "sma_cross",
    "params": { "short": 5, "long": 20 }
  }
}

{
  "pair": "btc_jpy",
  "timeframe": "1H",
  "period": "1M",
  "strategy": { "type": "rsi" }
}

// SMA 5/20 + SMA200トレンドフィルター（価格がSMA200より上の場合のみ買い）
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "sma_cross",
    "params": { "short": 5, "long": 20, "sma_filter_period": 200 }
  }
}

// SMA 5/20 + RSIフィルター（RSI<70のみ買い）
{
  "pair": "btc_jpy",
  "period": "3M",
  "strategy": {
    "type": "sma_cross",
    "params": { "short": 5, "long": 20, "rsi_filter_period": 14, "rsi_filter_max": 70 }
  }
}

// MACD + SMA200トレンドフィルター
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "macd_cross",
    "params": { "sma_filter_period": 200 }
  }
}

// MACD + ゼロライン以下でのみ買い（反転狙い）
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "macd_cross",
    "params": { "zero_line_filter": -1 }
  }
}

【チャート詳細度（chartDetail）— 指定がなければ必ず default を使うこと】
- default: エクイティカーブ + ドローダウン。「損益」「plotして」「グラフ」「チャート」等の表現はすべて default。
- full: 価格+インジケーター+エクイティ+DD+ポジションの5段構成。ユーザーが価格推移やシグナルの視覚的確認を求めた場合に使用（例：「売買タイミングを見せて」「エントリーポイントを表示」「価格チャートも含めて」等）。

【出力】
- summary: テキストサマリー（総損益, トレード数, 勝率, 最大DD, Avg P&L/Trade, Profit Factor, Sharpe Ratio）
- svg: チャート（SVG形式、そのままアーティファクトとして表示可能）

【チャート表示方法】
返却される svg をHTMLアーティファクトに埋め込んで表示してください。
例: <html><body>ここにSVGを埋め込む</body></html>

【注意】
- 過去データに基づくバックテストであり、将来の成果を保証するものではありません`,
	inputSchema: RunBacktestInputSchema as any,
	handler: async (args: any) => {
		const res = await runBacktest({
			pair: args.pair,
			timeframe: args.timeframe,
			period: args.period,
			strategy: args.strategy,
			fee_bp: args.fee_bp,
			execution: args.execution,
			outputDir: args.outputDir,
			savePng: args.savePng ?? false,  // デフォルト: false（ファイルシステム非共有のため）
			includeSvg: args.includeSvg ?? true,  // デフォルト: true（SVGを返す）
			chartDetail: args.chartDetail ?? 'default',  // デフォルト: 軽量チャート
		});

		if (!res.ok) {
			const errorText = res.availableStrategies
				? `Error: ${res.error}\nAvailable strategies: ${res.availableStrategies.join(', ')}`
				: `Error: ${res.error}`;
			return { content: [{ type: 'text', text: errorText }], structuredContent: res };
		}

		// SVG がある場合はアーティファクト用のヒントを追加
		let svgHint = '';
		if (res.svg) {
			svgHint = [
				'',
				'--- Backtest Chart (SVG) ---',
				`identifier: backtest-${args.strategy?.type}-${args.pair}-${Date.now()}`,
				`title: ${args.pair?.toUpperCase() || 'BTC_JPY'} ${res.data.input.strategy.type} Backtest`,
				'type: image/svg+xml',
				'',
				res.svg,
			].join('\n');
		}

		return {
			content: [{ type: 'text', text: res.summary + svgHint }],
			structuredContent: {
				ok: true,
				summary: res.summary,
				svg: res.svg,
				data: {
					input: res.data.input,
					summary: res.data.summary,
					trade_count: res.data.trades.length,
				},
				artifactHint: res.svg ? {
					renderHint: 'ARTIFACT_REQUIRED',
					displayType: 'image/svg+xml',
					source: 'inline_svg',
				} : undefined,
			},
		};
	},
};
