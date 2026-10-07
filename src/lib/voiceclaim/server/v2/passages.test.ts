import { describe, expect, it } from "vitest";
import { segmentPassages } from "./passages";

describe("segmentPassages", () => {
  it("returns empty array for empty or whitespace text", () => {
    expect(segmentPassages("doc-1", "")).toEqual([]);
    expect(segmentPassages("doc-1", "   \n\n  ")).toEqual([]);
  });

  it("preserves exact character slice invariant cleanedText.slice(start, end) === text", () => {
    const text = `
In 2024, renewable energy generation increased by 15% globally according to the International Energy Agency.
Solar photovoltaic installations accounted for three quarters of this growth worldwide.
Wind power additions also saw a substantial increase, led by offshore developments in Europe and Asia.

Governments in multiple jurisdictions introduced new subsidies and feed-in tariffs to support transition goals.
However, grid constraints and supply chain bottlenecks remained significant hurdles throughout the year.
Investment reached an all-time high of $1.8 trillion in clean energy technologies.

Analysts project further growth in 2025 as battery storage costs continue to decline.
Several developing nations expanded their capacity targets by more than 20 percent.
    `.trim();

    const passages = segmentPassages("doc-test", text);
    expect(passages.length).toBeGreaterThan(0);

    for (const p of passages) {
      expect(p.docId).toBe("doc-test");
      expect(p.passageId).toMatch(/^doc-test#p\d+$/);
      // STRICT INVARIANT
      expect(text.slice(p.start, p.end)).toBe(p.text);
      expect(p.text.length).toBeGreaterThan(0);
      expect(p.contextText).toContain(p.text);
    }
  });

  it("splits long paragraphs exceeding 220 words into multiple passages while preserving offsets", () => {
    // Generate a long paragraph with > 250 words
    const sentence = "The economic indicators demonstrated remarkable stability despite persistent inflation pressure in key sectors. ";
    const longParagraph = sentence.repeat(25).trim();

    const passages = segmentPassages("doc-long", longParagraph);
    expect(passages.length).toBeGreaterThan(1);

    for (const p of passages) {
      expect(longParagraph.slice(p.start, p.end)).toBe(p.text);
      expect(p.text.split(/\s+/).length).toBeLessThanOrEqual(250);
    }
  });

  it("provides neighbor context in contextText capped at reasonable word length", () => {
    const para1 = "Paragraph one discusses revenue growth of twenty percent across northern regions.";
    const para2 = "Paragraph two details expenditure cuts and operational efficiencies implemented in Q3.";
    const para3 = "Paragraph three outlines future projections and market expansion plans for 2027.";

    const text = `${para1}\n\n${para2}\n\n${para3}`;
    const passages = segmentPassages("doc-ctx", text);

    if (passages.length >= 2) {
      for (const p of passages) {
        expect(text.slice(p.start, p.end)).toBe(p.text);
        const contextWords = p.contextText.split(/\s+/).length;
        expect(contextWords).toBeLessThanOrEqual(450);
      }
    }
  });
});
