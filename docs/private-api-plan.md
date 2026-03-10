# bitbank Private API 開発計画

bitbank の private API をローカル MCP サーバーから利用し、自分の資産情報・取引履歴を AI エージェントで分析できるようにするための設計メモです。

このドキュメントは、実装中に判断をそろえるための参照用メモとして使います。細かい仕様よりも、何を今やるか、何を今はやらないかを明確にすることを優先します。

## 概要

- 目的:
  ローカル MCP サーバーから bitbank プライベート API を連携し、自分の資産情報・取引履歴を AI エージェントで分析できるようにする
- まずは:
  ジャッキー専用プロトタイプ
- 将来展開:
  社内メンバー → 社外ユーザーへ段階的に展開（自己責任）

## 将来展開を見据えた設計原則

プロトタイプ段階から以下を守ることで、展開時の手戻りを防ぐ。

### 原則 1：マルチユーザー前提の設計

各ユーザーが自分の API キーで利用する形態を想定する。自分のキーをハードコードする設計にしない。

- プロトタイプ段階: `.env` から読み込み（利用者 = 自分だけ）
- 社内展開時: 各メンバーが自分の `.env` を設定
- 社外展開時: 同じ仕組みでそのまま動く（ドキュメント追加のみ）

→ コード側はどの段階でも環境変数から読むだけ。ユーザー管理の仕組みは不要。

### 原則 2：OSS（ローカル）として構成

- 公開 API 版は単体で完結する（現状の AIForge）
- プライベート機能は「API キーが設定されていれば追加ツールが増える」形
- ひとつのコードベースで両方カバーする
- 分岐は起動時の環境変数チェックのみに集約する
- OSS 公開時はプライベート機能も含めて公開し、キーは各自で設定してもらう

### 原則 3：認証ロジックの完全分離

認証モジュールは独立させ、ツール実装から切り離す。将来的に認証方式が変わっても（OAuth 等）、ツール側の変更が不要になるようにする。

### 原則 4：ツールの I/O インターフェースを先に固める

ツールの入出力スキーマ（Zod スキーマ）を先に定義する。内部実装は後から改善できるが、LLM が使うインターフェースを変えるとプロンプトや利用パターンに影響が出る。

### 原則 5：既存アーキテクチャへの準拠

既存の `tool-registry.ts` → `server.ts` 自動登録の仕組みに乗せる。`server.ts` を直接編集しない。プライベートツールも同じ登録パターンに従う。

### 原則 6：テスト可能な設計

外部依存（HTTP 通信）は注入可能にし、mock/fixture で再現可能なテストを書ける構造にする。プロトタイプ段階でも最低限の品質ゲートを設け、Phase が進むごとにテストを自然に積み増せるようにする。

## アーキテクチャ設計

### ディレクトリ構成

```text
src/
├── server.ts                  # MCPサーバー（変更なし）
├── tool-registry.ts           # ツール一括登録（プライベート条件判定をここに追加）
├── schemas.ts                 # Zodスキーマ定義（末尾に re-export 1行追加）
│
├── private/                   # プライベートAPI系
│   ├── auth.ts                # 認証モジュール（HMAC署名生成）
│   ├── client.ts              # プライベートAPI HTTPクライアント（HTTP層注入可能）
│   ├── config.ts              # 設定読み込み・有効性チェック
│   └── schemas.ts             # プライベート系Zodスキーマ
│
├── lib/
│   └── http.ts                # 共通HTTPユーティリティ（リトライ・タイムアウト）
│
tools/                         # ツール実装（既存）
├── ...                        # 既存パブリックツール
└── private/                   # プライベートAPI系ツール
    ├── get_my_assets.ts
    ├── get_my_trade_history.ts
    ├── get_my_orders.ts
    ├── analyze_my_portfolio.ts
    └── get_my_deposit_withdrawal.ts  # Phase 4 で追加

tests/                         # テスト
└── private/
    ├── auth.test.ts            # 署名テストベクタ
    ├── client.test.ts          # mock HTTP でのリクエスト検証
    ├── config.test.ts          # 有効化判定
    └── fixtures/               # API レスポンスの固定データ
        ├── assets.json
        ├── trade_history.json
        ├── deposit_withdrawal.json   # Phase 4 で追加
        └── error_responses.json

.env                            # APIキー（.gitignore対象、プロジェクトルート）
.env.example                    # テンプレート（既存ファイルに追記）
```

