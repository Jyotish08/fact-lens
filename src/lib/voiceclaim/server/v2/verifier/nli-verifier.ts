import pLimit from "p-limit";
import type { Passage, VerifierOutput } from "../types";
import type { Verifier } from "./types";
import { locateSpanInText } from "./llm-verifier";
import { getServerConfig } from "../../config.server";

export interface NliVerifierOptions {
  endpointUrl?: string | undefined;
  apiKey?: string | undefined;
  concurrency?: number | undefined;
  maxCharsPerChunk?: number | undefined;
  fetchFn?: typeof fetch | undefined;
  id?: string | undefined;
}

export class NliVerifier implements Verifier {
  public readonly id: string;
  private endpointUrl?: string | undefined;
  private apiKey?: string | undefined;
  private concurrency: number;
  private maxCharsPerChunk: number;
  private fetchFn: typeof fetch;

  constructor(options?: NliVerifierOptions) {
    const config = getServerConfig();
    this.endpointUrl = options?.endpointUrl ?? config.nliEndpointUrl;
    this.apiKey = options?.apiKey ?? config.nliApiKey;
    this.concurrency = options?.concurrency ?? 6;
    this.maxCharsPerChunk = options?.maxCharsPerChunk ?? 1200;
    this.fetchFn = options?.fetchFn ?? fetch;
    this.id = options?.id ?? "nli-deberta-v3-small";
  }

  public async verify(
    input: { hypothesis: string; passages: Passage[] },
    signal?: AbortSignal,
  ): Promise<VerifierOutput[]> {
    const { hypothesis, passages } = input;
    if (passages.length === 0) return [];

    const limit = pLimit(this.concurrency);
    const tasks = passages.map((passage) =>
      limit(async () => {
        if (signal?.aborted) return null;
        return this.verifyPassage(hypothesis, passage, signal);
      }),
    );

    const settled = await Promise.all(tasks);
    return settled.filter((r): r is VerifierOutput => r !== null);
  }

  private async verifyPassage(
    hypothesis: string,
    passage: Passage,
    signal?: AbortSignal,
  ): Promise<VerifierOutput> {
    const text = passage.contextText;
    const chunks = this.chunkText(text, this.maxCharsPerChunk);

    let maxEntail = 0;
    let maxContradict = 0;
    let sumNeutral = 0;
    let bestQuote: string | null = null;
    let bestQuoteScore = 0;

    for (const chunk of chunks) {
      if (signal?.aborted) break;
      const res = await this.callNliEndpoint(hypothesis, chunk, signal);

      if (res.entail > maxEntail) {
        maxEntail = res.entail;
      }
      if (res.contradict > maxContradict) {
        maxContradict = res.contradict;
      }
      sumNeutral += res.neutral;

      const score = Math.max(res.entail, res.contradict);
      if (score > bestQuoteScore) {
        bestQuoteScore = score;
        bestQuote = this.extractBestSentence(chunk, hypothesis);
      }
    }

    const avgNeutral = chunks.length > 0 ? sumNeutral / chunks.length : 0.5;
    const total = maxEntail + maxContradict + avgNeutral || 1;

    const entail = Math.round((maxEntail / total) * 100) / 100;
    const contradict = Math.round((maxContradict / total) * 100) / 100;
    const neutral = Math.max(0, Math.round((1 - entail - contradict) * 100) / 100);

    const supportSpan = locateSpanInText(passage.text, bestQuote);

    return {
      passageId: passage.passageId,
      entail,
      neutral,
      contradict,
      supportSpan,
      verifierId: this.id,
    };
  }

  private async callNliEndpoint(
    hypothesis: string,
    chunkText: string,
    signal?: AbortSignal,
  ): Promise<{ entail: number; neutral: number; contradict: number }> {
    if (this.endpointUrl) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (this.apiKey) {
          headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        const res = await this.fetchFn(this.endpointUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            inputs: {
              text: hypothesis,
              text_pair: chunkText,
            },
          }),
          ...(signal ? { signal } : {}),
        });

        if (res.ok) {
          const data = (await res.json()) as unknown;
          return this.parseNliApiResponse(data);
        }
      } catch {
        // Fall back to heuristic NLI
      }
    }

    return this.heuristicNli(hypothesis, chunkText);
  }

  private parseNliApiResponse(data: unknown): { entail: number; neutral: number; contradict: number } {
    let entail = 0.33;
    let neutral = 0.34;
    let contradict = 0.33;

    if (Array.isArray(data)) {
      const items = Array.isArray(data[0]) ? data[0] : data;
      for (const item of items) {
        if (typeof item === "object" && item !== null && "label" in item && "score" in item) {
          const l = String(item.label).toLowerCase();
          const s = Number(item.score) || 0;
          if (l.includes("entail") || l === "label_0" || l === "pos") entail = s;
          else if (l.includes("contra") || l === "label_2" || l === "neg") contradict = s;
          else if (l.includes("neut") || l === "label_1") neutral = s;
        }
      }
    } else if (typeof data === "object" && data !== null) {
      const d = data as Record<string, number>;
      if (typeof d["entail"] === "number") entail = d["entail"];
      if (typeof d["neutral"] === "number") neutral = d["neutral"];
      if (typeof d["contradict"] === "number") contradict = d["contradict"];
    }

    const sum = entail + neutral + contradict || 1;
    return {
      entail: entail / sum,
      neutral: neutral / sum,
      contradict: contradict / sum,
    };
  }

  private heuristicNli(
    hypothesis: string,
    chunkText: string,
  ): { entail: number; neutral: number; contradict: number } {
    const hypTokens = hypothesis.toLowerCase().match(/\b[a-z0-9]+(?:\.[0-9]+)?%?\b/gi) || [];
    const chunkLower = chunkText.toLowerCase();

    if (hypTokens.length === 0) {
      return { entail: 0.1, neutral: 0.8, contradict: 0.1 };
    }

    let matchCount = 0;
    for (const t of hypTokens) {
      if (chunkLower.includes(t)) matchCount++;
    }
    const ratio = matchCount / hypTokens.length;

    const negationCues = ["not", "never", "denied", "refuted", "false", "incorrect", "disputed", "failed"];
    const hasNegation = negationCues.some((neg) => chunkLower.includes(` ${neg} `));

    if (ratio > 0.6) {
      if (hasNegation) {
        return { entail: 0.10, neutral: 0.20, contradict: 0.70 };
      }
      return { entail: 0.75, neutral: 0.20, contradict: 0.05 };
    }

    if (ratio > 0.3) {
      return { entail: 0.35, neutral: 0.50, contradict: 0.15 };
    }

    return { entail: 0.10, neutral: 0.80, contradict: 0.10 };
  }

  private chunkText(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [text];
    const chunks: string[] = [];
    let current = "";

    for (const s of sentences) {
      if (current.length + s.length <= maxChars) {
        current += s;
      } else {
        if (current.trim()) chunks.push(current.trim());
        current = s;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [text];
  }

  private extractBestSentence(text: string, hypothesis: string): string | null {
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
    if (!sentences || sentences.length === 0) return text.slice(0, 200).trim();

    const hypWords = new Set(hypothesis.toLowerCase().split(/\s+/).filter(Boolean));
    let bestSentence = sentences[0]!.trim();
    let maxOverlap = 0;

    for (const sentence of sentences) {
      const sWords = sentence.toLowerCase().split(/\s+/).filter(Boolean);
      let overlap = 0;
      for (const w of sWords) {
        if (hypWords.has(w)) overlap++;
      }
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestSentence = sentence.trim();
      }
    }

    return bestSentence;
  }
}
