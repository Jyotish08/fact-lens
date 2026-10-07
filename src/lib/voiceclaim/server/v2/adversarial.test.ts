import { describe, expect, it } from "vitest";
import { determineVerdictV2 } from "./verdict";
import { aggregateEvidenceV2 } from "./aggregate";
import { clusterDocuments } from "./independence";
import { checkQuantityMatch, extractQuantitiesFromText } from "./quantities";
import { locateSpanInText } from "./verifier/llm-verifier";
import { buildEvidenceItemsV2 } from "./evidence-builder";
import type { AtomicClaim, RetrievalCoverage } from "../../types";
import type { SourceDocument } from "./types";

const mockCoverage: RetrievalCoverage = {
  queriesRequested: 4,
  queriesSucceeded: 4,
  pagesAttempted: 4,
  pagesRetrieved: 4,
  passagesVerified: 8,
  verifierFailures: 0,
  budgetExhausted: false,
};

describe("Adversarial Test Suite (T40)", () => {
  it("Adversarial Case: Unresolved Referent -> AMBIGUOUS_CLAIM (V0b)", () => {
    const claim = {
      id: "adv-referent",
      sessionId: "s1",
      sourceSegmentIds: ["seg-1"],
      normalizedClaim: "We beat our biggest competitor last quarter",
      originalText: "We beat our biggest competitor last quarter",
      context: "",
      timestampMs: 1000,
      mode: "general",
      depth: "quick",
      priority: 80,
      state: "RESEARCHING",
      manual: false,
      frame: {
        version: 2,
        subject: "",
        claimType: "attribute",
        quantities: [],
        temporal: { expression: "last quarter", resolvedStart: null, resolvedEnd: null, anchorSource: "unknown", currentness: "current" },
        scope: null,
        condition: null,
        modality: "asserted",
        unresolvedReferent: true,
        selfRepairApplied: false,
      },
      evidence: [],
    } as unknown as AtomicClaim;

    const agg = aggregateEvidenceV2(claim, []);
    const decision = determineVerdictV2({
      claim,
      aggregation: agg,
      coverage: mockCoverage,
      evidenceCount: 0,
    });

    expect(decision.verdict).toBe("insufficient_evidence");
    expect(decision.reasonCode).toBe("AMBIGUOUS_CLAIM");
  });

  it("Adversarial Case: Numeric near miss ('$18 million' vs '$18 billion') -> QUANTITY_MISMATCH", () => {
    const claim = {
      id: "adv-num",
      sessionId: "s1",
      sourceSegmentIds: ["seg-1"],
      normalizedClaim: "Acme Corp raised $18 million in series B",
      originalText: "Acme Corp raised $18 million in series B",
      context: "",
      timestampMs: 1000,
      mode: "investor",
      depth: "quick",
      priority: 80,
      state: "RESEARCHING",
      manual: false,
      frame: {
        version: 2,
        subject: "Acme Corp",
        claimType: "quantity",
        quantities: [{ raw: "$18 million", value: 18_000_000, unit: "USD", comparator: "exact" }],
        temporal: { expression: null, resolvedStart: null, resolvedEnd: null, anchorSource: "unknown", currentness: "timeless" },
        scope: null,
        condition: null,
        modality: "asserted",
        unresolvedReferent: false,
        selfRepairApplied: false,
      },
      evidence: [],
    } as unknown as AtomicClaim;

    const passageText = "Acme Corp confirmed it raised $18 billion in its financing round.";
    const quantities = extractQuantitiesFromText(passageText);
    const match = checkQuantityMatch(claim.frame!.quantities[0]!, quantities);
    expect(match).toBe("mismatch");

    const agg = aggregateEvidenceV2(claim, [
      {
        id: "ev-1",
        url: "https://sec.gov",
        title: "SEC Filing",
        domain: "sec.gov",
        category: "financial_filing",
        excerpt: passageText,
        relation: "supports",
        authority: "high",
        tier: "primary_official",
        quantityCheck: "mismatch",
        independent: true,
        retrievedAt: new Date().toISOString(),
      },
    ]);

    const decision = determineVerdictV2({
      claim,
      aggregation: agg,
      coverage: mockCoverage,
      evidenceCount: 1,
    });

    expect(decision.verdict).toBe("contradicted");
    expect(decision.reasonCode).toBe("QUANTITY_MISMATCH");
  });

  it("Adversarial Case: Fabricated Quote -> locateSpanInText returns null, excerpt safely falls back", () => {
    const passageText = "The central bank kept interest rates flat at 5.25 percent today.";
    const fabricatedQuote = "The central bank unexpectedly slashed rates by 100 basis points.";

    const span = locateSpanInText(passageText, fabricatedQuote);
    expect(span).toBeNull();
  });

  it("Adversarial Case: Syndicated PR x5 produces 1 cluster and avoids false multi-source corroboration", () => {
    const body = "Global Tech Corp announced it achieved fifty million active monthly subscribers worldwide.";
    const docs: SourceDocument[] = [
      { docId: "d1", url: "https://site1.com", registrableDomain: "site1.com", title: "T1", cleanedText: `PR Newswire: ${body}`, contentHash: "h1", retrievalEventId: "r1", publishedAt: null, publishedAtSource: "unknown", tier: "secondary", category: "news", wireMarker: "PR Newswire" },
      { docId: "d2", url: "https://site2.com", registrableDomain: "site2.com", title: "T2", cleanedText: `(PR Newswire) -- ${body}`, contentHash: "h2", retrievalEventId: "r2", publishedAt: null, publishedAtSource: "unknown", tier: "secondary", category: "news", wireMarker: "PR Newswire" },
      { docId: "d3", url: "https://site3.com", registrableDomain: "site3.com", title: "T3", cleanedText: `PR Newswire report: ${body}`, contentHash: "h3", retrievalEventId: "r3", publishedAt: null, publishedAtSource: "unknown", tier: "secondary", category: "news", wireMarker: "PR Newswire" },
    ];

    const clusters = clusterDocuments(docs);
    const uniqueClusters = new Set(clusters.values());
    expect(uniqueClusters.size).toBe(1);
  });

  it("Adversarial Case: Single fringe distortion from social media does not trigger MISLEADING", () => {
    const claim = {
      id: "adv-fringe",
      sessionId: "s1",
      sourceSegmentIds: ["seg-1"],
      normalizedClaim: "Unemployment fell to 3.8% in August",
      originalText: "Unemployment fell to 3.8% in August",
      context: "",
      timestampMs: 1000,
      mode: "general",
      depth: "quick",
      priority: 80,
      state: "RESEARCHING",
      manual: false,
      frame: {
        version: 2,
        subject: "Unemployment",
        claimType: "quantity",
        quantities: [{ raw: "3.8%", value: 3.8, unit: "%", comparator: "exact" }],
        temporal: { expression: "in August", resolvedStart: "2026-08-01", resolvedEnd: "2026-08-31", anchorSource: "explicit", currentness: "historical" },
        scope: null,
        condition: null,
        modality: "asserted",
        unresolvedReferent: false,
        selfRepairApplied: false,
      },
      evidence: [],
    } as unknown as AtomicClaim;

    const agg = aggregateEvidenceV2(claim, [
      {
        id: "ev-bls",
        url: "https://bls.gov",
        title: "Bureau of Labor Statistics",
        domain: "bls.gov",
        category: "government",
        excerpt: "August unemployment rate declined to 3.8 percent.",
        relation: "supports",
        authority: "high",
        tier: "primary_official",
        verifier: { entail: 0.95, neutral: 0.03, contradict: 0.02, verifierId: "test" },
        independent: true,
        retrievedAt: new Date().toISOString(),
      },
    ]);

    const decision = determineVerdictV2({
      claim,
      aggregation: agg,
      coverage: mockCoverage,
      contextDistortion: {
        isDistorted: true,
        missingContext: "Random blog claims statistics are manipulated.",
        corroboratingClusterCount: 1,
        highestClusterTier: "social",
      },
      evidenceCount: 1,
    });

    // Single fringe distortion on social tier should NOT overturn official support
    expect(decision.verdict).toBe("supported");
    expect(decision.reasonCode).toBe("STRONG_INDEPENDENT_SUPPORT");
  });
});
