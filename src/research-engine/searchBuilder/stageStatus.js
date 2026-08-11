/**
 * stageStatus.js — 85.md A1, re-keyed by 96.md. Pure, React-free per-stage
 * completion status for the 6-stage Search workflow (98.md §3 retired the
 * standalone Research Question stage). The UI (workspace rail +
 * white side-menu stepper) maps these to glyphs/colours; THIS module owns the
 * honesty rules.
 *
 * Statuses:
 *   'done'      — the stage's goal is verifiably met from persisted/live state;
 *   'partial'   — meaningfully started, not verifiably complete;
 *   'empty'     — nothing done yet;
 *   'attention' — the stage is BLOCKED by something the user must resolve before
 *                 the stage's goal can be called met (terms: a critical quality
 *                 finding). Reserved for real failure — the status language maps
 *                 it to the danger tone (navStatus.STATUS_META).
 *
 * STATUS vs ADVISORY (114.md §2 — the root-cause fix):
 *  Pending vocabulary suggestions and warning-severity quality findings are
 *  OPTIONAL REVIEW ITEMS, not defects: a strategy carrying an un-reviewed MeSH
 *  suggestion is a complete, valid, runnable strategy. Routing them through
 *  'attention' made a correctly-built search render as a red failure in the white
 *  side-menu stepper ("Build your search" in the danger tone), and it fired for
 *  nearly every real strategy — only an explicit reject/dismiss ever cleared it.
 *  They now live in a SEPARATE, ADDITIVE advisory channel
 *  (`computeStageAdvisories` / `computeStageModel().advisories`) that surfaces as
 *  a quiet count next to the stage, and NEVER demotes the status. Advisories are
 *  derived from the same persisted inputs (rejected + dismissedWarnings), so they
 *  recompute identically after a reload.
 *
 * DESIGN RULES:
 *  - 96.md removed PICO from the Search Engine: the terms stage keys off concept
 *    GROUPS generically — done = ≥1 group carrying ≥1 LIVE term (shared liveness
 *    rule — disabled terms don't count) and no CRITICAL quality finding. No P/I
 *    gating, and no completion claim from a single stray keyword: `liveTermsOf`
 *    IS the shared liveness rule the compilers use, so 'done' means "this
 *    genuinely compiles into a search".
 *  - Visited-agnostic and conservative: stages whose completion this layer cannot
 *    verify (running externally, exporting documentation) are never claimed 'done';
 *    they report 'partial' once a strategy exists. No fabricated progress.
 *
 * STAGE_IDS mirrors src/features/searchWorkspace/searchStages.js (the engine layer
 * must not depend on features/*); a unit test pins the two lists in sync.
 *
 * Deterministic + exhaustively unit-tested. No I/O.
 */
import { searchQualityCheck } from './crossConcept.js';
import { suggestionCount } from './suggestionReview.js';
import { liveTermsOf } from './termLiveness.js';

/** The 6 stage ids, in workflow order (mirror of searchStages.js STAGES).
 *  96.md — 'concepts' and 'refine' are retired (STAGE_ALIASES map them to 'terms');
 *  98.md §3 — 'question' is retired too (the question is edited inline on 'terms'). */
export const STAGE_IDS = Object.freeze([
  'terms', 'mode', 'strategy', 'results', 'documentation', 'screening',
]);

/** The status vocabulary (for consumers building legends/maps). */
export const STAGE_STATUS_VALUES = Object.freeze(['done', 'partial', 'empty', 'attention']);

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/** The advisory vocabulary for the terms stage (all counts, never a status). */
const emptyTermsAdvisory = () => ({ suggestions: 0, warnings: 0, total: 0 });

/**
 * The terms stage's raw signals, read ONCE per model build:
 *   anyLive    — ≥1 concept group carries ≥1 live term (the shared liveness rule);
 *   suggestions— pending vocabulary suggestions (rejections already applied);
 *   warnings   — un-dismissed warning-severity quality findings (advisory);
 *   criticals  — un-dismissed critical findings (the ONLY status blocker).
 * `info` findings are calm guidance and are counted nowhere.
 */
