---
name: mcp-setup
description: |
  bitbank MCP サーバーの初回セットアップと接続確認。
  ユーザーが暗号資産の価格確認、テクニカル分析、チャート表示、
  注文操作などを行おうとした際に、MCP サーバーが未接続であれば
  このスキルのセットアップ手順を実行する。
  MCP ツールが利用可能であれば、セットアップ済みと判断して
  ユーザーのリクエストをそのまま処理する。
  「bitbank を設定して」「MCPサーバーをセットアップして」
  「仮想通貨の分析環境を作りたい」でも起動する。
metadata:
  author: bitbank-aiforge
  version: "1.0"
---

# bitbank MCP セットアップ

bitbank MCP サーバーを AI エージェントから利用できる状態にするためのスキル。
ユーザーが bitbank 由来の機能を呼ぼうとした際、サーバーの状態を自動判定し、
必要なときだけセットアップを案内する。

---

## 動作の基本方針

- **状態の自動判定を先に行い、必要な場合のみセットアップ手順を開始する。**
- **判定ロジックや内部の検査手順をユーザーに説明しない。**
  「設定ファイルを確認しました」「ツールを呼び出しました」などの実装詳細は出さない。
- **Web で bitbank を開くなど、MCP 以外の代替手段は提案しない。**
  このスキルは MCP サーバーのセットアップ専用。
- **セットアップ完了後は、ユーザーが元々行いたかったリクエストに戻る。**
- **登録先クライアントは最初に必ず確認する。** Claude Code / Claude Desktop /
  Cursor / Windsurf はそれぞれ別レジストリで、片方に登録しても他方には反映
  されない。実行中のクライアントだけに登録して完了と見なさない（詳細は Step 1）。

---

## bitbank-server-state（状態判定）

bitbank MCP サーバーの状態を次の 3 つに分類する。判定はこの順で行う。

### 1. working — サーバーが正常に動作している

判定: `get_ticker`（pair: `btc_jpy` など軽量なもの）を呼び出して、正常な ticker
データが返る。

アクション: セットアップについて一切触れず、ユーザーのリクエストをそのまま処理する。

例外: ユーザーのリクエストが Private API ツール（`get_my_assets` /
`get_my_orders` / `preview_order` など）を必要とするが、該当ツールが利用不可の
場合のみ、Private API セットアップを案内する（`references/private-api-setup.md`）。

### 2. not-working — サーバーは設定済みだが接続できない

判定: MCP ツール呼び出しが失敗し（ツールが存在しない・応答がない・エラー）、
かつクライアントの MCP 設定ファイルに `bitbank` サーバーの登録がある。

アクション: 次のように伝えてトラブルシューティングを開始する。

> サーバーは設定済みですが、接続できていないようです。以下を順に確認してください。

確認項目:

1. **Node.js のインストール** — `node -v` で 18 以上が表示されるか。
   表示されなければ https://nodejs.org/ からインストール。
2. **クライアントの完全再起動** — Claude Desktop は `Cmd+Q`（Windows は
   タスクトレイから完全終了）→ 再起動。「閉じる」だけでは反映されない。
3. **パスの確認（ソースコード起動の場合のみ）** — 設定ファイルの `command` /
   `args` / `workingDirectory` がすべて絶対パスで、実在するか。
4. **ログの確認** — 設定の `env` に `"LOG_LEVEL": "debug"` を追加して再起動し、
   クライアントのログを確認する。

上記で解消しない場合は、設定を見直して `not-setup` のセットアップ手順に進む。

### 3. not-setup — サーバーが未登録

判定: MCP ツール呼び出しが失敗し、クライアントの MCP 設定ファイルにも
`bitbank` サーバーの登録がない。設定ファイル自体が存在しない場合もこれに該当。

アクション: 下記「セットアップ手順」を開始する。

---

## セットアップ手順（not-setup の場合のみ）

### Step 1 — 登録先クライアントの確認（複数可）

ユーザーに **どのクライアントに登録したいか** を必ず明示的に尋ねる。
以下から **複数選択可** で選んでもらう。

- Claude Desktop
- Claude Code
- Cursor
- Windsurf
- その他（汎用 MCP クライアント）

