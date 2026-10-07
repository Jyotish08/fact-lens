import Papa from "papaparse";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { embedTexts } from "../functions";
import {
  assetRepository,
  chunkRepository,
  type CorpusChunkRecord,
  type StoredAsset,
} from "../storage";
import type { EvidenceCorpusService } from "./types";
import { cosine } from "../vector";
import { BM25Index, reciprocalRankFusion } from "../bm25";

interface SourceText {
  text: string;
  provenance: string;
}

export class IndexedDbEvidenceCorpusService implements EvidenceCorpusService {
  constructor(
    private readonly sessionId: string,
    private readonly sessionToken: string,
  ) {}

  async register(files: File[]) {
    const stored = await assetRepository.list(this.sessionId, "corpus");
    const assets = stored.length
      ? stored
      : await assetRepository.storeCorpus(this.sessionId, files);
    const records: CorpusChunkRecord[] = [];
    let totalCharacters = 0;
    for (const asset of assets) {
      if (!asset.source) continue;
      await assetRepository.updateSource(asset.id, { parserStatus: "parsing" });
      try {
        const sections = await parseAsset(asset);
        const chunks = sections.flatMap((section) => chunkSection(section));
        const remainingCharacters = Math.max(0, 1_000_000 - totalCharacters);
        const accepted = chunks
          .map((chunk) => ({ ...chunk, text: chunk.text.slice(0, remainingCharacters) }))
          .filter((chunk) => chunk.text)
          .slice(0, Math.max(0, 300 - records.length));
        totalCharacters += accepted.reduce((sum, chunk) => sum + chunk.text.length, 0);
        await assetRepository.updateSource(asset.id, {
          parserStatus: "indexing",
          chunkCount: accepted.length,
          ...(asset.source.kind === "pdf" ? { pageCount: sections.length } : {}),
          ...(asset.source.kind === "csv" ? { rowCount: sections.length } : {}),
        });
        const vectors: number[][] = [];
        for (let index = 0; index < accepted.length; index += 32) {
          const batch = accepted.slice(index, index + 32);
          const embedded = await embedTexts({
            data: {
              texts: batch.map((chunk) => chunk.text),
              purpose: "document",
              sessionId: this.sessionId,
              sessionToken: this.sessionToken,
            },
          });
          vectors.push(...embedded.vectors);
        }
        accepted.forEach((chunk, index) => {
          records.push({
            id: `${asset.source!.id}:chunk:${index}`,
            sessionId: this.sessionId,
            sourceId: asset.source!.id,
            sourceName: asset.source!.name,
            provenance: chunk.provenance,
            text: chunk.text,
            vector: vectors[index]!,
          });
        });
        await assetRepository.updateSource(asset.id, {
          parserStatus: "ready",
          chunkCount: accepted.length,
        });
      } catch (error) {
        await assetRepository.updateSource(asset.id, {
          parserStatus: "error",
          indexingError: error instanceof Error ? error.message : "Could not index file",
        });
      }
    }
    await chunkRepository.replace(this.sessionId, records);
  }

  async contextForClaim(claim: string) {
    const chunks = await chunkRepository.list(this.sessionId);
    if (!chunks.length) return "";
    let queryVector: number[] | undefined;
    try {
      const embedded = await embedTexts({
        data: {
          texts: [claim],
          purpose: "query",
          sessionId: this.sessionId,
          sessionToken: this.sessionToken,
        },
      });
      queryVector = embedded.vectors[0];
    } catch {
      queryVector = undefined;
    }

    const selected = rankCorpusChunksHybrid(claim, chunks, queryVector).slice(0, 8);
    let length = 0;
    const context: string[] = [];
    for (const chunk of selected) {
      const entry = `[custom:${chunk.sourceId} | ${chunk.sourceName} | ${chunk.provenance}]\n${chunk.text}`;
      if (length + entry.length > 12_000) break;
      length += entry.length;
      context.push(entry);
    }
    return context.join("\n\n");
  }

  clear() {
    return assetRepository.deleteSession(this.sessionId);
  }
}

export function rankCorpusChunksHybrid(
  claim: string,
  chunks: CorpusChunkRecord[],
  queryVector?: number[],
): CorpusChunkRecord[] {
  if (!chunks.length) return [];

  // 1. BM25 over chunks
  const bm25Docs = chunks.map((c) => ({ id: c.id, text: c.text, data: c }));
  const bm25Index = new BM25Index(bm25Docs, { k1: 1.2, b: 0.75 });
  const bm25Results = bm25Index.search(claim);
  const bm25Ranked = bm25Results.map((r) => ({ id: r.id }));

  // 2. Cosine ranking if queryVector is available
  let cosineRanked: Array<{ id: string }> = [];
  if (queryVector && queryVector.length > 0) {
    const scored = chunks.map((chunk) => ({
      id: chunk.id,
      score: cosine(queryVector, chunk.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    cosineRanked = scored.map((s) => ({ id: s.id }));
  }

  // 3. Reciprocal Rank Fusion (k=60)
  const rankings = [bm25Ranked, cosineRanked].filter((r) => r.length > 0);
  const fused = reciprocalRankFusion(rankings, 60);

  const chunkMap = new Map(chunks.map((c) => [c.id, c]));
  const orderedChunks: CorpusChunkRecord[] = [];

  for (const item of fused) {
    const chunk = chunkMap.get(item.id as string);
    if (chunk) {
      orderedChunks.push(chunk);
    }
  }

  // Append any chunks that had zero score in both
  for (const c of chunks) {
    if (!orderedChunks.some((oc) => oc.id === c.id)) {
      orderedChunks.push(c);
    }
  }

  return orderedChunks;
}

async function parseAsset(asset: StoredAsset): Promise<SourceText[]> {
  const kind = asset.source?.kind;
  if (kind === "txt")
    return [{ text: (await asset.file.text()).slice(0, 1_000_000), provenance: "text" }];
  if (kind === "csv") {
    const parsed = Papa.parse<string[]>(await asset.file.text(), { skipEmptyLines: true });
    if (parsed.errors.length) throw new Error(parsed.errors[0]?.message ?? "CSV parsing failed");
    return parsed.data.map((row, index) => ({
      text: row.join(" | "),
      provenance: `row ${index + 1}`,
    }));
  }
  if (kind === "pdf") {
    const signature = new TextDecoder().decode(
      new Uint8Array(await asset.file.slice(0, 5).arrayBuffer()),
    );
    if (signature !== "%PDF-") throw new Error("PDF signature is invalid");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const document = await pdfjs.getDocument({
      data: new Uint8Array(await asset.file.arrayBuffer()),
    }).promise;
    const pages: SourceText[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ text, provenance: `page ${pageNumber}` });
    }
    return pages;
  }
  throw new Error("Unsupported evidence file");
}

function chunkSection(section: SourceText) {
  const chunks: SourceText[] = [];
  for (let start = 0; start < section.text.length; start += 2_700) {
    chunks.push({ text: section.text.slice(start, start + 3_000), provenance: section.provenance });
  }
  return chunks;
}
