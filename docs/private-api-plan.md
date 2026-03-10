# bitbank Private API 開発計画

bitbank の private API をローカル MCP サーバーから利用し、自分の資産情報や取引履歴を AI エージェントで分析できるようにするための設計メモです。

このドキュメントは、実装中に判断をそろえるための参照用メモとして使います。細かい仕様よりも、何を今やるか、何を今はやらないかを明確にすることを優先します。

## 目的

- ローカル MCP サーバーから bitbank private API を連携する
- 自分の資産情報、取引履歴、注文情報を AI から参照・分析できるようにする
- 将来的な社内展開、社外公開を見据えつつ、まずはジャッキー専用プロトタイプとして成立させる

## スコープ

### 今回やること

- private API 用の認証モジュールを実装する
- private API 用の HTTP クライアントを実装する
- `get_my_assets` を最初の private ツールとして実装する
- 環境変数があるときだけ private ツールを有効化する
- Phase 1 で必要な最小限の QA とセキュリティ確認を行う

### 今はやらないこと

- ユーザー認証や権限管理の仕組み
- マルチテナント対応
- データベースや永続化
- 大規模な E2E テスト基盤
- LLM 出力の snapshot テスト
- 売買実行機能
- 本格的な監視指標や運用ダッシュボード

## 設計原則

### 1. マルチユーザー前提の設計

各ユーザーが自分の API キーを設定して使う前提で設計する。コードに特定ユーザーのキーや前提を埋め込まない。

- プロトタイプ段階: `.env` から読み込む
- 社内展開時: 各メンバーが自分の `.env` を設定する
- 社外展開時: 同じ仕組みを維持し、ドキュメントを追加する

### 2. OSS として同一コードベースを維持する

公開 API 版は単体で完結し、private API キーが設定されている場合だけ private ツールが追加される構成にする。分岐は起動時の設定チェックに集約する。

### 3. 認証ロジックを完全分離する

認証方式は `src/private/auth.ts` に閉じ込める。将来的に認証方式が変わっても、ツールやクライアントの変更範囲を最小化する。

### 4. ツールの I/O を先に固める

LLM が触るインターフェースは早めに安定させる。private 系の入出力スキーマは `src/private/schemas.ts` に定義し、`src/schemas.ts` から re-export する。

### 5. 既存アーキテクチャに準拠する

既存の `tool-registry.ts` 経由の登録に乗せる。`server.ts` は直接編集しない。

## 想定ディレクトリ構成

```text
src/
├── server.ts
├── tool-registry.ts
├── schemas.ts
├── private/
│   ├── auth.ts
│   ├── client.ts
│   ├── config.ts
│   └── schemas.ts
├── lib/
│   └── http.ts
tools/
├── ...
└── private/
    ├── get_my_assets.ts
    ├── get_my_trade_history.ts
    └── get_my_orders.ts
.env
.env.example
```

## 有効化方針

- `BITBANK_API_KEY` と `BITBANK_API_SECRET` の両方が存在するときだけ private API を有効化する
- 条件判定は `src/tool-registry.ts` に集約する
- 各 private ツールの中で有効化判定を重複させない
- API キー未設定環境では、従来どおり public ツールだけが使える状態を維持する

## Phase 計画

### Phase 1: 基盤構築 + 資産残高

目的: 認証基盤を整備し、「自分の資産を AI に聞ける」状態を作る。

主なタスク:

- `.env.example` に private API 用の設定項目を追加する
- `src/private/config.ts` を追加し、有効化チェックを実装する
- `src/private/auth.ts` に HMAC 署名生成を実装する
- `src/private/client.ts` に private API 用クライアントを実装する
- `src/private/schemas.ts` に private 系スキーマを追加する
- `tools/private/get_my_assets.ts` を実装する
- `src/tool-registry.ts` に条件付き登録を追加する
- API キーがコード、ログ、git に露出しないことを確認する

Phase 1 完了基準:

- [x] `auth.ts` の署名生成が公式ドキュメントのテストベクタで一致する（GET/POST 両方）
- [ ] API キーなしでも `gen:types` / `typecheck` が通る
- [ ] API キー不正時に `fail()` で原因が分かるメッセージが返る
- [ ] 429 / 5xx 時に想定したエラー種別で返る
- [ ] `get_my_assets` の手動確認で、数量・円換算・合計が矛盾しない
- [ ] API キーがコード・ログ・git に露出しない

### Phase 2: 取引履歴 + 注文情報

目的: 過去の取引データを取得、整形し、AI 分析に使える土台を作る。

完了タスク:

- [x] `get_my_trade_history` を実装する
- [x] `get_my_orders` を実装する
- [x] LLM 向けに履歴データを要約しやすい形へ整形する
- [x] since/end の strict ISO8601 バリデーション（`parseIso8601` ヘルパー追加）
- [x] order=asc 時のサマリー表示修正（末尾10件を表示）
- [x] from_id/end_id 未対応を description に明記

Phase 2 完了基準:

- [x] `get_my_trade_history` が実 API で正常動作する
- [x] `get_my_orders` が実 API で正常動作する
- [x] since/end に不正値を渡した場合 validation_error が返る
- [x] order=asc/desc の両方でサマリーが正しく表示される
- [x] `gen:types` / `typecheck` が通る

### Phase 3: 損益分析 + パフォーマンス評価

目的: 損益計算とポートフォリオ評価を行い、private データと既存 public 分析を統合する。

