# ADR-0001: Result<T, M> パターンの採用

- **Status**: Accepted
- **Date**: 2025-01-01 (推定)
- **Decision**: 全ツールの戻り値に `Result<T, M>` パターン (`ok()` / `fail()`) を採用する

## Context

MCP ツールのハンドラは成功・失敗を返す必要がある。例外ベースのエラーハンドリングでは、呼び出し元が try-catch を忘れるとクラッシュし、エラーの型情報も失われる。

## Decision

`lib/result.ts` に `ok(text, data, meta)` / `fail(message, meta)` ヘルパーを定義し、全ツールはこのパターンで統一する。戻り値の型は `Result<T, M>` で、`ok: boolean` フラグにより成功・失敗を判別できる。

## Consequences

- ツール実装の一貫性が向上
- テストで `result.ok` をチェックするだけで成功・失敗を検証可能
- `failFromError`, `failFromValidation` でエラー分類（user / network / internal / timeout / upstream）を統一
