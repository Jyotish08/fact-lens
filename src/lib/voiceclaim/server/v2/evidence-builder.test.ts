import { describe, expect, it } from "vitest";
import {
  buildEvidenceItemsV2,
  determineRelation,
  tierToQualitativeAuthority,
} from "./evidence-builder";
import type { Passage, SourceDocument, VerifierOutput } from "./types";
import type { AtomicClaim } from "../../types";

describe("Evidence Builder v2 (T17)", () => {
  it("maps relations accurately according to Rule V1", () => {
    expect(determineRelation(0.85, 0.05)).toBe("supports");
    expect(determineRelation(0.05, 0.85)).toBe("contradicts");
    expect(determineRelation(0.5, 0.4)).toBe("contextual");
    expect(determineRelation(0.72, 0.2)).toBe("contextual"); // contradict > 0.15 blocks supports
  });

  it("maps tiers to qualitative authority", () => {
    expect(tierToQualitativeAuthority("primary_official")).toBe("high");
    expect(tierToQualitativeAuthority("established_news")).toBe("medium");
    expect(tierToQualitativeAuthority("secondary")).toBe("low");
  });

  it("builds evidence items with exact span slice and quantity check", () => {
    const claim = {
      id: "claim-1",
      sessionId: "session-1",
      sourceSegmentIds: ["seg-1"],
      originalText: "Acme Corp reported $20 billion in revenue",
      normalizedClaim: "Acme Corp reported $20 billion in revenue",
      context: "",
      timestampMs: 1000,
      mode: "investor",
      depth: "quick",
      priority: 80,
      state: "RESEARCHING",
      manual: false,
      evidence: [],
      frame: {
        version: 2,
        subject: "Acme Corp",
        claimType: "quantity",
        quantities: [{ raw: "$20 billion", value: 20_000_000_000, unit: "USD", comparator: "exact" }],
        temporal: { expression: null, resolvedStart: null, resolvedEnd: null, anchorSource: "unknown", currentness: "current" },
        scope: null,
        condition: null,
        modality: "asserted",
        unresolvedReferent: false,
        selfRepairApplied: false,
      },
    } as unknown as AtomicClaim;

    const doc: SourceDocument = {
      docId: "doc-1",
      url: "https://sec.gov/filing",
      registrableDomain: "sec.gov",
      title: "Acme 10-K",
      cleanedText: "Item 7: Acme Corp generated total revenue of $20 billion during the twelve months.",
      contentHash: "hash-1",
      retrievalEventId: "ev-1",
      publishedAt: "2026-02-15",
      publishedAtSource: "page_metadata",
      tier: "primary_official",
      category: "financial_filing",
      wireMarker: null,
    };

    const passage: Passage = {
      passageId: "doc-1#p0",
      docId: "doc-1",
      start: 8,
      end: 80,
      text: "Acme Corp generated total revenue of $20 billion during the twelve months.",
      contextText: "Item 7: Acme Corp generated total revenue of $20 billion during the twelve months.",
      relevance: 0.95,
    };

    const vo: VerifierOutput = {
      passageId: "doc-1#p0",
      entail: 0.92,
      neutral: 0.05,
      contradict: 0.03,
      supportSpan: { start: 0, end: 48 },
      verifierId: "llm:gpt-4o-mini@verify.v1",
    };

    const clusterMap = new Map([["doc-1", "c-sec-gov"]]);

    const items = buildEvidenceItemsV2({
      claim,
      documents: [doc],
      passages: [passage],
      verifierOutputs: [vo],
      clusterMap,
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.relation).toBe("supports");
    expect(items[0]!.authority).toBe("high");
    expect(items[0]!.clusterId).toBe("c-sec-gov");
    expect(items[0]!.excerpt).toBe("Acme Corp generated total revenue of $20 billion");
    expect(items[0]!.quantityCheck).toBe("match");
    expect(items[0]!.span).toBeDefined();
  });
});
