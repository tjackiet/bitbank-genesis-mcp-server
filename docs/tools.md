# ツール一覧と使い分け
自由にプロンプトを投げてもらって構いません。
基本的には、「get_orderbook を使って〜」等、ツール名を指定する必要もありません。

注: 本サーバは固定銘柄リストではなく、bitbank 公開APIが返す全銘柄に自動追随します（追加/廃止も自動反映）。参考: [bitbank 公開API仕様](https://github.com/bitbankinc/bitbank-api-docs/blob/master/public-api.md)

## データ取得（生データ）
- get_ticker: 単一ペアの最新価格・出来高（ティッカー）
- get_tickers_jpy: JPYペアの一括取得（価格・出来高・変化率、ホワイトリストフィルタ済み）
- get_candles: ローソク足（OHLCV; 任意本数）
- get_transactions: 約定履歴（サイド/アグレッサー）
- get_depth: 板の生データ（全層）— 差分・圧力の元

## データ取得（加工）
- get_orderbook: 板（上位 N 層）正規化・累計計算。詳細モードで統計付き
- get_orderbook_pressure: 価格帯ごとの買い/売り圧力比
- get_orderbook_statistics: 板の厚み・流動性分布・偏りの統計
- get_flow_metrics: CVD / アグレッサー比 / スパイク検知でフロー優勢度を把握
- get_volatility_metrics: RV/ATR などのボラティリティ算出・比較

## 分析
- analyze_market_signal: 市場の総合スコア（-100〜+100）で強弱を即判定（寄与度・式付き）
- analyze_indicators: テクニカル指標を用いて値動きを分析（SMA/RSI/BB/一目/MACD）
- detect_macd_cross: 直近の MACD クロス銘柄をスクリーニング（短期転換の把握）
- detect_patterns: 完成済み＆形成中パターンを一括検出（全13パターン対応）
- detect_whale_events: 大口投資家の動向を簡易検出（板×ローソク足）
- analyze_macd_pattern: MACD 形成状況と過去統計
- analyze_candle_patterns: 2本足パターン検出（包み線/はらみ線/毛抜き等）
- analyze_ichimoku_snapshot: 一目の状態をスナップショット（判定フラグ付）
- analyze_bb_snapshot: BB の広がりと終値位置（z 値等）
- analyze_sma_snapshot: SMA 整列/クロス分析（bullish/bearish/mixed）
- analyze_support_resistance: サポート・レジスタンス自動検出（反発/反落ポイント分析）

## バックテスト
- run_backtest: 汎用バックテスト（SMA/RSI/MACD等の複数戦略に対応）
  - 戦略指定で多様な売買ルールを検証可能
  - 結果にはトレード履歴・統計・SVGチャートを含む

## 視覚化
- render_chart_svg: ローソク/折れ線/一目/BB/SMA/Depth を SVG で描画
  - 返却 `data.svg` を `image/svg+xml` としてそのまま表示（自前描画は不可）
  - Claude で LLM がうまくアーティファクトを出力できない場合は、以下のプロンプトを加えるのがおすすめです。
    - 「identifier と title を追加して、アーティファクトとして表示して」
- render_depth_svg: 板（Depth）の厚みを可視化する SVG チャート描画 
- render_candle_pattern_diagram: 2本足パターン（包み線/はらみ線等）を SVG で視覚化
  - analyze_candle_patterns の検出結果を入力として使用 

---

## 一覧（詳細）

| # | カテゴリ | ツール | 概要 | 備考 |
|---|---|---|---|---|
| 1 | 生データ | get_ticker | 単一ペアの最新価格・出来高 | 単発確認 |
| 2 | 生データ | get_tickers_jpy | JPYペアの一括取得（価格・出来高・変化率） | 比較・ランキング |
| 3 | 生データ | get_candles | ローソク足（OHLCV; 最新 N 本） | 時間軸/本数指定 |
| 4 | 生データ | get_transactions | 約定履歴（サイド/アグレッサー） | CVD 素材 |
| 5 | 生データ | get_depth | 板の生データ（全層） | 差分・圧力の元 |
| 6 | 加工 | get_orderbook | 板（上位 N 層）正規化・累計 | 板の詳細把握 |
| 7 | 加工 | get_orderbook_pressure | 価格帯ごとの買い/売り圧力比 | バランス可視化 |
| 8 | 加工 | get_orderbook_statistics | 板の厚み・流動性分布・偏り | 安定度評価 |
| 9 | 加工 | get_flow_metrics | CVD/アグレッサー比/スパイク | 流れ把握 |
| 10 | 加工 | get_volatility_metrics | RV/ATR など | 銘柄比較 |
| 11 | 分析 | analyze_indicators | 指標: SMA/RSI/BB/一目/MACD | 値動き分析 |
| 12 | 分析 | analyze_market_signal | 総合スコア＋寄与度/式 | 強弱判定 |
| 13 | 分析 | detect_patterns | 完成＆形成中パターン検出（全13パターン） | includeForming で形成中も |
| 14 | 分析 | detect_macd_cross | 直近 MACD クロス検出 | 短期転換 |
| 15 | 分析 | analyze_macd_pattern | MACD 形成状況・過去統計 | 確度評価 |
| 16 | 分析 | analyze_candle_patterns | 2本足パターン検出（包み線/はらみ線等） | 短期反転シグナル |
| 17 | 分析 | analyze_ichimoku_snapshot | 一目スナップショット | 判定フラグ |
| 18 | 分析 | analyze_bb_snapshot | BB の状態分析 | ボラ強弱 |
| 19 | 分析 | analyze_sma_snapshot | SMA 整列/クロス分析 | 方向判定 |
| 20 | 分析 | analyze_support_resistance | サポート・レジスタンス自動検出 | 反発/反落分析 |
| 21 | 分析 | detect_whale_events | 大口取引イベント推定 | 影響把握 |
| 22 | バックテスト | run_backtest | 汎用バックテスト（複数戦略対応） | SMA/RSI/MACD等 |
| 23 | 表示 | render_chart_svg | チャート SVG 描画（指標対応） | 一目/SMA/BB/Depth |
| 24 | 表示 | render_depth_svg | 板の深度を可視化する SVG 描画 | 買い/売り圧力の視覚化 |
| 25 | 表示 | render_candle_pattern_diagram | 2本足パターンを SVG で視覚化 | analyze_candle_patterns と連携 |

---

## ヒント（参考）
- `analyze_market_signal` で全体を把握 → 必要に応じて各専門ツールへ
- チャートは必ず `render_chart_svg` の `data.svg` をそのまま表示（自前描画はしない）
- データ点が多い/レイヤ多い場合は `maxSvgBytes` や `--force-layers` で調整可能

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
