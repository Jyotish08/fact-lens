import type { Verdict } from "../src/lib/voiceclaim/types";

export const VERDICT_CLASSES: Verdict[] = [
  "supported",
  "mostly_supported",
  "mixed",
  "misleading",
  "contradicted",
  "insufficient_evidence",
];

export interface EvalClaimResult {
  id: string;
  tags: string[];
  goldVerdict: Verdict;
  acceptableVerdicts: Verdict[];
  predictedVerdict?: Verdict;
  state?: string;
  confidenceScore: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  searchCalls: number;
  scrapeCalls: number;
  spanValidCount: number;
  spanTotalCount: number;
  isError: boolean;
  errorCode?: string;
}

export interface MetricSummary {
  total: number;
  evaluated: number;
  errors: number;
  accuracyStrict: number;
  accuracyAcceptable: number;
  macroF1: number;
  perClassF1: Record<Verdict, { precision: number; recall: number; f1: number; support: number }>;
  confusionMatrix: Record<Verdict, Record<Verdict, number>>;
  falseContradictionRate: number;
  infraAsVerdictRate: number;
  citationSpanValidity: number;
  ece: number;
  brierScore: number;
  latencyMs: { p50: number; p90: number; p95: number; mean: number };
  tokensPerClaim: { avgIn: number; avgOut: number; avgTotal: number };
  providerCallsPerClaim: { avgSearches: number; avgScrapes: number };
  verificationFailureRate: number;
}

export function computeMetrics(results: EvalClaimResult[]): MetricSummary {
  const total = results.length;
  if (total === 0) {
    return createEmptyMetrics();
  }

  const errors = results.filter((r) => r.isError).length;
  const nonErrors = results.filter((r) => !r.isError && r.predictedVerdict);
  const evaluated = nonErrors.length;

  let strictCorrect = 0;
  let acceptableCorrect = 0;

  // Initialize confusion matrix
  const confusion: Record<Verdict, Record<Verdict, number>> = Object.fromEntries(
    VERDICT_CLASSES.map((gold) => [
      gold,
      Object.fromEntries(VERDICT_CLASSES.map((pred) => [pred, 0])) as Record<Verdict, number>,
    ]),
  ) as any;

  for (const r of nonErrors) {
    const pred = r.predictedVerdict!;
    const gold = r.goldVerdict;
    if (confusion[gold] && confusion[gold][pred] !== undefined) {
      confusion[gold][pred] += 1;
    }
    if (pred === gold) strictCorrect += 1;
    if (r.acceptableVerdicts.includes(pred) || pred === gold) acceptableCorrect += 1;
  }

  // Per-class Precision, Recall, F1
  const perClassF1: MetricSummary["perClassF1"] = {} as any;
  let f1Sum = 0;

  for (const cls of VERDICT_CLASSES) {
    const tp = confusion[cls]?.[cls] ?? 0;
    const fp = VERDICT_CLASSES.reduce(
      (sum, otherGold) => (otherGold !== cls ? sum + (confusion[otherGold]?.[cls] ?? 0) : sum),
      0,
    );
    const fn = VERDICT_CLASSES.reduce(
      (sum, otherPred) => (otherPred !== cls ? sum + (confusion[cls]?.[otherPred] ?? 0) : sum),
      0,
    );
    const support = tp + fn;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    perClassF1[cls] = { precision, recall, f1, support };
    f1Sum += f1;
  }

  const macroF1 = f1Sum / VERDICT_CLASSES.length;

  // False Contradiction Rate:
  // gold in {supported, mostly_supported, insufficient_evidence}, but predicted contradicted
  const nonContradictedGolds = nonErrors.filter((r) =>
    ["supported", "mostly_supported", "insufficient_evidence"].includes(r.goldVerdict),
  );
  const falselyContradicted = nonContradictedGolds.filter(
    (r) => r.predictedVerdict === "contradicted",
  ).length;
  const falseContradictionRate =
    nonContradictedGolds.length > 0 ? falselyContradicted / nonContradictedGolds.length : 0;

  // Infra-as-verdict Rate:
  // tagged with "provider_down", did it emit a verdict instead of VERIFICATION_ERROR?
  const providerDownItems = results.filter((r) => r.tags.includes("provider_down"));
  const providerDownWithVerdict = providerDownItems.filter((r) => !r.isError && r.predictedVerdict).length;
  const infraAsVerdictRate =
    providerDownItems.length > 0 ? providerDownWithVerdict / providerDownItems.length : 0;

  // Citation Span Validity:
  let totalSpans = 0;
  let validSpans = 0;
  for (const r of nonErrors) {
    totalSpans += r.spanTotalCount;
    validSpans += r.spanValidCount;
  }
  const citationSpanValidity = totalSpans > 0 ? validSpans / totalSpans : 1.0;

  // Calibration: ECE (10 bins) & Brier Score
  const { ece, brierScore } = computeCalibration(nonErrors);

  // Latency percentiles
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const p50 = percentile(durations, 50);
  const p90 = percentile(durations, 90);
  const p95 = percentile(durations, 95);
  const meanDuration = durations.reduce((sum, d) => sum + d, 0) / (total || 1);

  // Tokens & Calls
  const totalIn = results.reduce((sum, r) => sum + r.tokensIn, 0);
  const totalOut = results.reduce((sum, r) => sum + r.tokensOut, 0);
  const totalSearches = results.reduce((sum, r) => sum + r.searchCalls, 0);
  const totalScrapes = results.reduce((sum, r) => sum + r.scrapeCalls, 0);

  return {
    total,
    evaluated,
    errors,
    accuracyStrict: evaluated > 0 ? strictCorrect / evaluated : 0,
    accuracyAcceptable: evaluated > 0 ? acceptableCorrect / evaluated : 0,
    macroF1,
    perClassF1,
    confusionMatrix: confusion,
    falseContradictionRate,
    infraAsVerdictRate,
    citationSpanValidity,
    ece,
    brierScore,
    latencyMs: { p50, p90, p95, mean: Math.round(meanDuration) },
    tokensPerClaim: {
      avgIn: Math.round(totalIn / (total || 1)),
      avgOut: Math.round(totalOut / (total || 1)),
      avgTotal: Math.round((totalIn + totalOut) / (total || 1)),
    },
    providerCallsPerClaim: {
      avgSearches: Number((totalSearches / (total || 1)).toFixed(2)),
      avgScrapes: Number((totalScrapes / (total || 1)).toFixed(2)),
    },
    verificationFailureRate: total > 0 ? errors / total : 0,
  };
}

