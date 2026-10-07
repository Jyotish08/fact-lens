import type { ClaimQuantity } from "../../types";

export interface ParsedQuantity {
  raw: string;
  value: number;
  unit: string;
}

export type QuantityCheckResult =
  | "match"
  | "within_tolerance"
  | "mismatch"
  | "not_applicable";

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const MAGNITUDES: Record<string, number> = {
  hundred: 100,
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
  t: 1_000_000_000_000,
  trillion: 1_000_000_000_000,
};

const CURRENCY_MAP: Record<string, string> = {
  $: "USD",
  "usd": "USD",
  "dollar": "USD",
  "dollars": "USD",
  "€": "EUR",
  "eur": "EUR",
  "euro": "EUR",
  "euros": "EUR",
  "£": "GBP",
  "gbp": "GBP",
  "pound": "GBP",
  "pounds": "GBP",
  "¥": "JPY",
  "jpy": "JPY",
  "yen": "JPY",
  "%": "%",
  "percent": "%",
  "percentage": "%",
};

export function normalizeUnit(rawUnit: string): string {
  const lower = rawUnit.trim().toLowerCase();
  if (CURRENCY_MAP[lower]) return CURRENCY_MAP[lower];
  return lower;
}

/**
 * Extracts numeric quantities and their units from text.
 */
export function extractQuantitiesFromText(text: string): ParsedQuantity[] {
  const results: ParsedQuantity[] = [];
  const normalized = text.replace(/,/g, "");

  // Pattern 1: Currency symbol/code + numeric + optional magnitude
  // e.g. $20 billion, USD 20bn, €500M
  const currencyBeforeRegex =
    /(?:(\$|€|£|¥|USD|EUR|GBP|JPY)\s*)(\d+(?:\.\d+)?)\s*(trillion|billion|million|thousand|hundred|bn|b|m|k|t)?\b/gi;
  let match: RegExpExecArray | null;

  while ((match = currencyBeforeRegex.exec(normalized)) !== null) {
    const symbol = match[1] ?? "";
    const num = parseFloat(match[2] ?? "0");
    const mag = match[3]?.toLowerCase();
    const multiplier = mag ? MAGNITUDES[mag] ?? 1 : 1;
    results.push({
      raw: match[0].trim(),
      value: num * multiplier,
      unit: normalizeUnit(symbol),
    });
  }

  // Pattern 2: Numeric + optional magnitude + optional currency/unit word or %
  // e.g. 20 billion dollars, 18 million USD, 40%, 14 percent, 500 users
  const numBeforeRegex =
    /\b(\d+(?:\.\d+)?)\s*(trillion|billion|million|thousand|hundred|bn|b|m|k|t)?\s*(%|dollars?|usd|euros?|eur|pounds?|gbp|yen|jpy|percent(?:age)?|[a-zA-Z]+)?(?:\b|(?<=%))/gi;

  while ((match = numBeforeRegex.exec(normalized)) !== null) {
    const rawVal = parseFloat(match[1] ?? "0");
    const mag = match[2]?.toLowerCase();
    const unitWord = match[3]?.toLowerCase();

    const multiplier = mag ? MAGNITUDES[mag] ?? 1 : 1;
    const value = rawVal * multiplier;
    const unit = unitWord ? normalizeUnit(unitWord) : "";

    // If text preceding this match has a currency symbol like "$18 billion", skip if already in results
    const matchIndex = match.index;
    const prevChar = matchIndex > 0 ? normalized[matchIndex - 1] : "";
    if (prevChar === "$" || prevChar === "€" || prevChar === "£" || prevChar === "¥") {
      continue;
    }

    if (!results.some((r) => Math.abs(r.value - value) < 1e-6 && (!unit || r.unit === unit))) {
      results.push({
        raw: match[0].trim(),
        value,
        unit,
      });
    }
  }

  // Pattern 3: Spoken numbers e.g. "twenty billion dollars", "eighteen million"
  const spokenTens = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
  const spokenOnes =
    "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
  const spokenMagnitudes = "hundred|thousand|million|billion|trillion";
  const spokenUnits = "dollars?|usd|euros?|pounds?|percent";

  const spokenRegex = new RegExp(
    `\\b(?:(${spokenTens})(?:\\s*(${spokenOnes}))?|(${spokenOnes}))\\s*(${spokenMagnitudes})?\\s*(${spokenUnits})?\\b`,
    "gi",
  );

  while ((match = spokenRegex.exec(text.toLowerCase())) !== null) {
    if (match.index === spokenRegex.lastIndex) {
      spokenRegex.lastIndex++;
    }
    const tens = match[1] ? WORD_NUMBERS[match[1]] ?? 0 : 0;
    const ones = match[2]
      ? WORD_NUMBERS[match[2]] ?? 0
      : match[3]
        ? WORD_NUMBERS[match[3]] ?? 0
        : 0;
    const base = tens + ones;
    if (base === 0) continue;

    const magStr = match[4]?.toLowerCase();
    const mag = magStr ? MAGNITUDES[magStr] ?? 1 : 1;
    const value = base * mag;
    const unit = match[5] ? normalizeUnit(match[5]) : "";

    if (!results.some((r) => Math.abs(r.value - value) < 1e-6 && r.unit === unit)) {
      results.push({
        raw: match[0].trim(),
        value,
        unit,
      });
    }
  }

  return results;
}

/**
 * Checks a passage against a claim quantity.
 */
export function checkQuantityMatch(
  claimQty: ClaimQuantity,
  passageQuantities: ParsedQuantity[],
  options?: {
    approxTolerance?: number; // default 0.10 (10%)
    exactTolerance?: number; // default 0.02 (2%)
  },
): QuantityCheckResult {
  const normClaimUnit = normalizeUnit(claimQty.unit);
  const approxTol = options?.approxTolerance ?? 0.10;
  const exactTol = options?.exactTolerance ?? 0.02;

  // Filter passage quantities with matching or compatible unit
  const candidates = passageQuantities.filter((pq) => {
    if (!normClaimUnit || !pq.unit) return true; // Unitless comparison if either lacks unit
    return pq.unit === normClaimUnit;
  });

  if (candidates.length === 0) {
    return "not_applicable";
  }

  let foundWithinTolerance = false;

  for (const cand of candidates) {
    if (cand.value === 0 && claimQty.value === 0) return "match";
    const denom = Math.abs(claimQty.value) || 1;
    const relDiff = Math.abs(cand.value - claimQty.value) / denom;

    if (claimQty.comparator === "exact") {
      if (relDiff <= 1e-6) return "match";
      if (relDiff <= exactTol) foundWithinTolerance = true;
    } else if (claimQty.comparator === "approx") {
      if (relDiff <= 1e-6) return "match";
      if (relDiff <= approxTol) return "within_tolerance";
    } else if (claimQty.comparator === "at_least") {
      if (cand.value >= claimQty.value * (1 - exactTol)) return "match";
    } else if (claimQty.comparator === "at_most") {
      if (cand.value <= claimQty.value * (1 + exactTol)) return "match";
    }
  }

  if (foundWithinTolerance) {
    return "within_tolerance";
  }

  // If we had candidates with the exact same unit but none matched or within tolerance, it's a mismatch
  const sameUnitCandidates = candidates.filter((c) => c.unit === normClaimUnit && normClaimUnit !== "");
  if (sameUnitCandidates.length > 0) {
    return "mismatch";
  }

  return "not_applicable";
}
