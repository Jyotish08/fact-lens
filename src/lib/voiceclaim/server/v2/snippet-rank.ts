import type { AtomicClaim, SourceTier } from "../../types";
import type { SearchHit } from "../bright-data.server";
import { classifySource } from "./source-registry";

export interface RankedHit extends SearchHit {
  score: number;
  lexicalScore: number;
  cosineScore: number;
  tierScore: number;
  side?: "support" | "challenge";
}

export interface RankSnippetsOptions {
  claim: AtomicClaim;
  hits: Array<SearchHit & { side?: "support" | "challenge" }>;
  k?: number;
  embeddingFn?: (texts: string[]) => Promise<number[][]>;
}

const TIER_PRIORS: Record<SourceTier, number> = {
  primary_official: 1.0,
  primary_org: 0.85,
  established_news: 0.75,
  user_corpus: 0.8,
  secondary: 0.5,
  social: 0.2,
};

export async function rankSnippetsBeforeScrape(options: RankSnippetsOptions): Promise<RankedHit[]> {
  const { claim, hits, k = claim.depth === "deep" ? 6 : 4, embeddingFn } = options;
  if (!hits.length) return [];

  // Extract key terms from claim for lexical scoring
  const subjectTokens = (claim.frame?.subject || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const claimWords = claim.normalizedClaim
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const quantities = (claim.frame?.quantities || []).map((q) => String(q.value));
  const yearMatch = claim.normalizedClaim.match(/\b(19|20)\d{2}\b/g) || [];
  const targetTerms = [...new Set([...subjectTokens, ...claimWords, ...quantities, ...yearMatch])];

  // Optional cosine embeddings
  let cosineScores: number[] = new Array(hits.length).fill(0.5);
  if (embeddingFn) {
    try {
      const textsToEmbed = [
        claim.normalizedClaim,
        ...hits.map((h) => `${h.title}: ${h.snippet}`.slice(0, 500)),
      ];
      const vectors = await embeddingFn(textsToEmbed);
      const claimVec = vectors[0];
      if (claimVec) {
        for (let i = 0; i < hits.length; i++) {
          const docVec = vectors[i + 1];
          if (docVec) {
            cosineScores[i] = computeCosineSimilarity(claimVec, docVec);
          }
        }
      }
    } catch {
      // Graceful fallback to lexical when embedding fails
      cosineScores = new Array(hits.length).fill(0.5);
    }
  }

  const scoredHits: RankedHit[] = hits.map((hit, index) => {
    const text = `${hit.title} ${hit.snippet}`.toLowerCase();

    // 1. Lexical score (term overlap)
    let matched = 0;
    if (targetTerms.length > 0) {
      for (const term of targetTerms) {
        if (text.includes(term.toLowerCase())) {
          matched += 1;
        }
      }
    }
    const lexicalScore = targetTerms.length > 0 ? Math.min(1, matched / Math.min(targetTerms.length, 6)) : 0.5;

    // 2. Cosine score
    const cosineScore = Math.max(0, Math.min(1, cosineScores[index] ?? 0.5));

    // 3. Tier score
    const classification = classifySource(hit.url, claim.frame?.subject, claim.frame?.claimType);
    const tierScore = TIER_PRIORS[classification.tier] ?? 0.5;

    // Total score
    const score = 0.4 * lexicalScore + 0.4 * cosineScore + 0.2 * tierScore;

    return {
      ...hit,
      score: Number(score.toFixed(4)),
      lexicalScore: Number(lexicalScore.toFixed(4)),
      cosineScore: Number(cosineScore.toFixed(4)),
      tierScore: Number(tierScore.toFixed(4)),
    };
  });

  // Sort descending by score
  scoredHits.sort((a, b) => b.score - a.score);

  // Polarity balance: ensure at least 1 challenge hit in top K when available
  const hasChallenge = scoredHits.some((h) => h.side === "challenge");
  const topK = scoredHits.slice(0, k);

  if (hasChallenge && !topK.some((h) => h.side === "challenge")) {
    const firstChallenge = scoredHits.find((h) => h.side === "challenge");
    if (firstChallenge && topK.length > 0) {
      topK[topK.length - 1] = firstChallenge;
    }
  }

  return topK;
}

function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (!normA || !normB) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return (sim + 1) / 2; // Normalize -1..1 to 0..1
}
