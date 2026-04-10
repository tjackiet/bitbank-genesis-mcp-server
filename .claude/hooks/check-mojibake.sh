#!/usr/bin/env bash
set -euo pipefail

# Purpose: Detect U+FFFD (Unicode Replacement Character) in files after
# Write/Edit/MultiEdit. If found, exit 2 to prompt Claude to fix the
# corrupted characters.
# Ref: https://github.com/anthropics/claude-code/issues/43746

INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')"

# ファイルが存在しない場合は無視（削除操作等）
[ -n "$FILE_PATH" ] && [ -f "$FILE_PATH" ] || exit 0

if grep -q $'\xef\xbf\xbd' "$FILE_PATH"; then
  echo "U+FFFD (文字化け) detected in $FILE_PATH. Fix the corrupted characters." >&2
  grep -n $'\xef\xbf\xbd' "$FILE_PATH" | head -5 >&2
  exit 2
fi
