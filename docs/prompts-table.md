# プロンプト一覧（全 9 種）

このMCPサーバーでは、以下のプロンプトを提供しています。
ツール名を指定する必要はなく、自然な質問でも適切なプロンプトが選択されます。

---

## 初級（3 種）

専門用語を避け、わかりやすい言葉で説明。視覚的なゲージや絵文字を活用。

| # | プロンプト名 | 主な使用ツール | 概要 |
|---|-------------|---------------|------|
| 1 | 🔰 BTCの価格を分析して | get_candles, analyze_market_signal, analyze_indicators | 価格動向とトレンドを RSI・移動平均・一目で初心者向けに説明 |
| 2 | 🔰 ETHの価格を分析して | get_candles, analyze_market_signal, analyze_indicators | ETH版。構成は BTC 版と同じ |
| 3 | 🔰 今注目のコインは？ | get_tickers_jpy | 出来高と24h変化率から注目通貨をランキング表示 |

**出力構成（BTC/ETH分析）**: 1. 市場の動き → 2. 3つの主要指標 → 3. 関係性 → 4. 今後の注目点 → 5. まとめ

## 中級（6 種）

専門用語を適切に使用。数値と根拠を明確に提示。複数ツールを組み合わせた総合分析。

| # | プロンプト名 | 主な使用ツール | 概要 |
|---|-------------|---------------|------|
| 4 | 中級：主要指標でBTCを分析して | analyze_indicators | RSI / MACD / BB / 一目 / SMA を一括取得し総合分析 |
| 5 | 中級：BTCのフロー分析をして | get_flow_metrics, get_transactions | CVD・Aggressor Ratio・スパイクから短期モメンタムを分析 |
| 6 | 中級：BTCの板の状況を詳しく見て | get_orderbook (statistics, raw) | 板の厚み・流動性分布・大口注文から短期サポレジと売買圧力を分析 |
| 7 | 中級：BTCのパターン分析をして | detect_patterns, analyze_candle_patterns | 完成済み＆形成中チャートパターン＋ローソク足パターンを統合検出 |
| 8 | 中級：BTCのサポレジを分析して | analyze_support_resistance, get_orderbook, analyze_sma_snapshot | 過去90日の反応と現在の板・圧力を統合してサポレジ強度を評価 |
| 9 | 🌅 おはようレポート | create_file, present_files | 直近8時間の価格動向をHTMLダッシュボードで視覚化（Claude Desktop推奨） |

---

## 使い方

Claude Desktop などのクライアントから、プロンプト名をそのまま呼び出せます：

```
🔰 BTCの価格を分析して
```

または、自然な質問でも適切なプロンプトが選択されます：

```
ビットコインの今後の見通しを教えて
```

---

⚠️ **注意**: 全てのプロンプトは参考情報です。投資判断はご自身の責任で行ってください。
