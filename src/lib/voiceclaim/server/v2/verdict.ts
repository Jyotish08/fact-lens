import type {
  AtomicClaim,
  ReasonCode,
  RetrievalCoverage,
  SourceTier,
  Verdict,
} from "../../types";
import type { AggregationResult } from "./aggregate";
import { DEFAULT_THRESHOLDS, type PipelineV2Thresholds } from "./thresholds";

export interface ContextDistortionResult {
  isDistorted: boolean;
  missingContext?: string;
  corroboratingClusterCount?: number;
  highestClusterTier?: SourceTier;
}

export interface DetermineVerdictV2Input {
  claim: AtomicClaim;
  aggregation: AggregationResult;
  coverage: RetrievalCoverage;
  hasCustomCorpus?: boolean | undefined;
  contextDistortion?: ContextDistortionResult | undefined;
  evidenceCount: number;
}

export interface VerdictV2Decision {
  verdict: Verdict;
  reasonCode: ReasonCode;
  missingContext?: string;
  rulesFired: string[];
}

function tierLevel(tier?: SourceTier): number {
  switch (tier) {
    case "primary_official":
      return 4;
    case "primary_org":
    case "user_corpus":
      return 3;
    case "established_news":
      return 2;
    case "secondary":
      return 1;
    case "social":
    default:
      return 0;
  }
}

export function determineVerdictV2(
  input: DetermineVerdictV2Input,
  thresholds: PipelineV2Thresholds = DEFAULT_THRESHOLDS,
): VerdictV2Decision {
  const { claim, aggregation, coverage, contextDistortion, evidenceCount } = input;
  const { S, C, fullEntail, hasQuantityMismatch, hasQuantityWithinTolerance } = aggregation;
  const rulesFired: string[] = [];

  // V0b: Ambiguous claim check
  if (claim.frame?.unresolvedReferent && !claim.frame.subject) {
    rulesFired.push("V0b");
    return {
      verdict: "insufficient_evidence",
      reasonCode: "AMBIGUOUS_CLAIM",
      rulesFired,
    };
  }

  // V2: Conflicting evidence (S >= 0.5 && C >= 0.5)
  if (S >= thresholds.conflictS && C >= thresholds.conflictC) {
    rulesFired.push("V2_conflict");
    const supportLevel = tierLevel(aggregation.bestSupportTier);
    const contradictLevel = tierLevel(aggregation.bestContradictTier);
    const tierDiff = supportLevel - contradictLevel;

    // (a) If best clusters differ by >= 2 tier levels, higher tier wins
    if (tierDiff >= 2) {
      rulesFired.push("V2_tier_support_override");
      // proceed to support evaluation
    } else if (tierDiff <= -2) {
      rulesFired.push("V2_tier_contradict_override");
      return {
        verdict: "contradicted",
        reasonCode: "DIRECT_CONTRADICTION",
        rulesFired,
      };
    } else {
      // (b) Check temporal currentness if applicable
      const isCurrent = claim.frame?.temporal.currentness === "current";
      const newestSupport = aggregation.supportClusters[0]?.publishedAt;
      const newestContradict = aggregation.contradictClusters[0]?.publishedAt;

      if (isCurrent && newestSupport && newestContradict) {
        if (newestSupport > newestContradict) {
          rulesFired.push("V2_temporal_support_override");
        } else if (newestContradict > newestSupport) {
          rulesFired.push("V2_temporal_contradict_override");
          return {
            verdict: "contradicted",
            reasonCode: "DIRECT_CONTRADICTION",
            rulesFired,
          };
        } else {
          return {
            verdict: "mixed",
            reasonCode: "CONFLICTING_INDEPENDENT_SOURCES",
            rulesFired,
          };
        }
      } else {
        return {
          verdict: "mixed",
          reasonCode: "CONFLICTING_INDEPENDENT_SOURCES",
          rulesFired,
        };
      }
    }
  }

  // V3: Contradicted
  if (
    hasQuantityMismatch ||
    (C >= thresholds.contradictGateC && C - S >= thresholds.contradictGateMargin)
  ) {
    rulesFired.push("V3");
    return {
      verdict: "contradicted",
      reasonCode: hasQuantityMismatch ? "QUANTITY_MISMATCH" : "DIRECT_CONTRADICTION",
      rulesFired,
    };
  }

  // Helper check for V6 context distortion (Misleading)
  const isMisleading = (): boolean => {
    if (!contextDistortion?.isDistorted) return false;
    const count = contextDistortion.corroboratingClusterCount ?? 1;
    const tier = contextDistortion.highestClusterTier;
    const hasHighTier =
      tier === "primary_official" ||
      tier === "primary_org" ||
      tier === "established_news";
    return count >= 2 || hasHighTier;
  };

  // V4: Strongly Supported
  if (
    S >= thresholds.supportGateS &&
    C < thresholds.supportGateC &&
    fullEntail &&
    !hasQuantityMismatch
  ) {
    rulesFired.push("V4");
    if (isMisleading()) {
      rulesFired.push("V6");
      return {
        verdict: "misleading",
        reasonCode: "CORROBORATED_MISSING_CONTEXT",
        missingContext: contextDistortion?.missingContext ?? "Material context was omitted.",
        rulesFired,
      };
    }

    return {
      verdict: "supported",
      reasonCode: "STRONG_INDEPENDENT_SUPPORT",
      rulesFired,
    };
  }

  // V5: Mostly Supported
  if (S >= thresholds.mostlySupportGateS && C < thresholds.mostlySupportGateC) {
    rulesFired.push("V5");
    if (isMisleading()) {
      rulesFired.push("V6");
      return {
        verdict: "misleading",
        reasonCode: "CORROBORATED_MISSING_CONTEXT",
        missingContext: contextDistortion?.missingContext ?? "Material context was omitted.",
        rulesFired,
      };
    }

    return {
      verdict: "mostly_supported",
      reasonCode: hasQuantityWithinTolerance
        ? "QUANTITY_APPROXIMATE"
        : "SUPPORT_WITH_MINOR_GAPS",
      rulesFired,
    };
  }

  // V7: Insufficient Evidence fallthrough
  rulesFired.push("V7");
  let reasonCode: ReasonCode = "NO_RELEVANT_SOURCES";

  if (C >= thresholds.weakContradictionC) {
    reasonCode = "WEAK_CONTRADICTION_ONLY";
  } else if (
    coverage.queriesRequested > 0 &&
    coverage.queriesSucceeded < coverage.queriesRequested
  ) {
    reasonCode = "PARTIAL_RETRIEVAL_FAILURE";
  } else if (evidenceCount > 0) {
    reasonCode = "SOURCES_NEUTRAL";
  }

  return {
    verdict: "insufficient_evidence",
    reasonCode,
    rulesFired,
  };
}
