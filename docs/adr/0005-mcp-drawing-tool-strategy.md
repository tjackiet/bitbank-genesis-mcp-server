# ADR-0005: MCP 描画ツール戦略 — データ信頼境界の確立

## ステータス: 提案中

## 背景

MCPクライアント（Claude 等の LLM）は、利用可能なツールがあれば自然にそれを使う。
「LLM が自前で指標を計算するな」といった実行時ルールは冗長であり、
本質的な信頼境界は **MCP サーバーが返すデータの正確性** にある。

### 現状の課題

1. **`prepare_chart_data` が未実装** — `charting.md` に記載されているが、ツールが存在しない
2. **Ichimoku シフトが不完全** — `spanA/spanB` は計算時にシフト済みだが、`chikou` は未シフト（呼び出し元依存）
3. **`analyze_indicators` の `chart` フィールドが暗黙の Visualizer データソース** — 専用ツールがないため、LLM は analyze_indicators の巨大レスポンスから chart を抽出する必要がある

## 決定

MCP サーバーの責務を **「正しいデータを返す」** ことに限定し、
描画はクライアント（Visualizer / Cursor / 外部ツール）に委ねる。

```
信頼境界
┌─────────────────────────────────────────────┐
│  lib/indicators.ts    純粋計算（テスト済み）    │
│  analyze_indicators   キャッシュ + 合成        │
│  prepare_chart_data   Visualizer 向け整形 ★新規 │
└─────────────────────────────────────────────┘
          ↓ 計算済みデータ（シフト適用済み）
┌─────────────────────────────────────────────┐
│  MCPクライアント（Claude / Cursor / etc.）      │
│  → Visualizer, SVG, HTML 等で自由に描画        │
└─────────────────────────────────────────────┘
```

## 開発計画

### フェーズ 1: `prepare_chart_data` ツール新規作成

**目的**: Visualizer 描画に特化した軽量データエンドポイント

**やること**:

1. `tools/prepare_chart_data.ts` を新規作成
   - `analyze_indicators` の `chart` (ChartPayload) を内部で呼び出す
   - Visualizer が直接プロットできる形式に整形:
     - タイムスタンプ付き配列（`{time, open, high, low, close, volume}`）
     - 指標は `{time, value}[]` 形式に変換
     - 一目均衡表: **chikou の 26 本シフトを適用済みで返す**
     - spanA/spanB の先行シフトも明示的に適用済み
   - 不要な指標を除外するオプション（`indicators` パラメータ）
   - レスポンスサイズ制御（`limit` でデータ点数を制限）

2. `src/schema/chart.ts` にスキーマ追加
   - `PrepareChartDataInputSchema` — pair, type, limit, indicators（選択的）
   - `PrepareChartDataOutputSchema` — 整形済みデータ構造

3. `src/tool-registry.ts` に登録

4. テスト作成（`tests/prepare_chart_data.test.ts`）
   - 指標選択フィルタリング
   - Ichimoku シフト適用の検証
   - 系列長の一致検証（candles.length === indicator.length）
   - キャッシュヒット時の動作

**入力例**:
```json
{
  "pair": "btc_jpy",
  "type": "1hour",
  "limit": 100,
  "indicators": ["SMA_25", "SMA_75", "BB", "ICHIMOKU"]
}
```

