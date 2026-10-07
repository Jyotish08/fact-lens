import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { assetRepository, historyRepository } from "./storage";
import type { Session } from "./types";

const session: Session = {
  id: "storage-test",
  title: "Test",
  source: "microphone",
  settings: {
    mode: "general",
    depth: "quick",
    intervalPreset: "fast",
    sourceCount: 3,
    concurrency: 2,
  },
  customSources: [],
  startedAt: "2026-08-10T00:00:00.000Z",
  endedAt: "2026-08-10T00:01:00.000Z",
  status: "completed",
  durationMs: 60_000,
  segments: [],
  claims: [],
};

describe("IndexedDB repositories", () => {
  it("persists completed history and removes it", async () => {
    await historyRepository.save(session);
    expect((await historyRepository.get(session.id))?.title).toBe("Test");
    await historyRepository.remove(session.id);
    expect(await historyRepository.get(session.id)).toBeUndefined();
  });

  it("cleans session assets", async () => {
    const file = new File(["evidence"], "evidence.txt", { type: "text/plain" });
    await assetRepository.storeCorpus("asset-cleanup", [file]);
    expect(await assetRepository.list("asset-cleanup")).toHaveLength(1);
    await assetRepository.deleteSession("asset-cleanup");
    expect(await assetRepository.list("asset-cleanup")).toHaveLength(0);
  });
});
