#!/usr/bin/env bash
set -euo pipefail

# Stop Hook: テスト自動実行 + 完了条件チェックリスト検証
# 1. completion-checklist があれば検証（checklist-verify.sh）
# 2. .ts/.tsx の変更があればテスト実行

diag=""

# ── 1. Completion Checklist 検証 ──
CHECKLIST_HOOK="$(dirname "$0")/checklist-verify.sh"
if [ -f ".claude/completion-checklist" ] && [ -x "$CHECKLIST_HOOK" ]; then
  checklist_out="$(bash "$CHECKLIST_HOOK" 2>&1)" || true
  if [ -n "$checklist_out" ]; then
    # checklist-verify.sh が JSON を出力した場合はフィードバック内容を抽出
    checklist_msg="$(echo "$checklist_out" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null || true)"
    if [ -n "$checklist_msg" ]; then
      diag="$checklist_msg"
    fi
  fi
fi

# ── 2. テスト自動実行（.ts/.tsx の変更がある場合のみ） ──
changed="$(git diff --name-only HEAD 2>/dev/null || true)"
staged="$(git diff --cached --name-only 2>/dev/null || true)"
untracked="$(git ls-files --others --exclude-standard 2>/dev/null || true)"

all_changes="$(printf '%s\n%s\n%s' "$changed" "$staged" "$untracked" | sort -u | grep -v '^$' || true)"

if echo "$all_changes" | grep -qE '\.(ts|tsx)$'; then
  # テスト実行（tail で出力を抑制しつつ結果を表示）
  test_out="$(npx vitest run --reporter=verbose 2>&1 | tail -20)" || true

  # 失敗があればフィードバック
  if echo "$test_out" | grep -qE 'Tests\s+.*failed'; then
    diag="${diag:+${diag}
}[TestFailure] テストが失敗しています。修正してください:
$test_out"
  fi
fi

# ── 診断結果を出力 ──
if [ -n "$diag" ]; then
  jq -Rn --arg msg "$diag" '{
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: $msg
    }
  }'
fi
