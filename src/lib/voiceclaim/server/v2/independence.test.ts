import { describe, expect, it } from "vitest";
import {
  clusterDocuments,
  getWordShingles,
  jaccardSimilarity,
} from "./independence";
import type { SourceDocument } from "./types";

function createMockDoc(partial: Partial<SourceDocument> & { docId: string }): SourceDocument {
  return {
    docId: partial.docId,
    url: partial.url ?? `https://${partial.registrableDomain ?? "example.com"}/article`,
    registrableDomain: partial.registrableDomain ?? "example.com",
    title: partial.title ?? "Test Article",
    cleanedText: partial.cleanedText ?? "Some standard content text for verification testing.",
    contentHash: partial.contentHash ?? "hash",
    retrievalEventId: partial.retrievalEventId ?? "ev-1",
    publishedAt: partial.publishedAt ?? "2026-01-01",
    publishedAtSource: partial.publishedAtSource ?? "page_metadata",
    tier: partial.tier ?? "secondary",
    category: partial.category ?? "news",
    wireMarker: partial.wireMarker ?? null,
  };
}

describe("Independence Clustering (T20)", () => {
  it("calculates 5-shingles and Jaccard similarity accurately", () => {
    const textA = "apple banana cherry date elderberry fig grape";
    const textB = "apple banana cherry date elderberry fig honeydew";
    const sA = getWordShingles(textA, 5);
    const sB = getWordShingles(textB, 5);
    const sim = jaccardSimilarity(sA, sB);
    expect(sim).toBeGreaterThan(0.3);
  });

  it("clusters documents sharing the same registrable domain", () => {
    const doc1 = createMockDoc({
      docId: "doc-1",
      registrableDomain: "reuters.com",
      cleanedText: "First distinct article on markets.",
    });
    const doc2 = createMockDoc({
      docId: "doc-2",
      registrableDomain: "reuters.com",
      cleanedText: "Second distinct article on energy.",
    });
    const doc3 = createMockDoc({
      docId: "doc-3",
      registrableDomain: "bloomberg.com",
      cleanedText: "Bloomberg independent coverage.",
    });

    const clusters = clusterDocuments([doc1, doc2, doc3]);
    expect(clusters.get("doc-1")).toBe(clusters.get("doc-2"));
    expect(clusters.get("doc-1")).not.toBe(clusters.get("doc-3"));
  });

  it("clusters syndicated press releases across different domains if wire marker and shingles match", () => {
    const prBody =
      "Acme Corp today announced record third quarter revenue of 20 billion dollars driven by cloud adoption and strong customer retention across all international markets.";
    const doc1 = createMockDoc({
      docId: "doc-pr-1",
      registrableDomain: "marketwatch.com",
      wireMarker: "PR Newswire",
      cleanedText: `NEW YORK (PR Newswire) -- ${prBody}`,
    });
    const doc2 = createMockDoc({
      docId: "doc-pr-2",
      registrableDomain: "yahoo.com",
      wireMarker: "PR Newswire",
      cleanedText: `PRNewswire - ${prBody} Additional boilerplate at footer.`,
    });
    const doc3 = createMockDoc({
      docId: "doc-independent",
      registrableDomain: "ft.com",
      wireMarker: null,
      cleanedText:
        "Financial Times analysis: While Acme claims 20 billion in sales, operating margins contracted significantly due to rising R&D expenditures.",
    });

    const clusters = clusterDocuments([doc1, doc2, doc3]);
    expect(clusters.get("doc-pr-1")).toBe(clusters.get("doc-pr-2"));
    expect(clusters.get("doc-pr-1")).not.toBe(clusters.get("doc-independent"));
  });

  it("clusters near-duplicate articles across different domains via general shingle threshold", () => {
    const sharedText =
      "The Federal Reserve decided to keep benchmark interest rates unchanged at five point five percent citing resilient consumer spending and sticky inflation readings.";
    const doc1 = createMockDoc({
      docId: "d1",
      registrableDomain: "outlet-a.com",
      cleanedText: `Washington: ${sharedText} More updates to follow shortly.`,
    });
    const doc2 = createMockDoc({
      docId: "d2",
      registrableDomain: "outlet-b.com",
      cleanedText: `Special report: ${sharedText} Stay tuned for expert analysis.`,
    });

    const clusters = clusterDocuments([doc1, doc2]);
    expect(clusters.get("d1")).toBe(clusters.get("d2"));
  });
});
