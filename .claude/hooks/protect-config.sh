#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
file="$(jq -r '.tool_input.file_path // .tool_input.path // empty' <<< "$input")"

# 保護対象の設定ファイル
PROTECTED="biome.json tsconfig.json lefthook.yml .claude/settings.json"

for p in $PROTECTED; do
  case "$file" in
    *"$p"*)
      echo "BLOCKED: $file is a protected config file. Fix the code, not the linter/compiler config." >&2
      exit 2
      ;;
  esac
done
