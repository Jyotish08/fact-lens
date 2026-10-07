import type { SearchHit } from "../bright-data.server";
import { canonicalizeUrl } from "../evidence";

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
}

export class LRUCache<K, V> {
  private store = new Map<K, CacheEntry<V>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
  ) {}

  public get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }

    entry.lastAccessed = Date.now();
    // Re-insert to keep Map insertion order aligned with LRU
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  public set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      // Evict least recently used (first key in map iterator)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + this.ttlMs,
      lastAccessed: now,
    });
  }

  public has(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  public clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  public getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 1000) / 1000 : 0,
      size: this.store.size,
      maxSize: this.maxSize,
    };
  }
}

export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

// Opportunistic in-memory LRU caches per server instance (T35)
// SERP: 10 minutes, max 200 queries
const serpCache = new LRUCache<string, SearchHit[]>(200, 10 * 60 * 1000);

// Scrape: 30 minutes, max 100 URLs
const scrapeCache = new LRUCache<string, string>(100, 30 * 60 * 1000);

export function getCachedSerp(query: string): SearchHit[] | undefined {
  const norm = normalizeQuery(query);
  const hits = serpCache.get(norm);
  if (!hits) return undefined;
  // Return deep clone of search hits to prevent mutation
  return hits.map((h) => ({ ...h }));
}

export function setCachedSerp(query: string, hits: SearchHit[]): void {
  const norm = normalizeQuery(query);
  serpCache.set(norm, hits.map((h) => ({ ...h })));
}

export function getCachedScrape(url: string): string | undefined {
  try {
    const canon = canonicalizeUrl(url);
    return scrapeCache.get(canon);
  } catch {
    return undefined;
  }
}

export function setCachedScrape(url: string, markdown: string): void {
  try {
    const canon = canonicalizeUrl(url);
    scrapeCache.set(canon, markdown);
  } catch {
    // Non-fatal if URL cannot be canonicalized
  }
}

export function getRetrievalCacheStats(): { serp: CacheStats; scrape: CacheStats } {
  return {
    serp: serpCache.getStats(),
    scrape: scrapeCache.getStats(),
  };
}

export function clearRetrievalCaches(): void {
  serpCache.clear();
  scrapeCache.clear();
}
