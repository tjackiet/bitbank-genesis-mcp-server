---
globs: tools/**/*.ts, src/handlers/**/*.ts, src/tool-registry.ts, src/private/**/*.ts
---

# MCP ツール追加・修正

ツールは `toolDef` エクスポート → `src/tool-registry.ts` が集約 → `src/server.ts` が自動登録。
**server.ts を直接編集する必要はない。**

## content テキストにデータを含める（重要）

LLM は `structuredContent` を参照できない。`content[0].text` だけが LLM に見える。
`ok(summary, data, meta)` をそのまま返すと `toToolResult`（`src/server.ts`）が `summary` 一行だけを `content` に入れるため、LLM はデータを一切受け取れずハルシネーションを起こす。

**対策**: handler で `content` テキストにデータを明示的に含める。

```ts
// NG: LLM には summary しか見えない
handler: async (args) => myTool(args),

// OK: content にデータを含める（get_candles, prepare_chart_data 等と同じパターン）
handler: async (args) => {
  const result = await myTool(args);
  if (!result.ok) return result;
  const text = `${result.summary}\n${JSON.stringify(result.data, null, 2)}`;
  return {
    content: [{ type: 'text', text }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
},
```

新規ツール作成・既存ツール修正時は、LLM が受け取る `content` テキストに十分な情報が含まれているか必ず確認する。

## Public ツール

認証不要。誰でも利用可能。

### 新規追加

1. `tools/<name>.ts` に `export const toolDef: ToolDefinition = { name, description, inputSchema, handler }`
   - ハンドラが100行超なら `src/handlers/<name>Handler.ts` に分離
2. `src/tool-registry.ts` の `allToolDefs` 配列に追加
3. `npm run gen:types && npm run typecheck`

### 既存修正

`tools/<name>.ts` か `src/handlers/<name>Handler.ts` の `toolDef` を編集するだけ。

## Private ツール

bitbank API キー（`BITBANK_API_KEY` + `BITBANK_API_SECRET`）が設定されている場合のみ有効化される。

### 仕組み

- `src/private/config.ts` の `isPrivateApiEnabled()` で環境変数の有無を判定
- `src/tool-registry.ts` が条件付きで `tools/private/*.ts` を動的 import し `allToolDefs` に追加
- キー未設定時はスキップされ、ログに `Private API tools disabled` と記録される

### 新規追加

1. `tools/private/<name>.ts` に `export const toolDef` を定義
   - ハンドラが100行超なら `src/handlers/<name>Handler.ts` に分離
   - HTTP 呼び出しは `src/private/client.ts` の `BitbankPrivateClient` を使う
2. 入出力スキーマは `src/private/schemas.ts` に追加
3. `src/tool-registry.ts` の `isPrivateApiEnabled()` ブロック内で動的 import → `allToolDefs.push`
4. `npm run gen:types && npm run typecheck`

### 既存修正

`tools/private/<name>.ts` か `src/handlers/<name>Handler.ts` の `toolDef` を編集するだけ。