### 有効化の仕組み

```typescript
// src/private/config.ts
export function isPrivateApiEnabled(): boolean {
  return !!(process.env.BITBANK_API_KEY && process.env.BITBANK_API_SECRET);
}
```

```typescript
// src/tool-registry.ts（条件付き登録）
import { isPrivateApiEnabled } from './private/config.js';

// 既存のパブリックツール登録ロジック（変更なし）
// ...

// プライベートツールは設定がある場合のみ追加
if (isPrivateApiEnabled()) {
  // tools/private/ 配下の toolDef を allToolDefs に追加
  logger.info('Private API tools enabled');
} else {
  logger.info('Private API tools disabled (no API key configured)');
}
```

`server.ts` は変更しない。条件判定は `tool-registry.ts` に集約し、既存の自動登録の仕組みに乗せる。

条件判定の責務:
登録側（`tool-registry.ts`）で一括判定する。各ツールファイル側に `isPrivateApiEnabled()` チェックは持たせない。ツールは「登録されたら動く」だけのシンプルな責務にする。

この設計のメリット:

- 既存アーキテクチャと一貫した登録パターン
- プロトタイプ → 社内 → 社外、すべて同じコード
- API キーがない環境では従来通りパブリック版として動作
- ユーザーごとの設定ファイルを用意するだけで展開完了
- OSS 公開時も `.env.example` とドキュメントを用意するだけ

### スキーマ設計（ファイル分離 + re-export）

`schemas.ts` は既に大きいため、プライベート系スキーマは `src/private/schemas.ts` に分離する。「単一ソース」の原則（= `schemas.ts` から全スキーマにアクセスできる）は re-export で維持する。

```typescript
// src/private/schemas.ts ← プライベート系はここに定義
import { z } from 'zod';

// --- get_my_assets ---
export const GetMyAssetsInput = z.object({
  include_jpy_valuation: z.boolean().default(true)
    .describe('各通貨の日本円評価額を含めるか'),
});

export const GetMyAssetsOutput = z.object({
  assets: z.array(z.object({
    asset: z.string(),
    amount: z.string(),
    available_amount: z.string(),
    locked_amount: z.string(),
    jpy_value: z.number().optional(),
    allocation_pct: z.number().optional(),
  })),
  total_jpy_value: z.number().optional(),
  timestamp: z.string(),
});

// --- get_my_trade_history ---
// NOTE: count の max 値は bitbank 公式 API の実制限と整合させること（要確認）
export const GetMyTradeHistoryInput = z.object({
  pair: z.string().optional()
    .describe('通貨ペア（省略で全ペア）'),
  since: z.string().optional()
    .describe('開始日時（ISO8601）'),
  end: z.string().optional()
    .describe('終了日時（ISO8601）'),
  count: z.number().max(1000).default(100),
});

// --- analyze_my_portfolio ---
// NOTE: 現時点では「約定ベースの実現/評価損益の簡易分析」。
// 入出金データ対応後は口座全体の真のリターン計算に拡張予定。
export const AnalyzeMyPortfolioInput = z.object({
  include_technical: z.boolean().default(true)
    .describe('保有銘柄のテクニカル分析を含めるか'),
  include_pnl: z.boolean().default(true)
    .describe('損益分析を含めるか（現時点では約定ベース）'),
});

// --- get_my_deposit_withdrawal --- Phase 4 で追加
export const GetMyDepositWithdrawalInput = z.object({
  asset: z.string().optional()
    .describe('通貨コード（省略で全通貨）'),
  since: z.string().optional()
    .describe('開始日時（ISO8601）'),
  end: z.string().optional()
    .describe('終了日時（ISO8601）'),
  count: z.number().max(100).default(25)
    .describe('取得件数'),
});
```

```typescript
// src/schemas.ts ← 末尾に1行追加するだけ
// ... 既存スキーマ ...

export * from './private/schemas.js';
```

`gen:types` は `schemas.ts` からの名前付きインポートを使っているため、この構成で既存のパスがそのまま動く。

### 認証モジュール設計

