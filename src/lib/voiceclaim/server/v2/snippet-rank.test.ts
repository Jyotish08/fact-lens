import { describe, expect, it } from "vitest";
import { rankSnippetsBeforeScrape } from "./snippet-rank";
import type { AtomicClaim } from "../../types";
import type { SearchHit } from "../bright-data.server";

describe("Snippet Ranking Before Scraping (T14)", () => {
  const claim: AtomicClaim = {
    id: "test-claim",
    sessionId: "s-1",
    sourceSegmentIds: ["seg-1"],
    originalText: "Apple reported 380 billion in revenue for 2023.",
    normalizedClaim: "Apple reported annual revenue exceeding 380 billion dollars for fiscal year 2023.",
    context: "Investor briefing",
    timestampMs: 0,
    mode: "investor",
    depth: "quick",
    state: "RESEARCHING",
    priority: 85,
    manual: false,
    evidence: [],
    frame: {
      version: 2,
      subject: "Apple",
      claimType: "quantity",
      quantities: [{ raw: "380 billion", value: 380_000_000_000, unit: "USD", comparator: "exact" }],
      temporal: {
        expression: "in 2023",
        resolvedStart: "2023-01-01",
        resolvedEnd: "2023-12-31",
        anchorSource: "explicit",
        currentness: "historical",
      },
      scope: null,
      condition: null,
      modality: "asserted",
      unresolvedReferent: false,
      selfRepairApplied: false,
    },
  };

  const sampleHits: Array<SearchHit & { side?: "support" | "challenge" }> = [
    {
      title: "Apple 10-K Filing for Fiscal Year 2023",
      url: "https://www.sec.gov/edgar/data/320193/apple10k2023.htm",
      snippet: "Official consolidated revenue reached 383 billion dollars for the year 2023.",
      side: "support",
    },
    {
      title: "Random tech blog gossip",
      url: "https://techrumors.com/post/apple-thoughts",
      snippet: "Some random discussion about phones.",
      side: "support",
    },
    {
      title: "Social media reaction on Apple products",
      url: "https://x.com/techuser/status/9999",
      snippet: "Did Apple make that much money?",
      side: "support",
    },
    {
      title: "Critical financial audit refuting Apple revenue narrative",
      url: "https://www.bloomberg.com/news/articles/apple-analysis",
      snippet: "Analysts challenge whether Apple really exceeded expectations in 2023.",
      side: "challenge",
    },
    {
      title: "Wikipedia page on Apple Inc.",
      url: "https://en.wikipedia.org/wiki/Apple_Inc.",
      snippet: "General overview of the multinational company.",
      side: "support",
    },
  ];

  it("prioritizes high-tier official records with high lexical overlap", async () => {
    const ranked = await rankSnippetsBeforeScrape({ claim, hits: sampleHits, k: 3 });
    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.url).toContain("sec.gov");
    expect(ranked[0]?.tierScore).toBe(1.0);
  });

  it("enforces polarity balance by including at least 1 challenge hit in top K", async () => {
    const ranked = await rankSnippetsBeforeScrape({ claim, hits: sampleHits, k: 3 });
    const hasChallenge = ranked.some((h) => h.side === "challenge");
    expect(hasChallenge).toBe(true);
  });

  it("works reliably with mock or stubbed embeddings", async () => {
    const stubEmbeddings = async (texts: string[]) => {
      return texts.map(() => [1, 0, 0, 0]);
    };
    const ranked = await rankSnippetsBeforeScrape({
      claim,
      hits: sampleHits,
      k: 4,
      embeddingFn: stubEmbeddings,
    });
    expect(ranked).toHaveLength(4);
    expect(ranked[0]?.cosineScore).toBeGreaterThanOrEqual(0.5);
  });
});
