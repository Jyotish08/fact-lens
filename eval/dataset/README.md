# Voice Claim Auditor — Golden Dataset Protocol

## Overview
This directory contains the versioned golden benchmark dataset for Voice Claim Auditor evaluation.
The golden dataset is used by `npm run eval` to measure pipeline accuracy, calibration, and regression gates before and after architecture migrations.

## Schema
Each line in `golden.vN.jsonl` is a JSON object with the following fields:
- `id`: Unique identifier (e.g. `inv-0001`, `acad-0012`, `gen-0035`).
- `split`: `"dev"` (used for tuning thresholds/prompts), `"test"` (held-out frozen gate), or `"calibration"`.
- `mode`: `"investor"`, `"academic"`, or `"general"`.
- `input`:
  - `kind`: `"claim"` or `"transcript"`.
  - `text`: Spoken or normalized input text.
  - `anchorDate`: ISO date string (when recording time or utterance date is known).
  - `sessionTitle`: Contextual title of the session.
- `goldVerdict`: One of the 6 product verdicts (`"supported"`, `"mostly_supported"`, `"mixed"`, `"misleading"`, `"contradicted"`, `"insufficient_evidence"`).
- `acceptableVerdicts`: Array of acceptable verdicts (e.g. `["supported", "mostly_supported"]`).
- `goldReason`: Machine reason code (e.g. `"STRONG_INDEPENDENT_SUPPORT"`, `"DIRECT_CONTRADICTION"`, `"NO_RELEVANT_SOURCES"`).
- `expectedEvidence`: Array of key evidence expectations with expected stance and tier.
- `truthAsOf`: Ground-truth cutoff date.
- `tags`: Array of taxonomy tags (e.g. `"temporal"`, `"numeric_near_miss"`, `"syndication"`, `"injection"`, `"provider_down"`, etc.).
- `notes`: Annotator rationale and context.

## Dataset Discipline
1. **Dev vs. Test Split**: All prompt and threshold tuning must be performed exclusively on `dev`. `test` is frozen and used only for evaluation gates.
2. **Deterministic Replay**: In `--mode replay`, retrieval queries and scrapes load from `eval/fixtures/` without network calls.
3. **No Network Leak**: All fixture hashes are sha256-derived. Fixtures are excluded from git.
