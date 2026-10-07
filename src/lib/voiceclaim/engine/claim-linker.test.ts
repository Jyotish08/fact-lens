import { describe, expect, it } from "vitest";
import { linkClaim } from "./claim-linker";
import type { AtomicClaim } from "../types";

const claim = (id: string, text: string, timestampMs: number, discourseRelation?: AtomicClaim["discourseRelation"]) => ({ id, normalizedClaim: text, timestampMs, discourseRelation } as AtomicClaim);

describe("claim linker", () => {
  it("deduplicates near-identical claims within one minute", () => {
    const result = linkClaim(claim("b", "Anthropic is an AI safety company", 20_000), [claim("a", "Anthropic is an AI safety company.", 1_000)]);
    expect(result).toMatchObject({ relation: "duplicate", duplicateOf: "a" });
  });
  it("links explicit modifications to the latest claim", () => {
    const result = linkClaim(claim("b", "Anthropic is a lab", 20_000, "modifies_previous"), [claim("a", "Anthropic is a company", 1_000)]);
    expect(result).toMatchObject({ relation: "modifies_previous", parentClaimId: "a" });
  });
});
