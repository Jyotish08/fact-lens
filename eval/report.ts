import fs from "node:fs";
import path from "node:path";
import type { MetricSummary } from "./metrics";
import { VERDICT_CLASSES } from "./metrics";

export interface EvalReportData {
  timestamp: string;
  pipelineVersion: string;
  split: string;
  mode: string;
  models: {
    fast: string;
    verifier: string;
    synthesis: string;
    embedding: string;
  };
  metrics: MetricSummary;
  runCount?: number;
}

export function writeReportFiles(reportData: EvalReportData): {
  jsonPath: string;
  mdPath: string;
} {
  const root = process.cwd();
  const reportsDir = path.join(root, "eval", "reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const safeTs = reportData.timestamp.replace(/[:.]/g, "-");
  const baseName = `${safeTs}-${reportData.pipelineVersion}-${reportData.split}`;
  const jsonPath = path.join(reportsDir, `${baseName}.json`);
  const mdPath = path.join(reportsDir, `${baseName}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), "utf-8");

  const mdContent = formatMarkdownReport(reportData);
  fs.writeFileSync(mdPath, mdContent, "utf-8");

  return { jsonPath, mdPath };
}

export function formatMarkdownReport(data: EvalReportData): string {
  const m = data.metrics;
  const lines: string[] = [];

  lines.push(`# Voice Claim Auditor — Evaluation Report (${data.pipelineVersion.toUpperCase()})`);
  lines.push(`- **Timestamp**: ${data.timestamp}`);
  lines.push(`- **Pipeline Version**: ${data.pipelineVersion}`);
  lines.push(`- **Split**: ${data.split}`);
  lines.push(`- **Execution Mode**: ${data.mode}`);
  lines.push(
    `- **Models Used**: fast=\`${data.models.fast}\`, verifier=\`${data.models.verifier}\`, synthesis=\`${data.models.synthesis}\`, embedding=\`${data.models.embedding}\``,
  );
  lines.push("");

  lines.push("## Summary Metrics (§12 Gates)");
  lines.push("| Metric | Value | Target / Gate (v2 G4) | Status |");
  lines.push("|---|---|---|---|");
  lines.push(
    `| Verdict Macro-F1 (6 classes) | ${(m.macroF1 * 100).toFixed(1)}% | Non-inferior (>= baseline - 0.02) | Baseline Recorded |`,
  );
  lines.push(
    `| Strict Accuracy | ${(m.accuracyStrict * 100).toFixed(1)}% | Reference | — |`,
  );
  lines.push(
    `| Acceptable Accuracy | ${(m.accuracyAcceptable * 100).toFixed(1)}% | Reference | — |`,
  );
  lines.push(
    `| False Contradiction Rate | ${(m.falseContradictionRate * 100).toFixed(1)}% | < Baseline | Baseline Recorded |`,
  );
  lines.push(
    `| Infra-as-Verdict Rate | ${(m.infraAsVerdictRate * 100).toFixed(1)}% | 0.0% (strict gate) | ${m.infraAsVerdictRate === 0 ? "PASSED" : "FAILED"} |`,
  );
  lines.push(
    `| Citation Span Validity | ${(m.citationSpanValidity * 100).toFixed(1)}% | 100.0% | ${m.citationSpanValidity === 1 ? "PASSED" : "NEEDS_ATTENTION"} |`,
  );
  lines.push(
    `| ECE (Expected Calibration Error) | ${m.ece.toFixed(4)} | < 0.10 for calibration | Baseline Recorded |`,
  );
  lines.push(
    `| Brier Score | ${m.brierScore.toFixed(4)} | Lower is better | Baseline Recorded |`,
  );
  lines.push(
    `| Latency p50 / p95 | ${m.latencyMs.p50} ms / ${m.latencyMs.p95} ms | p95 <= Budget | Baseline Recorded |`,
  );
  lines.push(
    `| Tokens / Claim (Avg Total) | ${m.tokensPerClaim.avgTotal} | <= Baseline | Baseline Recorded |`,
  );
  lines.push(
    `| Searches / Scrapes per Claim | ${m.providerCallsPerClaim.avgSearches} / ${m.providerCallsPerClaim.avgScrapes} | <= Baseline | Baseline Recorded |`,
  );
  lines.push(
    `| Verification Failure Rate | ${(m.verificationFailureRate * 100).toFixed(1)}% | <= Baseline | Baseline Recorded |`,
  );
  lines.push("");

  lines.push("## Per-Class Breakdown");
  lines.push("| Verdict Class | Precision | Recall | F1 | Support |");
  lines.push("|---|---|---|---|---|");
  for (const cls of VERDICT_CLASSES) {
    const stat = m.perClassF1[cls];
    lines.push(
      `| \`${cls}\` | ${(stat.precision * 100).toFixed(1)}% | ${(stat.recall * 100).toFixed(1)}% | ${(stat.f1 * 100).toFixed(1)}% | ${stat.support} |`,
    );
  }
  lines.push("");

  lines.push("## Confusion Matrix (Rows = Gold, Columns = Predicted)");
  lines.push(`| Gold \\ Predicted | ${VERDICT_CLASSES.map((c) => `\`${c.slice(0, 4)}\``).join(" | ")} |`);
  lines.push(`|---|${VERDICT_CLASSES.map(() => "---").join("|")}|`);
  for (const gold of VERDICT_CLASSES) {
    const row = VERDICT_CLASSES.map((pred) => m.confusionMatrix[gold]?.[pred] ?? 0);
    lines.push(`| \`${gold}\` | ${row.join(" | ")} |`);
  }
  lines.push("");

  return lines.join("\n");
}
