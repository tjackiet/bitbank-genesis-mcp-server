# ADR-0004: new Date を禁止し dayjs を使用する

- **Status**: Accepted
- **Date**: 2025-01-01 (推定)
- **Decision**: プロダクションコードでの `new Date` を禁止し、`lib/datetime.ts` 経由の dayjs を使用する

## Context

JavaScript の `Date` はタイムゾーン処理が不安定で、テストの再現性を損なう。特に JST 表示が頻出する暗号資産分析では、タイムゾーン関連のバグが致命的になる。

## Decision

`lib/datetime.ts` に dayjs ラッパーを定義し、全ての日時処理をここ経由で行う。`new Date` はプロダクションコードで使用禁止とし、CI の grep チェックで機械的に検出する。

## Consequences

- タイムゾーン処理が一元化される
- テストでの時刻固定が容易（dayjs のモック）
- テストファイルでの `new Date` はフィクスチャ生成用途として許容する
