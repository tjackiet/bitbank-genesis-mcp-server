/**
 * 日時変換ユーティリティ
 * 各ツールで重複していた関数を統一
 * dayjs ベースで実装
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// プラグイン有効化
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * タイムスタンプをISO8601形式に変換
 * @param ts タイムスタンプ（ミリ秒または秒、unknown型対応）
 * @returns ISO8601文字列、無効な場合はnull
 */
export function toIsoTime(ts: unknown): string | null {
	const d = dayjs(Number(ts));
	return d.isValid() ? d.toISOString() : null;
}

/**
 * ミリ秒タイムスタンプをISO8601形式に変換（null安全版）
 * @param ms ミリ秒タイムスタンプ
 * @returns ISO8601文字列、無効な場合はnull
 */
export function toIsoMs(ms: number | null): string | null {
	if (ms == null) return null;
	const d = dayjs(ms);
	return d.isValid() ? d.toISOString() : null;
}

/**
 * タイムスタンプをタイムゾーン付きISO風形式に変換
 * @param ts ミリ秒タイムスタンプ
 * @param tz タイムゾーン（例: 'Asia/Tokyo', 'UTC'）
 * @returns "2025-01-15T14:30:00" 形式、エラー時はnull
 */
export function toIsoWithTz(ts: number, tz: string): string | null {
	try {
		const d = dayjs(ts).tz(tz);
		return d.isValid() ? d.format('YYYY-MM-DDTHH:mm:ss') : null;
	} catch {
		return null;
	}
}

/**
 * タイムスタンプを日本語表示形式に変換
 * @param ts ミリ秒タイムスタンプ（未指定時は現在時刻）
 * @param tz タイムゾーン（デフォルト: 'Asia/Tokyo'）
 * @returns "2025/01/15 14:30:00 JST" 形式
 */
export function toDisplayTime(ts: number | undefined, tz: string = 'Asia/Tokyo'): string | null {
	try {
		const d = dayjs(ts ?? Date.now()).tz(tz);
		if (!d.isValid()) return null;
		const tzShort = tz === 'UTC' ? 'UTC' : 'JST';
		return `${d.format('YYYY/MM/DD HH:mm:ss')} ${tzShort}`;
	} catch {
		return null;
	}
}

/**
 * 現在時刻をISO8601形式で取得
 * @returns ISO8601文字列
 */
export function nowIso(): string {
	return dayjs().toISOString();
}

/**
 * 現在時刻を指定タイムゾーンで取得
 * @param tz タイムゾーン（デフォルト: 'Asia/Tokyo'）
 * @returns dayjs インスタンス
 */
export function nowTz(tz: string = 'Asia/Tokyo') {
	return dayjs().tz(tz);
}

/**
 * N日前の日付を取得
 * @param daysAgo 何日前か
 * @param format 出力フォーマット（デフォルト: 'YYYYMMDD'）
 * @returns フォーマットされた日付文字列
 */
export function daysAgo(daysAgo: number, format: string = 'YYYYMMDD'): string {
	return dayjs().subtract(daysAgo, 'day').format(format);
}

/**
 * 今日の日付を取得
 * @param format 出力フォーマット（デフォルト: 'YYYYMMDD'）
 * @returns フォーマットされた日付文字列
 */
export function today(format: string = 'YYYYMMDD'): string {
	return dayjs().format(format);
}

// dayjs インスタンスを直接使いたい場合のエクスポート
export { dayjs };
