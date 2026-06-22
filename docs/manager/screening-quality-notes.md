# Screening engine — quality ratings + reviewer notes as signals (prompt49 item 1)

## What this delivers
The AI screening engine now uses each screened study's **reviewer quality rating**
(`ScreenDecision.rating`) and **reviewer note** (`ScreenDecision.notes`) — which
were previously stored but unused — as **separate, traceable signals**, without
changing the validated relevance classifier.

## The four concepts, kept separate
The prompt is explicit that eligibility and quality are related but distinct. The
engine now exposes four independent axes per record (`activeLearning.js`):

1. **Eligibility / relevance** — the existing hybrid classifier `score`. **Unchanged.**
   Reviewer quality/notes do NOT feed the classifier's features or training, so a
   low-quality study stays as relevant as the text warrants, and a high-quality
   study can't be promoted on quality alone.
2. **Methodological quality** — `methodologicalQuality` ∈ [0,1], the mean of
   reviewers' normalised 1–5 ratings (`reviewerSignals.js`). `null` when nobody rated.
3. **Reviewer confidence** — `reviewerConfidence` ∈ [0,1] from inter-reviewer
   agreement, dampened by `maybe` votes and any note-expressed uncertainty.
4. **Prioritisation** — `prioritization`: the relevance score plus a **hard-clamped
   ±0.05** nudge from quality, for ranking/surfacing only. It is mathematically
   incapable of flipping an include/exclude band (those thresholds are far wider),
   so quality can never overwhelm eligibility. Equals `score` when no rating exists.

## Structured note extraction (`noteSignals.js`)
A note is digested into fixed categories via conservative phrase patterns:
population / intervention / comparator / outcome match-or-mismatch, study-design
concern, methodological limitation, risk-of-bias, sample-size, duplicate, wrong
setting / language / publication-type, reason-to-include, reason-to-exclude,
uncertainty, and quality observation. This is **deep enough to be useful but not a
naïve keyword search**: it distinguishes polarity (include vs exclude vs concern)
and only fires on clear phrasing (false negatives preferred over false claims).

## Safety properties (all enforced + tested)
- **Untrusted input / injection-proof.** Notes are length-capped (4000 chars),
  lowercased, and only matched against fixed regexes; the note text is NEVER
  executed, never interpolated into instructions, and never echoed — emitted
  factors are fixed category labels. A prompt-injection note ("ignore previous
  instructions…") produces zero signals.
- **No CoT leakage.** Explanations show concise, evidence-grounded factors
  ("Reviewer flagged a sample-size concern"), never raw note text or internal
  reasoning.
- **Project isolation.** Signals are derived only from the one project's own
  decisions (the engine already loads a single `(projectId, stage)` scope); no
  cross-project or cross-tenant contamination is possible.
- **Multi-reviewer independence.** Per-reviewer rating + note provenance is kept
  in `byReviewer`; conflicting opinions surface as a `conflict` flag and are never
  flattened into one unexplained value. **Blind-mode safe:** when a record is under
  independent blind review (`ScreenProject.blindMode`), `revealReviewerSignals` is
  false and the engine returns a *suppressed stub* — it computes and exposes nothing
  derived from other reviewers, so one reviewer's hidden rating/note can't leak.
- **Quality never overwhelms eligibility** — see prioritisation clamp above.

## Recalculation on change
A rescore is queued (debounced, via the existing `ScreenAiJob` queue) when a human
saves an include/exclude decision (changes the training set) OR a **quality rating
or reviewer note** (changes the signal layer) — `screeningController.saveDecision`.
So the AI panel reflects the latest human input without a synchronous retrain.

## Explainability
`buildExplanation` now adds reviewer factors: include/exclude-polarity note factors
join the inline `reasonsInclude` / `reasonsExclude` lists (so they render in the
existing "Why this score?" panel), and a structured `explanation.reviewer` block
carries `methodologicalQuality`, `reviewerConfidence`, `conflict`, decision counts,
and the factor list for richer UI. Persisted in `ScreenAiScore.signalsJson` /
`explanationJson` — **no schema change**.

## Offline validation / "is it better?"
Per the prompt, no claim that the *relevance model* improved is made — because the
relevance model is deliberately **unchanged** (quality/notes are an additive,
separate layer). The properties that ARE validated by the test suite:
- The relevance `score` is **byte-identical** with and without reviewer signals
  (`reviewerSignalsEngine.test.js` — proves non-interference).
- The engine still works when notes and/or ratings are absent (signals → null, no
  crash; prioritisation == relevance).
- Conflicting / missing / malformed / extreme inputs are handled
  (`reviewerSignals.test.js`).
- Injection / empty / oversized notes are inert (`noteSignals.test.js`).

## Files
- `src/research-engine/screening/ai/noteSignals.js` — pure note extraction.
- `src/research-engine/screening/ai/reviewerSignals.js` — pure aggregation (4 axes).
- `src/research-engine/screening/ai/activeLearning.js` — wires signals per record.
- `src/research-engine/screening/ai/explain.js` — surfaces reviewer factors.
- `server/services/screeningAiService.js` — loads rating/notes, passes blind-aware.
- `server/controllers/screeningController.js` — rescore trigger on rating/note edit.
- Tests: `tests/unit/screening/ai/{noteSignals,reviewerSignals,reviewerSignalsEngine}.test.js`.

## Remaining depth (documented, not blocking)
The note extractor is deterministic/pattern-based (in keeping with the engine's
deterministic, reproducible design). A future hosted-embedding pass could add
semantic note understanding behind the existing `AI_EMBEDDING_PROVIDER=hosted` seam
(privacy-gated, never sending notes to an external provider without explicit
configuration) — the integration seam is already in place.
