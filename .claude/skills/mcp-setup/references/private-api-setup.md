# Private API セットアップ手順

bitbank MCP の Private ツール（資産確認・注文操作・ポートフォリオ分析など）を
有効化する手順。Public ツール（価格取得・テクニカル分析・チャート生成など）
だけで足りる場合は不要。

---

## 有効化される機能

API キーを設定すると、以下のツールとプロンプトが追加で利用可能になる。

| カテゴリ | ツール |
|---|---|
| 口座情報 | `get_my_assets` |
| 注文照会 | `get_my_orders`, `get_order`, `get_orders_info` |
| 約定履歴 | `get_my_trade_history` |
| ポートフォリオ | `analyze_my_portfolio` |
| 入出金 | `get_my_deposit_withdrawal` |
| 発注 | `preview_order` → `create_order` |
| キャンセル | `preview_cancel_order` → `cancel_order`, `preview_cancel_orders` → `cancel_orders` |
| 信用取引 | `get_margin_status`, `get_margin_positions`, `get_margin_trade_history` |

発注・キャンセル系は **preview → execute の 2 ステップ確認**が必須で、preview が
発行した確認トークンなしでは実行できない仕組みになっている。

---

## Step 1 — bitbank で API キーを発行

1. bitbank 管理画面にログインし、https://app.bitbank.cc/account/api を開く。
2. 「新しい API キーを発行」を選択。
3. 権限を選択:
   - **参照**: 必須（資産・注文・履歴の取得）
   - **取引**: 発注・キャンセルを使う場合のみ
   - **出金**: 不要（本 MCP サーバーは出金機能を提供しない）
4. IP アドレス制限を設定することを推奨（自宅・オフィスの固定 IP がある場合）。
5. API キー（`API Key`）と API シークレット（`API Secret`）を安全に控える。
   シークレットは発行時にしか表示されない。

---

## Step 2 — クライアントに環境変数を設定

### Claude Desktop

`claude_desktop_config.json` の `env` に追加:

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "npx",
      "args": ["-y", "@tjackiet/bitbank-mcp"],
      "env": {
        "BITBANK_API_KEY": "your_api_key",
        "BITBANK_API_SECRET": "your_api_secret",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Claude Code

登録時にまとめて指定する:

```bash
claude mcp add --transport stdio bitbank \
  --env BITBANK_API_KEY=your_api_key \
  --env BITBANK_API_SECRET=your_api_secret \
  -- npx -y @tjackiet/bitbank-mcp
```

既に登録済みの場合は一度 `claude mcp remove bitbank` してから再登録する。

### Cursor

`.cursor/mcp.json` の `env` に追加:

```json
{
  "mcpServers": {
    "bitbank": {
      "command": "npx",
      "args": ["-y", "@tjackiet/bitbank-mcp"],
      "env": {
        "BITBANK_API_KEY": "your_api_key",
        "BITBANK_API_SECRET": "your_api_secret",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Windsurf / 汎用クライアント

設定 JSON の `env` に `BITBANK_API_KEY` と `BITBANK_API_SECRET` を追加する。

---

## Step 3 — 再起動と確認

1. クライアントを再起動する（Claude Desktop は `Cmd+Q` → 再起動、Cursor は
   `Developer: Reload Window`、Claude Code は不要）。
2. `get_my_assets` を呼び出す。
3. 保有資産の一覧が返れば成功。エラーが返る場合は下記「トラブルシューティング」
   を参照。

---

## セキュリティ注意事項

- **API キーとシークレットは Git にコミットしない。**
  特にクライアント設定ファイルを Git 管理下に置いている場合は要注意。
- **`.env` ファイルを使う場合は `.gitignore` に `.env` が含まれていることを
  必ず確認する。**
- **シークレットはログや共有画面に出さない。**
  `LOG_LEVEL=debug` でもシークレットそのものはログ出力されないが、念のため
  画面共有中の設定ファイル表示には注意する。
- **権限は最小限に。** 出金権限は本 MCP サーバーでは不要なので付与しない。
- **IP 制限を推奨。** 固定 IP で運用している場合は bitbank 側で制限を設定する。
- **漏洩した場合はすぐに bitbank 管理画面で該当キーを無効化し、新しいキーを
  発行する。**

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `get_my_assets` が一覧に出ない | `BITBANK_API_KEY` と `BITBANK_API_SECRET` の**両方**が設定されているか確認。片方だけでは Private ツールは有効化されない |
| 認証エラー（401 / signature invalid） | キーの文字列が正しくコピーされているか、前後に空白が混入していないかを確認 |
| IP 制限エラー | bitbank 管理画面で現在の IP を許可リストに追加するか、IP 制限を一旦外して切り分け |
| 発注ツールで「confirmation_token が無効」 | preview → create/cancel の間隔が空きすぎるとトークンが失効する（既定 60 秒）。preview をやり直す |
| `Private API tools disabled` とログに出る | 環境変数が MCP プロセスに渡っていない。クライアント設定の `env` セクションを確認し、完全再起動 |

ログの確認は `env` に `"LOG_LEVEL": "debug"` を追加して再起動。`LOG_DIR` を
指定している場合はそのディレクトリ配下、未指定なら標準の出力先を確認する。
