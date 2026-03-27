# 開発プロセスにおけるハーネス（安全装置・自動化）一覧

> **対象リポジトリ**: bitbank-genesis-mcp-server
> **目的**: コーディングエージェント (Claude Code) に開発を委託する際、人手によるコードレビューの代わりに品質・安全性を担保する仕組みの全体像を整理する。

---

## 全体像サマリテーブル

| # | タイミング | ハーネス名 | 目的 | 強度 |
|---|-----------|-----------|------|------|
| 1 | 常時 (Permission deny) | `--no-verify` ブロック | Git hook スキップの禁止 | **ブロック** |
| 2 | SessionStart | セッション開始ヘルスチェック | 壊れた状態で作業を開始しない | **ブロック** |
| 3 | PreToolUse | 設定ファイル保護 | リンター/コンパイラ設定の改ざん防止 | **ブロック** |
| 4 | PostToolUse | TypeScript 自動修正 + 診断 | 編集直後にフォーマット・lint・型・banned pattern を検査 | **警告** (自動修正 + フィードバック) |
| 5 | Stop (プロジェクト) | テスト自動実行 | コード変更時にテスト失敗を見逃さない | **警告** (フィードバック → 再作業) |
| 6 | Stop (グローバル) | Git 未 push 検出 | 変更の commit/push 忘れ防止 | **警告** (フィードバック → 再作業) |
| 7 | pre-commit (Git hook) | Lefthook 総合チェック | commit 前に型生成・型検査・lint・format・banned pattern・秘密ファイル検出 | **ブロック** |
| 8 | CI (push/PR) | CI ワークフロー | リモートでの多層検証 (lint, format, typecheck, test, coverage, banned pattern, npm audit) | **ブロック** (PR マージ不可) |
| 9 | CI (定期/PR) | Security Audit | npm 依存パッケージの脆弱性監査 | **ブロック** |
| 10 | CI (リリース) | Release CI Gate | タグ push 時に全チェック再実行してからパブリッシュ | **ブロック** |
| 11 | 常時 (CLAUDE.md) | 禁止事項・ルール指示 | AI への行動規範 (any 禁止, new Date 禁止, アーキテクチャ規約) | **指示** (ソフト) |
| 12 | 常時 (Biome) | `noExplicitAny: error` | any 型の使用を静的に検出 | **ブロック** (lint エラー) |

---

## カテゴリ別 詳細

### 1. Permission Deny — `--no-verify` ブロック

| 項目 | 内容 |
|------|------|
| **タイミング** | 常時（Claude Code がコマンドを実行する前） |
| **目的** | Git の pre-commit hook をスキップさせない。エージェントが hook 失敗を回避するために `--no-verify` を付ける「抜け道」を封じる |
| **手段** | `.claude/settings.json` の `permissions.deny` で以下を拒否: `git commit --no-verify*`, `git commit -n *`, `git commit *--no-verify*` |
| **強度** | **ブロック** — Claude Code 自体がコマンド実行を拒否する |

---

### 2. SessionStart — セッション開始ヘルスチェック（差分最適化付き）

| 項目 | 内容 |
|------|------|
| **タイミング** | セッション開始時 |
| **目的** | コードベースが壊れた状態のまま作業を開始しない |
| **手段** | `.claude/hooks/session-start.sh` が `npm run gen:types` → `npm run typecheck` → テスト（最適化付き）の順に実行 |
| **強度** | **ブロック** — `set -euo pipefail` により途中で失敗すると hook 全体が失敗し、エージェントにエラーが通知される |
| **補足** | CLAUDE.md の「セッション開始時」セクションと同じ内容を hook として強制実行。CLAUDE.md だけでは AI が従わない可能性があるため、hook で機械的に担保 |

**テスト実行の最適化（3モード）:**

