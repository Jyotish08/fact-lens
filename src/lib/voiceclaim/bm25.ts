/**
 * Isomorphic BM25 index and Reciprocal Rank Fusion (RRF) for passage and corpus retrieval.
 * Works in both browser (IndexedDB corpus search) and server (passage ranking).
 */

export function tokenize(text: string): string[] {
  if (!text) return [];
  const matches = text.toLowerCase().match(/[\$£€¥]?\d+(?:[.,]\d+)?%?|\b[a-z0-9]+(?:'[a-z]+)?\b/gi);
  return matches || [];
}

export interface BM25Document<T = unknown> {
  id: string;
  text: string;
  data?: T | undefined;
}

export interface BM25ScoredResult<T = unknown> {
  id: string;
  score: number;
  data?: T | undefined;
}

export class BM25Index<T = unknown> {
  private k1: number;
  private b: number;
  private docs: Array<{
    id: string;
    tokens: string[];
    termFreqs: Map<string, number>;
    len: number;
    data?: T | undefined;
  }> = [];
  private avgdl: number = 0;
  private docFreqs: Map<string, number> = new Map();
  private N: number = 0;

  constructor(docs: Array<BM25Document<T>>, options?: { k1?: number; b?: number }) {
    this.k1 = options?.k1 ?? 1.2;
    this.b = options?.b ?? 0.75;
    this.index(docs);
  }

  private index(docs: Array<BM25Document<T>>) {
    this.N = docs.length;
    if (this.N === 0) return;

    let totalLength = 0;
    this.docs = docs.map((doc) => {
      const tokens = tokenize(doc.text);
      const len = tokens.length;
      totalLength += len;

      const termFreqs = new Map<string, number>();
      const seen = new Set<string>();

      for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
        if (!seen.has(token)) {
          seen.add(token);
          this.docFreqs.set(token, (this.docFreqs.get(token) ?? 0) + 1);
        }
      }

      return {
        id: doc.id,
        tokens,
        termFreqs,
        len,
        data: doc.data,
      };
    });

    this.avgdl = totalLength / (this.N || 1);
  }

  public search(query: string): Array<BM25ScoredResult<T>> {
    if (this.N === 0) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return this.docs.map((d) => ({ id: d.id, score: 0, data: d.data }));
    }

    const uniqueQueryTokens = Array.from(new Set(queryTokens));
    const results: Array<BM25ScoredResult<T>> = [];

    for (const doc of this.docs) {
      let score = 0;
      const dl = doc.len;
      const lenNorm = this.avgdl > 0 ? dl / this.avgdl : 1;

      for (const token of uniqueQueryTokens) {
        const tf = doc.termFreqs.get(token) ?? 0;
        if (tf === 0) continue;

        const df = this.docFreqs.get(token) ?? 0;
        // Robertson-Spärck Jones IDF with +1 smoothing to ensure non-negative IDF
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
        const num = tf * (this.k1 + 1);
        const den = tf + this.k1 * (1 - this.b + this.b * lenNorm);
        score += idf * (num / den);
      }

      results.push({
        id: doc.id,
        score,
        data: doc.data,
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

/**
 * Reciprocal Rank Fusion (RRF) combines rankings from multiple retrieval algorithms.
 * @param rankings Array of ordered result lists (each ordered from rank 1 to M)
 * @param k Constant damping factor (default 60)
 */
export function reciprocalRankFusion<T extends string | number>(
  rankings: Array<Array<{ id: T }>>,
  k: number = 60,
): Array<{ id: T; score: number }> {
  const scores = new Map<T, number>();

  for (const ranking of rankings) {
    ranking.forEach((item, index) => {
      const rank = index + 1;
      const current = scores.get(item.id) ?? 0;
      scores.set(item.id, current + 1 / (k + rank));
    });
  }

  const numRankers = rankings.filter((r) => r.length > 0).length || 1;
  const maxPossibleScore = numRankers * (1 / (k + 1));

  return Array.from(scores.entries())
    .map(([id, rawScore]) => ({
      id,
      score: rawScore / maxPossibleScore,
    }))
    .sort((a, b) => b.score - a.score);
}
