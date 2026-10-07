import type { Scenario } from "../data/scenarios";
import { createServices } from "../services";
import type { VoiceClaimServices } from "../services/types";
import { RollingConversationMemory } from "./conversation-memory";
import { linkClaim } from "./claim-linker";
import {
  INTERVAL_SECONDS,
  isTerminal,
  type AtomicClaim,
  type CustomSource,
  type Session,
  type SessionSettings,
  type SessionSource,
  type SessionProgressStage,
  type SessionStatus,
  type TranscriptChunk,
  type TranscriptSegment,
} from "../types";

export interface EngineOptions {
  sessionId: string;
  title: string;
  source: SessionSource;
  scenario: Scenario;
  settings: SessionSettings;
  serviceMode: "live" | "mock";
  sessionToken: string;
  mediaFile?: File | undefined;
  customFiles?: File[] | undefined;
  customSources?: CustomSource[] | undefined;
  services?: VoiceClaimServices | undefined;
  speed?: number | undefined;
}

/** Owns hybrid chunking, extraction, prioritization, draining, and verification concurrency. */
export class SessionEngine {
  private services: VoiceClaimServices;
  private listeners = new Set<(session: Session) => void>();
  private pending: TranscriptSegment[] = [];
  private pendingWindows = 0;
  private queue: AtomicClaim[] = [];
  private running = new Map<string, AbortController>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private startedAtMs = 0;
  private claimCounter = 0;
  private extractionInFlight = 0;
  private finishRequested = false;
  private disposed = false;
  private completed = false;
  private lastFlushAtMs = 0;
  private visibilityHandler?: (() => void) | undefined;
  private readonly conversationMemory = new RollingConversationMemory();

  session: Session;

  constructor(private readonly options: EngineOptions) {
    this.services =
      options.services ??
      createServices({
        scenario: options.scenario,
        speed: options.speed,
        serviceMode: options.serviceMode,
        sessionId: options.sessionId,
        sessionToken: options.sessionToken,
        source: options.source,
        mediaFile: options.mediaFile,
      });
    this.session = {
      id: options.sessionId,
      title: options.title,
      source: options.source,
      settings: options.settings,
      customSources: options.customSources ?? [],
      startedAt: new Date().toISOString(),
      status: "idle",
      durationMs: 0,
      segments: [],
      claims: [],
    };
  }

  subscribe(listener: (session: Session) => void) {
    this.listeners.add(listener);
    listener(this.session);
    return () => this.listeners.delete(listener);
  }

  private emit(patch: Partial<Session> = {}) {
    if (this.disposed) return;
    this.session = { ...this.session, ...patch };
    this.listeners.forEach((listener) => listener(this.session));
  }

  private setStatus(status: SessionStatus) {
    this.emit({ status });
  }

  private setProgress(
    stage: SessionProgressStage,
    label: string,
    detail: string,
    percent?: number,
  ) {
    let nextPercent = percent;
    if (
      this.options.source !== "microphone" &&
      typeof percent === "number" &&
      typeof this.session.progress?.percent === "number"
    ) {
      nextPercent = Math.max(percent, this.session.progress.percent);
    }
    this.emit({ progress: { stage, label, detail, percent: nextPercent } });
  }

  start() {
    if (this.session.status !== "idle") return;
    this.startedAtMs = Date.now();
    this.lastFlushAtMs = this.startedAtMs;
    this.setStatus("listening");
    this.setProgress(
      "connecting",
      this.options.source === "microphone" ? "Connecting microphone" : "Preparing recording",
      this.options.source === "microphone"
        ? "Requesting a secure live transcription connection"
        : "Loading the selected file and creating a secure transcription job",
      this.options.source === "microphone" ? undefined : 4,
    );
    this.clockTimer = setInterval(() => {
      this.emit({ durationMs: Date.now() - this.startedAtMs });
    }, 500);
    const intervalMs = INTERVAL_SECONDS[this.session.settings.intervalPreset] * 1_000;
    this.flushTimer = setInterval(() => this.scheduleFlush(false), intervalMs);

    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "visible") {
          const currentIntervalMs = INTERVAL_SECONDS[this.session.settings.intervalPreset] * 1_000;
          if (this.pending.length > 0 && Date.now() - this.lastFlushAtMs >= currentIntervalMs) {
            this.scheduleFlush(false, false);
          }
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    void this.startInput();
  }

