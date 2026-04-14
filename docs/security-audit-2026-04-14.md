# セキュリティ監査レポート — 2026-04-14

## 総合リスクスコア: **22 / 100**（低リスク）

> 0 が最も安全、100 が最も危険。
> 致命的な脆弱性はなく、全体として堅牢な設計。改善推奨事項は防御深度の強化が主。

---

## 検出事項一覧

| # | 深刻度 | カテゴリ | 概要 | ファイル |
|---|--------|----------|------|----------|
| 1 | **高** | エラー情報漏洩 | Private API の生レスポンスボディ（先頭200文字）がエラーメッセージに混入 | `src/private/client.ts:282` |
| 2 | **高** | エラー情報漏洩 | upstream レスポンス全体を `JSON.stringify` してエラーメッセージに含めている | `tools/get_tickers_jpy.ts:199` |
| 3 | **高** | 認可チェック | HMAC トークン比較がタイミングセーフでない（`!==` 使用） | `src/private/confirmation.ts:96` |
| 4 | **中** | エラー情報漏洩 | 全12個の Private ツールが `PrivateApiError.message` をそのまま返却 | `tools/private/*.ts` (全ファイル) |
| 5 | **中** | エラー情報漏洩 | server.ts の catch-all が `getErrorMessage(err)` を応答に含める | `src/server.ts:136` |
| 6 | **中** | 入力バリデーション | `getTickersJpyHandler` が `inputSchema.parse()` を呼ばず型キャストで代替 | `src/handlers/getTickersJpyHandler.ts:65-69` |
| 7 | **中** | 認可チェック | `ORDER_CONFIRM_TTL_MS` に上限チェックがなく、極端に長いTTLを設定可能 | `src/private/confirmation.ts:16-21` |
| 8 | **低** | レート制限 | MCP サーバー自体にはツール呼び出しレート制限がない | `src/server.ts` |
| 9 | **低** | 依存ライブラリ | `dotenv` (17.x), `zod` (4.x) のメジャーアップデートあり（脆弱性は0件） | `package.json` |
| 10 | **低** | 冪等性 | 確認トークンに使用済みフラグがなく、有効期限内の再利用が理論上可能 | `src/private/confirmation.ts` |

---

## 詳細分析

### 1. エラー情報漏洩（チェック観点 1）

#### [高] #1: `client.ts:282` — 生レスポンスボディのエラーメッセージ混入

```typescript
// 現状: body の先頭200文字がそのまま含まれる
return new PrivateApiError(
  `bitbank API エラー (HTTP ${httpStatus}${errorCode ? `, code: ${errorCode}` : ''}): ${body.slice(0, 200)}`,
  'upstream_error', httpStatus, errorCode ?? undefined,
);
```

**リスク**: upstream API のレスポンス構造・フィールド名・内部エラー詳細が露出する可能性。
現在 bitbank API はレスポンスに認証情報を含めないが、将来のAPI変更で漏洩リスクが生じる。

#### [高] #2: `get_tickers_jpy.ts:199` — upstream レスポンスの全公開

```typescript
return GetTickersJpyOutputSchema.parse(
  fail(`UPSTREAM_ERROR ${JSON.stringify(raw?.data ?? raw)}`, 'upstream')
);
```

**リスク**: upstream API のレスポンス全体がエラーメッセージとして返される。

#### [中] #4: 全 Private ツールの `err.message` 透過

12個の Private ツールすべてで同じパターン:
```typescript
catch (err) {
  if (err instanceof PrivateApiError) {
    return Schema.parse(fail(err.message, err.errorType));
  }
  return Schema.parse(
    fail(err instanceof Error ? err.message : 'デフォルトメッセージ', 'upstream_error')
  );
}
```

`PrivateApiError.message` には #1 の `body.slice(0, 200)` が含まれるため、連鎖的に情報漏洩が発生。

#### [中] #5: `server.ts:136` — catch-all のエラーメッセージ

```typescript
catch (err: unknown) {
  const message = getErrorMessage(err);
  return {
    content: [{ type: 'text', text: `内部エラー: ${message || '不明なエラー'}` }],
    ...
  };
}
```

`getErrorMessage` は `err.message` をそのまま返す。内部パスやスタックトレースの断片が含まれる可能性。

### 2. 入力バリデーション（チェック観点 2）

#### [中] #6: `getTickersJpyHandler.ts` のスキーマ未適用

```typescript
handler: async (args: Record<string, unknown>) => {
  const view = (args?.view ?? 'ranked') as 'items' | 'ranked';       // 安全でない型キャスト
  const sortBy = (args?.sortBy ?? 'change24h') as 'change24h' | ...;  // 同上
  const limit = Number(args?.limit ?? 5);                              // NaN の可能性
```

MCP SDK が `inputSchema` の ZodRawShape を使って入力を検証するため、実際のリスクは限定的。
ただし防御的コーディングとして `schema.parse(args)` を適用すべき。

**他のツール**: 大部分のツールは handler 内で `ensurePair()`, `validateLimit()` 等のバリデーション関数を使用しており、一貫性がある。

### 3. 冪等性（チェック観点 3）

#### [低] #10: 確認トークンの再利用

HITL 確認トークンは HMAC ベースで検証されるため、**同じパラメータ・同じ有効期限内であれば再利用可能**。
ただし実際のリスクは低い:
- トークン TTL はデフォルト60秒
- パラメータ（ペア・数量・価格等）が完全一致する必要がある
- bitbank API 側で注文の重複チェックが行われる

