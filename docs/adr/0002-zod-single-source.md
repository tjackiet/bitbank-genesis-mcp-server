# ADR-0002: Zod スキーマを単一ソースとする

- **Status**: Accepted
- **Date**: 2025-01-01 (推定)
- **Decision**: `src/schemas.ts` の Zod スキーマを型定義・バリデーションの単一ソースとする

## Context

TypeScript の型定義とランタイムバリデーションが二重管理になると、両者の乖離がバグを生む。

## Decision

`src/schemas.ts` に全 Zod スキーマを定義し、`scripts/gen_types.ts` で `.d.ts` を自動生成する。手書きの型定義は作成しない。CI で `gen:types` → `typecheck` を実行し、スキーマと型の整合性を機械的に保証する。

## Consequences

- スキーマ変更が型定義に自動反映される
- バリデーションと型が必ず一致する
- スキーマ変更時は `npm run gen:types && npm run typecheck` が必須
