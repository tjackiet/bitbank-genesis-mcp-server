#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
file="$(jq -r '.tool_input.file_path // .tool_input.path // empty' <<< "$input")"

# .ts/.tsx 以外は無視
case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# ファイルが存在しない場合は無視（削除操作等）
[ -f "$file" ] || exit 0

diag=""

# Phase 1: サイレント自動修正
npx biome format --write "$file" >/dev/null 2>&1 || true
npx oxlint --fix "$file" >/dev/null 2>&1 || true

# Phase 2: 残った lint 違反を収集
lint_out="$(npx oxlint "$file" 2>&1 | head -30)" || true
if echo "$lint_out" | grep -q 'Found .* warning\|Found .* error'; then
  diag="[Oxlint] $lint_out"
fi

# Phase 3: 型チェック（対象ファイルのエラーのみ抽出）
tsc_out="$(npx tsc --noEmit -p tsconfig.json 2>&1 | grep -F "$file" | head -10)" || true
if [ -n "$tsc_out" ]; then
  diag="${diag:+${diag}
}[TypeScript] $tsc_out"
fi

# Phase 4: banned patterns チェック
if grep -n 'new Date' "$file" | grep -v '\.test\.ts' | grep -v '// *allow-date' > /dev/null 2>&1; then
  banned="$(grep -n 'new Date' "$file" | head -5)"
  diag="${diag:+${diag}
}[BannedPattern] 'new Date' is banned. Use dayjs from lib/datetime.ts instead:
$banned"
fi

# additionalContext として注入
if [ -n "$diag" ]; then
  jq -Rn --arg msg "$diag" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $msg
    }
  }'
fi
