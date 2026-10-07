import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AtomicClaim, SessionSettings } from "../types";
import * as brightData from "./bright-data.server";
import * as openai from "./openai.server";
import { runVerification } from "./pipeline.server";

const mockClaim: AtomicClaim = {
  id: "claim-1",
  sessionId: "session-1",
  sourceSegmentIds: ["seg-1"],
  originalText: "Nvidia reached a four trillion dollar market cap.",
  normalizedClaim: "Nvidia reached a four trillion dollar market cap in 2025.",
  context: "Financial news",
  timestampMs: 1000,
  mode: "investor",
  depth: "quick",
  state: "RESEARCHING",
  priority: 85,
  manual: false,
  evidence: [],
};

const mockSettings: SessionSettings = {
  mode: "investor",
  depth: "quick",
  intervalPreset: "fast",
  sourceCount: 3,
  concurrency: 2,
};

describe("Pipeline Coverage Accounting & Error Handling (T03, T07)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("yields RETRIEVAL_UNAVAILABLE error and NO verdict when all searches fail (provider down)", async () => {
    vi.spyOn(openai, "structuredCompletion").mockResolvedValue({
      supporting: ["nvidia 4 trillion 2025", "nvidia market cap 4T"],
      contradictory: ["nvidia market cap below 4T", "nvidia valuation official"],
    } as any);

    vi.spyOn(brightData, "searchWeb").mockRejectedValue(
      new Error("BRIGHTDATA_HTTP_429: Rate limit exceeded"),
    );

    const updates = [];
    for await (const update of runVerification(mockClaim, mockSettings, "")) {
      updates.push(update);
    }

    const errorEvent = updates.find((u) => u.type === "error");
    const resultEvent = updates.find((u) => u.type === "result");

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.message).toContain("RETRIEVAL_UNAVAILABLE");
    // Crucial: infra failures must NEVER produce a verdict!
    expect(resultEvent).toBeUndefined();
  });

  it("yields insufficient_evidence with NO_RELEVANT_SOURCES when searches succeed but return 0 hits", async () => {
    vi.spyOn(openai, "structuredCompletion").mockResolvedValue({
      supporting: ["query 1", "query 2"],
      contradictory: ["query 3", "query 4"],
    } as any);

    vi.spyOn(brightData, "searchWeb").mockResolvedValue([]);

    const updates = [];
    for await (const update of runVerification(mockClaim, mockSettings, "")) {
      updates.push(update);
    }

    const resultEvent = updates.find((u) => u.type === "result");
    expect(resultEvent).toBeDefined();
    expect(resultEvent?.result?.verdict).toBe("insufficient_evidence");
    expect(resultEvent?.result?.reasonCode).toBe("NO_RELEVANT_SOURCES");
    expect(resultEvent?.result?.coverage?.queriesSucceeded).toBe(4);
    expect(resultEvent?.result?.coverage?.pagesRetrieved).toBe(0);
  });

  it("yields PARTIAL_RETRIEVAL_FAILURE when some searches fail and no evidence is found", async () => {
    vi.spyOn(openai, "structuredCompletion").mockResolvedValue({
      supporting: ["query 1", "query 2"],
      contradictory: ["query 3", "query 4"],
    } as any);

    let callCount = 0;
    vi.spyOn(brightData, "searchWeb").mockImplementation(async () => {
      callCount += 1;
      if (callCount <= 2) {
        throw new Error("Temporary network timeout");
      }
      return [];
    });

    const updates = [];
    for await (const update of runVerification(mockClaim, mockSettings, "")) {
      updates.push(update);
    }

    const resultEvent = updates.find((u) => u.type === "result");
    expect(resultEvent).toBeDefined();
    expect(resultEvent?.result?.verdict).toBe("insufficient_evidence");
    expect(resultEvent?.result?.reasonCode).toBe("PARTIAL_RETRIEVAL_FAILURE");
    expect(resultEvent?.result?.coverage?.queriesSucceeded).toBe(2);
    expect(resultEvent?.result?.coverage?.queriesRequested).toBe(4);
  });
});
