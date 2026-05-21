/**
 * preview 系ツール（preview_order / preview_cancel_order / preview_cancel_orders）の
 * elicitation/create フローを共通化するヘルパー。
 *
 * 各 preview ツールは以下のパターンを同じ手順で実装していた:
 *   1. クライアントが elicitation/create に対応しているかを判定
 *   2. 対応していれば elicitInput でユーザー確認を取り、accept なら execute を実行
 *   3. 非対応 / decline / cancel / elicit 例外時はフォールバック表示
 *
 * 取引系 HITL（Human-in-the-Loop）の中核であり、3 箇所に散らばっていると
 * 仕様ドリフトで事故になるため、本モジュールに集約する。
 *
 * 取引系に強く紐づくため汎用 `lib/` ではなく `src/private/` 配下に置く。
 */

import { toStructured } from '../../lib/result.js';
import type { Result } from '../schema/types.js';
import type { McpResponse, ToolHandlerExtra } from '../tool-definition.js';

/** SDK の elicitInput を呼び出すための最小限の interface */
export interface ElicitCapableServer {
	elicitInput: (params: {
		message: string;
		requestedSchema: Record<string, unknown>;
	}) => Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }>;
}

/**
 * クライアントが elicitation/create に対応しているかを判定する。
 * 非対応ホストでは従来挙動（structuredContent でトークンを返す）にフォールバックする。
 */
export function clientSupportsElicitation(extra: ToolHandlerExtra | undefined): boolean {
	const server = (extra as { server?: { getClientCapabilities?: () => unknown } } | undefined)?.server;
	const caps = typeof server?.getClientCapabilities === 'function' ? server.getClientCapabilities() : undefined;
	const elicitation = (caps as { elicitation?: unknown } | undefined)?.elicitation;
	return Boolean(elicitation);
}

export interface WithElicitedConfirmationOptions {
	/** ハンドラに渡される MCP リクエストコンテキスト */
	extra: ToolHandlerExtra | undefined;
	/** elicitation の message に渡す preview 結果サマリ */
	summary: string;
	/** elicitation スキーマの confirmed フィールドに付ける title（例: 'この注文を発注する'） */
	confirmTitle: string;
	/**
	 * accept + confirmed=true のとき呼ぶ execute 本体。
	 * `Result`（create_order / cancel_order / cancel_orders の戻り値）を返す。
	 * **例外が出た場合は捕捉せずそのまま伝播させる**（呼び出し側で扱う）。
	 */
	onConfirmed: () => Promise<Result>;
	/** decline / cancel / confirmed=false のときに content[0].text として返す案内文 */
	onDeclinedText: string;
	/**
	 * decline / cancel / confirmed=false のときに structuredContent として返すオブジェクト。
	 * preview の Result を toStructured() で変換したものを渡す想定。
	 */
	declinedStructured: Record<string, unknown>;
	/**
	 * フォールバック先 McpResponse。以下のケースで返る:
	 *   - クライアントが elicitation 非対応
	 *   - server.elicitInput が無い
	 *   - elicitInput が例外を投げた
	 */
	fallback: McpResponse;
}

/**
 * preview 結果に対するユーザー確認（elicitation）フローを実行する高レベルラッパー。
 *
 * 責務:
 *   1. capability 判定
 *   2. elicitInput 呼び出し
 *   3. ユーザー応答（accept / decline / cancel / confirmed=false）による分岐返却
 *
 * 実 API 呼び出し（create_order / cancel_order / cancel_orders）は呼び出し側が
 * `onConfirmed` 内で行う。bitbank のキャンセル系は単数/複数で execute シグネチャが
 * 異なるため、ラッパーはシグネチャを縛らずクロージャに委ねる。
 *
 * 挙動の統一:
 *   - decline / cancel / accept-without-confirmed はすべて「ユーザー拒否」として
 *     同一処理にする（既存 3 ツールはこの分岐ロジック自体は同じだった）。
 *   - `onConfirmed` の例外は捕捉せず呼び出し側に伝播させる
 *     （elicitInput 自体の例外のみフォールバックさせる）。
 */
export async function withElicitedConfirmation(opts: WithElicitedConfirmationOptions): Promise<McpResponse> {
	if (!clientSupportsElicitation(opts.extra)) {
		return opts.fallback;
	}

	const server = (opts.extra as { server?: ElicitCapableServer } | undefined)?.server;
	if (!server || typeof server.elicitInput !== 'function') {
		return opts.fallback;
	}

	let elicit: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> };
	try {
		elicit = await server.elicitInput({
			message: opts.summary,
			requestedSchema: {
				type: 'object',
				properties: {
					confirmed: { type: 'boolean', title: opts.confirmTitle },
				},
				required: ['confirmed'],
			},
		});
	} catch {
		// elicitInput が想定外に失敗した場合はフォールバックに進む。
		return opts.fallback;
	}

	if (elicit.action !== 'accept' || !elicit.content?.confirmed) {
		return {
			content: [{ type: 'text', text: opts.onDeclinedText }],
			structuredContent: opts.declinedStructured,
		};
	}

	const execResult = await opts.onConfirmed();
	const text = execResult.ok ? execResult.summary : `Error: ${execResult.summary}`;
	return {
		content: [{ type: 'text', text }],
		structuredContent: toStructured(execResult),
	};
}
