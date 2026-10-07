import { describe, expect, it } from "vitest";
import { LiveTranscriptionService } from "./live";
import type { TranscriptEvent } from "./types";
import type { TranscriptSegment } from "../types";

describe("LiveTranscriptionService final transcript buffering", () => {
  it("coalesces word-sized final fragments into one readable segment", () => {
    const events: TranscriptEvent[] = [];
    const service = new LiveTranscriptionService({
      sessionId: "session-test",
      sessionToken: "token-test",
      source: "microphone",
      getCustomContext: async () => "",
    });
    const internal = service as unknown as {
      handler: (event: TranscriptEvent) => void;
      queueFinalSegment: (segment: TranscriptSegment) => void;
    };
    internal.handler = (event) => events.push(event);

    internal.queueFinalSegment({
      id: "sm-0",
      startMs: 0,
      endMs: 200,
      text: "Apollo",
      interim: false,
    });
    internal.queueFinalSegment({
      id: "sm-210",
      startMs: 210,
      endMs: 420,
      text: "eleven",
      interim: false,
    });
    internal.queueFinalSegment({
      id: "sm-430",
      startMs: 430,
      endMs: 700,
      text: "landed.",
      interim: false,
    });

    expect(events).toEqual([
      {
        type: "final",
        segment: {
          id: "sm-0",
          startMs: 0,
          endMs: 700,
          text: "Apollo eleven landed.",
          interim: false,
        },
      },
    ]);
  });

  it("drops repeated words from overlapping rolling final windows", () => {
    const events: TranscriptEvent[] = [];
    const service = new LiveTranscriptionService({
      sessionId: "session-test",
      sessionToken: "token-test",
      source: "microphone",
      getCustomContext: async () => "",
    });
    const internal = service as unknown as {
      handler: (event: TranscriptEvent) => void;
      emitTranscript: (
        message: { metadata: { start_time: number; end_time: number; transcript: string } },
        interim: boolean,
      ) => void;
    };
    internal.handler = (event) => events.push(event);

    internal.emitTranscript(
      {
        metadata: {
          start_time: 0,
          end_time: 1,
          transcript: "Artificial intelligence is entering the biggest investment cycle",
        },
      },
      false,
    );
    internal.emitTranscript(
      {
        metadata: {
          start_time: 0.5,
          end_time: 1.5,
          transcript: "intelligence is entering the biggest investment cycle today.",
        },
      },
      false,
    );

    expect(events).toEqual([
      {
        type: "final",
        segment: expect.objectContaining({
          text: "Artificial intelligence is entering the biggest investment cycle today.",
        }),
      },
    ]);
  });
});
