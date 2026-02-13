import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from './cache.js';

describe('TtlCache', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('get returns undefined for missing key', () => {
    const c = new TtlCache<number>({ ttlMs: 1000 });
    expect(c.get('x')).toBeUndefined();
  });

  it('set + get round-trip', () => {
    const c = new TtlCache<string>({ ttlMs: 5000 });
    c.set('a', 'hello');
    expect(c.get('a')).toBe('hello');
  });

  it('expires after TTL', () => {
    const c = new TtlCache<number>({ ttlMs: 100 });
    c.set('k', 42);
    expect(c.get('k')).toBe(42);

    vi.advanceTimersByTime(101);
    expect(c.get('k')).toBeUndefined();
  });

  it('does not expire before TTL', () => {
    const c = new TtlCache<number>({ ttlMs: 100 });
    c.set('k', 42);

    vi.advanceTimersByTime(99);
    expect(c.get('k')).toBe(42);
  });

  it('has() reflects TTL expiry', () => {
    const c = new TtlCache<number>({ ttlMs: 50 });
    c.set('k', 1);
    expect(c.has('k')).toBe(true);

    vi.advanceTimersByTime(51);
    expect(c.has('k')).toBe(false);
  });

  it('delete removes entry', () => {
    const c = new TtlCache<number>({ ttlMs: 1000 });
    c.set('a', 1);
    expect(c.delete('a')).toBe(true);
    expect(c.get('a')).toBeUndefined();
    expect(c.delete('a')).toBe(false);
  });

  it('clear removes all entries', () => {
    const c = new TtlCache<number>({ ttlMs: 1000 });
    c.set('a', 1);
    c.set('b', 2);
    expect(c.size).toBe(2);

    c.clear();
    expect(c.size).toBe(0);
    expect(c.get('a')).toBeUndefined();
  });

  it('size tracks live entries', () => {
    const c = new TtlCache<number>({ ttlMs: 1000 });
    expect(c.size).toBe(0);
    c.set('a', 1);
    expect(c.size).toBe(1);
    c.set('b', 2);
    expect(c.size).toBe(2);
  });

  describe('maxEntries eviction', () => {
    it('evicts oldest entry when at capacity', () => {
      const c = new TtlCache<number>({ ttlMs: 10000, maxEntries: 2 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3); // evicts 'a'

      expect(c.get('a')).toBeUndefined();
      expect(c.get('b')).toBe(2);
      expect(c.get('c')).toBe(3);
      expect(c.size).toBe(2);
    });

    it('does not evict when updating existing key', () => {
      const c = new TtlCache<number>({ ttlMs: 10000, maxEntries: 2 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('a', 10); // update, not new — no eviction

      expect(c.get('a')).toBe(10);
      expect(c.get('b')).toBe(2);
      expect(c.size).toBe(2);
    });

    it('maxEntries=1 acts as single-entry cache', () => {
      const c = new TtlCache<string>({ ttlMs: 5000, maxEntries: 1 });
      c.set('first', 'x');
      c.set('second', 'y'); // evicts 'first'

      expect(c.get('first')).toBeUndefined();
      expect(c.get('second')).toBe('y');
    });

    it('eviction order is FIFO', () => {
      const c = new TtlCache<number>({ ttlMs: 10000, maxEntries: 3 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3);

      c.set('d', 4); // evicts 'a' (oldest)
      expect(c.get('a')).toBeUndefined();
      expect(c.get('b')).toBe(2);

      c.set('e', 5); // evicts 'b'
      expect(c.get('b')).toBeUndefined();
      expect(c.get('c')).toBe(3);
    });
  });

  describe('set refreshes insertion order', () => {
    it('re-setting a key moves it to the end of eviction order', () => {
      const c = new TtlCache<number>({ ttlMs: 10000, maxEntries: 3 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3);

      // Touch 'a' → moves to end
      c.set('a', 10);

      // Now insertion order is b, c, a
      c.set('d', 4); // evicts 'b' (the oldest untouched)
      expect(c.get('b')).toBeUndefined();
      expect(c.get('a')).toBe(10);
    });
  });

  describe('set refreshes timestamp', () => {
    it('updating a key resets its TTL', () => {
      const c = new TtlCache<number>({ ttlMs: 100 });
      c.set('k', 1);

      vi.advanceTimersByTime(80);
      c.set('k', 2); // refresh

      vi.advanceTimersByTime(80); // 160ms total, but only 80ms since refresh
      expect(c.get('k')).toBe(2);

      vi.advanceTimersByTime(21); // now 101ms since refresh
      expect(c.get('k')).toBeUndefined();
    });
  });
});
