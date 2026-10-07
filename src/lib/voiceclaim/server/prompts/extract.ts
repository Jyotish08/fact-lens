import { z } from "zod";
import { wrapUntrusted } from "./untrusted";
import { claimFrameSchema, claimQuantitySchema } from "../../schemas";
import type { ConversationContextSnapshot } from "../../types";

export const extractPromptId = "claim_extraction";
export const extractPromptVersion = "extract.v3";

export const extractSystemPrompt =
  "You are an expert fact-checking claim extractor and frame parser. Classify the exact transcript chunk and decompose objectively verifiable compound statements into self-contained atomic claims with structured ClaimFrames.\n" +
  "Rules:\n" +
  "1. Classify as verifiable_fact only if there is at least one verifiable factual claim; otherwise classify as context, opinion, or prediction.\n" +
  "2. For each claim, extract subject (named entity, or empty string if unresolved), claimType (quantity, ranking, event, attribute, causal, self_report).\n" +
  "3. Extract numeric quantities (raw, value, unit, comparator: exact/approx/at_least/at_most).\n" +
  "4. Extract temporalExpression exactly as spoken or inferred (e.g., 'last year', 'in 2024', 'Q3'). NEVER invent dates or absolute years not implied by the text.\n" +
  "5. If speaker corrects themselves (self-repair, e.g. 'twenty, sorry thirty'), use the corrected value and set selfRepairApplied=true.\n" +
  "6. Preserve conditional premises in both condition and normalizedClaim.\n" +
  "7. Use the supplied conversation context only to resolve a pronoun or definite noun phrase. When resolution is confident (>=0.70), rewrite normalizedClaim as a self-contained assertion and return resolution with the exact antecedent segment ID.\n" +
  "8. If a pronoun or noun phrase cannot be resolved confidently, leave subject empty and set unresolvedReferent=true. Never guess an antecedent.\n" +
  "9. Set discourseRelation relative to recent claims: new_claim, modifies_previous, provides_context, contradicts_earlier, or duplicate.\n" +
  "10. requiresMoreContext is true only if an incomplete sentence fragment prevents reliable classification.";

export const contextualResolutionDraftSchema = z.object({
  surfaceForm: z.string().min(1).max(500),
  resolvedReferent: z.string().min(1).max(500),
  antecedentSegmentId: z.string().min(1).max(100),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(2_000),
});

export const claimFrameDraftSchema = z.object({
  subject: z.string().default(""),
  claimType: z.enum(["quantity", "ranking", "event", "attribute", "causal", "self_report"]).default("attribute"),
  quantities: z.array(claimQuantitySchema).default([]),
  temporalExpression: z.string().nullable().default(null),
  scope: z.string().nullable().default(null),
  condition: z.string().nullable().default(null),
  modality: z.enum(["asserted", "reported_speech", "hedged"]).default("asserted"),
  unresolvedReferent: z.boolean().default(false),
  selfRepairApplied: z.boolean().default(false),
});

export const extractOutputSchema = z.object({
  classification: z.enum(["verifiable_fact", "opinion", "prediction", "context"]),
  requiresMoreContext: z.boolean(),
  claims: z
    .array(
      z.object({
        normalizedClaim: z.string().min(1).max(8_000),
        context: z.string().max(12_000),
        frame: claimFrameDraftSchema.optional(),
        resolution: contextualResolutionDraftSchema.optional(),
        antecedentSegmentIds: z.array(z.string().min(1).max(100)).max(100).optional(),
        discourseRelation: z.enum(["new_claim", "modifies_previous", "provides_context", "contradicts_earlier", "duplicate"]).optional(),
      }),
    )
    .max(12),
});

export type ExtractOutput = z.infer<typeof extractOutputSchema>;

export const extractJsonSchema = {
  name: "claim_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["classification", "requiresMoreContext", "claims"],
    properties: {
      classification: {
        enum: ["verifiable_fact", "opinion", "prediction", "context"],
      },
      requiresMoreContext: { type: "boolean" },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["normalizedClaim", "context"],
          properties: {
            normalizedClaim: { type: "string" },
            context: { type: "string" },
            frame: {
              type: "object",
              additionalProperties: false,
              required: ["subject", "claimType", "quantities", "modality", "unresolvedReferent", "selfRepairApplied"],
              properties: {
                subject: { type: "string" },
                claimType: {
                  enum: ["quantity", "ranking", "event", "attribute", "causal", "self_report"],
                },
                quantities: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["raw", "value", "unit", "comparator"],
                    properties: {
                      raw: { type: "string" },
                      value: { type: "number" },
                      unit: { type: "string" },
                      comparator: { enum: ["exact", "approx", "at_least", "at_most"] },
                      asrLowConfidence: { type: "boolean" },
                    },
                  },
                },
                temporalExpression: { type: ["string", "null"] },
                scope: { type: ["string", "null"] },
                condition: { type: ["string", "null"] },
                modality: { enum: ["asserted", "reported_speech", "hedged"] },
                unresolvedReferent: { type: "boolean" },
                selfRepairApplied: { type: "boolean" },
              },
            },
            resolution: {
              type: "object",
              additionalProperties: false,
              required: ["surfaceForm", "resolvedReferent", "antecedentSegmentId", "confidence", "rationale"],
              properties: {
                surfaceForm: { type: "string" },
                resolvedReferent: { type: "string" },
                antecedentSegmentId: { type: "string" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                rationale: { type: "string" },
              },
            },
            discourseRelation: { enum: ["new_claim", "modifies_previous", "provides_context", "contradicts_earlier", "duplicate"] },
            antecedentSegmentIds: { type: "array", items: { type: "string" }, maxItems: 100 },
          },
        },
      },
    },
  },
};

export interface ExtractPromptInput {
  mode: string;
  forced: boolean;
  text: string;
  previousTail?: string | undefined;
  sessionTitle?: string | undefined;
  anchorDate?: string | undefined;
  contextSnapshot?: ConversationContextSnapshot | undefined;
}

export function buildExtractUserPrompt(input: ExtractPromptInput): string {
  const parts: string[] = [
    `Mode: ${input.mode}`,
    `Session Title: ${input.sessionTitle || "Live Session"}`,
    `Authoritative Anchor Date: ${input.anchorDate || "unknown"}`,
    `Forced after two windows: ${input.forced}`,
  ];
  if (input.previousTail) {
    parts.push(`Prior Context Tail: ${wrapUntrusted("prior_tail", input.previousTail)}`);
  }
  if (input.contextSnapshot) {
    const { activeEntities, recentTurns, recentClaims } = input.contextSnapshot;
    parts.push(`Conversation Context (reference only): ${wrapUntrusted("conversation_context", JSON.stringify({ activeEntities, recentTurns, recentClaims }))}`);
  }
  parts.push(wrapUntrusted("transcript", input.text));
  return parts.join("\n");
}

export const extractPrompt = {
  id: extractPromptId,
  version: extractPromptVersion,
  system: extractSystemPrompt,
  output: extractOutputSchema,
  jsonSchema: extractJsonSchema,
  buildUser: buildExtractUserPrompt,
};
