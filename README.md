# Claim Weaver

VoiceClaim Auditor is a TanStack Start application that transcribes live or uploaded speech, extracts atomic factual claims, and streams evidence-backed verification results while speech continues. The production service path uses Speechmatics, Bright Data Web MCP, and OpenAI API. The original product requirements are retained below as the product appendix.

## Local setup

Requirements: Bun 1.3+, a modern browser with microphone/AudioWorklet support, and credentials for all three partner services.

```powershell
bun install
Copy-Item .env.example .env.local
bun run dev
```

Set the following only in `.env.local`; never prefix partner secrets with `VITE_` and never commit that file:

- `VOICECLAIM_SESSION_SIGNING_SECRET`: at least 32 random characters; mandatory for production.
- `SPEECHMATICS_API_KEY`: long-lived key used only by the server to mint 60-second realtime/batch temporary keys.
- `BRIGHTDATA_API_TOKEN`: Bright Data user API token for the hosted Streamable HTTP MCP endpoint.
- `OPENAI_API_KEY`: Official OpenAI API key for structured completions and embeddings.
- Optional endpoint/model overrides are documented in `.env.example`.

Live mode is the default. Missing live credentials produce an explicit configuration/provider error and never fall back to simulations. For an offline demonstration, set:

```dotenv
VOICECLAIM_SERVICE_MODE=mock
```

Restart the development server after changing environment variables.

## Partner configuration

### Speechmatics

Create an API key in the Speechmatics portal. The server exchanges it through the Speechmatics management endpoint for a 60-second `rt` key or a `batch` key scoped with `client_ref=sessionId`. Realtime audio travels from the browser directly to `global.rt.speechmatics.com`; the long-lived key never reaches the client. Uploaded audio/MP4 goes directly to the Batch Jobs API, and its job is force-deleted after the result is read. MP4 video frames are not inspected.

Temporary keys may require account/enterprise enablement. A 401/403 from the token endpoint usually means the key is invalid or temporary-key access is not enabled for the account.

### Bright Data Web MCP

Create a Bright Data API token. The server connects to the hosted Streamable HTTP MCP endpoint and exposes only Rapid-mode `search_engine` and `scrape_as_markdown`. Quick Verify targets the configured unique-source count in one round. Deep Verify runs up to three rounds and never scrapes more than 15 unique pages per claim.

### OpenAI API

Create an OpenAI API key at `platform.openai.com/api-keys`. Defaults are:

- extraction, query generation, and evidence challenge: `gpt-4o-mini`;
- synthesis: `gpt-4o`;
- embeddings: `text-embedding-3-small`, 512 dimensions.

Built-in model guardrails automatically validate configured model strings and support official OpenAI GA models including `gpt-5.6-luna`, `gpt-4o`, and `gpt-4o-mini`, while mapping incompatible non-OpenAI third-party models to official OpenAI GA standards. Every agent response crosses a strict JSON Schema/Zod boundary. Malformed output is repaired once; permanent authorization and validation errors are not retried.

## Validation

```powershell
bun run format
bun run lint
bun run typecheck
bun run test
bun run test:contract
bun run build
bun run preview
```

Deterministic tests cover chunking/drain behavior, queue concurrency, prioritization, provenance, URL safety, exact excerpts, evidence aggregation, verdict thresholds, confidence, IndexedDB persistence/cleanup, embedding similarity, Speechmatics mapping, Bright Data result parsing, and request bounds.

For a live credential smoke test, run the app and check, in order:

1. a 10–20 second microphone statement;
2. a short audio upload and short MP4 upload;
3. one concrete investor claim in Quick Verify;
4. one PDF/TXT/CSV-backed claim in Custom Sources mode;
5. the investor and academic scenarios in the PRD appendix.

The `/` launch flow reports partner failures on the affected session. `getIntegrationHealth()` reports only booleans and model names—never secrets.

## Privacy and local data

- Speechmatics states that realtime audio/transcripts are not retained by the realtime service. Batch jobs are deleted by this app after retrieval.
- Original uploaded media, custom files, extracted custom chunks, and vectors are session-scoped in IndexedDB and deleted when the session ends or is abandoned.
- Completed history stores transcript segments, atomic claims, evidence excerpts, and provenance in IndexedDB on this device. It does not retain original uploads or custom-corpus vectors.
- Settings alone remain in localStorage; active launch authorization is kept in sessionStorage.
- Server logs contain provider, stage, duration, counts, and redacted error codes only. They exclude keys, full transcripts, uploaded text, and token-bearing URLs.

