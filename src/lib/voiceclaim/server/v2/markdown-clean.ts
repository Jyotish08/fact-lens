const BOILERPLATE_LINE_PATTERNS = [
  /cookie\s*policy|accept\s*cookies|we\s*use\s*cookies|manage\s*cookie/i,
  /subscribe\s*now|newsletter|sign\s*up\s*for\s*our\s*newsletter|enter\s*your\s*email/i,
  /all\s*rights\s*reserved|©\s*\d{4}|copyright\s*\d{4}/i,
  /share\s*this\s*(article|story|post)|facebook|twitter|linkedin|reddit|whatsapp/i,
  /terms\s*of\s*service|privacy\s*policy|do\s*not\s*sell\s*my\s*personal/i,
  /advertisement|sponsored\s*content|read\s*more:|recommended\s*stories/i,
];

export function cleanMarkdown(rawMarkdown: string): string {
  if (!rawMarkdown) return "";

  // 1. Remove image markdown: ![alt](url)
  let text = rawMarkdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  // 2. Convert markdown links to text: [label](url) -> label
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 3. Line-by-line filtering
  const lines = text.split(/\r?\n/);
  const keptLines: string[] = [];
  const lineCountMap = new Map<string, number>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      keptLines.push("");
      continue;
    }

    // Check repeated line count (collapse if >= 3 times)
    const norm = trimmed.toLowerCase();
    const count = (lineCountMap.get(norm) ?? 0) + 1;
    lineCountMap.set(norm, count);
    if (count >= 3 && trimmed.length < 100) {
      continue;
    }

    // Drop boilerplate lines
    const isBoilerplate = BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
    if (isBoilerplate && trimmed.length < 200) {
      continue;
    }

    keptLines.push(trimmed);
  }

  // 4. Collapse consecutive blank lines
  let cleaned = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

export const cleanMarkdownText = cleanMarkdown;
