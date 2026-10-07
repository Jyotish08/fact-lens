import { describe, expect, it } from "vitest";
import type { RetrieveTranscriptResponse } from "@speechmatics/batch-client";
import type { AddTranscript } from "@speechmatics/real-time-client";
import { parseSearchHits } from "./bright-data-parser";
import { settingsSchema, transcriptChunkSchema } from "./schemas";
import { mapBatchTranscript, mapRealtimeTranscript } from "./speechmatics-mapping";

describe("provider boundary contracts", () => {
  it("maps Speechmatics partial/final metadata to stable offset transcript IDs", () => {
    const message = {
      message: "AddTranscript",
      metadata: { start_time: 1.25, end_time: 2.5, transcript: "Exact wording." },
      results: [],
    } satisfies AddTranscript;
    expect(mapRealtimeTranscript(message, false, 5_000)).toEqual({
      id: "sm-6250",
      startMs: 6_250,
      endMs: 7_500,
      text: "Exact wording.",
      interim: false,
      tokens: [],
    });
  });

  it("groups Speechmatics Batch words at sentence punctuation", () => {
    const transcript = {
      results: [
        {
          start_time: 0,
          end_time: 0.4,
          type: "word",
          alternatives: [{ content: "Revenue", confidence: 1, language: "en" }],
        },
        {
          start_time: 0.4,
          end_time: 0.8,
          type: "word",
          alternatives: [{ content: "rose", confidence: 1, language: "en" }],
        },
        {
          start_time: 0.8,
          end_time: 0.9,
          type: "punctuation",
          alternatives: [{ content: ".", confidence: 1, language: "en" }],
        },
      ],
    } as RetrieveTranscriptResponse;
    expect(mapBatchTranscript(transcript)).toEqual([
      {
        id: "batch-0",
        startMs: 0,
        endMs: 900,
        text: "Revenue rose.",
        interim: false,
        tokens: [
          { text: "Revenue", confidence: 1, startMs: 0, endMs: 400 },
          { text: "rose", confidence: 1, startMs: 400, endMs: 800 },
        ],
      },
    ]);
  });

  it("parses Bright Data JSON and Markdown results while rejecting private URLs", () => {
    const json = JSON.stringify({
      organic: [
        { title: "Public", link: "https://example.com/report?utm_source=test", snippet: "Result" },
        { title: "Unsafe", link: "http://127.0.0.1/admin" },
      ],
    });
    expect(parseSearchHits(json)).toEqual([
      { title: "Public", url: "https://example.com/report", snippet: "Result" },
    ]);
    expect(parseSearchHits("[Primary source](https://example.gov/data)")[0]?.url).toBe(
      "https://example.gov/data",
    );
  });

  it("rejects out-of-bounds requests before partner calls", () => {
    expect(() =>
      settingsSchema.parse({
        mode: "general",
        depth: "quick",
        intervalPreset: "fast",
        sourceCount: 9,
        concurrency: 1,
      }),
    ).toThrow();
    expect(() =>
      transcriptChunkSchema.parse({
        id: "chunk",
        sessionId: "session",
        sourceSegmentIds: [],
        startMs: 0,
        endMs: 1,
        text: "text",
        intervalWindows: 1,
        forced: false,
      }),
    ).toThrow();
  });
});