## Hackathon testing access

Session creation and claim verification are unrestricted: the application does not apply per-IP, per-session, or concurrent-request rate-limit rejections. The verification engine still queues work at the user-selected concurrency so every detected claim can finish without overwhelming the browser. Provider-side quotas and billing policies still apply.

Research and file-processing bounds remain correctness safeguards rather than usage quotas: Quick/Deep Verify cap the number of pages considered for one claim, and custom sources retain their documented file, text, and chunk bounds. Configure provider billing alerts or spending caps for Speechmatics, Bright Data, and AI/ML API before sharing the public URL widely.

## Troubleshooting

- `*_NOT_CONFIGURED`: copy `.env.example` to `.env.local`, set the key, and restart Vite.
- Speechmatics microphone does not start: use HTTPS or localhost, allow microphone permission, and verify AudioWorklet support.
- Speechmatics reconnecting: the client retries three times with fresh JWTs and marks the potentially incomplete interval. A closed state after that is terminal.
- Batch upload rejected: verify the audio/MP4 format, provider-side file allowance, and temporary batch-key entitlement.
- Bright Data `VERIFICATION_ERROR`: check token/quota and MCP availability. Infrastructure failure intentionally does not become `Insufficient Evidence`.
- AI/ML structured-output error: verify model availability on the account or override the model in `.env.local`.
- Custom PDF error: confirm the `%PDF-` signature, MIME/extension, file size, and that the PDF contains extractable text rather than only scanned images.

## Deployment

The production app is packaged with Nitro's Vercel preset. Add secrets through the deployment environment (never the client bundle), use a production `VOICECLAIM_SESSION_SIGNING_SECRET`, set provider spending caps, run the full validation gate, and inspect generated client assets to confirm no secret value appears.

---

## Product requirements appendix

Iwant you to build complete proper beautiful clean and modern frontend for this. Also make sure to build such that later I can add real backend as well in the code.

---

# VoiceClaim Auditor

## Product Requirements Document — Hackathon MVP

**Event:** LabLab.ai Hackathon, August 3–10, 2026  

**Product:** VoiceClaim Auditor  

**Version:** PRD v1.0  

**Primary Users:** Investors, academics  

**Product Category:** Real-time evidence-based spoken claim verification  

**Primary Integrations:** Speechmatics, Bright Data Web MCP, AI/ML API

---

# 1. Product Summary

VoiceClaim Auditor is a real-time spoken claim verification system designed for situations where a user is listening to a long conversation, presentation, pitch, lecture, panel, or discussion and cannot manually identify and investigate every factual assertion as it is made.

The system continuously listens to speech, converts it to text, identifies objectively verifiable claims, decomposes complex statements into atomic assertions, prioritizes those assertions, searches live evidence, challenges the evidence adversarially, and presents an evidence-backed verdict while the conversation continues.

The product is not intended to declare absolute truth.

Instead, it answers:

> **How strongly does currently available credible evidence support or contradict this claim?**

Every verified claim receives:

- a verdict;

- an Evidence Confidence score;

- concise reasoning;

- supporting evidence;

- contradictory evidence where available;

- identified evidence gaps;

- recommended next actions where appropriate.

The core differentiator is that verification happens **alongside an ongoing conversation**, rather than requiring a user to manually extract individual claims and research them one at a time.

---

# 2. Problem Statement

During investor pitches, academic presentations, panels, lectures, interviews, debates, and other spoken interactions, participants frequently make objectively verifiable factual claims.

Examples include:

- "Our revenue increased 70% last year."

- "This market is worth $18 billion."

- "No previous study has achieved better than 90% accuracy."

- "This treatment reduced mortality by 40%."

- "Company X has more than five million customers."

A listener generally cannot:

1. accurately remember every statement;

2. determine which statements are objectively verifiable;

3. separate compound claims into atomic assertions;

4. search several credible sources;

5. determine whether sources are independent;

6. check for contradictory evidence;

7. assess evidence quality;

8. complete all of this before the conversation moves on.

VoiceClaim Auditor performs this work continuously.

---

# 3. Product Vision

The long-term vision is an AI verification layer that can accompany a user during any information-heavy spoken interaction.

The user should be able to listen normally while VoiceClaim Auditor acts as a parallel research analyst.

The product should eventually support:

- live conversations;

- meetings;

- investor pitches;

- academic talks;

- interviews;

- debates;

- news;

- uploaded documents;

- articles;

- recorded media;

- multilingual conversations;

- domain-specific verification workflows.

The hackathon MVP focuses on proving the central interaction:

