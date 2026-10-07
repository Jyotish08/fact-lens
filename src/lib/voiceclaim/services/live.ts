import { BatchClient } from "@speechmatics/batch-client";
import { PCMRecorder } from "@speechmatics/browser-audio-input";
import workletUrl from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";
import {
  RealtimeClient,
  type AddPartialTranscript,
  type AddTranscript,
} from "@speechmatics/real-time-client";
import { extractClaims, issueSpeechmaticsToken, verifyClaimStream } from "../functions";
import type {
  AtomicClaim,
  SessionSettings,
  SessionSource,
  TranscriptChunk,
  TranscriptSegment,
  ConversationContextSnapshot,
} from "../types";
import { mapBatchTranscript, mapRealtimeTranscript } from "../speechmatics-mapping";
import type {
  ClaimExtractionService,
  ExtractionOutput,
  TranscriptEvent,
  TranscriptionService,
  VerificationService,
} from "./types";

interface LiveServiceOptions {
  sessionId: string;
  sessionToken: string;
  source: SessionSource;
  mediaFile?: File | undefined;
  getCustomContext: (claim: string) => Promise<string>;
}

export class LiveTranscriptionService implements TranscriptionService {
  private handler?: (event: TranscriptEvent) => void;
  private realtime?: RealtimeClient | undefined;
  private recorder?: PCMRecorder | undefined;
  private audioContext?: AudioContext | undefined;
  private stopping = false;
  private startedAt = 0;
  private connectionOffsetMs = 0;
  private lastFinalEndMs = 0;
  private reconnectAttempt = 0;
  private pendingFinal: TranscriptSegment | undefined;
  private finalFlushTimer: ReturnType<typeof setTimeout> | undefined;
  private recentFinalText = "";
  private recentFinalEndMs = 0;

  constructor(private readonly options: LiveServiceOptions) {}

  async start(handler: (event: TranscriptEvent) => void) {
    this.handler = handler;
    this.stopping = false;
    this.startedAt = Date.now();
    if (this.options.source === "microphone") await this.startRealtime();
    else await this.startBatch();
  }

  private async startRealtime() {
    this.connectionOffsetMs = Date.now() - this.startedAt;
    try {
      const auth = await issueSpeechmaticsToken({
        data: {
          sessionId: this.options.sessionId,
          type: "rt",
          sessionToken: this.options.sessionToken,
        },
      });
      const realtime = new RealtimeClient({
        url: auth.endpoint,
        appId: "voiceclaim-auditor",
        connectionTimeout: 10_000,
      });
      this.realtime = realtime;
      realtime.addEventListener("receiveMessage", (event) => {
        const message = event.data;
        if (message.message === "AddPartialTranscript" || message.message === "AddTranscript") {
          this.emitTranscript(message, message.message === "AddPartialTranscript");
        }
        if (message.message === "EndOfTranscript" && this.stopping) {
          this.flushPendingFinal();
          this.handler?.({ type: "end" });
        }
      });
      realtime.addEventListener("socketStateChange", (event) => {
        if (event.socketState === "open") {
          this.reconnectAttempt = 0;
          this.handler?.({ type: "connection", status: "connected" });
        }
        if (event.socketState === "closed" && !this.stopping) void this.reconnect();
      });

      this.audioContext ??= new AudioContext();
      await realtime.start(auth.token, {
        audio_format: {
          type: "raw",
          encoding: "pcm_f32le",
          sample_rate: this.audioContext.sampleRate,
        },
        transcription_config: {
          language: "en",
          model: "enhanced",
          enable_partials: true,
          enable_entities: true,
          max_delay: 2,
          max_delay_mode: "flexible",
          conversation_config: { end_of_utterance_silence_trigger: 2 },
        },
      });
      const recorder = new PCMRecorder(workletUrl);
      this.recorder = recorder;
      recorder.addEventListener("audio", (event) => realtime.sendAudio(event.data));
      await recorder.startRecording({ audioContext: this.audioContext });
    } catch (error) {
      this.recorder?.stopRecording();
      if (this.audioContext && this.audioContext.state !== "closed") {
        await this.audioContext.close().catch(() => undefined);
      }
      this.audioContext = undefined;
      this.recorder = undefined;
      this.realtime = undefined;
      throw error;
    }
  }

  private emitTranscript(message: AddPartialTranscript | AddTranscript, interim: boolean) {
    const segment = mapRealtimeTranscript(message, interim, this.connectionOffsetMs);
    if (interim) {
      this.handler?.({ type: "interim", segment });
      return;
    }
    const unseen = this.removeFinalOverlap(segment);
    if (unseen) this.queueFinalSegment(unseen);
  }

