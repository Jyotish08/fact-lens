import type { AtomicClaim } from "../../types";
import { queryV2Prompt, type QueryV2Output } from "../prompts/query";
import { structuredCompletion } from "../openai.server";

export interface PlannedQuery {
  query: string;
  side: "support" | "challenge";
  isPrimarySourceQuery?: boolean;
}

export interface PlanQueriesOptions {
  claim: AtomicClaim;
  round?: number;
  missingAspects?: string[];
  signal?: AbortSignal;
}

export async function planQueriesV2(options: PlanQueriesOptions): Promise<PlannedQuery[]> {
  const { claim, round = 1, missingAspects, signal } = options;
  let rawOutput: QueryV2Output;

  try {
    rawOutput = await structuredCompletion({
      system: queryV2Prompt.system,
      user: queryV2Prompt.buildUser({
        claim: claim.normalizedClaim,
        mode: claim.mode,
        round,
        missingAspects,
      }),
      output: queryV2Prompt.output,
      jsonSchema: queryV2Prompt.jsonSchema,
      ...(signal ? { signal } : {}),
    });
  } catch (err: unknown) {
    // Deterministic fallback if LLM completion fails
    rawOutput = {
      supporting: [
        claim.normalizedClaim,
        `${claim.frame?.subject || claim.normalizedClaim} official records`,
      ],
      contradictory: [
        `${claim.normalizedClaim} refutation`,
        `${claim.frame?.subject || claim.normalizedClaim} controversy counter-evidence`,
      ],
    };
  }

  const planned: PlannedQuery[] = [];
  const seen = new Set<string>();

  const temporalTerm = extractTemporalTerm(claim);

  // 1. Post-process supporting queries
  for (const rawQ of rawOutput.supporting) {
    const q = enrichQuery(rawQ, temporalTerm);
    const key = normalizeKey(q);
    if (!seen.has(key)) {
      seen.add(key);
      planned.push({ query: q, side: "support" });
    }
  }

  // 2. Post-process contradictory queries
  for (const rawQ of rawOutput.contradictory) {
    const q = enrichQuery(rawQ, temporalTerm);
    const key = normalizeKey(q);
    if (!seen.has(key)) {
      seen.add(key);
      planned.push({ query: q, side: "challenge" });
    }
  }

  // 3. Primary source routing query
  const primaryQuery = buildPrimarySourceQuery(claim);
  if (primaryQuery) {
    const key = normalizeKey(primaryQuery);
    if (!seen.has(key)) {
      seen.add(key);
      planned.push({ query: primaryQuery, side: "support", isPrimarySourceQuery: true });
    }
  }

  // 4. Cap at 6 total (balance support and challenge)
  return balanceAndCap(planned, 6);
}

function extractTemporalTerm(claim: AtomicClaim): string | null {
  const temporal = claim.frame?.temporal;
  if (!temporal) return null;
  if (temporal.expression && /\b(19|20)\d{2}\b/.test(temporal.expression)) {
    const yr = temporal.expression.match(/\b(19|20)\d{2}\b/)?.[0];
    return yr ?? null;
  }
  if (temporal.resolvedStart) {
    const yr = temporal.resolvedStart.slice(0, 4);
    return yr;
  }
  return null;
}

function enrichQuery(query: string, temporalTerm: string | null): string {
  let clean = query.trim().replace(/\s+/g, " ");
  if (temporalTerm && !clean.includes(temporalTerm)) {
    clean = `${clean} ${temporalTerm}`;
  }
  return clean.slice(0, 300);
}

function buildPrimarySourceQuery(claim: AtomicClaim): string | null {
  const subject = claim.frame?.subject || claim.normalizedClaim;
  const isQuant = claim.frame?.claimType === "quantity";
  const isSelf = claim.frame?.claimType === "self_report";

  if (claim.mode === "investor" && (isQuant || isSelf)) {
    return `${subject} site:sec.gov OR "annual report"`.slice(0, 300);
  }

  if (claim.mode === "academic") {
    return `${subject} doi OR pubmed OR site:nih.gov`.slice(0, 300);
  }

  return null;
}

function normalizeKey(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function balanceAndCap(queries: PlannedQuery[], maxTotal: number): PlannedQuery[] {
  const supports = queries.filter((q) => q.side === "support");
  const challenges = queries.filter((q) => q.side === "challenge");

  const result: PlannedQuery[] = [];
  const maxPerSide = Math.ceil(maxTotal / 2);

  const primarySupports = supports.filter((q) => q.isPrimarySourceQuery);
  const regularSupports = supports.filter((q) => !q.isPrimarySourceQuery);
  const selectedSupport = [...primarySupports, ...regularSupports].slice(0, maxPerSide);
  const selectedChallenge = challenges.slice(0, maxTotal - selectedSupport.length);

  result.push(...selectedSupport, ...selectedChallenge);
  return result.slice(0, maxTotal);
}