> **Listen → detect claim → decompose → research → challenge → verify — while speech continues.**

---

# 4. Target Users

## 4.1 Primary Persona — Investor

An investor listening to a startup founder, executive, analyst, or business presentation.

Typical claims:

- market size;

- revenue;

- profitability;

- growth;

- customers;

- valuation;

- funding;

- industry position;

- competitor performance;

- regulatory status.

### User need

The investor wants factual assertions independently checked without interrupting the pitch or manually searching each statement.

---

## 4.2 Primary Persona — Academic

A researcher, student, reviewer, or educator listening to:

- a research presentation;

- lecture;

- thesis defense;

- conference talk;

- academic discussion.

Typical claims:

- published findings;

- benchmark performance;

- dataset statistics;

- prior research;

- scientific consensus;

- novelty claims;

- quantitative study results.

### User need

The academic wants to know whether a statement is actually supported by credible scientific evidence and whether cited research genuinely supports the interpretation being presented.

---

# 5. Core Product Modes

The MVP exposes four verification modes.

## 5.1 General Mode

General-purpose factual verification.

Evidence hierarchy:

1. authoritative primary sources;

2. scientific/financial sources where relevant;

3. organizational sources;

4. reputable news;

5. established fact-checkers;

6. social signals where useful.

---

## 5.2 Investor Mode

Optimized for business and investment claims.

Preferred source hierarchy:

1. regulatory filings and official financial disclosures;

2. audited reports;

3. exchange/government databases;

4. investor relations publications;

5. company primary sources;

6. reputable financial journalism;

7. reliable industry sources.

Typical claim categories:

- revenue;

- profit;

- market size;

- growth;

- customer/user count;

- valuation;

- funding;

- competitive position;

- company milestones.

The fact that a statement comes from the company being evaluated does not automatically make the source independent evidence.

---

## 5.3 Academic Mode

Optimized for research and scientific claims.

Preferred source hierarchy:

1. peer-reviewed publications;

2. authoritative scientific datasets;

3. institutional repositories;

4. reputable preprints;

5. university/research institution sources;

6. high-quality secondary scientific reporting.

The verifier should distinguish between:

- a study supporting a claim;

- a study merely mentioning the topic;

- a result being extrapolated beyond the actual findings.

---

## 5.4 Custom Sources Mode

The user can provide a custom evidence corpus.

MVP file types:

- PDF

- TXT

- CSV

Custom-source verification uses:

> **Uploaded resources + live web evidence**

Uploaded resources must not automatically receive higher authority than external sources simply because the user supplied them.

The custom corpus is treated as a separate evidence collection.

Semantic retrieval/RAG must be supported over uploaded resources.

---

# 6. MVP Input Types

The MVP supports:

### Live microphone

Primary product experience.

### Recorded audio

Uploaded audio is transcribed and analyzed automatically.

### Video upload

MVP supports **MP4 video**.

Only the audio track is analyzed.

Visual content is out of scope.

### Custom evidence documents

PDF, TXT, and CSV.

---

# 7. Explicitly Out of Scope for MVP

The following are future directions:

- multilingual verification;

- speaker diarization;

- automatic speaker identity;

- webpage URL verification;

- YouTube URL ingestion;

- arbitrary video URLs;

- visual video analysis;

- public Proof Receipt pages;

- Proof Receipt export;

- public sharing;

- social media cards;

- user accounts;

- authentication;

- collaborative workspaces;

- spoken verdict playback;

- long-term cloud history synchronization.

---

# 8. Live Session Workflow

The primary live workflow is:

```text

Microphone

    ↓

Speechmatics Streaming STT

    ↓

Transcript Buffer

    ↓

Chunk + Semantic Boundary Detection

    ↓

Statement Classification

    ↓

Atomic Claim Extraction

    ↓

Claim Prioritization

    ↓

Verification Queue

    ↓

Evidence Agent

    ↓

Adversarial Skeptic

    ↓

Synthesizer

    ↓

Verdict + Evidence Confidence

    ↓

Live Claim Card

```

Speech ingestion must continue while earlier claims are being verified.

Verification must therefore be asynchronous/concurrent relative to live transcription.

---

# 9. Speech Processing

## 9.1 Streaming

Speechmatics streaming transcription is mandatory for the live microphone workflow.

Speech should appear progressively in the UI while the user is speaking.

---

## 9.2 Chunking

Live processing uses a **hybrid chunking strategy**:

- configurable fixed-time intervals;

- semantic completion detection.

The system must not blindly verify incomplete fragments.

