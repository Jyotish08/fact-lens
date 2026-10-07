import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRetrievalCaches,
  getCachedScrape,
  getCachedSerp,
  getRetrievalCacheStats,
  LRUCache,
  normalizeQuery,
  setCachedScrape,
  setCachedSerp,
} from "./cache.server";
import type { SearchHit } from "../bright-data.server";

describe("Opportunistic LRU Cache (T35)", () => {
  beforeEach(() => {
    clearRetrievalCaches();
  });

  it("normalizes query strings consistently", () => {
    expect(normalizeQuery("  Federal Reserve   Interest   Rates  ")).toBe(
      "federal reserve interest rates",
    );
  });

  it("LRUCache evicts least recently used items when maxSize is exceeded", () => {
    const cache = new LRUCache<string, number>(3, 60_000);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Access 'a' to make 'b' the oldest
    expect(cache.get("a")).toBe(1);

    // Add 'd', which should evict 'b'
    cache.set("d", 4);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(cache.has("d")).toBe(true);
  });

  it("LRUCache expires items after TTL", () => {
    const cache = new LRUCache<string, string>(5, 1000);
    cache.set("item", "value");

    expect(cache.get("item")).toBe("value");

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1500);
    expect(cache.get("item")).toBeUndefined();
    expect(cache.has("item")).toBe(false);
    dateSpy.mockRestore();
  });

  it("stores and retrieves SERP search hits", () => {
    const mockHits: SearchHit[] = [
      {
        url: "https://example.com/report",
        title: "Report",
        snippet: "Snippet text",
      },
    ];

    setCachedSerp("Acme quarterly report", mockHits);

    // Cache retrieval with extra spacing / differing casing
    const cached = getCachedSerp("   acme  QUARTERLY   report  ");
    expect(cached).toBeDefined();
    expect(cached).toHaveLength(1);
    expect(cached?.[0]?.url).toBe("https://example.com/report");

    const stats = getRetrievalCacheStats();
    expect(stats.serp.hits).toBe(1);
    expect(stats.serp.hitRate).toBe(1.0);
  });

  it("stores and retrieves scraped pages by canonical URL", () => {
    const rawUrl = "https://example.com/article/?utm_source=twitter&ref=share";
    const markdown = "# Official Report\n\nFull audited contents.";

    setCachedScrape(rawUrl, markdown);

    // Lookup with different tracking param or trailing slash
    const cached = getCachedScrape("https://example.com/article/?ref=share");
    expect(cached).toBe(markdown);

    const stats = getRetrievalCacheStats();
    expect(stats.scrape.hits).toBe(1);
  });
});
