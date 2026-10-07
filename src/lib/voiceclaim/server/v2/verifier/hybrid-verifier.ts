import type { Passage, VerifierOutput } from "../types";
import type { Verifier } from "./types";
import { LlmVerifier } from "./llm-verifier";
import { NliVerifier } from "./nli-verifier";

export interface HybridVerifierOptions {
  nliVerifier?: NliVerifier | undefined;
  llmVerifier?: LlmVerifier | undefined;
  uncertainThreshold?: number | undefined;
}

/**
 * Hybrid Verifier (T31):
 * Uses fast, cost-effective NLI cross-encoder first.
 * If confidence is ambiguous (max stance probability < uncertainThreshold),
 * cascades those specific passages to the full LLM verifier.
 */
export class HybridVerifier implements Verifier {
  public readonly id = "hybrid-nli-llm";
  private nliVerifier: NliVerifier;
  private llmVerifier: LlmVerifier;
  private uncertainThreshold: number;

  constructor(options?: HybridVerifierOptions) {
    this.nliVerifier = options?.nliVerifier ?? new NliVerifier();
    this.llmVerifier = options?.llmVerifier ?? new LlmVerifier();
    this.uncertainThreshold = options?.uncertainThreshold ?? 0.60;
  }

  public async verify(
    input: { hypothesis: string; passages: Passage[] },
    signal?: AbortSignal,
  ): Promise<VerifierOutput[]> {
    const { hypothesis, passages } = input;
    if (passages.length === 0) return [];

    // Step 1: Run NLI on all passages
    const nliOutputs = await this.nliVerifier.verify({ hypothesis, passages }, signal);
    const outputMap = new Map<string, VerifierOutput>();
    for (const out of nliOutputs) {
      outputMap.set(out.passageId, out);
    }

    // Step 2: Identify uncertain passages
    const uncertainPassages: Passage[] = [];
    for (const passage of passages) {
      const out = outputMap.get(passage.passageId);
      if (!out) {
        uncertainPassages.push(passage);
        continue;
      }
      const maxProb = Math.max(out.entail, out.contradict, out.neutral);
      if (maxProb < this.uncertainThreshold) {
        uncertainPassages.push(passage);
      }
    }

    // Step 3: Cascade uncertain passages to LLM verifier
    if (uncertainPassages.length > 0 && !signal?.aborted) {
      const llmOutputs = await this.llmVerifier.verify(
        { hypothesis, passages: uncertainPassages },
        signal,
      );
      for (const llmOut of llmOutputs) {
        outputMap.set(llmOut.passageId, {
          ...llmOut,
          verifierId: `${this.id}(${llmOut.verifierId})`,
        });
      }
    }

    return passages.map((p) => outputMap.get(p.passageId)!).filter(Boolean);
  }
}
