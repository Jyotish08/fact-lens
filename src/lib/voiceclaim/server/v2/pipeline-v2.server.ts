import type {
  AtomicClaim,
  EvidenceItem,
  SessionSettings,
  VerificationResult,
  VerificationTrace,
} from "../../types";
import type { VerificationUpdate } from "../../services/types";
import type { Passage, SourceDocument, VerifierOutput } from "./types";
import { planQueriesV2 } from "./query-planner";
import { searchWeb, scrapePage } from "../bright-data.server";
import { rankSnippetsBeforeScrape } from "./snippet-rank";
import { cleanMarkdownText } from "./markdown-clean";
import { createSourceDocument } from "./source-registry";
import { segmentMarkdownPassages } from "./passages";
import { rankPassagesHybrid } from "./passage-rank";
import { clusterDocuments } from "./independence";
import { createVerifier } from "./verifier";
import { buildEvidenceItemsV2 } from "./evidence-builder";
import { aggregateEvidenceV2 } from "./aggregate";
import { determineVerdictV2 } from "./verdict";
import { computeConfidenceV2 } from "./confidence";
import { generateSynthesisV2 } from "./synthesis";
import { structuredCompletion, createEmbeddings } from "../openai.server";
import {
  contextPrompt,
  type ContextOutput,
} from "../prompts/context";
import { logPipelineEvent } from "../logging.server";
import { PROMPT_REGISTRY_VERSIONS } from "../prompts";
import { THRESHOLDS_VERSION } from "./thresholds";

