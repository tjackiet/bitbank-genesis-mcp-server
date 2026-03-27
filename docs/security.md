# セキュリティ設計

bitbank-mcp-server のセキュリティ設計と、OWASP「A Practical Guide for Secure MCP Server Development」(v1.0, Feb 2026) との対応表です。

## OWASP MCP Security Guide との対応

| # | OWASP 項目 | AIForge での対応 | ステータス |
|---|---|---|---|
| 4 | Prompt Injection — HITL | 確認トークン（HMAC-SHA256）による2ステップ確認。LLM の description 指示だけに頼らず、サーバー側で強制 | 対応済み |
| 3 | Data Validation | Zod スキーマ + 注文タイプ別バリデーション + トリガー価格妥当性チェック | 対応済み |
| 6 | Safe Error Handling | 認証エラーの静的メッセージ化、レスポンスボディ切り詰め、クレデンシャル漏洩防止テスト | 対応済み |
| 7 | Audit Logs | 取引操作専用ログ（`trade_action`）+ チェーンハッシュ（SHA-256）+ 検証スクリプト | 対応済み |
| 8 | CI/CD Security Gates | `npm audit --audit-level=high` ゲート + 週次定期スキャン | 対応済み |
| 5 | Secrets Storage (vault) | 環境変数で管理（STDIO 前提のため vault は未導入） | 将来対応 |
| 1 | Session Isolation | STDIO = 1:1 セッション（HTTP 有効時は要対応） | 将来対応 |

## 各対策の詳細

### HITL（Human-in-the-Loop）

取引操作（`create_order` / `cancel_order` / `cancel_orders`）に対する強制的なユーザー確認機構。

**フロー:**
1. `preview_order` でバリデーション + 確認トークン発行
2. LLM がユーザーにプレビューを表示し確認を促す
3. ユーザー確認後、LLM が `create_order` にトークンを渡して実行
4. サーバーがトークンを検証（HMAC 一致 + 有効期限 + パラメータ一致）

**トークン仕様:**
- アルゴリズム: HMAC-SHA256
- 鍵: `BITBANK_API_SECRET`（追加の秘密鍵不要）
- ペイロード: `action` + 注文パラメータ + `expiresAt` を正規化した JSON
- 有効期限: 60秒（`ORDER_CONFIRM_TTL_MS` で変更可能）
- 検証項目: HMAC 一致、有効期限内、パラメータ一致

**防御対象:**
- LLM が確認をスキップして直接発注 → トークンなしで拒否
- パラメータ改ざん（amount, pair 等の変更） → HMAC 不一致で拒否
- リプレイ攻撃 → 有効期限で拒否
- 異なる操作へのトークン流用 → action フィールドで拒否

### 監査ログ

**通常ログ** (`logToolRun`):
- 全ツールの実行結果を記録（`ok`, `summary`, `meta` のみ。`data` は含めない）

**取引操作ログ** (`logTradeAction`):
- カテゴリ: `trade_action`
- チェーンハッシュ: 各レコードに `_prevHash`（前レコードのハッシュ）と `_hash`（自レコードのハッシュ）を付与
- `confirmed: true` フラグで HITL 確認済みであることを記録
- 検証: `npx tsx scripts/verify_log_integrity.ts [logfile]`

**クレデンシャル漏洩防止:**
- `logToolRun` / `logError` / `logTradeAction` すべてでテスト済み
- API キー・シークレットがログに混入しないことを検証

### CI/CD セキュリティゲート

**Security Audit ワークフロー** (`.github/workflows/security.yml`):
- トリガー: push to main, PR to main, 週次（毎週月曜 9:00 UTC）
- `npm audit --audit-level=high` で high 以上の脆弱性を検出時に fail

### エラーハンドリング

`BitbankPrivateClient` のエラー分類:
- 認証エラー（20001〜20005）: 静的メッセージ「API 認証に失敗しました」
- レート制限（10009）: Retry-After ヘッダに従い自動リトライ
- メンテナンス（10007, 10008）: 専用メッセージ
- 汎用エラー: レスポンスボディを 200 文字に切り詰め
- HTTP 401/403: クレデンシャルを露出しない静的メッセージ

## 将来の対応予定

### Secrets Storage
現状は環境変数で API キーを管理。STDIO 前提（1プロセス = 1ユーザー）のため、
プロセス内でのキー漏洩リスクは低い。HTTP モード拡張時には vault 統合を検討。

### Session Isolation
STDIO モードでは MCP クライアントとサーバーが 1:1 で接続されるためセッション分離は自然に達成される。
HTTP モード（`MCP_ENABLE_HTTP=1`）を本格運用する場合は、リクエストごとの認証・セッション管理が必要。
