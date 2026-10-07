import type { SourceTier } from "../../types";

export const THRESHOLDS_VERSION = "2026-10-04.v2";

export interface PipelineV2Thresholds {
  version: string;
  tierWeights: Record<SourceTier, number>;
  entailThreshold: number; // tau_e
  contradictThreshold: number; // tau_c
  fullEntailThreshold: number; // tau_full
  supportGateS: number; // V4: S >= 0.8
  supportGateC: number; // V4: C < 0.3
  mostlySupportGateS: number; // V5: S >= 0.65
  mostlySupportGateC: number; // V5: C < 0.45
  contradictGateC: number; // V3: C >= 0.7
  contradictGateMargin: number; // V3: C - S >= 0.2
  conflictS: number; // V2: S >= 0.5
  conflictC: number; // V2: C >= 0.5
  weakContradictionC: number; // V7: C >= 0.4
}

export const DEFAULT_THRESHOLDS: PipelineV2Thresholds = {
  version: THRESHOLDS_VERSION,
  tierWeights: {
    primary_official: 0.95,
    primary_org: 0.85,
    established_news: 0.75,
    user_corpus: 0.80,
    secondary: 0.50,
    social: 0.25,
  },
  entailThreshold: 0.70,
  contradictThreshold: 0.70,
  fullEntailThreshold: 0.85,
  supportGateS: 0.80,
  supportGateC: 0.30,
  mostlySupportGateS: 0.65,
  mostlySupportGateC: 0.45,
  contradictGateC: 0.70,
  contradictGateMargin: 0.20,
  conflictS: 0.50,
  conflictC: 0.50,
  weakContradictionC: 0.40,
};
