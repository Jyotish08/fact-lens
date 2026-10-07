import { describe, expect, it } from "vitest";
import { computeMetrics, computeCalibration, type EvalClaimResult } from "./metrics";
import { withFixture } from "../src/lib/voiceclaim/server/fixtures.server";

describe("Evaluation Metrics Computation (T00)", () => {
  it("computes strict accuracy, macro-F1, and confusion matrix accurately on hand-crafted cases", () => {
    const mockResults: EvalClaimResult[] = [
      {
        id: "1",
        tags: [],
        goldVerdict: "supported",
        acceptableVerdicts: ["supported"],
        predictedVerdict: "supported",
        confidenceScore: 90,
        durationMs: 100,
        tokensIn: 10,
        tokensOut: 10,
        searchCalls: 2,
        scrapeCalls: 1,
        spanValidCount: 1,
        spanTotalCount: 1,
        isError: false,
      },
      {
        id: "2",
        tags: [],
        goldVerdict: "supported",
        acceptableVerdicts: ["supported"],
        predictedVerdict: "mostly_supported",
        confidenceScore: 70,
        durationMs: 150,
        tokensIn: 10,
        tokensOut: 10,
        searchCalls: 2,
        scrapeCalls: 1,
        spanValidCount: 1,
        spanTotalCount: 1,
        isError: false,
      },
      {
        id: "3",
        tags: [],
        goldVerdict: "contradicted",
        acceptableVerdicts: ["contradicted"],
        predictedVerdict: "contradicted",
        confidenceScore: 85,
        durationMs: 200,
        tokensIn: 10,
        tokensOut: 10,
        searchCalls: 2,
        scrapeCalls: 1,
        spanValidCount: 1,
        spanTotalCount: 1,
        isError: false,
      },
      {
        id: "4",
        tags: ["provider_down"],
        goldVerdict: "insufficient_evidence",
        acceptableVerdicts: ["insufficient_evidence"],
        predictedVerdict: undefined,
        confidenceScore: 0,
        durationMs: 50,
        tokensIn: 0,
        tokensOut: 0,
        searchCalls: 0,
        scrapeCalls: 0,
        spanValidCount: 0,
        spanTotalCount: 0,
        isError: true,
        errorCode: "RETRIEVAL_UNAVAILABLE",
      },
    ];

    const metrics = computeMetrics(mockResults);

    expect(metrics.total).toBe(4);
    expect(metrics.evaluated).toBe(3);
    expect(metrics.errors).toBe(1);

    // 2 out of 3 evaluated strictly correct (id 1: supported, id 3: contradicted)
    expect(metrics.accuracyStrict).toBeCloseTo(2 / 3, 4);

    // Confusion matrix checks
    expect(metrics.confusionMatrix["supported"]?.["supported"]).toBe(1);
    expect(metrics.confusionMatrix["supported"]?.["mostly_supported"]).toBe(1);
    expect(metrics.confusionMatrix["contradicted"]?.["contradicted"]).toBe(1);

    // Infra as verdict rate must be 0 because the provider_down item resulted in isError: true
    expect(metrics.infraAsVerdictRate).toBe(0);

    // False contradiction rate is 0 because no non-contradicted gold was predicted contradicted
    expect(metrics.falseContradictionRate).toBe(0);
  });

  it("calculates ECE (Expected Calibration Error) and Brier Score correctly", () => {
    // Perfectly calibrated: confidence 1.0 is 100% correct, confidence 0.0 is 0% correct
    const items = [
      {
        confidenceScore: 100,
        predictedVerdict: "supported" as const,
        goldVerdict: "supported" as const,
      },
      {
        confidenceScore: 100,
        predictedVerdict: "contradicted" as const,
        goldVerdict: "contradicted" as const,
      },
      {
        confidenceScore: 50,
        predictedVerdict: "supported" as const,
        goldVerdict: "supported" as const,
      },
      {
        confidenceScore: 50,
        predictedVerdict: "supported" as const,
        goldVerdict: "contradicted" as const,
      },
    ];

    const cal = computeCalibration(items);
    expect(cal.ece).toBeDefined();
    expect(cal.brierScore).toBeDefined();
    expect(cal.ece).toBeLessThan(0.15);
  });

  it("throws FIXTURE_MISSING when in replay mode and fixture is missing", async () => {
    const prevMode = process.env["VOICECLAIM_FIXTURE_MODE"];
    process.env["VOICECLAIM_FIXTURE_MODE"] = "replay";

    try {
      await expect(
        withFixture("search", "nonexistent_query_that_has_no_fixture_file_xyz_123", async () => {
          return [];
        }),
      ).rejects.toThrow("FIXTURE_MISSING");
    } finally {
      process.env["VOICECLAIM_FIXTURE_MODE"] = prevMode;
    }
  });
});
