import { describe, it, expect } from 'vitest';
import { ok, fail, failFromError, failFromValidation } from './result.js';

describe('ok', () => {
  it('ok: true の結果を生成する', () => {
    const result = ok('テスト成功');
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('テスト成功');
    expect(result.data).toEqual({});
    expect(result.meta).toEqual({});
  });
  it('data と meta を含める', () => {
    const result = ok('成功', { price: 100 }, { pair: 'btc_jpy' });
    expect(result.data).toEqual({ price: 100 });
    expect(result.meta).toEqual({ pair: 'btc_jpy' });
  });
});

describe('fail', () => {
  it('ok: false の結果を生成する', () => {
    const result = fail('エラー発生');
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Error: エラー発生');
    expect(result.meta).toHaveProperty('errorType', 'user');
  });
  it('カスタムエラータイプを指定できる', () => {
    const result = fail('ネットワークエラー', 'network');
    expect(result.meta).toHaveProperty('errorType', 'network');
  });
});

describe('failFromError', () => {
  it('通常のエラーから fail を生成する', () => {
    const result = failFromError(new Error('something broke'));
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('something broke');
    expect(result.meta).toHaveProperty('errorType', 'internal');
  });
  it('AbortError をタイムアウトとして処理する', () => {
    const err = new DOMException('aborted', 'AbortError');
    const result = failFromError(err, { timeoutMs: 5000 });
    expect(result.summary).toContain('タイムアウト');
    expect(result.summary).toContain('5000');
    expect(result.meta).toHaveProperty('errorType', 'timeout');
  });
  it('timeoutMs 未指定時は AbortError を通常エラーとして処理する', () => {
    const err = new DOMException('aborted', 'AbortError');
    const result = failFromError(err);
    expect(result.meta).toHaveProperty('errorType', 'internal');
  });
  it('schema 指定時は parse でラップする', () => {
    const mockSchema = { parse: (v: unknown) => v };
    const result = failFromError(new Error('test'), { schema: mockSchema });
    expect(result.ok).toBe(false);
  });
  it('defaultType を上書きできる', () => {
    const result = failFromError(new Error('test'), { defaultType: 'network' });
    expect(result.meta).toHaveProperty('errorType', 'network');
  });
});

describe('failFromValidation', () => {
  it('バリデーション失敗から fail を生成する', () => {
    const result = failFromValidation({
      error: { message: 'pair が不正です', type: 'user' },
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('pair が不正です');
    expect(result.meta).toHaveProperty('errorType', 'user');
  });
  it('schema 指定時は parse でラップする', () => {
    const mockSchema = { parse: (v: unknown) => v };
    const result = failFromValidation(
      { error: { message: 'test', type: 'user' } },
      mockSchema,
    );
    expect(result.ok).toBe(false);
  });
});
