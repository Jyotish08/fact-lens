import type { ClaimTemporal } from "./types";

export interface ResolveTemporalOptions {
  expression: string | null;
  anchorDate?: string | null | undefined;
  anchorSource?: "utterance_time" | "recording_date" | "explicit" | "unknown";
}

/**
 * Deterministic temporal resolution for claims.
 * Resolves relative expressions (e.g., "last year", "last quarter") and explicit dates
 * against an authoritative session anchor date (YYYY-MM-DD).
 */
export function resolveTemporal(options: ResolveTemporalOptions): ClaimTemporal {
  const rawExpr = options.expression?.trim();
  const defaultAnchorSource = options.anchorSource ?? (options.anchorDate ? "recording_date" : "unknown");

  if (!rawExpr) {
    return {
      expression: null,
      resolvedStart: null,
      resolvedEnd: null,
      anchorSource: "unknown",
      currentness: "timeless",
    };
  }

  const exprLower = rawExpr.toLowerCase();

  // Check explicit quarter + year: e.g. "Q3 2024", "2024 Q3", "q3 of 2024"
  const qMatch = exprLower.match(/\bq([1-4])\s*(?:of\s*)?(\d{4})\b/) || exprLower.match(/\b(\d{4})\s*q([1-4])\b/);
  if (qMatch) {
    const qNum = parseInt(qMatch[1] && qMatch[1].length === 1 ? qMatch[1] : qMatch[2]!, 10);
    const yr = parseInt(qMatch[1] && qMatch[1].length === 4 ? qMatch[1] : qMatch[2]!, 10);
    const ranges: Record<number, [string, string]> = {
      1: [`${yr}-01-01`, `${yr}-03-31`],
      2: [`${yr}-04-01`, `${yr}-06-30`],
      3: [`${yr}-07-01`, `${yr}-09-30`],
      4: [`${yr}-10-01`, `${yr}-12-31`],
    };
    const [resolvedStart, resolvedEnd] = ranges[qNum]!;
    return {
      expression: rawExpr,
      resolvedStart,
      resolvedEnd,
      anchorSource: "explicit",
      currentness: computeCurrentness(resolvedStart, resolvedEnd, options.anchorDate),
    };
  }

  // Check explicit year: e.g. "in 2025", "FY 2023", "2024"
  const yrMatch = exprLower.match(/\b(?:in\s+|fy\s*|fiscal\s+year\s+)?(19\d{2}|20\d{2})\b/);
  if (yrMatch && !exprLower.includes("ago") && !exprLower.includes("years")) {
    const yr = yrMatch[1]!;
    const resolvedStart = `${yr}-01-01`;
    const resolvedEnd = `${yr}-12-31`;
    return {
      expression: rawExpr,
      resolvedStart,
      resolvedEnd,
      anchorSource: "explicit",
      currentness: computeCurrentness(resolvedStart, resolvedEnd, options.anchorDate),
    };
  }

  // Parse anchor date if available
  const parsedAnchor = parseAnchor(options.anchorDate);
  if (!parsedAnchor) {
    // Relative expression without an anchor date cannot be resolved
    return {
      expression: rawExpr,
      resolvedStart: null,
      resolvedEnd: null,
      anchorSource: "unknown",
      currentness: "historical",
    };
  }

  const { year: aYear, month: aMonth } = parsedAnchor;
  const aQuarter = Math.floor((aMonth - 1) / 3) + 1;

  // "last year" or "previous year"
  if (/\b(?:last|previous|prior)\s+year\b/.test(exprLower)) {
    const targetYr = aYear - 1;
    return {
      expression: rawExpr,
      resolvedStart: `${targetYr}-01-01`,
      resolvedEnd: `${targetYr}-12-31`,
      anchorSource: defaultAnchorSource,
      currentness: "historical",
    };
  }

  // "this year" or "current year"
  if (/\b(?:this|current)\s+year\b/.test(exprLower)) {
    return {
      expression: rawExpr,
      resolvedStart: `${aYear}-01-01`,
      resolvedEnd: `${aYear}-12-31`,
      anchorSource: defaultAnchorSource,
      currentness: "current",
    };
  }

  // "next year"
  if (/\bnext\s+year\b/.test(exprLower)) {
    const targetYr = aYear + 1;
    return {
      expression: rawExpr,
      resolvedStart: `${targetYr}-01-01`,
      resolvedEnd: `${targetYr}-12-31`,
      anchorSource: defaultAnchorSource,
      currentness: "historical",
    };
  }

  // "last quarter" or "previous quarter"
  if (/\b(?:last|previous|prior)\s+quarter\b/.test(exprLower)) {
    let tQuarter = aQuarter - 1;
    let tYear = aYear;
    if (tQuarter === 0) {
      tQuarter = 4;
      tYear -= 1;
    }
    const quarterRanges: Record<number, [string, string]> = {
      1: [`${tYear}-01-01`, `${tYear}-03-31`],
      2: [`${tYear}-04-01`, `${tYear}-06-30`],
      3: [`${tYear}-07-01`, `${tYear}-09-30`],
      4: [`${tYear}-10-01`, `${tYear}-12-31`],
    };
    const [start, end] = quarterRanges[tQuarter]!;
    return {
      expression: rawExpr,
      resolvedStart: start,
      resolvedEnd: end,
      anchorSource: defaultAnchorSource,
      currentness: "historical",
    };
  }

  // "this quarter"
  if (/\b(?:this|current)\s+quarter\b/.test(exprLower)) {
    const quarterRanges: Record<number, [string, string]> = {
      1: [`${aYear}-01-01`, `${aYear}-03-31`],
      2: [`${aYear}-04-01`, `${aYear}-06-30`],
      3: [`${aYear}-07-01`, `${aYear}-09-30`],
      4: [`${aYear}-10-01`, `${aYear}-12-31`],
    };
    const [start, end] = quarterRanges[aQuarter]!;
    return {
      expression: rawExpr,
      resolvedStart: start,
      resolvedEnd: end,
      anchorSource: defaultAnchorSource,
      currentness: "current",
    };
  }

  // "N years ago"
  const nYearsAgoMatch = exprLower.match(/\b(\d+)\s+years?\s+ago\b/);
  if (nYearsAgoMatch) {
    const count = parseInt(nYearsAgoMatch[1]!, 10);
    const targetYr = aYear - count;
    return {
      expression: rawExpr,
      resolvedStart: `${targetYr}-01-01`,
      resolvedEnd: `${targetYr}-12-31`,
      anchorSource: defaultAnchorSource,
      currentness: "historical",
    };
  }

  return {
    expression: rawExpr,
    resolvedStart: null,
    resolvedEnd: null,
    anchorSource: "unknown",
    currentness: "historical",
  };
}

function parseAnchor(anchor?: string | null): { year: number; month: number; day: number } | null {
  if (!anchor) return null;
  const match = anchor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return { year, month, day };
}

function computeCurrentness(
  start: string,
  end: string,
  anchorDate?: string | null,
): "historical" | "current" | "timeless" {
  if (!anchorDate) return "historical";
  const anchorMatch = anchorDate.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!anchorMatch) return "historical";
  const aStr = anchorMatch[1]!;
  if (end < aStr) return "historical";
  if (start <= aStr && aStr <= end) return "current";
  return "historical";
}
