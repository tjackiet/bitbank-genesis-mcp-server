import { toDisplayTime } from './datetime.js';

export function formatPair(pair: string): string {
	return (pair || '').toUpperCase().replace('_', '/');
}

/**
 * タイムスタンプをJST表示形式に変換
 * @param ts タイムスタンプ（ミリ秒）。未指定時は現在時刻
 * @param tz タイムゾーン（デフォルト: 'Asia/Tokyo'）
 * @returns "2025/11/24 15:32:45 JST" 形式
 */
export function formatTimestampJST(ts?: number, tz: string = 'Asia/Tokyo'): string {
	const result = toDisplayTime(ts, tz);
	return result ?? new Date(ts ?? Date.now()).toISOString();
}

/**
 * 価格フォーマット（¥プレフィックス、ペア依存）
 * JPY ペア → ¥123,456  /  non-JPY → 0.123456
 * pair 省略時は JPY として扱う
 */
export function formatPrice(value: number | null | undefined, pair?: string): string {
	if (value == null || !Number.isFinite(Number(value))) return 'N/A';
	const n = Number(value);
	const jpy = !pair || (typeof pair === 'string' && pair.toLowerCase().includes('jpy'));
	if (jpy) return `¥${n.toLocaleString('ja-JP')}`;
	return n.toLocaleString('ja-JP');
}

/**
 * 価格フォーマット（円サフィックス、四捨五入）
 * → 123,456円
 */
export function formatPriceJPY(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(Number(value))) return 'n/a';
	return `${Math.round(Number(value)).toLocaleString()}円`;
}

/**
 * 通貨フォーマット（JPY/非JPY対応、スペース＋通貨コード）
 * JPY → 123,456 JPY  /  非JPY → 0.12
 */
export function formatCurrency(value: number | null | undefined, pair?: string): string {
	if (value == null) return 'n/a';
	const jpy = !pair || (typeof pair === 'string' && pair.toLowerCase().includes('jpy'));
	return jpy ? `${Number(value).toLocaleString()} JPY` : `${Number(value).toFixed(2)}`;
}

/**
 * 通貨フォーマット短縮形（大きな値はk表示）
 * JPY ≥1000 → 12k JPY  /  JPY <1000 → 123 JPY  /  非JPY → 0.12
 */
export function formatCurrencyShort(value: number | null | undefined, pair?: string): string {
	if (value == null) return 'n/a';
	const jpy = !pair || (typeof pair === 'string' && pair.toLowerCase().includes('jpy'));
	if (jpy) {
		const n = Number(value);
		return n >= 1000 ? `${Math.round(n / 1000)}k JPY` : `${n.toLocaleString()} JPY`;
	}
	return `${Number(value).toFixed(2)}`;
}

/**
 * パーセンテージフォーマット
 * @param value 数値
 * @param opts.digits 小数桁数（デフォルト: 1）
 * @param opts.sign 正数に+を付けるか（デフォルト: false）
 * @param opts.multiply 100倍するか（デフォルト: false）。0-1小数→%変換に使う
 */
export function formatPercent(
	value: number | null | undefined,
	opts: { digits?: number; sign?: boolean; multiply?: boolean } = {},
): string {
	if (value == null || !Number.isFinite(Number(value))) return 'n/a';
	const { digits = 1, sign = false, multiply = false } = opts;
	const v = multiply ? Number(value) * 100 : Number(value);
	const prefix = sign && v >= 0 ? '+' : '';
	return `${prefix}${v.toFixed(digits)}%`;
}

/**
 * 出来高フォーマット（日本円単位、億円/万円）
 */
