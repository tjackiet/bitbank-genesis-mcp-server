# bitbank `/candlestick` の暦日仕様（実測ログ）

`tools/get_candles.ts` の `computeAnchorEndMs` が `date` パラメータを UTC 暦日として解釈している現状実装が「正しい」かどうかは、bitbank API 自体が candle を UTC でグルーピングしているか JST でグルーピングしているかに依存する。本ドキュメントはこの 1 点を **実 API を叩いて実測** し、結論を固定する。

## 結論（断定）

1. **`/candlestick/1hour/<YYYYMMDD>` のグルーピング基準は UTC 暦日。**
   `20251002` で返る 24 本は `1759363200000` (= 2025-10-02T00:00:00Z) から `1759446000000` (= 2025-10-02T23:00:00Z) まで。JST 基準（先頭が `1759330800000` = 2025-10-01T15:00:00Z）ではない。
2. **`/candlestick/1day/<YYYY>` の各 daily candle の timestamp は UTC 00:00。**
   `2025` の先頭バーは `1735689600000` (= 2025-01-01T00:00:00Z, JST 2025-01-01T09:00)、末尾は `1767139200000` (= 2025-12-31T00:00:00Z)。1 年 = 365 本（UTC 暦年）。
3. **取引開始前 / 未来日付は HTTP 404 + `success: 0` + `data.code: 10000`。** 空配列ではなくエラー応答。

## 計測条件

| 項目 | 値 |
|---|---|
| 取得日 | 2026-05-22 (JST) |
| ベースコミット | `d5b1fff` (origin/main, "Merge pull request #547") |
| ペア | `btc_jpy` |
| 認証 | なし（パブリック API） |
| 実行環境 | macOS ローカル `curl` 7.x + `jq` |

サンドボックスからは `public.bitbank.cc` がネットワーク allowlist 外のためアクセス不可。ローカル端末で逐次実行（各リクエスト間 `sleep 1`）した結果を以下に転記する。

## 実行コマンド

```bash
for url in \
  "https://public.bitbank.cc/btc_jpy/candlestick/1hour/20251002" \
  "https://public.bitbank.cc/btc_jpy/candlestick/1day/2025" \
  "https://public.bitbank.cc/btc_jpy/candlestick/1hour/20251007" \
  "https://public.bitbank.cc/btc_jpy/candlestick/1hour/20100101" \
  "https://public.bitbank.cc/btc_jpy/candlestick/1hour/20991231"
do
  curl -sS --max-time 10 "$url" | jq '...'
  sleep 1
done
```

## 生データ

### 1. `GET /btc_jpy/candlestick/1hour/20251002`

`HTTP 200, success=1, count=24`

| 位置 | timestamp (ms) | ISO UTC | ISO JST |
|---|---:|---|---|
| 先頭 | `1759363200000` | `2025-10-02T00:00:00Z` | `2025-10-02T09:00:00+09:00` |
| 末尾 | `1759446000000` | `2025-10-02T23:00:00Z` | `2025-10-03T08:00:00+09:00` |

先頭 ts が `1759363200000` = UTC 00:00 → **UTC 基準**。
（JST 基準なら `1759330800000` = `2025-10-01T15:00:00Z` になる。）

先頭 3 行（参考）:
```json
[["17446934","17560000","17444089","17444089","29.6277",1759363200000],
 ["17442001","17506918","17440001","17474542","14.3396",1759366800000],
 ["17470763","17512125","17459204","17508024","7.0724",1759370400000]]
```

末尾 3 行:
```json
[["17762063","17780360","17682306","17692357","6.4990",1759438800000],
 ["17692358","17715303","17661527","17684686","5.0822",1759442400000],
 ["17684686","17737740","17684686","17729335","4.9077",1759446000000]]
```

### 2. `GET /btc_jpy/candlestick/1day/2025`

`HTTP 200, success=1, count=365`

| 位置 | timestamp (ms) | ISO UTC | ISO JST |
|---|---:|---|---|
| 先頭 | `1735689600000` | `2025-01-01T00:00:00Z` | `2025-01-01T09:00:00+09:00` |
| 末尾 | `1767139200000` | `2025-12-31T00:00:00Z` | `2025-12-31T09:00:00+09:00` |

各 daily candle の timestamp が UTC 00:00 → **UTC 00:00 基準**。
365 本（うるう年でない年は 365）= UTC 暦年で 1/1〜12/31。

末尾 3 行（参考）:
```json
[["13750000","14121429","13577103","13620599","267.2248",1766966400000],
 ["13620600","13934565","13590000","13813942","148.8865",1767052800000],
 ["13813941","13892214","13645001","13690527","260.4839",1767139200000]]
```

### 3. `GET /btc_jpy/candlestick/1hour/20251007`

`HTTP 200, success=1, count=24`

| 位置 | timestamp (ms) | ISO UTC | ISO JST |
|---|---:|---|---|
| 先頭 | `1759795200000` | `2025-10-07T00:00:00Z` | `2025-10-07T09:00:00+09:00` |
| 末尾 | `1759878000000` | `2025-10-07T23:00:00Z` | `2025-10-08T08:00:00+09:00` |

probe 1 と同じ挙動（UTC 暦日 24 本）を別日付で再確認。**UTC 基準**で一貫。

### 4. `GET /btc_jpy/candlestick/1hour/20100101`（取引開始前）

`HTTP 404, success=0, data.code=10000`

bitbank の BTC/JPY 取引開始（2017 年）より前の日付。レスポンスは空配列ではなく**エラー応答**で返る。

### 5. `GET /btc_jpy/candlestick/1hour/20991231`（未来）

`HTTP 404, success=0, data.code=10000`

未来日付。取引開始前と同じ扱い（HTTP 404 + `data.code: 10000`）。

## PR-3 への申し送り（5 行）

1. bitbank API は **UTC 暦日でグルーピング** が実測で確定。`computeAnchorEndMs` の `dayjs.utc()` 解釈は API 仕様と一致しており、「二重補正」リスクはない（= JST 化は単独 TZ 変換のみ必要）。
2. `computeAnchorEndMs` の YYYYMMDD 解釈を **JST 暦日** に切り替え、anchor 端を UTC `14:59:59.999` of YYYYMMDD（= JST `23:59:59.999`）に変更する。
3. sub-day 系（1min/5min/15min/30min/1hour）は JST 暦日が UTC 2 日にまたがるため、要求 `YYYYMMDD` と前日 `YYYYMM(DD-1)` の 2 chunk を fetch して anchor 端で filter する必要あり。
4. `1day/YYYY` は API 側の timestamp が UTC 00:00 固定。JST 暦日対応のバーは API 側に存在しないため、「UTC 00:00 バー = JST 同日 09:00 のバー」として扱う方針を JSDoc / docs に明記し、厳密な JST 集約バーは提供しないことを示す。
5. 既存テスト（`tests/get_candles.test.ts` の `dayMs` / `hourMs` ヘルパ）は UTC 基準で書かれているため、JST 化に合わせて更新する。`404 + data.code: 10000`（取引開始前 / 未来）の挙動はそのまま preserve。

## 関連

- 実装: `tools/get_candles.ts:96-109` (`computeAnchorEndMs`)
- 既存テスト: `tests/get_candles.test.ts`（UTC 基準を前提）
- 公式ドキュメント (`bitbankinc/bitbank-api-docs/master/public-api.md`) はタイムゾーンを明記していないため、本実測ログを社内一次ソースとする。
