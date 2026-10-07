import crypto from "node:crypto";
import { getDomain } from "tldts";
import type { SourceCategory, SourceTier, ClaimType } from "../../types";
import type { SourceDocument } from "./types";
import {
  ESTABLISHED_NEWS_DOMAINS,
  FACT_CHECK_DOMAINS,
  INTERGOVERNMENTAL_DOMAINS,
  SCIENTIFIC_DOMAINS,
  SOCIAL_DOMAINS,
  WIRE_SERVICE_MARKERS,
} from "./registry-data";

export interface SourceClassification {
  registrableDomain: string;
  tier: SourceTier;
  category: SourceCategory;
  selfSource: boolean;
}

export function getRegistrableDomain(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const domain = getDomain(parsed.hostname);
    return domain || parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return rawUrl.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0] || "";
  }
}

export function classifySource(
  rawUrl: string,
  claimSubject?: string,
  claimType?: ClaimType,
): SourceClassification {
  const regDomain = getRegistrableDomain(rawUrl);

  // 1. Check self-report modifier
  let selfSource = false;
  if (claimType === "self_report" && claimSubject && claimSubject.trim().length > 2) {
    const cleanSubject = claimSubject.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanDomainBase = regDomain.split(".")[0] || "";
    if (
      cleanDomainBase.length > 2 &&
      (cleanSubject.includes(cleanDomainBase) || cleanDomainBase.includes(cleanSubject))
    ) {
      selfSource = true;
      return {
        registrableDomain: regDomain,
        tier: "primary_org",
        category: "company",
        selfSource: true,
      };
    }
  }

  // 2. Specific SEC filing rule
  if (regDomain === "sec.gov") {
    return {
      registrableDomain: regDomain,
      tier: "primary_official",
      category: "financial_filing",
      selfSource,
    };
  }

  // 3. Government / Military / Intergovernmental
  if (
    regDomain.endsWith(".gov") ||
    /\.gov\.[a-z]{2}$/.test(regDomain) ||
    regDomain.endsWith(".mil") ||
    INTERGOVERNMENTAL_DOMAINS.has(regDomain)
  ) {
    return {
      registrableDomain: regDomain,
      tier: "primary_official",
      category: "government",
      selfSource,
    };
  }

  // 4. Scientific journals and registries
  if (SCIENTIFIC_DOMAINS.has(regDomain)) {
    return {
      registrableDomain: regDomain,
      tier: "primary_org",
      category: "scientific",
      selfSource,
    };
  }

  // 5. Fact-check organizations
  if (FACT_CHECK_DOMAINS.has(regDomain)) {
    return {
      registrableDomain: regDomain,
      tier: "established_news",
      category: "fact_check",
      selfSource,
    };
  }

  // 6. Established News
  if (ESTABLISHED_NEWS_DOMAINS.has(regDomain)) {
    return {
      registrableDomain: regDomain,
      tier: "established_news",
      category: "news",
      selfSource,
    };
  }

  // 7. Social Media & user-generated platforms
  if (SOCIAL_DOMAINS.has(regDomain)) {
    return {
      registrableDomain: regDomain,
      tier: "social",
      category: "social",
      selfSource,
    };
  }

  // 8. Default Secondary
  return {
    registrableDomain: regDomain,
    tier: "secondary",
    category: "news",
    selfSource,
  };
}

export function detectWireMarker(cleanedText: string): string | null {
  if (!cleanedText) return null;
  const sample = `${cleanedText.slice(0, 1500)}\n${cleanedText.slice(-1500)}`;
  for (const marker of WIRE_SERVICE_MARKERS) {
    if (sample.includes(marker)) {
      return marker;
    }
  }
  return null;
}

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  sept: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function extractPublishedDate(
  cleanedText: string,
  serpSnippet?: string,
): { publishedAt: string | null; publishedAtSource: "page_metadata" | "page_text" | "serp" | "unknown" } {
  const sample = (cleanedText || "").slice(0, 2000);

  // 1. Look for ISO date near published/updated: "Published: 2024-05-12"
  const isoNearMatch = sample.match(/(?:published|updated|posted|date)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  if (isoNearMatch) {
    return { publishedAt: isoNearMatch[1]!, publishedAtSource: "page_text" };
  }

  // 2. Look for Month D, YYYY: "October 4, 2026"
  const monthDayYearMatch = sample.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  if (monthDayYearMatch) {
    const mStr = monthDayYearMatch[1]!.toLowerCase().replace(".", "");
    const dStr = monthDayYearMatch[2]!.padStart(2, "0");
    const yStr = monthDayYearMatch[3]!;
    const mNum = MONTHS[mStr];
    if (mNum) {
      return { publishedAt: `${yStr}-${mNum}-${dStr}`, publishedAtSource: "page_text" };
    }
  }

  // 3. Fallback: SERP snippet date prefix: e.g. "Oct 4, 2026 ... snippet text"
  if (serpSnippet) {
    const serpMatch = serpSnippet.match(
      /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2}),?\s+(\d{4})\b/i,
    );
    if (serpMatch) {
      const mStr = serpMatch[1]!.toLowerCase();
      const dStr = serpMatch[2]!.padStart(2, "0");
      const yStr = serpMatch[3]!;
      const mNum = MONTHS[mStr];
      if (mNum) {
        return { publishedAt: `${yStr}-${mNum}-${dStr}`, publishedAtSource: "serp" };
      }
    }
  }

  return { publishedAt: null, publishedAtSource: "unknown" };
}

export interface CreateSourceDocumentOptions {
  docId: string;
  url: string;
  title: string;
  rawContent: string;
  retrievalEventId: string;
  tierOverride?: SourceTier;
  claimSubject?: string;
  claimType?: ClaimType;
  serpSnippet?: string;
}

export function createSourceDocument(options: CreateSourceDocumentOptions): SourceDocument {
  const {
    docId,
    url,
    title,
    rawContent,
    retrievalEventId,
    tierOverride,
    claimSubject,
    claimType,
    serpSnippet,
  } = options;

  const classification = classifySource(url, claimSubject, claimType);
  const wireMarker = detectWireMarker(rawContent);
  const dateInfo = extractPublishedDate(rawContent, serpSnippet);
  const contentHash = crypto.createHash("sha256").update(rawContent).digest("hex");

  return {
    docId,
    url,
    registrableDomain: classification.registrableDomain,
    title,
    cleanedText: rawContent,
    contentHash,
    retrievalEventId,
    publishedAt: dateInfo.publishedAt,
    publishedAtSource: dateInfo.publishedAtSource,
    tier: tierOverride ?? classification.tier,
    category: classification.category,
    wireMarker,
  };
}
