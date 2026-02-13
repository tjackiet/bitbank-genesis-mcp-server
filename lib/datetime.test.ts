import { describe, it, expect } from 'vitest';
import { toIsoTime, toIsoMs, toIsoWithTz, toDisplayTime, nowIso, daysAgo, today, dayjs } from './datetime.js';

describe('toIsoTime', () => {
  it('ミリ秒タイムスタンプを ISO8601 に変換する', () => {
    const result = toIsoTime(1700000000000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('秒タイムスタンプも変換する', () => {
    const result = toIsoTime(1700000000);
    expect(result).not.toBeNull();
  });
  it('無効な値は null を返す', () => {
    expect(toIsoTime('invalid')).toBeNull();
    expect(toIsoTime(NaN)).toBeNull();
  });
});

describe('toIsoMs', () => {
  it('ミリ秒タイムスタンプを ISO8601 に変換する', () => {
    const result = toIsoMs(1700000000000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('null は null を返す', () => {
    expect(toIsoMs(null)).toBeNull();
  });
});

describe('toIsoWithTz', () => {
  it('タイムゾーン付き ISO 形式を返す', () => {
    const result = toIsoWithTz(1700000000000, 'Asia/Tokyo');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
  it('UTC タイムゾーンで動作する', () => {
    const result = toIsoWithTz(1700000000000, 'UTC');
    expect(result).not.toBeNull();
  });
});

describe('toDisplayTime', () => {
  it('JST 表示形式を返す', () => {
    const result = toDisplayTime(1700000000000);
    expect(result).toMatch(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} JST/);
  });
  it('UTC 指定で UTC と表示する', () => {
    const result = toDisplayTime(1700000000000, 'UTC');
    expect(result).toContain('UTC');
  });
  it('undefined は現在時刻を返す', () => {
    const result = toDisplayTime(undefined);
    expect(result).toContain('JST');
  });
});

describe('nowIso', () => {
  it('ISO8601 形式の文字列を返す', () => {
    const result = nowIso();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('daysAgo', () => {
  it('デフォルトは YYYYMMDD 形式', () => {
    const result = daysAgo(7);
    expect(result).toMatch(/^\d{8}$/);
  });
  it('カスタムフォーマットを指定できる', () => {
    const result = daysAgo(7, 'YYYY-MM-DD');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('0日前は今日と一致する', () => {
    expect(daysAgo(0)).toBe(today());
  });
});

describe('today', () => {
  it('デフォルトは YYYYMMDD 形式', () => {
    const result = today();
    expect(result).toMatch(/^\d{8}$/);
  });
  it('dayjs と一致する', () => {
    expect(today('YYYY-MM-DD')).toBe(dayjs().format('YYYY-MM-DD'));
  });
});
