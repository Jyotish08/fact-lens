import { describe, expect, it } from "vitest";
import { cleanMarkdown } from "./markdown-clean";

describe("cleanMarkdown", () => {
  it("removes image syntax while preserving text", () => {
    const raw = "Headline\n\n![Chart showing growth](https://example.com/chart.png)\n\nParagraph text here.";
    const cleaned = cleanMarkdown(raw);
    expect(cleaned).not.toContain("chart.png");
    expect(cleaned).not.toContain("Chart showing growth");
    expect(cleaned).toContain("Headline");
    expect(cleaned).toContain("Paragraph text here.");
  });

  it("converts links to plain anchor text", () => {
    const raw = "Read more on [Reuters](https://www.reuters.com/news) or [SEC](https://sec.gov).";
    const cleaned = cleanMarkdown(raw);
    expect(cleaned).toBe("Read more on Reuters or SEC.");
  });

  it("filters out cookie, newsletter, copyright, and social sharing boilerplate", () => {
    const raw = `
Breaking financial news for Q3.
We use cookies to enhance your experience. Accept cookies.
Subscribe now to our newsletter for daily updates.
The company announced $5 billion in revenue.
Share this article on Facebook Twitter LinkedIn.
All rights reserved © 2026 Media Corp.
    `;
    const cleaned = cleanMarkdown(raw);
    expect(cleaned).toContain("Breaking financial news for Q3.");
    expect(cleaned).toContain("The company announced $5 billion in revenue.");
    expect(cleaned).not.toContain("Accept cookies");
    expect(cleaned).not.toContain("Subscribe now");
    expect(cleaned).not.toContain("Share this article");
    expect(cleaned).not.toContain("All rights reserved");
  });

  it("collapses repeated lines appearing 3 or more times", () => {
    const raw = `
Real content paragraph 1.
Home > News > Politics
Home > News > Politics
Real content paragraph 2.
Home > News > Politics
Home > News > Politics
Real content paragraph 3.
    `;
    const cleaned = cleanMarkdown(raw);
    const count = (cleaned.match(/Home > News > Politics/g) || []).length;
    expect(count).toBe(2); // Only the first 2 allowed, 3rd onwards suppressed
    expect(cleaned).toContain("Real content paragraph 1.");
    expect(cleaned).toContain("Real content paragraph 3.");
  });

  it("handles empty or blank input gracefully", () => {
    expect(cleanMarkdown("")).toBe("");
    expect(cleanMarkdown("   \n\n  \n")).toBe("");
  });
});
