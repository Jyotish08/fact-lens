import { BM25Index, reciprocalRankFusion } from "../../bm25";
import { cosine } from "../../vector";
import type { Passage } from "./types";

export interface RankPassagesOptions {
  claimText: string;
  passages: Passage[];
  depth?: "quick" | "deep";
  maxPerDoc?: number;
  globalCap?: number;
  embeddingFn?: (texts: string[]) => Promise<number[][]>;
}

export async function rankPassagesHybrid(options: RankPassagesOptions): Promise<Passage[]> {
  const {
    claimText,
    passages,
    depth = "quick",
    maxPerDoc = 3,
    globalCap = depth === "deep" ? 20 : 12,
    embeddingFn,
  } = options;

  if (!passages.length) return [];

  // 1. BM25 ranking over all passages
  const bm25Docs = passages.map((p) => ({
    id: p.passageId,
    text: p.text,
    data: p,
  }));
  const bm25Index = new BM25Index(bm25Docs, { k1: 1.2, b: 0.75 });
  const bm25Results = bm25Index.search(claimText);
  const bm25Ranked = bm25Results.map((r) => ({ id: r.id }));

  // 2. Embedding cosine ranking (optional / fallback on failure)
  let cosineRanked: Array<{ id: string }> = [];
  if (embeddingFn) {
    try {
      // Limit to ~150 passages if needed, truncate each text to ~1200 chars (~300 tokens)
      const passagesToEmbed = passages.slice(0, 150);
      const textsToEmbed = [
        claimText,
        ...passagesToEmbed.map((p) => p.text.slice(0, 1200)),
      ];
      const vectors = await embeddingFn(textsToEmbed);
      const claimVec = vectors[0];

      if (claimVec) {
        const scored = passagesToEmbed.map((p, idx) => {
          const docVec = vectors[idx + 1];
          const sim = docVec ? cosine(claimVec, docVec) : 0;
          return { id: p.passageId, score: sim };
        });
        scored.sort((a, b) => b.score - a.score);
        cosineRanked = scored.map((s) => ({ id: s.id }));
      }
    } catch {
      // Graceful fallback to BM25-only on embedding failure
      cosineRanked = [];
    }
  }

  // 3. Reciprocal Rank Fusion (k = 60)
  const rankings = [bm25Ranked, cosineRanked].filter((r) => r.length > 0);
  const fusedScores = reciprocalRankFusion(rankings, 60);
  const scoreMap = new Map(fusedScores.map((item) => [item.id, item.score]));

  // 4. Map passages with normalized relevance scores
  const passageMap = new Map(passages.map((p) => [p.passageId, p]));
  const scoredPassages: Passage[] = [];

  for (const fused of fusedScores) {
    const p = passageMap.get(fused.id as string);
    if (p) {
      scoredPassages.push({
        ...p,
        relevance: fused.score,
      });
    }
  }

  // Include any passages not present in fused (e.g. if capped)
  for (const p of passages) {
    if (!scoreMap.has(p.passageId)) {
      scoredPassages.push({
        ...p,
        relevance: 0,
      });
    }
  }

  // 5. Select top maxPerDoc per docId, up to globalCap
  const selected: Passage[] = [];
  const docCounts = new Map<string, number>();

  for (const p of scoredPassages) {
    const currentCount = docCounts.get(p.docId) ?? 0;
    if (currentCount < maxPerDoc) {
      selected.push(p);
      docCounts.set(p.docId, currentCount + 1);
      if (selected.length >= globalCap) {
        break;
      }
    }
  }

  return selected;
}
