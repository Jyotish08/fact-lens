import pLimit from "p-limit";
import type { Passage, VerifierOutput } from "../types";
import type { Verifier } from "./types";
import {
  verifyPrompt,
  verifyPromptVersion,
  type VerifyOutput,
} from "../../prompts/verify";
import { structuredCompletion } from "../../openai.server";
import { getServerConfig } from "../../config.server";

export function locateSpanInText(
  passageText: string,
  quote: string | null,
): { start: number; end: number } | null {
  if (!quote || quote.trim().length === 0) return null;

  const trimmed = quote.trim();
  const directIdx = passageText.indexOf(trimmed);
  if (directIdx !== -1) {
    return { start: directIdx, end: directIdx + trimmed.length };
  }

  // Case-insensitive direct match
  const lowerPassage = passageText.toLowerCase();
  const lowerQuote = trimmed.toLowerCase();
  const lowerIdx = lowerPassage.indexOf(lowerQuote);
  if (lowerIdx !== -1) {
    return { start: lowerIdx, end: lowerIdx + trimmed.length };
  }

  // Whitespace-collapsed match
  const normalize = (s: string) => s.replace(/\s+/g, " ");
  const normQuote = normalize(lowerQuote);
  const normPassage = normalize(lowerPassage);

  const normIdx = normPassage.indexOf(normQuote);
  if (normIdx !== -1) {
    // Approximate mapping back: match first 15 chars and last 15 chars in original
    const head = trimmed.slice(0, Math.min(15, trimmed.length)).toLowerCase();
    const headIdx = lowerPassage.indexOf(head);
    if (headIdx !== -1) {
      const tail = trimmed.slice(-Math.min(15, trimmed.length)).toLowerCase();
      const tailIdx = lowerPassage.indexOf(tail, headIdx);
      if (tailIdx !== -1) {
        return { start: headIdx, end: tailIdx + tail.length };
      }
      return { start: headIdx, end: Math.min(headIdx + trimmed.length, passageText.length) };
    }
  }

  return null;
}

export class LlmVerifier implements Verifier {
  public readonly id: string;
  private concurrency: number;

  constructor(options?: { concurrency?: number }) {
    const config = getServerConfig();
    this.id = `llm:${config.fastModel}@${verifyPromptVersion}`;
    this.concurrency = options?.concurrency ?? 6;
  }

  async verify(
    input: { hypothesis: string; passages: Passage[] },
    signal?: AbortSignal,
  ): Promise<VerifierOutput[]> {
    const { hypothesis, passages } = input;
    if (passages.length === 0) return [];

    const limit = pLimit(this.concurrency);
    const results: VerifierOutput[] = [];

    const tasks = passages.map((passage) =>
      limit(async () => {
        if (signal?.aborted) return null;
        try {
          const raw: VerifyOutput = await structuredCompletion({
            system: verifyPrompt.system,
            user: verifyPrompt.buildUser({
              hypothesis,
              passageText: passage.contextText,
            }),
            output: verifyPrompt.output,
            jsonSchema: verifyPrompt.jsonSchema,
            ...(signal ? { signal } : {}),
          });

          // Normalize probabilities to sum to 1.0
          const e = Math.max(0, raw.probs.entail ?? 0);
          const n = Math.max(0, raw.probs.neutral ?? 0);
          const c = Math.max(0, raw.probs.contradict ?? 0);
          const sum = e + n + c || 1;

          const normE = Math.round((e / sum) * 1000) / 1000;
          const normN = Math.round((n / sum) * 1000) / 1000;
          const normC = Math.round((c / sum) * 1000) / 1000;

          const supportSpan = locateSpanInText(passage.text, raw.quote);

          return {
            passageId: passage.passageId,
            entail: normE,
            neutral: normN,
            contradict: normC,
            supportSpan,
            verifierId: this.id,
          } satisfies VerifierOutput;
        } catch {
          // If a passage verifier call fails, return null so it can be recorded as a failure
          // and NEVER treated as neutral or supporting evidence.
          return null;
        }
      }),
    );

    const settled = await Promise.all(tasks);
    for (const item of settled) {
      if (item !== null) {
        results.push(item);
      }
    }

    return results;
  }
}
