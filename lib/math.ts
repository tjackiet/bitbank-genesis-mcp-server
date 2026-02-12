/**
 * 数値演算ユーティリティ
 * 各ツールで重複していた関数を統一
 */

/**
 * 配列の平均値を計算
 * @param arr 数値配列
 * @returns 平均値、空配列の場合はnull
 */
export function avg(arr: number[]): number | null {
	return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}

/**
 * 配列の中央値を計算
 * @param arr 数値配列
 * @returns 中央値、空配列の場合はnull
 */
export function median(arr: number[]): number | null {
	if (!arr.length) return null;
	const sorted = [...arr].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 配列の標準偏差を計算
 * @param values 数値配列
 * @returns 標準偏差、空配列の場合は0
 */
export function stddev(values: number[]): number {
	const n = values.length;
	if (n === 0) return 0;
	const mean = values.reduce((s, v) => s + v, 0) / n;
	const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
	return Math.sqrt(Math.max(0, variance));
}

/**
 * スライディングウィンドウ平均（SMA）
 * @param values 数値配列
 * @param window ウィンドウサイズ（>= 1）
 * @returns 各ウィンドウの平均値配列（長さ = values.length - window + 1）
 */
export function slidingMean(values: number[], window: number): number[] {
	const out: number[] = [];
	if (!Number.isFinite(window) || window <= 0) return out;
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i];
		if (i >= window) sum -= values[i - window];
		if (i >= window - 1) out.push(sum / window);
	}
	return out;
}

/**
 * スライディングウィンドウ標準偏差
 * @param values 数値配列
 * @param window ウィンドウサイズ（>= 2）
 * @returns 各ウィンドウの標準偏差配列（長さ = values.length - window + 1）
 */
export function slidingStddev(values: number[], window: number): number[] {
	const out: number[] = [];
	if (window <= 1) return out;
	let sum = 0;
	let sumsq = 0;
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		sum += v; sumsq += v * v;
		if (i >= window) {
			const old = values[i - window];
			sum -= old; sumsq -= old * old;
		}
		if (i >= window - 1) {
			const n = window;
			const mean = sum / n;
			const variance = Math.max(0, sumsq / n - mean * mean);
			out.push(Math.sqrt(variance));
		}
	}
	return out;
}
