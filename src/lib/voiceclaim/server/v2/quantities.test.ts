import { describe, expect, it } from "vitest";
import {
  checkQuantityMatch,
  extractQuantitiesFromText,
} from "./quantities";
import type { ClaimQuantity } from "../../types";

describe("Quantity Comparator (T18)", () => {
  it("extracts and normalizes currency, percentages and magnitudes", () => {
    const text1 = "The company reported $18 billion in revenue, up 14% year over year.";
    const q1 = extractQuantitiesFromText(text1);
    expect(q1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 18_000_000_000, unit: "USD" }),
        expect.objectContaining({ value: 14, unit: "%" }),
      ]),
    );

    const text2 = "Total funding reached USD 20bn while operating costs were €500M.";
    const q2 = extractQuantitiesFromText(text2);
    expect(q2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 20_000_000_000, unit: "USD" }),
        expect.objectContaining({ value: 500_000_000, unit: "EUR" }),
      ]),
    );
  });

  it("handles spoken number words like 'twenty billion dollars'", () => {
    const text = "They generated twenty billion dollars last fiscal year.";
    const q = extractQuantitiesFromText(text);
    expect(q).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 20_000_000_000, unit: "USD" }),
      ]),
    );
  });

  it("detects exact match between '$20 billion' and 'twenty billion dollars' or 'USD 20bn'", () => {
    const claimQty: ClaimQuantity = {
      raw: "$20 billion",
      value: 20_000_000_000,
      unit: "USD",
      comparator: "exact",
    };

    const passage1 = extractQuantitiesFromText("We hit USD 20bn in recurring bookings.");
    expect(checkQuantityMatch(claimQty, passage1)).toBe("match");

    const passage2 = extractQuantitiesFromText("Annual revenue was twenty billion dollars.");
    expect(checkQuantityMatch(claimQty, passage2)).toBe("match");
  });

  it("identifies mismatch between '$18 million' and '$18 billion'", () => {
    const claimQty: ClaimQuantity = {
      raw: "$18 million",
      value: 18_000_000,
      unit: "USD",
      comparator: "exact",
    };

    const passage = extractQuantitiesFromText("The acquisition price was $18 billion.");
    expect(checkQuantityMatch(claimQty, passage)).toBe("mismatch");
  });

  it("identifies mismatch between '14%' and '40%'", () => {
    const claimQty: ClaimQuantity = {
      raw: "14%",
      value: 14,
      unit: "%",
      comparator: "exact",
    };

    const passage = extractQuantitiesFromText("Market share surged to 40 percent.");
    expect(checkQuantityMatch(claimQty, passage)).toBe("mismatch");
  });

  it("handles approximate tolerances correctly (within 10%)", () => {
    const claimQty: ClaimQuantity = {
      raw: "around $20 billion",
      value: 20_000_000_000,
      unit: "USD",
      comparator: "approx",
    };

    // 21 billion is +5%, within 10% tolerance
    const passageWithin = extractQuantitiesFromText("Total revenue was $21 billion.");
    expect(checkQuantityMatch(claimQty, passageWithin)).toBe("within_tolerance");

    // 25 billion is +25%, outside 10% tolerance
    const passageOutside = extractQuantitiesFromText("Total revenue was $25 billion.");
    expect(checkQuantityMatch(claimQty, passageOutside)).toBe("mismatch");
  });

  it("returns not_applicable when no relevant unit is mentioned", () => {
    const claimQty: ClaimQuantity = {
      raw: "20 billion dollars",
      value: 20_000_000_000,
      unit: "USD",
      comparator: "exact",
    };

    const passage = extractQuantitiesFromText("The team hired 500 new employees.");
    expect(checkQuantityMatch(claimQty, passage)).toBe("not_applicable");
  });
});
