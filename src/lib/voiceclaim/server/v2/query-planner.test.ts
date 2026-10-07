import { describe, expect, it } from "vitest";
import { planQueriesV2 } from "./query-planner";
import type { AtomicClaim } from "../../types";

describe("Query Planner v2 (T13)", () => {
  const baseClaim: AtomicClaim = {
    id: "test-1",
    sessionId: "s-1",
    sourceSegmentIds: ["seg-1"],
    originalText: "Apple reported 380 billion in revenue for 2023.",
    normalizedClaim: "Apple reported annual revenue exceeding 380 billion dollars for fiscal year 2023.",
    context: "Earnings call",
    timestampMs: 0,
    mode: "investor",
    depth: "quick",
    state: "RESEARCHING",
    priority: 80,
    manual: false,
    evidence: [],
    frame: {
      version: 2,
      subject: "Apple",
      claimType: "quantity",
      quantities: [{ raw: "380 billion", value: 380_000_000_000, unit: "USD", comparator: "exact" }],
      temporal: {
        expression: "in 2023",
        resolvedStart: "2023-01-01",
        resolvedEnd: "2023-12-31",
        anchorSource: "explicit",
        currentness: "historical",
      },
      scope: null,
      condition: null,
      modality: "asserted",
      unresolvedReferent: false,
      selfRepairApplied: false,
    },
  };

  it("plans balanced queries and appends temporal term when resolvedStart exists", async () => {
    const planned = await planQueriesV2({ claim: baseClaim });
    expect(planned.length).toBeGreaterThanOrEqual(2);
    expect(planned.length).toBeLessThanOrEqual(6);

    const sides = new Set(planned.map((q) => q.side));
    expect(sides).toContain("support");
    expect(sides).toContain("challenge");

    // Check that 2023 is present in the queries
    const has2023 = planned.some((q) => q.query.includes("2023"));
    expect(has2023).toBe(true);
  });

  it("adds investor primary source query for quantity claims", async () => {
    const planned = await planQueriesV2({ claim: baseClaim });
    const secQuery = planned.find((q) => q.query.includes("site:sec.gov"));
    expect(secQuery).toBeDefined();
    expect(secQuery?.isPrimarySourceQuery).toBe(true);
  });

  it("adds academic primary source query for academic mode", async () => {
    const acadClaim: AtomicClaim = {
      ...baseClaim,
      mode: "academic",
      frame: {
        ...baseClaim.frame!,
        subject: "CRISPR-Cas9",
        claimType: "attribute",
      },
    };
    const planned = await planQueriesV2({ claim: acadClaim });
    const pubmedQuery = planned.find((q) => q.query.includes("pubmed") || q.query.includes("nih.gov"));
    expect(pubmedQuery).toBeDefined();
  });
});
