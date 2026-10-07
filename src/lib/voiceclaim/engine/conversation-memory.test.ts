import { describe, expect, it } from "vitest";
import { RollingConversationMemory } from "./conversation-memory";

describe("RollingConversationMemory", () => {
  it("keeps the eight newest final turns", () => {
    const memory = new RollingConversationMemory();
    for (let index = 0; index < 10; index += 1) memory.addSegment({ id: `seg-${index}`, text: `statement ${index}`, startMs: index * 1_000, endMs: index * 1_000 + 500, interim: false });
    expect(memory.getSnapshot().recentTurns.map((turn) => turn.segmentId)).toEqual(["seg-2", "seg-3", "seg-4", "seg-5", "seg-6", "seg-7", "seg-8", "seg-9"]);
  });

  it("ignores interim transcript and expires stale entities", () => {
    const memory = new RollingConversationMemory();
    memory.addSegment({ id: "partial", text: "Anthropic", startMs: 0, endMs: 1, interim: true });
    memory.recordEntities([{ name: "Anthropic", type: "organization", sourceSegmentId: "seg-1", lastMentionedMs: 0 }]);
    memory.addSegment({ id: "seg-2", text: "Current turn.", startMs: 121_000, endMs: 121_500, interim: false });
    expect(memory.getSnapshot().recentTurns).toHaveLength(1);
    expect(memory.getSnapshot().activeEntities).toEqual([]);
  });

  it("never returns more than 600 approximate tokens", () => {
    const memory = new RollingConversationMemory();
    for (let index = 0; index < 8; index += 1) memory.addSegment({ id: `seg-${index}`, text: Array.from({ length: 100 }, () => `word${index}`).join(" "), startMs: index * 1_000, endMs: index * 1_000 + 500, interim: false });
    const snapshot = memory.getSnapshot();
    expect(snapshot.tokenCount).toBeLessThanOrEqual(600);
    expect(snapshot.recentTurns).toHaveLength(6);
  });
});
