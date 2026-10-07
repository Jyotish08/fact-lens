import { describe, expect, it } from "vitest";
import {
  aggregateStrength,
  canonicalizeUrl,
  computeEvidenceConfidence,
  determineVerdict,
  excerptAppearsInSource,
  isPrivateHost,
  type ScoredEvidence,
} from "./server/evidence";

const base: ScoredEvidence = {
  id: "candidate-1",
  title: "Primary report",
  domain: "example.gov",
  url: "https://example.gov/report",
  category: "government",
  excerpt: "The measured result was 42 percent in 2025.",
  relation: "supports",
  retrievedAt: "2026-08-10T00:00:00.000Z",
  authority: "high",
  independent: true,
  relevance: 1,
  directness: 1,
  freshnessScore: 1,
};

describe("evidence provenance", () => {
  it("canonicalizes tracking URLs and blocks private targets", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM/report/?utm_source=x&gclid=y#part")).toBe(
      "https://example.com/report",
    );
    expect(() => canonicalizeUrl("http://127.0.0.1/private")).toThrow("PRIVATE_NETWORK_URL");
    expect(() => canonicalizeUrl("http://localhost:8080/admin")).toThrow("PRIVATE_NETWORK_URL");
    expect(() => canonicalizeUrl("http://[::1]/status")).toThrow("PRIVATE_NETWORK_URL");
    expect(() => canonicalizeUrl("http://169.254.169.254/latest/meta-data")).toThrow("PRIVATE_NETWORK_URL");
    expect(() => canonicalizeUrl("ftp://example.com/file")).toThrow("UNSAFE_URL");
    expect(isPrivateHost("192.168.1.2")).toBe(true);
    expect(isPrivateHost("10.200.1.5")).toBe(true);
    expect(isPrivateHost("172.20.0.1")).toBe(true);
    expect(isPrivateHost("100.65.0.1")).toBe(true);
    expect(isPrivateHost("intranet.local")).toBe(true);
    expect(isPrivateHost("corp.internal")).toBe(true);
    expect(isPrivateHost("example.com")).toBe(false);
  });

  it("accepts only normalized exact excerpts", () => {
    expect(
      excerptAppearsInSource(
        "The measured result was 42 percent in 2025.",
        "Report\n\nThe   measured result was 42 percent in 2025. End.",
      ),
    ).toBe(true);
    expect(
      excerptAppearsInSource("A plausible but invented excerpt long enough.", base.excerpt),
    ).toBe(false);
  });

  it("rejects an excerpt with mostly fabricated words even if a 5-word run matches", () => {
    const source =
      "Official briefing notes: Medicare has the authority to negotiate prices for certain high-cost prescription drugs.";
    const fabricatedWith5WordMatch =
      "According to unconfirmed industry rumors circulating today Medicare has the authority to negotiate and set market rates everywhere.";
    // Even though "Medicare has the authority to negotiate" is 6 words, the full excerpt is largely fabricated
    expect(excerptAppearsInSource(fabricatedWith5WordMatch, source)).toBe(false);
  });

  it("matches visible wording across Markdown formatting without accepting paraphrases", () => {
    expect(
      excerptAppearsInSource(
        "Medicare has the authority to negotiate prices for certain drugs.",
        "## Policy\n\n**Medicare** has the authority to [negotiate prices](https://example.gov) for certain drugs.",
      ),
    ).toBe(true);
    expect(
      excerptAppearsInSource(
        "Medicare may bargain over the cost of selected medicines.",
        "Medicare has the authority to negotiate prices for certain drugs.",
      ),
    ).toBe(false);
  });

  it("discounts duplicates by excluding them from independent aggregation", () => {
    const duplicate = { ...base, id: "candidate-2", independent: false };
    expect(aggregateStrength([base, duplicate], "supports")).toBeCloseTo(0.9, 5);
  });
});

describe("deterministic verdicts", () => {
  it.each([
    [
      {
        support: 0.9,
        contradiction: 0.1,
        allMaterialElementsCovered: true,
        materialDistortion: false,
      },
      "supported",
    ],
    [
      {
        support: 0.7,
        contradiction: 0.2,
        allMaterialElementsCovered: false,
        materialDistortion: false,
      },
      "mostly_supported",
    ],
    [
      {
        support: 0.55,
        contradiction: 0.55,
        allMaterialElementsCovered: false,
        materialDistortion: false,
      },
      "mixed",
    ],
    [
      {
        support: 0.2,
        contradiction: 0.75,
        allMaterialElementsCovered: false,
        materialDistortion: false,
      },
      "contradicted",
    ],
    [
      {
        support: 0.9,
        contradiction: 0.05,
        allMaterialElementsCovered: true,
        materialDistortion: true,
      },
      "misleading",
    ],
    [
      {
        support: 0.4,
        contradiction: 0.1,
        allMaterialElementsCovered: false,
        materialDistortion: false,
      },
      "insufficient_evidence",
    ],
  ] as const)("maps evidence thresholds", (input, expected) => {
    expect(determineVerdict(input)).toBe(expected);
  });

  it("requires corroborated distortion (or high authority) to veto as misleading", () => {
    // Single low-authority distortion does not veto strong support
    const singleFringe = determineVerdict({
      support: 0.9,
      contradiction: 0.1,
      allMaterialElementsCovered: true,
      materialDistortionCount: 1,
      highAuthorityDistortion: false,
    });
    expect(singleFringe).toBe("supported");

    // Corroborated distortion (>= 2 independent items) triggers misleading
    const corroborated = determineVerdict({
      support: 0.9,
      contradiction: 0.1,
      allMaterialElementsCovered: true,
      materialDistortionCount: 2,
      highAuthorityDistortion: false,
    });
    expect(corroborated).toBe("misleading");

    // Single high-authority distortion triggers misleading
    const highAuth = determineVerdict({
      support: 0.9,
      contradiction: 0.1,
      allMaterialElementsCovered: true,
      materialDistortionCount: 1,
      highAuthorityDistortion: true,
    });
    expect(highAuth).toBe("misleading");
  });

  it("computes confidence in code and caps it at 95", () => {
    const confidence = computeEvidenceConfidence({
      verdict: "supported",
      support: 1,
      contradiction: 0,
      evidence: [base],
      materialGapCount: 0,
      successfulQueries: 4,
      requestedQueries: 4,
    });
    expect(confidence.score).toBe(95);
    expect(confidence.evidenceStrength).toBe("high");
  });
});
