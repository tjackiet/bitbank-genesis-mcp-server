# ADR-0003: ESLint/Prettier を使わず TypeScript strict モードで型安全を担保

- **Status**: Accepted
- **Date**: 2025-01-01 (推定)
- **Decision**: ESLint / Prettier は導入せず、TypeScript strict モードによる型安全を品質の基盤とする

## Context

リンター・フォーマッターは設定の維持コストが発生し、AI エージェントとの開発では設定競合やノイズになりやすい。

## Decision

TypeScript の `strict: true` を有効化し、型チェック (`tsc --noEmit`) を CI で強制する。コードスタイルは TypeScript の型システムで担保できる範囲に限定し、フォーマットの統一は求めない。

## Consequences

- 設定ファイルの維持コストがゼロ
- CI パイプラインがシンプル
- コードフォーマットの不統一は許容する（トレードオフ）
- `new Date` 禁止のような非型的ルールは CI の grep チェックで補完する
