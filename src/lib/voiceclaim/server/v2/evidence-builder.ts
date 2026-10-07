import type {
  AtomicClaim,
  EvidenceItem,
  QualitativeLevel,
  SourceTier,
} from "../../types";
import type { Passage, SourceDocument, VerifierOutput } from "./types";
import { checkQuantityMatch, extractQuantitiesFromText } from "./quantities";

export function tierToQualitativeAuthority(tier: SourceTier): QualitativeLevel {
  switch (tier) {
    case "primary_official":
    case "primary_org":
    case "user_corpus":
      return "high";
    case "established_news":
      return "medium";
    case "secondary":
    case "social":
    default:
      return "low";
  }
}

export function determineRelation(
  entail: number,
  contradict: number,
  thresholds?: { entailThreshold?: number; contradictThreshold?: number },
): "supports" | "contradicts" | "contextual" {
  const tauE = thresholds?.entailThreshold ?? 0.70;
  const tauC = thresholds?.contradictThreshold ?? 0.70;

  if (entail >= tauE && contradict <= 0.15) {
    return "supports";
  }
  if (contradict >= tauC && entail <= 0.15) {
    return "contradicts";
  }
  return "contextual";
}

export interface BuildEvidenceV2Options {
  claim: AtomicClaim;
  documents: SourceDocument[];
  passages: Passage[];
  verifierOutputs: VerifierOutput[];
  clusterMap: Map<string, string>;
  entailThreshold?: number;
  contradictThreshold?: number;
}

export function buildEvidenceItemsV2(options: BuildEvidenceV2Options): EvidenceItem[] {
  const {
    claim,
    documents,
    passages,
    verifierOutputs,
    clusterMap,
    entailThreshold = 0.70,
    contradictThreshold = 0.70,
  } = options;

  const docMap = new Map(documents.map((d) => [d.docId, d]));
  const passageMap = new Map(passages.map((p) => [p.passageId, p]));

  const items: EvidenceItem[] = [];

  for (const vo of verifierOutputs) {
    const passage = passageMap.get(vo.passageId);
    if (!passage) continue;
    const doc = docMap.get(passage.docId);
    if (!doc) continue;

    const relation = determineRelation(vo.entail, vo.contradict, {
      entailThreshold,
      contradictThreshold,
    });

    let excerpt = "";
    let span: { start: number; end: number; contentHash: string } | undefined;

    if (vo.supportSpan) {
      excerpt = passage.text.slice(vo.supportSpan.start, vo.supportSpan.end).trim();
      span = {
        start: passage.start + vo.supportSpan.start,
        end: passage.start + vo.supportSpan.end,
        contentHash: doc.contentHash,
      };
    }

    if (!excerpt) {
      excerpt = passage.text.slice(0, 300).trim();
    }

    // Run quantity check if claim frame contains quantities
    let quantityCheck: "match" | "within_tolerance" | "mismatch" | "not_applicable" | undefined;
    if (claim.frame?.quantities && claim.frame.quantities.length > 0) {
      const passageQuantities = extractQuantitiesFromText(passage.text);
      quantityCheck = checkQuantityMatch(claim.frame.quantities[0]!, passageQuantities);
    }

    const clusterId = clusterMap.get(doc.docId) ?? `cluster-${doc.docId}`;
    const authority = tierToQualitativeAuthority(doc.tier);

    items.push({
      id: `ev-${passage.passageId}`,
      url: doc.url,
      title: doc.title,
      domain: doc.registrableDomain,
      category: doc.category,
      retrievedAt: new Date().toISOString(),
      excerpt,
      relation,
      authority,
      tier: doc.tier,
      clusterId,
      span,
      verifier: {
        entail: vo.entail,
        neutral: vo.neutral,
        contradict: vo.contradict,
        verifierId: vo.verifierId,
      },
      quantityCheck,
      publishedAt: doc.publishedAt ?? undefined,
      publishedAtSource: doc.publishedAtSource,
      retrievalEventId: doc.retrievalEventId,
      independent: true,
    });
  }

  return items;
}
