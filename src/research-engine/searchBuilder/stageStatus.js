/**
 * stageStatus.js — 85.md A1, re-keyed by 96.md. Pure, React-free per-stage
 * completion status for the 7-stage Search workflow. The UI (workspace rail +
 * white side-menu stepper) maps these to glyphs/colours; THIS module owns the
 * honesty rules.
 *
 * Statuses:
 *   'done'      — the stage's goal is verifiably met from persisted/live state;
 *   'partial'   — meaningfully started, not verifiably complete;
 *   'empty'     — nothing done yet;
 *   'attention' — actionable findings await the user (pending vocabulary
 *                 suggestions, un-dismissed quality warnings).
 *
 * DESIGN RULES:
 *  - 96.md removed PICO from the Search Engine: the question stage keys off the
 *    RESEARCH QUESTION text (threaded in as `opts.question`; `opts.pico.question`
 *    stays a legacy fallback so old callers keep working), and the terms stage
 *    keys off concept GROUPS generically — done = ≥1 group carrying ≥1 LIVE term
 *    (shared liveness rule — disabled terms don't count). No P/I gating.
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

/** The 7 stage ids, in workflow order (mirror of searchStages.js STAGES).
 *  96.md — 'concepts' and 'refine' are retired (STAGE_ALIASES map them to 'terms'). */
export const STAGE_IDS = Object.freeze([
  'question', 'terms', 'mode', 'strategy', 'results', 'documentation', 'screening',
]);

/** The status vocabulary (for consumers building legends/maps). */
export const STAGE_STATUS_VALUES = Object.freeze(['done', 'partial', 'empty', 'attention']);

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * computeStageStatuses(opts) → { [stageId]: 'done'|'partial'|'empty'|'attention' }
 * Always emits ALL 7 ids; mode-scoped consumers (stagesFor) simply ignore the
 * stages their rail removed.
 *
 * @param {object} opts
 *   concepts           — the live concept-group list (question-derived + manual)
 *   question           — the research-question text (96.md — the authoritative input)
 *   pico               — LEGACY fallback: {question} is read when opts.question is absent
 *   searchMode         — 'manual' | 'automated' | null
 *   readyForScreening  — advisory handoff marker
 *   filters            — persisted search-scope limits
 *   overrides          — per-database manual query overrides ({dbId: string})
 *   databases          — explicitly selected database ids ([] = defaults)
 *   rejected           — rejected suggestion keys (Set/array; suggestionReview)
 *   dismissedWarnings  — dismissed Search-Quality-Check ids (string[])
 *   (filters/hitState are accepted-and-ignored — the retired refine stage read them)
 */
export function computeStageStatuses(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const concepts = Array.isArray(o.concepts) ? o.concepts : [];

  // ── question: the research-question text is captured (96.md D5). The legacy
  //    `pico.question` fallback keeps pre-96 callers honest without PICO gating. ──
  const pico = o.pico && typeof o.pico === 'object' ? o.pico : {};
  const questionText = hasText(o.question) ? o.question : pico.question;
  const questionStatus = hasText(questionText) ? 'done' : 'empty';

  // ── terms: ≥1 concept group with ≥1 live term = done (generic — no PICO roles);
  //    'attention' overlays when actionable findings await: pending vocabulary
  //    suggestions or un-dismissed warning/critical quality findings. ──
  const anyLive = concepts.some((c) => liveTermsOf(c).length > 0);
  let termsStatus = anyLive ? 'done' : 'empty';
  if (anyLive) {
    const pending = suggestionCount(concepts, o.rejected).total;
    if (pending >= 1) {
      termsStatus = 'attention';
    } else {
      const findings = searchQualityCheck(concepts, { dismissed: o.dismissedWarnings || [] });
      // 'error severity' = warning/critical; info entries are calm guidance, not blockers.
      if (findings.some((w) => w.severity === 'warning' || w.severity === 'critical')) termsStatus = 'attention';
    }
  }

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
    question: questionStatus,
    terms: termsStatus,
    mode: modeStatus,
    strategy: strategyStatus,
    results: startedStatus,
    documentation: startedStatus,
    screening: screeningStatus,
  };
}
