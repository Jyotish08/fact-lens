import type { RetrieveTranscriptResponse } from "@speechmatics/batch-client";
import type { AddPartialTranscript, AddTranscript } from "@speechmatics/real-time-client";
import type { TranscriptSegment } from "./types";

export function mapRealtimeTranscript(
  message: AddPartialTranscript | AddTranscript,
  interim: boolean,
  connectionOffsetMs = 0,
): TranscriptSegment {
  const startMs = connectionOffsetMs + Math.round(message.metadata.start_time * 1_000);
  const endMs = connectionOffsetMs + Math.round(message.metadata.end_time * 1_000);

  const tokens =
    !interim && "results" in message && Array.isArray(message.results)
      ? message.results
          .filter((r) => r.type === "word" && r.alternatives?.[0])
          .map((r) => ({
            text: r.alternatives![0]!.content,
            confidence: Number((r.alternatives![0]!.confidence ?? 1.0).toFixed(3)),
            startMs: connectionOffsetMs + Math.round(r.start_time * 1_000),
            endMs: connectionOffsetMs + Math.round(r.end_time * 1_000),
          }))
      : undefined;

  return {
    id: `sm-${startMs}`,
    startMs,
    endMs,
    text: message.metadata.transcript,
    interim,
    tokens,
  };
}

export function mapBatchTranscript(transcript: RetrieveTranscriptResponse): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let words: typeof transcript.results = [];
  const flush = () => {
    if (!words.length) return;
    const first = words[0]!;
    const last = words.at(-1)!;
    const text = words
      .map((result) => result.alternatives?.[0]?.content ?? "")
      .join(" ")
      .replace(/\s+([.,!?;:])/g, "$1")
      .trim();
    if (text) {
      const startMs = Math.round(first.start_time * 1_000);
      const tokens = words
        .filter((r) => r.type === "word" && r.alternatives?.[0])
        .map((r) => ({
          text: r.alternatives![0]!.content,
          confidence: Number((r.alternatives![0]!.confidence ?? 1.0).toFixed(3)),
          startMs: Math.round(r.start_time * 1_000),
          endMs: Math.round(r.end_time * 1_000),
        }));
      segments.push({
        id: `batch-${startMs}`,
        startMs,
        endMs: Math.round(last.end_time * 1_000),
        text,
        interim: false,
        tokens,
      });
    }
    words = [];
  };
  for (const result of transcript.results) {
    words.push(result);
    const content = result.alternatives?.[0]?.content ?? "";
    if (/[.!?]$/.test(content) || result.end_time - words[0]!.start_time >= 12) flush();
  }
  flush();
  return segments;
}
