#!/usr/bin/env bash
# Purpose: Ensure codebase is healthy at session start.
# Runs type generation, typecheck, and tests so the AI never starts
# from a broken state. Mirrors CLAUDE.md "セッション開始時" section.
#
# 最適化: main ブランチの HEAD と差分がなければテストをスキップし、
# 差分がある場合は変更に関連するテストのみ実行する。
# gen:types と typecheck は常に実行（高速かつ全体の整合性に必須）。
set -euo pipefail

# ── compact イベントではスキップ ──
# on-compact.sh がフラグファイルを設置するので、それを検知して早期リターン。
# compact 時は前回セッションの状態を引き継ぐため、再チェック不要。
COMPACT_FLAG="/tmp/.claude-compact-in-progress"
if [ -f "$COMPACT_FLAG" ]; then
  rm -f "$COMPACT_FLAG"
  echo "⏭️  Session start: skipped (triggered by compact)"
  exit 0
fi

echo "🔄 Session start: generating types..."
npm run gen:types 2>&1

echo "🔄 Session start: typechecking..."
npm run typecheck 2>&1

# ── テスト実行の最適化 ──
# 判定ロジック:
#   1. main と HEAD が同一 かつ uncommitted changes なし → スキップ
#   2. main との差分あり → vitest --changed で関連テストのみ実行
#   3. フォールバック（main が不在、git 外など） → 全テスト実行

run_mode="full"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # main ブランチの参照を解決（origin/main → local main の順で試行）
  main_ref=""
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    main_ref="origin/main"
  elif git rev-parse --verify main >/dev/null 2>&1; then
    main_ref="main"
  fi

  if [ -n "$main_ref" ]; then
    main_sha="$(git rev-parse "$main_ref" 2>/dev/null || true)"
    head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
    uncommitted="$(git status --porcelain 2>/dev/null || true)"

    if [ "$main_sha" = "$head_sha" ] && [ -z "$uncommitted" ]; then
      # main の HEAD にいて、未コミットの変更もない → テストスキップ
      run_mode="skip"
    else
      # main との差分がある → 差分ベースで実行
      run_mode="changed"
    fi
  fi
fi

case "$run_mode" in
  skip)
    echo "⏭️  Session start: tests skipped (HEAD = $main_ref, no uncommitted changes)"
    echo "   型生成・型チェックは完了済み。テストは Stop hook / Lefthook / CI で担保。"
    ;;
  changed)
    echo "🔄 Session start: running related tests (diff from $main_ref)..."
    # --changed は差分ファイルに関連するテストのみ実行
    # 関連テストが 0 件の場合も正常終了する（--passWithNoTests 相当）
    test_out="$(npx vitest run --changed "$main_ref" 2>&1)" || true
    echo "$test_out"

    # テスト失敗があれば全テストにフォールバック（差分検出の漏れを補完）
    if echo "$test_out" | grep -qE 'Tests\s+.*failed'; then
      echo "⚠️  差分テストで失敗検出。全テストを実行して確認します..."
      npm test 2>&1
    fi
    ;;
  full)
    echo "🔄 Session start: running all tests..."
    npm test 2>&1
    ;;
esac

echo "✅ Session start checks passed."
