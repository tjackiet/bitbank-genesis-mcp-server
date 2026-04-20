# クライアント別セットアップガイド

bitbank MCP サーバーを各 MCP クライアントに登録するための設定方法と再起動手順。
いずれのクライアントでも、まずは **npx 方式**（インストール不要）を提示する。
ソースコード起動は、ユーザーが改造や開発をしたい場合のみ補足する。

---

## Claude Desktop

### 設定ファイルの場所

| OS | パス |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

設定ファイルが存在しない場合は新規作成する。

### npx 方式（推奨）

`claude_desktop_config.json` に次を記述:

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "npx",
      "args": ["-y", "@tjackiet/bitbank-mcp"],
      "env": { "LOG_LEVEL": "info" }
    }
  }
}
```

### ソースコード起動（カスタマイズしたい場合）

事前に `git clone` と `npm install` を済ませておく。

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
      "workingDirectory": "/ABS/PATH/to/bitbank-genesis-mcp-server",
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
      "workingDirectory": "C:\\Users\\<USERNAME>\\bitbank-genesis-mcp-server",
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
claude mcp add --transport stdio bitbank -- npx -y @tjackiet/bitbank-mcp
```

Private API キーを同時に設定する場合:

```bash
claude mcp add --transport stdio bitbank \
  --env BITBANK_API_KEY=your_api_key \
  --env BITBANK_API_SECRET=your_api_secret \
  -- npx -y @tjackiet/bitbank-mcp
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

### npx 方式（推奨）

`.cursor/mcp.json` に次を記述:

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "npx",
      "args": ["-y", "@tjackiet/bitbank-mcp"],
      "env": { "LOG_LEVEL": "info" }
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
      "command": "npx",
      "args": ["-y", "@tjackiet/bitbank-mcp"],
      "env": { "LOG_LEVEL": "info" }
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
      "command": "npx",
      "args": ["-y", "@tjackiet/bitbank-mcp"],
      "env": { "LOG_LEVEL": "info" }
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
      "command": "npx",
      "args": ["-y", "@tjackiet/bitbank-mcp"],
      "env": { "LOG_LEVEL": "info" }
    }
  }
}
```

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| ツールが一覧に表示されない | 設定ファイルのパスが正しいか、クライアントを完全再起動したかを確認 |
| `command not found: npx` | Node.js 18 以上をインストール（`node -v` で確認） |
| タイムアウトエラー | ネットワーク接続と bitbank API の状態（https://status.bitbank.cc/）を確認 |
| ソースコード起動で接続できない | `command` / `args` / `workingDirectory` がすべて絶対パスかを確認 |
| Private API ツールが出ない | `BITBANK_API_KEY` と `BITBANK_API_SECRET` の両方が `env` に設定されているか確認 |

`env` に `"LOG_LEVEL": "debug"` を追加して再起動すると、詳細なログが出力される。
