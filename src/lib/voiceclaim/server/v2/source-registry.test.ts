import { describe, expect, it } from "vitest";
import {
  classifySource,
  detectWireMarker,
  extractPublishedDate,
  getRegistrableDomain,
} from "./source-registry";

describe("Source Registry & Date Extraction (T19)", () => {
  it("extracts clean registrable domain using tldts", () => {
    expect(getRegistrableDomain("https://www.sec.gov/edgar/searchedgar/companysearch")).toBe("sec.gov");
    expect(getRegistrableDomain("https://sub.domain.bbc.co.uk/news/world")).toBe("bbc.co.uk");
    expect(getRegistrableDomain("https://who.int/emergencies/disease-outbreak-news")).toBe("who.int");
  });

  it("classifies government and SEC sources as primary_official", () => {
    const sec = classifySource("https://www.sec.gov/edgar/data/320193/10k.htm");
    expect(sec.tier).toBe("primary_official");
    expect(sec.category).toBe("financial_filing");

    const gov = classifySource("https://data.gov/metrics/2024");
    expect(gov.tier).toBe("primary_official");
    expect(gov.category).toBe("government");

    const who = classifySource("https://who.int/reports");
    expect(who.tier).toBe("primary_official");
  });

  it("classifies scientific journals as primary_org / scientific", () => {
    const nature = classifySource("https://www.nature.com/articles/s41586-024-001");
    expect(nature.tier).toBe("primary_org");
    expect(nature.category).toBe("scientific");
  });

  it("classifies established news and fact-checkers", () => {
    const reuters = classifySource("https://www.reuters.com/business/finance/story");
    expect(reuters.tier).toBe("established_news");
    expect(reuters.category).toBe("news");

    const politifact = classifySource("https://www.politifact.com/factchecks/2026/statement");
    expect(politifact.tier).toBe("established_news");
    expect(politifact.category).toBe("fact_check");
  });

  it("classifies social media as social tier", () => {
    const tweet = classifySource("https://x.com/analyst/status/12345");
    expect(tweet.tier).toBe("social");
    expect(tweet.category).toBe("social");
  });

  it("applies self-report modifier for company self-sources", () => {
    const teslaBlog = classifySource(
      "https://ir.tesla.com/press-release/q4-results",
      "Tesla",
      "self_report",
    );
    expect(teslaBlog.tier).toBe("primary_org");
    expect(teslaBlog.category).toBe("company");
    expect(teslaBlog.selfSource).toBe(true);
  });

  it("detects wire service markers", () => {
    const text = "WASHINGTON (AP) — Today the senate passed the measure. PR Newswire assisted.";
    expect(detectWireMarker(text)).toBe("(AP)");
  });

  it("extracts published dates from text or SERP snippets", () => {
    const textWithIso = "Published: 2025-06-15. This official report confirms figures.";
    expect(extractPublishedDate(textWithIso)).toEqual({
      publishedAt: "2025-06-15",
      publishedAtSource: "page_text",
    });

    const textWithWords = "Updated October 4, 2026 by our editorial team.";
    expect(extractPublishedDate(textWithWords)).toEqual({
      publishedAt: "2026-10-04",
      publishedAtSource: "page_text",
    });

    const snippetDate = extractPublishedDate("No dates in text", "Oct 4, 2026 ... A detailed overview");
    expect(snippetDate).toEqual({
      publishedAt: "2026-10-04",
      publishedAtSource: "serp",
    });
  });
});
