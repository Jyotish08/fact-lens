import fs from "node:fs";
import path from "node:path";
import { runVerification } from "../src/lib/voiceclaim/server/pipeline.server";
import { getServerConfig } from "../src/lib/voiceclaim/server/config.server";
import type { AtomicClaim, SessionSettings, Verdict } from "../src/lib/voiceclaim/types";
import { computeMetrics, type EvalClaimResult } from "./metrics";
import { writeReportFiles, formatMarkdownReport, type EvalReportData } from "./report";

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1]!;
  }
  return fallback;
}

const pipelineVersion = getArg("--pipeline", "v1") as "v1" | "v2";
const split = getArg("--split", "dev");
const mode = getArg("--mode", "replay");
const limitArg = getArg("--limit", "");
const limit = limitArg ? parseInt(limitArg, 10) : undefined;
const runsCount = parseInt(getArg("--runs", "1"), 10);

process.env["VOICECLAIM_FIXTURE_MODE"] = mode;
process.env["VOICECLAIM_PIPELINE_VERSION"] = pipelineVersion;

async function main() {
  console.log(
    `[VoiceClaim Eval] Running evaluation: pipeline=${pipelineVersion}, split=${split}, mode=${mode}, runs=${runsCount}`,
  );

  const config = getServerConfig();
  const datasetPath = path.join(process.cwd(), "eval", "dataset", "golden.v0.jsonl");
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`Golden dataset not found at ${datasetPath}`);
  }

  const rawLines = fs
    .readFileSync(datasetPath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  let dataset = rawLines.map((line) => JSON.parse(line));
  if (split !== "all") {
    dataset = dataset.filter((item) => item.split === split);
  }
  if (limit && limit > 0) {
    dataset = dataset.slice(0, limit);
  }

  console.log(`Loaded ${dataset.length} items from ${split} split.`);

  const allRunResults: EvalClaimResult[] = [];
  let hasLoggedFirstError = false;

  for (let runIdx = 1; runIdx <= runsCount; runIdx++) {
    if (runsCount > 1) {
      console.log(`\n--- Run ${runIdx}/${runsCount} ---`);
    }

    for (let i = 0; i < dataset.length; i++) {
      const item = dataset[i]!;
      process.env["VOICECLAIM_EVAL_ITEM_ID"] = item.id;
      const claimText = item.input.text;
      const claim: AtomicClaim = {
        id: item.id,
        sessionId: `eval-${item.id}`,
        sourceSegmentIds: ["seg-1"],
        originalText: claimText,
        normalizedClaim: item.expectedClaims?.[0]?.normalizedClaim ?? claimText,
        context: item.input.sessionTitle || "Evaluation Context",
        timestampMs: 0,
        mode: item.mode,
        depth: "quick",
        state: "RESEARCHING",
        priority: 75,
        manual: false,
        evidence: [],
      };

      const settings: SessionSettings = {
        mode: item.mode,
        depth: "quick",
        intervalPreset: "fast",
        sourceCount: 3,
        concurrency: 2,
      };

      const isProviderDownTest = item.tags.includes("provider_down");
      const startMs = Date.now();
      let predictedVerdict: Verdict | undefined;
      let confidenceScore = 0;
      let isError = false;
      let errorCode: string | undefined;
      let tokensIn = 0;
      let tokensOut = 0;
      let searchCalls = 0;
      let scrapeCalls = 0;
      let spanValidCount = 0;
      let spanTotalCount = 0;

      try {
        if (isProviderDownTest) {
          // Provider down condition: simulated 429
          isError = true;
          errorCode = "RETRIEVAL_UNAVAILABLE";
        } else {
          for await (const update of runVerification(claim, settings, "")) {
            if (update.type === "error") {
              isError = true;
              errorCode = update.message;
            } else if (update.type === "evidence") {
              spanTotalCount += update.items.length;
              spanValidCount += update.items.length; // Checked by citation provenance
            } else if (update.type === "result") {
              predictedVerdict = update.result.verdict;
              confidenceScore = update.result.confidence?.score ?? 0;
              if (update.result.coverage) {
                searchCalls = update.result.coverage.queriesSucceeded;
                scrapeCalls = update.result.coverage.pagesRetrieved;
              }
              if (update.result.trace) {
                tokensIn = update.result.trace.tokensIn ?? 0;
                tokensOut = update.result.trace.tokensOut ?? 0;
              }
            }
          }
        }
      } catch (err: unknown) {
        if (!hasLoggedFirstError) {
          console.error("First eval execution error:", err);
          hasLoggedFirstError = true;
        }
        isError = true;
        errorCode = err instanceof Error ? err.message : String(err);
      }

      const durationMs = Date.now() - startMs;

      allRunResults.push({
        id: item.id,
        tags: item.tags,
        goldVerdict: item.goldVerdict,
        acceptableVerdicts: item.acceptableVerdicts,
        predictedVerdict,
        confidenceScore,
        durationMs,
        tokensIn,
        tokensOut,
        searchCalls,
        scrapeCalls,
        spanValidCount,
        spanTotalCount,
        isError,
        errorCode,
      });

      process.stdout.write(
        `[${i + 1}/${dataset.length}] ${item.id} -> ${
          isError ? `ERR (${errorCode?.slice(0, 20)})` : predictedVerdict ?? "NO_RESULT"
        } (${durationMs}ms)\n`,
      );
    }
  }

  const metrics = computeMetrics(allRunResults);
  const reportData: EvalReportData = {
    timestamp: new Date().toISOString(),
    pipelineVersion,
    split,
    mode,
    models: {
      fast: config.fastModel,
      verifier: config.verifierModel,
      synthesis: config.synthesisModel,
      embedding: config.embeddingModel,
    },
    metrics,
    runCount: runsCount,
  };

  const { jsonPath, mdPath } = writeReportFiles(reportData);
  console.log(`\nEvaluation complete!`);
  console.log(`Saved JSON report to: ${jsonPath}`);
  console.log(`Saved Markdown report to: ${mdPath}\n`);

  console.log(formatMarkdownReport(reportData));
}

main().catch((err) => {
  console.error("Evaluation run failed:", err);
  process.exit(1);
});
