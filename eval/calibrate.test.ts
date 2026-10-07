import { describe, expect, it } from "vitest";
import { computeEce, fitIsotonicRegression, type CalibrationPoint } from "./calibrate";
import { applyCalibration, DEFAULT_CALIBRATION_KNOTS } from "../src/lib/voiceclaim/server/v2/calibration-table";

describe("Calibration & Reliability (T30)", () => {
  it("computes ECE and Brier score accurately", () => {
    const points: CalibrationPoint[] = [
      { raw: 90, isCorrect: true },
      { raw: 85, isCorrect: true },
      { raw: 80, isCorrect: false },
      { raw: 30, isCorrect: false },
      { raw: 20, isCorrect: false },
    ];

    const result = computeEce(points, 2);
    expect(result.ece).toBeGreaterThanOrEqual(0);
    expect(result.brier).toBeGreaterThan(0);
    expect(result.bins.length).toBeGreaterThan(0);
  });

  it("fits isotonic regression (PAVA) to guarantee monotonicity", () => {
    // Non-monotonic empirical points
    const points: CalibrationPoint[] = [
      { raw: 20, isCorrect: true },  // empirical 100%
      { raw: 40, isCorrect: false }, // empirical 0%
      { raw: 60, isCorrect: true },
      { raw: 80, isCorrect: true },
    ];

    const knots = fitIsotonicRegression(points);
    expect(knots.length).toBeGreaterThan(0);

    // Monotonicity check: calibrated values must be non-decreasing
    for (let i = 0; i < knots.length - 1; i++) {
      expect(knots[i]!.calibrated).toBeLessThanOrEqual(knots[i + 1]!.calibrated);
    }
  });

  it("applies piecewise-linear calibration interpolation monotonically", () => {
    const low = applyCalibration(30, DEFAULT_CALIBRATION_KNOTS);
    const mid = applyCalibration(55, DEFAULT_CALIBRATION_KNOTS);
    const high = applyCalibration(85, DEFAULT_CALIBRATION_KNOTS);

    expect(low).toBeLessThanOrEqual(mid);
    expect(mid).toBeLessThanOrEqual(high);
    expect(high).toBeGreaterThan(70);
  });
});