```typescript
// src/private/auth.ts
// 将来 OAuth 等に切り替える場合もこのインターフェースを維持

export interface AuthHeaders {
  'ACCESS-KEY': string;
  'ACCESS-REQUEST-TIME': string;
  'ACCESS-TIME-WINDOW': string;
  'ACCESS-SIGNATURE': string;
}

export function createAuthHeaders(
  pathOrBody: string,
  requestTime?: string,
  timeWindow: string = '5000'
): AuthHeaders {
  // HMAC-SHA256 署名を生成
  // GET: requestTime + timeWindow + path（クエリ含む）
  // POST: requestTime + timeWindow + JSON body
}
```

認証方式メモ:

- 認証は `ACCESS-TIME-WINDOW` 方式を採用する
- 署名対象文字列は公式 `rest-api.md` に従う
- `ACCESS-NONCE` 方式は使わない
- `timeWindow` は既定 `5000ms`、最大 `60000ms`

### HTTP クライアント設計

```typescript
// src/private/client.ts
// ツールから直接認証を意識させない
// Base URL: https://api.bitbank.cc（public.bitbank.cc とは別）

type HttpFetcher = (url: string, init: RequestInit) => Promise<Response>;

export class BitbankPrivateClient {
  private static readonly BASE_URL = 'https://api.bitbank.cc';
  private fetcher: HttpFetcher;

  constructor(fetcher?: HttpFetcher) {
    this.fetcher = fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T>
  async post<T>(path: string, body: Record<string, unknown>): Promise<T>

  // レート制限: 429 時は Retry-After に従ってリトライ
}
```

`lib/http.ts` との関係:
リトライ・タイムアウトのロジックは `lib/http.ts` に共通ユーティリティとして抽出し、`private/client.ts` とパブリック側の両方から使う。プロトタイプ段階では `private/client.ts` を先に実装し、重複が明確になった時点でリファクタリングする。

### エラーコード方針

異常系の挙動を先に定義し、ツールが返すエラーの種別を統一する。LLM がエラーを受け取ったとき、ユーザーに適切な説明ができるようにする。

| エラーコード | 発生条件 | ツールの返し方 |
|---|---|---|
| `configuration_error` | APIキー未設定・不正 | `isError: true` + 設定手順の案内 |
| `authentication_error` | 署名不正・時刻ずれ | `isError: true` + キー再確認の案内 |
| `rate_limit_error` | 429 でリトライ上限超過 | `isError: true` + 待機時間の案内 |
| `upstream_error` | bitbank 側 5xx・タイムアウト | `isError: true` + 一時的な障害の旨 |
| `partial_data_warning` | 一部データ取得失敗（例: ticker 連携失敗） | `isError: false` + 取得できたデータを返しつつ欠損を明示 |

原則:
エラー時に曖昧なデータを返さない。取得できなかった情報は「取得できなかった」と明示する。`partial_data_warning` のみ部分的な成功を許容し、欠損箇所をメッセージで伝える。

### 損益分析の段階的拡張方針

現在の損益分析は約定ベースの簡易分析であり、以下の限界がある。

現状（Phase 3 完了時点）でできていること:

- 取引所内の約定履歴に基づく実現損益・評価損益
- 移動平均法による平均取得単価の算出
- 保有資産の現在評価額・構成比

現状できていないこと（入出金データがないため）:

- 口座への日本円入金総額が不明 → 総投入元本がわからない
- 外部ウォレットからの暗号通貨入庫を捕捉できない → 取得単価不明
- 他取引所への送金を売却と区別できない
- 口座全体の「本当のリターン（総入金額 vs 現在評価額）」が算出できない

Phase 4 で入出金データを加えると可能になること:

- 総入金額 vs 現在評価額で口座全体の真のリターンを算出
- 暗号通貨の入出庫を除外した、純粋な取引損益の計算
- 時系列の資金フロー可視化（入金 → 取引 → 出金）
- `analyze_my_portfolio` の拡張:
  期間指定 → 入出金 + 約定 + 現在価格を集約 → 正確な損益レポート

## 公式 API リファレンス

実装・修正を始める前に、必ず以下の公式ドキュメントを確認すること。独自の推測で実装すると署名不一致やエラーハンドリング漏れが発生する（実際に `ACCESS-TIME-WINDOW` 方式の署名対象文字列を間違えた前例あり）。

