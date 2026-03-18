# ADR-0005: MCP 描画ツール戦略 — データ信頼境界の確立

## ステータス: 完了

## 背景

MCPクライアント（Claude 等の LLM）は、利用可能なツールがあれば自然にそれを使う。
「LLM が自前で指標を計算するな」といった実行時ルールは冗長であり、
本質的な信頼境界は **MCP サーバーが返すデータの正確性** にある。

### 本 ADR 策定時の課題（解決済み）

1. ~~`prepare_chart_data` が未実装~~ → **フェーズ 1 で実装完了**
2. ~~Ichimoku シフトが不完全~~ → **フェーズ 2 で chikou シフト適用済み**
3. ~~`analyze_indicators` の `chart` フィールドが暗黙の Visualizer データソース~~ → **`prepare_chart_data` が正規ルートとなり解決**

## 決定

MCP サーバーの責務を **「正しいデータを返す」** ことに限定し、
描画はクライアント（Visualizer / Cursor / 外部ツール）に委ねる。

```
信頼境界
┌─────────────────────────────────────────────┐
│  lib/indicators.ts    純粋計算（テスト済み）    │
│  analyze_indicators   キャッシュ + 合成        │
│  prepare_chart_data   描画向け整形             │
└─────────────────────────────────────────────┘
          ↓ 計算済みデータ（シフト適用済み）
┌─────────────────────────────────────────────┐
│  MCPクライアント（Claude / Cursor / etc.）      │
│  → Visualizer, SVG, HTML 等で自由に描画        │
└─────────────────────────────────────────────┘
```

## クライアント別の描画戦略

MCP クライアントの描画能力に応じて 2 つのパスを使い分ける。

### 1. クライアント側描画パス（`prepare_chart_data`）

Claude Desktop の Visualizer や、Skills（Artifacts 等）対応クライアント向け。
計算済みの時系列データを返し、描画はクライアントに委ねる。

- **対象**: Claude Desktop、Skills 対応クライアント
- **利点**: クライアントがインタラクティブなチャートを描画できる
- **現状**: Claude（Visualizer）で最も安定した描画が得られる

### 2. サーバー側 SVG 描画パス（`render_chart_svg` 等）

クライアントが描画 Skills を持たない場合、または LLM のモデル性能が
Sonnet 4.6 以下で描画コード生成が崩れやすい場合のフォールバック。
サーバー側で SVG を生成し、完成画像をそのまま返す。

- **対象**: Skills 非対応クライアント、軽量モデル利用時
- **利点**: モデル性能に依存せず正確なチャートを提供できる
- **ツール**: `render_chart_svg`, `render_depth_svg`, `render_candle_pattern_diagram`

### 将来の展望

MCP クライアントの多くが Skills に対応してきており、将来的にはクライアント側描画が
主流になると見込まれる。サーバー側 SVG パスは、モデル性能が低い場合のセーフティネット
として維持する。

## 内部アーキテクチャ

`analyze_indicators` の `chart` フィールドは内部ツール間のデータ連携ハブとして機能している。

```
analyze_indicators (chart フィールド)
  ├─→ prepare_chart_data    … クライアント描画用に整形
  ├─→ render_chart_svg      … サーバー側 SVG 描画
  ├─→ detect_patterns       … ローソク足パターン検出
  ├─→ analyze_sma_snapshot  … SMA スナップショット分析
  ├─→ analyze_ema_snapshot  … EMA スナップショット分析
  └─→ analyze_stoch_snapshot … Stochastic スナップショット分析
```

`chart` フィールドは複数のツールが依存する内部データソースであり、軽量化・削除は行わない。
LLM 向けの `content` テキストには分析サマリのみを含め、`chart` は `structuredContent` 経由で
内部ツールが参照する設計とする。

## 実装履歴

### フェーズ 1: `prepare_chart_data` ツール新規作成 ✅

Visualizer / Skills 描画に特化した軽量データエンドポイント。

