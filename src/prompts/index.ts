import { isPrivateApiEnabled } from '../private/config.js';
import { beginnerPrompts } from './beginner.js';
import { intermediatePrompts } from './intermediate.js';
import { reportPrompts } from './reports.js';
import type { PromptDef } from './types.js';

export { PromptCategory, type PromptDef, PromptLevel, type PromptMetadata } from './types.js';

const promptsAll: PromptDef[] = [...reportPrompts, ...beginnerPrompts, ...intermediatePrompts];

const desiredOrder = [
	'🌅 おはようレポート',
	'💼 ポートフォリオ分析レポート',
	'🔰 BTCの価格を分析して',
	'🔰 ETHの価格を分析して',
	'🔰 今注目のコインは？',
	'中級：主要指標でBTCを分析して',
	'中級：BTCのフロー分析をして',
	'中級：BTCのパターン分析をして',
	'中級：BTCのサポレジを分析して',
];

const orderIndex = (name: string) => {
	const i = desiredOrder.indexOf(name);
	return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
};

const privateApiEnabled = isPrivateApiEnabled();

export const prompts: PromptDef[] = promptsAll
	.filter((p) => /[^\x20-\x7E]/.test(p.name))
	.filter((p) => !p.requiresPrivateApi || privateApiEnabled)
	.sort((a, b) => orderIndex(a.name) - orderIndex(b.name));
