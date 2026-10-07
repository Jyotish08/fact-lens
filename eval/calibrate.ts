export interface CalibrationPoint {
  raw: number; // 0..100
  isCorrect: boolean; // 1 or 0
}

export interface EceResult {
  ece: number; // 0..1
  brier: number;
  bins: Array<{
    binIndex: number;
    count: number;
    avgConfidence: number;
    accuracy: number;
  }>;
}

/**
 * Computes Expected Calibration Error (ECE) with equal-mass or equal-width bins.
 */
export function computeEce(points: CalibrationPoint[], numBins = 10): EceResult {
  if (points.length === 0) {
    return { ece: 0, brier: 0, bins: [] };
  }

  const sorted = [...points].sort((a, b) => a.raw - b.raw);
  const binSize = Math.max(1, Math.floor(sorted.length / numBins));
  const bins = [];
  let totalWeightedError = 0;
  let totalBrier = 0;

  for (let i = 0; i < sorted.length; i += binSize) {
    const slice = sorted.slice(i, i + binSize);
    if (!slice.length) continue;

    const avgConf = slice.reduce((acc, p) => acc + p.raw / 100, 0) / slice.length;
    const accuracy = slice.filter((p) => p.isCorrect).length / slice.length;
    const diff = Math.abs(avgConf - accuracy);

    totalWeightedError += diff * (slice.length / sorted.length);
    bins.push({
      binIndex: bins.length,
      count: slice.length,
      avgConfidence: Math.round(avgConf * 100) / 100,
      accuracy: Math.round(accuracy * 100) / 100,
    });
  }

  for (const p of points) {
    const prob = p.raw / 100;
    const y = p.isCorrect ? 1 : 0;
    totalBrier += Math.pow(prob - y, 2);
  }
  const brier = totalBrier / points.length;

  return {
    ece: Math.round(totalWeightedError * 1000) / 1000,
    brier: Math.round(brier * 1000) / 1000,
    bins,
  };
}

/**
 * Fits isotonic regression via Pool Adjacent Violators Algorithm (PAVA).
 */
export function fitIsotonicRegression(points: CalibrationPoint[]) {
  if (points.length === 0) return [];

  // Sort by raw confidence
  const sorted = [...points].sort((a, b) => a.raw - b.raw);

  // Group by unique raw value
  const grouped = new Map<number, { count: number; correct: number }>();
  for (const p of sorted) {
    const entry = grouped.get(p.raw) ?? { count: 0, correct: 0 };
    entry.count++;
    if (p.isCorrect) entry.correct++;
    grouped.set(p.raw, entry);
  }

  interface Block {
    raw: number;
    weight: number;
    value: number; // empirical accuracy
  }

  const blocks: Block[] = Array.from(grouped.entries()).map(([raw, data]) => ({
    raw,
    weight: data.count,
    value: data.correct / data.count,
  }));

  // PAVA loop
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i]!.value > blocks[i + 1]!.value) {
      // Pool adjacent violators
      const b1 = blocks[i]!;
      const b2 = blocks[i + 1]!;
      const totalWeight = b1.weight + b2.weight;
      const pooledValue = (b1.value * b1.weight + b2.value * b2.weight) / totalWeight;

      blocks[i] = {
        raw: b1.raw,
        weight: totalWeight,
        value: pooledValue,
      };
      blocks.splice(i + 1, 1);

      // Backtrack if needed
      if (i > 0) i--;
    } else {
      i++;
    }
  }

  return blocks.map((b) => ({
    raw: b.raw,
    calibrated: Math.max(5, Math.min(95, Math.round(b.value * 100))),
  }));
}
