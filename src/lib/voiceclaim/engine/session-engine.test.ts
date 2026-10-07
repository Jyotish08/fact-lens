import { describe, expect, it, vi } from "vitest";
import { SCENARIOS } from "../data/scenarios";
import type {
  ClaimExtractionService,
  EvidenceCorpusService,
  TranscriptEvent,
  TranscriptionService,
  VerificationService,
  VoiceClaimServices,
} from "../services/types";
import type { SessionSettings, SessionSource, TranscriptChunk } from "../types";
import { SessionEngine } from "./session-engine";

class ControlledTranscription implements TranscriptionService {
  handler?: (event: TranscriptEvent) => void;
  start(handler: (event: TranscriptEvent) => void) {
    this.handler = handler;
    handler({ type: "connection", status: "connected" });
  }
  stop() {}
}

const settings: SessionSettings = {
  mode: "investor",
  depth: "quick",
  intervalPreset: "fast",
  sourceCount: 3,
  concurrency: 2,
};

const result = {
  verdict: "supported" as const,
  confidence: {
    score: 90,
    evidenceStrength: "high" as const,
    contradiction: "low" as const,
    freshness: "high" as const,
  },
  summary: "Supported",
  explanation: "Evidence supports the claim.",
  challengeSummary: "No meaningful contradictory evidence identified.",
  evidenceGaps: [],
  recommendedActions: [],
  roundsRun: 1,
};

function createEngine(options: {
  extraction: ClaimExtractionService;
  verification: VerificationService;
  transcription: ControlledTranscription;
  corpus?: EvidenceCorpusService;
  source?: SessionSource;
}) {
  const services: VoiceClaimServices = {
    transcription: options.transcription,
    extraction: options.extraction,
    verification: options.verification,
    corpus:
      options.corpus ??
      ({
        register: async () => undefined,
        contextForClaim: async () => "",
        clear: async () => undefined,
      } satisfies EvidenceCorpusService),
  };
  return new SessionEngine({
    sessionId: crypto.randomUUID(),
    title: "Engine test",
    source: options.source ?? "microphone",
    scenario: SCENARIOS[0]!,
    settings,
    serviceMode: "mock",
    sessionToken: "unused-test-token",
    services,
  });
}

