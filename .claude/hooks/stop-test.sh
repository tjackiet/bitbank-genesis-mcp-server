#!/usr/bin/env bash
set -euo pipefail

# Stop Hook: コード変更があった場合のみテストを実行
# .ts/.tsx の変更がなければスキップ

changed="$(git diff --name-only HEAD 2>/dev/null || true)"
staged="$(git diff --cached --name-only 2>/dev/null || true)"
untracked="$(git ls-files --others --exclude-standard 2>/dev/null || true)"

all_changes="$(printf '%s\n%s\n%s' "$changed" "$staged" "$untracked" | sort -u | grep -v '^$' || true)"

# .ts/.tsx ファイルの変更がなければスキップ
if ! echo "$all_changes" | grep -qE '\.(ts|tsx)$'; then
  exit 0
fi

# テスト実行（tail で出力を抑制しつつ結果を表示）
test_out="$(npx vitest run --reporter=verbose 2>&1 | tail -20)" || true

# 失敗があればフィードバック
if echo "$test_out" | grep -qE 'Tests\s+.*failed'; then
  failed_detail="$(echo "$test_out" | grep -E 'FAIL|×|❌|failed|Error' | head -10)"
  jq -Rn --arg msg "[TestFailure] テストが失敗しています。修正してください:
$test_out" '{
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: $msg
    }
  }'
fi
