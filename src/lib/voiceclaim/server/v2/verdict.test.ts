import { describe, expect, it } from "vitest";
import { determineVerdictV2 } from "./verdict";
import { computeConfidenceV2 } from "./confidence";
import type { AtomicClaim, RetrievalCoverage } from "../../types";
import type { AggregationResult } from "./aggregate";

function createDummyClaim(partial?: Partial<AtomicClaim>): AtomicClaim {
  return {
    id: "c-1",
    sessionId: "sess-1",
    sourceSegmentIds: ["seg-1"],
    originalText: "Test claim",
    normalizedClaim: "Test claim",
    context: "",
    timestampMs: 1000,
    mode: "general",
    depth: "quick",
    priority: 80,
    state: "RESEARCHING",
    manual: false,
    evidence: [],
    frame: {
      version: 2,
      subject: "Test Corp",
      claimType: "attribute",
      quantities: [],
      temporal: { expression: null, resolvedStart: null, resolvedEnd: null, anchorSource: "unknown", currentness: "timeless" },
      scope: null,
      condition: null,
      modality: "asserted",
      unresolvedReferent: false,
      selfRepairApplied: false,
    },
    ...partial,
  } as unknown as AtomicClaim;
}

const mockCoverage: RetrievalCoverage = {
  queriesRequested: 4,
  queriesSucceeded: 4,
  pagesAttempted: 4,
  pagesRetrieved: 4,
  passagesVerified: 8,
  verifierFailures: 0,
  budgetExhausted: false,
};

describe("Verdict Rules V0b-V7 & Confidence (T21)", () => {
  it("V0b: returns insufficient_evidence / AMBIGUOUS_CLAIM when referent is unresolved without subject", () => {
    const claim = createDummyClaim({
      frame: {
        version: 2,
        subject: "",
        claimType: "attribute",
        quantities: [],
        temporal: { expression: null, resolvedStart: null, resolvedEnd: null, anchorSource: "unknown", currentness: "timeless" },
        scope: null,
        condition: null,
        modality: "asserted",
        unresolvedReferent: true,
        selfRepairApplied: false,
      },
    });

    const agg: AggregationResult = {
      S: 0,
      C: 0,
      supportClusters: [],
      contradictClusters: [],
      fullEntail: false,
      hasQuantityMismatch: false,
      hasQuantityWithinTolerance: false,
    };

    const res = determineVerdictV2({
      claim,
      aggregation: agg,
      coverage: mockCoverage,
      evidenceCount: 0,
    });

    expect(res.verdict).toBe("insufficient_evidence");
    expect(res.reasonCode).toBe("AMBIGUOUS_CLAIM");
    expect(res.rulesFired).toContain("V0b");
  });

  it("V4: returns supported when S >= 0.8, C < 0.3, and fullEntail is true", () => {
    const claim = createDummyClaim();
    const agg: AggregationResult = {
      S: 0.88,
      C: 0.05,
      supportClusters: [{ clusterId: "c1", tier: "primary_official", maxSupportWeight: 0.88, maxContradictWeight: 0, items: [] }],
      contradictClusters: [],
      fullEntail: true,
      hasQuantityMismatch: false,
      hasQuantityWithinTolerance: false,
      bestSupportTier: "primary_official",
    };

    const res = determineVerdictV2({
      claim,
      aggregation: agg,
      coverage: mockCoverage,
      evidenceCount: 3,
    });

    expect(res.verdict).toBe("supported");
    expect(res.reasonCode).toBe("STRONG_INDEPENDENT_SUPPORT");
    expect(res.rulesFired).toContain("V4");

    const conf = computeConfidenceV2({
      verdict: res.verdict,
      aggregation: agg,
      coverage: mockCoverage,
      evidenceTiers: ["primary_official"],
      isTimeless: true,
    });

    expect(conf.score).toBeGreaterThanOrEqual(75);
    expect(conf.evidenceStrength).toBe("high");
    expect(conf.calibration.status).toBe("calibrated");
  });

  it("V3: returns contradicted when quantity mismatch is detected", () => {
    const claim = createDummyClaim();
    const agg: AggregationResult = {
      S: 0.85,
      C: 0.1,
      supportClusters: [],
      contradictClusters: [],
      fullEntail: true,
      hasQuantityMismatch: true,
      hasQuantityWithinTolerance: false,
    };

    const res = determineVerdictV2({
      claim,
      aggregation: agg,
      coverage: mockCoverage,
      evidenceCount: 2,
    });

    expect(res.verdict).toBe("contradicted");
    expect(res.reasonCode).toBe("QUANTITY_MISMATCH");
    expect(res.rulesFired).toContain("V3");
  });

  it("V2: returns mixed when independent sources conflict without tier dominance", () => {
    const claim = createDummyClaim();
    const agg: AggregationResult = {
      S: 0.75,
      C: 0.72,
      supportClusters: [{ clusterId: "c-reuters", tier: "established_news", maxSupportWeight: 0.75, maxContradictWeight: 0, items: [] }],
      contradictClusters: [{ clusterId: "c-bloomberg", tier: "established_news", maxSupportWeight: 0, maxContradictWeight: 0.72, items: [] }],
      fullEntail: true,
      hasQuantityMismatch: false,
      hasQuantityWithinTolerance: false,
      bestSupportTier: "established_news",
      bestContradictTier: "established_news",
    };

    const res = determineVerdictV2({
      claim,
      aggregation: agg,
      coverage: mockCoverage,
      evidenceCount: 4,
    });

    expect(res.verdict).toBe("mixed");
    expect(res.reasonCode).toBe("CONFLICTING_INDEPENDENT_SOURCES");
    expect(res.rulesFired).toContain("V2_conflict");
  });

  it("V6: returns misleading when context distortion is corroborated by established tier", () => {
    const claim = createDummyClaim();
    const agg: AggregationResult = {
      S: 0.85,
      C: 0.1,
      supportClusters: [{ clusterId: "c-pr", tier: "established_news", maxSupportWeight: 0.85, maxContradictWeight: 0, items: [] }],
      contradictClusters: [],
      fullEntail: true,
      hasQuantityMismatch: false,
      hasQuantityWithinTolerance: false,
      bestSupportTier: "established_news",
    };

    const res = determineVerdictV2({
      claim,
      aggregation: agg,
      coverage: mockCoverage,
      contextDistortion: {
        isDistorted: true,
        missingContext: "Revenue growth was due to a one-time patent settlement rather than sales.",
        corroboratingClusterCount: 1,
        highestClusterTier: "established_news",
      },
      evidenceCount: 3,
    });

    expect(res.verdict).toBe("misleading");
    expect(res.reasonCode).toBe("CORROBORATED_MISSING_CONTEXT");
    expect(res.missingContext).toContain("one-time patent settlement");
    expect(res.rulesFired).toContain("V6");
  });

  it("Monotonicity property: raising S never changes supported to contradicted", () => {
    const claim = createDummyClaim();
    for (let s = 0.5; s <= 0.95; s += 0.1) {
      const agg: AggregationResult = {
        S: s,
        C: 0.1,
        supportClusters: [{ clusterId: "c1", tier: "established_news", maxSupportWeight: s, maxContradictWeight: 0, items: [] }],
        contradictClusters: [],
        fullEntail: true,
        hasQuantityMismatch: false,
        hasQuantityWithinTolerance: false,
      };
      const res = determineVerdictV2({
        claim,
        aggregation: agg,
        coverage: mockCoverage,
        evidenceCount: 2,
      });
      expect(res.verdict).not.toBe("contradicted");
    }
  });
});