完了タスク:

- [x] 損益計算エンジンを実装する（移動平均法による平均取得単価・実現損益算出）
- [x] `analyze_my_portfolio` を実装する（`src/handlers/analyzeMyPortfolioHandler.ts` にハンドラ分離）
- [x] 構成比・評価損益・実現損益の算出
- [x] 既存の public 分析ツール（`analyzeIndicators`）とのテクニカル分析統合
- [ ] Inspector / 実 API での E2E 確認

Phase 3 完了基準:

- [ ] `analyze_my_portfolio` が実 API で正常動作する
- [ ] PnL 算出結果（平均取得単価・評価損益・実現損益）が手動確認で矛盾しない
- [ ] テクニカル分析統合（RSI, SMA乖離率, トレンド）が正常に返る
- [ ] include_pnl=false / include_technical=false で該当データが省略される
- [ ] `gen:types` / `typecheck` が通る

実装メモ:

- 損益計算は移動平均法（総平均法）を採用。買いで取得原価を積み上げ、売りで按分して実現損益を計上
- 約定履歴は最大1000件を取得。それ以上の履歴がある場合、平均取得単価の精度が下がる可能性あり
- テクニカル分析は保有上位5通貨に制限（API 負荷軽減）
- ticker / 約定履歴 / テクニカル分析の各取得失敗は非致命的（取得できた範囲で結果を返す）

### Phase 4: 注文・売買機能

Phase 1 から 3 の検証結果を見てから判断する。実装する場合でも、参照系とは安全策を明確に分ける。

前提とする安全方針:

- 参照用キーと売買用キーを分離する
- AI の提案から直接注文せず、明示的な承認フローを設ける
- 金額上限と回数制限を設ける
- 注文ログを監査可能な形で残す

## Phase 1 の最小 QA 方針

プロトタイプ段階では、重い QA 体制は作らない。代わりに、将来の拡張を妨げない最小限の品質ゲートだけ入れる。

- `auth.ts` の署名生成はテストベクタで自動確認する
- `client.ts` は将来テストしやすいよう、`fetch` を注入可能な設計にしておく
- 異常系は最低限だけ扱う
- 手動確認でユーザー価値を確認する

Phase 1 で扱う異常系:

- API キー未設定: private ツールを登録しない
- API キー不正または署名不正: `fail()` で明確なメッセージを返す
- 429: `Retry-After` に従って再試行し、失敗時は `rate_limit_error` として返す
- 5xx: `upstream_error` として返す

想定エラー種別:

- `configuration_error`
- `authentication_error`
- `rate_limit_error`
- `upstream_error`

## セキュリティ方針

- API キーとシークレットは `.env` のみに保存する
- `.env.example` にはダミー値のみを置く
- ログにキーや署名文字列を出さない
- Phase 1 から 3 は参照権限のみのキーで検証する
- テストコードやテストベクタに実キーを使わない

## 公式 API リファレンス

実装・修正を始める前に、必ず以下の公式ドキュメントを確認すること。
独自の推測で実装すると署名不一致やエラーハンドリング漏れが発生する（実際に ACCESS-TIME-WINDOW 方式の署名対象文字列を間違えた前例あり）。

| ドキュメント | URL | 主な確認事項 |
|---|---|---|
| REST API 認証仕様 | https://github.com/bitbankinc/bitbank-api-docs/blob/master/rest-api.md | 署名対象文字列の組み立て、ヘッダー名、認証方式 |
| エラーコード一覧 | https://github.com/bitbankinc/bitbank-api-docs/blob/master/errors.md | エラーコード番号と分類（認証系: 20001-20005、レート制限: 10009） |
| Public API 仕様 | https://github.com/bitbankinc/bitbank-api-docs/blob/master/public-api.md | ペア名・ティッカー等の公開エンドポイント |
| Private Stream | https://github.com/bitbankinc/bitbank-api-docs/blob/master/private-stream.md | WebSocket（現時点ではスコープ外） |

### 認証方式メモ（ACCESS-TIME-WINDOW 方式を採用）

```
ヘッダー:
  ACCESS-KEY:          API キー
  ACCESS-REQUEST-TIME: ミリ秒 UNIX タイムスタンプ
  ACCESS-TIME-WINDOW:  有効期間（ミリ秒、デフォルト 5000、最大 60000）
  ACCESS-SIGNATURE:    HMAC-SHA256 署名

署名対象文字列:
  GET:  requestTime + timeWindow + path（クエリパラメータ含む）
  POST: requestTime + timeWindow + JSONボディ
```

## 実装時のメモ

- private API のベース URL は `https://api.bitbank.cc`
- public API の `https://public.bitbank.cc` とは別物として扱う
- `count` などの入力上限は bitbank API の公式仕様に合わせる
- 認証は ACCESS-TIME-WINDOW 方式を採用（ACCESS-NONCE 方式は使わない）
- `server.ts` は編集しない

## 更新ルール

- 実装中に重要な設計判断が変わったらこのファイルを更新する
- 細かい作業メモではなく、実装判断に効く内容だけを残す
- Phase 2 以降の詳細は、必要になった時点で追記する

## 次のアクション

1. bitbank 管理画面で参照専用の API キーを発行する
2. `.env.example` に private API 用の設定項目を追加する
3. `src/private/auth.ts` の署名モジュールを実装する
4. `get_my_assets` の最小実装を行い、手動確認する