export function formatVolumeJPY(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return 'n/a';
	if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}億円`;
	return `${Math.round(value / 10_000)}万円`;
}

export function formatSummary(args: {
	pair?: string;
	timeframe?: string;
	latest?: number;
	totalItems?: number;
	keyPoints?: any;
	volumeStats?: any;
	extra?: string;
	// 追加: 全件の範囲情報
	priceRange?: { high: number; low: number; periodStart: string; periodEnd: string };
} = {}): string {
	const { pair, timeframe, latest, totalItems, keyPoints, volumeStats, extra, priceRange } = args;
	const p = formatPair(pair ?? '');
	const tf = timeframe ? ` [${timeframe}]` : '';
	const isJpy = typeof pair === 'string' && pair.toLowerCase().includes('jpy');
	const currency = isJpy ? '円' : '';

	// 基本情報
	let summary = p;

	// ローソク足取得の場合（totalItemsが明示的に指定されている場合）
	if (typeof totalItems === 'number' && totalItems > 0) {
		summary += `${tf} ローソク足${totalItems}本取得`;
		summary += `\n⚠️ 配列は古い順: data[0]=最古、data[${totalItems - 1}]=最新`;
		
		// 全件の範囲情報を追加
		if (priceRange) {
			summary += `\n\n📈 全${totalItems}件の価格範囲:`;
			summary += `\n- 期間: ${priceRange.periodStart} 〜 ${priceRange.periodEnd}`;
			summary += `\n- 高値: ${formatPrice(priceRange.high)}`;
			summary += `\n- 安値: ${formatPrice(priceRange.low)}`;
		}
	}

	// 期間別の価格推移
	if (keyPoints && keyPoints.today) {
		summary += '\n\n📊 期間別の価格推移:';

		const fmtChange = (pct: number | null) => {
			if (pct === null) return '';
			return ` → 変化率 ${formatPercent(pct, { sign: true })}`;
		};

		// 今日
		const today = keyPoints.today;
		summary += `\n- 今日 (${today.date || '不明'}, data[${today.index}]): ${formatPrice(today.close)}`;

		// 7日前
		if (keyPoints.sevenDaysAgo) {
			const sd = keyPoints.sevenDaysAgo;
			summary += `\n- 7日前 (${sd.date || '不明'}, data[${sd.index}]): ${formatPrice(sd.close)}${fmtChange(sd.changePct)}`;
		}

		// 30日前
		if (keyPoints.thirtyDaysAgo) {
			const td = keyPoints.thirtyDaysAgo;
			summary += `\n- 30日前 (${td.date || '不明'}, data[${td.index}]): ${formatPrice(td.close)}${fmtChange(td.changePct)}`;
		}

		// 90日前
		if (keyPoints.ninetyDaysAgo) {
			const nd = keyPoints.ninetyDaysAgo;
			summary += `\n- 90日前 (${nd.date || '不明'}, data[${nd.index}]): ${formatPrice(nd.close)}${fmtChange(nd.changePct)}`;
		}

		// 出来高情報
		if (volumeStats) {
			summary += '\n\n【出来高推移】';
			summary += `\n- 直近7日間の平均: ${volumeStats.recent7DaysAvg.toFixed(0)} BTC/日`;
			summary += `\n- その前7日間の平均: ${volumeStats.previous7DaysAvg.toFixed(0)} BTC/日`;
			if (typeof volumeStats.last30DaysAvg === 'number') {
				summary += `\n- 過去30日間の平均: ${volumeStats.last30DaysAvg.toFixed(0)} BTC/日`;
			}
			summary += `\n- 出来高変化率: ${volumeStats.changePct >= 0 ? '+' : ''}${volumeStats.changePct}%`;
			summary += `\n- 判定: ${volumeStats.judgment}`;
		}

		summary += '\n\n※ 全データは structuredContent.data に含まれます';
	} else if (typeof latest === 'number') {
		// keyPointsがない場合（板情報など）は中値を表示
		summary += ` 中値=${latest.toLocaleString('ja-JP')}${currency}`;
	}

	const tail = extra ? ` ${extra}` : '';
	return `${summary}${tail}`.trim();
}


