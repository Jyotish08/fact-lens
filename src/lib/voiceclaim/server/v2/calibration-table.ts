export const CALIBRATION_VERSION = "2026-10-04.iso.v1";

export interface CalibrationKnot {
  raw: number;
  calibrated: number;
}

/**
 * Monotonically increasing piecewise-linear calibration knots
 * fitted via Isotonic Regression (PAVA) on golden non-abstained set.
 */
export const DEFAULT_CALIBRATION_KNOTS: CalibrationKnot[] = [
  { raw: 0, calibrated: 5 },
  { raw: 20, calibrated: 18 },
  { raw: 40, calibrated: 35 },
  { raw: 50, calibrated: 48 },
  { raw: 65, calibrated: 62 },
  { raw: 75, calibrated: 74 },
  { raw: 85, calibrated: 83 },
  { raw: 95, calibrated: 92 },
  { raw: 100, calibrated: 95 },
];

/**
 * Applies piecewise linear interpolation across calibration knots.
 */
export function applyCalibration(
  rawScore: number,
  knots: CalibrationKnot[] = DEFAULT_CALIBRATION_KNOTS,
): number {
  if (knots.length === 0) return Math.max(5, Math.min(95, Math.round(rawScore)));

  const clampedRaw = Math.max(0, Math.min(100, rawScore));

  if (clampedRaw <= knots[0]!.raw) {
    return knots[0]!.calibrated;
  }
  const lastKnot = knots[knots.length - 1]!;
  if (clampedRaw >= lastKnot.raw) {
    return lastKnot.calibrated;
  }

  for (let i = 0; i < knots.length - 1; i++) {
    const k1 = knots[i]!;
    const k2 = knots[i + 1]!;

    if (clampedRaw >= k1.raw && clampedRaw <= k2.raw) {
      if (k2.raw === k1.raw) return k2.calibrated;
      const t = (clampedRaw - k1.raw) / (k2.raw - k1.raw);
      const interpolated = k1.calibrated + t * (k2.calibrated - k1.calibrated);
      return Math.max(5, Math.min(95, Math.round(interpolated)));
    }
  }

  return Math.max(5, Math.min(95, Math.round(rawScore)));
}
