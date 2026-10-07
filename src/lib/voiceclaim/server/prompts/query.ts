import { z } from "zod";
import { wrapUntrusted } from "./untrusted";

export const queryPromptId = "query";
export const queryPromptVersion = "query.v1";

export const querySystemPrompt =
  "Generate search queries to verify and challenge a factual claim. Output exactly 2 supporting queries (aimed at corroborating the claim) and 2 contradictory queries (aimed at finding refutations or opposing evidence). Keep queries focused, concise, and keyword-oriented. Avoid boolean operators not widely supported. Return valid JSON only.";

export const queryOutputSchema = z.object({
  supporting: z.array(z.string().min(3).max(500)).min(2).max(2),
  contradictory: z.array(z.string().min(3).max(500)).min(2).max(2),
});

export type QueryOutput = z.infer<typeof queryOutputSchema>;

export const queryJsonSchema = {
  name: "verification_queries",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["supporting", "contradictory"],
    properties: {
      supporting: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
      contradictory: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    },
  },
};

export interface QueryPromptInput {
  claim: string;
  mode: string;
  round: number;
  knownDomains: string[];
}

export function buildQueryUserPrompt(input: QueryPromptInput): string {
  const safeClaim = wrapUntrusted("claim", input.claim);
  const domainsText = input.knownDomains.length ? input.knownDomains.join(", ") : "none";
  return `${safeClaim}\nMode: ${input.mode}\nRound: ${input.round}\nKnown source domains: ${domainsText}`;
}

export const queryPrompt = {
  id: queryPromptId,
  version: queryPromptVersion,
  system: querySystemPrompt,
  output: queryOutputSchema,
  jsonSchema: queryJsonSchema,
  buildUser: buildQueryUserPrompt,
};

export const queryV2PromptVersion = "query.v2";

export const queryV2SystemPrompt =
  "Generate search queries to verify and challenge a factual claim. Output 1 to 3 supporting queries (aimed at corroborating the claim) and 1 to 3 contradictory queries (aimed at finding refutations or opposing evidence). Keep queries concise, keyword-focused, and under 300 characters. Return valid JSON only.";

export const queryV2OutputSchema = z.object({
  supporting: z.array(z.string().min(3).max(300)).min(1).max(3),
  contradictory: z.array(z.string().min(3).max(300)).min(1).max(3),
});

export type QueryV2Output = z.infer<typeof queryV2OutputSchema>;

export const queryV2JsonSchema = {
  name: "verification_queries",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["supporting", "contradictory"],
    properties: {
      supporting: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
      contradictory: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    },
  },
};

export interface QueryV2PromptInput {
  claim: string;
  mode: string;
  round?: number | undefined;
  missingAspects?: string[] | undefined;
}

export function buildQueryV2UserPrompt(input: QueryV2PromptInput): string {
  const safeClaim = wrapUntrusted("claim", input.claim);
  const aspectsText = input.missingAspects?.length ? input.missingAspects.join("; ") : "none";
  return `${safeClaim}\nMode: ${input.mode}\nRound: ${input.round ?? 1}\nMissing evidentiary aspects: ${aspectsText}`;
}

export const queryV2Prompt = {
  id: queryPromptId,
  version: queryV2PromptVersion,
  system: queryV2SystemPrompt,
  output: queryV2OutputSchema,
  jsonSchema: queryV2JsonSchema,
  buildUser: buildQueryV2UserPrompt,
};