**重要: Claude Code と Claude Desktop は別レジストリ。**

- Claude Code への登録（`claude mcp add` / `~/.claude.json`）は Claude Desktop
  には反映されない。逆も同じ。
- 同じ Anthropic 製品でもアプリが別なので、**両方で使いたいユーザーはそれぞれ
  個別に登録が必要**。
- このスキルが Claude Code 上で実行されていても、勝手に「Claude Code だけで
  いい」と決めつけない。ユーザーが Claude Desktop も使う可能性があるため、
  最初に **「Claude Code と Claude Desktop は別の登録になります。どちらに
  登録しますか？（両方も可）」** と確認する。

選ばれたクライアントそれぞれについて Step 2 以降を適用する。詳細は
`references/client-configs.md` を参照する。

### Step 2 — 前提条件の確認

次を確認する。不足があればインストール手順を案内する。

- **Node.js 18 以上**: `node -v` で確認。未インストールなら https://nodejs.org/
  から LTS をインストール。
- **OS**: macOS / Linux / Windows（WSL 含む）のいずれか。

### Step 3 — 設定の適用

`references/client-configs.md` のクライアント別ガイドに従い、設定を適用する。

まずリポジトリを clone して依存をインストールしてもらう:

```bash
git clone https://github.com/tjackiet/bitbank-genesis-mcp-server.git
cd bitbank-genesis-mcp-server
npm install
```

その上で最初に提示する標準構成（全クライアント共通・推奨）:

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "/usr/local/bin/node",
      "args": [
        "/ABS/PATH/to/bitbank-genesis-mcp-server/node_modules/tsx/dist/cli.mjs",
        "/ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts"
      ],
      "env": { "LOG_LEVEL": "info", "NO_COLOR": "1" }
    }
  }
}
```

- `command` の Node パスは `which node` で確認する（Homebrew なら `/opt/homebrew/bin/node`）。
- `/ABS/PATH/to/` はユーザーの実際の clone 先に置き換える。

Claude Code の場合はコマンド一発で登録できる:

```bash
claude mcp add --transport stdio bitbank \
  -- /usr/local/bin/node /ABS/PATH/to/bitbank-genesis-mcp-server/node_modules/tsx/dist/cli.mjs \
     /ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts
```

注: npm パッケージ（`@tjackiet/bitbank-mcp`）は未公開のため、`npx -y @tjackiet/bitbank-mcp` 方式は現状使用しない。

### Step 4 — 再起動

クライアントに応じた再起動方法を案内する（詳細は `references/client-configs.md`）。

- Claude Desktop: `Cmd+Q`（Windows は完全終了）→ 再起動
- Claude Code: 不要（即時反映）
- Cursor: コマンドパレット → `Developer: Reload Window`
- Windsurf: エディタを再起動

### Step 5 — 接続確認

再起動後、`get_ticker`（`pair: "btc_jpy"`）を呼び出して接続を確認する。
正常な ticker が返れば「セットアップが完了しました」と伝え、ユーザーが元々
行いたかったリクエストに戻る。

失敗した場合は `not-working` の確認項目に沿って再点検する。

---

## Private API セットアップ（任意）

`get_my_assets` / `get_my_orders` / `analyze_my_portfolio` / `preview_order` など、
ユーザー個別の資産・注文・履歴を扱うツールは Private API キーが必要。

ユーザーが Private API を必要とするリクエストを出し、かつ該当ツールが利用不可
である場合のみ、`references/private-api-setup.md` の手順に従って案内する。
Public ツールだけで足りるリクエストでは、自発的に Private API を勧めない。

---

## ユーザーへの伝え方

- ✅ 「bitbank MCP サーバーを登録します」「設定ファイルに次を追加してください」
- ✅ 「再起動後、`get_ticker` で接続を確認します」
- ❌ 「状態を判定しました」「get_ticker を呼び出して working と判定しました」
- ❌ 「設定ファイルをチェックしたら登録がありませんでした」

状態判定の中間結果や内部の検査手順は出さない。ユーザーから見ると、
「必要なときだけセットアップが始まり、そうでなければ普通に使える」体験になる。
