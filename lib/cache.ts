/**
 * Shared in-memory TTL cache with optional max-entry eviction (FIFO).
 *
 * Usage:
 *   const c = new TtlCache<MyData>({ ttlMs: 30_000, maxEntries: 20 });
 *   c.set('key', data);
 *   const hit = c.get('key'); // undefined if expired or absent
 */

export interface TtlCacheOptions {
  /** Time-to-live in milliseconds. */
  ttlMs: number;
  /** Maximum number of entries. Oldest entry is evicted when exceeded. Default: no limit. */
  maxEntries?: number;
}

interface Entry<V> {
  value: V;
  ts: number;
}

export class TtlCache<V> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly store = new Map<string, Entry<V>>();

  constructor(opts: TtlCacheOptions) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = opts.maxEntries ?? Infinity;
  }

  /** Return cached value if present and not expired, otherwise `undefined`. */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Store a value. Evicts the oldest entry when `maxEntries` is reached. */
  set(key: string, value: V): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest != null) this.store.delete(oldest);
    }
    // Re-insert to refresh insertion order (relevant for FIFO eviction)
    this.store.delete(key);
    this.store.set(key, { value, ts: Date.now() });
  }

  /** Check existence without returning the value. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
