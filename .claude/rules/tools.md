---
globs: tools/**/*.ts, src/handlers/**/*.ts, src/tool-registry.ts
---

# MCP ツール追加・修正

ツールは `toolDef` エクスポート → `src/tool-registry.ts` が集約 → `src/server.ts` が自動登録。
**server.ts を直接編集する必要はない。**

## 新規追加

1. `tools/<name>.ts` に `export const toolDef: ToolDefinition = { name, description, inputSchema, handler }`
   - ハンドラが100行超なら `src/handlers/<name>Handler.ts` に分離
2. `src/tool-registry.ts` の `allToolDefs` に追加
3. `npm run gen:types && npm run typecheck`

## 既存修正

`tools/<name>.ts` か `src/handlers/<name>Handler.ts` の `toolDef` を編集するだけ。