| ドキュメント | URL | 主な確認事項 |
|---|---|---|
| REST API 認証仕様 | https://github.com/bitbankinc/bitbank-api-docs/blob/master/rest-api.md | 署名対象文字列、ヘッダー名、認証方式 |
| エラーコード一覧 | https://github.com/bitbankinc/bitbank-api-docs/blob/master/errors.md | エラーコード番号と分類 |
| Public API 仕様 | https://github.com/bitbankinc/bitbank-api-docs/blob/master/public-api.md | ペア名、ティッカー等の公開エンドポイント |
| Private Stream | https://github.com/bitbankinc/bitbank-api-docs/blob/master/private-stream.md | WebSocket（現時点ではスコープ外） |

## Phase 1: 基盤構築 + 資産残高（2〜3日） ✅ 完了

### 目標

認証基盤を作り、「自分の資産を見て AI に聞く」を実現する。

### タスク

| # | タスク | 見積 | 将来展開への配慮 |
|---|--------|------|-----------------|
| 1-1 | `.env.example` に API キー項目を追記 | 0.5h | 既存の `PORT` / `LOG_DIR` / `LOG_LEVEL` に追記。セットアップガイドとして社内外に配布可能に |
| 1-2 | `private/config.ts` 有効化チェック | 0.5h | 環境変数の有無で分岐（ハードコード防止） |
| 1-3 | `private/auth.ts` HMAC 署名モジュール | 2h | 認証ロジック完全分離。時刻と time window を引数で注入可能にする |
| 1-4 | `private/client.ts` HTTP クライアント | 2h | HTTP 層を注入可能に設計。エラーハンドリング・レート制限を共通化。POST 対応も含む |
| 1-5 | `private/schemas.ts` にプライベート系スキーマ定義 | 1h | I/O インターフェースを先に固める。`schemas.ts` から re-export |
| 1-6 | `get_my_assets` ツール実装 | 3h | ticker 連携で円評価額・構成比を自動算出。ticker 失敗時は `partial_data_warning` |
| 1-7 | `tool-registry.ts` に条件付き登録 | 0.5h | 環境変数なし = 従来通り動作を保証 |
| 1-8 | `auth.ts` 署名テストベクタ作成 | 1h | 既知の入力 → 署名ペアで正しさを検証。実キーは使わない |
| 1-9 | セキュリティチェック | 0.5h | ログ・git history にキーが漏れないか確認 |

### 完了基準

機能:

- [x] `get_my_assets` で Claude に「私の資産構成を教えて」と聞いて正しい回答が返る
- [x] API キーなし環境で既存パブリック機能が従来通り動作する

QA:

- [x] `auth.ts` の署名生成がテストベクタで一致する
- [x] API キーなしでも `gen:types` / `typecheck` が通る
- [x] API キー不正時に `authentication_error` で原因が分かるメッセージが返る
- [x] 429 / 5xx 時にエラーコード方針に沿ったエラー種別で返る
- [x] API キーあり / なし両方でツール一覧の差分が期待通り
- [x] `get_my_assets` の手動確認で、通貨・数量・円換算・合計が矛盾しない

セキュリティ:

- [x] API キーがコード・ログ・git に露出しない
- [x] シークレットがログ出力に含まれないことを確認

## Phase 2: 取引履歴 + 注文情報（3〜4日） ✅ 完了

### 目標

過去の取引データを取得・整形し、AI に分析してもらう土台を作る。

### タスク

| # | タスク | 見積 | 将来展開への配慮 |
|---|--------|------|-----------------|
| 2-1 | `get_my_trade_history` 実装 | 3h | ページネーション対応で大量履歴にも耐える |
| 2-2 | `get_my_orders` 実装 | 2h | アクティブ注文 + 過去注文の両方対応 |
| 2-3 | LLM 向けコンテンツ整形 | 2h | `content` に分析結果を含める（LLM がパースしやすく） |
| 2-4 | 分析プロンプト追加 | 2h | 初心者にも使える会話パターンを用意 |
| 2-5 | `lib/http.ts` 共通化リファクタリング | 2h | リトライ・タイムアウトを共通ユーティリティに抽出 |
| 2-6 | fixture ベースのテスト整備 | 2h | 主要レスポンスパターン（正常・空・大量・エラー）を固定データで検証 |

### 完了基準

機能:

- [x] 取引履歴が正しく取得・整形される
- [x] アクティブ注文・過去注文が参照できる
- [x] 「先月の取引を見せて」で整形されたデータが返る

QA:

