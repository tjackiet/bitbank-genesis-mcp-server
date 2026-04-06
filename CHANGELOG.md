# Changelog

本プロジェクトの主な変更履歴です。
形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠しています。

---

## [Unreleased]

### Added
- **信用取引ツール Phase 1** — `get_margin_status`, `get_margin_positions`, `get_margin_trade_history` の読み取り専用ツールを追加
- **信用取引 Phase 2** — `preview_order` / `create_order` に `position_side` パラメータを追加し信用注文に対応
- **機密情報取り扱いポリシー** — `.claude/rules/sensitive-data.md` を新設。CRITICAL / HIGH 分類と開発時チェックリスト
- **レートリミット情報** — ツール結果の `meta` に `remaining` / `limit` / `reset` を公開

### Fixed
- `confirmation_token` がログに平文で出力される問題を修正（`SENSITIVE_KEYS` にマスク追加）
- `path-to-regexp` の ReDoS 脆弱性を修正（GHSA-j3q9, GHSA-27v5）
- forming wedge の `breakoutDirection: null` が Zod バリデーションを通らない問題を修正
- compact 時の SessionStart / Stop hook の多重実行を防止
- MCP SDK バージョンを 1.28.0 に固定し E2E テストの SDK 差異を解消

### Changed
- テストカバレッジ閾値を statements/functions/lines: 50% → 80%、branch: 70% に引き上げ
- README を改善: 前提条件（Node.js 18+）、環境変数設定例、STDIO / HTTP 起動手順、Private API ゲーティングの説明を追加
- `docs/tools.md` のツール数を実態（Public 29 + Private 16 = 45）に合わせて更新
- Private ツールハンドラのデッドコードを削除

### Testing
- パターン検出・テクニカル分析・可視化・バックテスト等の広範なテストを追加
- 主要モジュールのカバレッジ向上: analyze_support_resistance 28→93%, analyze_candle_patterns 27→91%, analyze_fibonacci 46→98%, detect_doubles 37→97%, analyzeIndicatorsHandler 34→95%, pattern-diagrams 45→99%, render_chart_svg 37→85%, render_depth_svg 48→97%
- Private API のブランチカバレッジを 66.78% → 83.66% に向上
- E2E バリデーションテストを `rejects.toThrow` パターンに統一
