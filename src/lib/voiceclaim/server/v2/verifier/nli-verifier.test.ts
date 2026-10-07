import { describe, expect, it, vi } from "vitest";
import { NliVerifier } from "./nli-verifier";
import { HybridVerifier } from "./hybrid-verifier";
import { LlmVerifier } from "./llm-verifier";
import type { Passage } from "../types";

describe("NLI Verifier & Hybrid Experiment (T31)", () => {
  const dummyPassage: Passage = {
    passageId: "p-1",
    docId: "d-1",
    start: 0,
    end: 120,
    text: "The company reported total quarterly revenue of $15 billion, exceeding analyst expectations.",
    contextText: "The company reported total quarterly revenue of $15 billion, exceeding analyst expectations.",
    relevance: 0.95,
  };

  it("handles remote NLI endpoint returning Hugging Face classification response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        [
          { label: "entailment", score: 0.88 },
          { label: "neutral", score: 0.08 },
          { label: "contradiction", score: 0.04 },
        ],
      ],
    });

    const verifier = new NliVerifier({
      endpointUrl: "https://mock-hf-endpoint.example.com",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const results = await verifier.verify({
      hypothesis: "The company had $15 billion in quarterly revenue",
      passages: [dummyPassage],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.entail).toBeGreaterThan(0.7);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to heuristic NLI when endpoint URL is not configured", async () => {
    const verifier = new NliVerifier({ endpointUrl: undefined });

    const results = await verifier.verify({
      hypothesis: "The company reported $15 billion revenue",
      passages: [dummyPassage],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.entail).toBeGreaterThanOrEqual(0.7);
    expect(results[0]?.supportSpan).toBeDefined();
  });

  it("detects contradiction using heuristic cues when statements conflict", async () => {
    const verifier = new NliVerifier({ endpointUrl: undefined });
    const contradictPassage: Passage = {
      passageId: "p-contra",
      docId: "d-1",
      start: 0,
      end: 100,
      text: "Officials denied the report and stated the project failed to launch.",
      contextText: "Officials denied the report and stated the project failed to launch.",
      relevance: 0.9,
    };

    const results = await verifier.verify({
      hypothesis: "Officials confirmed the project launch",
      passages: [contradictPassage],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.contradict).toBeGreaterThan(0.5);
  });

  it("HybridVerifier cascades ambiguous passages (max prob < threshold) to LLM verifier", async () => {
    // NLI verifier returns ambiguous 0.35/0.35/0.30
    const ambiguousNli = new NliVerifier({
      endpointUrl: "https://mock.com",
      fetchFn: (async () => ({
        ok: true,
        json: async () => [{ label: "entailment", score: 0.35 }, { label: "neutral", score: 0.35 }, { label: "contradiction", score: 0.30 }],
      })) as unknown as typeof fetch,
    });

    const llmVerifySpy = vi.fn().mockResolvedValue([
      {
        passageId: "p-1",
        entail: 0.95,
        neutral: 0.03,
        contradict: 0.02,
        supportSpan: { start: 0, end: 50 },
        verifierId: "llm-mock",
      },
    ]);

    const mockLlm = {
      id: "llm-test",
      verify: llmVerifySpy,
    } as unknown as LlmVerifier;

    const hybrid = new HybridVerifier({
      nliVerifier: ambiguousNli,
      llmVerifier: mockLlm,
      uncertainThreshold: 0.60,
    });

    const results = await hybrid.verify({
      hypothesis: "Revenue was $15 billion",
      passages: [dummyPassage],
    });

    expect(results).toHaveLength(1);
    // Because NLI was uncertain (< 0.60), it escalated to LLM
    expect(llmVerifySpy).toHaveBeenCalledTimes(1);
    expect(results[0]?.entail).toBeGreaterThan(0.9);
    expect(results[0]?.verifierId).toContain("hybrid-nli-llm");
  });

  it("HybridVerifier keeps NLI output without calling LLM when NLI is confident (>= threshold)", async () => {
    const confidentNli = new NliVerifier({
      endpointUrl: "https://mock.com",
      fetchFn: (async () => ({
        ok: true,
        json: async () => [{ label: "entailment", score: 0.90 }, { label: "neutral", score: 0.05 }, { label: "contradiction", score: 0.05 }],
      })) as unknown as typeof fetch,
    });

    const llmVerifySpy = vi.fn();
    const mockLlm = {
      id: "llm-test",
      verify: llmVerifySpy,
    } as unknown as LlmVerifier;

    const hybrid = new HybridVerifier({
      nliVerifier: confidentNli,
      llmVerifier: mockLlm,
      uncertainThreshold: 0.60,
    });

    const results = await hybrid.verify({
      hypothesis: "Revenue was $15 billion",
      passages: [dummyPassage],
    });

    expect(results).toHaveLength(1);
    expect(llmVerifySpy).not.toHaveBeenCalled();
    expect(results[0]?.entail).toBeGreaterThan(0.7);
  });
});
