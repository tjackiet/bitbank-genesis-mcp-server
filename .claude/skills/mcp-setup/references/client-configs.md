# クライアント別セットアップガイド

bitbank MCP サーバーを各 MCP クライアントに登録するための設定方法と再起動手順。
現状は **ソースコードから起動する方式のみ**を案内する（npm パッケージ
`@tjackiet/bitbank-mcp` は未公開のため `npx` 方式は使わない）。

## 事前準備（すべてのクライアント共通）

```bash
git clone https://github.com/tjackiet/bitbank-genesis-mcp-server.git
cd bitbank-genesis-mcp-server
npm install
```

Node.js のパスは `which node` で確認する（Homebrew は `/opt/homebrew/bin/node`、
公式インストーラは `/usr/local/bin/node`）。以降の設定例では
`/usr/local/bin/node` と `/ABS/PATH/to/` を用いる。ユーザー環境に合わせて
書き換えること。

---

## Claude Desktop

### 設定ファイルの場所

| OS | パス |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

設定ファイルが存在しない場合は新規作成する。

### 設定内容

**macOS / Linux:**

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

**Windows:**

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "node",
      "args": [
        "C:\\Users\\<USERNAME>\\bitbank-genesis-mcp-server\\node_modules\\tsx\\dist\\cli.mjs",
        "C:\\Users\\<USERNAME>\\bitbank-genesis-mcp-server\\src\\server.ts"
      ],
      "env": { "LOG_LEVEL": "info", "NO_COLOR": "1" }
    }
  }
}
```

`<USERNAME>` はユーザー名、`/ABS/PATH/to/` は実際のパスに置き換える。
macOS では Desktop フォルダ配下に配置すると権限エラーになることがあるため、
ホームディレクトリ直下に配置することを推奨する。

### 再起動方法

- macOS: `Cmd+Q` で完全終了 → 再起動
- Windows: タスクトレイから「完全終了」 → 再起動

「ウィンドウを閉じる」だけでは設定が反映されない点に注意する。

---

## Claude Code

### 登録方法（CLI）

設定ファイルを手で編集する必要はない。次のコマンドで登録する。

```bash
claude mcp add --transport stdio bitbank \
  -- /usr/local/bin/node \
     /ABS/PATH/to/bitbank-genesis-mcp-server/node_modules/tsx/dist/cli.mjs \
     /ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts
```

Private API キーを同時に設定する場合:

```bash
claude mcp add --transport stdio bitbank \
  --env BITBANK_API_KEY=your_api_key \
  --env BITBANK_API_SECRET=your_api_secret \
  -- /usr/local/bin/node \
     /ABS/PATH/to/bitbank-genesis-mcp-server/node_modules/tsx/dist/cli.mjs \
     /ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts
```

### 確認・削除

```bash
claude mcp list              # 登録済みサーバー一覧
claude mcp remove bitbank    # 登録解除
```

### 再起動方法

不要（即時反映）。

---

## Cursor

### 設定ファイルの場所

- プロジェクト単位: `<workspace>/.cursor/mcp.json`
- グローバル: Cursor の Settings → MCP で設定

### 設定内容

`.cursor/mcp.json` に次を記述:

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

### 再起動方法

コマンドパレット (`Cmd+Shift+P` / `Ctrl+Shift+P`) → `Developer: Reload Window`。
エディタ自体を再起動してもよい。

---

## Windsurf

### 設定方法

Windsurf の MCP 設定画面から、JSON で次を追加する:

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

### 再起動方法

エディタを再起動する。

---

## 汎用 MCP クライアント

MCP プロトコル対応の任意クライアントでは、基本構造は同じ:

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

設定ファイルの場所と再起動方法はクライアントのドキュメントを参照する。

---

## 表示名のカスタマイズ

`mcpServers` のキー名がクライアント UI に表示される。日本語も使える。

```json
{
  "mcpServers": {
    "ビットバンクMCP": {
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

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| ツールが一覧に表示されない | 設定ファイルのパスが正しいか、クライアントを完全再起動したかを確認 |
| `command not found: node` | Node.js 18 以上をインストール（`node -v` で確認）。`command` には `which node` の結果を絶対パスで指定 |
| `Server disconnected` (macOS) | `command` の Node パスと `args` の tsx / server.ts のパスがすべて絶対パスで実在することを確認 |
| タイムアウトエラー | ネットワーク接続と bitbank API の状態（https://status.bitbank.cc/）を確認 |
| Private API ツールが出ない | `BITBANK_API_KEY` と `BITBANK_API_SECRET` の両方が `env` に設定されているか確認 |

`env` に `"LOG_LEVEL": "debug"` を追加して再起動すると、詳細なログが出力される。
