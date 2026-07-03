# P10–P15 (70.md) — Final Summary Report

The six-phase 70.md program (P10–P15) is implemented, tested, adversarially verified where risky, documented, committed, and pushed. Each phase followed the mandated loop: inspect → plan → implement (recon + disjoint-ownership fan-out) → tests → build → version bump → per-phase report → commit → push → recommendations/limitations round → commit → push.

## Versions & commits

| Phase | Feature | Version | Flag (OFF by default) | Commits |
|---|---|---|---|---|
| **P10** | Criteria-based Eligibility Screening | v3.60.0 | `eligibilityScreening` | `848ad06` + `9e04d20` |
| **P11** | Guided Boolean Search Strategy Studio | v3.61.0 | `searchStrategyStudio` (+ searchEngine+pecanSearch) | `6e94b77` + `68571f5` |
| **P12** | GRADE Certainty Workspace + Summary of Findings | v3.62.0 | `gradeCertainty` | `f638ed4` + `05b77e1` |
| **P13** | Meta-regression + Bubble Plots | v3.63.0 | `metaRegression` | `6f3d3a2` + `8d106ca` |
| **P14** | Guided RoB Appraisal (RoB 2 + ROBINS-I) | v3.64.0 | `guidedRobAppraisal` (+ rob_engine_v2) | `2898cbd` + `fb4e58a` |
| **P15** | Bibliomine Citation Mining + Study Visualizations | v3.65.0 | `citationMining` (+ env `CITATION_MINING_LIVE_RESOLVE`) | `29f27c9` + `00dd2ed` |
| **Final** | User-facing "AI" wording removal + this summary | v3.65.x | — | *(see the wording commit)* |

**Versioning note:** the repo already uses `3.x` semver, so per 70.md's "unless the codebase already has a different versioning system" clause the phases continued it (P10→v3.60.0 … P15→v3.65.0) rather than resetting to `v0.10.0`. Documented in every phase report.

## Per-phase report index

- `P10_v3.60.0_criteria_screening_report.md`
- `P11_v3.61.0_boolean_search_report.md`
- `P12_v3.62.0_grade_report.md`
- `P13_v3.63.0_meta_regression_report.md`
- `P14_v3.64.0_guided_rob_report.md`
- `P15_v3.65.0_bibliomine_visualization_report.md`

## What each phase delivered (one line)

- **P10** — deterministic zero-training Criteria Screener (structured yes/no eligibility → suggested answer + confidence + quoted evidence → governed, reversible, human-signed decisions that never overwrite a human).
- **P11** — generate→critic→refine Boolean strategies tested with REAL PubMed/OpenAlex hit counts, iteration history, PRISMA-S export, seed-study recall estimation.
- **P12** — per-outcome GRADE certainty prefilled from RoB/I²/CI/Egger, human-confirmed + lockable + audited, Summary-of-Findings table that populates the manuscript SoF certainty column; CINeMA-ready model.
- **P13** — random-effects meta-regression (MoM + REML, validated to 1e-9) with a weighted bubble plot + statistical guardrails.
- **P14** — guided RoB appraisal adding ROBINS-I next to RoB 2, reading text to SUGGEST per-domain answers with quoted evidence, weighted-κ validation vs human; suggestions never overwrite human judgments; RoB 2 byte-identical.
- **P15** — seed-review reference mining → resolve → dedupe/import with provenance → OpenAlex citation chasing (bounded/cancellable) → choropleth + characteristic histograms.

## Cross-cutting guarantees held across all phases