### 4. シークレット管理（チェック観点 4）

**状態: 良好**

- API キーは環境変数経由でのみ取得（`process.env.BITBANK_API_KEY/SECRET`）
- ハードコードされた秘密情報なし
- `.gitignore` で `.env`, `logs/` を除外
- `.env.example` はプレースホルダーのみ

### 5. 認可チェック（チェック観点 5）

#### [高] #3: タイミングセーフでない HMAC 比較

```typescript
// confirmation.ts:96
if (token !== expected) {
  return '確認トークンが無効です...';
}
```

JavaScript の `!==` は文字列を先頭から1文字ずつ比較し、不一致時点で即座に false を返す。
攻撃者はレスポンス時間の差を測定することで、トークンを1文字ずつ推測できる（タイミング攻撃）。
MCP サーバーがローカル実行であればリスクは低いが、HTTP トランスポート（`src/http.ts`）経由の場合はリスクが上がる。

#### [中] #7: TTL の上限未チェック

```typescript
function getTtlMs(): number {
  const env = process.env.ORDER_CONFIRM_TTL_MS;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;  // 上限チェックなし
  }
  return DEFAULT_TTL_MS;
}
```

`ORDER_CONFIRM_TTL_MS=999999999` とすれば約11日間有効なトークンが発行される。

### 6. 依存ライブラリ（チェック観点 6）

**状態: 良好**

- `npm audit`: **脆弱性 0 件**
- `package-lock.json`: 存在し、バージョン固定済み
- メジャーアップデート可能: `dotenv` (16→17), `zod` (3→4), `lightweight-charts` (4→5)
  - いずれも既知の脆弱性はなく、機能的更新のみ

### 7. ログの安全性（チェック観点 7）

**状態: 優秀**

- `SENSITIVE_KEYS` で `confirmation_token`, `token`, `key`, `secret`, `apiKey`, `apiSecret` をマスク
- `logToolRun` は `ok`, `summary`, `meta` のみ記録（`data` は除外）
- Private ツールのコードに `console.log/error/warn` なし
- チェーンハッシュで取引ログの改ざんを検知可能

### 8. レート制限（チェック観点 8）

#### [低] #8: MCP サーバーレベルのレート制限なし

外部 API 呼び出しには適切なレート制限がある:
- Public API: `lib/http.ts` — リトライ2回、Retry-After 対応、30秒上限
- Private API: `src/private/client.ts` — リトライ2回、指数バックオフ、429/10009 対応
- `get_candles.ts` — 並行3リクエスト、バッチ間500ms遅延

ただしMCPサーバー自体にはツール呼び出し頻度の制限がなく、悪意あるクライアントが高速連打可能。
MCP プロトコル自体がクライアント-サーバー間の信頼関係を前提とするため、実際のリスクは低い。

---

## 修正コード例（深刻度 高 の上位3件）

### 修正 #1: `src/private/client.ts:282` — 生レスポンスボディを除去

```typescript
// Before:
return new PrivateApiError(
  `bitbank API エラー (HTTP ${httpStatus}${errorCode ? `, code: ${errorCode}` : ''}): ${body.slice(0, 200)}`,
  'upstream_error',
  httpStatus,
  errorCode ?? undefined,
);

// After:
return new PrivateApiError(
  `bitbank API エラー (HTTP ${httpStatus}${errorCode ? `, code: ${errorCode}` : ''})`,
  'upstream_error',
  httpStatus,
  errorCode ?? undefined,
);
```

### 修正 #2: `tools/get_tickers_jpy.ts:199` — upstream レスポンスを除去

```typescript
// Before:
return GetTickersJpyOutputSchema.parse(
  fail(`UPSTREAM_ERROR ${JSON.stringify(raw?.data ?? raw)}`, 'upstream')
);

// After:
return GetTickersJpyOutputSchema.parse(
  fail('UPSTREAM_ERROR: 無効なレスポンス形式', 'upstream')
);
```

### 修正 #3: `src/private/confirmation.ts:96` — タイミングセーフ比較

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

// Before:
if (token !== expected) {
  return '確認トークンが無効です。パラメータが変更された可能性があります。preview を再実行してください';
}

// After:
const tokenBuf = Buffer.from(token, 'hex');
const expectedBuf = Buffer.from(expected, 'hex');
if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
  return '確認トークンが無効です。パラメータが変更された可能性があります。preview を再実行してください';
}
```

---

## 評価サマリ

| チェック観点 | 評価 | コメント |
|-------------|------|---------|
| エラー情報漏洩 | **要改善** | 生レスポンスボディと err.message の透過に対処必要 |
| 入力バリデーション | **良好** | MCP SDK + ensurePair/validateLimit で概ね一貫。1箇所例外あり |
| 冪等性 | **良好** | HITL 2段階確認 + bitbank API 側の重複チェックで概ね安全 |
| シークレット管理 | **優秀** | 環境変数のみ、ハードコードなし、.gitignore 適切 |
| 認可チェック | **要改善** | タイミングセーフ比較の導入が必要 |
| 依存ライブラリ | **優秀** | 脆弱性 0 件、lockfile あり |
| ログの安全性 | **優秀** | マスキング・チェーンハッシュ・data 除外が徹底 |
| レート制限 | **良好** | 外部 API は適切。サーバーレベルは MCP の設計上許容範囲 |