| モード | 条件 | 動作 | 所要時間 |
|--------|------|------|---------|
| **skip** | HEAD = main かつ uncommitted changes なし | テストスキップ（型生成・型チェックのみ） | ~8s |
| **changed** | main との差分あり | `vitest --changed` で関連テストのみ実行 | ~1-3s |
| **full** | git 外、main 参照不能 | 全テスト実行（従来動作） | ~16s |

`gen:types` と `typecheck` は全モードで常に実行（Zod スキーマと型の整合性は差分に依存しないため）。

---

### 3. PreToolUse — 設定ファイル保護

| 項目 | 内容 |
|------|------|
| **タイミング** | Write / Edit / MultiEdit ツール実行前 |
| **目的** | エージェントが lint エラーや型エラーを「設定ファイルを緩めて」解決するのを防ぐ |
| **手段** | `.claude/hooks/protect-config.sh` が対象ファイルパスを検査。保護対象: `biome.json`, `tsconfig.json`, `lefthook.yml`, `.claude/settings.json`, `package.json`, `.github/workflows/ci.yml` |
| **強度** | **ブロック** — exit 2 で操作を拒否。メッセージ: `"Fix the code, not the linter/compiler config."` |

---

### 4. PostToolUse — TypeScript 自動修正 + 診断フィードバック

| 項目 | 内容 |
|------|------|
| **タイミング** | Write / Edit / MultiEdit でファイルが変更された直後 |
| **目的** | 編集のたびに即座にコード品質をチェックし、問題があればエージェントにフィードバック |
| **手段** | `.claude/hooks/post-ts-lint.sh` が `.ts` / `.tsx` ファイルに対して4段階で処理: |

**4段階の処理フロー:**

| Phase | 内容 | 動作 |
|-------|------|------|
| Phase 1 | Biome format + Oxlint 自動修正 | サイレントに `--write` / `--fix` 適用 |
| Phase 2 | Oxlint 残存エラー収集 | 修正できなかった違反を収集 |
| Phase 3 | TypeScript 型チェック（最適化付き） | `tsc --noEmit --incremental` + 30 秒スロットリング |
| Phase 4 | Banned pattern チェック | `new Date` の使用を検出 (`// allow-date` コメント付きは除外) |

**Phase 3 の最適化:**
- `--incremental --tsBuildInfoFile` で 2 回目以降を高速化（~6s → ~1.5s）
- 前回成功から 30 秒以内はスキップ（連続編集時 ~6s → 0s）
- Lefthook pre-commit が最終的な型チェックのゲートキーパーとなるため安全

| 項目 | 内容 |
|------|------|
| **強度** | **警告（フィードバック）** — exit 0 で返すが `additionalContext` として診断メッセージを注入。エージェントは次のアクションでこれを受け取り、自発的に修正する |

---

### 5. Stop (プロジェクト) — テスト自動実行 + 完了条件チェックリスト

| 項目 | 内容 |
|------|------|
| **タイミング** | エージェントが「タスク完了」と判断して停止する直前 |
| **目的** | コード変更時のテスト未実行、および明示的な完了条件の未達を防ぐ |
| **手段** | `.claude/hooks/stop-test.sh` が以下を順に実行: (1) `.claude/completion-checklist` が存在すれば `checklist-verify.sh` で全チェック実行、(2) `.ts`/`.tsx` 変更があれば `vitest run` 実行。いずれかの失敗を `additionalContext` で通知 |
| **強度** | **警告（フィードバック → 再作業）** — 失敗をフィードバックすると、エージェントは停止せず修正作業を再開する |

**Completion Checklist（Sprint Contract）**:

タスク着手前に `.claude/completion-checklist` を作成し、機械的に検証可能な完了条件を定義できる。全条件通過でファイルは自動削除される。

| チェックタイプ | 書式 | 用途 |
|--------------|------|------|
| `file_exists` | `file_exists <path>` | ファイルの存在確認 |
| `file_not_empty` | `file_not_empty <path>` | ファイルが空でないこと |
| `no_type_errors` | `no_type_errors` | `tsc --noEmit` でエラー 0 |
| `test_passes` | `test_passes [filter]` | `vitest run` が成功 |
| `grep_in` | `grep_in <pattern> <path>` | パターンの存在確認 |
| `grep_not_in` | `grep_not_in <pattern> <path>` | パターンの不在確認 |
| `cmd` | `cmd <command>` | 任意コマンドの成功 |

