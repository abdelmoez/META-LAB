/**
 * robController.js — META·LAB RoB (Risk of Bias) API (rob.md §5).
 *
 * The pure engine (src/research-engine/rob) is the SINGLE SOURCE OF TRUTH for
 * judgements — this controller never re-implements the algorithm. It persists
 * answers + BOTH the engine-PROPOSED and the (possibly overridden) FINAL
 * judgement, recomputing proposals server-side on every answer change.
 *
 * Access (prompt41 Task 5): the META·LAB project OWNER, OR a linked-workspace member
 * granted `canAssessRiskOfBias` (see resolveRobAccess). No access → 404 (existence
 * hidden); write actions further require edit rights (read-only RoB members → 403).
 * Gated behind feature flag `rob_engine_v2` (default OFF → 404).
 * Every create / answer / override / finalise / delete writes a RobAuditLog row.
 */
import { prisma } from '../db/client.js';
// 101.md §28/§29 — RoB changes reach the manuscript through the ONE project event
// ledger, not a second RoB-specific notification path.
import { recordEvent } from '../provenance/recordEvent.js';
import { getById as getOwnedProject, touchProjectActivity, mutateProjectBlob } from '../store.js';
import { getRobMemberAccess } from '../screening/metalabAccess.js';
import { featureAccess } from '../services/featureAccess.js';
import { canMutateAssessment, normaliseScreeningStudy, normaliseManualStudy } from './robAccess.js';
import { ROB_TOOLS, getRobTool, isStarScoredTool, toolsForStudyDesign } from '../../src/research-engine/rob/tools.js';
import { sendTierLimit } from '../services/entitlementService.js';
import { requireProjectExport, settleProjectExport, EXPORT_TYPES } from '../services/projectExportGuard.js';
import { buildRobProjectCsv, blindGroups } from '../services/robExportService.js';
import {
  getInstrument,
  isScoringInstrument,
  proposeDomain,
  proposeAllDomains,
  proposeOverall,
  completeness as engineCompleteness,
  summaryMatrix,
  RESPONSES,
  // P14 — guided appraisal (deterministic text → suggested answers) + agreement.
  appraiseFromText,
  hasAppraisalCues,
  APPRAISAL_INSTRUMENT_IDS,
  ROB_APPRAISAL_VERSION,
  robDomainAgreement,
  // 101.md §18–§22 — Newcastle–Ottawa Scale: star scoring + the deliberately
  // separate, deliberately optional threshold-interpretation layer.
  nosScoreAssessment,
  nosSelectedValues,
  interpretNos,
  NOS_THRESHOLD_MODES,
  NOS_DEFAULT_THRESHOLD_MODE,
  NOS_MAX_STARS,
  AHRQ_STANDARD,
  NOS_CONVENTIONAL_BANDS,
  NOS_CONVENTIONAL_BANDS_NOTICE,
  // 115.md — the SECOND judgement axis. The suffix + both directions of the
  // (domainId ⇄ applicability key) mapping live in the pure engine so the server,
  // the renderer and the exporter can never drift onto two different storage keys.
  APPLICABILITY_SUFFIX,
  applicabilityDomainId,
  isApplicabilityDomainId,
  baseDomainId,
} from '../../src/research-engine/rob/index.js';

// ── Instrument awareness (P14) ────────────────────────────────────────────────
// The RoB service was hardcoded to RoB2. It is now instrument-aware: each
// assessment carries its own `instrumentId` (RoB2 | ROBINS-I) and every judgement
// path derives its instrument + valid judgement set + question→domain map from
// THAT instrument. Responses (Y/PY/PN/N/NI/NA) are identical across instruments,
// so VALID_RESPONSES stays shared. The RoB2 path is byte-identical to before.
const VALID_RESPONSES = new Set(RESPONSES);

// ── 115.md decision 3 — instrument availability is REGISTRY-DRIVEN ────────────
// This used to be `SUPPORTED_INSTRUMENTS = ['RoB2','ROBINS-I','NOS','NOS-CC']`, a
// hardcoded allowlist that had to be edited for every new tool, PLUS a feature-flag
// gate that made ROBINS-I creatable only when `guidedRobAppraisal` was ON. Both are
// gone:
//   · an instrument is creatable when the PURE ENGINE can resolve a DEFINITION for
//     it. Registering a definition (src/research-engine/rob/instruments/*, wired
//     into the engine registry + the tools catalogue) makes it creatable with no
//     server change at all;
//   · `guidedRobAppraisal` now gates ONLY the guided-appraisal FEATURES (the
//     text→suggestion appraiser and the machine-vs-human κ validation). It never
//     decides WHICH instruments a reviewer may select — that was a category error:
//     ROBINS-I is a Cochrane instrument, not a machine-suggestion feature.
// Unknown ids are rejected (400 naming the id), never silently coerced.

// The instruments that predate the registry sweep. Kept ONLY as a seed for
// enumeration, so the list of creatable ids is correct even if a definition is
// registered in the engine before it is described in the tools catalogue.
const BASE_INSTRUMENT_IDS = Object.freeze(['RoB2', 'ROBINS-I', 'NOS', 'NOS-CC']);

/**
 * Resolve an instrument DEFINITION by id, or null when the registry has none.
 * `getInstrument` throws for unknown ids; this is the non-throwing seam every
 * request path uses. Pure.
 */
export function resolveInstrument(id) {
  const wanted = String(id == null ? '' : id).trim();
  if (!wanted) return null;
  try { return getInstrument(wanted) || null; } catch { return null; }
}

/**
 * Every instrument id that currently HAS a definition: the tools catalogue plus
 * the historical base set, de-duplicated, in catalogue order. A catalogue entry
 * with no definition yet (status 'coming-soon') is excluded — advertising a tool
 * is not the same as being able to assess with it. Pure.
 */
