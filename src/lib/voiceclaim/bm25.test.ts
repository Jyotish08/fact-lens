import { describe, expect, it } from "vitest";
import { BM25Index, reciprocalRankFusion, tokenize } from "./bm25";

describe("tokenize", () => {
  it("extracts words, numbers, currencies, and percentages", () => {
    const tokens = tokenize("Apple reported $94.9 billion revenue, up 6% in Q4 2024.");
    expect(tokens).toContain("apple");
    expect(tokens).toContain("$94.9");
    expect(tokens).toContain("billion");
    expect(tokens).toContain("revenue");
    expect(tokens).toContain("6%");
    expect(tokens).toContain("q4");
    expect(tokens).toContain("2024");
  });

  it("handles empty or punctuation-only strings", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("... --- !!!")).toEqual([]);
  });
});

describe("BM25Index", () => {
  const docs = [
    {
      id: "doc-1",
      text: "Global solar energy capacity reached 1.2 terawatts in 2023 with record installations in Europe.",
    },
    {
      id: "doc-2",
      text: "Electric vehicle sales surged past 10 million units worldwide, led by strong adoption in China.",
    },
    {
      id: "doc-3",
      text: "The central bank held interest rates steady at 5.25% following recent inflation reports.",
    },
  ];

  it("ranks the most relevant document highest for keyword queries", () => {
    const index = new BM25Index(docs);
    const results = index.search("solar energy installations in 2023");

    expect(results[0]?.id).toBe("doc-1");
    expect(results[0]?.score).toBeGreaterThan(0);
    expect(results[1]?.score).toBeLessThan(results[0]!.score);
  });

  it("matches numeric values and percentages accurately", () => {
    const index = new BM25Index(docs);
    const results = index.search("interest rates at 5.25%");

    expect(results[0]?.id).toBe("doc-3");
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it("returns zero score for queries with no matching terms", () => {
    const index = new BM25Index(docs);
    const results = index.search("astronomy spacecraft telescope");
    for (const r of results) {
      expect(r.score).toBe(0);
    }
  });
});

describe("reciprocalRankFusion", () => {
  it("fuses multiple ranked lists using reciprocal rank scores", () => {
    const ranker1 = [{ id: "doc-A" }, { id: "doc-B" }, { id: "doc-C" }];
    const ranker2 = [{ id: "doc-B" }, { id: "doc-A" }, { id: "doc-D" }];

    const fused = reciprocalRankFusion([ranker1, ranker2], 60);

    // Both A and B are top 2 in both rankers, so their fused score should be equal and highest
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score, 4);
    expect(["doc-A", "doc-B"]).toContain(fused[0]?.id);
    expect(["doc-A", "doc-B"]).toContain(fused[1]?.id);

    // doc-C (rank 3 in ranker1) and doc-D (rank 3 in ranker2) should follow
    expect(fused[2]!.score).toBeLessThan(fused[0]!.score);
  });

  it("handles single ranker without errors", () => {
    const ranker1 = [{ id: "doc-1" }, { id: "doc-2" }];
    const fused = reciprocalRankFusion([ranker1], 60);

    expect(fused[0]?.id).toBe("doc-1");
    expect(fused[1]?.id).toBe("doc-2");
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score);
  });
});