- [x] ページネーションが途中で切れずに完走する
- [x] 履歴ゼロ件・単一件・大量件数で整形結果が崩れない
- [x] 注文の status 正規化が安定している
- [x] 要約出力がコンテキスト上限を超えにくいことを確認
- [x] fixture ベースで主要パターンのテストが通る

## Phase 3: 損益分析 + パフォーマンス評価（5〜7日） ✅ 完了

### 目標

損益計算エンジンを構築し、保有資産の多角的な評価と既存パブリック分析ツールとの統合を完成させる。

> 現時点の位置づけ:
> Phase 3 の損益分析は「約定ベースの実現 / 評価損益の簡易分析」である。
> 入出金データを含む口座全体の真のリターン計算は Phase 4 で対応する。

### タスク

| # | タスク | 見積 | 将来展開への配慮 |
|---|--------|------|-----------------|
| 3-1 | 損益計算エンジン | 8-10h | 平均取得単価・含み損益・実現損益を正確に算出。内部は小さな pure function に分割 |
| 3-2 | `analyze_my_portfolio` 実装 | 5h | 既存ツールを内部呼び出しで連携。約定ベースの簡易分析として位置づけ |
| 3-3 | 構成偏り診断ロジック | 2h | ハーフィンダール指数等で定量化 |
| 3-4 | 時系列パフォーマンス追跡 | 3h | 取引履歴ベースで資産推移を再構成 |
| 3-5 | パブリック分析との統合 | 2h | `analyze_market_signal` 等を保有銘柄に自動適用 |
| 3-6 | 損益計算のゴールデンケーステスト | 2h | 固定データで平均取得単価・部分売却・手数料有無を検証 |
| 3-7 | ドキュメント整備 | 2h | `docs/private-api.md`、`.env.example` 更新 |

### 損益分析の限界事項（Phase 3 時点）

現在の `analyze_my_portfolio` は約定履歴のみを入力としているため、以下を正確に扱えない。

- 口座への JPY 入金総額（→ 総投入元本が不明）
- 外部ウォレットからの暗号通貨入庫（→ 取得単価が不明）
- 他取引所・ウォレットへの送金（→ 売却と区別できない）

これらは Phase 4 の入出金対応で解消する。

### パブリック分析との統合イメージ

```text
「私のポートフォリオを分析して」
  ↓
1. get_my_assets → 保有銘柄リスト取得
2. 各銘柄に analyze_market_signal を実行
3. get_my_trade_history → 損益計算（約定ベース）
4. 統合レポート生成
  ↓
「BTC: +10.3%含み益、テクニカルスコア+35（やや強気）
 ETH: -2.1%含み損、テクニカルスコア-12（中立）
 XRP: +5.8%含み益、テクニカルスコア+52（強気）

 全体: 集中度やや高め（BTC 60%）。ETH はスコア中立で要注視。
 ※ 損益は取引所内の約定履歴に基づく簡易分析です。
   入出金を含む正確なリターンは今後対応予定。」
```

### 完了基準

機能:

- [x] 含み損益・実現損益が LLM に分かりやすく提示される
- [x] 包括的なポートフォリオレポートが生成される
- [x] パブリック API 分析と自然に連携できる
- [x] ドキュメントが整備され、社内メンバーがセットアップ可能
- [x] 「先月の取引成績を振り返って」で有用な分析が返る

QA:

- [x] 損益計算のゴールデンケースが固定データで通る（平均取得単価、部分売却、手数料有無）
- [x] 既存 public 分析ツール連携時に partial failure を許容できる（一部銘柄の分析失敗で全体が壊れない）
- [x] 分析不能な場合（履歴なし、対応外ペア等）に「分析できない」旨を明示して返す
- [x] 過度に断定的な投資助言にならないことを確認

## Phase 4: 入出金対応 + 真のリターン計算（3〜5日）

### 目標

入出金（deposit / withdrawal）データを取得し、約定ベースの簡易分析を「口座全体の真のリターン計算」に拡張する。

### 背景

Phase 3 までの損益分析は取引所内の約定履歴のみに基づいており、総投入元本・外部入出庫・他所への送金を考慮できない。入出金 API を組み込むことで、「実際にいくら投入して、今いくらになっているか」を正確に算出する。

### タスク

