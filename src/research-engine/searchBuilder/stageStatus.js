/**
 * stageStatus.js — 85.md A1. Pure, React-free per-stage completion status for the
 * 9-stage Search workflow. The UI (workspace rail + white side-menu stepper) maps
 * these to glyphs/colours; THIS module owns the honesty rules.
 *
 * Statuses:
 *   'done'      — the stage's goal is verifiably met from persisted/live state;
 *   'partial'   — meaningfully started, not verifiably complete;
 *   'empty'     — nothing done yet;
 *   'attention' — actionable findings await the user (pending vocabulary
 *                 suggestions, un-dismissed quality warnings).
 *
 * DESIGN RULES (from the 85.md critique round):
 *  - Legitimately-empty concepts must not nag: Comparator/Outcomes/Time are OPTIONAL
 *    (many sensitive searches deliberately omit them — searchQualityCheck already
 *    treats empty Outcomes as info). "Concepts done" = Population AND Intervention
 *    each carry ≥1 LIVE term (shared liveness rule — disabled terms don't count).
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

/** The 9 stage ids, in workflow order (mirror of searchStages.js STAGES). */
export const STAGE_IDS = Object.freeze([
  'question', 'concepts', 'terms', 'mode', 'strategy',
  'refine', 'results', 'documentation', 'screening',
]);

/** The status vocabulary (for consumers building legends/maps). */
export const STAGE_STATUS_VALUES = Object.freeze(['done', 'partial', 'empty', 'attention']);

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/** True when the filters block carries any active limit. */
function filtersActive(filters) {
  const f = filters && typeof filters === 'object' ? filters : {};
  return hasText(f.dateFrom) || hasText(f.dateTo)
    || (Array.isArray(f.languages) && f.languages.length > 0)
    || (Array.isArray(f.pubTypes) && f.pubTypes.length > 0);
}

/**
 * computeStageStatuses(opts) → { [stageId]: 'done'|'partial'|'empty'|'attention' }
 * Always emits ALL 9 ids; mode-scoped consumers (stagesFor) simply ignore the
 * stages their rail removed.
 *
 * @param {object} opts
 *   concepts           — the live concept list (five PICO groups + manual)
 *   pico               — the protocol PICO object ({P,I,C,O,question,...})
 *   searchMode         — 'manual' | 'automated' | null
 *   readyForScreening  — advisory handoff marker
 *   filters            — persisted search-scope limits
 *   overrides          — per-database manual query overrides ({dbId: string})
 *   databases          — explicitly selected database ids ([] = defaults)
 *   rejected           — rejected suggestion keys (Set/array; suggestionReview)
 *   dismissedWarnings  — dismissed Search-Quality-Check ids (string[])
 *   hitState           — live PubMed count state ({status, hitCount, ...}) or null
 */
export function computeStageStatuses(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const concepts = Array.isArray(o.concepts) ? o.concepts : [];

  // ── concepts: P + I each need ≥1 live term; C/O/T are legitimately optional ──
  const liveOf = (key) => {
    const c = concepts.find((x) => x && x.picoField === key);
    return c ? liveTermsOf(c).length : 0;
  };
  const anyLive = concepts.some((c) => liveTermsOf(c).length > 0);
  let conceptsStatus = 'empty';
  if (anyLive) conceptsStatus = (liveOf('P') >= 1 && liveOf('I') >= 1) ? 'done' : 'partial';

  // ── terms: concepts done AND no pending suggestions AND no error-severity QC ──
  let termsStatus = conceptsStatus === 'done' ? 'done' : conceptsStatus;
  if (conceptsStatus === 'done') {
    const pending = suggestionCount(concepts, o.rejected).total;
    if (pending >= 1) {
      termsStatus = 'attention';
    } else {
      const findings = searchQualityCheck(concepts, { dismissed: o.dismissedWarnings || [] });
      // 'error severity' = warning/critical; info entries are calm guidance, not blockers.
      if (findings.some((w) => w.severity === 'warning' || w.severity === 'critical')) termsStatus = 'attention';
    }
  }

  // ── question: any PICO field captured ──
  const pico = o.pico && typeof o.pico === 'object' ? o.pico : {};
  const questionStatus = Object.values(pico).some(hasText) ? 'done' : 'empty';

  // ── mode: an explicit choice was made ──
  const modeStatus = (o.searchMode === 'manual' || o.searchMode === 'automated') ? 'done' : 'empty';

  // ── strategy (manual only): explicit engagement = databases chosen or a per-DB
  //    override written; otherwise a compiling strategy is only 'partial'. ──
  const overrides = o.overrides && typeof o.overrides === 'object' ? o.overrides : {};
  const hasOverride = Object.values(overrides).some((v) => hasText(v));
  const hasDbChoice = Array.isArray(o.databases) && o.databases.length > 0;
  let strategyStatus = 'empty';
  if (conceptsStatus !== 'empty') strategyStatus = (hasOverride || hasDbChoice) ? 'done' : 'partial';

  // ── refine: a fresh live count = tested; a count in flight/stale or active
  //    limits = started; nothing observed = empty. Never fabricates a count. ──
  const hit = o.hitState && typeof o.hitState === 'object' ? o.hitState : null;
  let refineStatus = 'empty';
  if (conceptsStatus !== 'empty') {
    if (hit && hit.status === 'updated') refineStatus = 'done';
    else if (hit || filtersActive(o.filters)) refineStatus = 'partial';
  }

  // ── results / documentation: this pure layer cannot verify an external run or
  //    an export, so neither is ever claimed 'done' (visited-agnostic honesty);
  //    once a strategy exists they read 'partial'. ──
  const startedStatus = conceptsStatus === 'empty' ? 'empty' : 'partial';

  // ── screening: the advisory handoff marker is the stage's whole meaning. ──
  const screeningStatus = o.readyForScreening ? 'done' : 'empty';

  return {
    question: questionStatus,
    concepts: conceptsStatus,
    terms: termsStatus,
    mode: modeStatus,
    strategy: strategyStatus,
    refine: refineStatus,
    results: startedStatus,
    documentation: startedStatus,
    screening: screeningStatus,
  };
}
