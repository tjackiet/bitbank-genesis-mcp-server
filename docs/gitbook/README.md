---
description: bitbank の市場データと取引機能を生成AIから扱う — MCPサーバーと CLI のドキュメント
---

※bitbank 非公式です

# はじめに

このドキュメントは、bitbank（暗号資産取引所）の市場データと取引機能を生成AIから扱うための **2つの姉妹プロジェクト** を扱います。どちらも bitbank の公開 API を基盤としていますが、アプローチが真逆です。

* **MCP サーバー（bitbank-lab-mcp）** — Claude Desktop / Cursor / Codex / Gemini CLI などの AIクライアントから使う MCPサーバー。指標計算・可視化まで **サーバー側で済ませた結論** を返します。
* **CLI（bitbank-cli-skills）** — コマンドライン（CLI）と自然言語操作（Agent Skills）の2層構成。**生の市場データを高速に渡し、計算は LLM 自身に任せます**。

[![npm](https://img.shields.io/npm/v/bitbank-lab-mcp.svg)](https://www.npmjs.com/package/bitbank-lab-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/tjackiet/bitbank-genesis-mcp-server/blob/main/LICENSE)

{% hint style="info" %}
両プロジェクトとも bitbank の**公開 API** を基盤としています。API 自体の仕様（エンドポイント・パラメータ・レート制限など）は [bitbank API ドキュメント](https://github.com/bitbankinc/bitbank-api-docs) を参照してください。
{% endhint %}

## どちらが自分に向いている？

同じ bitbank API に対して、2つは **真逆のアプローチ** をとります。

|  | MCP サーバー | CLI |
| --- | --- | --- |
| 計算する場所 | **サーバー側で計算済みの結論**を LLM に渡す | **生データを高速取得**し、LLM 自身に計算させる |
| 向いている人 | すぐに使えるテクニカル分析・可視化が欲しい | 指標のパラメータやロジックを完全にカスタマイズしたい |
| ハルシネーション | 計算をサーバーが担うため起きにくい | LLM の計算精度に依存する |
| 主な使い方 | AIクライアントに自然文で質問 | コマンド／スキルを組み合わせて操作 |

{% hint style="success" %}
迷ったら **MCP サーバー** から始めるのがおすすめです。インストール不要で、設定ファイルに数行追記するだけで動きます。
{% endhint %}

## このドキュメントの読み方

{% hint style="info" %}
**対象読者**: bitbank で取引した経験はあるが、AI 連携（MCP / CLI）は初めて、というレベルの方を想定しています。コマンドラインや AI エージェントの専門知識は前提にしていません。
{% endhint %}

**MCP サーバーを使う**

* [クイックスタート（5分）](getting-started/quickstart.md) — Claude Desktop で動かす最短手順
* [MCP サーバーでできること](guides/tools.md) — 取得・分析・可視化の全体像（ツール名を意識せず使えます）
* [セットアップ詳細](getting-started/setup.md) — クライアント別の設定

**CLI を使う**

* [クイックスタート](cli/getting-started/quickstart.md) — インストールから最初のコマンドまで
* [コマンド一覧](cli/guides/commands.md) ／ [Agent Skills](cli/guides/skills.md) — 操作の引き出し
* [取引と安全ガード](cli/guides/trading.md) — 仮想資金から本番までの安全設計

## 注意事項

{% hint style="warning" %}
本ドキュメントが扱うツールが提供するデータをAIエージェントが処理した結果は、必ずしも正確性・完全性を保証するものではありません。提供される情報は情報提供のみを目的としており、投資助言・代理業に該当するものではありません。投資判断はご自身の責任で行ってください。
{% endhint %}
