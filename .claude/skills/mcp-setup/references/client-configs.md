# クライアント別セットアップガイド

bitbank MCP サーバーを各 MCP クライアントに登録するための設定方法と再起動手順。
現状は **ソースコードから起動する方式のみ**を案内する（npm パッケージ
`@tjackiet/bitbank-mcp` は未公開のため `npx -y @tjackiet/bitbank-mcp` は使えない。
ただし、以下の「方式 A」で使う `npx tsx` はこの制約とは無関係で利用可能）。

## 事前準備（すべてのクライアント共通）

```bash
git clone https://github.com/tjackiet/bitbank-genesis-mcp-server.git
cd bitbank-genesis-mcp-server
npm install
```

## 2 通りの設定方式

以降の各クライアントでは、次の 2 方式のいずれかを選ぶ。**まず方式 A を提示し、
動かない場合のみ方式 B に切り替える。**

### 方式 A — `npx tsx` 経由（推奨）

Node.js のバージョンアップで設定書き換えが発生しない。nvm / volta / Homebrew
いずれの環境でも動く。GUI アプリ（Claude Desktop / Cursor / Windsurf）から
`npx` を解決できない環境では失敗することがあるので、その場合は方式 B へ。

### 方式 B — node の絶対パスを指定（フォールバック）

`which node` の出力を `command` に指定する。

| `which node` の出力 | インストール方法 |
|---|---|
| `/opt/homebrew/bin/node` | Homebrew（Apple Silicon Mac） |
| `/usr/local/bin/node` | Homebrew（Intel Mac）/ 公式インストーラ |
| `/Users/<name>/.nvm/versions/node/vXX.XX.X/bin/node` | nvm |
| `/Users/<name>/.volta/bin/node` | volta |

nvm / volta では Node バージョンアップでパスが変わるため、以降の書き換えが
必要になる点に注意する。

以降の設定例では、方式 B のプレースホルダとして `<ABS_NODE_PATH>` を使う。
`/ABS/PATH/to/` はユーザーの clone 先に置き換える。

---

## Claude Desktop

### 設定ファイルの場所

| OS | パス |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

設定ファイルが存在しない場合は新規作成する。

### 設定内容（macOS / Linux）

**方式 A（推奨・`npx tsx`）:**

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "npx",
      "args": ["tsx", "/ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts"],
      "workingDirectory": "/ABS/PATH/to/bitbank-genesis-mcp-server",
      "env": { "LOG_LEVEL": "info", "NO_COLOR": "1" }
    }
  }
}
```

**方式 B（フォールバック・node 絶対パス）:**

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "<ABS_NODE_PATH>",
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

`<ABS_NODE_PATH>` は `which node` の出力（Apple Silicon なら
`/opt/homebrew/bin/node` など）に置き換える。

### 設定内容（Windows）

Windows の Claude Desktop は PATH の引き継ぎが不安定なため、方式 B を推奨する。

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

**方式 A（推奨）:**

```bash
claude mcp add --transport stdio bitbank \
  -- npx tsx /ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts
```

**方式 B（フォールバック）:**

```bash
claude mcp add --transport stdio bitbank \
  -- <ABS_NODE_PATH> \
     /ABS/PATH/to/bitbank-genesis-mcp-server/node_modules/tsx/dist/cli.mjs \
     /ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts
```

Private API キーを同時に設定する場合（方式 A の例）:

```bash
claude mcp add --transport stdio bitbank \
  --env BITBANK_API_KEY=your_api_key \
  --env BITBANK_API_SECRET=your_api_secret \
  -- npx tsx /ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts
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

`.cursor/mcp.json` に次のいずれかを記述:

**方式 A（推奨）:**

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "npx",
      "args": ["tsx", "/ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts"],
      "workingDirectory": "/ABS/PATH/to/bitbank-genesis-mcp-server",
      "env": { "LOG_LEVEL": "info", "NO_COLOR": "1" }
    }
  }
}
```

**方式 B（フォールバック）:**

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "<ABS_NODE_PATH>",
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

### 再起動方法

コマンドパレット (`Cmd+Shift+P` / `Ctrl+Shift+P`) → `Developer: Reload Window`。
エディタ自体を再起動してもよい。

---

## Windsurf

### 設定方法

Windsurf の MCP 設定画面から、JSON で次のいずれかを追加する:

**方式 A（推奨）:**

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "npx",
      "args": ["tsx", "/ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts"],
      "workingDirectory": "/ABS/PATH/to/bitbank-genesis-mcp-server",
      "env": { "LOG_LEVEL": "info", "NO_COLOR": "1" }
    }
  }
}
```

**方式 B（フォールバック）:**

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "<ABS_NODE_PATH>",
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

### 再起動方法

エディタを再起動する。

---

## 汎用 MCP クライアント

MCP プロトコル対応の任意クライアントでは、Cursor / Windsurf と同じ構造を使う
（方式 A / B から選ぶ）。設定ファイルの場所と再起動方法はクライアントの
ドキュメントを参照する。

---

## 表示名のカスタマイズ

`mcpServers` のキー名がクライアント UI に表示される。日本語も使える。

```json
{
  "mcpServers": {
    "ビットバンクMCP": {
      "command": "npx",
      "args": ["tsx", "/ABS/PATH/to/bitbank-genesis-mcp-server/src/server.ts"],
      "workingDirectory": "/ABS/PATH/to/bitbank-genesis-mcp-server",
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
| 方式 A で `npx not found` / `Server disconnected` | GUI アプリから `npx` が解決できていない。方式 B（node 絶対パス）に切り替える |
| `spawn /usr/local/bin/node ENOENT` | 指定した Node 絶対パスが存在しない（Apple Silicon は `/opt/homebrew/bin/node`）。`which node` を再確認して `command` を更新 |
| Node.js アップデート後に急に動かなくなった | nvm / volta ではバージョンが変わるとパスも変わる。`which node` を再確認して `command` を更新するか、方式 A に切り替える |
| `command not found: node` | Node.js 18 以上をインストール（`node -v` で確認） |
| `Server disconnected` (macOS) | `args` の tsx / server.ts のパスが絶対パスで実在することを確認 |
| タイムアウトエラー | ネットワーク接続と bitbank API の状態（https://status.bitbank.cc/）を確認 |
| Private API ツールが出ない | `BITBANK_API_KEY` と `BITBANK_API_SECRET` の両方が `env` に設定されているか確認 |

`env` に `"LOG_LEVEL": "debug"` を追加して再起動すると、詳細なログが出力される。