  /**
   * Realtime final messages can be rolling windows rather than disjoint spans.
   * Keep only words not already committed from the immediately preceding window.
   */
  private removeFinalOverlap(segment: TranscriptSegment) {
    const canOverlap = this.recentFinalText && segment.startMs <= this.recentFinalEndMs + 1_500;
    const overlapLen = canOverlap ? getOverlapLength(this.recentFinalText, segment.text) : 0;
    const nextWords = segment.text.trim().split(/\s+/).filter(Boolean);
    const text = overlapLen > 0 ? nextWords.slice(overlapLen).join(" ") : segment.text;
    const tokens = segment.tokens && overlapLen > 0 ? segment.tokens.slice(overlapLen) : segment.tokens;
    this.recentFinalText = appendRecentText(this.recentFinalText, text);
    this.recentFinalEndMs = Math.max(this.recentFinalEndMs, segment.endMs);
    if (!text) return undefined;
    return {
      ...segment,
      startMs: canOverlap ? Math.max(segment.startMs, this.lastFinalEndMs) : segment.startMs,
      text,
      tokens,
    };
  }

  /**
   * Speechmatics may finalize a continuous utterance in very small pieces. Rendering
   * those pieces verbatim produces one transcript row per word, so we coalesce
   * adjacent final fragments until punctuation, a short pause, or a readable span.
   */
  private queueFinalSegment(segment: TranscriptSegment) {
    const pending = this.pendingFinal;
    const isAdjacent =
      pending && segment.startMs <= pending.endMs + 1_500 && segment.endMs >= pending.startMs - 500;

    if (!pending || !isAdjacent) {
      this.flushPendingFinal();
      this.pendingFinal = segment;
    } else {
      const text = `${pending.text} ${segment.text}`.replace(/\s+([.,!?;:])/g, "$1").trim();
      const tokens =
        pending.tokens && segment.tokens
          ? [...pending.tokens, ...segment.tokens]
          : pending.tokens || segment.tokens;
      this.pendingFinal = {
        ...pending,
        endMs: Math.max(pending.endMs, segment.endMs),
        text,
        tokens,
      };
    }

    const grouped = this.pendingFinal!;
    const endsSentence = /[.!?…][”"')\]]?$/.test(grouped.text);
    const isLongEnough = grouped.endMs - grouped.startMs >= 5_000;
    if (endsSentence || isLongEnough) {
      this.flushPendingFinal();
      return;
    }
    if (this.finalFlushTimer) clearTimeout(this.finalFlushTimer);
    this.finalFlushTimer = setTimeout(() => this.flushPendingFinal(), 1_200);
  }

  private flushPendingFinal() {
    if (this.finalFlushTimer) clearTimeout(this.finalFlushTimer);
    this.finalFlushTimer = undefined;
    const segment = this.pendingFinal;
    this.pendingFinal = undefined;
    if (!segment) return;
    this.lastFinalEndMs = Math.max(this.lastFinalEndMs, segment.endMs);
    this.handler?.({ type: "final", segment });
  }

  private async reconnect() {
    this.flushPendingFinal();
    this.recorder?.stopRecording();
    if (this.reconnectAttempt >= 3) {
      this.handler?.({
        type: "connection",
        status: "closed",
        attempt: this.reconnectAttempt,
        incompleteInterval: {
          startMs: this.lastFinalEndMs,
          endMs: Date.now() - this.startedAt,
        },
      });
      return;
    }
    this.reconnectAttempt += 1;
    this.handler?.({
      type: "connection",
      status: "reconnecting",
      attempt: this.reconnectAttempt,
      incompleteInterval: {
        startMs: this.lastFinalEndMs,
        endMs: Date.now() - this.startedAt,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (this.reconnectAttempt - 1)));
    if (!this.stopping) {
      try {
        await this.startRealtime();
      } catch {
        await this.reconnect();
      }
    }
  }

  private async startBatch() {
    const file = this.options.mediaFile;
    if (!file) throw new Error("UPLOAD_FILE_MISSING");
    this.handler?.({
      type: "progress",
      stage: "uploading",
      message: "Uploading recording",
      detail: "Sending the audio track securely to Speechmatics",
      percent: 12,
    });
    let auth = await this.issueBatchToken();
    const client = new BatchClient({
      apiKey: auth.token,
      // BatchClient itself appends `/v2/jobs`; it requires the API origin, not `/v2`.
      apiUrl: batchApiBaseUrl(auth.endpoint),
      appId: "voiceclaim-auditor",
    });
    let jobId: string | undefined;
    let completed = false;
    try {
      const created = await client.createTranscriptionJob(file, {
        transcription_config: {
          language: "en",
          model: "enhanced",
          enable_entities: true,
        },
        tracking: { reference: this.options.sessionId, title: file.name },
      });
      jobId = created.id;
      this.handler?.({
        type: "progress",
        stage: "transcribing",
        message: "Transcribing recording",
        detail: "Speechmatics accepted the upload and is recognising speech",
        percent: 32,
      });
      const pollingStarted = Date.now();
      while (!this.stopping) {
        if (Date.now() - pollingStarted > 6 * 60_000)
          throw new Error("BATCH_TRANSCRIPTION_TIMEOUT");
        if (Date.now() - pollingStarted > 45_000) {
          auth = await this.issueBatchToken();
          client.apiKey = auth.token;
        }
        const job = await client.getJob(jobId);
        if (job.job.status === "done") break;
        if (job.job.status === "rejected" || job.job.status === "expired") {
          throw new Error(job.job.errors?.[0]?.message ?? "BATCH_TRANSCRIPTION_REJECTED");
        }
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - pollingStarted) / 1_000));
        this.handler?.({
          type: "progress",
          stage: "transcribing",
          message: "Transcribing recording",
          detail: `${elapsedSeconds}s elapsed · waiting for the timestamped transcript`,
          percent: Math.min(76, 32 + Math.round(elapsedSeconds / 3)),
        });
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      if (this.stopping) return;
      this.handler?.({
        type: "progress",
        stage: "processing",
        message: "Processing transcript",
        detail: "Reading timestamps and preparing statements for claim extraction",
        percent: 80,
      });
      const transcript = await client.getJobResult(jobId, "json-v2");
      const segments = mapBatchTranscript(transcript);
      if (!segments.length) throw new Error("BATCH_TRANSCRIPTION_EMPTY");
      for (const segment of segments) this.handler?.({ type: "final", segment });
      completed = true;
    } finally {
      if (jobId) {
        this.handler?.({
          type: "progress",
          stage: "cleaning_up",
          message: "Securing the session",
          detail: "Removing the temporary Speechmatics job",
          percent: 86,
        });
        await client.deleteJob(jobId, true).catch(() => undefined);
      }
      // A failed batch request must not look like a successfully completed empty session.
      if (completed || this.stopping) this.handler?.({ type: "end" });
    }
  }