- `tools/prepare_chart_data.ts` を新規作成
- `analyze_indicators` の `chart` (ChartPayload) を内部で呼び出し、描画向けに整形
- Ichimoku の chikou・spanA・spanB のシフト適用済みで返却
- `indicators` パラメータで指標を選択的にフィルタリング
- `tz` パラメータでローカル時刻ラベル付加

### フェーズ 2: Ichimoku シフトロジックの正規化 ✅

chikou（遅行スパン）のシフトを計算層で完結。

- `lib/indicators.ts` の `ichimokuSeries()` を拡張し、chikou の 26 本シフトに対応
- `prepare_chart_data` 経由で全シフトが適用済みのデータを返却

### フェーズ 3: ツール description の最適化 ✅

Visualizer パスと分析パスの責務を description で明確化。

- `analyze_indicators`: テキスト分析結果を返すツールであることを明示。描画には `prepare_chart_data` / `render_chart_svg` を誘導
- `render_chart_svg`: サーバー側レンダリングであることを明示。クライアント側描画可能な場合は `prepare_chart_data` を優先する旨を記載
- 当初計画にあった `chart` フィールドの軽量化は **不採用**（内部データ連携ハブとして複数ツールが依存しているため）

### フェーズ 4: テストカバレッジ強化 — 優先項目完了 ✅

既存テストの評価:
- `lib/indicators.ts`: 53 テスト（SMA / EMA / RSI / BB / MACD / Ichimoku / Stochastic 等を網羅）
- `prepare_chart_data`: 17 統合テスト（系列長一致、null/NaN 処理、TZ、JPY 丸め等）

主要パスはカバーされているが、以下の具体的なギャップが存在する。

#### テスト追加済み（仕様の明文化）

| 関数 | 追加テスト | 確定した仕様 |
|---|---|---|
| `rsi()` | avgGain=0 かつ avgLoss=0（完全フラット相場） | 0/0 は **RSI=100** として扱う（avgLoss=0 分岐に合流） |
| `atr()` | seed 区間に NaN（非有限値）が含まれる場合 | **全 ATR が NaN** になる早期リターン（意図的設計） |

#### 既知の未テスト領域

**`lib/indicators.ts`**:

| 関数 | 未テストのシナリオ | リスク |
|---|---|---|
| `stochRSI()` | RSI の有効値がスパース（NaN 混在）な場合 | グローバル count とローカル window 判定の不整合リスク |
| `macd()` | 非単調データでの signal line seed index | 線形データでは隠れる off-by-one リスク |
| `stochastic()` | smoothK > kPeriod 等の極端なパラメータ | cnt !== smoothK で全 K が NaN になるパス未検証 |
| `shiftChikou()` | shift=0、shift=配列長 の境界値 | off-by-one リスク |

**`prepare_chart_data`**:

| シナリオ | リスク |
|---|---|
| JPY ペア + 非 UTC タイムゾーンの組み合わせ | 個別テスト済みだが組み合わせ未検証 |
| indicator 配列長と candles 長の不一致 | API 異常・キャッシュ破損時の防御テストなし |
| Ichimoku コンポーネントの部分的 null フィルタ | tenkan は有効・chikou は全 NaN のケースで選択的包含の検証不足 |

#### 当初計画していた手法と見送り理由

1. **プロパティベーステスト**（`fast-check` 等）
   - 上記ギャップの多くを自動発見できるが、新規依存の追加コストとテスト実行時間増を考慮し見送り

2. **スナップショットテスト**（vitest snapshot）
   - リファクタ時の意図しない出力変化を検出できるが、スナップショット管理コストと意図的変更時のノイズを考慮し見送り

#### 再検討トリガー

指標ロジックの大規模リファクタを実施する際に、上記ギャップのテスト追加と合わせて導入を再検討する。
`rsi()` の 0/0 仕様と `atr()` の NaN 早期リターンはテスト追加により仕様を明文化済み。

## 参考

- ADR-0001: Result<T, M> パターン → `prepare_chart_data` も同パターンに従う
- ADR-0002: Zod 単一ソース → スキーマは `src/schemas.ts` に追加
- `.claude/rules/charting.md`: 描画パスの運用ルール