function termsSignals(o) {
  const concepts = Array.isArray(o.concepts) ? o.concepts : [];
  const anyLive = concepts.some((c) => liveTermsOf(c).length > 0);
  if (!anyLive) return { anyLive: false, suggestions: 0, warnings: 0, criticals: 0 };
  const suggestions = suggestionCount(concepts, o.rejected).total;
  const findings = searchQualityCheck(concepts, { dismissed: o.dismissedWarnings || [] });
  let warnings = 0;
  let criticals = 0;
  for (const f of findings) {
    if (f.severity === 'critical') criticals += 1;
    else if (f.severity === 'warning') warnings += 1;
  }
  return { anyLive, suggestions, warnings, criticals };
}

/**
 * computeStageModel(opts) → { statuses, advisories }
 * THE single pass. `statuses` is the 6-id status map (see computeStageStatuses);
 * `advisories` is the additive review channel:
 *   { terms: { suggestions, warnings, total } }   // all 0 when there is nothing to review
 * Advisories never change a status — a surface may render them beside one.
 *
 * @param {object} opts
 *   concepts           — the live concept-group list (question-derived + manual)
 *   searchMode         — 'manual' | 'automated' | null
 *   readyForScreening  — the screening handoff marker
 *   overrides          — per-database manual query overrides ({dbId: string})
 *   databases          — explicitly selected database ids ([] = defaults)
 *   rejected           — rejected suggestion keys (Set/array; suggestionReview)
 *   dismissedWarnings  — dismissed Search-Quality-Check ids (string[])
 * Unknown keys are ignored: `question`/`pico` (98.md §3 retired the question
 * stage — the question is edited inline on 'terms') and `filters`/`hitState`
 * (96.md retired the refine stage that read them) are accepted-and-ignored so
 * older callers keep working, but nothing in the CURRENT workflow supplies them.
 */
export function computeStageModel(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};

  // ── terms: ≥1 concept group with ≥1 live term AND no critical finding = done
  //    (generic — no PICO roles). Pending suggestions / warning findings are
  //    advisory (114.md §2) and are reported beside the status, not inside it. ──
  const t = termsSignals(o);
  const termsStatus = !t.anyLive ? 'empty' : (t.criticals > 0 ? 'attention' : 'done');
  const anyLive = t.anyLive;

  // ── mode: an explicit choice was made ──
  const modeStatus = (o.searchMode === 'manual' || o.searchMode === 'automated') ? 'done' : 'empty';

  // ── strategy (manual only): explicit engagement = databases chosen or a per-DB
  //    override written; otherwise a compiling strategy is only 'partial'. ──
  const overrides = o.overrides && typeof o.overrides === 'object' ? o.overrides : {};
  const hasOverride = Object.values(overrides).some((v) => hasText(v));
  const hasDbChoice = Array.isArray(o.databases) && o.databases.length > 0;
  let strategyStatus = 'empty';
  if (anyLive) strategyStatus = (hasOverride || hasDbChoice) ? 'done' : 'partial';

  // ── results / documentation: this pure layer cannot verify an external run or
  //    an export, so neither is ever claimed 'done' (visited-agnostic honesty);
  //    once a strategy exists they read 'partial'. ──
  const startedStatus = anyLive ? 'partial' : 'empty';

  // ── screening: the advisory handoff marker is the stage's whole meaning. ──
  const screeningStatus = o.readyForScreening ? 'done' : 'empty';

  return {
    statuses: {
      terms: termsStatus,
      mode: modeStatus,
      strategy: strategyStatus,
      results: startedStatus,
      documentation: startedStatus,
      screening: screeningStatus,
    },
    advisories: {
      terms: t.anyLive
        ? { suggestions: t.suggestions, warnings: t.warnings, total: t.suggestions + t.warnings }
        : emptyTermsAdvisory(),
    },
  };
}

/**
 * computeStageStatuses(opts) → { [stageId]: 'done'|'partial'|'empty'|'attention' }
 * Always emits ALL 6 ids and NOTHING else (mode-scoped consumers simply ignore the
 * stages their rail removed) — the long-standing shape every consumer keys off.
 * Use `computeStageModel` when the advisory counts are wanted too.
 */
export function computeStageStatuses(opts = {}) {
  return computeStageModel(opts).statuses;
}

/**
 * computeStageAdvisories(opts) → { terms: { suggestions, warnings, total } }
 * The additive review channel on its own (see computeStageModel).
 */
export function computeStageAdvisories(opts = {}) {
  return computeStageModel(opts).advisories;
}
