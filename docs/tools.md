# ツール一覧と使い分け

自由にプロンプトを投げてもらって構いません。
基本的には、「get_orderbook を使って〜」等、ツール名を指定する必要もありません。

注: 本サーバは固定銘柄リストではなく、bitbank 公開APIが返す全銘柄に自動追随します（追加/廃止も自動反映）。参考: [bitbank 公開API仕様](https://github.com/bitbankinc/bitbank-api-docs/blob/master/public-api.md)

---

## カテゴリ別ツール（全 26 ツール）

### データ取得 — 生データ（Raw）：4 ツール

API の応答をそのまま、または軽量整形して返す。指標計算・判定は行わない。

| ツール | 概要 |
|--------|------|
| `get_ticker` | 単一ペアの最新価格・出来高（ティッカー） |
| `get_tickers_jpy` | JPYペアの一括取得（価格・出来高・変化率、ランキング表示可、10sキャッシュ） |
| `get_candles` | ローソク足 OHLCV（11 時間軸: 1min〜1month、任意本数） |
| `get_transactions` | 約定履歴（直近 60 件 or 日付指定、サイド/アグレッサー、フィルタ可） |

### データ取得 — 加工（Processed）：3 ツール

生データに集計・統計計算を加えて返す。

| ツール | 概要 |
|--------|------|
| `get_orderbook` | 板情報の統合ツール（mode で分析粒度を切替え） |
|  | mode=summary: 上位N層の正規化・累計サイズ・spread（デフォルト） |
|  | mode=pressure: 帯域別(±0.1%/0.5%/1%等)の買い/売り圧力バランス |
|  | mode=statistics: 板の厚み・流動性分布・大口注文・総合評価 |
|  | mode=raw: 生の bids/asks 配列＋壁ゾーン自動推定 |
| `get_flow_metrics` | CVD / アグレッサー比 / スパイク検知でフロー優勢度を把握 |
| `get_volatility_metrics` | RV / ATR / Parkinson / GK / RS でボラティリティ算出・比較 |

### テクニカル分析：11 ツール

ローソク足・板データから指標計算・スナップショットを生成。

| ツール | 概要 |
|--------|------|
| `analyze_indicators` | 統合指標（SMA / EMA / RSI / BB / 一目 / MACD / Stochastic / StochRSI） |
| `analyze_bb_snapshot` | BB の広がりと終値位置（z-score・帯幅・スクイーズ判定） |
| `analyze_ichimoku_snapshot` | 一目の状態スナップショット（雲との位置関係・転換/基準線・雲の傾き） |
| `analyze_sma_snapshot` | SMA 整列/クロス分析（bullish/bearish/mixed・傾き） |
| `analyze_ema_snapshot` | EMA 整列/クロス分析（SMA より直近価格に敏感。デフォルト期間: 12, 26, 50, 200） |
| `analyze_mtf_sma` | 複数タイムフレーム SMA 一括取得・方向の合流（confluence）判定。analyze_sma_snapshot の個別呼び出し不要 |
| `analyze_stoch_snapshot` | Classic Stochastic Oscillator（%K/%D のゾーン判定・クロス・ダイバージェンス。レンジ相場向き。デフォルト: 14,3,3） |
| `analyze_volume_profile` | 約定データから VWAP・Volume Profile・約定サイズ分布を算出 |
| `analyze_currency_strength` | 通貨強弱分析（JPYペア横断で相対的な強さを比較） |
| `analyze_support_resistance` | サポレジ自動検出（接触回数・強度・崩壊実績） |
| `analyze_candle_patterns` | ローソク足パターン検出（1〜3本: ハンマー/包み足/三兵 等） |

### 総合判定・スクリーニング：1 ツール

複数指標を統合してスコアを算出。まず全体感をつかむならこれ。

| ツール | 概要 |
|--------|------|
| `analyze_market_signal` | 総合スコア（-100〜+100）。構成: buyPressure 35% / cvdTrend 25% / momentum 15% / volatility 10% / smaTrend 15%。寄与度・式付き |

### パターン検出：3 ツール

| ツール | 概要 |
|--------|------|
| `detect_patterns` | 大型チャートパターン（ダブルトップ/H&S/三角等 13 種、forming/completed/invalid 状態管理） |
| `detect_macd_cross` | MACDクロス統合ツール。pair 指定で単一ペア深掘り（forming検出・過去統計）、省略で複数ペアスクリーニング |
| `detect_whale_events` | 大口投資家の動向を簡易検出（板×ローソク足。蓄積/分配圧力判定） |

### 可視化（SVG 生成）：3 ツール

| ツール | 概要 |
|--------|------|
| `render_chart_svg` | メインチャート（ローソク足/ライン + SMA/EMA/BB/一目オーバーレイ）+ サブパネル（MACD / RSI / Volume） |
| `render_depth_svg` | 板の深度チャート（累積 bid/ask カーブ） |
| `render_candle_pattern_diagram` | ローソク足パターン教育図（analyze_candle_patterns の結果を図解） |

### バックテスト：1 ツール

| ツール | 概要 |
|--------|------|
| `run_backtest` | 汎用バックテスト（SMA クロス / RSI / MACD / BB ブレイクアウト。フィルタ付き。P&L + チャート SVG 一括返却） |

---

## ヒント（参考）
- `analyze_market_signal` で全体を把握 → 必要に応じて各専門ツールへ
- チャートは必ず `render_chart_svg` の `data.svg` をそのまま表示（自前描画はしない）
- データ点が多い/レイヤ多い場合は `maxSvgBytes` や `--force-layers` で調整可能

---

## run_backtest 詳細ガイド

### 利用可能な戦略

| 戦略 | 概要 | 主要パラメータ |
|------|------|----------------|
| sma_cross | SMAクロスオーバー | short, long + フィルター |
| rsi | RSI売られすぎ/買われすぎ | period, overbought, oversold |
| macd_cross | MACDクロスオーバー | fast, slow, signal + フィルター |
| bb_breakout | ボリンジャーバンドブレイクアウト | period, stddev |

### sma_cross エントリーフィルター

買いシグナル（ゴールデンクロス）にのみフィルターが適用されます。売り（デッドクロス）はフィルターなしで常に通します。

| パラメータ | 型 | デフォルト | 説明 |
|------------|-----|-----------|------|
| short | number | 5 | 短期SMA期間 |
| long | number | 20 | 長期SMA期間 |
| sma_filter_period | number | 0（無効） | 価格がSMA(N)より上の場合のみ買い（例: 200） |
| rsi_filter_period | number | 0（無効） | RSI計算期間（例: 14） |
| rsi_filter_max | number | 100（無効） | RSIがこの値未満の場合のみ買い（例: 70） |

フィルター有効時、チャートのオーバーレイに SMA フィルターライン（purple）/ RSI ライン（lavender）が自動追加されます。

### macd_cross エントリーフィルター

買いシグナル（ゴールデンクロス）にのみフィルターが適用されます。売り（デッドクロス）はフィルターなしで常に通します。

| パラメータ | 型 | デフォルト | 説明 |
|------------|-----|-----------|------|
| sma_filter_period | number | 0（無効） | 価格がSMA(N)より上の場合のみ買い（例: 200） |
| zero_line_filter | number | 0（なし） | -1: MACD≤0で買い（反転狙い）, 1: MACD≥0で買い（トレンド継続） |
| rsi_filter_period | number | 0（無効） | RSI計算期間（例: 14） |
| rsi_filter_max | number | 100（無効） | RSIがこの値未満の場合のみ買い（例: 70） |

フィルター有効時、チャートのオーバーレイに SMA ライン（price パネル）/ RSI ライン（indicator パネル）が自動追加されます。

### 入力例

```json
// sma_cross + SMA200トレンドフィルター
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "sma_cross",
    "params": { "short": 5, "long": 20, "sma_filter_period": 200 }
  }
}

// sma_cross + RSI70未満フィルター
{
  "pair": "btc_jpy",
  "period": "3M",
  "strategy": {
    "type": "sma_cross",
    "params": { "rsi_filter_period": 14, "rsi_filter_max": 70 }
  }
}

// macd_cross + SMA200トレンドフィルター
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "macd_cross",
    "params": { "sma_filter_period": 200 }
  }
}

// ゼロライン以下でのみ買い（反転狙い）
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "macd_cross",
    "params": { "zero_line_filter": -1 }
  }
}

// RSI70未満フィルター付き
{
  "pair": "btc_jpy",
  "period": "3M",
  "strategy": {
    "type": "macd_cross",
    "params": { "rsi_filter_period": 14, "rsi_filter_max": 70 }
  }
}

// 全部盛り
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "macd_cross",
    "params": {
      "sma_filter_period": 200,
      "zero_line_filter": -1,
      "rsi_filter_period": 14,
      "rsi_filter_max": 70
    }
  }
}
```

### 出力指標

| 指標 | 説明 |
|------|------|
| total_pnl_pct | 総損益 [%] |
| trades | トレード数 |
| win_rate | 勝率 [%] |
| max_drawdown_pct | 最大ドローダウン [%] |
| avg_pnl_pct | 1トレードあたり平均損益 [%] |
| profit_factor | Profit Factor（総利益 / 総損失）。全勝時は null |
| sharpe_ratio | 年率換算 Sharpe Ratio（日次リターン × √365） |

---

## render_chart_svg 詳細ガイド

### 返却オプションの違い

| オプション | 説明 | ユースケース |
|------------|------|--------------|
| `preferFile: false` (デフォルト) | `maxSvgBytes` 以下なら `data.svg` を返却、超過時はファイル保存して `data.filePath` を返却 | 通常利用 |
| `preferFile: true` | 常にファイル保存、`data.svg` は返さない。保存失敗時はエラー | ファイルとして確実に保存したい場合 |
| `autoSave: true` | `data.svg` を返しつつ、同時にファイル保存も行う（`data.filePath` も含む） | SVG表示＋ファイル保存の両方が欲しい場合 |
| `outputFormat: 'svg'` (デフォルト) | `data.svg` にSVG文字列を返却 | 通常のSVG表示 |
| `outputFormat: 'base64'` | `data.base64` にBase64文字列を返却 | Claude.ai等でpresent_filesが失敗する場合の回避策 |
| `outputFormat: 'dataUri'` | `data.base64` に `data:image/svg+xml;base64,...` 形式で返却 | HTML/Markdownへの埋め込み |

### maxSvgBytes の挙動

- デフォルト: 100,000 bytes
- SVGサイズが `maxSvgBytes` を超えた場合:
  - `preferFile: false` → ファイル保存し、`data.svg` は省略（`meta.truncated: true`）
  - `preferFile: true` → ファイル保存のみ

### サブパネル（subPanels）

メインチャートの下に MACD / RSI / Volume のサブパネルを追加できます。

```json
{ "pair": "btc_jpy", "subPanels": ["macd"] }
{ "pair": "btc_jpy", "subPanels": ["macd", "rsi", "volume"] }
```

| 値 | 内容 |
|----|------|
| `macd` | MACD ライン + Signal ライン + ヒストグラム（ゼロライン付き） |
| `rsi` | RSI(14) ライン + 70/30 ゾーン表示 |
| `volume` | 出来高バー（陽線=緑、陰線=赤） |

指定なし（デフォルト）の場合、サブパネルは描画されません。

### 一目均衡表（Ichimoku）の自動調整

一目均衡表の雲を正しく表示するには、十分なデータ期間が必要です：

| 要素 | 必要期間 | 備考 |
|------|----------|------|
| 転換線 | 9期間 | - |
| 基準線 | 26期間 | - |
| 先行スパンA | 26期間 | 26日先にシフト |
| 先行スパンB | 52期間 | 26日先にシフト |

**自動調整**: `withIchimoku: true` 使用時、`limit < 60` の場合は自動的に `limit = 60` に調整されます。

例: `{ withIchimoku: true, limit: 30 }` → 実際には `limit: 60` として処理
（`meta.limit` には調整後の値が返されます）

### エラーハンドリング

データ不足等で指標が正しく計算できない場合、`meta.warnings` に警告メッセージが含まれます。これにより、サイレントに省略されるのではなく、問題を明示的に把握できます。

```json
{
  "meta": {
    "warnings": [
      "一目均衡表の雲を完全に表示するには limit >= 60 を推奨します（現在: 30）",
      "先行スパンBのデータが不足しています。雲が描画されません。"
    ]
  }
}
```
