import { describe, expect, it } from "vitest";
import { parseSearchHits } from "./bright-data-parser";

describe("parseSearchHits", () => {
  it("extracts results from a JSON code block returned as MCP text", () => {
    const hits = parseSearchHits(`\`\`\`json
      {"organic_results":[{"title":"World Bank","link":"https://www.worldbank.org/example?utm_source=test","snippet":"Official data"}]}
      \`\`\``);

    expect(hits).toEqual([
      {
        title: "World Bank",
        url: "https://www.worldbank.org/example",
        snippet: "Official data",
      },
    ]);
  });
});