Example:

Chunk 1:

> "Our revenue increased by..."

Chunk 2:

> "...70 percent compared with last year."

These must be treated as one completed statement.

---

## 9.3 Configurable interval

The verification interval must be adjustable.

Suggested initial presets:

- Fast

- Balanced

- Long Context

The underlying implementation may map these to time windows such as approximately 5–30 seconds.

Exact values should remain configurable.

---

# 10. Statement Classification

Each completed statement is classified into one of three primary categories:

### Verifiable Factual Claim

An objectively testable assertion about the world.

Example:

> "Tesla delivered 1.8 million vehicles last year."

This enters the verification pipeline.

---

### Opinion / Subjective Statement

Example:

> "Tesla makes the best-looking electric cars."

This remains visible in the transcript but does not enter automatic verification.

---

### Prediction / Speculation

Example:

> "Tesla will probably dominate autonomous taxis."

This remains visible but does not receive a factual verdict.

---

Statements that do not meaningfully fit a verification category may simply remain transcript context and be ignored by the verifier.

---

# 11. Atomic Claim Extraction

A factual statement may contain multiple assertions.

Example:

> "Company X has five million customers and grew revenue by 80% last year."

The system must generate:

```text

Claim A:

Company X has approximately five million customers.




Claim B:

Company X's revenue increased approximately 80% during the specified period.

```

Each atomic claim is verified independently.

No user approval is required before decomposition during live mode.

---

# 12. Claim Metadata

Every atomic claim must preserve:

- claim ID;

- original spoken wording;

- normalized atomic claim;

- transcript timestamp;

- source transcript segment;

- surrounding context;

- verification mode;

- verification depth;

- current processing state.

The original wording must never be replaced by the normalized representation.

---

# 13. Manual Verification

The user must be able to select a transcript statement manually and request verification even when the automatic classifier did not select it.

---

# 14. Claim Prioritization

A conversation may generate claims faster than they can be researched.

The system therefore maintains a verification queue.

Claims should be prioritized based on factors such as:

- objective verifiability;

- specificity;

- presence of entities;

- presence of measurable quantities;

- time-bound assertions;

- expected availability of credible evidence.

The system should favor claims that can produce meaningful evidence-backed results.

Duplicate-claim detection is **not required for MVP**.

---

# 15. Verification Depth

The product supports two verification modes.

## 15.1 Quick Verify

Designed for live responsiveness.

Default behavior:

- one primary research round;

- approximately three strong sources when available;

- fast source prioritization;

- Evidence Agent;

- Adversarial Skeptic;

- Synthesizer.

The number of sources should be user-adjustable.

---

## 15.2 Deep Verify

Designed for important or disputed claims.

Behavior:

- one to three iterative research rounds;

- expanded source count;

- independent contradiction search;

- broader search-query generation;

- additional evidence comparison;

- stronger conflict resolution.

Research may stop early if sufficient evidence has already been obtained.

---

# 16. Evidence Retrieval

Each atomic claim receives independent search queries.

Query generation may differ according to:

- mode;

- claim type;

- verification depth;

- evidence discovered in previous rounds.

Bright Data Web MCP is responsible for:

- web discovery;

- search;

- webpage access;

- extraction of relevant evidence.

The Evidence Agent may perform multiple differently worded searches for the same claim.

---

# 17. Evidence Hierarchy

Default source priority:

```text

Government / authoritative official sources

        ↓

Scientific papers / financial filings

        ↓

Company or organization primary sources

        ↓

Reputable news

        ↓

Established fact-checking organizations

        ↓

Social media / social signals

```

This is a priority policy, not a rigid ranking.

---

# 18. Authority Is Claim-Dependent

A source must not receive authority solely because it is a primary source.

Authority depends on whether that source is actually qualified to establish the particular assertion.

Example:

A company website may be highly authoritative for:

> "What specifications does this company's product advertise?"

It is much weaker evidence for:

> "This company produces the world's safest product."

The evidence system must evaluate **authority relative to the claim**.

---

# 19. Evidence Quality

Evidence evaluation should consider:

- source authority;

- relevance to the exact claim;

- directness;

- independence;

- publication quality;

- whether the source actually establishes the assertion.

The following should be penalized:

- anonymous unsupported material;

- SEO/content-farm pages;

- unsupported marketing language;

- duplicated material;

- syndicated copies of the same original report;

- low-authority aggregation.

---

# 20. Source Independence

Multiple websites repeating the same original source must not be counted as independent corroboration.

Example:

Five news websites repeating one wire-service report do not equal five independent confirmations.

The system should attempt to identify the upstream/original evidence source.

---

# 21. Supporting and Contradictory Evidence

The Evidence Agent searches for the strongest available supporting evidence.

The Adversarial Skeptic independently searches for:

- conflicting evidence;

- stronger sources;

- newer evidence;

- contradictory data;

- omitted context;

- unsupported assumptions.

Contradictory evidence must be displayed to the user.

The Skeptic must not be forced to disagree.

A valid result is:

> No meaningful contradictory evidence identified.

---

# 22. Source Quantity

Normal target:

> **3–5 independent sources**

A strong primary source should be preferred when available.

However, obtaining secondary corroboration after an authoritative primary source is **not mandatory**.

Deep Verify may inspect additional sources.

---

# 23. Evidence Card

For MVP, every relevant evidence item should expose:

- title;

- domain/publisher;

- source category;

- relevant excerpt;

- URL;

- publication date when available;

- retrieval time when available;

- relationship to claim:

  - Supports

  - Contradicts

  - Contextual

The MVP does not require archived screenshots.

---

# 24. Multi-Agent Verification Architecture

The core logical pipeline is:

```text

Claim Extractor

      ↓

Evidence Agent

      ↓

Adversarial Skeptic

      ↓

Synthesizer

```

The Claim Extractor is an LLM-powered processing agent/stage.

---

# 25. Claim Extractor

Responsibilities:

1. inspect completed transcript segments;

2. classify statements;

3. identify objectively verifiable factual claims;

4. break compound statements into atomic claims;

5. preserve original wording;

6. normalize each atomic claim;

7. preserve relevant surrounding context.

Output must be structured.

Example conceptual output:

```json
{
  "classification": "verifiable_fact",

  "original_text": "...",

  "claims": [
    {
      "claim": "...",

      "context": "...",

      "timestamp": "..."
    }
  ]
}
```

---

# 26. Evidence Agent

The Evidence Agent searches the live web using Bright Data Web MCP and gathers the strongest relevant evidence available for each atomic claim.

Responsibilities:

- generate research queries;

- prioritize authoritative sources;

- inspect source content;

- identify evidence directly relevant to the claim;

- assess source authority relative to the assertion;

- identify source independence;

- organize supporting evidence;

- return structured evidence.

The agent should primarily return evidence rather than unrestricted narrative reasoning.

---

# 27. Adversarial Skeptic

The Adversarial Skeptic independently challenges the Evidence Agent's findings.

It searches for:

- contradictory evidence;

- newer information;

- stronger sources;

- missing context;

- alternative interpretations;

- evidence that weakens the Evidence Agent's conclusion.

It receives the Evidence Agent's collected evidence but may perform independent Bright Data searches.

It should not manufacture disagreement.

---

# 28. Synthesizer

The Synthesizer receives:

- atomic claim;

- contextual transcript;

- Evidence Agent output;

- Skeptic output.

Responsibilities:

1. compare evidence from both sides;

2. resolve source conflicts;

3. assess gaps;

4. select verdict;

5. calculate/derive Evidence Confidence;

6. produce concise explanation;

7. recommend next actions when useful.

The Synthesizer **must not introduce new external evidence** that was not retrieved by one of the research agents.

If new evidence is needed, it must request another research round instead.

---

# 29. No Chain-of-Thought Exposure

Users must never see internal agent chain-of-thought.

The product may show only compact processing stages:

```text

Evidence

   ↓

Challenge

   ↓

Verdict

```

Visible summaries must contain evidence-backed conclusions rather than private agent reasoning.

---

# 30. Verdict Taxonomy

The MVP uses six verdicts.

## Supported

Strong credible evidence supports all material parts of the claim.

---

## Mostly Supported

The central assertion is supported, but one or more minor details are inaccurate, overstated, or insufficiently established.

---

## Mixed

Important components of the claim have meaningful supporting and contradictory evidence.

For simple atomic claims, this verdict should be relatively uncommon.

---

## Misleading

The statement may contain technically correct information but presents it without context or with framing that materially changes its interpretation.

A Misleading verdict must explicitly identify the missing or distorted context.

---

## Contradicted

Credible evidence directly conflicts with the central assertion.

---

## Insufficient Evidence

The available reliable evidence is inadequate to establish either meaningful support or meaningful contradiction.

This must never be treated as equivalent to Contradicted.

The UI should explain what information could not be established where possible.

---

# 31. Evidence Confidence

The product must use the term:

> **Evidence Confidence**

