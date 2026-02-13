import { describe, it, expect } from 'vitest';
import { getErrorMessage, isAbortError } from './error.js';

describe('getErrorMessage', () => {
  it('Error インスタンスから message を取得する', () => {
    expect(getErrorMessage(new Error('test error'))).toBe('test error');
  });
  it('文字列はそのまま返す', () => {
    expect(getErrorMessage('string error')).toBe('string error');
  });
  it('数値は String() で変換する', () => {
    expect(getErrorMessage(42)).toBe('42');
  });
  it('null は "null" を返す', () => {
    expect(getErrorMessage(null)).toBe('null');
  });
  it('undefined は "undefined" を返す', () => {
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

describe('isAbortError', () => {
  it('AbortError を検出する', () => {
    const err = new DOMException('The operation was aborted', 'AbortError');
    expect(isAbortError(err)).toBe(true);
  });
  it('通常の Error は false を返す', () => {
    expect(isAbortError(new Error('test'))).toBe(false);
  });
  it('非 Error 型は false を返す', () => {
    expect(isAbortError('string')).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
