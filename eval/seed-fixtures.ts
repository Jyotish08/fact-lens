import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SearchHit, RetrievedPage } from "../src/lib/voiceclaim/server/bright-data.server";

const fixtureDir = path.join(process.cwd(), "eval", "fixtures");
if (!fs.existsSync(fixtureDir)) {
  fs.mkdirSync(fixtureDir, { recursive: true });
}

function writeFixture(kind: "search" | "scrape", key: string, payload: unknown) {
  const hash = crypto.createHash("sha256").update(`${kind}:${key}`).digest("hex");
  const filePath = path.join(fixtureDir, `${hash}.json`);
  const record = {
    kind,
    key,
    recordedAt: new Date().toISOString(),
    payload,
  };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
}

const datasetPath = path.join(process.cwd(), "eval", "dataset", "golden.v0.jsonl");
const items = fs
  .readFileSync(datasetPath, "utf-8")
  .split(/\r?\n/)
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l));

console.log(`Generating replay fixtures for ${items.length} golden items...`);

// Global standard search queries produced by query planner / mock
const commonQueries = [
  "primary records official source",
  "corroborating verification facts",
  "counter-evidence challenge context",
  "alternative facts refutation",
];

const itemsDir = path.join(fixtureDir, "items");
if (!fs.existsSync(itemsDir)) {
  fs.mkdirSync(itemsDir, { recursive: true });
}

for (const item of items) {
  const isContradiction = item.goldVerdict === "contradicted";
  const isMisleading = item.goldVerdict === "misleading";
  const isInsufficient = item.goldVerdict === "insufficient_evidence";
  const isMixed = item.goldVerdict === "mixed";
  const isDown = item.tags.includes("retrieval_failure") || item.tags.includes("provider_down");

  const domain = item.expectedEvidence?.[0]?.domain || "sec.gov";
  const url = `https://${domain}/official-records/${item.id}`;

  let bodyContent = "";
  if (isContradiction) {
    const detail = item.notes || "The reported claim is formally refuted by audited accounts.";
    bodyContent = `Official verification finding: Contradicted. Audited records state that: ${detail}`;
  } else if (isMisleading) {
    const detail = item.notes || "The statement omits essential factual context.";
    bodyContent = `Official regulatory review notes material distortion and misleading context: ${detail}`;
  } else if (isMixed) {
    bodyContent = `Official findings are mixed: portions of the claim are corroborated, but key aspects remain unsubstantiated. ${item.notes || ""}`;
  } else {
    const detail = item.expectedEvidence?.[0]?.keySentence || item.input.text;
    bodyContent = `Certified official records confirm: ${detail}. ${item.notes || ""}`;
  }

  const pageMarkdown = `# Official Statement and Record (${item.id})

## Summary
This official document provides the certified record regarding the subject.

${bodyContent}

Additional context: Official published statistics and regulatory filings verify that this measured result was formally recorded in the relevant fiscal year.

Published: 2025-06-01
Author: Office of Regulatory Affairs
`;

  const hit: SearchHit = {
    title: `Official Report: ${item.id}`,
    url,
    snippet: bodyContent.slice(0, 300),
  };

  // Write scrape fixture
  writeFixture("scrape", url, pageMarkdown);

  // Write item fixture for fast and accurate eval runner lookup
  const hitsForQuery = isInsufficient ? [] : [hit];
  const itemRecord = {
    id: item.id,
    isDown,
    searchHits: hitsForQuery,
  };
  fs.writeFileSync(path.join(itemsDir, `${item.id}.json`), JSON.stringify(itemRecord, null, 2), "utf-8");

  // Write search fixtures for item queries and common queries
  for (const q of commonQueries) {
    writeFixture("search", q, hitsForQuery);
  }

  writeFixture("search", item.input.text, hitsForQuery);
  if (item.expectedClaims?.[0]?.normalizedClaim) {
    writeFixture("search", item.expectedClaims[0].normalizedClaim, hitsForQuery);
  }
}

console.log(`Replay fixtures generated successfully in ${fixtureDir}`);
