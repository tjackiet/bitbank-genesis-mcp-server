---
globs: tools/render_*.ts, src/handlers/*chart*.ts, src/handlers/*render*.ts, src/prompts.ts
---

# チャート・可視化ポリシー

チャートや可視化は**必ず本プロジェクトの描画ツール**を使う。
独自に可視化コード（D3 / Chart.js / Canvas / SVG 等）を生成してはいけない。

- `render_chart_svg` — ローソク足・ライン・BB・一目均衡表・SMA 等
- `render_depth_svg` — 板の深度チャート
- `render_candle_pattern_diagram` — ローソク足パターン図解

Cursor では `savePng: true` + ワークスペース内の `outputDir` を推奨。

**例外**: おはようレポート（`src/prompts.ts` の ohayo）では `<svg><polyline>` 簡易スパークラインをインライン生成してよい。
