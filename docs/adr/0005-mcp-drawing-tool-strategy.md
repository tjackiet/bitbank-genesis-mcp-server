# ADR-0005: MCP 描画ツール戦略 — データ信頼境界の確立

- **Status**: Accepted
- **Date**: 2025-01-01 (推定)
- **Decision**: MCP サーバーの責務を「正しいデータを返す」ことに限定し、描画はクライアントに委ねる

## 背景

MCPクライアント（Claude 等の LLM）は、利用可能なツールがあれば自然にそれを使う。
「LLM が自前で指標を計算するな」といった実行時ルールは冗長であり、
本質的な信頼境界は **MCP サーバーが返すデータの正確性** にある。

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

### 2. サーバー側 SVG 描画パス（`render_chart_svg` 等）

クライアントが描画 Skills を持たない場合のフォールバック。
サーバー側で SVG を生成し、完成画像をそのまま返す。

- **対象**: Skills 非対応クライアント、軽量モデル利用時
- **利点**: モデル性能に依存せず正確なチャートを提供できる
- **ツール**: `render_chart_svg`, `render_depth_svg`, `render_candle_pattern_diagram`

将来的にはクライアント側描画が主流になると見込まれる。サーバー側 SVG パスはセーフティネットとして維持する。

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

## 不採用とした代替案

- **`chart` フィールドの軽量化**: 内部データ連携ハブとして複数ツールが依存しているため不採用
- **独自可視化コードの生成許可**: データ信頼境界が曖昧になるため不採用（`.claude/rules/charting.md` で禁止）

## 参考

- ADR-0001: Result<T, M> パターン → `prepare_chart_data` も同パターンに従う
- ADR-0002: Zod 単一ソース → スキーマは `src/schemas.ts` に追加
- `.claude/rules/charting.md`: 描画パスの運用ルール
