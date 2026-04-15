/**
 * API レスポンスの文字列→数値変換ユーティリティ
 *
 * bitbank API は価格・数量等を文字列で返す。
 * 各ツールで散在していた `d.x != null ? Number(d.x) : null` を統一する。
 */

/**
 * unknown 値を有限な number に変換する。
 * null / undefined / NaN / Infinity は null を返す。
 *
 * @example
 * toNum("12345.67")  // 12345.67
 * toNum(null)        // null
 * toNum(undefined)   // null
 * toNum("")          // null (Number("") === 0 だが意図しない変換を防ぐ)
 * toNum("abc")       // null
 * toNum(Infinity)    // null
 */
export function toNum(v: unknown): number | null {
	if (v == null) return null;
	if (v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}