It must not imply statistical probability that a claim is objectively true.

Example:

> Evidence Confidence: 87%

means:

> The currently retrieved evidence provides strong confidence in this verdict.

It does **not** mean:

> There is an 87% probability that reality is exactly as stated.

---

# 32. Evidence Confidence Components

The visible score breakdown should remain intentionally simple.

Only three dimensions are shown:

### Evidence Strength

How authoritative, direct, relevant, independent, and corroborated the retrieved evidence is.

### Contradiction

How much credible evidence conflicts with the evidence supporting the selected conclusion and how clearly that conflict can be resolved.

### Freshness

Whether the evidence is sufficiently current for the type of claim being verified.

Example UI:

```text

Evidence Confidence: 87%




Evidence Strength     High

Contradiction         Low

Freshness             Medium

```

The exact mathematical weighting should remain configurable during the hackathon rather than presented as scientifically calibrated probability.

---

# 33. Live Claim Cards

As claims are detected, they appear immediately in chronological order.

Example:

```text

01:42




"Our annual recurring revenue has doubled this year."




RESEARCHING...

```

The card progressively updates:

```text

Claim detected

      ↓

Searching evidence

      ↓

Challenging evidence

      ↓

Verdict ready

```

Final state:

```text

MOSTLY SUPPORTED




Evidence Confidence: 84%




Evidence Strength: High

Contradiction: Low

Freshness: High




Summary:

...




3 Supporting Sources

1 Contradictory Source

```

---

# 34. Progressive Evidence

Evidence should appear as it becomes available instead of forcing the user to wait for the entire pipeline.

However, partial evidence must never be presented as the final verdict.

---

# 35. Claim Filters

The live conversation interface should support filtering claims.

Suggested filters:

- All

- Supported

- Questionable

- Contradicted

- Insufficient

"Questionable" may aggregate:

- Mostly Supported

- Mixed

- Misleading

for UI simplicity.

---

# 36. Claim Detail View

Selecting a claim opens:

```text

Original Statement




Atomic Claim




Evidence Confidence




Evidence

    Supporting

    Contradictory




Challenge Summary




Final Verdict




Explanation




Evidence Gaps




Recommended Next Actions

```

---

# 37. Main Interface

The landing/live-session interface should prioritize two actions:

### Large microphone control

Used to begin real-time verification.

### Upload

Used for:

- recorded audio;

- MP4 video;

- custom evidence resources.

Mode selection should also be clearly accessible:

- General

- Investor

- Academic

- Custom Sources

---

# 38. Live Progress

During processing, the interface should expose high-level states such as:

```text

Listening

Transcribing

Claim Detected

Searching Evidence

Checking Contradictions

Generating Verdict

Completed

```

These states must not expose model chain-of-thought.

---

# 39. Uploaded Recording Processing

Uploaded recordings should be processed automatically.

For the MVP, uploaded media is limited to approximately **5 minutes**.

For uploaded recordings, progressive/chunk processing is preferred over waiting for the complete transcript because it:

- matches the live product architecture;

- provides faster visible results;

- demonstrates the core real-time concept;

- allows claims to begin verification before transcription finishes.

The implementation may still perform final transcript reconciliation once processing completes.

---

# 40. Video Processing

MVP video input:

> MP4

Only the audio stream is extracted.

No frames, slides, visual claims, graphs, or on-screen text are analyzed.

---

# 41. History

Authentication is not required.

MVP history should therefore be stored locally in the user's browser/device.

History should allow the user to:

- revisit previous verification sessions;

- inspect claims;

- inspect evidence;

- delete saved sessions.

Cloud synchronization is out of scope.

Collections/projects are not required for MVP.

---

# 42. Processing States

A claim may occupy the following internal states:

```text

DETECTED

QUEUED

RESEARCHING

CHALLENGING

SYNTHESIZING

COMPLETED

INSUFFICIENT_EVIDENCE

VERIFICATION_ERROR

```

`INSUFFICIENT_EVIDENCE` and `VERIFICATION_ERROR` are fundamentally different.

---

# 43. Failure Handling

## Speechmatics failure

The application should:

1. attempt recovery/reconnection;

2. inform the user;

3. identify any interval whose transcription may be incomplete.

---

## Bright Data failure

The claim must not receive an `Insufficient Evidence` verdict merely because infrastructure failed.

Use:

> Verification Error

---

## Agent failure

When reasonable, retry an individual failed agent stage before failing the entire claim.

A failed agent response must never silently become evidence.

---

# 44. Partner Integration Requirements

## Speechmatics