  private async startInput() {
    try {
      if (this.options.customFiles?.length) {
        await this.services.corpus.register(this.options.customFiles);
      }
      await this.services.transcription.start((event) => {
        switch (event.type) {
          case "connection":
            if (event.status === "reconnecting") this.setStatus("reconnecting");
            if (event.status === "connected" && this.session.status === "reconnecting") {
              this.setStatus("listening");
            }
            if (event.status === "connected") {
              this.setProgress(
                "transcribing",
                "Listening live",
                "Speech is being transcribed; complete statements are sent for verification",
              );
            }
            if (event.status === "reconnecting") {
              this.setProgress(
                "connecting",
                `Reconnecting · attempt ${event.attempt ?? 1}`,
                "The affected audio interval may be incomplete",
              );
            }
            if (event.status === "closed" && !this.finishRequested) this.setStatus("error");
            break;
          case "progress":
            this.setProgress(
              event.stage === "uploading"
                ? "uploading"
                : event.stage === "cleaning_up"
                  ? "finalizing"
                  : "transcribing",
              event.message,
              event.detail ?? event.message,
              event.percent,
            );
            break;
          case "interim":
            this.upsertSegment(event.segment);
            break;
          case "final":
            this.upsertSegment(event.segment);
            this.pending.push(event.segment);
            {
              const intervalMs = INTERVAL_SECONDS[this.session.settings.intervalPreset] * 1_000;
              const isDue = Date.now() - this.lastFlushAtMs >= intervalMs;
              const isSemantic = /[.!?]\s*$/.test(event.segment.text);
              if (isSemantic || isDue) {
                this.scheduleFlush(false, isSemantic);
              }
            }
            break;
          case "end":
            void this.finish();
            break;
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Input processing failed";
      this.setProgress(
        "error",
        "Input processing failed",
        humanizeInputError(message),
        this.session.progress?.percent,
      );
      this.setStatus("error");
    }
  }

  private upsertSegment(segment: TranscriptSegment) {
    // Partials are a rolling preview, not durable transcript records. Keep only
    // the newest preview and discard it as soon as a final segment arrives.
    const segments = this.session.segments.filter((item) => !item.interim);
    const index = segments.findIndex((item) => item.id === segment.id);
    if (index >= 0) segments[index] = { ...segments[index], ...segment };
    else segments.push(segment);
    this.emit({ segments });
    if (!segment.interim) this.conversationMemory.addSegment(segment);
  }

  private scheduleFlush(force: boolean, semantic = false) {
    this.flushChain = this.flushChain
      .then(() => this.flush(force, semantic))
      .catch(() => undefined);
  }

  private async flush(force: boolean, semantic = false) {
    this.lastFlushAtMs = Date.now();
    if (!this.pending.length) {
      this.maybeComplete();
      return;
    }
    this.pendingWindows = semantic ? this.pendingWindows : this.pendingWindows + 1;
    const segments = this.pending;
    this.pending = [];
    const chunk = this.buildChunk(segments, force || semantic || this.pendingWindows >= 2);
    this.extractionInFlight += 1;
    this.setProgress(
      "extracting",
      "Detecting factual claims",
      `Classifying ${segments.length} transcript statement${segments.length === 1 ? "" : "s"} and splitting compound claims`,
      this.options.source === "microphone" ? undefined : 89,
    );
    try {
      const previousSegments = this.session.segments.filter(
        (s) => !segments.some((seg) => seg.id === s.id),
      );
      const previousTail =
        previousSegments
          .map((s) => s.text)
          .join(" ")
          .slice(-600) || undefined;
      const anchorDate =
        this.session.settings.recordingDate || this.session.startedAt.slice(0, 10);

      const output = await this.services.extraction.extract(chunk, this.session.settings, {
        previousTail,
        sessionTitle: this.session.title,
        anchorDate,
        contextSnapshot: this.conversationMemory.getSnapshot(),
      });
      segments.forEach((segment) =>
        this.upsertSegment({ ...segment, classification: output.classification }),
      );
      if (output.requiresMoreContext && !chunk.forced) {
        this.pending = [...segments, ...this.pending];
        return;
      }
      this.pendingWindows = 0;
      if (output.claims.length === 0 && output.classification === "verifiable_fact") {
        console.info(JSON.stringify({ event: "extraction_empty_fact", count: 1, chunkId: chunk.id }));
      }
      const extractedClaims = output.claims;
      if (!extractedClaims.length) {
        this.setProgress(
          "transcribing",
          this.finishRequested ? "No additional factual claims" : "Listening for factual claims",
          "The latest statement was classified as context, opinion, or prediction",
          this.options.source === "microphone" ? undefined : 91,
        );
        return;
      }
      const claims = extractedClaims.map((extracted, index) =>
        this.buildClaim(
          chunk,
          index,
          extracted.normalizedClaim,
          extracted.context,
          extracted.priority,
          false,
          extracted.frame,
          extracted.antecedentSegmentIds,
          extracted.resolution,
          extracted.discourseRelation,
        ),
      );
      const accepted: AtomicClaim[] = [];
      for (const claim of claims) {
        const link = linkClaim(claim, [...this.session.claims, ...accepted]);
        const linked = { ...claim, discourseRelation: link.relation, parentClaimId: link.parentClaimId };
        if (link.relation !== "duplicate") {
          accepted.push(linked);
          this.conversationMemory.recordClaim(linked);
        }
      }
      this.emit({ claims: [...this.session.claims, ...accepted] });
      accepted.forEach((claim) => this.enqueue(claim));
    } catch (error) {
      if (!force && !semantic) this.pending = [...segments, ...this.pending];
      const message = error instanceof Error ? error.message : "Claim extraction failed";
      console.error("[voiceclaim:extraction] failed", {
        code: message.replace(/[^A-Z0-9_]/gi, "_").slice(0, 80),
        segmentCount: segments.length,
        forced: chunk.forced,
      });
      if (force || semantic) {
        this.setProgress(
          "error",
          "Claim extraction failed",
          "The transcript is safe, but its factual claims could not be prepared for evidence research. Please retry this session.",
          this.session.progress?.percent,
        );
      }
    } finally {
      this.extractionInFlight -= 1;
      this.maybeComplete();
    }
  }

  private buildChunk(segments: TranscriptSegment[], forced: boolean): TranscriptChunk {
    const ordered = [...segments].sort((a, b) => a.startMs - b.startMs);
    return {
      id: `chunk-${ordered[0]!.id}-${ordered.at(-1)!.id}`,
      sessionId: this.session.id,
      sourceSegmentIds: ordered.map((segment) => segment.id),
      startMs: ordered[0]!.startMs,
      endMs: ordered.at(-1)!.endMs,
      text: ordered.map((segment) => segment.text).join(" "),
      intervalWindows: Math.max(1, this.pendingWindows),
      forced,
    };
  }

  private buildClaim(
    chunk: TranscriptChunk,
    index: number,
    normalizedClaim: string,
    context: string,
    priority: number,
    manual: boolean,
    frame?: import("../types").ClaimFrame | undefined,
    antecedentSegmentIds?: string[],
    resolution?: import("../types").ContextualResolution,
    discourseRelation?: import("../types").DiscourseRelation,
  ): AtomicClaim {
    this.claimCounter += 1;
    const startedMs = new Date(this.session.startedAt).getTime();
    const utteranceAt = !isNaN(startedMs)
      ? new Date(startedMs + chunk.startMs).toISOString()
      : undefined;

    // Check ASR token confidence for quantities (T12)
    const matchingSegments = this.session.segments.filter((s) =>
      chunk.sourceSegmentIds.includes(s.id),
    );
    const allTokens = matchingSegments.flatMap((s) => s.tokens || []);
    const lowConfidenceTokens: string[] = [];

    if (frame && frame.quantities.length > 0 && allTokens.length > 0) {
      for (const q of frame.quantities) {
        const numParts = q.raw.match(/\b(?:\d+(?:\.\d+)?|[a-zA-Z]+)\b/g) || [];
        for (const part of numParts) {
          const matchingTokens = allTokens.filter(
            (t) => t.text.toLowerCase() === part.toLowerCase(),
          );
          for (const mt of matchingTokens) {
            if (mt.confidence < 0.6) {
              q.asrLowConfidence = true;
              lowConfidenceTokens.push(mt.text);
            }
          }
        }
      }
    }

    const asrFlags = lowConfidenceTokens.length > 0 ? { lowConfidenceTokens } : undefined;

    return {
      id: `claim-${this.claimCounter}|${chunk.sourceSegmentIds[0]}::${index}`,
      sessionId: this.session.id,
      sourceSegmentIds: chunk.sourceSegmentIds,
      originalText: chunk.text,
      normalizedClaim,
      context,
      timestampMs: chunk.startMs,
      utteranceAt,
      mode: this.session.settings.mode,
      depth: this.session.settings.depth,
      state: "DETECTED",
      priority: manual ? 100 : priority,
      manual,
      evidence: [],
      frame,
      asrFlags,
      antecedentSegmentIds,
      resolution,
      discourseRelation,
    };
  }

  async verifySegmentManually(segmentId: string) {
    const segment = this.session.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    const chunk = this.buildChunk([segment], true);
    const claim = this.buildClaim(chunk, 0, segment.text, segment.text, 100, true);
    this.emit({ claims: [...this.session.claims, claim] });
    this.enqueue(claim);
  }

  retry(claimId: string) {
    const claim = this.session.claims.find((item) => item.id === claimId);
    if (!claim) return;
    const reset: AtomicClaim = { ...claim, state: "DETECTED", evidence: [] };
    delete reset.error;
    delete reset.result;
    this.patchClaim(claimId, reset);
    this.enqueue(reset);
  }

  private enqueue(claim: AtomicClaim) {
    this.patchClaim(claim.id, { state: "QUEUED" });
    this.queue.push(claim);
    this.queue.sort((a, b) => b.priority - a.priority || a.timestampMs - b.timestampMs);
    this.setProgress(
      "researching",
      "Claims queued for evidence research",
      `${this.queue.length + this.running.size} claim${this.queue.length + this.running.size === 1 ? "" : "s"} waiting or in progress`,
      this.options.source === "microphone" ? undefined : 92,
    );
    this.pump();
  }

  private pump() {
    while (this.running.size < this.session.settings.concurrency && this.queue.length) {
      void this.run(this.queue.shift()!);
    }
    this.maybeComplete();
  }

  private async run(claim: AtomicClaim) {
    const controller = new AbortController();
    this.running.set(claim.id, controller);
    try {
      await this.services.verification.verify(
        claim,
        this.session.settings,
        (update) => {
          switch (update.type) {
            case "stage":
              this.patchClaim(claim.id, { state: update.state });
              this.updateVerificationProgress(update.state);
              break;
            case "evidence": {
              const current = this.session.claims.find((item) => item.id === claim.id);
              this.patchClaim(claim.id, {
                evidence: [...(current?.evidence ?? []), ...update.items],
              });
              this.setProgress(
                "challenging",
                "Comparing retrieved evidence",
                `${update.items.length} evidence item${update.items.length === 1 ? "" : "s"} accepted with verified provenance`,
                this.options.source === "microphone" ? undefined : 96,
              );
              break;
            }
            case "result":
              this.patchClaim(claim.id, {
                state:
                  update.result.verdict === "insufficient_evidence"
                    ? "INSUFFICIENT_EVIDENCE"
                    : "COMPLETED",
                result: update.result,
              });
              this.updateVerificationProgress();
              break;
            case "error":
              this.patchClaim(claim.id, { state: "VERIFICATION_ERROR", error: update.message });
              this.updateVerificationProgress();
              break;
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        this.patchClaim(claim.id, {
          state: "VERIFICATION_ERROR",
          error: error instanceof Error ? error.message : "Verification failed",
        });
        this.updateVerificationProgress();
      }
    } finally {
      this.running.delete(claim.id);
      this.pump();
    }
  }

  private patchClaim(id: string, patch: Partial<AtomicClaim>) {
    this.emit({
      claims: this.session.claims.map((claim) =>
        claim.id === id ? { ...claim, ...patch } : claim,
      ),
    });
  }

  private updateVerificationProgress(state?: AtomicClaim["state"]) {
    const total = this.session.claims.length;
    const finished = this.session.claims.filter((claim) => isTerminal(claim.state)).length;
    const remaining = Math.max(0, total - finished);
    const stage =
      state === "CHALLENGING"
        ? "challenging"
        : state === "SYNTHESIZING"
          ? "synthesizing"
          : "researching";
    const label =
      stage === "challenging"
        ? "Checking contradictory evidence"
        : stage === "synthesizing"
          ? "Generating evidence verdict"
          : remaining > 0
            ? "Searching live evidence"
            : "Evidence checks complete";
    const detail =
      total > 0
        ? `${finished} of ${total} claim${total === 1 ? "" : "s"} finished · ${remaining} remaining`
        : "Preparing the verification queue";
    const percent =
      this.options.source === "microphone"
        ? undefined
        : Math.min(99, 92 + Math.round((finished / Math.max(1, total)) * 7));
    this.setProgress(stage, label, detail, percent);
  }

  async finish() {
    if (this.finishRequested) return;
    this.finishRequested = true;
    this.setStatus("processing");
    this.setProgress(
      "finalizing",
      "Finishing the session",
      "Transcription is stopping; pending claims and evidence checks will continue until every verdict is ready",
      this.options.source === "microphone" ? 20 : 87,
    );
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = undefined;
    }
    this.flushTimer = null;
    this.clockTimer = null;
    await this.services.transcription.stop();
    this.scheduleFlush(true);
    await this.flushChain;
    this.maybeComplete();
  }

  private maybeComplete() {
    if (
      !this.finishRequested ||
      this.completed ||
      this.pending.length ||
      this.extractionInFlight ||
      this.queue.length ||
      this.running.size
    ) {
      return;
    }
    this.completed = true;
    const complete = async () => {
      await this.services.corpus.clear();
      this.emit({
        status: "completed",
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - this.startedAtMs,
        progress: {
          stage: "completed",
          label: "Session complete",
          detail: `${this.session.claims.length} atomic claim${this.session.claims.length === 1 ? "" : "s"} processed`,
          percent: 100,
        },
      });
    };
    void complete();
  }

  updateSettings(patch: Partial<SessionSettings>) {
    this.emit({ settings: { ...this.session.settings, ...patch } });
  }

  get activeCount() {
    return this.session.claims.filter((claim) => !isTerminal(claim.state)).length;
  }

  dispose() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = undefined;
    }
    this.running.forEach((controller) => controller.abort());
    this.running.clear();
    this.listeners.clear();
    this.disposed = true;
    void this.services.transcription.stop();
    if (!this.completed) void this.services.corpus.clear();
  }
}

function humanizeInputError(message: string) {
  const labels: Record<string, string> = {
    UPLOAD_FILE_MISSING: "the selected file was unavailable after navigation.",
    BATCH_TRANSCRIPTION_EMPTY: "Speechmatics could not detect speech in this recording.",
    BATCH_TRANSCRIPTION_TIMEOUT: "Speechmatics took too long to transcribe this recording.",
    BATCH_TRANSCRIPTION_REJECTED: "Speechmatics rejected this recording.",
  };
  return labels[message] ?? message.replaceAll("_", " ").toLowerCase();
}