- **Flag-gated OFF by default** — every feature is invisible/inert until an admin enables its flag; the app is byte-identical when off. Additive Prisma only (nullable/defaulted columns, brand-new tables; postgres mirror synced; drift test green each phase).
- **AI never auto-commits human decisions** — every suggestion (screening decisions, extraction, GRADE, RoB) is reviewable, reversible, traceable, and written to a non-human/proposed lane; human sign-off required.
- **Server-proxied, bounded, deterministic** — model/provider calls are server-side; external fan-out is rate-limited, retried, and hard-bounded (P11 iteration cap + probe cap; P15 depth≤3/≤2000 candidates, cancellable, live calls double-gated). No paywall bypass.
- **Honest metrics** — statistical engines (meta-regression, weighted κ) validated against hand-computed / independent references; no fabricated numbers or validation.
- **Adversarial verification** on the two highest-risk phases (P14, P15): independent reviewer panels tried to refute the safety invariants; confirmed the never-overwrite-human and RoB2-identical invariants HOLD and surfaced real defects that were fixed pre-push (P14: weighted-κ category order, flag gating, validation-κ inflation, redundant fetch; P15: import bypassing the shared capacity/tier/kill-switch gating, provenance truncation, imported-flag over-set, dedup key mismatch).

## Test posture at completion

- CI unit gate (`tests/unit` + `tests/screening/unit`): **3541 passed / 0 failed** after P15 (grew from 3130 pre-P10 as each phase added engine + UI tests).
- Per-phase server integration suites green against a live server; postgres schema-drift test green each phase; production build green each phase.

## Known limitations (carried forward, each with a concrete solution in its phase report)

- P11: `optimize` is synchronous/bounded (promote to a durable job for very slow providers).
- P12: per-outcome↔RoB linkage is best-effort until RoB gains a first-class outcome id; CINeMA is architecture-only.
- P13: UI is univariate (engine is multivariable-ready); no CSV covariate import yet.
- P14: ROBINS-I Q1.6 reachable on the time-split g-methods path (rare over-severity); `force` can overwrite a peer's *uncommitted* answers.
- P15: server-side PDF text extraction is client-assisted (private by design); P8 dashboard cards for study map/characteristics not yet wired into the sanitized public payload.

## Final user-facing "AI" wording removal

A final display-string-only sweep removed user-facing "AI" wording across the app (22 source files + 2 test/e2e files), with behavior byte-identical: no feature-flag keys, `data-testid`s, Prisma columns, routes, model names, file names, or identifiers changed — only rendered labels/headings/tooltips/button text.

- **Screening:** "AI Screening Engine" → "Screening Engine"; "AI relevance score" / "AI {n}" → "Relevance score" / "{n}"; "Run AI scoring" → "Run scoring"; Ops "AI Policy" sub-tab → "Engine policy" (section **id `aiPolicy` unchanged** → reachable).
- **Extraction:** "AI Assist" / "Extraction AI" → "Guided Assist" / "Extraction Assist" (nav + Ops heading; **ids `extractionAi` / testids unchanged**); "AI suggestions require human review" → "Suggestions require human review".
- **Manuscript / Living Review / shared:** "AI draft" → "Auto-draft"; "project's AI model" → "project's screening model"; entitlement labels "AI screening" → "Guided screening".
- **Tests/e2e updated in lockstep:** `e2e/page-objects/OpsPage.ts` HEADINGS (`Extraction AI` → `Extraction Assist`) and `tests/unit/extractionWorkspace.test.jsx`.
- **Intentionally retained (internal, non-rendered):** flag/entitlement KEYS (`aiScreening`, `extraction.aiAssist`, `screening.aiScoring`), columns (`aiSuggested`/`aiConfidence`), audit actions, file/identifier names (`AiAssist.jsx`, `AiScreeningSection`, `research-engine/screening/ai/*`), code comments, and copy behind the hardcoded-off `AI_FEATURES_ENABLED=false` dead path. Legitimate topical "AI" (e.g. a demo research question "does AI triage reduce mortality?") and the ISO country code `AI` (Anguilla) left as-is.

Verified: CI unit gate **3541 passed / 0 failed**; build green; residual user-facing scan clean.

## Recommended P16+ roadmap

- Optional semantic components behind sub-flags (eligibility, RoB appraisal) reusing the server embedding client.
- Durable-job `optimize` (P11) + multivariable meta-regression UI + CSV covariates (P13).
- Wire NMA certainty into GRADE via the CINeMA mapping (P12).
- Study-map / characteristics dashboard cards into the P8 public synthesis composer (P15).
- First-class outcome ids linking extraction ↔ RoB ↔ GRADE.
