import type { SourceDocument } from "./types";

export interface IndependenceCluster {
  clusterId: string;
  docIds: string[];
  primaryDomain: string;
  wireMarker: string | null;
  hasSelfSource: boolean;
}

export interface ClusteringOptions {
  wireJaccardThreshold?: number; // default 0.30
  generalJaccardThreshold?: number; // default 0.50
}

/**
 * Generates word n-shingles from text.
 */
export function getWordShingles(text: string, n: number = 5): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const shingles = new Set<string>();
  if (words.length < n) {
    if (words.length > 0) {
      shingles.add(words.join(" "));
    }
    return shingles;
  }

  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(" "));
  }
  return shingles;
}

/**
 * Computes Jaccard similarity between two sets of shingles.
 */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Disjoint-set / Union-Find data structure for clustering.
 */
class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i: number): number {
    if (this.parent[i] === i) return i;
    this.parent[i] = this.find(this.parent[i]!);
    return this.parent[i]!;
  }

  union(i: number, j: number) {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      this.parent[rootJ] = rootI;
    }
  }
}

/**
 * Clusters documents by domain identity, syndicated wire markers, and shingle similarity.
 */
export function clusterDocuments(
  docs: SourceDocument[],
  options?: ClusteringOptions,
): Map<string, string> {
  // Returns map from docId -> clusterId
  const clusterMap = new Map<string, string>();
  if (docs.length === 0) return clusterMap;

  const wireThreshold = options?.wireJaccardThreshold ?? 0.30;
  const generalThreshold = options?.generalJaccardThreshold ?? 0.50;

  const n = docs.length;
  const uf = new UnionFind(n);

  // Pre-calculate word 5-shingles for each document's cleanedText
  const shinglesList = docs.map((d) => getWordShingles(d.cleanedText, 5));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const docA = docs[i]!;
      const docB = docs[j]!;

      // Rule 1: Same registrable domain
      if (
        docA.registrableDomain &&
        docB.registrableDomain &&
        docA.registrableDomain === docB.registrableDomain
      ) {
        uf.union(i, j);
        continue;
      }

      const sim = jaccardSimilarity(shinglesList[i]!, shinglesList[j]!);

      // Rule 2: Same wire / PR syndication marker with moderate similarity
      if (
        docA.wireMarker &&
        docB.wireMarker &&
        docA.wireMarker.toLowerCase() === docB.wireMarker.toLowerCase() &&
        sim >= wireThreshold
      ) {
        uf.union(i, j);
        continue;
      }

      // Rule 3: High textual shingle overlap across different domains
      if (sim >= generalThreshold) {
        uf.union(i, j);
      }
    }
  }

  // Assign stable cluster IDs (based on first member's docId or canonical domain)
  const rootToClusterId = new Map<number, string>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!rootToClusterId.has(root)) {
      const rootDoc = docs[root]!;
      const domainSlug = rootDoc.registrableDomain.replace(/[^a-zA-Z0-9]/g, "-") || "cluster";
      rootToClusterId.set(root, `c-${domainSlug}-${rootDoc.docId}`);
    }
    clusterMap.set(docs[i]!.docId, rootToClusterId.get(root)!);
  }

  return clusterMap;
}
