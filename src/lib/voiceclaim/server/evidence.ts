import type { EvidenceConfidence, EvidenceItem, QualitativeLevel, Verdict } from "../types";

export interface ScoredEvidence extends EvidenceItem {
  relevance: number;
  directness: number;
  freshnessScore: number;
  materialDistortion?: boolean | undefined;
}

const authorityWeight: Record<QualitativeLevel, number> = {
  high: 0.9,
  medium: 0.65,
  low: 0.35,
};

export function canonicalizeUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("UNSAFE_URL");
  if (isPrivateHost(url.hostname)) throw new Error("PRIVATE_NETWORK_URL");
  url.hash = "";
  [
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "source",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
  ].forEach((key) => url.searchParams.delete(key));
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.toString();
}

export function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".localdomain") ||
    host === "::1" ||
    host === "::" ||
    host === "0.0.0.0"
  ) {
    return true;
  }

  // IPv6 unique-local (fc00::/7) or link-local (fe80::/10)
  if (/^(fc|fd|fe80)/i.test(host)) return true;
  // IPv4-mapped IPv6
  if (host.startsWith("::ffff:")) {
    return isPrivateHost(host.slice(7));
  }

  // Hex or integer IP representations
  if (/^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host)) return true;

  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 Link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    a >= 224 // 224.0.0.0/4 Multicast & reserved
  );
}

export function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function excerptAppearsInSource(excerpt: string, source: string) {
  const cleanExcerpt = excerpt.replace(/^["'“”«»…\s]+|["'“”«»…\s]+$/g, "");
  const needle = normalizeText(cleanExcerpt);
  if (needle.length < 15) return false;
  const normSource = normalizeText(source);
  if (normSource.includes(needle)) return true;

  // Bright Data returns Markdown, while the evidence model returns the visible
  // wording. Compare a punctuation/markup-insensitive word sequence as a second
  // exactness check; the words must still occur contiguously and in order.
  const compSource = comparableText(source);
  const compNeedle = comparableText(cleanExcerpt);
  if (compNeedle.split(" ").length >= 4 && compSource.includes(compNeedle)) {
    return true;
  }

  return false;
}

function comparableText(value: string) {
  return normalizeText(
    value.replace(/!\[([^\]]*)]\([^)]+\)/g, "$1").replace(/\[([^\]]+)]\([^)]+\)/g, "$1"),
  )
    .replace(/&(?:nbsp|amp|quot|#39);/g, " ")
    .replace(/[^\p{L}\p{N}$%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function evidenceScore(item: ScoredEvidence) {
  const independence = item.independent ? 1 : 0.25;
  return clamp(
    authorityWeight[item.authority] *
      item.relevance *
      item.directness *
      item.freshnessScore *
      independence,
  );
}

export function aggregateStrength(items: ScoredEvidence[], relation: "supports" | "contradicts") {
  const unique = items
    .filter((item) => item.relation === relation && item.independent)
    .sort((a, b) => evidenceScore(b) - evidenceScore(a))
    .slice(0, 3);
  return clamp(1 - unique.reduce((remaining, item) => remaining * (1 - evidenceScore(item)), 1));
}

export function determineVerdict(input: {
  support: number;
  contradiction: number;
  allMaterialElementsCovered?: boolean;
  materialDistortion?: boolean;
  materialDistortionCount?: number;
  highAuthorityDistortion?: boolean;
}): Verdict {
  const isMisleading =
    input.materialDistortionCount !== undefined || input.highAuthorityDistortion !== undefined
      ? (input.materialDistortionCount ?? 0) >= 2 || Boolean(input.highAuthorityDistortion)
      : Boolean(input.materialDistortion);

  if (isMisleading) return "misleading";
  if (input.contradiction >= 0.7 && input.contradiction - input.support >= 0.2)
    return "contradicted";
  if (input.support >= 0.5 && input.contradiction >= 0.5) return "mixed";
  if (input.support >= 0.8 && input.contradiction < 0.3 && (input.allMaterialElementsCovered ?? true))
    return "supported";
  if (input.support >= 0.65 && input.contradiction < 0.45) return "mostly_supported";
  return "insufficient_evidence";
}

function level(value: number): QualitativeLevel {
  return value >= 0.7 ? "high" : value >= 0.4 ? "medium" : "low";
}

export function computeEvidenceConfidence(input: {
  verdict: Verdict;
  support: number;
  contradiction: number;
  evidence: ScoredEvidence[];
  materialGapCount: number;
  successfulQueries: number;
  requestedQueries: number;
}): EvidenceConfidence {
  const freshness = input.evidence.length
    ? input.evidence.reduce((sum, item) => sum + item.freshnessScore, 0) / input.evidence.length
    : 0;
  let score: number;
  if (input.verdict === "insufficient_evidence") {
    const coverage = input.requestedQueries ? input.successfulQueries / input.requestedQueries : 0;
    const diversity = Math.min(
      new Set(input.evidence.filter((item) => item.independent).map((item) => item.domain)).size /
        3,
      1,
    );
    score = 55 * coverage + 45 * diversity;
  } else {
    const verdictFit =
      input.verdict === "supported" || input.verdict === "mostly_supported"
        ? input.support
        : input.verdict === "contradicted"
          ? input.contradiction
          : Math.max(input.support, input.contradiction);
    const conflictClarity = clamp(Math.abs(input.support - input.contradiction));
    score = 55 * verdictFit + 25 * conflictClarity + 20 * freshness;
    score -= Math.min(input.materialGapCount * 5, 20);
  }
  return {
    score: Math.round(Math.min(95, Math.max(0, score))),
    evidenceStrength: level(Math.max(input.support, input.contradiction)),
    contradiction: level(input.contradiction),
    freshness: level(freshness),
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