| # | タスク | 見積 | 将来展開への配慮 |
|---|--------|------|-----------------|
| 4-1 | bitbank 入出金 API エンドポイント調査 | 1h | `GET /v1/user/deposit_history`、`/v1/user/withdrawal_history` 等の仕様確認 |
| 4-2 | `GetMyDepositWithdrawalInput` スキーマ確定 | 1h | API 仕様に合わせて count 上限・フィルタ項目を調整 |
| 4-3 | `get_my_deposit_withdrawal` ツール実装 | 3h | 入金・出金を統合取得。JPY / 暗号通貨の両方に対応。ページネーション対応 |
| 4-4 | 資金フロー整形ロジック | 2h | 入出金 + 約定を時系列で統合し、LLM がパースしやすい形に |
| 4-5 | 損益計算エンジン拡張 | 4-5h | 入出金を考慮した真のリターン計算。外部入庫の取得単価不明ケースの扱い |
| 4-6 | `analyze_my_portfolio` 拡張 | 3h | 入出金データがあれば真のリターンを表示、なければ従来の約定ベース分析にフォールバック |
| 4-7 | fixture + テスト | 2h | 入出金パターン（JPY 入金、暗号入庫、出金、ゼロ件）の固定データ検証 |

### 技術的な注意点

- 外部入庫の取得単価:
  外部ウォレットからの暗号通貨入庫は取得単価が不明。入庫時点の市場価格で仮評価するか、ユーザーに注記するかの方針を決める
- 送金 vs 売却の区別:
  暗号通貨の出金は「他所への送金」であり「売却」ではない。損益計算から除外する
- JPY 入出金:
  日本円の入出金は「投資元本の増減」として扱い、損益ではなく資金フローとして記録する
- フォールバック設計:
  入出金 API が利用不可 / データなしの場合、Phase 3 の約定ベース分析にフォールバックする。入出金対応は付加価値であり、既存機能を壊さない
- `analyze_my_portfolio` の出力区別:
  入出金込みの分析結果と約定ベースの分析結果を明確に区別し、LLM・ユーザーが「どちらの損益か」を誤認しないようにする

### 拡張後の統合イメージ

```text
「私の口座全体のリターンを教えて」
  ↓
1. get_my_assets → 現在の保有状況
2. get_my_deposit_withdrawal → 入出金履歴
3. get_my_trade_history → 約定履歴
4. 統合リターン計算
  ↓
「口座サマリー:
 総入金額: ¥1,500,000（JPY入金 ¥1,200,000 + BTC入庫時評価 ¥300,000）
 現在評価額: ¥1,780,000
 口座全体リターン: +18.7%（+¥280,000）

 約定ベース損益:
  BTC: +10.3%（実現益 ¥85,000 + 含み益 ¥120,000）
  ETH: -2.1%（含み損 ¥15,000）

 ※ BTC 0.05 は外部入庫のため、入庫時市場価格で仮評価しています。」
```

### 完了基準

機能:

- [ ] 入出金履歴が正しく取得・整形される
- [ ] 総入金額 vs 現在評価額で口座全体のリターンが算出できる
- [ ] 入出金データなしの環境で従来の約定ベース分析にフォールバックする
- [ ] 「私の口座全体のリターンを教えて」で入出金込みのレポートが返る

QA:

- [ ] JPY 入金・暗号入庫・出金・ゼロ件の各パターンで fixture テストが通る
- [ ] 外部入庫の取得単価不明ケースで、仮評価の旨が明示される
- [ ] 送金を売却と誤認しない（出金は損益計算から除外される）
- [ ] 入出金込みの数値と約定ベースの数値が混同されない表示になっている
- [ ] 入出金 API 失敗時に `partial_data_warning` で約定ベース分析にフォールバックする

## Phase 5: 注文・売買機能（将来検討）

> Phase 1〜4 の検証結果を見てから判断

### 実装する場合の設計方針（手戻り防止のために今から決めておく）

- API キー権限を分離（参照用キーと売買用キーは別管理）
- 確認フロー必須（AI 提案 → ユーザー承認 → 実行）
- 金額上限・回数制限のセーフガード（`config.ts` で管理）
- 全注文のログ記録（監査対応）
- 社内コンプライアンス・法務との事前確認

### Phase 5 を見据えた現段階の設計配慮

- `private/client.ts` に POST 対応を入れておく（Phase 1 で実装済み）
- エラーハンドリングを共通化しておく（注文系は特にエラー処理が重要）
- ログ基盤を整えておく（取引記録の監査可能性）