**出力例**:
```json
{
  "ok": true,
  "data": {
    "candles": [
      { "time": "2026-03-17T00:00:00+09:00", "open": 15000000, "high": 15050000, "low": 14980000, "close": 15020000, "volume": 1.23 }
    ],
    "series": {
      "SMA_25": [{ "time": "...", "value": 15010000 }],
      "SMA_75": [{ "time": "...", "value": 14950000 }],
      "BB_upper": [{ "time": "...", "value": 15100000 }],
      "BB_middle": [{ "time": "...", "value": 15010000 }],
      "BB_lower": [{ "time": "...", "value": 14920000 }],
      "ICHI_tenkan": [{ "time": "...", "value": 15005000 }],
      "ICHI_spanA": [{ "time": "...", "value": 14990000 }],
      "ICHI_spanB": [{ "time": "...", "value": 14960000 }],
      "ICHI_chikou": [{ "time": "...", "value": 15020000 }]
    },
    "subPanels": {
      "RSI_14": [{ "time": "...", "value": 55.2 }],
      "MACD": {
        "line": [{ "time": "...", "value": 1200 }],
        "signal": [{ "time": "...", "value": 800 }],
        "hist": [{ "time": "...", "value": 400 }]
      }
    }
  },
  "meta": { "pair": "btc_jpy", "type": "1hour", "count": 100 }
}
```

### フェーズ 2: Ichimoku シフトロジックの正規化

**目的**: chikou（遅行スパン）のシフトを計算層で完結させる

**やること**:

1. `lib/indicators.ts` の `ichimokuSeries()` を拡張
   - 現状: chikou は `closes` をそのまま返す（シフト未適用）
   - 変更: chikou を 26 本**過去方向**にシフトした系列を返すオプション追加
   - 既存の動作を壊さないよう、オプションパラメータで制御

2. `tools/analyze_indicators.ts` の `createChartData()` を更新
   - chikou シフトを適用した系列を `chart.indicators.ICHI_chikou` に格納
   - `meta.shift` に chikou のシフト量を記録

3. テスト追加（`tests/lib/indicators.test.ts`）
   - chikou シフト後の系列長 === 元の系列長
   - シフト後の末尾 26 要素が null

### フェーズ 3: `analyze_indicators` レスポンス最適化

**目的**: Visualizer パスと分析パスの責務を明確に分離

**やること**:

1. `analyze_indicators` の `chart` フィールドを軽量化
   - `prepare_chart_data` が Visualizer 向けデータの正規ルートになるため
   - `chart` は `render_chart_svg` 用のサーバー側レンダリングデータに限定
   - 段階的: まず `prepare_chart_data` を安定させてから

2. ツール description の改善
   - `analyze_indicators`: 「指標の最新値とトレンド判定を返す。描画データが必要な場合は prepare_chart_data を使用」
   - `prepare_chart_data`: 「Visualizer/チャート描画用の時系列データを返す。全指標は計算・シフト適用済み」
   - → LLM がツール選択を自然に最適化する

### フェーズ 4: テストカバレッジ強化

**目的**: データ信頼境界の品質保証

**やること**:

1. `lib/indicators.ts` のプロパティベーステスト追加
   - SMA: 定数入力 → 出力 === 定数
   - EMA: 単調増加入力 → 出力も単調増加
   - RSI: 全上昇 → 100 に収束、全下降 → 0 に収束
   - BB: upper > middle > lower（常に）

2. `prepare_chart_data` の統合テスト
   - 実 API モック使用
   - 各指標の系列長一致
   - null/NaN の適切な処理

3. スナップショットテスト
   - 既知の入力データに対する指標出力の回帰テスト
   - 計算ロジック変更時の意図しない破壊を検出

## 優先度

| フェーズ | 優先度 | 依存関係 | 見積もり |
|---------|--------|---------|---------|
| 1. prepare_chart_data | **高** | なし | ツール + スキーマ + テスト |
| 2. Ichimoku シフト正規化 | **高** | なし（1 と並行可） | lib + テスト |
| 3. レスポンス最適化 | 中 | 1 完了後 | description 変更 + 段階的軽量化 |
| 4. テストカバレッジ | 中 | 1, 2 完了後 | プロパティテスト + 統合テスト |

## 参考

- ADR-0001: Result<T, M> パターン → `prepare_chart_data` も同パターンに従う
- ADR-0002: Zod 単一ソース → スキーマは `src/schema/chart.ts` に追加
- `charting.md`: LLM 実行時ルールは削除済み（本 ADR の前提）
