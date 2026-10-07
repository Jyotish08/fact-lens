import { canonicalizeUrl } from "./server/evidence";

export interface ParsedSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export function parseSearchHits(text: string): ParsedSearchHit[] {
  const hits: ParsedSearchHit[] = [];
  const seen = new Set<string>();
  const decoded = parseJsonPayload(text);
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const candidate = String(item["url"] ?? item["link"] ?? item["href"] ?? "");
    if (/^https?:\/\//i.test(candidate)) {
      try {
        const url = canonicalizeUrl(candidate);
        if (!seen.has(url)) {
          seen.add(url);
          hits.push({
            url,
            title: String(item["title"] ?? item["name"] ?? new URL(url).hostname).slice(0, 300),
            snippet: String(item["description"] ?? item["snippet"] ?? "").slice(0, 1_000),
          });
        }
      } catch {
        // Unsafe or malformed result URLs are discarded.
      }
    }
    Object.values(item).forEach(visit);
  };
  visit(decoded);
  if (!hits.length) {
    const markdownLink = /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g;
    for (const match of text.matchAll(markdownLink)) {
      try {
        const url = canonicalizeUrl(match[2]!);
        if (!seen.has(url)) {
          seen.add(url);
          hits.push({ title: match[1]!.slice(0, 300), url, snippet: "" });
        }
      } catch {
        // Unsafe or malformed result URLs are discarded.
      }
    }
  }
  // Bright Data's Google response can be a JSON object wrapped in an MCP text
  // block instead of Markdown. Retain valid URLs in that representation even
  // when the provider changes its surrounding field names.
  if (!hits.length) {
    const urlPattern = /https?:\/\/[^\s"'<>\\)\]}]+/g;
    for (const match of text.matchAll(urlPattern)) {
      try {
        const url = canonicalizeUrl(match[0]!);
        if (!seen.has(url)) {
          seen.add(url);
          hits.push({ title: new URL(url).hostname, url, snippet: "" });
        }
      } catch {
        // Unsafe or malformed result URLs are discarded.
      }
    }
  }
  return hits.slice(0, 10);
}

function parseJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    ...[...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) =>
      typeof match === "string" ? match : (match[1] ?? ""),
    ),
  ];
  const firstJson = Math.min(
    ...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0),
  );
  if (Number.isFinite(firstJson)) candidates.push(trimmed.slice(firstJson));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next representation.
    }
  }
  return undefined;
}