export async function* runVerificationV2(
  claim: AtomicClaim,
  settings: SessionSettings,
  customContext: string,
): AsyncGenerator<VerificationUpdate> {
  const claimTraceId = crypto.randomUUID();
  const maxRounds = settings.depth === "deep" ? 3 : 1;
  const verifier = createVerifier();

  let requestedQueries = 0;
  let successfulQueries = 0;
  let attemptedPages = 0;
  let retrievedPages = 0;
  let passagesVerified = 0;
  let verifierFailures = 0;
  let budgetExhausted = false;
  let roundsRun = 0;

  const retrievalEvents: VerificationTrace["retrievalEvents"] = [];
  const documents: SourceDocument[] = [];
  const passages: Passage[] = [];
  const verifierOutputs: VerifierOutput[] = [];
  const scrapedUrls = new Set<string>();

  // T07: Per-claim budget deadline
  const budgetMs = settings.depth === "deep" ? 180_000 : 75_000;
  const budgetController = new AbortController();
  const budgetTimeout = setTimeout(() => {
    budgetController.abort(new Error("CLAIM_BUDGET_EXHAUSTED"));
  }, budgetMs);
  const signal = budgetController.signal;

  try {
    // 1. Ambiguity Gate (V0b): Skip search if claim has unresolved referent and no subject
    const resolvedSubject = claim.resolution?.resolvedReferent?.trim();
    if (claim.frame?.unresolvedReferent && !claim.frame.subject && !resolvedSubject) {
      const emptyCoverage = {
        queriesRequested: 0,
        queriesSucceeded: 0,
        pagesAttempted: 0,
        pagesRetrieved: 0,
        passagesVerified: 0,
        verifierFailures: 0,
        budgetExhausted: false,
      };

      const finalResult: VerificationResult = {
        verdict: "insufficient_evidence",
        confidence: {
          score: 15,
          evidenceStrength: "low",
          contradiction: "low",
          freshness: "low",
        },
        summary: `The claim "${claim.normalizedClaim}" lacks a resolved subject or specific entity context, making factual verification impossible.`,
        explanation: "The assertion contains ambiguous or missing referents without a known entity context.",
        challengeSummary: "No search queries were dispatched due to referent ambiguity.",
        evidenceGaps: ["Unresolved referent: the entity/subject of the statement is unknown."],
        recommendedActions: ["Clarify the statement by explicitly specifying the person, company, or subject."],
        roundsRun: 0,
        reasonCode: "AMBIGUOUS_CLAIM",
        coverage: emptyCoverage,
        pipelineVersion: "v2",
        calibration: { status: "uncalibrated" },
      };

      yield { type: "result", result: finalResult };
      return;
    }

    // A contextual reconstruction is safe to verify only after the resolver has
    // supplied a concrete antecedent. The hypothesis remains the self-contained
    // normalized claim; raw conversation context never reaches NLI.

    // 2. Custom Corpus context processing if present
    if (customContext.trim()) {
      const customDoc = createSourceDocument({
        docId: "doc-custom-corpus",
        url: "user-corpus://local",
        title: "User Evidence Corpus",
        rawContent: customContext,
        retrievalEventId: "ev-custom",
        tierOverride: "user_corpus",
      });
      documents.push(customDoc);
      const customPassages = segmentMarkdownPassages(customDoc);
      passages.push(...customPassages);
    }

    yield { type: "stage", state: "RESEARCHING" };

    // 3. Multi-round retrieval & verification loop
    for (let round = 1; round <= maxRounds; round++) {
      roundsRun = round;
      if (signal.aborted) {
        budgetExhausted = true;
        break;
      }

      // Query planning
      const planStart = Date.now();
      const plannedQueries = await planQueriesV2({
        claim,
        round,
        signal,
      });
      requestedQueries += plannedQueries.length;

      logPipelineEvent({
        claimTraceId,
        pipelineVersion: "v2",
        stage: "query_planning",
        durationMs: Date.now() - planStart,
        count: plannedQueries.length,
        promptVersion: PROMPT_REGISTRY_VERSIONS.query,
      });

      // Search queries in parallel
      const searchTasks = plannedQueries.map(async (pq) => {
        const sStart = Date.now();
        const retId = `search-${crypto.randomUUID().slice(0, 8)}`;
        try {
          const hits = await searchWeb(pq.query, signal);
          successfulQueries++;
          retrievalEvents.push({
            id: retId,
            kind: "search",
            query: pq.query,
            status: "ok",
            durationMs: Date.now() - sStart,
          });
          return hits;
        } catch (err: unknown) {
          retrievalEvents.push({
            id: retId,
            kind: "search",
            query: pq.query,
            status: "error",
            errorCode: err instanceof Error ? err.name : "SEARCH_FAILED",
            durationMs: Date.now() - sStart,
          });
          return [];
        }
      });

      const searchHitArrays = await Promise.all(searchTasks);
      const allHits = searchHitArrays.flat();

      // Snippet ranking before scraping (T14)
      const kScrapes = settings.depth === "deep" ? 6 : 4;
      const rankedHits = await rankSnippetsBeforeScrape({
        claim,
        hits: allHits,
        k: kScrapes,
        embeddingFn: async (texts) => await createEmbeddings(texts, signal),
      });

      const newHitsToScrape = rankedHits.filter((hit) => !scrapedUrls.has(hit.url));
      for (const h of newHitsToScrape) {
        scrapedUrls.add(h.url);
      }

      // Scrape selected hits
      const roundDocs: SourceDocument[] = [];
      const scrapeTasks = newHitsToScrape.map(async (hit, idx) => {
        attemptedPages++;
        const scStart = Date.now();
        const retId = `scrape-${crypto.randomUUID().slice(0, 8)}`;
        try {
          const candidateId = `cand-${round}-${idx}`;
          const scraped = await scrapePage(hit, candidateId, signal);
          retrievedPages++;
          retrievalEvents.push({
            id: retId,
            kind: "scrape",
            url: hit.url,
            status: "ok",
            durationMs: Date.now() - scStart,
          });

          const cleaned = cleanMarkdownText(scraped.markdown);
          const doc = createSourceDocument({
            docId: `doc-${round}-${idx}-${crypto.randomUUID().slice(0, 6)}`,
            url: hit.url,
            title: scraped.title || hit.title,
            rawContent: cleaned,
            retrievalEventId: retId,
          });
          return doc;
        } catch (err: unknown) {
          retrievalEvents.push({
            id: retId,
            kind: "scrape",
            url: hit.url,
            status: "error",
            errorCode: err instanceof Error ? err.name : "SCRAPE_FAILED",
            durationMs: Date.now() - scStart,
          });
          return null;
        }
      });

      const scrapedResults = await Promise.all(scrapeTasks);
      for (const d of scrapedResults) {
        if (d !== null) {
          roundDocs.push(d);
          documents.push(d);
        }
      }

      // Segment new documents into passages
      const roundPassages: Passage[] = [];
      for (const doc of roundDocs) {
        const segs = segmentMarkdownPassages(doc);
        roundPassages.push(...segs);
      }

      // Rank passages (hybrid BM25 + embeddings)
      const rankedPassages = await rankPassagesHybrid({
        claimText: claim.normalizedClaim,
        passages: roundPassages,
        depth: settings.depth,
        maxPerDoc: 3,
        globalCap: settings.depth === "deep" ? 20 : 12,
        embeddingFn: async (texts) => await createEmbeddings(texts, signal),
      });
      passages.push(...rankedPassages);

      // Verify newly retrieved passages
      if (rankedPassages.length > 0) {
        const hypothesis = claim.frame?.scope || claim.frame?.condition
          ? `${claim.normalizedClaim} [Scope/Condition: ${[claim.frame?.scope, claim.frame?.condition].filter(Boolean).join("; ")}]`
          : claim.normalizedClaim;

        const roundVOs = await verifier.verify({
          hypothesis,
          passages: rankedPassages,
        }, signal);

        passagesVerified += roundVOs.length;
        verifierFailures += rankedPassages.length - roundVOs.length;
        verifierOutputs.push(...roundVOs);

        // Build intermediate evidence and yield
        const clusterMap = clusterDocuments(documents);
        const currentEvidence = buildEvidenceItemsV2({
          claim,
          documents,
          passages,
          verifierOutputs,
          clusterMap,
        });

        yield { type: "evidence", items: currentEvidence };

        // T24 Deterministic Research-Stop Rule for deep mode:
        if (settings.depth === "deep" && round < maxRounds) {
          const intermediateAgg = aggregateEvidenceV2(claim, currentEvidence);
          const hasAuthoritative = intermediateAgg.bestSupportTier === "primary_official" || intermediateAgg.bestSupportTier === "primary_org";
          const hasMultiCluster = intermediateAgg.supportClusters.length >= 2 || intermediateAgg.contradictClusters.length >= 2;

          if ((intermediateAgg.S >= 0.8 || intermediateAgg.C >= 0.7) && (hasAuthoritative || hasMultiCluster)) {
            break; // Stop further research rounds!
          }
        }
      }
    }

    // 4. Check Rule V0: Infrastructure / Retrieval Failure
    const hasCustomCorpus = documents.some((d) => d.tier === "user_corpus");
    const anyRetrievalError = retrievalEvents.some((e) => e.status === "error");

    if (
      requestedQueries > 0 &&
      successfulQueries === 0
    ) {
      yield {
        type: "error",
        message: "RETRIEVAL_UNAVAILABLE: Search providers were unavailable.",
      };
      return;
    }

    if (
      retrievedPages === 0 &&
      !hasCustomCorpus &&
      anyRetrievalError
    ) {
      yield {
        type: "error",
        message: "RETRIEVAL_UNAVAILABLE: Content scraping providers were unavailable.",
      };
      return;
    }

    // 5. Final Aggregation & Verdict
    yield { type: "stage", state: "SYNTHESIZING" };

    const clusterMap = clusterDocuments(documents);
    const finalEvidence = buildEvidenceItemsV2({
      claim,
      documents,
      passages,
      verifierOutputs,
      clusterMap,
    });

    const aggregation = aggregateEvidenceV2(claim, finalEvidence);

    // T22: Context distortion check if candidate verdict is support-leaning
    let contextDistortion: { isDistorted: boolean; missingContext?: string; corroboratingClusterCount?: number; highestClusterTier?: any } | undefined;

    if (aggregation.S >= 0.65 && aggregation.C < 0.45 && finalEvidence.length > 0) {
      try {
        const topSupporting = finalEvidence
          .filter((e) => e.relation === "supports")
          .slice(0, 3)
          .map((e) => ({ id: e.id, text: e.excerpt }));

        const topContextual = finalEvidence
          .filter((e) => e.relation === "contextual")
          .slice(0, 3)
          .map((e) => ({ id: e.id, text: e.excerpt }));

        const checkPassages = [...topSupporting, ...topContextual];

        if (checkPassages.length > 0) {
          const rawContext: ContextOutput = await structuredCompletion({
            system: contextPrompt.system,
            user: contextPrompt.buildUser({
              hypothesis: claim.normalizedClaim,
              passages: checkPassages,
            }),
            output: contextPrompt.output,
            jsonSchema: contextPrompt.jsonSchema,
            signal,
          });

          if (rawContext.distortion !== "none" && rawContext.missingContext) {
            contextDistortion = {
              isDistorted: true,
              missingContext: rawContext.missingContext,
              corroboratingClusterCount: rawContext.passageIds.length,
              highestClusterTier: finalEvidence[0]?.tier,
            };
          }
        }
      } catch {
        // Non-fatal if context distortion call fails
      }
    }

    const coverage = {
      queriesRequested: requestedQueries,
      queriesSucceeded: successfulQueries,
      pagesAttempted: attemptedPages,
      pagesRetrieved: retrievedPages,
      passagesVerified,
      verifierFailures,
      budgetExhausted,
    };

    const decision = determineVerdictV2({
      claim,
      aggregation,
      coverage,
      hasCustomCorpus,
      contextDistortion,
      evidenceCount: finalEvidence.length,
    });

    const confidence = computeConfidenceV2({
      verdict: decision.verdict,
      aggregation,
      coverage,
      evidenceTiers: finalEvidence.map((e) => e.tier as any),
      isTimeless: claim.frame?.temporal.currentness === "timeless",
    });

    const synthesis = await generateSynthesisV2({
      claim,
      verdict: decision.verdict,
      reasonCode: decision.reasonCode,
      evidence: finalEvidence,
      support: aggregation.S,
      contradiction: aggregation.C,
      missingContext: decision.missingContext,
      ...(signal ? { signal } : {}),
    });

    const trace: VerificationTrace = {
      promptVersions: {
        query: PROMPT_REGISTRY_VERSIONS.query,
        verify: PROMPT_REGISTRY_VERSIONS.verify,
        context: PROMPT_REGISTRY_VERSIONS.context,
        synthesis: PROMPT_REGISTRY_VERSIONS.synthesis,
      },
      retrievalEvents,
      decision: {
        support: aggregation.S,
        contradiction: aggregation.C,
        thresholdsVersion: THRESHOLDS_VERSION,
        rulesFired: decision.rulesFired,
        clustersUsed: Array.from(new Set(finalEvidence.map((e) => e.clusterId).filter(Boolean))) as string[],
      },
    };

    const result: VerificationResult = {
      verdict: decision.verdict,
      confidence,
      summary: synthesis.summary,
      explanation: synthesis.explanation,
      challengeSummary: synthesis.challengeSummary,
      evidenceGaps: synthesis.evidenceGaps,
      recommendedActions: synthesis.recommendedActions,
      roundsRun: Math.max(1, roundsRun),
      reasonCode: decision.reasonCode,
      coverage,
      pipelineVersion: "v2",
      calibration: confidence.calibration,
      trace,
    };

    yield { type: "result", result };
  } finally {
    clearTimeout(budgetTimeout);
  }
}
