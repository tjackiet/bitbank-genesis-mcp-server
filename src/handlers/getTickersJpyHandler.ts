import getTickersJpy from '../../tools/get_tickers_jpy.js';
import type { ToolDefinition } from '../tool-definition.js';
import { z } from 'zod';
import { formatPercent, formatPrice, formatVolumeJPY } from '../../lib/formatter.js';

export const toolDef: ToolDefinition = {
	name: 'get_tickers_jpy',
	description: '全JPYペアのティッカーを取得（/tickers_jpy）。view=ranked でランキング表示、view=items で全データ。キャッシュ10秒。',
	inputSchema: z.object({
		view: z.enum(['items', 'ranked']).optional().default('ranked'),
		sortBy: z.enum(['change24h', 'volume', 'name']).optional().default('change24h'),
		order: z.enum(['asc', 'desc']).optional().default('desc'),
		limit: z.number().int().min(1).max(50).optional().default(5),
	}) as any,
	handler: async (args: any) => {
		const view = (args?.view ?? 'ranked') as 'items' | 'ranked';
		const sortBy = (args?.sortBy ?? 'change24h') as 'change24h' | 'volume' | 'name';
		const order = (args?.order ?? 'desc') as 'asc' | 'desc';
		const limit = Number(args?.limit ?? 5);
		const res: any = await getTickersJpy();
		if (!res?.ok) return res;
		const items: any[] = Array.isArray(res?.data) ? res.data : [];

		// フォーマット関数
		const formatVolume = formatVolumeJPY;
		const fmtPrice = formatPrice;

		// normalize numeric fields（open/high/low 追加）
		const norm = items.map((it: any) => {
			const lastN = it?.last != null ? Number(it.last) : null;
			const openN = it?.open != null ? Number(it.open) : null;
			const highN = it?.high != null ? Number(it.high) : null;
			const lowN = it?.low != null ? Number(it.low) : null;
			const buyN = it?.buy != null ? Number(it.buy) : null;
			const sellN = it?.sell != null ? Number(it.sell) : null;
			const change = (it?.change24h ?? it?.change24hPct);
			const changeN = change != null ? Number(change) : (openN != null && openN > 0 && lastN != null ? Number((((lastN - openN) / openN) * 100).toFixed(2)) : null);
			const volN = it?.vol != null ? Number(it.vol) : null;
			const volumeInJPY = (volN != null && lastN != null && Number.isFinite(volN) && Number.isFinite(lastN))
				? volN * lastN
				: null;
			return { ...it, lastN, openN, highN, lowN, buyN, sellN, changeN, volN, volumeInJPY };
		});

		// ranking logic
		const cmpNum = (a?: number | null, b?: number | null) => {
			const aa = (a == null || Number.isNaN(a)) ? -Infinity : a;
			const bb = (b == null || Number.isNaN(b)) ? -Infinity : b;
			return aa - bb;
		};
		const sorted = [...norm].sort((a, b) => {
			if (sortBy === 'name') {
				return String(a.pair).localeCompare(String(b.pair));
			}
			if (sortBy === 'volume') {
				return cmpNum(a.volumeInJPY, b.volumeInJPY);
			}
			return cmpNum(a.changeN, b.changeN);
		});
		if ((order || 'desc') === 'desc') sorted.reverse();
		const ranked = sorted.slice(0, Number(limit || 5));

		if (view === 'ranked') {
			const lines = ranked.map((r, i) => {
				const chg = formatPercent(r.changeN, { sign: true, digits: 2 });
				const px = fmtPrice(r.lastN);
				const volTxt = formatVolume(r.volumeInJPY);
				return `${i + 1}. ${String(r.pair).toUpperCase().replace('_', '/')} ${chg}（${px}、出来高${volTxt}）`;
			});
			const text = [
				`全${items.length}ペア取得（sortBy=${sortBy}, ${order}, top${limit}）`,
				'',
				lines.join('\n'),
			].join('\n');
			return {
				content: [{ type: 'text', text }],
				structuredContent: {
					ok: true,
					summary: `ranked ${ranked.length}/${items.length}`,
					data: { items: norm, ranked },
					meta: res?.meta ?? {},
				} as Record<string, unknown>,
			};
		}

		// view=items: 全データ一覧（上位5件をサマリ表示）
		const top5 = norm.slice(0, 5);
		const lines: string[] = [];
		lines.push(`全${norm.length}ペア取得`);
		lines.push('');
		for (const it of top5) {
			const pairDisplay = String(it.pair).toUpperCase().replace('_', '/');
			const priceStr = fmtPrice(it.lastN);
			const changeStr = formatPercent(it.changeN, { sign: true, digits: 2 });
			const volStr = formatVolume(it.volumeInJPY);
			lines.push(`${pairDisplay}: ${priceStr} (${changeStr}) 出来高${volStr}`);
		}
		if (norm.length > 5) {
			lines.push(`... 他${norm.length - 5}ペア`);
		}
		const text = lines.join('\n');
		return {
			content: [{ type: 'text', text }],
			structuredContent: { ...res, data: { items: norm } } as Record<string, unknown>,
		};
	},
};
