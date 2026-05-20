# Public API 突合テスト — プロンプト集

## 使い方

1. **【コピー】** ブロックだけを Claude に貼る（1 ブロック = 1 チャット）
2. 返ってきた数値を bitbank アプリと見比べる
3. 許容差: ±2 桁。ずれたら配列の **末尾の 1 つ前** でも比較

**注意:** 配列末尾での数値突合は **`prepare_chart_data`** が確実（content 内 JSON の `-1` / `-2`）。日常確認は **`analyze_indicators`** でも可（MACD line / signal / hist は content テキストに出る）。

ターミナルだけでよい場合: `npx tsx scripts/analyze_indicators_cli.ts btc_jpy 1day 200` → JSON の `data.indicators.MACD_line` 等。

---

## QS-01 — BTC 日足 RSI / BB / MACD

アプリ: BTC/JPY 日足 · RSI14 · BB20-2 · MACD12-26-9

### 【コピー】

```text
prepare_chart_data を 1 回だけ呼ぶ。
pair=btc_jpy, type=1day, limit=200, indicators=["RSI","MACD","BB"]

推測禁止。content 内の JSON から各配列の最後の要素（-1）を読み、表で出す:

| 項目 | 値 |
|------|-----|
| RSI(14) | subPanels.RSI_14 の末尾 |
| BB upper | series.BB_upper の末尾 |
| BB middle | series.BB_middle の末尾 |
| BB lower | series.BB_lower の末尾 |
| MACD line | subPanels.MACD.line の末尾 |
| MACD signal | subPanels.MACD.signal の末尾 |
| MACD hist | subPanels.MACD.hist の末尾 |

同じ項目について末尾の 1 つ前（-2）も別表で出す（未確定足の比較用）。
summary の warning があれば表の前に全文。
```

---

## A-02 — BTC 4 時間足

アプリ: BTC/JPY 4時間 · インジケータは QS-01 と同じ

### 【コピー】

```text
prepare_chart_data を 1 回: pair=btc_jpy, type=4hour, limit=200, indicators=["RSI","MACD","BB"]

QS-01 と同じ表（末尾と -2）。warning 全文。推測禁止。
```

---

## B-01 — BB が snapshot と一致するか

### 【コピー】

```text
pair=btc_jpy, type=1day, limit=200 で各 1 回:
1. prepare_chart_data（indicators=["BB"]）
2. analyze_bb_snapshot

BB upper/middle/lower の末尾を 2 列で比較。一致/不一致を 1 行。推測禁止。
```

---

## C-01 — ティッカー

アプリ: BTC/JPY ティッカー画面

### 【コピー】

```text
get_ticker を pair=btc_jpy で 1 回。

last, buy, sell, high, low, volume を表で。推測禁止。
```

---

## C-02 — ローソク足 直近 3 本

アプリ: BTC/JPY 日足 · 直近 3 本

### 【コピー】

```text
get_candles を pair=btc_jpy, type=1day, limit=5 で 1 回。

直近 3 本の isoTime, open, high, low, close, volume を表で。
warning があれば全文。推測禁止。
```

---

## E-02 — warning 伝播

### 【コピー】

```text
順に 1 回ずつ:
1. get_candles — btc_jpy, 1day, limit=800
2. analyze_bb_snapshot — btc_jpy, 1day
3. analyze_market_signal — btc_jpy, 1day

各ステップの warning / warnings を列挙。なければ「なし」。消えたステップがあれば指摘。
```

---

## その他

### A-01 ETH 日足

```text
prepare_chart_data: eth_jpy, 1day, limit=200, indicators=["RSI","MACD","BB"]
QS-01 と同じ表（末尾と -2）。推測禁止。
```

### B-02 Stoch

```text
btc_jpy, 1day, limit=200:
1. prepare_chart_data（indicators=["STOCH"]）— subPanels の %K/%D 末尾
2. analyze_stoch_snapshot — 同項目
2 列で比較。推測禁止。
```

### B-04 一目

```text
analyze_ichimoku_snapshot: btc_jpy, 1day, 1 回。
価格と雲の位置、spanA/B の値、根拠を短文で。推測禁止。
```

### D-01 ATR

```text
get_volatility_metrics: btc_jpy, 1day, 1 回。
ATR 最終値と period。SMA-ATR である旨 1 行。推測禁止。
```

### F-01 総合シグナル（解釈確認）

```text
analyze_market_signal: btc_jpy, 1day, 1 回。
confidence、⚠️ 行を要約。MACD は hist のみテキストに出る点に注意。
```

### QS-解説 — analyze_indicators を使った場合

```text
analyze_indicators: btc_jpy, 1day, limit=200 を 1 回。

テキストから RSI(14) と BB 三本は抜き出せる。MACD は hist のみ（line/signal はテキストに無い）。
その制限を 2 行で報告し、取れた値だけ表にする。推測禁止。
```

---

## チェックリスト

| ID | 済 |
|----|-----|
| QS-01 | |
| A-02 | |
| B-01 | |
| C-01 | |
| C-02 | |
| E-02 | |
