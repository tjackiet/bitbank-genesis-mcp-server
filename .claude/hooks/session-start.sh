#!/usr/bin/env bash
# Purpose: Ensure codebase is healthy at session start.
# Runs type generation, typecheck, and tests so the AI never starts
# from a broken state. Mirrors CLAUDE.md "セッション開始時" section.
set -euo pipefail

echo "🔄 Session start: generating types..."
npm run gen:types 2>&1

echo "🔄 Session start: typechecking..."
npm run typecheck 2>&1

echo "🔄 Session start: running tests..."
npm test 2>&1

echo "✅ Session start checks passed."