---

### 6. Stop (グローバル) — Git 未 push 検出

| 項目 | 内容 |
|------|------|
| **タイミング** | エージェントが停止する直前（全リポジトリ共通） |
| **目的** | 変更を commit/push せずにセッションを終了するのを防ぐ |
| **手段** | `~/.claude/stop-hook-git-check.sh` が以下を順に検査: (1) uncommitted changes, (2) untracked files, (3) unpushed commits |
| **強度** | **警告（フィードバック → 再作業）** — exit 2 + メッセージで通知。エージェントは push を完了してから再度停止を試みる |
| **補足** | 再帰防止機構あり (`stop_hook_active` フラグ)。Git リポジトリ外では即座に exit 0 |

---

### 7. pre-commit (Git Hook) — Lefthook 総合チェック

| 項目 | 内容 |
|------|------|
| **タイミング** | `git commit` 実行時 |
| **目的** | コミット前の最終防衛線として多角的にチェック |
| **手段** | `lefthook.yml` で以下を**並列**実行: |

| チェック | 内容 |
|----------|------|
| `gen-types` | Zod スキーマから型定義を再生成 |
| `typecheck` | `tsc --noEmit` で型チェック |
| `lint` | ステージファイルに対して Oxlint 実行 |
| `format-check` | ステージファイルに対して Biome フォーマットチェック |
| `banned-patterns` | `new Date` の使用を検出 (テストファイル除外) |
| `secrets-check` | `.env`, `.pem`, `.key`, `credentials.json` 等の秘密ファイルの混入を検出 |

