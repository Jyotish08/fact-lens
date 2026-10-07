import { describe, expect, it, vi } from "vitest";
import { logClaimLinking, logContextualResolution, logPipelineEvent } from "./logging.server";
import {
  verificationResultSchema,
  verificationTraceSchema,
  retrievalCoverageSchema,
} from "../schemas";
import type { VerificationResult, VerificationTrace } from "../types";

describe("Pipeline Telemetry and Log Privacy", () => {
  it("emits bounded CCI resolution and linking metrics without transcript content", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    logContextualResolution({ durationMs: 12.7, resolved: true, confidence: 1.2, antecedentSegmentId: "seg-1" });
    logClaimLinking({ durationMs: 2.2, relation: "duplicate", duplicate: true });
    const resolution = JSON.parse(infoSpy.mock.calls[0]![0]);
    const linking = JSON.parse(infoSpy.mock.calls[1]![0]);
    expect(resolution).toMatchObject({ event: "voiceclaim_contextual_resolution", durationMs: 13, resolved: true, confidence: 1, antecedentSegmentId: "seg-1" });
    expect(linking).toMatchObject({ event: "voiceclaim_claim_linking", durationMs: 2, relation: "duplicate", duplicate: true });
    expect(JSON.stringify([resolution, linking])).not.toContain("normalizedClaim");
    infoSpy.mockRestore();
  });
  it("emits voiceclaim_pipeline_event without sensitive transcript/claim text or token URLs", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const sentinelClaim = "SECRET_CLAIM_CONTENT_DO_NOT_LEAK";
    const sentinelUrlWithToken = "https://example.com/api?token=sk-private-123456789";

    logPipelineEvent({
      claimTraceId: "trace-uuid-123",
      pipelineVersion: "v1",
      stage: "research_round",
      durationMs: 125.4,
      count: 2,
      model: "gpt-4o-mini",
      tokensIn: 450,
      tokensOut: 85,
      promptVersion: "query.v1",
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const loggedRaw = infoSpy.mock.calls[0]![0];
    const parsed = JSON.parse(loggedRaw);

    expect(parsed.event).toBe("voiceclaim_pipeline_event");
    expect(parsed.claimTraceId).toBe("trace-uuid-123");
    expect(parsed.pipelineVersion).toBe("v1");
    expect(parsed.stage).toBe("research_round");
    expect(parsed.durationMs).toBe(125);
    expect(parsed.count).toBe(2);
    expect(parsed.model).toBe("gpt-4o-mini");
    expect(parsed.tokensIn).toBe(450);
    expect(parsed.tokensOut).toBe(85);
    expect(parsed.promptVersion).toBe("query.v1");

    // Ensure forbidden content was never leaked
    expect(loggedRaw).not.toContain(sentinelClaim);
    expect(loggedRaw).not.toContain(sentinelUrlWithToken);
    expect(loggedRaw).not.toContain("token=");

    infoSpy.mockRestore();
  });

  it("validates VerificationTrace and VerificationResult against Zod contract schemas", () => {
    const trace: VerificationTrace = {
      promptVersions: {
        query: "query.v1",
        evidence: "evidence.v1",
        synthesis: "synthesis.v1",
      },
      retrievalEvents: [
        {
          id: "ret-1",
          kind: "search",
          query: "test search",
          status: "ok",
          durationMs: 250,
        },
        {
          id: "ret-2",
          kind: "scrape",
          url: "https://example.gov/report",
          status: "ok",
          durationMs: 500,
        },
      ],
      decision: {
        support: 0.85,
        contradiction: 0.05,
        thresholdsVersion: "v1.0",
        rulesFired: ["V4_STRONG_SUPPORT"],
        clustersUsed: ["example.gov"],
      },
    };

    expect(() => verificationTraceSchema.parse(trace)).not.toThrow();

    const result: VerificationResult = {
      verdict: "supported",
      confidence: {
        score: 92,
        evidenceStrength: "high",
        contradiction: "low",
        freshness: "high",
      },
      summary: "Supported by official records.",
      explanation: "Detailed evidence analysis confirmed the claim.",
      challengeSummary: "No contradictory sources were found.",
      evidenceGaps: [],
      recommendedActions: [],
      roundsRun: 1,
      reasonCode: "STRONG_INDEPENDENT_SUPPORT",
      coverage: {
        queriesRequested: 4,
        queriesSucceeded: 4,
        pagesAttempted: 2,
        pagesRetrieved: 2,
        passagesVerified: 2,
        verifierFailures: 0,
        budgetExhausted: false,
      },
      pipelineVersion: "v1",
      calibration: {
        status: "uncalibrated",
      },
      trace,
    };

    expect(() => verificationResultSchema.parse(result)).not.toThrow();
  });
});