export function registeredInstrumentIds() {
  const seen = new Set();
  const out = [];
  for (const id of [...BASE_INSTRUMENT_IDS, ...ROB_TOOLS.map(t => t.id)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (resolveInstrument(id)) out.push(id);
  }
  return out;
}

/** Is this id a real, creatable instrument right now? Pure. */
export function isRegisteredInstrument(id) {
  return !!resolveInstrument(id);
}

// ── 115.md decision 6 — design-based RECOMMENDATIONS (never restrictions) ─────
// `toolsForStudyDesign` has existed and been unit-tested since 101.md with no live
// consumer (dossier §15.3). It is wired here: the Assess surface gets, per study,
// the design we could DETECT plus the recommended instruments — while every
// registered instrument stays selectable. A mismatch is an inline warning, never a
// block; an undetectable design produces NO recommendation and NO warning (a guess
// dressed as guidance would be worse than silence).

/** The study designs a tool declares it covers (catalogue or definition). Pure. */
export function designsForTool(tool, instrument) {
  const t = tool || {};
  const i = instrument || {};
  const list = [
    ...(Array.isArray(t.designs) ? t.designs : []),
    ...(Array.isArray(i.designs) ? i.designs : []),
    ...(t.design ? [t.design] : []),
    ...(i.design ? [i.design] : []),
  ].map(d => String(d || '').trim()).filter(Boolean);
  return [...new Set(list)];
}

/**
 * Best-effort study design from whatever the source record happens to carry
 * (dossier §8: the RoB study universe has no design column; design lives in the
 * legacy blob's `design` / extraction's study-design field). Never guesses. Pure.
 */
export function detectStudyDesign(source) {
  const s = source || {};
  for (const key of ['design', 'studyDesign', 'study_design', 'studyType', 'study_type', 'type']) {
    const v = s[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Loose containment match between a declared design and a free-text one. Pure. */
function designCovers(declared, detected) {
  const a = String(declared || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const b = String(detected || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (a.length < 4 || b.length < 3) return false;
  return b.includes(a) || a.includes(b);
}

/**
 * The recommendation payload for one study. `compatible` is deliberately ALL
 * registered instruments (decision 3/6 — nothing is hidden); `mismatchToolIds`
 * tells the UI when to render the warning sentence.
 *
 * @param {string} design free-text detected design ('' when unknown)
 * @param {Array<{id,label,designs}>} catalogue instrumentCatalogue() rows
 * Pure.
 */
export function recommendationFor(design, catalogue = []) {
  const all = catalogue.map(t => t.id);
  const detected = String(design || '').trim();
  if (!detected) {
    return { design: '', recommendedToolIds: [], compatibleToolIds: all, mismatchToolIds: [], warning: '' };
  }
  const recommended = toolsForStudyDesign(detected).filter(id => all.includes(id));
  if (!recommended.length) {
    // A design we cannot route is the same as no design: no recommendation, and
    // therefore nothing to warn about.
    return { design: detected, recommendedToolIds: [], compatibleToolIds: all, mismatchToolIds: [], warning: '' };
  }
  const mismatch = catalogue
    .filter(t => !recommended.includes(t.id) && !(t.designs || []).some(d => designCovers(d, detected)))
    .map(t => t.id);
  const names = recommended.map(id => (catalogue.find(t => t.id === id) || {}).label || id);
  const warning = `This study's recorded design is "${detected}". ${names.join(' or ')} ${names.length > 1 ? 'are the recommended instruments' : 'is the recommended instrument'} for that design — another tool can still be used, but say why in the methods.`;
  return { design: detected, recommendedToolIds: recommended, compatibleToolIds: all, mismatchToolIds: mismatch, warning };
}

// 101.md §25 — a reconciled dual-reviewer record is a THIRD RobAssessment row
// carrying this status. It is an IDENTITY, not a workflow stage: the row stays
// 'consensus' through finalise/reopen so the reconciled record is always findable.
export const CONSENSUS_STATUS = 'consensus';

/** The instrument for a loaded assessment (defaults to RoB2 → unchanged path). */
function instrumentFor(a) {
  return getInstrument((a && a.instrumentId) || 'RoB2');
}
/** True when the assessment/instrument is star-scored (NOS) rather than judgement-based. */
function isStarInstrument(instrument) {
  return isScoringInstrument(instrument);
}
/** questionId → domainId map for an instrument. */
function questionDomainMap(instrument) {
  const map = {};
  for (const d of instrument.domains) for (const q of (d.questions || d.items || [])) map[q.id] = d.id;
  return map;
}

// ── 115.md decisions 1/4 — DEFINITION-DRIVEN vocabularies ─────────────────────
// Thirteen instruments do NOT share one response vocabulary: RoB 2 / ROBINS-I /
// PROBAST use Y/PY/PN/N/NI, QUADAS-2 uses Yes/No/Unclear, JBI adds Not applicable,
// AMSTAR 2 has Partial Yes, the NOS has per-item option lists. So the allowed
// values come from the DEFINITION, never from a server constant. An off-form value
// must never be stored (the 101.md nosPersistence rule, generalised): a junk value
// would silently look like a considered judgement.
//
// Every helper below is tolerant of the small naming variations a definition may
// use, and every one of them falls back to EXACTLY the pre-115 behaviour when the
// definition says nothing — so RoB 2 / ROBINS-I / NOS paths are unchanged.

/** Coerce a level/option list (strings or {value}) to a string[] of values. Pure. */
export function levelValues(src) {
  if (!Array.isArray(src)) return [];
  const out = [];
  for (const l of src) {
    const v = (l && typeof l === 'object') ? l.value : l;
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The responses one ITEM may take. Item-level first, then domain-level, then an
 * instrument-level CHECKLIST vocabulary, else the shared Y/PY/PN/N/NI/NA set.
 *
 * NOTE the deliberate omission: `instrument.responseOptions` is NOT consulted. On
 * RoB 2 that field is the UI's option list, which excludes 'NA' by design
 * (rob2.js:263) even though NA is a storable answer — reading it here would start
 * rejecting legal answers. Definitions that want to narrow the vocabulary declare
 * it on the item/domain, or as `itemResponses`/`checklistResponses`. Pure.
 */
export function allowedResponsesFor(instrument, domain, question) {
  const q = levelValues(question && (question.responses || question.responseOptions || question.allowedResponses));
  if (q.length) return new Set(q);
  const d = levelValues(domain && (domain.responses || domain.responseOptions));
  if (d.length) return new Set(d);
  const i = levelValues(instrument && (instrument.itemResponses || instrument.checklistResponses));
  if (i.length) return new Set(i);
  return VALID_RESPONSES;
}

/**
 * Valid DOMAIN judgement values (RoB2: low/some/high; ROBINS-I: 5 levels). Pure.
 *
 * ── THE INSTRUMENT-LEVEL FALLBACK IS FOR PRE-115 DEFINITIONS ONLY ───────────
 * Mirrors src/frontend/rob/robProgress.js `domainJudgmentLevels`, deliberately, so
 * the server and the workspace can never disagree about whether a tool rates its
 * domains at all.
 *
 * On RoB 2 / ROBINS-I / NOS (no `overall` contract) `instrument.judgmentLevels` IS
 * the per-domain vocabulary, and inheriting it is right. On a 115-shape definition
 * the per-domain axis is declared explicitly on the DOMAIN (`domain.judgment`) and
 * `instrument.judgmentLevels` means something else entirely — on AMSTAR 2 it is
 * the OVERALL CONFIDENCE scale. Inheriting it there invented a per-domain
 * judgement AMSTAR 2 does not make, with two live consequences: the override
 * endpoint ACCEPTED `{domainId:'items', finalJudgment:'critically-low'}` as a
 * domain rating, and the project list served a traffic-light `matrix` for a tool
 * whose single domain is never rated.
 *
 * With no domain named the answer is "whatever this instrument's domains declare"
 * — read off the domains rather than off the instrument, so QUADAS-2 / PROBAST /
 * QUIPS still report their real Low/High/Unclear (or Low/Moderate/High) scale and
 * AMSTAR 2 and the JBI checklists correctly report none.
 */
export function domainJudgmentLevels(instrument, domain) {
  const d = levelValues(domain && (domain.judgmentLevels || (domain.judgment && domain.judgment.levels)));
  if (d.length) return d;
  if (instrument && 'overall' in instrument) {
    if (domain) return [];
    for (const dd of (instrument.domains || [])) {
      const own = levelValues(dd.judgmentLevels || (dd.judgment && dd.judgment.levels));
      if (own.length) return own;
    }
    return [];
  }
  const i = levelValues(instrument && (instrument.judgmentLevels
    || (instrument.domainJudgment && instrument.domainJudgment.levels)));
  return i;
}

/**
 * Valid OVERALL values, or null when the instrument declares that it HAS no
 * overall judgement (QUIPS reports domain ratings only — 115.md decision 4:
 * "null when the tool has no overall — NEVER invent"). An instrument that says
 * nothing keeps the pre-115 behaviour (overall uses the domain vocabulary). Pure.
 */
export function overallLevelsFor(instrument) {
  if (!instrument) return [];
  const declaresNone = instrument.hasOverall === false
    || ('overallLevels' in instrument && instrument.overallLevels == null)
    || ('overall' in instrument && instrument.overall == null);
  if (declaresNone) return null;
  const o = levelValues(instrument.overallLevels
    || instrument.overallDecisions
    || (instrument.overall && (instrument.overall.levels || instrument.overall.values || instrument.overall.decisions)));
  if (o.length) return o;
  return domainJudgmentLevels(instrument, null);
}

// ── Applicability judgements without a schema change (115.md build item 2) ────
// QUADAS-2 and PROBAST judge each of their first domains TWICE: a risk-of-bias
// judgement AND an applicability-concern judgement. RobDomainJudgment is unique on
// (assessmentId, domainId), has NO applicability column, and 115 forbids schema
// changes.
//
// DECISION: an applicability judgement is stored as a SECOND RobDomainJudgment row
// whose `domainId` carries a reserved suffix — `D1` (risk of bias) and `D1-APP`
// (applicability concern). This mirrors 101.md's reuse of the existing `variant`
// column to discriminate the two Newcastle–Ottawa forms: an existing string column
// carries the discriminator instead of a new one.
//   · the row is additive, so recomputeAndPersist / finalise / reopen (which
//     iterate the DEFINITION's domains) never touch it;
//   · it inherits the unique index, the cascade delete, the override-justification
//     field and the audit trail for free;
//   · when a definition ships a computed applicability rule, its proposal lands in
//     the same row's `proposedJudgment` with the human value still in
//     `finalJudgment` — no migration.
// Every reader that treats domain rows as "the instrument's domains" filters these
// keys out (proposeOverall input, κ pairs, the summary matrix).
//
// The suffix and both directions of the mapping live in the PURE engine
// (instruments/shared.js) so the server, the renderer and the exporter can never
// drift onto two different keys. The server re-exports them under its own names
// only so existing call sites read the same as before.
export { APPLICABILITY_SUFFIX };

/** The storage key for a domain's applicability judgement. Pure. */
export function applicabilityKey(domainId) {
  return applicabilityDomainId(domainId);
}

/** Split a stored RobDomainJudgment.domainId into { domainId, kind }. Pure. */
export function parseDomainKey(key) {
  const s = String(key == null ? '' : key);
  return isApplicabilityDomainId(s)
    ? { domainId: baseDomainId(s), kind: 'applicability' }
    : { domainId: s, kind: 'rob' };
}

/** True for a namespaced applicability row. Pure. */
export function isApplicabilityKey(key) {
  return isApplicabilityDomainId(String(key == null ? '' : key));
}

/**
 * The applicability-concern levels a domain accepts, or null when the domain has
 * no applicability section. Recognised shapes: an explicit level list on the
 * domain or instrument, `domain.applicability === true` (falls back to the
 * instrument's own applicability levels), or an item of `kind: 'applicability'`
 * inside the domain (115.md decision 4's item kinds). Pure.
 */
export function applicabilityLevelsFor(instrument, domain) {
  if (!domain) return null;
  const explicit = levelValues(domain.applicabilityLevels
    || (domain.applicability && domain.applicability.levels));
  if (explicit.length) return explicit;

  const items = domain.questions || domain.items || [];
  const applicItem = items.find(q => q && q.kind === 'applicability');
  const declared = domain.applicability === true
    || domain.hasApplicability === true
    || !!applicItem;
  if (!declared) return null;

  const fromItem = levelValues(applicItem && (applicItem.responses || applicItem.responseOptions));
  if (fromItem.length) return fromItem;
  const fromInstrument = levelValues(instrument && (instrument.applicabilityLevels
    || (instrument.applicability && instrument.applicability.levels)));
  if (fromInstrument.length) return fromInstrument;
  // Declared but level-less: fall back to the domain judgement vocabulary rather
  // than inventing a scale of our own.
  const fallback = domainJudgmentLevels(instrument, domain);
  return fallback.length ? fallback : null;
}

/** The instrument's domain ids that carry an applicability judgement. Pure. */
export function applicabilityDomainIds(instrument) {
  const domains = (instrument && instrument.domains) || [];
  return domains.filter(d => applicabilityLevelsFor(instrument, d)).map(d => d.id);
}

// ── The OVERALL applicability judgement (PROBAST) ─────────────────────────────
// PROBAST reports TWO overall judgements per model evaluation: overall risk of
// bias and overall concerns regarding applicability (the Step 4 table). RobOverall
// has one judgement column and 115 forbids schema changes, so the second axis
// reuses the SAME namespaced-row convention the per-domain applicability uses: a
// RobDomainJudgment keyed `overall-APP`.
//
// Reading it back is already generic — `parseDomainKey('overall-APP')` yields
// `{ domainId: 'overall', kind: 'applicability' }`, so the project list endpoint
// surfaces it as `row.applicability.overall` and the export as
// `applicability:overall` with no special case. And because it IS an applicability
// key, every reader that filters those out (the overall roll-up input, the κ pairs,
// the traffic-light matrix) already ignores it.
//
// The reserved id 'overall' can only collide with a definition that names a DOMAIN
// 'overall'; none does, and `overallApplicabilityLevels` returns null for every
// instrument whose overall declares no applicability axis, so nothing is written.
export const OVERALL_APPLICABILITY_DOMAIN_ID = 'overall';

/** The storage key for an instrument's OVERALL applicability judgement. Pure. */
export function overallApplicabilityKey() {
  return applicabilityDomainId(OVERALL_APPLICABILITY_DOMAIN_ID);
}

/**
 * The levels an instrument's OVERALL applicability judgement accepts, or null
 * when the instrument declares no such axis (every tool except PROBAST). Pure.
 */
export function overallApplicabilityLevels(instrument) {
  const ov = instrument && instrument.overall;
  const ap = ov && ov.applicability;
  if (!ap) return null;
  const levels = levelValues(ap.levels || ap.values
    || (instrument && (instrument.applicabilityLevels
      || (instrument.applicability && instrument.applicability.levels))));
  return levels.length ? levels : null;
}

/**
 * True when an assessment cannot be considered FULLY JUDGED without an overall
 * value. False when the tool prescribes no overall at all (QUADAS-2), and false
 * when its definition marks the overall as NOT an output of the tool — QUIPS
 * declares `official: false` because Hayden 2013 defines no overall algorithm and
 * any value is the review team's own summary rule, so demanding one to finalise
 * would force a reviewer to invent an unofficial rating. Pure.
 */
export function overallIsRequired(instrument) {
  const levels = overallLevelsFor(instrument);
  if (levels === null || !levels.length) return false;
  const ov = instrument && instrument.overall;
  if (ov && ov.official === false) return false;
  return true;
}

/**
 * True when the instrument's OVERALL rule needs more than the resolved level
 * STRINGS of its domains. Two of the thirteen do, and both say so by declaring a
 * computed overall contract (pinned by tests/unit/robInstrumentRegistry.test.js):
 *
 *   · AMSTAR 2 rolls up the CRITICAL / non-critical flaw COUNTS that each domain
 *     proposal carries — its domains make no judgement of their own, so a map of
 *     judgement strings carries literally nothing for the rule to read;
 *   · PROBAST rolls up the APPLICABILITY axis alongside risk of bias.
 *
 * The other eleven get the same judgement-string map they have always been given,
 * so their proposals stay byte-identical. This mirrors exactly what the workspace
 * already does client-side (RobWorkspace `liveOverall`) — which is why the two
 * used to disagree, and why they now cannot. Pure.
 */
export function overallReadsProposals(instrument) {
  return !!(instrument && instrument.overall && instrument.overall.computed === true);
}

/**
 * The overall judgement value that may be PERSISTED, validated against the
 * instrument's own overall vocabulary (115.md decision 4: "null when the tool has
 * no overall — NEVER invent"). A value the definition does not list is dropped
 * rather than stored, so no export or plot can ever show a level the instrument
 * does not define. Star instruments are exempt: their overall is a star COUNT,
 * validated numerically against maxStars. Pure.
 */
export function overallJudgmentToPersist(instrument, judgment, { star = false } = {}) {
  if (star) return judgment;
  const levels = overallLevelsFor(instrument);
  if (levels === null) return '';            // the tool prescribes no overall at all
  if (!judgment) return judgment;            // '' — nothing claimed, nothing to check
  if (!levels.length) return judgment;       // no declared vocabulary to validate against
  return levels.includes(judgment) ? judgment : '';
}

/** Collapse whitespace so a rationale stays on one CSV row. Pure. */
function flattenText(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

/** The instrument version stamped onto a new row — ALWAYS from the definition. */
function instrumentVersionOf(instrument) {
  return String((instrument && (instrument.instrumentVersion ?? instrument.version)) ?? '');
}
/** The variant stamped onto a new row — ALWAYS from the definition ('' when none). */
function variantOf(instrument) {
  return String((instrument && instrument.variant) ?? '');
}

// ── The EVALUATION TYPE (PROBAST) — a reviewer choice, not a definition constant ─
// PROBAST is completed once per evaluation of a DISTINCT model, and its answer grid
// has two columns: "Dev" (development) and "Val" (validation). Which of the three
// cases an assessment covers is a fact about the STUDY, not about the tool, and it
// is load-bearing for the Step 4 rule: a model developed with NO external
// validation that scores low in every domain must be considered for downgrading to
// high risk of bias. Hard-coding `development-and-validation` (the definition's
// default) made that official caveat unreachable — a development-only model always
// came back a clean "Low".
//
// The 101.md Newcastle–Ottawa precedent is adapted rather than reinvented: the NOS
// discriminates its two forms through the EXISTING `RobAssessment.variant` column,
// so the evaluation type lands in the same column. No schema change, no id change,
// no new instrument. The difference from the NOS is only WHO chooses: the NOS form
// is implied by the instrument id, so its variant stays definition-stamped, while
// PROBAST's is a per-assessment reviewer choice — which is why the definition has
// to declare the closed set of legal values (`evaluationTypes`) and the server
// accepts a client value ONLY from that set.

/** The evaluation-type VALUES a definition declares ([] when it declares none). Pure. */
export function evaluationTypeValues(instrument) {
  return levelValues(instrument && instrument.evaluationTypes);
}

/**
 * The variant to stamp on a new row, given what the client asked for.
 *   { ok:true, variant }        — use this value
 *   { ok:false, error }         — reject by name
 *
 * Two cases, and the difference between them is whether the definition offers the
 * reviewer a CHOICE at all:
 *
 *   · No `evaluationTypes` (twelve of the thirteen tools). The variant is a
 *     property of the definition — RoB 2's 'assignment', the NOS form implied by
 *     the instrument id — so a client-supplied one is meaningless noise and is
 *     DISCARDED, exactly as a client-supplied `instrumentVersion` already is
 *     (115.md build item 1: provenance fields are server-stamped, and the
 *     integration suite pins that a forged pair is ignored rather than honoured).
 *   · `evaluationTypes` declared (PROBAST). Now the variant IS a reviewer choice
 *     and a methodological claim about what was appraised, so it is honoured — and
 *     an undeclared value is REJECTED BY NAME rather than quietly replaced with the
 *     default, because silently turning a reviewer's "development" into
 *     "development and validation" is precisely the mislabelling this rule exists
 *     to prevent (and it would switch off the Step 4 downgrade caveat).
 *
 * `requested` empty/absent → the definition's own variant, exactly as before. Pure.
 */
export function variantToStamp(instrument, requested) {
  const types = evaluationTypeValues(instrument);
  const want = requested == null ? '' : String(requested).trim();
  if (!want || !types.length) return { ok: true, variant: variantOf(instrument) };
  if (!types.includes(want)) {
    return { ok: false, error: `Invalid variant: ${want}. Allowed: ${types.join(', ')}` };
  }
  return { ok: true, variant: want };
}

/**
 * The extra context an instrument's OVERALL rule needs beyond the domain
 * judgements — the PROBAST evaluation type, and nothing else today. Returns
 * undefined for every instrument that declares no `evaluationTypes`, so the other
 * twelve algorithms are called exactly as before. A row whose stored variant is not
 * one of the declared values (legacy or hand-edited) falls back to the definition's
 * own variant rather than silently disabling the caveat. Pure.
 */
export function overallOptionsFor(instrument, variant) {
  const types = evaluationTypeValues(instrument);
  if (!types.length) return undefined;
  const v = String(variant == null ? '' : variant);
  return { evaluationType: types.includes(v) ? v : variantOf(instrument) };
}

// ── NOS persistence boundary (101.md §18/§21) ─────────────────────────────────
// RobAnswer.response is a single String column, shared with RoB 2 / ROBINS-I. The
// NOS needs a SET for exactly one item (the additive Comparability question), so
// that one item is stored as a JSON array string and decoded here — this pair of
// functions is the ONLY place either encoding is applied. The pure engine never
// sees the wire format: nos.js selectedValues() receives a value or an array.

/**
 * Decode a stored RobAnswer.response into the value the engine expects.
 * '["a","b"]' → ['a','b']; 'a' → 'a'. A string that merely LOOKS like JSON but
 * does not parse is returned untouched (never throws, never loses an answer).
 * Pure.
 */
export function decodeAnswerResponse(raw) {
  const s = typeof raw === 'string' ? raw : '';
  if (s.length > 1 && s.charCodeAt(0) === 91 /* '[' */) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
    } catch { /* not JSON after all — fall through to the literal value */ }
  }
  return s;
}

/**
 * Encode validated option values for storage. select:'many' ALWAYS stores a JSON
 * array (even for one value) so the column shape is a function of the instrument,
 * not of what the reviewer happened to tick. Pure.
 */
export function encodeAnswerResponse(question, values) {
  const list = Array.isArray(values) ? values : (values == null || values === '' ? [] : [String(values)]);
  if (question && question.select === 'many') return JSON.stringify(list);
  return list.length ? String(list[0]) : '';
}

/** A domain's items. Definitions name the list `questions`; 115.md's newer shape
 *  calls them `items`. Both are accepted so the server never depends on which. */
export function questionsOf(domain) {
  return (domain && (domain.questions || domain.items)) || [];
}

/** Locate a question (and its domain) in an instrument by question id. Pure. */
export function findInstrumentQuestion(instrument, questionId) {
  for (const d of (instrument && instrument.domains) || []) {
    for (const q of questionsOf(d)) {
      if (q.id === questionId) return { domainId: d.id, domain: d, question: q };
    }
  }
  return null;
}

/**
 * Validate ONE Newcastle–Ottawa answer against its item's own option list.
 *
 * Two rules, both from the official header note (101.md §21):
 *   · every value must be an option this item actually offers — an unknown value
 *     is never stored, because a junk value would silently score 0 stars and look
 *     like a considered "no star" judgement;
 *   · a select:'one' item accepts exactly ONE value. Several Selection/Outcome/
 *     Exposure items legitimately have two STARRED options, but they are mutually
 *     exclusive alternatives capped at one star — accepting both would over-score
 *     the study. Only the additive Comparability item takes a set.
 *
 * @returns {{ok:true,domainId,question,values:string[],encoded:string}|{ok:false,error:string}}
 * Pure.
 */
export function validateStarAnswer(instrument, questionId, raw) {
  const found = findInstrumentQuestion(instrument, questionId);
  if (!found) return { ok: false, error: `Unknown questionId: ${questionId}` };
  const { domainId, question } = found;
  const optionOrder = (question.options || []).map((o) => o.value);
  const allowed = new Set(optionOrder);

  const given = nosSelectedValues(typeof raw === 'string' ? decodeAnswerResponse(raw) : raw);
  const seen = [];
  for (const v of given) { const s = String(v).trim(); if (s && !seen.includes(s)) seen.push(s); }

  if (!seen.length) return { ok: false, error: `A response is required for ${questionId}` };

  const unknown = seen.filter((v) => !allowed.has(v));
  if (unknown.length) {
    return {
      ok: false,
      error: `Invalid option${unknown.length > 1 ? 's' : ''} for ${questionId}: ${unknown.join(', ')}. Allowed: ${optionOrder.join(', ')}`,
    };
  }
  if (question.select !== 'many' && seen.length > 1) {
    return {
      ok: false,
      error: `${questionId} accepts a single option — the Newcastle–Ottawa Scale awards at most one star for this item (received ${seen.length}).`,
    };
  }
  // Canonicalise to the instrument's own option order so ["b","a"] and ["a","b"]
  // are stored identically and compare equal in dual-reviewer disagreement checks.
  const values = optionOrder.filter((v) => seen.includes(v));
  return { ok: true, domainId, question, values, encoded: encodeAnswerResponse(question, values) };
}

/**
 * 101.md §22 — coerce a project's NOS interpretation config to something safe.
 *
 * Default mode is 'none': the Newcastle–Ottawa Scale defines NO threshold, so the
 * honest default is to report the star profile and no verdict. Bands are only kept
 * for 'custom' (AHRQ is a fixed published rule; 'none' has nothing to band) and are
 * clamped to the 0..9 star range so a bad payload can never produce a nonsense band.
 * Pure — this is the trust boundary for the PUT handler.
 */
export function coerceNosThresholds(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mode = NOS_THRESHOLD_MODES.includes(src.mode) ? src.mode : NOS_DEFAULT_THRESHOLD_MODE;
  const label = String(src.label == null ? '' : src.label).slice(0, 120);
  let bands = [];
  if (mode === 'custom') {
    bands = (Array.isArray(src.bands) ? src.bands : [])
      .map((b) => ({
        max: Number(b && b.max),
        level: String((b && b.level) || '').trim().slice(0, 60),
        label: String((b && b.label) || '').trim().slice(0, 60),
      }))
      .filter((b) => Number.isInteger(b.max) && b.max >= 0 && b.max <= NOS_MAX_STARS && b.level)
      .sort((a, b) => a.max - b.max)
      .slice(0, 10);
  }
  return { mode, bands, label };
}

/**
 * The project's NOS threshold config, read from the Project.data blob key
 * `robNosThresholds`. Best-effort: an unreadable project degrades to the honest
 * default ('none') rather than failing an assessment read.
 */
async function loadNosThresholds(projectId) {
  try {
    const row = await prisma.project.findFirst({ where: { id: projectId }, select: { data: true } });
    let blob = {};
    try { blob = JSON.parse((row && row.data) || '{}'); } catch { blob = {}; }
    return coerceNosThresholds(blob.robNosThresholds);
  } catch {
    return coerceNosThresholds(null);
  }
}

// ── Feature flag ──────────────────────────────────────────────────────────────
// Default OFF: enabled ONLY when featureFlags.rob_engine_v2 === true. Missing /
// malformed flags → disabled (the opposite of the "missing = on" defaults used by
// long-standing features, because this one ships dark until the gate passes).
// 75.md Phase 7 — routed through the central seam so a globally-disabled RoB engine
// stays usable by admins (reason 'adminOnly') while non-admins keep the 404. Each
// handler passes `req.user`; no user = plain flag state.
async function robEnabled(user = null) {
  return (await featureAccess('rob_engine_v2', user)).allowed;
}

// P14 — the GUIDED APPRAISAL sub-feature (appraise + validation endpoints). It is
// gated behind its OWN flag `guidedRobAppraisal` AND functionally depends on
// `rob_engine_v2` (there is nothing to appraise without the RoB engine on). Both
// must be true; either off → 404 (existence hidden), exactly like robEnabled().
// The guided→rob_engine_v2 hard dependency now lives in featureAccess's FEATURE_DEPS
// (single source of truth). Pass `req.user` so admins keep guided appraisal usable
// while it is globally OFF; no user = plain flag state.
async function guidedAppraisalEnabled(user = null) {
  return (await featureAccess('guidedRobAppraisal', user)).allowed;
}

/**
 * 101.md §28/§30 — RoB audit action → project-event type. Only entries that are a
 * genuine scientific change appear here; ROB_CREATE (an empty draft assessment) and
 * ROB_EXPORT are deliberately absent, because neither changes what the manuscript
 * can say. `RISK_OF_BIAS_JUDGMENT_CHANGED` declares `rob.judgments`, which the
 * dependency graph maps to Results and Limitations.
 */
const ROB_EVENT_TYPES = Object.freeze({
  ROB_ANSWER: 'RISK_OF_BIAS_JUDGMENT_CHANGED',
  ROB_OVERRIDE: 'RISK_OF_BIAS_JUDGMENT_CHANGED',
  ROB_FINALISE: 'RISK_OF_BIAS_JUDGMENT_CHANGED',
  ROB_DELETE: 'RISK_OF_BIAS_JUDGMENT_CHANGED',
});

// ── Audit (best-effort; never throws into a handler) ──────────────────────────
async function audit(projectId, assessmentId, actor, action, { entityType = null, entityId = null, details = {} } = {}) {
  try {
    await prisma.robAuditLog.create({
      data: {
        projectId,
        assessmentId: assessmentId || '',
        actorId: actor?.id || 'system',
        actorName: actor?.name || actor?.email || '',
        action,
        entityType,
        entityId,
        details: JSON.stringify(details ?? {}).slice(0, 4000),
      },
    });
  } catch { /* audit is best-effort */ }

  // 101.md §28/§29 — a risk-of-bias change must reach the manuscript, and it must
  // do so through the ONE project event ledger rather than a second RoB-specific
  // notification path. This helper is the single funnel every RoB mutation already
  // passes through, so emitting here covers create/answer/override/finalise/delete
  // without instrumenting each handler separately.
  //
  // Materiality is NOT set here: classify.js derives significance, the affected
  // manuscript sections and the recalc flags from the event type's declared
  // dependencyKeys (`rob.judgments` → Results + Limitations). Actions that are not
  // scientific changes — opening, exporting — map to no event at all (§30).
  const eventType = ROB_EVENT_TYPES[action];
  if (eventType) {
    void recordEvent({
      eventType,
      entityType: 'rob_assessment',
      entityId: assessmentId || null,
      relatedStudy: details && details.studyId ? String(details.studyId) : null,
      metadata: {
        action,
        instrumentId: (details && details.instrumentId) || undefined,
        domainId: (details && details.domainId) || undefined,
      },
    }, {
      projectId,
      actorUserId: actor?.id || '',
      actorName: actor?.name || actor?.email || '',
    });
  }

  // prompt50 WS5 — every RoB mutation is meaningful activity on the META·LAB
  // project (projectId IS the META·LAB project id here). Best-effort, never throws.
  if (action !== 'ROB_EXPORT') void touchProjectActivity(projectId);
}

// ── Authorization (prompt41 Task 5) ───────────────────────────────────────────
// RoB access = the META·LAB project OWNER, OR a linked-workspace MEMBER granted the
// `canAssessRiskOfBias` permission. Previously ALL handlers were owner-only, so a
// member who was granted RoB access still got 404. The project store is owner-scoped,
// so for the member path the project is loaded via its (verified) owner id.
// Returns { project, canEdit } or null (→ 404, existence hidden).
async function resolveRobAccess(projectId, userId) {
  const owned = await getOwnedProject(projectId, userId);
  // prompt46 #3 — expose isOwner + role so per-assessment mutation can be scoped to
  // creator/owner/leader (canMutateAssessment). Owner path is always full owner.
  if (owned) return { project: owned, canEdit: true, isOwner: true, role: 'owner' };
  const m = await getRobMemberAccess(projectId, userId);
  if (m) {
    const project = await getOwnedProject(projectId, m.ownerId);
    if (project) return { project, canEdit: m.canEdit, isOwner: false, role: m.role };
  }
  return null;
}

// prompt46 #3 — the access flags a loaded assessment carries, for canMutateAssessment.
function permsFor(a) {
  return { canEdit: a._canEdit, isOwner: a._isOwner, role: a._role };
}

// prompt46 #4 — the merged RoB "study universe": screening/extraction-derived
// studies (project.studies blob, source:'screening', NOT deletable from RoB) +
// RoB-local manual studies (RobManualStudy, source:'manual'). One list keyed by id.
async function loadStudyUniverse(project) {
  // 115.md decision 6 — carry the study DESIGN through, when the source record has
  // one. The normalised universe row has never had a design field (dossier §8),
  // which is exactly why `toolsForStudyDesign` had no consumer; the project-level
  // `studyDesign` is the fallback when a study row does not state its own.
  const projectDesign = detectStudyDesign(project);
  const screening = (Array.isArray(project.studies) ? project.studies : [])
    .filter((s) => s && s.id)
    .map((s) => ({ ...normaliseScreeningStudy(s), design: detectStudyDesign(s) || projectDesign }));
  const manualRows = await prisma.robManualStudy.findMany({
    where: { projectId: project.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  // A RoB-local manual study records no design of its own; it inherits the
  // project's, or stays blank (blank → no recommendation, no warning).
  const manual = manualRows.map((m) => ({ ...normaliseManualStudy(m), design: projectDesign }));
  return [...screening, ...manual];
}

// ── Loaders ───────────────────────────────────────────────────────────────────
// Returns { a, project, canEdit } when the caller may at least VIEW the assessment,
// else null (404). Edit handlers additionally require `canEdit` (else 403).
async function loadAssessment(assessmentId, userId) {
  const a = await prisma.robAssessment.findFirst({
    where: { id: assessmentId, deletedAt: null },
    include: { answers: true, domainJudgments: true, overall: true },
  });
  if (!a) return null;
  const access = await resolveRobAccess(a.projectId, userId);
  if (!access) return null;
  a._canEdit = access.canEdit;   // project-level edit right (read-only members → false)
  a._isOwner = access.isOwner;   // prompt46 #3 — owner/leader bypass the creator check
  a._role = access.role;
  return a;
}

// Resolved judgement = final (when overridden) else proposed.
function resolvedDomain(dj) {
  return (dj.overridden && dj.finalJudgment) ? dj.finalJudgment : (dj.proposedJudgment || null);
}

/**
 * 101.md §21 — resolved STAR count for a domain. Prefers the dedicated Int column
 * and only falls back to parsing the numeral out of the judgement string for rows
 * written before those columns existed (§38 — old projects keep working).
 */
function resolvedDomainStars(dj) {
  const v = (dj.overridden && dj.finalStars != null) ? dj.finalStars : dj.proposedStars;
  if (v != null && Number.isFinite(Number(v))) return Number(v);
  const n = Number(resolvedDomain(dj));
  return Number.isFinite(n) ? n : 0;
}

/** Group flat RobAnswer rows into { [domainId]: { [questionId]: response } }.
 *  Star-scored instruments (NOS) decode the stored wire format first — that is the
 *  ONLY difference; the judgement-instrument path is byte-identical to before. */
function answersByDomainFrom(instrument, answers) {
  const star = isStarInstrument(instrument);
  const out = {};
  for (const d of instrument.domains) out[d.id] = {};
  for (const ans of answers) {
    if (!out[ans.domainId]) out[ans.domainId] = {};
    out[ans.domainId][ans.questionId] = star ? decodeAnswerResponse(ans.response) : ans.response;
  }
  return out;
}

/**
 * Recompute every PROPOSED judgement from the current answers and persist them,
 * PRESERVING any human override (final + overridden). Returns the fresh proposals.
 * `instrument` is the assessment's instrument (RoB2 default).
 *
 * `variant` is the ROW's stored variant, needed only by an instrument whose overall
 * rule reads it (PROBAST's development-only downgrade caveat). Every caller has the
 * row in hand, so it is passed rather than re-queried; omitting it falls back to the
 * definition's own variant, which is what every pre-115 row carries anyway.
 */
async function recomputeAndPersist(assessmentId, instrument = getInstrument('RoB2'), variant) {
  const answers = await prisma.robAnswer.findMany({ where: { assessmentId } });
  const abd = answersByDomainFrom(instrument, answers);
  const proposals = proposeAllDomains(instrument, abd); // { D1:{judgment,reasons}, ... }
  // 101.md §21 — for a star-scored instrument the SAME answers are also scored by
  // nosScoreAssessment, so the Int columns come from the instrument's own scorer
  // rather than from re-parsing a numeral back out of the judgement string.
  const star = isStarInstrument(instrument);
  const score = star ? nosScoreAssessment(instrument, abd) : null;

  // Upsert each domain's proposedJudgment (final/overridden untouched). Star
  // instruments write BOTH representations: the numeral into the existing String
  // column (backward compatibility) and the count into proposedStars.
  for (const d of instrument.domains) {
    const proposed = proposals[d.id].judgment;
    const starCols = star ? { proposedStars: score.byDomain[d.id].stars } : {};
    await prisma.robDomainJudgment.upsert({
      where: { assessmentId_domainId: { assessmentId, domainId: d.id } },
      update: { proposedJudgment: proposed, ...starCols },
      create: { assessmentId, domainId: d.id, proposedJudgment: proposed, ...starCols },
    });
  }

  // Overall is computed from the RESOLVED domain judgements (override-aware).
  const djs = await prisma.robDomainJudgment.findMany({ where: { assessmentId } });
  const resolvedByDomain = {};
  // 115.md — the recorded APPLICABILITY concerns, keyed by BASE domain id. They are
  // a second axis, never a risk-of-bias judgement, so they never enter a risk
  // roll-up; PROBAST's Step 4 applicability rule reads them attached to the domain.
  const applicByDomain = {};
  for (const dj of djs) {
    if (!isApplicabilityKey(dj.domainId)) continue;
    applicByDomain[baseDomainId(dj.domainId)] = dj.finalJudgment || dj.proposedJudgment || '';
  }
  // Star instruments hand the resolved COUNT to judgeOverall ({ stars }) instead of
  // a numeral string, so an overridden domain contributes its overridden stars.
  // 115.md — namespaced APPLICABILITY rows are not risk-of-bias domains and must
  // never reach an overall algorithm (QUADAS-2/PROBAST report the two separately).
  const rich = !star && overallReadsProposals(instrument);
  for (const dj of djs) {
    if (isApplicabilityKey(dj.domainId)) continue;
    if (star) { resolvedByDomain[dj.domainId] = { stars: resolvedDomainStars(dj) }; continue; }
    const value = resolvedDomain(dj);
    if (!rich) { resolvedByDomain[dj.domainId] = value; continue; }
    // AMSTAR 2 / PROBAST: the whole domain PROPOSAL travels (it carries AMSTAR's
    // flaw counts), with the reviewer's own judgement substituted in and the
    // recorded applicability concern attached — the same object the workspace
    // builds client-side, so the persisted overall and the live one cannot differ.
    const p = proposals[dj.domainId] || {};
    const ap = applicByDomain[dj.domainId];
    resolvedByDomain[dj.domainId] = {
      ...p,
      judgment: value || '',
      ...(ap ? { applicability: ap } : {}),
    };
  }
  const overall = proposeOverall(instrument, resolvedByDomain, overallOptionsFor(instrument, variant));
  // multiSomeConcernsFlag is RoB2-specific; ROBINS-I overall returns no such flag →
  // coerce to a real boolean (false) so the non-nullable column is always set.
  const multiFlag = !!overall.multiSomeConcernsFlag;
  const overallStarCols = star
    ? { proposedStars: overall.stars != null ? Number(overall.stars) : null, maxStars: instrument.maxStars }
    : {};
  // 115.md — validated against the DEFINITION's own overall vocabulary before it is
  // written, so AMSTAR 2's confidence rating lands in the same column RoB 2's
  // overall does (its levels ARE the tool's own vocabulary) and nothing else can.
  const proposedOverall = overallJudgmentToPersist(instrument, overall.judgment, { star });
  await prisma.robOverall.upsert({
    where: { assessmentId },
    update: { proposedOverall, multiSomeConcernsFlag: multiFlag, ...overallStarCols },
    create: { assessmentId, proposedOverall, multiSomeConcernsFlag: multiFlag, ...overallStarCols },
  });

  // 115.md — PROBAST's SECOND overall judgement (concerns regarding applicability),
  // stored under the established `overall-APP` convention. `proposedJudgment` only:
  // a reviewer's recorded value lives in finalJudgment/overridden on the same row
  // and is never touched here, exactly as the per-domain rows behave.
  const ovApplicLevels = overallApplicabilityLevels(instrument);
  if (ovApplicLevels) {
    const proposed = (overall.applicability && overall.applicability.judgment) || '';
    const value = ovApplicLevels.includes(proposed) ? proposed : '';
    const domainId = overallApplicabilityKey();
    await prisma.robDomainJudgment.upsert({
      where: { assessmentId_domainId: { assessmentId, domainId } },
      update: { proposedJudgment: value },
      create: { assessmentId, domainId, proposedJudgment: value },
    });
  }

  return { proposals, overall, score };
}

/**
 * Build the full assessment VIEW the API returns (answers + per-domain proposed/
 * final/resolved + reasons trace + overall + completeness + a summary row). Pure
 * read; reasons are recomputed from the engine for display (never stored).
 */
async function buildView(assessmentId) {
  const a = await prisma.robAssessment.findFirst({
    where: { id: assessmentId },
    include: { answers: true, domainJudgments: true, overall: true },
  });
  if (!a) return null;
  const inst = instrumentFor(a);
  const star = isStarInstrument(inst);
  const abd = answersByDomainFrom(inst, a.answers);

  const djByDomain = {};
  for (const dj of a.domainJudgments) djByDomain[dj.domainId] = dj;

  // Every domain's live proposal, kept so the overall roll-up below can read the
  // extra signal a proposal carries (AMSTAR 2's flaw counts) rather than only its
  // judgement string — see `overallReadsProposals`.
  const propByDomain = {};
  const domains = inst.domains.map(d => {
    const dj = djByDomain[d.id] || { proposedJudgment: '', finalJudgment: null, overridden: false, overrideJustification: null };
    const prop = proposeDomain(inst, d.id, abd[d.id] || {});
    propByDomain[d.id] = prop;
    const row = {
      domainId: d.id,
      proposedJudgment: prop.judgment,
      reasons: prop.reasons,
      finalJudgment: dj.finalJudgment || null,
      overridden: !!dj.overridden,
      overrideJustification: dj.overrideJustification || null,
      resolvedJudgment: (dj.overridden && dj.finalJudgment) ? dj.finalJudgment : prop.judgment,
    };
    // 101.md §21/§26 — star instruments surface the count as a NUMBER alongside the
    // numeral string, so no consumer has to parse a judgement vocabulary.
    if (star) {
      row.name = d.name;
      row.maxStars = d.maxStars;
      row.additive = !!d.additive;
      row.proposedStars = prop.stars != null ? Number(prop.stars) : 0;
      row.finalStars = dj.finalStars != null ? Number(dj.finalStars) : null;
      row.resolvedStars = (dj.overridden && row.finalStars != null) ? row.finalStars : row.proposedStars;
    }
    return row;
  });

  // 115.md build item 2 — the applicability half of QUADAS-2 / PROBAST, read from
  // the namespaced RobDomainJudgment rows. Absent on every other instrument, so the
  // view shape is unchanged for RoB 2 / ROBINS-I / NOS.
  const applicability = [];
  for (const d of inst.domains) {
    const levels = applicabilityLevelsFor(inst, d);
    if (!levels) continue;
    const row = djByDomain[applicabilityKey(d.id)] || null;
    applicability.push({
      domainId: d.id,
      name: d.name || '',
      levels,
      judgment: row ? (row.finalJudgment || row.proposedJudgment || null) : null,
      proposedJudgment: row ? (row.proposedJudgment || null) : null,
      rationale: row ? (row.overrideJustification || null) : null,
    });
  }

  // The SAME input `recomputeAndPersist` rolls up, so the view can never report an
  // overall that differs from the one in the RobOverall row (115.md — AMSTAR 2's
  // confidence rule reads the flaw counts its domain proposal carries, PROBAST's
  // Step 4 reads the applicability axis; both are lost by a map of level strings).
  const richOverall = !star && overallReadsProposals(inst);
  const applicByDomain = {};
  for (const row of applicability) if (row.judgment) applicByDomain[row.domainId] = row.judgment;
  const resolvedByDomain = {};
  for (const d of domains) {
    if (star) { resolvedByDomain[d.domainId] = { stars: d.resolvedStars }; continue; }
    if (!richOverall) { resolvedByDomain[d.domainId] = d.resolvedJudgment; continue; }
    const ap = applicByDomain[d.domainId];
    resolvedByDomain[d.domainId] = {
      ...propByDomain[d.domainId],
      judgment: d.resolvedJudgment || '',
      ...(ap ? { applicability: ap } : {}),
    };
  }
  const overallProp = proposeOverall(inst, resolvedByDomain, overallOptionsFor(inst, a.variant));
  const overallProposed = overallJudgmentToPersist(inst, overallProp.judgment, { star });
  const ov = a.overall || {};
  const overall = {
    proposedOverall: overallProposed,
    reasons: overallProp.reasons,
    multiSomeConcernsFlag: overallProp.multiSomeConcernsFlag,
    finalOverall: ov.finalOverall || null,
    overridden: !!ov.overridden,
    overrideJustification: ov.overrideJustification || null,
    resolvedOverall: (ov.overridden && ov.finalOverall) ? ov.finalOverall : overallProposed,
    // 115.md — PROBAST Step 4: a model DEVELOPED without any external validation
    // that is low risk in every domain should be considered for downgrading. The
    // caveat is in `reasons`; this is the machine-readable twin so a panel can
    // surface it without string-matching. Always false for every other tool.
    considerDowngrade: overallProp.considerDowngrade === true,
  };
  // 115.md — PROBAST's SECOND overall judgement. Read from the `overall-APP` row so
  // the renderer, the summary and the CSV all show the value that was STORED, and
  // carried with its computed proposal + reasons trace so the panel can explain it.
  const ovApplicLevels = overallApplicabilityLevels(inst);
  if (ovApplicLevels) {
    const row = djByDomain[overallApplicabilityKey()] || null;
    const proposedApplic = (overallProp.applicability && overallProp.applicability.judgment) || '';
    overall.applicability = {
      levels: ovApplicLevels,
      proposedJudgment: ovApplicLevels.includes(proposedApplic) ? proposedApplic : '',
      judgment: row ? (row.finalJudgment || row.proposedJudgment || '') : '',
      rationale: row ? (row.overrideJustification || null) : null,
      reasons: (overallProp.applicability && overallProp.applicability.reasons) || [],
    };
  }
  if (star) {
    overall.proposedStars = overallProp.stars != null ? Number(overallProp.stars) : 0;
    overall.finalStars = ov.finalStars != null ? Number(ov.finalStars) : null;
    overall.resolvedStars = (ov.overridden && overall.finalStars != null) ? overall.finalStars : overall.proposedStars;
    overall.maxStars = inst.maxStars;
    overall.profile = overallProp.profile || '';
  }

  const comp = engineCompleteness(inst, { answersByDomain: abd });

  // 101.md §21/§22 — the RESOLVED star profile (override-aware) plus, separately,
  // the project's chosen interpretation. `score` is the profile; `interpretation`
  // always carries `official:false` and an attribution, so no UI can render a
  // verdict without saying whose rule produced it. Default mode is 'none' → no
  // verdict at all, because the NOS defines no threshold.
  let score = null;
  let interpretation = null;
  let thresholds = null;
  if (star) {
    const byDomain = {};
    for (const d of domains) {
      byDomain[d.domainId] = { domainId: d.domainId, stars: d.resolvedStars, maxStars: d.maxStars };
    }
    score = {
      instrumentId: inst.id,
      variant: inst.variant,
      byDomain,
      total: overall.resolvedStars,
      maxStars: inst.maxStars,
      complete: comp.overall.complete,
      profile: domains.map(d => `${d.resolvedStars}/${d.maxStars}`).join(' · '),
    };
    thresholds = await loadNosThresholds(a.projectId);
    interpretation = interpretNos(score, thresholds);
  }

  return {
    id: a.id,
    projectId: a.projectId,
    studyId: a.studyId,
    outcomeId: a.outcomeId,
    resultLabel: a.resultLabel,
    instrumentId: a.instrumentId,
    instrumentVersion: a.instrumentVersion,
    instrumentLabel: getRobTool(a.instrumentId)?.label || a.instrumentId || 'Tool unknown', // prompt46 #5 — human tool label (e.g. "RoB 2")
    instrumentName: inst.name,
    variant: a.variant,
    reviewerId: a.reviewerId,
    reviewerName: a.reviewerName,
    status: a.status,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    answersByDomain: abd,
    answerMeta: a.answers.map(x => ({
      domainId: x.domainId, questionId: x.questionId, response: x.response,
      rationale: x.rationale || null, evidenceQuote: x.evidenceQuote || null, evidenceLocator: x.evidenceLocator || null,
      // P14 — guided-appraisal provenance (a machine SUGGESTION, never a decision).
      aiSuggested: x.aiSuggested === true,
      aiConfidence: x.aiConfidence != null ? x.aiConfidence : null,
      aiModel: x.aiModel || null,
      aiModelVersion: x.aiModelVersion || null,
    })),
    domains,
    // 115.md — QUADAS-2 / PROBAST only; [] everywhere else.
    applicability,
    overall,
    completeness: comp,
    // 115.md decision 4/5 — the definition's own overall vocabulary (null when the
    // tool HAS no overall, e.g. QUIPS) and whether ANY numeric score is legitimate
    // (only the NOS is star-additive; a progress count is never a score).
    overallLevels: overallLevelsFor(inst),
    // 115.md — the closed set of evaluation types this tool recognises (PROBAST's
    // Dev / Val / Dev+Val columns); [] for every other instrument, whose `variant`
    // is fixed by the definition. `variant` above says which one this row covers.
    evaluationTypes: inst.evaluationTypes || [],
    scoringAllowed: inst.scoringAllowed != null ? !!inst.scoringAllowed : star,
    // Star-scored instruments only; null for RoB 2 / ROBINS-I (unchanged shape).
    scoring: star ? 'stars' : 'judgment',
    score,
    interpretation,
    nosThresholds: thresholds,
    // 101.md §25 — a reconciled dual-reviewer record identifies itself.
    isConsensus: a.status === CONSENSUS_STATUS,
  };
}

// ── GET /api/rob/instruments/:id  (rob2 | robins-i | nos | nos-cc) ────────────
// Serves the serialisable instrument definition for a data-driven UI. `/rob2`
// keeps working (RoB2 default); `/robins-i` serves the 7-domain, 5-level tool;
// `/nos` and `/nos-cc` serve the two official Newcastle–Ottawa forms (101.md §18).
const INSTRUMENT_URL_IDS = {
  rob2: 'RoB2',
  'robins-i': 'ROBINS-I',
  robinsi: 'ROBINS-I',
  nos: 'NOS',
  'nos-cohort': 'NOS',
  'nos-cc': 'NOS-CC',
  noscc: 'NOS-CC',
  'nos-case-control': 'NOS-CC',
};

/** URL-safe slug for an instrument id ('QUADAS-2' → 'quadas-2'). Pure. */
export function instrumentSlug(id) {
  return String(id || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * 115.md — slug → instrument id, REGISTRY-DRIVEN. The hand-written aliases above
 * stay (they are public URLs), but every registered instrument is also reachable
 * by its own slug, so a newly registered tool needs no route table edit. Pure.
 */
export function instrumentIdForSlug(raw) {
  const slug = String(raw == null ? '' : raw).toLowerCase();
  if (INSTRUMENT_URL_IDS[slug]) return INSTRUMENT_URL_IDS[slug];
  const ids = registeredInstrumentIds();
  return ids.find(id => id.toLowerCase() === slug || instrumentSlug(id) === slug) || null;
}

export async function getRobInstrument(req, res) {
  if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
  const instrumentId = instrumentIdForSlug(req.params.id || 'rob2');
  const instrument = instrumentId ? resolveInstrument(instrumentId) : null;
  if (!instrument) return res.status(404).json({ error: 'Unknown instrument' });
  return res.json({
    instrument,
    // 115.md build item 2 — which domains carry an applicability judgement, so a
    // data-driven renderer never has to know QUADAS-2/PROBAST by name.
    applicabilityDomainIds: applicabilityDomainIds(instrument),
    overallLevels: overallLevelsFor(instrument),
  });
}

/**
 * The catalogue of instruments a reviewer may actually select — 115.md decision 3
 * ("all tools remain selectable") + decision 6 (the Assess selector needs each
 * tool's designs to render the recommendation section). Derived entirely from the
 * registry, so W1-A's nine new definitions appear here with no server change.
 */
export function instrumentCatalogue() {
  return registeredInstrumentIds().map((id) => {
    const inst = resolveInstrument(id);
    const tool = getRobTool(id) || {};
    return {
      id,
      label: tool.label || inst.name || id,
      sublabel: tool.sublabel || '',
      name: inst.name || tool.label || id,
      abbreviation: inst.abbreviation || tool.label || id,
      instrumentVersion: instrumentVersionOf(inst),
      variant: variantOf(inst),
      // 115.md — the evaluation types a reviewer may CHOOSE between when starting
      // this instrument, as `[{ value, label }]` so a selector can render a picker
      // without knowing PROBAST by name. Empty for the twelve tools whose variant
      // is a property of the definition rather than of the study.
      evaluationTypes: inst.evaluationTypes || [],
      organization: inst.organization || '',
      description: tool.description || inst.description || '',
      designs: designsForTool(tool, inst),
      scoring: isScoringInstrument(inst) ? 'stars' : 'judgment',
      scoringAllowed: inst.scoringAllowed != null ? !!inst.scoringAllowed : isScoringInstrument(inst),
      consensusSupported: inst.consensusSupported != null ? !!inst.consensusSupported : true,
      hasApplicability: applicabilityDomainIds(inst).length > 0,
      overallLevels: overallLevelsFor(inst),
      domainCount: (inst.domains || []).length,
      citation: inst.citation || '',
      guidanceUrl: inst.guidanceUrl || '',
      license: inst.license || '',
      slug: instrumentSlug(id),
    };
  });
}

// ── GET /api/rob/instruments ──────────────────────────────────────────────────
export async function listRobInstruments(req, res) {
  if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
  return res.json({ instruments: instrumentCatalogue() });
}

// ── POST /api/rob/assessments ─────────────────────────────────────────────────
export async function createAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const { projectId, studyId, outcomeId, resultLabel, instrumentId, variant } = req.body || {};
    if (!projectId || !studyId) {
      return res.status(400).json({ error: 'projectId and studyId are required' });
    }
    // 115.md decision 3 — REGISTRY-DRIVEN instrument selection. Any instrument the
    // engine has a definition for is creatable; an unknown id is rejected by NAME
    // rather than silently coerced (an unsupported tool must never be stored).
    //
    // The ROBINS-I `guidedRobAppraisal` gate that used to live here is GONE. Which
    // instruments exist is a registry question, not a feature-flag question; the
    // guided-appraisal flag now gates only the guided-appraisal endpoints
    // (/appraise and /rob-validation), which is all it ever meant.
    const wantInstrumentId = instrumentId ? String(instrumentId) : 'RoB2';
    const instrument = resolveInstrument(wantInstrumentId);
    if (!instrument) {
      return res.status(400).json({
        error: `Unknown instrumentId: ${wantInstrumentId}. Available instruments: ${registeredInstrumentIds().join(', ')}`,
      });
    }
    // 115.md — the VARIANT. Version is never client-supplied and neither is the
    // variant, EXCEPT where the definition declares a closed set of evaluation types
    // (PROBAST's Dev / Val / Dev+Val): that choice is a property of the study being
    // appraised, and the overall rule reads it. Restricted to the declared values and
    // rejected by name when it is not one of them — never silently coerced.
    const stamped = variantToStamp(instrument, variant);
    if (!stamped.ok) return res.status(400).json({ error: stamped.error });
    const access = await resolveRobAccess(projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You have read-only access to Risk of Bias for this project.' });
    const project = access.project;
    // prompt46 #4 — validate against the merged study UNIVERSE (screening-derived +
    // RoB-local manual). Empty universe → accept any studyId (preserves the prior
    // behaviour the integration suite relies on for study-less projects).
    const universe = await loadStudyUniverse(project);
    if (universe.length && !universe.some(s => s.id === studyId)) {
      return res.status(404).json({ error: 'Study not found in project' });
    }

    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const a = await prisma.robAssessment.create({
      data: {
        projectId, studyId,
        outcomeId: outcomeId ? String(outcomeId) : null,
        resultLabel: resultLabel ? String(resultLabel).slice(0, 300) : null,
        instrumentId: instrument.id,
        // 115.md build item 1 (the 101.md rule) — version + variant are ALWAYS
        // stamped from the DEFINITION and are never accepted from the client. A
        // client-declared version would let a caller mislabel which edition of a
        // tool a judgement was made with, which is a methodological claim.
        instrumentVersion: instrumentVersionOf(instrument),
        variant: stamped.variant,
        reviewerId: req.user.id,
        reviewerName: me?.name || me?.email || '',
        status: 'draft',
      },
    });
    await recomputeAndPersist(a.id, instrument, stamped.variant); // initialise provisional proposals
    await audit(projectId, a.id, { ...req.user, name: me?.name }, 'ROB_CREATE', {
      entityType: 'RobAssessment', entityId: a.id,
      details: {
        studyId, outcomeId: outcomeId || null, instrumentId: instrument.id,
        instrumentVersion: instrumentVersionOf(instrument), variant: stamped.variant,
      },
    });
    const view = await buildView(a.id);
    return res.status(201).json({ assessment: view });
  } catch (err) {
    console.error('[rob] createAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/assessments/:id ──────────────────────────────────────────────
export async function getAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    // prompt46 #3 — surface per-assessment mutate permission so the UI disables
    // edit/delete for non-creators (the server still enforces it on every write).
    const view = await buildView(a.id);
    view.canMutate = canMutateAssessment(a, permsFor(a), req.user.id);
    return res.json({ assessment: view, instrument: instrumentFor(a) });
  } catch (err) {
    console.error('[rob] getAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/projects/:projectId/assessments ──────────────────────────────
export async function listProjectAssessments(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    const project = access.project;

    const rows = await prisma.robAssessment.findMany({
      where: { projectId: req.params.projectId, deletedAt: null },
      include: { domainJudgments: true, overall: true },
      orderBy: { createdAt: 'asc' },
    });
    // prompt46 #4 — resolve labels/source against the merged study universe so
    // manual studies get correct labels and a source badge.
    const universe = await loadStudyUniverse(project);
    const studiesById = {};
    for (const s of universe) studiesById[s.id] = s;

    const assessments = rows.map(a => {
      const dj = {};
      const applic = {};
      for (const d of a.domainJudgments) {
        // 115.md — namespaced applicability rows are surfaced SEPARATELY; they are
        // not risk-of-bias domains and must never enter the traffic-light matrix.
        const parsed = parseDomainKey(d.domainId);
        if (parsed.kind === 'applicability') applic[parsed.domainId] = d.finalJudgment || d.proposedJudgment || null;
        else dj[d.domainId] = resolvedDomain(d);
      }
      const ov = a.overall;
      const overall = ov ? ((ov.overridden && ov.finalOverall) ? ov.finalOverall : ov.proposedOverall) : null;
      const st = studiesById[a.studyId];
      const label = a.resultLabel
        ? `${st ? `${st.author || ''} ${st.year || ''}`.trim() || a.studyId : a.studyId} — ${a.resultLabel}`
        : (st ? `${st.author || ''} ${st.year || ''}`.trim() || a.studyId : a.studyId);
      const row = {
        id: a.id, studyId: a.studyId, resultLabel: a.resultLabel, status: a.status, label, domainJudgments: dj, overall,
        // 115.md — QUADAS-2 / PROBAST applicability concerns, keyed by domain id.
        applicability: applic,
        // prompt46 #3/#5 — creator + tool surfaced to the list UI.
        reviewerId: a.reviewerId, reviewerName: a.reviewerName,
        instrumentId: a.instrumentId,
        // 115.md decision 8/§39 — the tool-change surface needs the exact edition
        // and the row's age to say "an existing ROBINS-I draft exists".
        instrumentVersion: a.instrumentVersion || '',
        variant: a.variant || '',
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        instrumentLabel: getRobTool(a.instrumentId)?.label || a.instrumentId || 'Tool unknown',
        // prompt46 #4 — study source ('manual' studies are visually distinct).
        source: st ? st.source : 'screening',
        // prompt46 #3 — per-row mutate permission for disabling edit/delete in the UI.
        canMutate: canMutateAssessment(a, { canEdit: access.canEdit, isOwner: access.isOwner, role: access.role }, req.user.id),
        // 101.md §25 — the reconciled dual-reviewer record is visually distinct.
        isConsensus: a.status === CONSENSUS_STATUS,
      };
      // 101.md §26 — a star-scored row carries its PROFILE, not a traffic light.
      if (isStarScoredTool(a.instrumentId)) {
        const starsByDomain = {};
        for (const d of a.domainJudgments) starsByDomain[d.domainId] = resolvedDomainStars(d);
        const inst = getInstrument(a.instrumentId);
        row.scoring = 'stars';
        row.starsByDomain = starsByDomain;
        row.maxStarsByDomain = Object.fromEntries(inst.domains.map(d => [d.id, d.maxStars]));
        row.stars = ov && ov.overridden && ov.finalStars != null
          ? Number(ov.finalStars)
          : inst.domains.reduce((sum, d) => sum + (starsByDomain[d.id] || 0), 0);
        row.maxStars = (ov && ov.maxStars != null) ? Number(ov.maxStars) : inst.maxStars;
        row.profile = inst.domains.map(d => `${starsByDomain[d.id] || 0}/${d.maxStars}`).join(' · ');
      }
      return row;
    });

    // The traffic-light matrix is per-instrument (RoB2 has 5 domains, ROBINS-I 7).
    // A single project SHOULD use one instrument; if assessments mix instruments the
    // legacy top-level `matrix` falls back to RoB2's shape rather than dropping or
    // misaligning domains — kept byte-compatible for existing readers.
    const distinctInstruments = [...new Set(rows.map(r => r.instrumentId || 'RoB2'))];
    const matrixInstrument = resolveInstrument(
      distinctInstruments.length === 1 ? distinctInstruments[0] : 'RoB2',
    ) || getInstrument('RoB2');
    const matrix = summaryMatrix(
      assessments.map(a => ({ id: a.id, label: a.label, domainJudgments: a.domainJudgments, overall: a.overall })),
      matrixInstrument,
    );

    // 115.md decision 7 — mixed-tool projects GROUP BY instrument; there is never a
    // cross-tool aggregate. Each group carries its own matrix (built from its own
    // definition's domains), so a project running QUADAS-2 alongside RoB 2 renders
    // two correct plots instead of one wrong one.
    const groups = distinctInstruments
      .map((instrumentId) => {
        const inst = resolveInstrument(instrumentId);
        const groupRows = assessments.filter(a => (a.instrumentId || 'RoB2') === instrumentId);
        return {
          instrumentId,
          instrumentLabel: getRobTool(instrumentId)?.label || (inst && inst.name) || instrumentId,
          instrumentVersion: inst ? instrumentVersionOf(inst) : '',
          scoring: inst && isScoringInstrument(inst) ? 'stars' : 'judgment',
          applicabilityDomainIds: inst ? applicabilityDomainIds(inst) : [],
          count: groupRows.length,
          studyIds: [...new Set(groupRows.map(r => r.studyId))],
          assessmentIds: groupRows.map(r => r.id),
          // A matrix is offered ONLY where the instrument actually rates its
          // domains (115.md decision 11). Null for: a star profile (the NOS — a
          // traffic light is not what stars mean), a checklist with no per-domain
          // rating (the JBI tools), and an instrument the registry no longer knows
          // (rather than a misaligned plot).
          matrix: inst && !isScoringInstrument(inst) && domainJudgmentLevels(inst, null).length
            ? summaryMatrix(
              groupRows.map(a => ({ id: a.id, label: a.label, domainJudgments: a.domainJudgments, overall: a.overall })),
              inst,
            )
            : null,
          // What the group's judgements MEAN, so a renderer never has to know a
          // tool by name to decide whether a traffic light is honest.
          domainJudgmentLevels: inst ? domainJudgmentLevels(inst, null) : [],
          overallLevels: inst ? overallLevelsFor(inst) : [],
        };
      })
      .sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));

    return res.json({ assessments, matrix, groups, instrumentIds: distinctInstruments });
  } catch (err) {
    console.error('[rob] listProjectAssessments error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PUT /api/rob/assessments/:id/answers ──────────────────────────────────────
// Body: { answers: [{ domainId?, questionId, response, rationale?, evidenceQuote?, evidenceLocator? }] }
export async function upsertAnswers(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    if (a.status === 'complete') return res.status(409).json({ error: 'Assessment is finalised; re-open to edit' });

    const list = Array.isArray(req.body?.answers) ? req.body.answers : null;
    if (!list || list.length === 0) return res.status(400).json({ error: 'answers[] is required' });

    const instrument = instrumentFor(a);
    const star = isStarInstrument(instrument);
    const questionDomain = questionDomainMap(instrument);

    // 101.md §18 — validate the WHOLE batch before writing any of it, so a bad item
    // can never leave half a batch persisted. Star instruments validate against the
    // item's OWN option list with the select:'one' arity enforced; every other
    // instrument validates against the vocabulary its DEFINITION declares for that
    // item (115.md build item 2), which is the shared Y/PY/PN/N/NI/NA set when the
    // definition declares nothing — so RoB 2 / ROBINS-I behave exactly as before.
    // An off-form value is NEVER stored.
    const prepared = [];
    for (const item of list) {
      const questionId = String(item.questionId || '');
      const domainId = questionDomain[questionId];
      if (!domainId) return res.status(400).json({ error: `Unknown questionId: ${questionId}` });
      let response;
      if (star) {
        const v = validateStarAnswer(instrument, questionId, item.response);
        if (!v.ok) return res.status(400).json({ error: v.error });
        response = v.encoded;
      } else {
        response = String(item.response || '');
        const found = findInstrumentQuestion(instrument, questionId);
        // 115.md — `answerable: false` marks a prompt the instrument never asks a
        // reviewer to ANSWER (a QUADAS-2 / PROBAST applicability prompt: it is a
        // CONCERN on the applicability axis, recorded through the applicability
        // judgement below). Storing a Y/N against it would fabricate an answer the
        // tool does not have.
        if (found && found.question && found.question.answerable === false) {
          return res.status(400).json({
            error: `${questionId} is not an answerable item — it is recorded as an applicability concern, not as a response.`,
          });
        }
        const allowed = allowedResponsesFor(instrument, found && found.domain, found && found.question);
        if (!allowed.has(response)) {
          return res.status(400).json({
            error: `Invalid response for ${questionId}: ${response}. Allowed: ${[...allowed].join(', ')}`,
          });
        }
      }
      prepared.push({ questionId, domainId, response, item });
    }

    for (const { questionId, domainId, response, item } of prepared) {
      await prisma.robAnswer.upsert({
        where: { assessmentId_questionId: { assessmentId: a.id, questionId } },
        update: {
          domainId, response,
          rationale: item.rationale != null ? String(item.rationale).slice(0, 4000) : undefined,
          evidenceQuote: item.evidenceQuote != null ? String(item.evidenceQuote).slice(0, 4000) : undefined,
          evidenceLocator: item.evidenceLocator != null ? String(item.evidenceLocator).slice(0, 500) : undefined,
          // A human answering/editing this question clears any machine-suggestion
          // provenance (P14): the row is now a HUMAN answer, not a suggestion.
          aiSuggested: false, aiConfidence: null, aiModel: null, aiModelVersion: null,
        },
        create: {
          assessmentId: a.id, domainId, questionId, response,
          rationale: item.rationale != null ? String(item.rationale).slice(0, 4000) : null,
          evidenceQuote: item.evidenceQuote != null ? String(item.evidenceQuote).slice(0, 4000) : null,
          evidenceLocator: item.evidenceLocator != null ? String(item.evidenceLocator).slice(0, 500) : null,
          aiSuggested: false,
        },
      });
    }
    await recomputeAndPersist(a.id, instrument, a.variant);
    await prisma.robAssessment.update({ where: { id: a.id }, data: { updatedAt: new Date() } });
    await audit(a.projectId, a.id, req.user, 'ROB_ANSWER', { entityType: 'RobAnswer', entityId: a.id, details: { count: list.length } });
    return res.json({ assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] upsertAnswers error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/rob/assessments/:id/override ────────────────────────────────────
// Body: { target: 'domain'|'overall', domainId?, finalJudgment, justification }
// finalJudgment empty/null + clear:true → clears the override.
export async function overrideJudgment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    // A finalised assessment is locked — overriding must go through reopen first
    // (mirrors upsertAnswers; without this the finalise lock is defeated).
    if (a.status === 'complete') return res.status(409).json({ error: 'Assessment is finalised; re-open to edit' });

    const instrument = instrumentFor(a);
    const star = isStarInstrument(instrument);
    const { target, domainId, finalJudgment, justification, clear } = req.body || {};
    const wantClear = clear === true || finalJudgment == null || finalJudgment === '';

    // ── 115.md build item 2 — target 'applicability' ──────────────────────────
    // QUADAS-2 / PROBAST judge applicability per domain ALONGSIDE risk of bias. It
    // is a primary human judgement (no algorithm proposes it), so unlike an
    // override it needs no justification — but it reuses this endpoint's
    // permission / finalise-lock / audit plumbing and lands in the namespaced
    // RobDomainJudgment row (see APPLICABILITY_SUFFIX).
    if (target === 'applicability') {
      const domain = (instrument.domains || []).find(d => d.id === domainId);
      if (!domain) return res.status(400).json({ error: `Unknown domainId: ${domainId}` });
      const levels = applicabilityLevelsFor(instrument, domain);
      if (!levels) {
        return res.status(400).json({
          error: `${instrument.name || instrument.id} does not assess applicability for domain ${domainId}.`,
        });
      }
      if (!wantClear && !levels.includes(finalJudgment)) {
        return res.status(400).json({ error: `applicability judgment must be one of: ${levels.join(', ')}` });
      }
      const key = applicabilityKey(domainId);
      const note = typeof justification === 'string' ? justification.trim().slice(0, 4000) : '';
      await prisma.robDomainJudgment.upsert({
        where: { assessmentId_domainId: { assessmentId: a.id, domainId: key } },
        update: wantClear
          ? { overridden: false, finalJudgment: null, overrideJustification: null }
          : { overridden: true, finalJudgment, overrideJustification: note || null },
        create: wantClear
          ? { assessmentId: a.id, domainId: key, proposedJudgment: '' }
          : { assessmentId: a.id, domainId: key, proposedJudgment: '', overridden: true, finalJudgment, overrideJustification: note || null },
      });
      // 115.md — an instrument with an OVERALL applicability axis (PROBAST) rolls
      // its per-domain concerns up into a second overall judgement, so recording one
      // changes it. Recomputing here keeps the stored `overall-APP` row in step with
      // the domains, exactly as the domain/overall override path does. Instruments
      // with no such axis (QUADAS-2) skip it: nothing they store could change.
      if (overallApplicabilityLevels(instrument)) await recomputeAndPersist(a.id, instrument, a.variant);
      await prisma.robAssessment.update({ where: { id: a.id }, data: { updatedAt: new Date() } });
      await audit(a.projectId, a.id, req.user, 'ROB_OVERRIDE', {
        entityType: 'RobDomainJudgment', entityId: a.id,
        details: {
          target: 'applicability', domainId, instrumentId: instrument.id,
          finalJudgment: wantClear ? null : finalJudgment, cleared: wantClear,
        },
      });
      return res.json({ assessment: await buildView(a.id) });
    }

    // Domain / overall judgement vocabularies come from the DEFINITION (115.md
    // decision 4). Overall may declare a vocabulary of its own — JBI's overall is
    // an appraisal DECISION (include / exclude / seek further info), not a
    // risk-of-bias level — or declare that the tool has no overall at all (QUIPS),
    // in which case there is nothing to override.
    const overallLevels = overallLevelsFor(instrument);
    const validJ = new Set(
      target === 'overall'
        ? (overallLevels || [])
        : domainJudgmentLevels(instrument, (instrument.domains || []).find(d => d.id === domainId)),
    );
    if (target === 'overall' && overallLevels === null) {
      return res.status(400).json({
        error: `${instrument.name || instrument.id} reports domain-level judgements only and defines no overall judgement.`,
      });
    }
    // A tool whose domains carry no judgement vocabulary at all (the JBI
    // checklists: item answers + one overall appraisal DECISION, no per-domain
    // rating) must say so, rather than reject with an empty allowed-values list.
    // Star instruments are exempt: their "judgement" is a star COUNT validated
    // numerically against the domain maximum below, not a level from a list.
    if (!wantClear && !star && target === 'domain' && validJ.size === 0) {
      return res.status(400).json({
        error: `${instrument.name || instrument.id} does not rate its domains — record the item responses and the overall appraisal decision instead.`,
      });
    }

    // 101.md §21 — on a star-scored instrument an "override" is a reviewer setting
    // the STAR COUNT for a domain (or the total), not picking a judgement level, so
    // it is validated as a whole number within that domain's official maximum. Both
    // representations are then written: the numeral into the existing String column
    // and the Int into finalStars.
    let starValue = null;
    if (!wantClear) {
      if (star) {
        let max = instrument.maxStars;
        if (target === 'domain') {
          const d = instrument.domains.find(x => x.id === domainId);
          if (!d) return res.status(400).json({ error: `Unknown domainId: ${domainId}` });
          max = d.maxStars;
        }
        const n = Number(finalJudgment);
        if (!Number.isInteger(n) || n < 0 || n > max) {
          return res.status(400).json({ error: `finalJudgment must be a whole number of stars between 0 and ${max}` });
        }
        starValue = n;
      } else if (!validJ.has(finalJudgment)) {
        return res.status(400).json({ error: `finalJudgment must be one of: ${[...validJ].join(', ')}` });
      }
      if (typeof justification !== 'string' || !justification.trim()) {
        return res.status(400).json({ error: 'A justification is required to override the algorithm' });
      }
    }
    // The value written into the legacy judgement String column.
    const finalValue = star && !wantClear ? String(starValue) : finalJudgment;

    if (target === 'domain') {
      if (!domainId || !instrument.domains.some(d => d.id === domainId)) {
        return res.status(400).json({ error: `Unknown domainId: ${domainId}` });
      }
      const seed = proposeDomain(instrument, domainId, {});
      const seedStars = star ? { proposedStars: seed.stars != null ? Number(seed.stars) : 0 } : {};
      const starCols = star ? { finalStars: wantClear ? null : starValue } : {};
      await prisma.robDomainJudgment.upsert({
        where: { assessmentId_domainId: { assessmentId: a.id, domainId } },
        update: wantClear
          ? { overridden: false, finalJudgment: null, overrideJustification: null, ...starCols }
          : { overridden: true, finalJudgment: finalValue, overrideJustification: justification.trim().slice(0, 4000), ...starCols },
        create: wantClear
          ? { assessmentId: a.id, domainId, proposedJudgment: seed.judgment, ...seedStars }
          : { assessmentId: a.id, domainId, proposedJudgment: seed.judgment, ...seedStars, overridden: true, finalJudgment: finalValue, overrideJustification: justification.trim().slice(0, 4000), ...starCols },
      });
    } else if (target === 'overall') {
      const starCols = star ? { finalStars: wantClear ? null : starValue, maxStars: instrument.maxStars } : {};
      await prisma.robOverall.upsert({
        where: { assessmentId: a.id },
        update: wantClear
          ? { overridden: false, finalOverall: null, overrideJustification: null, ...starCols }
          : { overridden: true, finalOverall: finalValue, overrideJustification: justification.trim().slice(0, 4000), ...starCols },
        create: wantClear
          ? { assessmentId: a.id, ...starCols }
          : { assessmentId: a.id, overridden: true, finalOverall: finalValue, overrideJustification: justification.trim().slice(0, 4000), ...starCols },
      });
    } else {
      return res.status(400).json({ error: "target must be 'domain' or 'overall'" });
    }

    await recomputeAndPersist(a.id, instrument, a.variant); // overall reflects override-aware resolved domains
    await audit(a.projectId, a.id, req.user, 'ROB_OVERRIDE', {
      entityType: target === 'domain' ? 'RobDomainJudgment' : 'RobOverall',
      entityId: a.id,
      details: {
        target, domainId: domainId || null,
        finalJudgment: wantClear ? null : finalValue,
        ...(star ? { finalStars: wantClear ? null : starValue } : {}),
        cleared: wantClear,
      },
    });
    return res.json({ assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] overrideJudgment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/rob/assessments/:id/finalise ────────────────────────────────────
export async function finaliseAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });

    const instrument = instrumentFor(a);
    const star = isStarInstrument(instrument);
    const view = await buildView(a.id);
    if (!view.completeness.overall.complete) {
      return res.status(400).json({ error: 'Assessment is incomplete', completeness: view.completeness });
    }
    // 115.md — COMPLETENESS IS NOT THE FINALISE PREDICATE. `engineCompleteness`
    // counts answered ITEMS and nothing else, which was the whole predicate on the
    // four pre-115 instruments because their domain and overall judgements are
    // ALGORITHM-PROPOSED: answer every signalling question and every judgement
    // exists. That stopped being true the moment tools arrived whose judgements are
    // the reviewer's own — QUADAS-2 and QUIPS rate each domain by hand, PROBAST and
    // QUADAS-2 record an applicability concern per domain, the JBI checklists end in
    // an appraisal DECISION. On those, answering the items alone let an assessment
    // be marked 'complete' with no judgement recorded anywhere, and 'complete' is
    // exactly what the dual-reviewer blind reads to decide the comparison may be
    // revealed. So the FULL definition predicate is enforced here, server-side.
    if (!star) {
      const missing = [];
      for (const d of (instrument.domains || [])) {
        if (!domainJudgmentLevels(instrument, d).length) continue;   // tool rates no domains
        const row = view.domains.find(x => x.domainId === d.id);
        if (!row || !row.resolvedJudgment) missing.push(`${d.shortLabel || d.name || d.id}: risk-of-bias judgement`);
      }
      for (const ap of (view.applicability || [])) {
        if (!ap.judgment) missing.push(`${ap.name || ap.domainId}: concern regarding applicability`);
      }
      if (overallIsRequired(instrument) && !view.overall.resolvedOverall) {
        missing.push('Overall: the tool\'s overall judgement');
      }
      if (overallApplicabilityLevels(instrument)
        && !(view.overall.applicability && view.overall.applicability.judgment)) {
        missing.push('Overall: concerns regarding applicability');
      }
      if (missing.length) {
        return res.status(400).json({
          error: `${instrument.name || instrument.id} is not fully judged yet — record ${missing.length === 1 ? 'the missing judgement' : `all ${missing.length} missing judgements`} before finalising: ${missing.join('; ')}.`,
          missingJudgments: missing,
          completeness: view.completeness,
        });
      }
    }
    // Lock in final = resolved for every domain + overall.
    for (const d of view.domains) {
      await prisma.robDomainJudgment.update({
        where: { assessmentId_domainId: { assessmentId: a.id, domainId: d.domainId } },
        data: { finalJudgment: d.resolvedJudgment, ...(star ? { finalStars: d.resolvedStars } : {}) },
      });
    }
    await prisma.robOverall.update({
      where: { assessmentId: a.id },
      data: {
        finalOverall: view.overall.resolvedOverall,
        ...(star ? { finalStars: view.overall.resolvedStars, maxStars: instrument.maxStars } : {}),
      },
    });
    // 101.md §25 — 'consensus' is the row's IDENTITY, not a workflow stage, so a
    // reconciled record stays findable after it is finalised. Everything else goes
    // to 'complete' exactly as before.
    const nextStatus = a.status === CONSENSUS_STATUS ? CONSENSUS_STATUS : 'complete';
    await prisma.robAssessment.update({ where: { id: a.id }, data: { status: nextStatus } });
    await audit(a.projectId, a.id, req.user, 'ROB_FINALISE', {
      entityType: 'RobAssessment', entityId: a.id,
      details: {
        overall: view.overall.resolvedOverall,
        ...(star ? { totalStars: view.overall.resolvedStars, maxStars: instrument.maxStars, profile: view.score && view.score.profile } : {}),
        consensus: nextStatus === CONSENSUS_STATUS,
      },
    });
    return res.json({ assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] finaliseAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/rob/assessments/:id/reopen ──────────────────────────────────────
export async function reopenAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    // Returning to draft must release the finalise-locked finals on NON-overridden
    // rows (genuine overrides are preserved) so the stored state matches "draft".
    // finalStars rides along: it is the star twin of finalJudgment (null on every
    // judgement-instrument row, so clearing it there is a no-op).
    await prisma.robDomainJudgment.updateMany({ where: { assessmentId: a.id, overridden: false }, data: { finalJudgment: null, finalStars: null } });
    await prisma.robOverall.updateMany({ where: { assessmentId: a.id, overridden: false }, data: { finalOverall: null, finalStars: null } });
    // 101.md §25 — reopening a consensus record does NOT strip its identity; it just
    // becomes editable again. Only ordinary assessments return to 'draft'.
    const nextStatus = a.status === CONSENSUS_STATUS ? CONSENSUS_STATUS : 'draft';
    await prisma.robAssessment.update({ where: { id: a.id }, data: { status: nextStatus } });
    await audit(a.projectId, a.id, req.user, 'ROB_REOPEN', { entityType: 'RobAssessment', entityId: a.id, details: { consensus: nextStatus === CONSENSUS_STATUS } });
    return res.json({ assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] reopenAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/rob/assessments/:id (soft delete) ─────────────────────────────
export async function deleteAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    await prisma.robAssessment.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    await audit(a.projectId, a.id, req.user, 'ROB_DELETE', { entityType: 'RobAssessment', entityId: a.id });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[rob] deleteAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── The robvis label sets ─────────────────────────────────────────────────────
// robvis "data" CSVs carry the judgement LABELS its templates recognise, per tool.
// The two here are the two the exporter has ever had, and they are byte-identical
// to the inline table they replace.
//
// THIS TABLE IS A WHITELIST, NOT A LOOKUP WITH A DEFAULT. It used to fall back to
// the RoB 2 labels for anything unknown, which since 115 means the nine added
// tools — and the fallback did not merely mislabel, it INVERTED meaning: AMSTAR 2's
// overall is a CONFIDENCE rating whose best level is literally 'high', so a review
// rated High confidence exported as "High risk of bias". A JBI appraisal decision
// ('include') and a QUIPS 'moderate' simply fell through `labelSet[j] || 'No
// information'` and every cell came out "No information". Both outcomes are
// fabricated data in a figure a reader treats as the review's result.
//
// Adding a tool here is the extension point, and it means asserting that robvis has
// a template whose categories match that tool's own scale. Until that is verified
// against robvis itself the export REFUSES, exactly as it already refuses for the
// Newcastle–Ottawa star profile — a CSV/JSON export of the same assessment is
// always available and loses nothing.
const ROBVIS_LABELS = Object.freeze({
  RoB2: Object.freeze({ low: 'Low', some: 'Some concerns', high: 'High' }),
  'ROBINS-I': Object.freeze({ low: 'Low', moderate: 'Moderate', serious: 'Serious', critical: 'Critical', ni: 'No information' }),
});

/** The robvis label set for an instrument, or null when robvis cannot render it. Pure. */
export function robvisLabelsFor(instrumentId) {
  return ROBVIS_LABELS[instrumentId] || null;
}

// ── GET /api/rob/assessments/:id/export?format=csv|json|robvis ────────────────
export async function exportAssessment(req, res) {
  let reservation; // declared here so a post-reservation error can refund it (79.md §3)
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const inst = instrumentFor(a);
    const view = await buildView(a.id);
    const format = String(req.query.format || 'json').toLowerCase();
    if (!['json', 'csv', 'robvis'].includes(format)) {
      return res.status(400).json({ error: "format must be 'json', 'csv', or 'robvis'" });
    }
    // 101.md §26 — robvis renders Cochrane traffic-light DOMAIN JUDGEMENTS. A NOS
    // star profile is not that, and coercing "3 stars" into a Low/High colour would
    // misrepresent the instrument. Refused before the export allowance is reserved.
    if (isStarInstrument(inst) && format === 'robvis') {
      return res.status(400).json({
        error: 'The robvis traffic-light export does not apply to the Newcastle–Ottawa Scale, which reports a star profile rather than risk-of-bias judgements. Export as CSV or JSON instead.',
      });
    }
    // 115.md — the same refusal for every other instrument robvis has no label set
    // for (see ROBVIS_LABELS). Refused BEFORE the export allowance is reserved.
    if (format === 'robvis' && !robvisLabelsFor(inst.id)) {
      return res.status(400).json({
        error: `The robvis traffic-light export is not available for ${inst.name || inst.id}: robvis renders Cochrane risk-of-bias judgements, and this tool's judgements are on a different scale (${(overallLevelsFor(inst) || []).join(' / ') || 'its own per-domain vocabulary'}). Exporting them under risk-of-bias labels would misstate the appraisal. Export as CSV or JSON instead.`,
        robvisInstrumentIds: Object.keys(ROBVIS_LABELS),
      });
    }
    // 79.md §3 — RoB assessment export is a project export: Free tier is blocked and
    // permitted tiers consume one unit of the monthly allowance. Reserved once here,
    // after the format is known to be valid, and confirmed on the successful return.
    try {
      reservation = await requireProjectExport(req.user, {
        exportType: EXPORT_TYPES.ROB_ASSESSMENT, projectId: a.projectId || null, format,
      });
    } catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    // The four legacy prefixes are pinned by name so existing filenames stay
    // byte-identical; every other instrument takes its own registry slug. The old
    // `|| 'robins-i'` default meant an AMSTAR 2 export downloaded as
    // `robins-i_<studyId>.csv` — a file that names the wrong instrument, which is a
    // provenance error the moment it lands in a shared folder.
    const FILE_PREFIXES = { RoB2: 'rob2', 'ROBINS-I': 'robins-i', NOS: 'nos-cohort', 'NOS-CC': 'nos-case-control' };
    const filePrefix = FILE_PREFIXES[inst.id] || instrumentSlug(inst.id) || 'rob';
    const base = `${filePrefix}_${a.studyId}${a.resultLabel ? '_' + a.resultLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : ''}`;

    if (format === 'json') {
      settleProjectExport(reservation.reservationId, { status: 'succeeded' });
      return res.json({ format, filename: `${base}.json`, mime: 'application/json', content: view });
    }
    if (format === 'csv') {
      // 101.md §26 — a star-scored instrument gets its OWN item-level CSV: the chosen
      // option value(s), the option TEXT as printed on the official form, the stars
      // that item earned, and the domain total. The judgement-instrument CSV below is
      // untouched (byte-identical to before).
      const rows = isStarInstrument(inst)
        ? [['domain', 'questionId', 'question', 'selected', 'selectedText', 'stars', 'rationale', 'evidenceQuote', 'evidenceLocator', 'domainStars', 'domainMaxStars']]
        : [['domain', 'questionId', 'response', 'rationale', 'proposed', 'final']];
      for (const d of view.domains) {
        const ans = view.answersByDomain[d.domainId] || {};
        const meta = view.answerMeta.filter(m => m.domainId === d.domainId);
        const defn = inst.domains.find(x => x.id === d.domainId);
        for (const q of questionsOf(defn)) {
          const qid = q.id;
          const m = meta.find(x => x.questionId === qid);
          if (isStarInstrument(inst)) {
            const chosen = nosSelectedValues(ans[qid]);
            const texts = chosen.map(v => (q.options.find(o => o.value === v) || {}).text || v);
            const starred = new Set((q.options || []).filter(o => o.star).map(o => o.value));
            const hits = chosen.filter(v => starred.has(v)).length;
            rows.push([
              d.domainId, qid, q.text, chosen.join('; '), texts.join('; '),
              q.select === 'many' ? hits : (hits > 0 ? 1 : 0),
              (m?.rationale || '').replace(/\s+/g, ' '),
              (m?.evidenceQuote || '').replace(/\s+/g, ' '),
              m?.evidenceLocator || '',
              d.resolvedStars, d.maxStars,
            ]);
          } else {
            rows.push([d.domainId, qid, ans[qid] || '', (m?.rationale || '').replace(/\s+/g, ' '), d.proposedJudgment, d.resolvedJudgment]);
          }
        }
      }
      // 115.md — QUADAS-2 / PROBAST also carry a per-domain APPLICABILITY concern.
      // Appended as explicit rows so the single-assessment CSV never drops half the
      // instrument. Empty for every other tool → those files are unchanged.
      for (const ap of (view.applicability || [])) {
        rows.push(isStarInstrument(inst)
          ? [ap.domainId, 'applicability', ap.name || '', ap.judgment || '', '', '', flattenText(ap.rationale), '', '', '', '']
          : [ap.domainId, 'applicability', ap.judgment || '', flattenText(ap.rationale), '', ap.judgment || '']);
      }
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      settleProjectExport(reservation.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(csv) });
      return res.json({ format, filename: `${base}.csv`, mime: 'text/csv', content: csv });
    }
    if (format === 'robvis') {
      // robvis "data" CSV: Study, D1..Dn, Overall, Weight (one row). The judgement
      // labels are the exact strings robvis expects, per instrument (RoB2 3-level;
      // ROBINS-I 5-level) — RoB2 labels are byte-identical to before. Guaranteed
      // non-null: an instrument with no label set was refused above.
      const labelSet = robvisLabelsFor(inst.id);
      const header = ['Study', ...inst.domains.map(d => d.id), 'Overall', 'Weight'];
      const judgeChar = j => (labelSet[j] || 'No information');
      const row = [
        view.resultLabel || view.studyId,
        ...view.domains.map(d => judgeChar(d.resolvedJudgment)),
        judgeChar(view.overall.resolvedOverall),
        '1',
      ];
      const csv = [header, row].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      settleProjectExport(reservation.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(csv) });
      return res.json({ format, filename: `${base}_robvis.csv`, mime: 'text/csv', content: csv });
    }
    // Unreachable (format validated above); kept as a defensive guard.
    return res.status(400).json({ error: "format must be 'json', 'csv', or 'robvis'" });
  } catch (err) {
    // A post-reservation failure produced no file → refund the allowance (79.md §3).
    settleProjectExport(reservation?.reservationId, { status: 'failed', failureReason: err?.message });
    console.error('[rob] exportAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/projects/:projectId/assessments/export?format=csv ────────────
/**
 * 115.md build item 5 (§27) — the project-wide RoB export. One CSV, one SECTION
 * per instrument (see server/services/robExportService.js for why sectioned CSV
 * rather than the screening zip-job pattern).
 *
 * Permissions (dossier §14): VIEW access to the project's RoB surface is enough to
 * read the same data through the list endpoint, so the export gate is the same as
 * the per-assessment export — resolved RoB access + the project-export TIER gate
 * (Free blocked, one unit of the monthly allowance, refunded on failure).
 *
 * SOFT-DELETED ROWS ARE NEVER INCLUDED. 115.md decision 8 asked whether to add an
 * 'archived' affordance: RobAssessment.status is a three-value vocabulary
 * (draft | complete | consensus) that finalise/reopen, the progress readers and
 * the Ops metrics all switch on, and 'consensus' is an IDENTITY rather than a
 * stage. Introducing a fourth value would silently reclassify rows for every one
 * of those readers, and there is no separate archive column to use instead. So the
 * decision is: NO archive status — soft delete (`deletedAt`) plus the ROB_DELETE
 * audit row remains the only removal path, and starting a different instrument for
 * the same study never touches the earlier assessment (they are separate rows).
 */
export async function exportProjectAssessments(req, res) {
  let reservation;
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });

    const format = String(req.query.format || 'csv').toLowerCase();
    if (format !== 'csv') {
      return res.status(400).json({ error: "format must be 'csv' (the project-wide RoB export is a tool-sectioned CSV)" });
    }

    try {
      reservation = await requireProjectExport(req.user, {
        exportType: EXPORT_TYPES.ROB_ASSESSMENT, projectId: req.params.projectId, format,
      });
    } catch (e) { if (sendTierLimit(res, e)) return; throw e; }

    const rows = await prisma.robAssessment.findMany({
      where: { projectId: req.params.projectId, deletedAt: null },
      include: { answers: true, domainJudgments: true, overall: true },
      orderBy: [{ instrumentId: 'asc' }, { studyId: 'asc' }, { createdAt: 'asc' }],
    });
    const universe = await loadStudyUniverse(access.project);
    const studiesById = {};
    for (const s of universe) studiesById[s.id] = s;

    // Group by instrument — never aggregate across tools (decision 7).
    const byInstrument = new Map();
    for (const a of rows) {
      const id = a.instrumentId || 'RoB2';
      if (!byInstrument.has(id)) byInstrument.set(id, []);
      byInstrument.get(id).push(a);
    }

    const groups = [];
    for (const [instrumentId, list] of [...byInstrument.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
      const inst = resolveInstrument(instrumentId);
      // A row written under an instrument the registry no longer knows still gets a
      // section (its answers are real data) — just with no definition-derived
      // columns, rather than being silently dropped from the export.
      const applicIds = inst ? applicabilityDomainIds(inst) : [];
      const star = inst ? isScoringInstrument(inst) : false;
      groups.push({
        instrument: inst || { id: instrumentId, name: instrumentId, domains: [] },
        instrumentId,
        instrumentLabel: getRobTool(instrumentId)?.label || (inst && inst.name) || instrumentId,
        applicabilityDomainIds: applicIds,
        rows: list.map((a) => {
          const st = studiesById[a.studyId];
          const studyLabel = st
            ? [`${st.author || ''} ${st.year || ''}`.trim(), st.title].filter(Boolean).join(' — ')
            : a.studyId;
          const answers = {};
          const itemNotes = {};
          for (const ans of a.answers) {
            // The wire format is decoded HERE, not in the pure exporter: 101.md
            // keeps encode/decodeAnswerResponse as the only place it is applied.
            const decoded = star ? decodeAnswerResponse(ans.response) : ans.response;
            answers[ans.questionId] = Array.isArray(decoded) ? decoded.join('; ') : decoded;
            if (ans.rationale) itemNotes[ans.questionId] = ans.rationale;
          }
          const djs = {};
          const applic = {};
          const domainNotes = {};
          for (const dj of a.domainJudgments) {
            const parsed = parseDomainKey(dj.domainId);
            if (parsed.kind === 'applicability') {
              applic[parsed.domainId] = dj.finalJudgment || dj.proposedJudgment || '';
              if (dj.overrideJustification) domainNotes[`${parsed.domainId} (applicability)`] = dj.overrideJustification;
            } else {
              djs[parsed.domainId] = resolvedDomain(dj) || '';
              if (dj.overridden && dj.overrideJustification) domainNotes[parsed.domainId] = dj.overrideJustification;
            }
          }
          const ov = a.overall;
          return {
            studyId: a.studyId,
            studyLabel: a.resultLabel ? `${studyLabel} — ${a.resultLabel}` : studyLabel,
            instrumentVersion: a.instrumentVersion || '',
            variant: a.variant || '',
            reviewerId: a.reviewerId || '',
            reviewerName: a.reviewerName || '',
            status: a.status,
            isConsensus: a.status === CONSENSUS_STATUS,
            answers,
            itemNotes,
            domainJudgments: djs,
            applicability: applic,
            domainNotes,
            overall: ov ? ((ov.overridden && ov.finalOverall) ? ov.finalOverall : (ov.proposedOverall || '')) : '',
            overallNote: (ov && ov.overridden && ov.overrideJustification) ? ov.overrideJustification : '',
            createdAt: a.createdAt ? a.createdAt.toISOString() : '',
            updatedAt: a.updatedAt ? a.updatedAt.toISOString() : '',
          };
        }),
      });
    }

    // 115.md/dossier §6 — the REVIEWER BLIND, applied before anything is counted or
    // written. `getStudyReviewers` is fetched only once the workspace says the blind
    // is unlocked; this endpoint had no such rule, so it handed a reviewer their
    // co-reviewer's in-progress answers in a file. The rule lives in the pure
    // exporter (applyReviewerBlind) so it is unit-testable and so the summary the
    // API returns counts exactly the rows the file contains.
    const blinded = blindGroups(groups, req.user.id);
    const generatedAt = new Date().toISOString();
    const csv = buildRobProjectCsv({
      groups: blinded.groups, projectId: req.params.projectId, generatedAt, requesterId: req.user.id,
    });
    settleProjectExport(reservation.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(csv) });
    await audit(req.params.projectId, '', req.user, 'ROB_EXPORT', {
      entityType: 'Project', entityId: req.params.projectId,
      details: {
        format,
        assessments: rows.length - blinded.withheld,
        withheldForBlind: blinded.withheld,
        instrumentIds: [...byInstrument.keys()],
      },
    });
    return res.json({
      format: 'csv',
      filename: `rob-assessments_${req.params.projectId}.csv`,
      mime: 'text/csv',
      content: csv,
      summary: blinded.groups.map(g => ({ instrumentId: g.instrumentId, instrumentLabel: g.instrumentLabel, count: g.rows.length })),
      // Surfaced so the download UI can say "2 rows withheld while your
      // co-reviewers finish" rather than letting a reader assume the file is whole.
      withheldForBlind: blinded.withheld,
    });
  } catch (err) {
    settleProjectExport(reservation?.reservationId, { status: 'failed', failureReason: err?.message });
    console.error('[rob] exportProjectAssessments error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/projects/:projectId/studies (merged study universe) ───────────
// prompt46 #4 — screening/extraction-derived studies + RoB-local manual studies,
// each tagged with `source` ('screening' | 'manual'). View access is enough.
// 115.md build item 3/4 — each study additionally carries the design we could
// DETECT, the instruments recommended for it, and every assessment that already
// exists for it ACROSS instruments (so the selector can say "an existing ROBINS-I
// draft exists" before a reviewer starts a second tool — decision 8/§39).
export async function listStudyUniverse(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });

    const studies = await loadStudyUniverse(access.project);
    const catalogue = instrumentCatalogue();

    // Soft-deleted assessments are never surfaced (decision 8: soft delete stays
    // the only removal path — see the note on exportProjectAssessments).
    const existing = await prisma.robAssessment.findMany({
      where: { projectId: req.params.projectId, deletedAt: null },
      select: {
        id: true, studyId: true, instrumentId: true, instrumentVersion: true, variant: true,
        status: true, reviewerId: true, reviewerName: true, resultLabel: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const byStudy = {};
    for (const r of existing) {
      (byStudy[r.studyId] = byStudy[r.studyId] || []).push({
        id: r.id,
        instrumentId: r.instrumentId,
        instrumentLabel: getRobTool(r.instrumentId)?.label || r.instrumentId || 'Tool unknown',
        instrumentVersion: r.instrumentVersion || '',
        variant: r.variant || '',
        status: r.status,
        isConsensus: r.status === CONSENSUS_STATUS,
        reviewerId: r.reviewerId,
        reviewerName: r.reviewerName,
        resultLabel: r.resultLabel,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }

    return res.json({
      studies: studies.map((s) => ({
        ...s,
        recommendation: recommendationFor(s.design, catalogue),
        existingAssessments: byStudy[s.id] || [],
        existingInstrumentIds: [...new Set((byStudy[s.id] || []).map(r => r.instrumentId))],
      })),
      // Decision 3/6 — the FULL selectable catalogue travels with the list, so the
      // selector never has to hardcode which tools exist.
      instruments: catalogue,
    });
  } catch (err) {
    console.error('[rob] listStudyUniverse error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/rob/projects/:projectId/manual-studies ──────────────────────────
// Body: { title, authors?, year?, doi?, pmid?, notes? }. Requires RoB edit access.
export async function createManualStudy(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You have read-only access to Risk of Bias for this project.' });

    const { title, authors, year, doi, pmid, notes } = req.body || {};
    if (!String(title || '').trim() && !String(authors || '').trim()) {
      return res.status(400).json({ error: 'A study title (or authors) is required' });
    }
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const row = await prisma.robManualStudy.create({
      data: {
        projectId: req.params.projectId,
        title: String(title || '').slice(0, 500),
        authors: String(authors || '').slice(0, 300),
        year: String(year || '').slice(0, 12),
        doi: doi ? String(doi).slice(0, 200) : null,
        pmid: pmid ? String(pmid).slice(0, 40) : null,
        notes: notes ? String(notes).slice(0, 4000) : null,
        createdById: req.user.id,
        createdByName: me?.name || me?.email || '',
      },
    });
    await audit(req.params.projectId, '', { ...req.user, name: me?.name }, 'ROB_MANUAL_STUDY_ADD', {
      entityType: 'RobManualStudy', entityId: row.id, details: { title: row.title },
    });
    return res.status(201).json({ study: normaliseManualStudy(row) });
  } catch (err) {
    console.error('[rob] createManualStudy error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/rob/projects/:projectId/manual-studies/:studyId ────────────────
// Soft-delete a MANUAL study (creator/owner/leader only). Screening-derived studies
// have no RobManualStudy row → 404 (they are NOT deletable from RoB). If the study
// has assessments, require ?force=true (the assessments are kept, not deleted).
export async function deleteManualStudy(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });

    const row = await prisma.robManualStudy.findFirst({
      where: { id: req.params.studyId, projectId: req.params.projectId, deletedAt: null },
    });
    if (!row) return res.status(404).json({ error: 'Manual study not found' });

    // Creator OR owner OR leader, AND must have edit rights (mirrors canMutateAssessment:
    // a read-only leader cannot mutate). Owner always has canEdit via resolveRobAccess.
    const allowed = access.canEdit && (access.isOwner || access.role === 'leader' || row.createdById === req.user.id);
    if (!allowed) return res.status(403).json({ error: 'Only the study creator, a project leader, or the owner can delete this manual study.' });

    const n = await prisma.robAssessment.count({ where: { projectId: req.params.projectId, studyId: req.params.studyId, deletedAt: null } });
    if (n > 0 && String(req.query.force) !== 'true') {
      return res.status(409).json({ error: 'This study has risk-of-bias assessments. Confirm to remove the manual study (its assessments are kept).', assessmentCount: n });
    }
    await prisma.robManualStudy.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    await audit(req.params.projectId, '', { ...req.user, name: me?.name || me?.email }, 'ROB_MANUAL_STUDY_DELETE', {
      entityType: 'RobManualStudy', entityId: row.id, details: { keptAssessments: n },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[rob] deleteManualStudy error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── P14 — Guided appraisal + validation ───────────────────────────────────────

/**
 * Resolve title + abstract for a RoB study from its linked screening RECORD.
 * The server has NO PDF-text extractor, so the ONLY server-side text is the
 * screening record's title/abstract (full text comes from the client body).
 * Mirrors screeningController.getMetaLabStudyRecord's workspace resolution
 * (own workspace preferred, else active membership). Best-effort → null when
 * there is no linked record (e.g. a manual study). Never throws.
 */
async function resolveStudyText(projectId, studyId, userId) {
  try {
    const candidates = await prisma.screenProject.findMany({
      where: { linkedMetaLabProjectId: projectId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    let sp = candidates.find(x => x.ownerId === userId) || null;
    if (!sp && candidates.length) {
      const membership = await prisma.screenProjectMember.findFirst({
        where: { projectId: { in: candidates.map(x => x.id) }, userId, status: 'active' },
        select: { projectId: true },
      });
      if (membership) sp = candidates.find(x => x.id === membership.projectId) || null;
    }
    if (!sp || !studyId) return null;
    const rec = await prisma.screenRecord.findFirst({
      where: { projectId: sp.id, handoffStudyId: String(studyId) },
      select: { title: true, abstract: true },
    });
    return rec || null;
  } catch {
    return null;
  }
}

// ── POST /api/rob/assessments/:id/appraise ────────────────────────────────────
// Gated behind `guidedRobAppraisal` (+ rob_engine_v2). Body: { fullText?, force? }.
// Runs the DETERMINISTIC guided-appraisal engine over the study's text (linked
// screening title/abstract + client-supplied fullText) and writes each suggested
// signalling answer to RobAnswer as a MACHINE SUGGESTION (aiSuggested=true,
// aiModel/aiModelVersion/aiConfidence + evidence). It writes ONLY questions with
// no existing HUMAN answer (unless force=true), then recomputes the PROPOSED
// judgements. It NEVER writes finalJudgment / overridden / overrideJustification —
// human decisions are untouched. Mutate access required (creator/owner/leader).
export async function appraiseAssessment(req, res) {
  try {
    if (!(await guidedAppraisalEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can run a guided appraisal for this assessment.' });
    if (a.status === 'complete') return res.status(409).json({ error: 'Assessment is finalised; re-open to edit' });

    const instrument = instrumentFor(a);
    // 101.md §17 — the guided appraiser maps text onto the shared Y/PY/PN/N/NI
    // signalling vocabulary. The Newcastle–Ottawa items have their own closed option
    // lists and no such mapping exists, so we refuse rather than manufacture answers
    // that would look like a considered human appraisal.
    if (isStarInstrument(instrument)) {
      return res.status(400).json({ error: 'Guided appraisal is not available for the Newcastle–Ottawa Scale; its items must be assessed by a reviewer against the study text.' });
    }
    // 115.md — the SAME refusal, generalised. The appraiser is a cue-phrase matcher
    // with a hand-written table per instrument, and it covers RoB 2 and ROBINS-I
    // only. Run against a tool with no table, every question falls through to the
    // "No information" default — which is not a thin appraisal but a fabricated
    // one: 'NI' is off-vocabulary for most of the 2026 set (QUADAS-2 answers
    // Yes/No/Unclear, JBI adds Not applicable, AMSTAR 2 has Partial Yes) so the
    // suggestions are not even storable answers, and feeding that clean sweep to
    // the instrument's own algorithm makes it propose a judgement from ZERO
    // evidence (QUADAS-2 reads "no signalling question answered No" and proposes
    // LOW risk of bias). Refuse, exactly as the Newcastle–Ottawa forms are refused.
    if (!hasAppraisalCues(instrument)) {
      return res.status(400).json({
        error: `Guided appraisal is not available for ${instrument.name || instrument.id}: the appraiser has no cue table for its items, so every question would default to "No information" and any judgement proposed from that would rest on no evidence. Assess its items against the study text instead.`,
        supportedInstrumentIds: [...APPRAISAL_INSTRUMENT_IDS],
      });
    }
    const force = req.body?.force === true;
    const fullText = typeof req.body?.fullText === 'string' ? req.body.fullText : '';

    // Server-side text = linked screening record title/abstract (best-effort) +
    // client-supplied full text. No project data leaves the server.
    const rec = await resolveStudyText(a.projectId, a.studyId, req.user.id);
    const title = rec?.title || '';
    const abstract = rec?.abstract || '';

    const appraisal = appraiseFromText({ instrument, title, abstract, text: fullText });

    // SAFETY-CRITICAL: never overwrite a human answer. A row is a human answer when
    // aiSuggested !== true (upsertAnswers stamps aiSuggested=false on human edits;
    // legacy rows created before P14 have null → also treated as human). Unless
    // force, those questions are skipped entirely.
    const existing = await prisma.robAnswer.findMany({ where: { assessmentId: a.id } });
    const humanAnswered = new Set(existing.filter(x => x.aiSuggested !== true && x.response).map(x => x.questionId));

    let written = 0;
    let skipped = 0;
    for (const d of appraisal.domains) {
      for (const q of questionsOf(d)) {
        if (humanAnswered.has(q.questionId) && !force) { skipped += 1; continue; }
        const locator = q.evidenceLocator ? JSON.stringify(q.evidenceLocator) : null;
        const suggestion = {
          domainId: d.domainId,
          response: q.suggestedResponse,
          evidenceQuote: q.evidenceQuote || null,
          evidenceLocator: locator,
          rationale: q.rationale || null,
          aiSuggested: true,
          aiModel: 'pecan-rob-appraisal',
          aiModelVersion: ROB_APPRAISAL_VERSION,
          aiConfidence: q.confidence,
        };
        await prisma.robAnswer.upsert({
          where: { assessmentId_questionId: { assessmentId: a.id, questionId: q.questionId } },
          update: suggestion,
          create: { assessmentId: a.id, questionId: q.questionId, ...suggestion },
        });
        written += 1;
      }
    }

    // Recompute PROPOSED judgements only (finalJudgment / overridden untouched).
    await recomputeAndPersist(a.id, instrument, a.variant);
    await prisma.robAssessment.update({ where: { id: a.id }, data: { updatedAt: new Date() } });
    await audit(a.projectId, a.id, req.user, 'ROB_APPRAISE', {
      entityType: 'RobAssessment', entityId: a.id,
      details: {
        instrumentId: instrument.id, written, skipped, force,
        hasFullText: appraisal.coverage.hasFullText, textChars: appraisal.coverage.textChars,
        version: ROB_APPRAISAL_VERSION,
      },
    });
    return res.json({ appraisal, written, skipped, assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] appraiseAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/projects/:projectId/rob-validation ───────────────────────────
// Gated behind `guidedRobAppraisal`. View access is enough. Measures agreement
// between the MACHINE-proposed per-domain judgement and the HUMAN judgement
// (finalJudgment — set only on override or finalise) for every assessment in the
// project, via weighted κ (robDomainAgreement). Agreement is STRICTLY SCOPED to
// one instrument (?instrumentId=RoB2|ROBINS-I, default RoB2) because the 3-level
// RoB2 scale and the 5-level ROBINS-I scale must NEVER be pooled into one κ.
// `?format=csv` returns a per-domain + overall summary CSV.
export async function robValidation(req, res) {
  try {
    if (!(await guidedAppraisalEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });

    const wantedId = String(req.query.instrumentId || '');
    const instrumentId = isRegisteredInstrument(wantedId) ? wantedId : 'RoB2';
    const instrument = getInstrument(instrumentId);
    // 101.md §21/§26 — weighted κ needs an ORDINAL judgement scale. The NOS has none
    // (it has a star count), and there is no machine appraiser to compare against, so
    // this endpoint refuses rather than computing a κ over an empty category list.
    if (isStarInstrument(instrument)) {
      return res.status(400).json({ error: 'Machine-vs-human agreement is not defined for the Newcastle–Ottawa Scale, which has no ordinal judgement scale and no guided appraiser.' });
    }
    // Ordinal, severity-ASCENDING categories for weighted κ. Use the instrument's
    // explicit `judgmentOrder` when present (ROBINS-I: low<moderate<ni<serious<
    // critical — `ni` is NOT most-severe); RoB2's judgmentLevels order already IS
    // its severity order, so it falls back cleanly.
    const categories = levelValues(instrument.judgmentOrder).length
      ? levelValues(instrument.judgmentOrder)
      : domainJudgmentLevels(instrument, null);

    const rows = await prisma.robAssessment.findMany({
      where: { projectId: req.params.projectId, deletedAt: null, instrumentId },
      include: { domainJudgments: true },
    });

    // One pair per (study, domain) where a machine proposal exists AND the human
    // made an EXPLICIT judgement (`overridden` = they actively set finalJudgment —
    // whether it agrees with or differs from the proposal). We deliberately EXCLUDE
    // non-overridden domains: `finaliseAssessment` auto-copies proposedJudgment into
    // finalJudgment for those, which would otherwise manufacture guaranteed-agreement
    // pairs and inflate κ. So this measures agreement over domains the reviewer
    // independently judged (see `n`), not auto-accepted defaults.
    const pairs = [];
    for (const a of rows) {
      for (const dj of a.domainJudgments) {
        // 115.md — an applicability concern is not a risk-of-bias judgement and has
        // no machine proposal; pooling it into κ would measure nothing.
        if (isApplicabilityKey(dj.domainId)) continue;
        const proposed = dj.proposedJudgment || '';
        const human = dj.finalJudgment || '';
        if (!proposed || !dj.overridden || !human) continue;
        pairs.push({ studyId: a.studyId, domainId: dj.domainId, a: proposed, b: human });
      }
    }

    const report = robDomainAgreement(pairs, { categories });

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const esc = c => `"${String(c ?? '').replace(/"/g, '""')}"`;
      const lines = [['scope', 'domainId', 'n', 'kappa', 'agreementPct'].map(esc).join(',')];
      const ov = report.overall;
      lines.push(['overall', '', report.n, ov ? ov.kappa.toFixed(4) : '', (report.percentAgreement).toFixed(4)].map(esc).join(','));
      for (const d of report.byDomain) {
        lines.push(['domain', d.domainId, d.n, d.kappa != null ? d.kappa.toFixed(4) : '', d.agreementPct.toFixed(4)].map(esc).join(','));
      }
      return res.json({
        format: 'csv', filename: `rob-validation_${instrumentId}.csv`, mime: 'text/csv',
        content: lines.join('\n'),
      });
    }

    return res.json({
      instrumentId,
      categories,
      n: report.n,
      percentAgreement: report.percentAgreement,
      overall: report.overall,
      byDomain: report.byDomain,
      disagreements: report.disagreements,
      appraisalVersion: ROB_APPRAISAL_VERSION,
    });
  } catch (err) {
    console.error('[rob] robValidation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── 101.md §22 — project-level NOS interpretation thresholds ──────────────────
// Stored on the Project.data blob under `robNosThresholds`. There is deliberately
// no server default other than 'none': the Newcastle–Ottawa Scale defines NO
// quality threshold, so a project that has not chosen one reports the star profile
// and nothing else. `interpretNos` always stamps `official:false` + an attribution,
// so a configured threshold can never be presented as a NOS rule.

// GET /api/rob/projects/:projectId/nos-thresholds — view access is enough.
export async function getNosThresholds(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    return res.json({
      thresholds: coerceNosThresholds(access.project.robNosThresholds),
      modes: NOS_THRESHOLD_MODES,
      defaultMode: NOS_DEFAULT_THRESHOLD_MODE,
      maxStars: NOS_MAX_STARS,
      // Offered as an explicitly-attributed option, never as "the NOS threshold".
      ahrq: AHRQ_STANDARD,
      conventionalBands: NOS_CONVENTIONAL_BANDS,
      conventionalBandsNotice: NOS_CONVENTIONAL_BANDS_NOTICE,
      canEdit: access.canEdit,
    });
  } catch (err) {
    console.error('[rob] getNosThresholds error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PUT /api/rob/projects/:projectId/nos-thresholds — body { mode, bands?, label? }.
// Requires RoB edit rights. Written through mutateProjectBlob's compare-and-swap so
// a concurrent project save can never lose it (101.md §32).
export async function putNosThresholds(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You have read-only access to Risk of Bias for this project.' });

    const next = coerceNosThresholds(req.body);
    if (next.mode === 'custom' && !next.bands.length) {
      return res.status(400).json({ error: 'A project-defined interpretation needs at least one band of the form { max, level }, with max between 0 and 9.' });
    }
    let before = null;
    const out = await mutateProjectBlob(req.params.projectId, (data) => {
      before = coerceNosThresholds(data.robNosThresholds);
      // A no-op PUT must not bump the project autosave revision (101.md §2/§30 — a
      // change that changes nothing is not a material project change).
      if (JSON.stringify(before) === JSON.stringify(next)) return { result: { changed: false }, commit: false };
      data.robNosThresholds = next;
      return { result: { changed: true } };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });

    if (out.result.changed) {
      await audit(req.params.projectId, '', req.user, 'ROB_NOS_THRESHOLDS', {
        entityType: 'Project', entityId: req.params.projectId, details: { before, after: next },
      });
    }
    return res.json({
      thresholds: next,
      changed: !!out.result.changed,
      // Any project-defined banding gets the "this is your rule, not the NOS's" notice.
      notice: next.mode === 'custom' ? NOS_CONVENTIONAL_BANDS_NOTICE : '',
    });
  } catch (err) {
    console.error('[rob] putNosThresholds error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── 101.md §25 — dual reviewer + consensus ────────────────────────────────────

/**
 * Compare the INDEPENDENT reviewer assessments of one study under ONE instrument.
 *
 * Two rows sharing (projectId, studyId, instrumentId) with different reviewerId
 * are the two independent assessments; the reconciled record is the row whose
 * status is 'consensus' and it is excluded from the comparison (it is the OUTPUT
 * of reconciliation, not an input to it).
 *
 * A disagreement is a question that at least two reviewers ANSWERED and on which
 * they chose different option values. A question only one reviewer has reached is
 * incomplete, not a disagreement — reporting it as one would overstate discord
 * (101.md §17). Comparison is order-insensitive for the additive Comparability
 * item, so ['b','a'] and ['a','b'] agree.
 *
 * @param {object} instrument
 * @param {Array<{id,reviewerId,reviewerName,status,answersByDomain}>} rows
 * Pure.
 */
export function reviewerComparison(instrument, rows = []) {
  const star = isStarInstrument(instrument);
  const all = Array.isArray(rows) ? rows : [];
  const consensusRow = all.find(r => r && r.status === CONSENSUS_STATUS) || null;
  const independent = all.filter(r => r && r !== consensusRow);

  const shape = (r) => {
    if (!r) return null;
    const abd = r.answersByDomain || {};
    const out = {
      assessmentId: r.id,
      reviewerId: r.reviewerId || '',
      reviewerName: r.reviewerName || '',
      status: r.status || 'draft',
      completeness: engineCompleteness(instrument, { answersByDomain: abd }).overall,
      score: null,
    };
    if (star) {
      const s = nosScoreAssessment(instrument, abd);
      out.score = {
        total: s.total, maxStars: s.maxStars, profile: s.profile, complete: s.complete,
        byDomain: Object.fromEntries(instrument.domains.map(d => [d.id, s.byDomain[d.id].stars])),
      };
    }
    return out;
  };

  // Comparison key: sorted so option ORDER never manufactures a disagreement.
  const keyOf = (vals) => vals.slice().sort().join('+');

  const disagreements = [];
  let compared = 0;
  for (const d of instrument.domains) {
    for (const q of questionsOf(d)) {
      const values = {};
      const keys = [];
      for (const r of independent) {
        const raw = (r.answersByDomain && r.answersByDomain[d.id]) ? r.answersByDomain[d.id][q.id] : undefined;
        const vals = nosSelectedValues(raw);
        if (!vals.length) continue;
        values[r.reviewerId || r.id] = vals.length === 1 ? vals[0] : vals;
        keys.push(keyOf(vals));
      }
      if (keys.length < 2) continue;
      compared += 1;
      if (new Set(keys).size > 1) {
        disagreements.push({
          domainId: d.id,
          domainName: d.name,
          questionId: q.id,
          questionText: q.text,
          select: q.select || 'one',
          values,
        });
      }
    }
  }

  return {
    reviewers: independent.map(shape),
    disagreements,
    consensus: shape(consensusRow),
    agreement: {
      comparedQuestions: compared,
      agreedQuestions: compared - disagreements.length,
      disagreedQuestions: disagreements.length,
      // Null (not 1) when nothing has been compared yet — a study nobody has
      // double-assessed has no agreement, rather than perfect agreement.
      percentAgreement: compared ? (compared - disagreements.length) / compared : null,
    },
  };
}

// GET /api/rob/projects/:projectId/studies/:studyId/reviewers[?instrumentId=] ──
// The dual-reviewer view for one study: each independent reviewer's assessment,
// the per-question disagreements between them, and the consensus row if one exists.
// Read-only — this endpoint NEVER writes, so it can never overwrite a reviewer's
// judgement. View access is enough.
export async function getStudyReviewers(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });

    const wanted = String(req.query.instrumentId || '');
    const scopedId = isRegisteredInstrument(wanted) ? wanted : null;
    const rows = await prisma.robAssessment.findMany({
      where: {
        projectId: req.params.projectId,
        studyId: req.params.studyId,
        deletedAt: null,
        ...(scopedId ? { instrumentId: scopedId } : {}),
      },
      include: { answers: true, domainJudgments: true, overall: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!rows.length) {
      return res.json({
        studyId: req.params.studyId,
        instrumentId: scopedId,
        instrumentLabel: scopedId ? (getRobTool(scopedId)?.label || scopedId) : '',
        reviewers: [], disagreements: [], consensus: null,
        agreement: { comparedQuestions: 0, agreedQuestions: 0, disagreedQuestions: 0, percentAgreement: null },
        instrumentIds: [],
      });
    }

    // Comparison is STRICTLY scoped to one instrument — a RoB 2 row and a NOS row
    // answer different questions entirely, so pooling them would be meaningless.
    const instrumentIds = [...new Set(rows.map(r => r.instrumentId || 'RoB2'))];
    const useId = scopedId || (isRegisteredInstrument(instrumentIds[0]) ? instrumentIds[0] : 'RoB2');
    const inst = getInstrument(useId);
    const scoped = rows.filter(r => (r.instrumentId || 'RoB2') === useId);

    const cmp = reviewerComparison(inst, scoped.map(r => ({
      id: r.id,
      reviewerId: r.reviewerId,
      reviewerName: r.reviewerName,
      status: r.status,
      answersByDomain: answersByDomainFrom(inst, r.answers),
    })));

    return res.json({
      studyId: req.params.studyId,
      instrumentId: inst.id,
      instrumentLabel: getRobTool(inst.id)?.label || inst.id,
      scoring: isStarInstrument(inst) ? 'stars' : 'judgment',
      maxStars: isStarInstrument(inst) ? inst.maxStars : null,
      // Surfaced so a UI can warn that this study also carries assessments under a
      // different instrument rather than silently hiding them.
      instrumentIds,
      ...cmp,
    });
  } catch (err) {
    console.error('[rob] getStudyReviewers error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /api/rob/projects/:projectId/studies/:studyId/consensus ────────────────
// Body: { instrumentId, outcomeId?, resultLabel?, seedFromAssessmentId? }
// Creates the THIRD, reconciled assessment row (status 'consensus'). It requires
// two genuinely independent reviewer assessments to already exist — a "consensus"
// with nothing to reconcile would be a fabricated methodological claim (101.md §17).
// Seeding COPIES a reviewer's answers into the NEW row; the source row is read and
// never written to (§25 — never silently overwrite one reviewer with the other).
export async function createConsensusAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You have read-only access to Risk of Bias for this project.' });

    const { instrumentId, outcomeId, resultLabel, seedFromAssessmentId } = req.body || {};
    const wantId = instrumentId ? String(instrumentId) : '';
    // 115.md decision 3 — registry-driven, exactly like createAssessment.
    const instrument = resolveInstrument(wantId);
    if (!instrument) {
      return res.status(400).json({
        error: `Unknown instrumentId: ${wantId || '(missing)'}. Available instruments: ${registeredInstrumentIds().join(', ')}`,
      });
    }
    if (instrument.consensusSupported === false) {
      return res.status(400).json({ error: `${instrument.name || instrument.id} does not support a consensus record.` });
    }

    const existing = await prisma.robAssessment.findMany({
      where: { projectId: req.params.projectId, studyId: req.params.studyId, instrumentId: wantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const already = existing.find(r => r.status === CONSENSUS_STATUS);
    if (already) {
      return res.status(409).json({ error: 'A consensus assessment already exists for this study.', assessmentId: already.id });
    }
    const independent = existing.filter(r => r.status !== CONSENSUS_STATUS);
    const reviewerIds = [...new Set(independent.map(r => r.reviewerId || '').filter(Boolean))];
    if (reviewerIds.length < 2) {
      return res.status(409).json({
        error: 'A consensus record requires two independent reviewer assessments of this study.',
        reviewerCount: reviewerIds.length,
      });
    }

    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const row = await prisma.robAssessment.create({
      data: {
        projectId: req.params.projectId,
        studyId: req.params.studyId,
        outcomeId: outcomeId ? String(outcomeId) : (independent[0].outcomeId || null),
        resultLabel: resultLabel ? String(resultLabel).slice(0, 300) : (independent[0].resultLabel || null),
        instrumentId: instrument.id,
        // Server-stamped from the definition, never from the client (115.md item 1).
        instrumentVersion: instrumentVersionOf(instrument),
        // 115.md — where the tool has SELECTABLE evaluation types (PROBAST) the
        // consensus row reconciles the same evaluation the reviewers appraised, so
        // its variant is INHERITED from them (as outcomeId/resultLabel already are)
        // rather than reset to the definition's default — which would silently
        // re-label a development-only appraisal as development-and-validation and
        // switch off the Step 4 downgrade caveat. Definition-stamped for every
        // other tool, exactly as before.
        variant: evaluationTypeValues(instrument).length
          ? (independent[0].variant || variantOf(instrument))
          : variantOf(instrument),
        reviewerId: req.user.id,
        reviewerName: me?.name || me?.email || '',
        status: CONSENSUS_STATUS,
      },
    });

    // Optional seed: copy one reviewer's answers into the NEW row so reconciliation
    // starts from a real assessment rather than a blank form.
    let seededFrom = null;
    if (seedFromAssessmentId) {
      const src = independent.find(r => r.id === String(seedFromAssessmentId));
      if (!src) return res.status(400).json({ error: 'seedFromAssessmentId must be one of the reviewer assessments for this study.' });
      const answers = await prisma.robAnswer.findMany({ where: { assessmentId: src.id } });
      for (const ans of answers) {
        await prisma.robAnswer.create({
          data: {
            assessmentId: row.id,
            domainId: ans.domainId,
            questionId: ans.questionId,
            response: ans.response,
            rationale: ans.rationale || null,
            evidenceQuote: ans.evidenceQuote || null,
            evidenceLocator: ans.evidenceLocator || null,
            // A copied answer is a human starting point for reconciliation, and it
            // carries no machine-suggestion provenance forward.
            aiSuggested: false,
          },
        });
      }
      seededFrom = { assessmentId: src.id, reviewerId: src.reviewerId, answerCount: answers.length };
    }

    await recomputeAndPersist(row.id, instrument, row.variant);
    await audit(req.params.projectId, row.id, { ...req.user, name: me?.name }, 'ROB_CONSENSUS_CREATE', {
      entityType: 'RobAssessment', entityId: row.id,
      details: { studyId: req.params.studyId, instrumentId: instrument.id, reviewerIds, seededFrom },
    });
    return res.status(201).json({ assessment: await buildView(row.id), seededFrom });
  } catch (err) {
    console.error('[rob] createConsensusAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