  private issueBatchToken() {
    return issueSpeechmaticsToken({
      data: {
        sessionId: this.options.sessionId,
        type: "batch",
        sessionToken: this.options.sessionToken,
      },
    });
  }

  async stop() {
    this.stopping = true;
    if (this.finalFlushTimer) {
      clearTimeout(this.finalFlushTimer);
      this.finalFlushTimer = undefined;
    }
    this.flushPendingFinal();
    this.recorder?.stopRecording();
    if (this.realtime?.socketState === "open")
      await this.realtime.stopRecognition().catch(() => undefined);
    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close().catch(() => undefined);
    }
    this.audioContext = undefined;
    this.recorder = undefined;
    this.realtime = undefined;
  }
}

function wordKey(word: string) {
  return word.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}'-]/gu, "");
}

function getOverlapLength(previous: string, next: string): number {
  const previousWords = previous.trim().split(/\s+/).filter(Boolean);
  const nextWords = next.trim().split(/\s+/).filter(Boolean);
  const maximum = Math.min(previousWords.length, nextWords.length);
  for (let length = maximum; length > 0; length -= 1) {
    const previousTail = previousWords.slice(-length).map(wordKey);
    const nextHead = nextWords.slice(0, length).map(wordKey);
    if (previousTail.every((word, index) => word && word === nextHead[index])) {
      return length;
    }
  }
  return 0;
}

function removeTextOverlap(previous: string, next: string) {
  const overlap = getOverlapLength(previous, next);
  if (overlap > 0) {
    const nextWords = next.trim().split(/\s+/).filter(Boolean);
    return nextWords.slice(overlap).join(" ");
  }
  return next.trim();
}

function appendRecentText(previous: string, next: string) {
  const words = `${previous} ${next}`.trim().split(/\s+/).filter(Boolean);
  return words.slice(-160).join(" ");
}

function batchApiBaseUrl(endpoint: string) {
  return endpoint.replace(/\/v2\/?$/, "");
}

export class LiveClaimExtractionService implements ClaimExtractionService {
  constructor(private readonly sessionToken: string) {}

  extract(
    chunk: TranscriptChunk,
    settings: SessionSettings,
    context?: {
      previousTail?: string | undefined;
      sessionTitle?: string | undefined;
      anchorDate?: string | undefined;
      contextSnapshot?: ConversationContextSnapshot | undefined;
    },
  ): Promise<ExtractionOutput> {
    return extractClaims({
      data: {
        chunk,
        settings,
        sessionToken: this.sessionToken,
        previousTail: context?.previousTail,
        sessionTitle: context?.sessionTitle,
        anchorDate: context?.anchorDate,
        contextSnapshot: context?.contextSnapshot,
      },
    });
  }
}

export class LiveVerificationService implements VerificationService {
  constructor(private readonly options: LiveServiceOptions) {}

  async verify(
    claim: AtomicClaim,
    settings: SessionSettings,
    onUpdate: Parameters<VerificationService["verify"]>[2],
    signal: AbortSignal,
  ) {
    const customContext = await this.options.getCustomContext(claim.normalizedClaim);
    for await (const update of await verifyClaimStream({
      data: {
        claim,
        settings,
        customContext,
        sessionToken: this.options.sessionToken,
      },
      signal,
    })) {
      onUpdate(update);
    }
  }
}
