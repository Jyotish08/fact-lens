import { describe, expect, it } from "vitest";
import { rankPassagesHybrid } from "./passage-rank";
import type { Passage } from "./types";

describe("rankPassagesHybrid", () => {
  const passages: Passage[] = [
    {
      passageId: "doc1#p1",
      docId: "doc1",
      start: 0,
      end: 100,
      text: "Global semiconductor revenue totaled $533 billion in 2023, decreasing 8.8% year over year according to Gartner.",
      contextText: "Global semiconductor revenue totaled $533 billion in 2023...",
      relevance: 0,
    },
    {
      passageId: "doc1#p2",
      docId: "doc1",
      start: 101,
      end: 200,
      text: "Memory chip sales experienced a severe downturn of 37 percent amid excess inventory.",
      contextText: "Memory chip sales experienced a severe downturn...",
      relevance: 0,
    },
    {
      passageId: "doc1#p3",
      docId: "doc1",
      start: 201,
      end: 300,
      text: "Automotive semiconductors showed resilient growth expanding 19% driven by EV adoption.",
      contextText: "Automotive semiconductors showed resilient growth...",
      relevance: 0,
    },
    {
      passageId: "doc1#p4",
      docId: "doc1",
      start: 301,
      end: 400,
      text: "Industrial chip demand softened gradually in the second half of the calendar year.",
      contextText: "Industrial chip demand softened gradually...",
      relevance: 0,
    },
    {
      passageId: "doc2#p1",
      docId: "doc2",
      start: 0,
      end: 100,
      text: "World semiconductor revenue fell 8.8 percent in 2023 to $533 billion as memory demand collapsed.",
      contextText: "World semiconductor revenue fell 8.8 percent in 2023...",
      relevance: 0,
    },
    {
      passageId: "doc3#p1",
      docId: "doc3",
      start: 0,
      end: 100,
      text: "Coffee production reached record harvest levels in South America due to favorable weather conditions.",
      contextText: "Coffee production reached record harvest levels...",
      relevance: 0,
    },
  ];

  it("returns empty array for empty input", async () => {
    const res = await rankPassagesHybrid({ claimText: "test", passages: [] });
    expect(res).toEqual([]);
  });

  it("ranks relevant passages higher using BM25 and sets normalized relevance", async () => {
    const res = await rankPassagesHybrid({
      claimText: "semiconductor revenue in 2023 was $533 billion",
      passages,
      depth: "quick",
    });

    expect(res.length).toBeGreaterThan(0);
    // doc1#p1 or doc2#p1 should be top ranked
    expect(["doc1#p1", "doc2#p1"]).toContain(res[0]?.passageId);
    expect(res[0]?.relevance).toBeGreaterThan(0);
    // Coffee passage should rank lowest or not in top
    const coffeeIndex = res.findIndex((p) => p.passageId === "doc3#p1");
    if (coffeeIndex !== -1) {
      expect(coffeeIndex).toBeGreaterThan(0);
    }
  });

  it("enforces maxPerDoc cap (default 3 passages per document)", async () => {
    // doc1 has 4 passages. Even if all match semiconductor, only 3 should be selected.
    const res = await rankPassagesHybrid({
      claimText: "semiconductor sales chips demand revenue 2023",
      passages,
      maxPerDoc: 3,
      globalCap: 10,
    });

    const doc1Passages = res.filter((p) => p.docId === "doc1");
    expect(doc1Passages.length).toBeLessThanOrEqual(3);
  });

  it("fuses with embedding cosine when embeddingFn is provided", async () => {
    // Mock embedding: query aligns strongly with doc1#p3 (automotive)
    const mockEmbeddings = async (texts: string[]): Promise<number[][]> => {
      // 3-dim mock vectors
      return texts.map((t, idx) => {
        if (idx === 0) return [1, 0, 0]; // claim query
        if (t.includes("Automotive")) return [0.99, 0.01, 0]; // strong match
        return [0.1, 0.8, 0.1];
      });
    };

    const res = await rankPassagesHybrid({
      claimText: "automotive semiconductor expansion",
      passages,
      embeddingFn: mockEmbeddings,
    });

    expect(res[0]?.passageId).toBe("doc1#p3");
  });

  it("falls back to BM25 when embeddingFn throws", async () => {
    const failingEmbeddings = async (): Promise<number[][]> => {
      throw new Error("OpenAI Rate Limit 429");
    };

    const res = await rankPassagesHybrid({
      claimText: "semiconductor revenue $533 billion",
      passages,
      embeddingFn: failingEmbeddings,
    });

    expect(res.length).toBeGreaterThan(0);
    expect(["doc1#p1", "doc2#p1"]).toContain(res[0]?.passageId);
  });
});
