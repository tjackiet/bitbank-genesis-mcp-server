#!/usr/bin/env bash
# Purpose: Claude Code web の Initialized session で実行される setup script。
# コンテナ初回起動時に依存関係をインストールし、型生成・型チェックまで通して
# リンターやテスト実行の前提環境を整える。
#
# 方針:
# - `npm install` は必須（初回コンテナでは node_modules が無い）。
# - `npm run gen:types` → `npm run typecheck` で健全性チェック。
#   Zod スキーマからの型生成は他ツールの前提なので web 起動時にも必ず走らせる。
# - テストは実行しない。web 起動で毎回走らせると重く、既に
#   Stop hook / Lefthook / CI で担保されているため。
set -euo pipefail

echo "🔄 Setup: installing dependencies..."
npm install

echo "🔄 Setup: generating types..."
npm run gen:types

echo "🔄 Setup: typechecking..."
npm run typecheck

echo "✅ Setup: ready."
