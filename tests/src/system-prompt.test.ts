import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from '../../src/system-prompt.js';

describe('SYSTEM_PROMPT', () => {
	it('文字列として export されている', () => {
		expect(typeof SYSTEM_PROMPT).toBe('string');
		expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
	});

	it('先頭・末尾に余分な空白がない（trim済み）', () => {
		expect(SYSTEM_PROMPT).toBe(SYSTEM_PROMPT.trim());
	});

	describe('データ整合性ポリシー', () => {
		it('事実はツールが返したデータのみ', () => {
			expect(SYSTEM_PROMPT).toContain('事実はツールが返したデータのみ');
		});

		it('捏造・補間の禁止', () => {
			expect(SYSTEM_PROMPT).toContain('捏造・補間の禁止');
		});

		it('不足の明示', () => {
			expect(SYSTEM_PROMPT).toContain('不足の明示');
		});

		it('数値の正確な引用', () => {
			expect(SYSTEM_PROMPT).toContain('数値の正確な引用');
		});
	});

	describe('初心者向けPrompts', () => {
		it('beginner_market_check が含まれる', () => {
			expect(SYSTEM_PROMPT).toContain('beginner_market_check');
		});

		it('beginner_chart_view が含まれる', () => {
			expect(SYSTEM_PROMPT).toContain('beginner_chart_view');
		});

		it('explain_term が含まれる', () => {
			expect(SYSTEM_PROMPT).toContain('explain_term');
		});

		it('getting_started が含まれる', () => {
			expect(SYSTEM_PROMPT).toContain('getting_started');
		});
	});

	describe('中級者向けPrompts', () => {
		it('チャート系 Prompts が含まれる', () => {
			expect(SYSTEM_PROMPT).toContain('bb_default_chart');
			expect(SYSTEM_PROMPT).toContain('ichimoku_default_chart');
			expect(SYSTEM_PROMPT).toContain('candles_only_chart');
		});

		it('分析系 Prompts が含まれる', () => {
			expect(SYSTEM_PROMPT).toContain('depth_analysis');
			expect(SYSTEM_PROMPT).toContain('flow_analysis');
			expect(SYSTEM_PROMPT).toContain('multi_factor_signal');
		});
	});

	describe('取引実行ガイドライン', () => {
		it('create_order / cancel_order / cancel_orders が含まれる', () => {
			expect(SYSTEM_PROMPT).toContain('create_order');
			expect(SYSTEM_PROMPT).toContain('cancel_order');
			expect(SYSTEM_PROMPT).toContain('cancel_orders');
		});

		it('確認なしでの発注は禁止', () => {
			expect(SYSTEM_PROMPT).toContain('確認なしでの発注は禁止');
		});

		it('注文タイプの自動判定ルールが含まれる', () => {
			expect(SYSTEM_PROMPT).toContain('limit');
			expect(SYSTEM_PROMPT).toContain('stop');
			expect(SYSTEM_PROMPT).toContain('stop_limit');
		});

		it('エラーコード（残高不足等）の対応が含まれる', () => {
			expect(SYSTEM_PROMPT).toContain('60001');
		});
	});

	describe('ユーザーレベル判定', () => {
		it('初心者・中級者・上級者の兆候が記載されている', () => {
			expect(SYSTEM_PROMPT).toContain('初心者の兆候');
			expect(SYSTEM_PROMPT).toContain('中級者の兆候');
			expect(SYSTEM_PROMPT).toContain('上級者の兆候');
		});
	});
});