export function computeCalibration(
  items: Array<{ confidenceScore: number; predictedVerdict?: Verdict; goldVerdict: Verdict }>,
) {
  if (items.length === 0) return { ece: 0, brierScore: 0 };

  const numBins = 10;
  const bins: Array<{ count: number; sumProb: number; sumCorrect: number }> = Array.from(
    { length: numBins },
    () => ({ count: 0, sumProb: 0, sumCorrect: 0 }),
  );

  let brierSum = 0;

  for (const item of items) {
    const prob = Math.max(0, Math.min(1, item.confidenceScore / 100));
    const isCorrect = item.predictedVerdict === item.goldVerdict ? 1 : 0;

    brierSum += (prob - isCorrect) ** 2;

    const binIndex = Math.min(numBins - 1, Math.floor(prob * numBins));
    const b = bins[binIndex]!;
    b.count += 1;
    b.sumProb += prob;
    b.sumCorrect += isCorrect;
  }

  let ece = 0;
  for (const b of bins) {
    if (b.count > 0) {
      const avgProb = b.sumProb / b.count;
      const avgAcc = b.sumCorrect / b.count;
      ece += (b.count / items.length) * Math.abs(avgAcc - avgProb);
    }
  }

  return {
    ece: Number(ece.toFixed(4)),
    brierScore: Number((brierSum / items.length).toFixed(4)),
  };
}

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(sortedArr.length - 1, index))] ?? 0;
}

function createEmptyMetrics(): MetricSummary {
  const emptyPerClass = Object.fromEntries(
    VERDICT_CLASSES.map((c) => [c, { precision: 0, recall: 0, f1: 0, support: 0 }]),
  ) as any;
  const emptyConfusion = Object.fromEntries(
    VERDICT_CLASSES.map((gold) => [
      gold,
      Object.fromEntries(VERDICT_CLASSES.map((pred) => [pred, 0])),
    ]),
  ) as any;

  return {
    total: 0,
    evaluated: 0,
    errors: 0,
    accuracyStrict: 0,
    accuracyAcceptable: 0,
    macroF1: 0,
    perClassF1: emptyPerClass,
    confusionMatrix: emptyConfusion,
    falseContradictionRate: 0,
    infraAsVerdictRate: 0,
    citationSpanValidity: 1,
    ece: 0,
    brierScore: 0,
    latencyMs: { p50: 0, p90: 0, p95: 0, mean: 0 },
    tokensPerClaim: { avgIn: 0, avgOut: 0, avgTotal: 0 },
    providerCallsPerClaim: { avgSearches: 0, avgScrapes: 0 },
    verificationFailureRate: 0,
  };
}
