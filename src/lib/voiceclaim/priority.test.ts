import { describe, expect, it } from "vitest";
import { deterministicPriority } from "./priority";
import { cosine } from "./vector";

describe("claim priority and vector retrieval", () => {
  it("prioritizes specific quantified temporal claims and manual work", () => {
    const generic = deterministicPriority("The business is doing well", "investor");
    const specific = deterministicPriority(
      "Acme Revenue increased 42% in the second quarter of 2025",
      "investor",
    );
    expect(specific).toBeGreaterThan(generic);
    expect(deterministicPriority("anything", "general", true)).toBe(100);
  });

  it("ranks aligned embeddings above orthogonal embeddings", () => {
    expect(cosine([1, 0, 0], [0.9, 0.1, 0])).toBeGreaterThan(cosine([1, 0, 0], [0, 1, 0]));
  });
});