Used for:

- live microphone streaming;

- real-time transcription;

- recorded media transcription where appropriate.

Speechmatics is not required for purely text/document-based future workflows.

---

## Bright Data Web MCP

Used for:

- live source discovery;

- web search;

- webpage access;

- source extraction;

- supporting evidence retrieval;

- contradictory evidence retrieval.

Both the Evidence Agent and Adversarial Skeptic may use Bright Data.

---

## AI/ML API

Used to power:

- Claim Extractor;

- Evidence Agent reasoning;

- Adversarial Skeptic;

- Synthesizer.

Exact model selection may remain configurable.

---

# 45. Technical Architecture Constraints

Because native.builder may determine or generate portions of the application stack, this PRD does **not** mandate a specific web framework.

The implementation must, however, support the following architectural capabilities:

### Frontend

Must support:

- microphone streaming;

- live transcript rendering;

- progressive claim cards;

- asynchronous evidence updates;

- mode selection;

- uploaded files;

- local history.

### Backend/orchestration layer

Must support:

- Speechmatics streaming integration;

- AI/ML API calls;

- Bright Data Web MCP calls;

- concurrent claim processing;

- per-claim agent state;

- iterative research loops;

- evidence aggregation.

### Streaming transport

The architecture must provide a streaming mechanism such as:

- WebSocket; and/or

- Server-Sent Events.

Exact selection is implementation-dependent.

### Persistence

The hackathon MVP does not require a permanent user database.

Browser-local history is sufficient.

Temporary backend state may be used for active sessions.

---

# 46. Concurrency Requirement

The architecture must not implement the workflow as:

```text

Listen to complete meeting

→ transcribe everything

→ analyze everything

→ return results

```

Instead:

```text

Speech continues

        │

        ├── Claim A → verification

        │

        ├── Claim B → verification

        │

        ├── Claim C → queued

        │

        └── transcription continues

```

This concurrency is a fundamental product requirement.

---

# 47. Performance Requirements

The product should optimize for useful live feedback rather than waiting for exhaustive research.

Quick Verify should produce useful results fast enough that the original conversation is still ongoing.

Deep Verify may take longer.

Hard latency promises should not be introduced before measuring the external APIs.

The UI should therefore emphasize **progressive status** rather than promising a fixed number of seconds.

---

# 48. Privacy Requirements

For the hackathon MVP:

- authentication is not required;

- recordings should not be retained by the application longer than necessary for processing unless explicitly required;

- local history should primarily store transcript/claim/evidence results;

- users should be able to delete local history;

- uploaded custom resources should be scoped to the current verification session unless intentionally retained locally.

---

# 49. Core MVP Requirements

The following are mandatory:

### P0 — Core

- live microphone input;

- Speechmatics streaming transcription;

- hybrid transcript chunking;

- factual claim classification;

- atomic claim decomposition;

- concurrent claim verification;

- claim prioritization;

- Evidence Agent;

- Adversarial Skeptic;

- Synthesizer;

- Bright Data live evidence retrieval;

- verdict taxonomy;

- Evidence Confidence;

- supporting and contradictory evidence;

- Quick Verify;

- Deep Verify;

- progressive claim status;

- chronological claim cards.

### P1 — Strong MVP

- Investor Mode;

- Academic Mode;

- General Mode;

- Custom Sources Mode;

- PDF/TXT/CSV retrieval;

- audio upload;

- MP4 upload;

- local verification history;

- transcript manual claim selection;

- adjustable research/source count.

---

# 50. Post-Hackathon Scope

The following should be presented as future extensions rather than incomplete MVP functionality:

- multilingual verification;

- diarization;

- speaker attribution;

- URL verification;

- webpage ingestion;

- YouTube ingestion;

- arbitrary video sources;

- visual claim verification;

- Proof Receipts;

- evidence screenshots;

- public sharing;

- export;

- authenticated accounts;

- cloud history;

- teams/workspaces;

- spoken summaries;

- richer domain-specific modes.

---

# 51. Future Proof Receipt

Although excluded from the hackathon MVP, the architecture should not prevent future generation of a Proof Receipt containing:

- original claim;

- original transcript context;

- atomic assertions;

- verdict;

- Evidence Confidence;

- supporting evidence;

- contradictory evidence;

- evidence gaps;

- source metadata;

- retrieval timestamps;

- recommended next actions.

This eventually becomes the portable verification artifact produced by VoiceClaim Auditor.

---

# 52. Primary Demo Scenario

## Investor Pitch

A founder is speaking:

> "The global market is worth $20 billion, it is growing 30% annually, and our company is already the second-largest provider in Pakistan."

VoiceClaim Auditor is already listening.

The live transcript appears.

The system recognizes that the sentence contains multiple objectively verifiable assertions.

It automatically creates:

```text

Claim 1

The relevant global market is approximately $20B.




Claim 2

The relevant market is growing approximately 30% annually.




Claim 3

The company is the second-largest provider in Pakistan.

```

The pitch continues.

Meanwhile:

```text

Claim 1 → Evidence Agent searching

Claim 2 → Skeptic checking alternative market estimates

Claim 3 → queued

```

Claim 1 becomes:

```text

MOSTLY SUPPORTED

Evidence Confidence: 82%

```

Claim 2 becomes:

```text

MISLEADING

Evidence Confidence: 88%




The cited 30% growth estimate refers to a narrower subsegment,

not the entire market.

```

Claim 3 becomes:

```text

INSUFFICIENT EVIDENCE




No reliable independent ranking establishing the company

as Pakistan's second-largest provider was identified.

```

The investor receives these findings before the founder has finished the presentation.

This scenario should demonstrate the essential value proposition more clearly than a conventional paste-a-claim fact checker.

---

# 53. Secondary Demo Scenario

## Academic Presentation

A presenter states:

> "Existing models have never exceeded 90% accuracy on this dataset."

Academic Mode detects the assertion.

The Evidence Agent searches academic literature.

The Skeptic independently searches for papers reporting higher results.

The system discovers a newer study reporting 93.2%.

Verdict:

```text

CONTRADICTED




Evidence Confidence: 91%




A later peer-reviewed study reports performance exceeding

the stated threshold.

```

This demonstrates that verification policy changes according to domain.

---

# 54. Success Criteria

The MVP is successful when a user can:

1. start a live microphone session;

2. speak continuously;

3. see live transcription;

4. observe factual claims being automatically identified;

5. see compound statements split into atomic claims;

6. continue speaking while earlier claims are researched;

7. receive progressively updated claim cards;

8. inspect supporting and contradictory evidence;

9. receive one of the defined evidence-based verdicts;

10. understand why `Contradicted` differs from `Insufficient Evidence`;

11. inspect an Evidence Confidence score;

12. switch between General, Investor, Academic, and Custom Sources modes;

13. perform both Quick Verify and Deep Verify.

---

# 55. Product Principles

## Evidence over model opinion

A verdict must derive from retrieved evidence rather than unsupported model knowledge.

## Uncertainty is a valid result

`Insufficient Evidence` is useful information.

## Contradiction is not absence

Failure to support a claim does not imply that the claim is contradicted.

## Authority is contextual

A source's credibility depends on what claim it is being used to establish.

## The skeptic must investigate, not perform disagreement

Adversarial verification means searching for weaknesses, not generating artificial opposition.

## Preserve the original statement

Normalization must never erase what the speaker actually said.

## Live first

The distinguishing product experience is verification occurring during speech.

## Transparent without exposing chain-of-thought

Show evidence, stages, verdicts, and concise rationale—not hidden internal reasoning.

---

# 56. MVP Definition

The minimum experience that should be considered **VoiceClaim Auditor**, rather than a generic fact-checking app, is:

```text

Live Speech

    ↓

Real-Time Transcript

    ↓

Automatic Factual Claim Detection

    ↓

Atomic Claims

    ↓

Concurrent Live Web Research

    ↓

Adversarial Contradiction Search

    ↓

Evidence-Based Verdict

    ↓

Evidence Confidence

```

If development time becomes constrained, features outside this path should be cut before weakening this core workflow.

---

# 57. Implementation Principle for native.builder

The implementation agent may select appropriate framework and infrastructure choices where native.builder imposes its own stack.

However, it must not alter the behavioral contracts established in this PRD.

Technology choices are implementation details.

The following are product requirements and must remain invariant:

- streaming speech;

- incremental claim detection;

- atomic decomposition;

- concurrent processing;

- separate evidence and skeptic stages;

- live Bright Data research;

- structured evidence;

- deterministic verdict vocabulary;

- Evidence Confidence rather than raw LLM confidence;

- progressive UI;

- clear distinction between evidence failure and infrastructure failure.

---

# 58. Next Specification Layer

This PRD should next be decomposed in this order:

```text

PRD

 ↓

Epics

 ↓

User Stories

 ↓

Acceptance Criteria

 ↓

Technical Tasks

```

User stories should derive requirements directly from this PRD rather than introducing new product behavior.
