/**
 * Chaos T-06: HTTP セッション ID の偽装・リプレイ
 * 仮説: 不正セッションが拒否される
 *
 * セッション ID は randomUUID() で生成される。
 * ここではセッション ID の品質と一意性を検証する。
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('Chaos: T-06 — HTTP セッション ID の品質検証', () => {
	/** 仮説: randomUUID() が一意で予測不能なセッション ID を生成する */

	it('生成される UUID は v4 形式', () => {
		const uuid = randomUUID();
		// UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx (y は 8, 9, a, b)
		expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});

	it('1000個の UUID が全て一意', () => {
		const uuids = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			uuids.add(randomUUID());
		}
		expect(uuids.size).toBe(1000);
	});

	it('連続生成した UUID は予測不能（隣接する値が似ていない）', () => {
		const uuid1 = randomUUID();
		const uuid2 = randomUUID();

		// 最初の 8 文字が同一でないこと（統計的にほぼ確実）
		expect(uuid1.slice(0, 8)).not.toBe(uuid2.slice(0, 8));
	});

	it('空文字列は有効な UUID ではない', () => {
		expect('').not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});

	it('インクリメンタルな ID は UUID 形式ではない', () => {
		const fakeIds = ['session-1', 'session-2', '00000000-0000-0000-0000-000000000001'];
		for (const id of fakeIds) {
			// v4 の version nibble (4) がないので不一致
			expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		}
	});
});
