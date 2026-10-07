import type { Scenario, ScenarioClaimSeed } from "../data/scenarios";
import type { SessionSettings, TranscriptChunk, TranscriptSegment } from "../types";
import type {
  ClaimExtractionService,
  EvidenceCorpusService,
  TranscriptEvent,
  TranscriptionService,
  VerificationService,
} from "./types";

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

/** Shared registry so the extractor and verifier agree on scripted claims. */
export class ScenarioRegistry {
  private seeds = new Map<string, ScenarioClaimSeed>();

  constructor(readonly scenario: Scenario) {}

  key(segmentId: string, index: number) {
    return `${segmentId}::${index}`;
  }

  set(key: string, seed: ScenarioClaimSeed) {
    this.seeds.set(key, seed);
  }

  get(key: string) {
    return this.seeds.get(key);
  }
}

/** Replays a scripted conversation word-by-word, mimicking streaming STT. */
export class MockTranscriptionService implements TranscriptionService {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private stopped = false;
  /** 1 = realtime. Uploads replay faster than realtime. */
  constructor(
    private readonly scenario: Scenario,
    private readonly speed = 1,
  ) {}

  start(handler: (event: TranscriptEvent) => void) {
    handler({ type: "connection", status: "connected" });

    this.scenario.lines.forEach((line, lineIndex) => {
      const words = line.text.split(" ");
      const perWord = Math.max(70, (line.text.length * 42) / words.length) / this.speed;
      const startAt = line.atMs / this.speed;
      const id = `seg-${lineIndex}`;

      words.forEach((_, wordIndex) => {
        const partial = words.slice(0, wordIndex + 1).join(" ");
        this.schedule(startAt + wordIndex * perWord, () => {
          const segment: TranscriptSegment = {
            id,
            startMs: line.atMs,
            endMs: line.atMs + words.length * perWord * this.speed,
            text: partial,
            interim: true,
          };
          handler({ type: "interim", segment });
        });
      });

      this.schedule(startAt + words.length * perWord + 220, () => {
        handler({
          type: "final",
          segment: {
            id,
            startMs: line.atMs,
            endMs: line.atMs + words.length * perWord * this.speed,
            text: line.text,
            interim: false,
            classification: line.classification,
          },
        });
      });
    });

    const last = this.scenario.lines[this.scenario.lines.length - 1]!;
    this.schedule(last.atMs / this.speed + 4200, () => handler({ type: "end" }));
  }

  private schedule(delay: number, fn: () => void) {
    this.timers.push(
      setTimeout(() => {
        if (!this.stopped) fn();
      }, delay),
    );
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}

export class MockClaimExtractionService implements ClaimExtractionService {
  constructor(private readonly registry: ScenarioRegistry) {}

  async extract(chunk: TranscriptChunk, settings: SessionSettings) {
    await wait(400 + Math.random() * 500);
    const segmentId = chunk.sourceSegmentIds[0] ?? "";
    const line = this.registry.scenario.lines.find((_, index) => `seg-${index}` === segmentId);

    if (!line || !line.claims?.length) {
      return {
        classification: "context" as const,
        originalText: chunk.text,
        claims: [],
        requiresMoreContext: false,
      };
    }

    line.claims.forEach((seed, index) =>
      this.registry.set(this.registry.key(segmentId, index), seed),
    );

    // Deep verification surfaces lower-priority assertions too.
    const threshold = settings.depth === "deep" ? 0 : 0.5;

    return {
      classification: line.classification,
      originalText: line.text,
      claims: line.claims
        .filter((seed) => seed.priority >= threshold)
        .map((seed) => ({
          normalizedClaim: seed.normalizedClaim,
          context: line.text,
          priority: seed.priority,
        })),
      requiresMoreContext: false,
    };
  }
}

export class MockVerificationService implements VerificationService {
  constructor(private readonly registry: ScenarioRegistry) {}

  async verify(
    claim: Parameters<VerificationService["verify"]>[0],
    settings: SessionSettings,
    onUpdate: Parameters<VerificationService["verify"]>[2],
    signal: AbortSignal,
  ) {
    const seed = this.registry.get(claim.id.split("|")[1] ?? "");
    const speed = settings.depth === "deep" ? 1.45 : 1;
    const budget = (seed?.researchMs ?? 11000) * speed;

    try {
      onUpdate({ type: "stage", state: "RESEARCHING" });

      const supporting = seed?.evidence.filter((item) => item.relation !== "contradicts") ?? [];
      const contradicting = seed?.evidence.filter((item) => item.relation === "contradicts") ?? [];
      const capped = supporting.slice(0, Math.max(1, settings.sourceCount));

      for (const [index, item] of capped.entries()) {
        await wait(
          budget * 0.45 * ((index + 1) / (capped.length || 1)) -
            budget * 0.45 * (index / (capped.length || 1)) +
            600,
          signal,
        );
        onUpdate({
          type: "evidence",
          items: [
            {
              ...item,
              id: `${claim.id}-ev-${index}`,
              retrievedAt: new Date().toISOString(),
            },
          ],
        });
      }

      if (seed?.infrastructureFailure) {
        await wait(budget * 0.3, signal);
        onUpdate({
          type: "error",
          message:
            "Evidence retrieval failed while contacting the web research service. This is an infrastructure failure, not an evidence result.",
        });
        return;
      }

      onUpdate({ type: "stage", state: "CHALLENGING" });
      for (const [index, item] of contradicting.entries()) {
        await wait(budget * 0.22 + 400, signal);
        onUpdate({
          type: "evidence",
          items: [
            {
              ...item,
              id: `${claim.id}-cx-${index}`,
              retrievedAt: new Date().toISOString(),
            },
          ],
        });
      }
      if (contradicting.length === 0) await wait(budget * 0.24, signal);

      onUpdate({ type: "stage", state: "SYNTHESIZING" });
      await wait(budget * 0.2 + 700, signal);

      if (!seed) {
        onUpdate({
          type: "error",
          message: "No verification pipeline is wired for this claim yet.",
        });
        return;
      }

      onUpdate({
        type: "result",
        result: {
          ...seed.result,
          roundsRun: settings.depth === "deep" ? 2 : 1,
        },
      });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      onUpdate({ type: "error", message: "Verification stage failed." });
    }
  }
}

export class MockEvidenceCorpusService implements EvidenceCorpusService {
  private files: File[] = [];
  async register(files: File[]) {
    await wait(500);
    this.files = [...this.files, ...files];
  }
  async contextForClaim() {
    return "";
  }
  clear() {
    this.files = [];
  }
}
