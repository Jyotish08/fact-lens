import { describe, expect, it } from "vitest";
import { resolveTemporal } from "./temporal";

describe("Temporal Resolution (T10, T11)", () => {
  const anchor = "2026-10-04";

  it("resolves 'last year' relative to anchor 2026-10-04", () => {
    const res = resolveTemporal({ expression: "last year", anchorDate: anchor });
    expect(res.resolvedStart).toBe("2025-01-01");
    expect(res.resolvedEnd).toBe("2025-12-31");
    expect(res.currentness).toBe("historical");
    expect(res.anchorSource).toBe("recording_date");
  });

  it("resolves 'this year' relative to anchor 2026-10-04", () => {
    const res = resolveTemporal({ expression: "this year", anchorDate: anchor });
    expect(res.resolvedStart).toBe("2026-01-01");
    expect(res.resolvedEnd).toBe("2026-12-31");
    expect(res.currentness).toBe("current");
  });

  it("resolves 'last quarter' relative to anchor in Q4 (October)", () => {
    const res = resolveTemporal({ expression: "last quarter", anchorDate: anchor });
    // Q3 is July 1 - September 30
    expect(res.resolvedStart).toBe("2026-07-01");
    expect(res.resolvedEnd).toBe("2026-09-30");
    expect(res.currentness).toBe("historical");
  });

  it("resolves explicit quarter: 'Q1 2024'", () => {
    const res = resolveTemporal({ expression: "Q1 2024", anchorDate: anchor });
    expect(res.resolvedStart).toBe("2024-01-01");
    expect(res.resolvedEnd).toBe("2024-03-31");
    expect(res.anchorSource).toBe("explicit");
    expect(res.currentness).toBe("historical");
  });

  it("resolves explicit year: 'in 2023'", () => {
    const res = resolveTemporal({ expression: "in 2023", anchorDate: anchor });
    expect(res.resolvedStart).toBe("2023-01-01");
    expect(res.resolvedEnd).toBe("2023-12-31");
    expect(res.anchorSource).toBe("explicit");
  });

  it("resolves '3 years ago' from anchor year 2026", () => {
    const res = resolveTemporal({ expression: "3 years ago", anchorDate: anchor });
    expect(res.resolvedStart).toBe("2023-01-01");
    expect(res.resolvedEnd).toBe("2023-12-31");
  });

  it("returns null resolution when anchor date is unknown for relative expressions", () => {
    const res = resolveTemporal({ expression: "last quarter", anchorDate: undefined });
    expect(res.resolvedStart).toBeNull();
    expect(res.resolvedEnd).toBeNull();
    expect(res.anchorSource).toBe("unknown");
  });

  it("handles null/empty expressions gracefully as timeless", () => {
    const res = resolveTemporal({ expression: null, anchorDate: anchor });
    expect(res.expression).toBeNull();
    expect(res.resolvedStart).toBeNull();
    expect(res.currentness).toBe("timeless");
  });
});
