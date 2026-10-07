import { expect, it } from "vitest";

const liveIt = process.env["VOICECLAIM_RUN_LIVE_SMOKE"] === "true" ? it : it.skip;

liveIt("mints a Speechmatics realtime temporary key", async () => {
  const { requireIntegration } = await import("./server/config.server");
  const config = requireIntegration("speechmatics");
  const response = await fetch("https://mp.speechmatics.com/v1/api_keys?type=rt", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.speechmaticsApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl: 60 }),
  });
  expect(response.ok).toBe(true);
  expect((await response.json()) as { key_value?: string }).toHaveProperty("key_value");
});

liveIt(
  "searches and scrapes a Bright Data result",
  async () => {
    const { scrapePage, searchWeb } = await import("./server/bright-data.server");
    const hits = await searchWeb("World Bank Pakistan population official");
    expect(hits.length).toBeGreaterThan(0);
    const page = await scrapePage(hits[0]!, "live-candidate-1");
    expect(page.markdown.length).toBeGreaterThan(100);
    expect(page.url).toMatch(/^https:\/\//);
  },
  120_000,
);

liveIt("creates 512-dimension OpenAI embeddings", async () => {
  const { createEmbeddings } = await import("./server/openai.server");
  const vectors = await createEmbeddings(["VoiceClaim Auditor live integration smoke test"]);
  expect(vectors[0]).toHaveLength(512);
});

liveIt(
  "produces sourced evidence for a complete verification",
  async () => {
    const { runVerification } = await import("./server/pipeline.server");
    const updates = [];
    for await (const update of runVerification(
      {
        id: "live-verification-claim",
        sessionId: "live-verification-session",
        sourceSegmentIds: ["live-segment"],
        originalText:
          "Medicare was given the ability to negotiate lower prices on prescription drugs.",
        normalizedClaim:
          "Medicare has authority under U.S. federal law to negotiate prices for certain prescription drugs.",
        context: "United States Medicare prescription drug policy.",
        timestampMs: 0,
        mode: "general",
        depth: "quick",
        state: "DETECTED",
        priority: 90,
        manual: false,
        evidence: [],
      },
      {
        mode: "general",
        depth: "quick",
        intervalPreset: "balanced",
        sourceCount: 3,
        concurrency: 1,
      },
      "",
    )) {
      updates.push(update);
    }
    const evidence = updates.flatMap((update) => (update.type === "evidence" ? update.items : []));
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((item) => item.url.startsWith("https://"))).toBe(true);
    expect(updates.some((update) => update.type === "result")).toBe(true);
  },
  180_000,
);