| 項目 | 内容 |
|------|------|
| **強度** | **ブロック** — いずれかが失敗するとコミット自体が中断される |
| **補足** | Permission deny (#1) により `--no-verify` でのスキップは不可能 |

---

### 8. CI — CI ワークフロー

| 項目 | 内容 |
|------|------|
| **タイミング** | main への push / PR 作成時 |
| **目的** | ローカルチェックをすり抜けた問題をリモートで捕捉 |
| **手段** | `.github/workflows/ci.yml` が以下を順次実行: |

| ステップ | 内容 |
|----------|------|
| npm audit | 依存パッケージの脆弱性チェック (critical、警告のみ) |
| gen:types | Zod スキーマから型再生成 |
| banned patterns | `new Date` のグローバル検索 |
| Oxlint | lint チェック |
| Biome | フォーマットチェック |
| typecheck | 型チェック |
| test | テスト実行 |
| coverage | カバレッジ閾値チェック |

| 項目 | 内容 |
|------|------|
| **強度** | **ブロック** — CI 失敗で PR マージ不可 (ブランチ保護ルール) |

---

### 9. CI — Security Audit

| 項目 | 内容 |
|------|------|
| **タイミング** | main への push / PR + 毎週月曜 9:00 UTC (定期実行) |
| **目的** | npm 依存パッケージの脆弱性を継続的に監視 |
| **手段** | `.github/workflows/security.yml` で `npm audit --audit-level=high` を実行 |
| **強度** | **ブロック** — high 以上の脆弱性があれば失敗 |

---

### 10. CI — Release CI Gate

| 項目 | 内容 |
|------|------|
| **タイミング** | タグ push (`v*`) 時 |
| **目的** | リリース前に全チェックを再実行し、壊れたバージョンの公開を防ぐ |
| **手段** | `.github/workflows/release.yml` の `ci` ジョブが lint/format/typecheck/test を実行。成功後に npm publish + Docker push + GitHub Release を作成 |
| **強度** | **ブロック** — CI gate が失敗するとパブリッシュされない |

---

### 11. CLAUDE.md — 禁止事項・アーキテクチャルール

| 項目 | 内容 |
|------|------|
| **タイミング** | 常時（AI のコンテキストに注入） |
| **目的** | エージェントの行動規範を定義 |
| **手段** | `CLAUDE.md` + `.claude/rules/*.md` で以下を指示: |

| ルール | 内容 | 機械的な裏付け |
|--------|------|---------------|
| `any` 型禁止 | `unknown` + 型ガードを使う | Biome `noExplicitAny: error`, Oxlint が検出 |
| `new Date` 禁止 | `lib/datetime.ts` の dayjs ラッパーを使う | PostToolUse hook, Lefthook, CI で三重検出 |
| スキーマ単一ソース | `src/schemas.ts` (Zod) | gen:types で型生成 |
| Result パターン | `ok()` / `fail()` で返す | — (規約のみ) |
| 独自可視化コード禁止 | 既存の描画パスを使う | — (規約のみ) |
| Tailwind CDN 禁止 | jsDelivr の CSS を使う | — (規約のみ) |

| 項目 | 内容 |
|------|------|
| **強度** | **指示（ソフト）** — AI への指示であり、機械的な強制力はルールにより異なる。重要なルールは hook/CI で二重に担保 |

---

### 12. Biome / Oxlint — 静的解析設定

| 項目 | 内容 |
|------|------|
| **タイミング** | PostToolUse hook, pre-commit hook, CI |
| **目的** | コードスタイルの統一、危険なパターンの検出 |
| **手段** | `biome.json`: `noExplicitAny: error` (server.ts/http.ts のみ warn)、インデントはタブ、120文字幅、シングルクォート。Oxlint: recommended ルールセット |
| **強度** | **ブロック** — error レベルの違反は hook/CI で失敗 |

---

## 多層防御の構造図

```
エージェントの作業フロー:

SessionStart ─── [hook] 型生成 → 型チェック → テスト
                  ↓ 失敗時: 作業開始をブロック
    ┌─────────────────────────────────────────────┐
    │  開発ループ                                  │
    │                                             │
    │  ファイル編集                                 │
    │    ├─ [PreToolUse]  設定ファイル保護 → ブロック │
    │    └─ [PostToolUse] 自動修正 + 診断 → 警告     │
    │                                             │
    │  git commit                                  │
    │    └─ [Lefthook] 6項目チェック → ブロック       │
    │       └─ --no-verify → Permission deny       │
    │                                             │
    │  タスク完了                                   │
    │    ├─ [Stop] テスト実行 → 失敗時は再作業       │
    │    └─ [Stop] 未push検出 → push完了まで再作業   │
    └─────────────────────────────────────────────┘
                  ↓
    git push / PR 作成
      └─ [CI] 全チェック再実行 → 失敗で PR マージ不可
                  ↓
    タグ push (リリース)
      └─ [Release CI Gate] 全チェック → 失敗でパブリッシュ不可
```

---

## 設計思想

1. **同じチェックを複数のタイミングで繰り返す（多層防御）**
   - `new Date` の禁止は PostToolUse → Lefthook → CI の三重チェック
   - 型チェックは SessionStart → PostToolUse → Lefthook → CI の四重チェック
   - これにより、1つのレイヤーをすり抜けても次で捕捉される

2. **「抜け道」の封鎖**
   - エージェントが設定ファイルを緩めてエラーを回避 → PreToolUse で保護
   - エージェントが `--no-verify` で hook をスキップ → Permission deny で拒否

3. **即時フィードバック + 最終ブロック**
   - PostToolUse は「警告」として即座に問題を伝え、エージェントに自律修正の機会を与える
   - Lefthook / CI は「ブロック」として最終的に不正なコードの混入を防ぐ

4. **人手不要の品質担保**
   - 全てのチェックが自動化されており、オーナーがコードを読めなくても品質が維持される
   - オーナーが確認すべきは「CI が緑かどうか」のみ
