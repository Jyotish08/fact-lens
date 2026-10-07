import type { Scenario } from "../data/scenarios";
import type { SessionSource } from "../types";
import { IndexedDbEvidenceCorpusService } from "./corpus";
import {
  LiveClaimExtractionService,
  LiveTranscriptionService,
  LiveVerificationService,
} from "./live";
import {
  MockClaimExtractionService,
  MockEvidenceCorpusService,
  MockTranscriptionService,
  MockVerificationService,
  ScenarioRegistry,
} from "./mock";
import type { VoiceClaimServices } from "./types";

export * from "./types";

export interface ServiceOptions {
  scenario: Scenario;
  /** Playback speed multiplier — uploads replay faster than realtime. */
  speed?: number | undefined;
  serviceMode: "live" | "mock";
  sessionId: string;
  sessionToken: string;
  source: SessionSource;
  mediaFile?: File | undefined;
}

/**
 * Single construction point for every backend dependency.
 *
 * Mocking is allowed only through the explicit server-provided service mode.
 */
export function createServices(options: ServiceOptions): VoiceClaimServices {
  if (options.serviceMode === "live") {
    const corpus = new IndexedDbEvidenceCorpusService(options.sessionId, options.sessionToken);
    const liveOptions = {
      sessionId: options.sessionId,
      sessionToken: options.sessionToken,
      source: options.source,
      mediaFile: options.mediaFile,
      getCustomContext: (claim: string) => corpus.contextForClaim(claim),
    };
    return {
      transcription: new LiveTranscriptionService(liveOptions),
      extraction: new LiveClaimExtractionService(options.sessionToken),
      verification: new LiveVerificationService(liveOptions),
      corpus,
    };
  }

  const registry = new ScenarioRegistry(options.scenario);
  return {
    transcription: new MockTranscriptionService(options.scenario, options.speed ?? 1),
    extraction: new MockClaimExtractionService(registry),
    verification: new MockVerificationService(registry),
    corpus: new MockEvidenceCorpusService(),
  };
}
