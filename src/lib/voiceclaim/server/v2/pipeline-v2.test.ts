import { describe, expect, it, vi } from "vitest";
import { runVerificationV2 } from "./pipeline-v2.server";
import type { AtomicClaim, SessionSettings } from "../../types";

// Mock the external provider calls
vi.mock("../bright-data.server", () => ({
  searchWeb: vi.fn().mockResolvedValue([
    {
      title: "U.S. Bureau of Labor Statistics Report",
      url: "https://bls.gov/news.release/empsit.nr0.htm",
      snippet: "Total nonfarm payroll employment rose by 254,000 in September, and the unemployment rate was 4.1 percent.",
      date: "2026-10-04",
    },
  ]),
  scrapePage: vi.fn().mockResolvedValue({
    url: "https://bls.gov/news.release/empsit.nr0.htm",
    title: "Employment Situation Summary",
    markdown: "THE EMPLOYMENT SITUATION -- SEPTEMBER 2026\n\nTotal nonfarm payroll employment increased by 254,000 in September. The unemployment rate changed little at 4.1 percent.",
    byline: "Bureau of Labor Statistics",
    published: "2026-10-04",
  }),
}));

vi.mock("../openai.server", () => ({
  structuredCompletion: vi.fn().mockImplementation(async ({ jsonSchema }: { jsonSchema: { name: string } }) => {
    if (jsonSchema.name === "verification_queries" || jsonSchema.name === "verification_queries_v2") {
      return {
        supporting: ["unemployment rate September 2026 bls.gov", "payroll employment September 2026"],
        contradictory: ["unemployment rate increase September 2026"],
      };
    }
    if (jsonSchema.name === "verify_passage") {
      return {
        label: "entail",
        probs: { entail: 0.94, neutral: 0.04, contradict: 0.02 },
        quote: "The unemployment rate changed little at 4.1 percent.",
      };
    }
    if (jsonSchema.name === "verification_synthesis") {
      return {
        summary: "The statement is supported by official Bureau of Labor Statistics figures showing an unemployment rate of 4.1%.",
        evidenceGaps: [],
      };
    }
    return {};
  }),
  createEmbeddings: vi.fn().mockImplementation(async (texts: string[]) => ({
    vectors: texts.map(() => [0.1, 0.2, 0.3]),
    model: "text-embedding-3-small",
  })),
}));

describe("Pipeline v2 Integration (T17, T24, G4)", () => {
  it("executes end-to-end verification, streams evidence, and outputs verified result", async () => {
    const claim = {
      id: "claim-v2-int",
      sessionId: "session-1",
      sourceSegmentIds: ["seg-1"],
      normalizedClaim: "The unemployment rate was 4.1% in September",
      originalText: "The unemployment rate was 4.1% in September",
      context: "",
      timestampMs: 500,
      mode: "general",
      depth: "quick",
      priority: 85,
      state: "RESEARCHING",
      manual: false,
      frame: {
        version: 2,
        subject: "Unemployment rate",
        claimType: "quantity",
        quantities: [{ raw: "4.1%", value: 4.1, unit: "%", comparator: "exact" }],
        temporal: { expression: "in September", resolvedStart: "2026-09-01", resolvedEnd: "2026-09-30", anchorSource: "explicit", currentness: "historical" },
        scope: null,
        condition: null,
        modality: "asserted",
        unresolvedReferent: false,
        selfRepairApplied: false,
      },
      evidence: [],
    } as unknown as AtomicClaim;

    const settings: SessionSettings = {
      mode: "general",
      depth: "quick",
      intervalPreset: "balanced",
      sourceCount: 4,
      concurrency: 2,
      recordingDate: "2026-10-04",
    };

    const updates = [];
    for await (const update of runVerificationV2(claim, settings, "")) {
      updates.push(update);
    }

    expect(updates.length).toBeGreaterThanOrEqual(3); // stage -> evidence -> stage -> result
    const resultUpdate = updates.find((u) => u.type === "result");
    expect(resultUpdate).toBeDefined();

    if (resultUpdate && resultUpdate.type === "result") {
      expect(resultUpdate.result.verdict).toBe("supported");
      expect(resultUpdate.result.reasonCode).toBe("STRONG_INDEPENDENT_SUPPORT");
      expect(resultUpdate.result.pipelineVersion).toBe("v2");
      expect(resultUpdate.result.coverage?.queriesSucceeded).toBeGreaterThan(0);
      expect(resultUpdate.result.trace?.decision.rulesFired).toContain("V4");
    }
  });
});