describe("SessionEngine", () => {
  it("keeps only the latest interim preview and removes it when speech is final", async () => {
    const transcription = new ControlledTranscription();
    const extraction: ClaimExtractionService = {
      async extract(chunk) {
        return {
          classification: "context",
          originalText: chunk.text,
          requiresMoreContext: false,
          claims: [],
        };
      },
    };
    const verification: VerificationService = { async verify() {} };
    const engine = createEngine({ transcription, extraction, verification });
    engine.start();
    await vi.waitFor(() => expect(transcription.handler).toBeTypeOf("function"));

    transcription.handler!({
      type: "interim",
      segment: { id: "partial-a", startMs: 0, endMs: 500, text: "Medicare", interim: true },
    });
    transcription.handler!({
      type: "interim",
      segment: {
        id: "partial-b",
        startMs: 0,
        endMs: 900,
        text: "Medicare negotiates",
        interim: true,
      },
    });
    expect(engine.session.segments).toEqual([
      expect.objectContaining({ id: "partial-b", text: "Medicare negotiates" }),
    ]);

    transcription.handler!({
      type: "final",
      segment: {
        id: "final-a",
        startMs: 0,
        endMs: 1_000,
        text: "Medicare negotiates prices.",
        interim: false,
      },
    });
    expect(engine.session.segments).toEqual([
      expect.objectContaining({ id: "final-a", interim: false }),
    ]);
    engine.dispose();
  });

  it("combines final segments into one chunk and drains before completing", async () => {
    const transcription = new ControlledTranscription();
    const chunks: TranscriptChunk[] = [];
    const extraction: ClaimExtractionService = {
      async extract(chunk) {
        chunks.push(chunk);
        return {
          classification: "verifiable_fact",
          originalText: chunk.text,
          requiresMoreContext: false,
          claims: [{ normalizedClaim: chunk.text, context: chunk.text, priority: 80 }],
        };
      },
    };
    let verificationFinished = false;
    const verification: VerificationService = {
      async verify(_claim, _settings, update) {
        update({ type: "stage", state: "RESEARCHING" });
        await new Promise((resolve) => setTimeout(resolve, 30));
        verificationFinished = true;
        update({ type: "result", result });
      },
    };
    const engine = createEngine({ transcription, extraction, verification });
    engine.start();
    await vi.waitFor(() => expect(transcription.handler).toBeTypeOf("function"));
    transcription.handler!({
      type: "final",
      segment: { id: "a", startMs: 0, endMs: 500, text: "Revenue rose", interim: false },
    });
    transcription.handler!({
      type: "final",
      segment: { id: "b", startMs: 500, endMs: 1_000, text: "by 42%.", interim: false },
    });
    const finishing = engine.finish();
    expect(engine.session.status).toBe("processing");
    await finishing;
    await vi.waitFor(() => expect(engine.session.status).toBe("completed"));
    expect(verificationFinished).toBe(true);
    expect(chunks[0]?.sourceSegmentIds).toEqual(["a", "b"]);
    expect(engine.session.claims[0]?.sourceSegmentIds).toEqual(["a", "b"]);
  });

  it("treats a punctuated statement as semantically complete without waiting for two intervals", async () => {
    const transcription = new ControlledTranscription();
    const chunks: TranscriptChunk[] = [];
    const extraction: ClaimExtractionService = {
      async extract(chunk) {
        chunks.push(chunk);
        return {
          classification: "verifiable_fact",
          originalText: chunk.text,
          requiresMoreContext: false,
          claims: [{ normalizedClaim: chunk.text, context: chunk.text, priority: 80 }],
        };
      },
    };
    const verification: VerificationService = {
      async verify(_claim, _settings, update) {
        update({ type: "result", result });
      },
    };
    const engine = createEngine({ transcription, extraction, verification });
    engine.start();
    await vi.waitFor(() => expect(transcription.handler).toBeTypeOf("function"));

    transcription.handler!({
      type: "final",
      segment: {
        id: "punctuated",
        startMs: 0,
        endMs: 2_000,
        text: "Nvidia reached a four trillion dollar valuation.",
        interim: false,
      },
    });

    await vi.waitFor(() => expect(engine.session.claims).toHaveLength(1));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.forced).toBe(true);
    engine.dispose();
  });

  it("does not enqueue raw-chunk as claim when extraction returns no atoms", async () => {
    const transcription = new ControlledTranscription();
    const extraction: ClaimExtractionService = {
      async extract(chunk) {
        return {
          classification: "verifiable_fact",
          originalText: chunk.text,
          requiresMoreContext: false,
          claims: [],
        };
      },
    };
    const verification: VerificationService = {
      async verify(_claim, _settings, update) {
        update({ type: "result", result });
      },
    };
    const engine = createEngine({ transcription, extraction, verification });
    engine.start();
    await vi.waitFor(() => expect(transcription.handler).toBeTypeOf("function"));

    transcription.handler!({
      type: "final",
      segment: {
        id: "fact-without-atoms",
        startMs: 0,
        endMs: 2_000,
        text: "The law reduced prescription costs by forty percent.",
        interim: false,
      },
    });

    await vi.waitFor(() =>
      expect(engine.session.segments[0]?.classification).toBe("verifiable_fact"),
    );
    expect(engine.session.claims).toHaveLength(0);
    engine.dispose();
  });

  it("preserves phased upload progress until claims and verdicts finish", async () => {
    const transcription = new ControlledTranscription();
    const extraction: ClaimExtractionService = {
      async extract(chunk) {
        return {
          classification: "verifiable_fact",
          originalText: chunk.text,
          requiresMoreContext: false,
          claims: [{ normalizedClaim: chunk.text, context: chunk.text, priority: 80 }],
        };
      },
    };
    const verification: VerificationService = {
      async verify(_claim, _settings, update) {
        update({ type: "stage", state: "RESEARCHING" });
        update({ type: "result", result });
      },
    };
    const engine = createEngine({
      transcription,
      extraction,
      verification,
      source: "audio_upload",
    });
    engine.start();
    await vi.waitFor(() => expect(transcription.handler).toBeTypeOf("function"));
    transcription.handler!({
      type: "progress",
      stage: "transcribing",
      message: "Transcribing recording",
      detail: "12s elapsed",
      percent: 45,
    });
    expect(engine.session.progress).toEqual(
      expect.objectContaining({ stage: "transcribing", percent: 45 }),
    );
    transcription.handler!({
      type: "final",
      segment: { id: "upload", startMs: 0, endMs: 1_000, text: "A factual claim.", interim: false },
    });
    await engine.finish();
    await vi.waitFor(() => expect(engine.session.status).toBe("completed"));
    expect(engine.session.progress).toEqual(
      expect.objectContaining({ stage: "completed", percent: 100 }),
    );
  });

  it("respects verification concurrency while draining the queue", async () => {
    const transcription = new ControlledTranscription();
    const extraction: ClaimExtractionService = {
      async extract(chunk) {
        return {
          classification: "verifiable_fact",
          originalText: chunk.text,
          requiresMoreContext: false,
          claims: [1, 2, 3].map((number) => ({
            normalizedClaim: `Atomic claim ${number}`,
            context: chunk.text,
            priority: number,
          })),
        };
      },
    };
    let running = 0;
    let maximum = 0;
    const verification: VerificationService = {
      async verify(_claim, _settings, update) {
        running += 1;
        maximum = Math.max(maximum, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        update({ type: "result", result });
        running -= 1;
      },
    };
    const engine = createEngine({ transcription, extraction, verification });
    engine.start();
    await vi.waitFor(() => expect(transcription.handler).toBeTypeOf("function"));
    transcription.handler!({
      type: "final",
      segment: { id: "a", startMs: 0, endMs: 500, text: "Three claims.", interim: false },
    });
    await engine.finish();
    await vi.waitFor(() => expect(engine.session.status).toBe("completed"));
    expect(maximum).toBe(2);
    expect(engine.session.claims).toHaveLength(3);
  });

  it("attaches ClaimFrame, calculates utteranceAt, and flags low ASR confidence quantities (T10, T11, T12)", async () => {
    const transcription = new ControlledTranscription();
    const extraction: ClaimExtractionService = {
      async extract(chunk) {
        return {
          classification: "verifiable_fact",
          originalText: chunk.text,
          requiresMoreContext: false,
          claims: [
            {
              normalizedClaim: "Acme Corp reported 18 billion in Q3.",
              context: chunk.text,
              priority: 85,
              frame: {
                version: 2,
                subject: "Acme Corp",
                claimType: "quantity",
                quantities: [
                  { raw: "18 billion", value: 18_000_000_000, unit: "USD", comparator: "exact" },
                ],
                temporal: {
                  expression: "Q3",
                  resolvedStart: "2026-07-01",
                  resolvedEnd: "2026-09-30",
                  anchorSource: "utterance_time",
                  currentness: "historical",
                },
                scope: null,
                condition: null,
                modality: "asserted",
                unresolvedReferent: false,
                selfRepairApplied: false,
              },
            },
          ],
        };
      },
    };
    const verification: VerificationService = {
      async verify(_claim, _settings, update) {
        update({ type: "result", result });
      },
    };
    const engine = createEngine({ transcription, extraction, verification });
    engine.start();
    await vi.waitFor(() => expect(transcription.handler).toBeTypeOf("function"));

    transcription.handler!({
      type: "final",
      segment: {
        id: "asr-seg-1",
        startMs: 1500,
        endMs: 3500,
        text: "Acme Corp reported 18 billion in Q3.",
        interim: false,
        tokens: [
          { text: "Acme", confidence: 0.95, startMs: 1500, endMs: 1800 },
          { text: "Corp", confidence: 0.92, startMs: 1800, endMs: 2100 },
          { text: "reported", confidence: 0.90, startMs: 2100, endMs: 2400 },
          { text: "18", confidence: 0.52, startMs: 2400, endMs: 2700 }, // < 0.6 threshold!
          { text: "billion", confidence: 0.88, startMs: 2700, endMs: 3000 },
          { text: "in", confidence: 0.98, startMs: 3000, endMs: 3200 },
          { text: "Q3", confidence: 0.94, startMs: 3200, endMs: 3500 },
        ],
      },
    });

    await vi.waitFor(() => expect(engine.session.claims).toHaveLength(1));
    const claim = engine.session.claims[0]!;
    expect(claim.utteranceAt).toBeDefined();
    expect(claim.frame).toBeDefined();
    expect(claim.frame?.subject).toBe("Acme Corp");
    expect(claim.frame?.quantities[0]?.asrLowConfidence).toBe(true);
    expect(claim.asrFlags?.lowConfidenceTokens).toContain("18");
    engine.dispose();
  });

  it("T33: flushes on final events when interval elapsed even without timer firing (throttling resilience)", async () => {
    const transcription = new ControlledTranscription();
    const extractMock = vi.fn().mockResolvedValue({
      classification: "verifiable_fact" as const,
      originalText: "statement without punctuation",
      claims: [
        {
          normalizedClaim: "Statement without punctuation",
          context: "",
          priority: 70,
        },
      ],
      requiresMoreContext: false,
    });

    const extraction: ClaimExtractionService = { extract: extractMock };
    const verification: VerificationService = {
      async verify(_claim, _settings, onUpdate) {
        onUpdate({ type: "stage", state: "COMPLETED" });
        onUpdate({ type: "result", result });
      },
    };

    const engine = createEngine({ transcription, extraction, verification });
    engine.start();
    await vi.waitFor(() => expect(transcription.handler).toBeTypeOf("function"));

    // Emit a segment without punctuation - interval not yet elapsed
    transcription.handler!({
      type: "final",
      segment: {
        id: "seg-no-punct-1",
        startMs: 0,
        endMs: 1000,
        text: "statement without punctuation",
        interim: false,
      },
    });

    expect(extractMock).not.toHaveBeenCalled();

    // Advance system time past fast interval (6 seconds = 6000ms) without triggering setInterval
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7_000);

    // Next final event arrives without punctuation
    transcription.handler!({
      type: "final",
      segment: {
        id: "seg-no-punct-2",
        startMs: 7000,
        endMs: 8000,
        text: "second statement still no punctuation",
        interim: false,
      },
    });

    // Event-driven elapsed check must trigger flush!
    await vi.waitFor(() => expect(extractMock).toHaveBeenCalled());
    dateSpy.mockRestore();
    engine.dispose();
  });
});

