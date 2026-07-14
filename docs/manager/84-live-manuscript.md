# 84.md — Live Project-Aware Manuscript (implementation document)

Manager/integrator record for the 84.md build. Multi-agent process: 4 investigation
agents (editor internals, data sources, event/version infra, tests) → this plan →
1 pure-engine implementation agent → UI wiring → adversarial review.

## Current architecture (pre-84)

Client-side feature (flag `manuscriptEditor`): pure engine `src/research-engine/manuscript/`
(model/draft/citations/tables/prismaCounts/sources/sourceHash/consistency/readiness) +
feature layer `src/features/manuscript/` (useManuscript hook, panels, WYSIWYG
contentEditable over a markdown subset, docx/repro exporters). Storage:
`project.manuscripts[]` drafts in the ONE Project.data blob (patch-debounced through the
generic autosave; now guarded by the autosaveRev CAS). Already present pre-84: deterministic
project-specific generation with bracketed placeholders (never fabrication), per-section
`inputsHash` OUTDATED detection guarded by source availability, per-block staleness hashes,
per-section locks, the never-overwrite-user-edits rule, cross-artefact consistency checks,
5-tier PRISMA precedence shared by table/diagram/narrative, repro manifest with engine
versions.

## Existing limitations addressed by 84

1. Staleness was binary per section (hash mismatch) with NO reasons, categories, proposed
   text, or review workflow — the user could only "Regenerate".
2. No explicit dependency graph → no "what changed → which sections" explanation.
3. No conflict-safe states beyond edited/locked: no approved-wording, detach/relink.
4. No snapshots / frozen submission versions; no restore.
5. Contradiction detection limited (estimator wording, counts); none for effect-measure/
   model claims, dual-review claims, abstract-estimate drift, deleted analyses.
6. Missing-information existed per-section; no aggregated, actionable panel with
   resolve-at routing.
7. Engine/formula version changes did not invalidate manuscript text.

## Dependency graph design

`dependencies.js`: a frozen registry of ~19 DEPENDENCY_KEYS (pico.question, search.date,
prisma.counts, studies.roster/values, analysis.model/tau2, rob.*, grade.certainty,
pubBias.results, engine.versions, template.style, …), each hashing a slim, stable
projection of the blob/opts (FNV-1a via sourceHash.hashOf). `SECTION_DEPENDENCIES` maps
each IMRAD section to its keys. Sections store `depState` (key→hash) at generation time
(stamped through applyGeneratedSections meta); `diffDeps(stored, fresh, sectionId)` names
exactly which dependencies changed — the "reason for update" with a category
(critical | methods | numerical | wording). `engine.versions` folds
CONVERSION/NMA/META_REGRESSION engine versions in, so a formula bump invalidates
dependent sections (Part 11).

## Sync / conflict-resolution rules (Part 7/8)

Section states: project (fully project-controlled) → auto-appliable; approved
(project-controlled with approved wording); edited (manually edited but linked) → NEVER
auto-overwritten, proposal + compare offered; detached (manual; lastLinked kept for
relink); locked (never changes; strong warning when underlying data moved).
`buildSyncPlan` produces per-section entries {current, proposed, reasons, category,
canAutoApply}; `applySyncDecision` implements accept / keep(approve) / detach / relink /
lock / unlock, appends to a bounded `syncLog`, and always refuses locked sections.
Discussion/Conclusion are interpretive: proposals are review-only (Part 17); the abstract
is flagged for review whenever its dependencies (incl. the primary estimate) change
(Part 16).

## Provenance (Part 10)

Per-section `sources[]` + `missing[]` + `inputsHash` + `depState` + generation time +
availability vector — surfaced in the editor as "Why does this say this?". Numerical
provenance continues to live in the analyses (resolveAnalysis + per-study conversions[]
with method/engine versions).

## Freshness (Part 9)

`computeFreshness` aggregates outdated sections + stale blocks + contradictions + missing
info + availability into one overall status (synced | warnings | updates | missing-info |
critical | unknown) + per-section statuses. Freshness derives from dependency versions,
never from generation recency.

## Events (Part 12/13)

The whole project state is client-derivable from the blob: every project mutation flows
through updateProject → the manuscript recomputes dependency state on the debounced
project object (no new event system needed client-side). Cross-client, the existing
`project.updated` SSE poke + refetch-when-clean covers invalidation; the autosaveRev CAS
prevents silent divergence. Background jobs are unnecessary at current scale (pure
recompute is O(studies)); the screeningAiJobs pattern remains available if generation
ever becomes heavy.

## Snapshots / reproducibility (Part 21)

`snapshots.js`: bounded (20) `draft.snapshots[]`, each carrying content + statements +
references + resolved PRISMA counts + depState + engine versions + app version; `frozen`
marks submission versions (undeletable without force); `restoreSnapshot` first appends an
automatic "Before restore" safety snapshot (Part 25 backup rule) and marks restored
sections user-edited so regeneration cannot clobber them.

## Migration / backward compatibility (Part 25)

None required: SCHEMA_VERSION stays 2; every new field is optional-additive and
normalizeDraft-preserved; legacy drafts normalize byte-identically (pinned by
enrichment.test.js). The legacy single-blob drafter (flag OFF) is untouched.

## Database / API changes

None. All computation is client-side over the blob; persistence rides the autosave
(now CAS-guarded). This deliberately satisfies Parts 12/22 with dependency-scoped
recomputes instead of server jobs.

## Testing

tests/unit/manuscript/liveSync.test.js (dependencies, sync plan + decisions,
contradictions, missing info, snapshots, freshness, normalize additivity) + the whole
pre-existing manuscript suite must stay green; e2e manuscript.spec.ts extended for the
Updates flow. Known deviation: full Part 23 end-to-end scenarios 1–8 are covered at the
unit level; browser-level coverage is the generate→outdate→review→accept path.