## セキュリティチェックリスト

### 実装時

- [x] API キーは `.env` のみに保存
- [x] `.env` は `.gitignore` に追加済み
- [x] `.env.example` にはダミー値のみ（`your_api_key_here`）
- [x] ログ出力にキー情報・シークレットが含まれない
- [x] Phase 1〜3 は「参照権限のみ」のキーを使用
- [x] 署名生成のテストで実キーを使わない

### 展開時（将来）

- [ ] セットアップガイドに「参照のみで発行」を明記
- [ ] API キーの権限設定に関する注意事項をドキュメント化
- [ ] 社外公開前にセキュリティレビュー実施

## マイルストーン

| Phase | 内容 | 期間目安 | ステータス |
|-------|------|----------|------------|
| Phase 1 | 認証基盤 + 資産残高 | 2〜3日 | ✅ 完了 |
| Phase 2 | 取引履歴 + 注文情報 | 3〜4日 | ✅ 完了 |
| Phase 3 | 損益分析 + パフォーマンス評価（約定ベース） | 5〜7日 | ✅ 完了 |
| Phase 4 | 入出金対応 + 真のリターン計算 | 3〜5日 | 🔲 未着手 |
| Phase 5 | 注文機能（要検討） | TBD | ⏸ 保留 |

## 手戻りリスク管理

### 今決めることで将来の手戻りを防ぐもの

| 設計判断 | 今の方針 | 手戻りが起きるパターン | 対策 |
|----------|----------|----------------------|------|
| API キー管理 | 環境変数 | ハードコードしてしまう | `config.ts` で一元管理 |
| マルチユーザー | 各自の `.env` で対応 | 自分専用の前提で設計 | ユーザー固有情報をコードに含めない |
| パブリック / プライベート分離 | 同一コードベース・条件付き有効化 | 密結合してしまう | `private/` ディレクトリ分離 |
| ツール I/O | Zod スキーマ先行定義 | 後からインターフェース変更 | スキーマを先に固める |
| 認証方式 | HMAC（将来 OAuth 等も視野） | 認証がツールに散在 | `auth.ts` に完全分離 |
| エラーハンドリング | `client.ts` に共通化 | ツールごとにバラバラ | 共通クライアント経由 |
| ツール登録 | `tool-registry.ts` で一括判定 | `server.ts` 直接編集・判定の散在 | 登録側に責務を集約 |
| スキーマ配置 | `private/schemas.ts` + re-export | `schemas.ts` 肥大化 | 物理分離 + 単一エントリポイント維持 |
| テスト可能性 | HTTP 層注入可能 + fixture | 実 API 依存で不安定なテスト | mock 差し替え可能な設計を初期から |
| 異常系の挙動 | エラーコード方針を先に定義 | 場当たり的なエラー処理 | 5種のエラーコードで統一 |
| 損益分析の段階性 | 約定ベース → 入出金込みへ段階拡張 | 最初から完全な損益を約束してしまう | Phase 3 を「簡易分析」と明示し、Phase 4 で拡張 |

### 今は気にしなくていいもの

- ユーザー認証・権限管理の仕組み（ローカル実行なので不要）
- マルチテナント対応（各自が自分の MCP サーバーを起動する形態）
- データベース・永続化（API から都度取得で十分）
- CI/CD パイプライン（プロトタイプ段階では不要）
- `lib/http.ts` の完全共通化（Phase 2 以降で重複を見て判断）
- リクエスト ID 付与・発生率モニタリング（社内展開以降で十分）
- LLM 出力品質の snapshot テスト・E2E 自動テスト（段階的に追加）
- 外部入庫の正確な取得単価（ユーザー手入力 or 外部データソース連携は将来検討）

## 更新ルール

- 実装中に重要な設計判断が変わったらこのファイルを更新する
- 細かい作業メモではなく、実装判断に効く内容だけを残す
- Phase の粒度や名称が変わる場合は、完了済みフェーズとの関係も明記する

## 次のアクション

1. bitbank 入出金関連 API のエンドポイント・レスポンス仕様を確認
2. `GetMyDepositWithdrawalInput` スキーマを API 仕様に合わせて確定
3. `get_my_deposit_withdrawal` の最小実装 → Claude で動作確認
4. 損益計算エンジンに入出金ロジックを追加
5. `analyze_my_portfolio` を拡張（フォールバック設計を維持）
