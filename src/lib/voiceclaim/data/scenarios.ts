import type {
  EvidenceItem,
  StatementClassification,
  VerificationMode,
  VerificationResult,
} from "../types";

export interface ScenarioClaimSeed {
  normalizedClaim: string;
  priority: number;
  /** Simulated research cost, in ms, before the verdict lands. */
  researchMs: number;
  /** When true, the run ends in VERIFICATION_ERROR (infrastructure failure). */
  infrastructureFailure?: boolean;
  evidence: Omit<EvidenceItem, "id" | "retrievedAt">[];
  result: Omit<VerificationResult, "roundsRun">;
}

export interface ScenarioLine {
  /** Milliseconds from session start when the speaker begins this line. */
  atMs: number;
  text: string;
  classification: StatementClassification;
  claims?: ScenarioClaimSeed[];
}

export interface Scenario {
  id: string;
  mode: VerificationMode;
  title: string;
  speaker: string;
  blurb: string;
  lines: ScenarioLine[];
}

const now = () => new Date().toISOString();
export const retrievedNow = now;

export const SCENARIOS: Scenario[] = [
  {
    id: "investor-pitch",
    mode: "investor",
    title: "Seed-stage investor pitch",
    speaker: "Founder, logistics SaaS",
    blurb: "Market sizing, growth and ranking claims made rapid-fire during a live pitch.",
    lines: [
      {
        atMs: 0,
        text: "Thanks for making the time — I'll keep this to ten minutes and then open it up.",
        classification: "context",
      },
      {
        atMs: 5200,
        text: "The global freight-visibility market is worth about twenty billion dollars, it is growing around thirty percent annually, and we are already the second-largest provider in Pakistan.",
        classification: "verifiable_fact",
        claims: [
          {
            normalizedClaim:
              "The global freight-visibility software market is worth approximately USD 20 billion.",
            priority: 0.86,
            researchMs: 9000,
            evidence: [
              {
                title: "Real-Time Transportation Visibility Platforms, Market Guide",
                domain: "gartner.com",
                url: "https://www.gartner.com/en/documents/rttvp-market-guide",
                category: "news",
                excerpt:
                  "Analysts size the real-time transportation visibility platform segment at USD 6.4B in 2025, within a broader supply-chain visibility category valued near USD 19-21B.",
                relation: "supports",
                publishedAt: "2025-11-04",
                authority: "high",
                independent: true,
              },
              {
                title: "Supply Chain Visibility Market Size Report",
                domain: "grandviewresearch.com",
                url: "https://www.grandviewresearch.com/industry-analysis/supply-chain-visibility",
                category: "news",
                excerpt:
                  "The global supply chain visibility market was estimated at USD 19.8 billion in 2025.",
                relation: "supports",
                publishedAt: "2025-09-18",
                authority: "medium",
                independent: true,
              },
              {
                title: "Freight tech spending holds steady into 2026",
                domain: "joc.com",
                url: "https://www.joc.com/article/freight-tech-spending-2026",
                category: "news",
                excerpt:
                  "Definitions vary widely; narrower freight-visibility tooling accounts for well under half of the headline supply-chain visibility figure.",
                relation: "contextual",
                publishedAt: "2026-01-22",
                authority: "medium",
                independent: true,
              },
            ],
            result: {
              verdict: "mostly_supported",
              confidence: {
                score: 82,
                evidenceStrength: "high",
                contradiction: "low",
                freshness: "high",
              },
              summary:
                "Independent analyst sizing lands near USD 20B for supply-chain visibility overall, but the narrower freight-visibility segment is materially smaller.",
              explanation:
                "Two independent analyst estimates place the broad supply-chain visibility market at USD 19.8-21B for 2025, matching the figure quoted. The claim is accurate for the broad category; applied strictly to freight visibility it overstates the addressable market, since trade reporting places that sub-segment well below half the headline number.",
              challengeSummary:
                "The skeptic found no source contradicting the USD 20B figure itself, but did surface scope ambiguity between 'supply-chain visibility' and 'freight visibility'.",
              evidenceGaps: [
                "No source defines the exact segment boundary the speaker intends.",
                "No 2026 refresh of the analyst sizing is published yet.",
              ],
              recommendedActions: [
                "Ask which analyst definition and report year the USD 20B figure comes from.",
              ],
            },
          },
          {
            normalizedClaim: "That market is growing at approximately 30% annually.",
            priority: 0.81,
            researchMs: 14000,
            evidence: [
              {
                title: "Supply Chain Visibility Market Size Report — CAGR outlook",
                domain: "grandviewresearch.com",
                url: "https://www.grandviewresearch.com/industry-analysis/supply-chain-visibility",
                category: "news",
                excerpt:
                  "The overall market is projected to expand at a 12.1% CAGR from 2025 to 2030.",
                relation: "contradicts",
                publishedAt: "2025-09-18",
                authority: "medium",
                independent: true,
              },
              {
                title: "AI-enabled visibility tooling outpaces the wider category",
                domain: "mckinsey.com",
                url: "https://www.mckinsey.com/industries/logistics/our-insights/ai-visibility",
                category: "news",
                excerpt:
                  "AI-native predictive ETA tooling — a narrow slice of the category — is growing above 28% per year, well ahead of the ~12% category average.",
                relation: "contextual",
                publishedAt: "2025-12-09",
                authority: "high",
                independent: true,
              },
              {
                title: "Logistics software growth normalises post-2023",
                domain: "reuters.com",
                url: "https://www.reuters.com/business/logistics-software-growth",
                category: "news",
                excerpt:
                  "Growth in logistics software spend has normalised into the low teens after the pandemic-era surge.",
                relation: "contradicts",
                publishedAt: "2026-02-11",
                authority: "high",
                independent: true,
              },
            ],
            result: {
              verdict: "misleading",
              confidence: {
                score: 88,
                evidenceStrength: "high",
                contradiction: "medium",
                freshness: "high",
              },
              summary:
                "The ~30% growth figure describes a narrow AI-native sub-segment, not the market the speaker just sized at USD 20B.",
              explanation:
                "Sources put the overall market's growth in the low teens (12.1% CAGR; low-teens per Reuters). A ~28-30% growth rate does appear in the evidence, but only for AI-native predictive ETA tooling. Pairing the broad market's size with the narrow segment's growth rate materially changes how the opportunity reads.",
              challengeSummary:
                "The skeptic located the likely origin of the 30% figure and showed it applies to a different, much smaller segment than the one sized above.",
              evidenceGaps: ["No breakdown of the company's own segment growth is available."],
              recommendedActions: [
                "Ask the founder to state size and growth for the same defined segment.",
                "Request the underlying analyst report rather than a summary slide.",
              ],
            },
          },
          {
            normalizedClaim:
              "The company is the second-largest freight-visibility provider in Pakistan.",
            priority: 0.64,
            researchMs: 19000,
            evidence: [
              {
                title: "Pakistan logistics technology landscape 2026",
                domain: "pseb.org.pk",
                url: "https://www.pseb.org.pk/reports/logistics-tech-2026",
                category: "government",
                excerpt:
                  "The report lists active logistics-technology vendors but publishes no revenue or market-share ranking.",
                relation: "contextual",
                publishedAt: "2026-03-02",
                authority: "medium",
                independent: true,
              },
              {
                title: "Company overview page",
                domain: "example-freight.co",
                url: "https://example-freight.co/about",
                category: "company",
                excerpt:
                  '"Pakistan\'s #2 freight visibility platform" — self-published, no methodology or third-party audit cited.',
                relation: "supports",
                publishedAt: "2026-01-15",
                authority: "low",
                independent: false,
              },
            ],
            result: {
              verdict: "insufficient_evidence",
              confidence: {
                score: 46,
                evidenceStrength: "low",
                contradiction: "low",
                freshness: "medium",
              },
              summary:
                "No independent ranking of Pakistani freight-visibility providers could be located.",
              explanation:
                "The only supporting statement is the company's own website, which is not independent evidence for a market-position claim. No regulator, trade body, or analyst publishes a market-share ranking for this segment in Pakistan. This is an evidence gap, not a contradiction — nothing found suggests the claim is false.",
              challengeSummary:
                "The skeptic also found no source contradicting the ranking. Absence of evidence on both sides.",
              evidenceGaps: [
                "No third-party market-share data for Pakistan freight visibility.",
                "No revenue disclosures from named competitors.",
              ],
              recommendedActions: [
                "Ask which ranking, methodology and time period the #2 position is based on.",
                "Request customer or volume figures that can be checked against named competitors.",
              ],
            },
          },
        ],
      },
      {
        atMs: 21000,
        text: "Honestly, I think we have the best onboarding experience in the entire category.",
        classification: "opinion",
      },
      {
        atMs: 27500,
        text: "Our annual recurring revenue has doubled this year, and we crossed twelve hundred paying customers in March.",
        classification: "verifiable_fact",
        claims: [
          {
            normalizedClaim: "The company's annual recurring revenue doubled over the past year.",
            priority: 0.72,
            researchMs: 11000,
            infrastructureFailure: true,
            evidence: [],
            result: {
              verdict: "insufficient_evidence",
              confidence: {
                score: 0,
                evidenceStrength: "low",
                contradiction: "low",
                freshness: "low",
              },
              summary: "",
              explanation: "",
              challengeSummary: "",
              evidenceGaps: [],
              recommendedActions: [],
            },
          },
          {
            normalizedClaim: "The company had more than 1,200 paying customers as of March 2026.",
            priority: 0.58,
            researchMs: 16000,
            evidence: [
              {
                title: "Press release: 1,200 customers milestone",
                domain: "example-freight.co",
                url: "https://example-freight.co/news/1200-customers",
                category: "company",
                excerpt:
                  '"We now serve over 1,200 paying shippers and carriers across four markets."',
                relation: "supports",
                publishedAt: "2026-03-11",
                authority: "medium",
                independent: false,
              },
              {
                title: "Pakistani logistics startup passes 1,200 customers",
                domain: "techinasia.com",
                url: "https://www.techinasia.com/example-freight-1200",
                category: "news",
                excerpt:
                  "Coverage restates the company's own announcement without independent verification.",
                relation: "supports",
                publishedAt: "2026-03-12",
                authority: "low",
                independent: false,
                upstreamOf: "example-freight.co press release",
              },
            ],
            result: {
              verdict: "mostly_supported",
              confidence: {
                score: 61,
                evidenceStrength: "medium",
                contradiction: "low",
                freshness: "high",
              },
              summary:
                "The figure is consistently stated but traces back to a single company announcement — the news coverage is not independent corroboration.",
              explanation:
                "Both retrieved sources originate from the same March 2026 company press release. That makes the claim internally consistent and recent, but there is only one upstream source. Customer counts of this kind are rarely externally auditable at seed stage.",
              challengeSummary:
                "The skeptic found no conflicting count, and confirmed that the second source is syndicated from the first rather than independent.",
              evidenceGaps: [
                "No definition of 'paying customer' (seats, accounts, or contracts).",
                "No third-party or audited confirmation.",
              ],
              recommendedActions: [
                "Request a billing-system export or auditor confirmation during diligence.",
              ],
            },
          },
        ],
      },
      {
        atMs: 44000,
        text: "If the current trend holds, we will probably be the market leader across South Asia within three years.",
        classification: "prediction",
      },
      {
        atMs: 52000,
        text: "We raised a four million dollar seed round led by a regional fund last October.",
        classification: "verifiable_fact",
        claims: [
          {
            normalizedClaim: "The company raised a USD 4 million seed round in October 2025.",
            priority: 0.69,
            researchMs: 10000,
            evidence: [
              {
                title: "Securities filing — Form D equivalent",
                domain: "secp.gov.pk",
                url: "https://www.secp.gov.pk/filings/example-freight-2025",
                category: "government",
                excerpt:
                  "Registered raise of USD 4.0M closing 21 October 2025, lead investor named.",
                relation: "supports",
                publishedAt: "2025-10-28",
                authority: "high",
                independent: true,
              },
              {
                title: "Regional fund backs freight visibility startup",
                domain: "bloomberg.com",
                url: "https://www.bloomberg.com/news/example-freight-seed",
                category: "news",
                excerpt:
                  "The round totalled USD 4 million, according to filings reviewed by Bloomberg.",
                relation: "supports",
                publishedAt: "2025-10-29",
                authority: "high",
                independent: true,
              },
            ],
            result: {
              verdict: "supported",
              confidence: {
                score: 94,
                evidenceStrength: "high",
                contradiction: "low",
                freshness: "high",
              },
              summary:
                "A regulatory filing establishes the amount, lead investor and closing date exactly as stated.",
              explanation:
                "The registered filing is an authoritative primary source for this specific assertion, and independent reporting matches it. No further corroboration is required once an authoritative filing establishes the fact.",
              challengeSummary: "No meaningful contradictory evidence identified.",
              evidenceGaps: [],
              recommendedActions: [],
            },
          },
        ],
      },
      {
        atMs: 63000,
        text: "That's the overview — happy to go deeper on unit economics if that's useful.",
        classification: "context",
      },
    ],
  },
  {
    id: "academic-talk",
    mode: "academic",
    title: "Conference talk on benchmark accuracy",
    speaker: "Presenter, ML research group",
    blurb: "Novelty and benchmark claims checked against peer-reviewed literature.",
    lines: [
      {
        atMs: 0,
        text: "I'll walk through the architecture first and then the evaluation results.",
        classification: "context",
      },
      {
        atMs: 6000,
        text: "Existing models have never exceeded ninety percent accuracy on this dataset.",
        classification: "verifiable_fact",
        claims: [
          {
            normalizedClaim:
              "No previously published model exceeds 90% accuracy on the referenced benchmark dataset.",
            priority: 0.91,
            researchMs: 12000,
            evidence: [
              {
                title: "Cross-domain robustness with staged pretraining",
                domain: "aclanthology.org",
                url: "https://aclanthology.org/2025.emnlp-main.418/",
                category: "scientific",
                excerpt:
                  "We report 93.2% accuracy on the benchmark, a 3.8 point improvement over the previous best.",
                relation: "contradicts",
                publishedAt: "2025-11-08",
                authority: "high",
                independent: true,
              },
              {
                title: "Benchmark leaderboard — current standings",
                domain: "paperswithcode.com",
                url: "https://paperswithcode.com/sota/benchmark",
                category: "scientific",
                excerpt: "Top reported accuracy 93.2%, with two further entries above 91%.",
                relation: "contradicts",
                publishedAt: "2026-04-02",
                authority: "medium",
                independent: true,
              },
              {
                title: "Survey of benchmark results through 2024",
                domain: "arxiv.org",
                url: "https://arxiv.org/abs/2411.01234",
                category: "scientific",
                excerpt: "As of late 2024 the best published result stood at 89.4%.",
                relation: "contextual",
                publishedAt: "2024-11-03",
                authority: "high",
                independent: true,
              },
            ],
            result: {
              verdict: "contradicted",
              confidence: {
                score: 91,
                evidenceStrength: "high",
                contradiction: "high",
                freshness: "high",
              },
              summary:
                "A peer-reviewed 2025 paper reports 93.2% on this benchmark, above the stated ceiling.",
              explanation:
                "The claim was accurate through late 2024, when the best published result was 89.4%. A peer-reviewed EMNLP 2025 paper subsequently reported 93.2%, and the public leaderboard lists two further entries above 91%. Credible evidence directly conflicts with the central assertion.",
              challengeSummary:
                "The skeptic checked whether the higher results used a different split or evaluation protocol; both use the standard test split.",
              evidenceGaps: ["No replication study of the 93.2% result is published yet."],
              recommendedActions: [
                "Ask the presenter whether the comparison excludes post-2024 work, and why.",
              ],
            },
          },
        ],
      },
      {
        atMs: 19000,
        text: "Our approach is, in my view, considerably more elegant than the alternatives.",
        classification: "opinion",
      },
      {
        atMs: 26000,
        text: "The dataset contains just over four hundred thousand annotated examples across twelve languages.",
        classification: "verifiable_fact",
        claims: [
          {
            normalizedClaim:
              "The benchmark dataset contains slightly more than 400,000 annotated examples spanning 12 languages.",
            priority: 0.74,
            researchMs: 9000,
            evidence: [
              {
                title: "Dataset card and statistics",
                domain: "huggingface.co",
                url: "https://huggingface.co/datasets/benchmark",
                category: "scientific",
                excerpt:
                  "412,486 annotated examples; 12 languages; train/dev/test splits published.",
                relation: "supports",
                publishedAt: "2025-06-14",
                authority: "high",
                independent: true,
              },
              {
                title: "Original dataset paper",
                domain: "aclanthology.org",
                url: "https://aclanthology.org/2024.lrec-main.77/",
                category: "scientific",
                excerpt:
                  "The release comprises 412k instances across twelve typologically diverse languages.",
                relation: "supports",
                publishedAt: "2024-05-20",
                authority: "high",
                independent: true,
              },
            ],
            result: {
              verdict: "supported",
              confidence: {
                score: 96,
                evidenceStrength: "high",
                contradiction: "low",
                freshness: "medium",
              },
              summary:
                "The dataset card and the original peer-reviewed release both state 412k examples across 12 languages.",
              explanation:
                "Both the canonical dataset card and the peer-reviewed release paper independently state figures matching the claim. These are authoritative primary sources for dataset composition.",
              challengeSummary: "No meaningful contradictory evidence identified.",
              evidenceGaps: [],
              recommendedActions: [],
            },
          },
        ],
      },
      {
        atMs: 38000,
        text: "We expect this line of work to become the standard approach over the next few years.",
        classification: "prediction",
      },
      {
        atMs: 45000,
        text: "A recent clinical study found this class of model reduced diagnostic error by forty percent in practice.",
        classification: "verifiable_fact",
        claims: [
          {
            normalizedClaim:
              "A recent clinical study found that models of this class reduced diagnostic error by approximately 40% in clinical practice.",
            priority: 0.88,
            researchMs: 17000,
            evidence: [
              {
                title: "Retrospective evaluation of decision-support models",
                domain: "nejm.org",
                url: "https://www.nejm.org/doi/full/10.1056/NEJMoa2500001",
                category: "scientific",
                excerpt:
                  "Relative reduction in diagnostic error of 41% in a retrospective, single-centre cohort under reader-study conditions.",
                relation: "supports",
                publishedAt: "2026-01-30",
                authority: "high",
                independent: true,
              },
              {
                title: "Editorial: reader studies are not deployment",
                domain: "thelancet.com",
                url: "https://www.thelancet.com/journals/editorial/ai-reader-studies",
                category: "scientific",
                excerpt:
                  "Retrospective reader-study gains have repeatedly failed to transfer to prospective clinical deployment.",
                relation: "contradicts",
                publishedAt: "2026-02-18",
                authority: "high",
                independent: true,
              },
              {
                title: "Prospective pilot reports smaller effect",
                domain: "bmj.com",
                url: "https://www.bmj.com/content/prospective-ai-pilot",
                category: "scientific",
                excerpt:
                  "A prospective pilot at two sites observed an 11% reduction, not statistically significant.",
                relation: "contradicts",
                publishedAt: "2026-03-25",
                authority: "high",
                independent: true,
              },
            ],
            result: {
              verdict: "mixed",
              confidence: {
                score: 79,
                evidenceStrength: "high",
                contradiction: "high",
                freshness: "high",
              },
              summary:
                "A ~41% reduction is reported retrospectively, while prospective evidence shows a much smaller, non-significant effect.",
              explanation:
                "The 40% figure is real and comes from a peer-reviewed retrospective reader study. Independent prospective evidence reports an 11% reduction that did not reach significance, and an editorial in a second journal warns that reader-study gains routinely fail to transfer. Both bodies of evidence are credible, so the claim holds under one study design and not the other.",
              challengeSummary:
                "The skeptic surfaced prospective data and a methodological critique that the supporting study does not address.",
              evidenceGaps: ["No multi-site randomised trial has reported yet."],
              recommendedActions: [
                "Ask whether the cited figure is retrospective or prospective before generalising it.",
              ],
            },
          },
        ],
      },
      {
        atMs: 62000,
        text: "I'll stop there and take questions.",
        classification: "context",
      },
    ],
  },
];

export function getScenarioForMode(mode: VerificationMode): Scenario {
  if (mode === "academic") return SCENARIOS[1]!;
  return SCENARIOS[0]!;
}
