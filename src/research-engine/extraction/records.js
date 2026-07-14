/**
 * extraction/records.js — canonical protocol-scoped extraction RECORD + pure
 * bridges to the mkStudy row shape. Dependency-free (no DOM/React/I/O) — safe to
 * import from the server, the client, and unit tests.
 *
 * WHAT AN "EXTRACTION RECORD" IS
 *   One record per study × outcome × timepoint × comparison. A record is the
 *   protocol-scoped unit a reviewer captures while reading a paper: it carries
 *   the raw + effect values, WHERE they came from (provenance), how sure the
 *   extractor was (confidence), and whether the record targets a protocol
 *   outcome (scope.level 'primary'/'secondary') or is off-protocol ('other').
 *   Records start life as DRAFTS; confirming a draft turns it into (or merges
 *   it into) an mkStudy-shaped analysis row.
 *
 * CONTRACT WITH mkStudy (project-model/defaults.js):
 *   - ALL numeric fields are STRINGS; "" means empty. mkExtractionRecord
 *     coerces incoming numbers via String(...) with full precision.
 *   - es/lo/hi are on the ANALYSIS scale (log for OR/RR/HR, Fisher z for COR).
 *     This module never transforms them — they pass through verbatim.
 *   - record.comparison bridges onto study.comparatorDef (the closest
 *     mkStudy field for the comparison axis).
 *
 * PROTECTION RULE (recordToStudy / confirmDraft)
 *   A non-empty base (human-entered) study field is NEVER overwritten:
 *   - empty record value        → base value kept, silently.
 *   - different non-empty value → base kept, a note is appended to study.notes,
 *     and the field name is listed in the returned `overwrites` array.
 *   - equal values / empty base → no conflict; record value written when base empty.
 *
 * DETERMINISM
 *   mkExtractionRecord generates an 8-char id via the repo's uid pattern
 *   (Math.random().toString(36).slice(2, 10)) but accepts an injectable idFn so
 *   tests can pin ids. Timestamps are ALWAYS caller-supplied (`at` params /
 *   provenance.at) — no Date.now()/new Date() anywhere in this module. All
 *   functions are pure: inputs are never mutated (manual deep copies).
 */

import { mkStudy } from '../project-model/defaults.js';

const DEFAULT_ID_FN = () => Math.random().toString(36).slice(2, 10);

/** The scope levels a record can target. */
export const SCOPE_LEVELS = ['primary', 'secondary', 'other'];

/** How a value was captured. ('ocr' = a value recognised from a scanned/image region
 *  via local text recognition — 76.md §11 "indicate that OCR was used"; keeps the
 *  record layer in step with valuePrecedence, which already knows 'ocr'.) */
export const PROVENANCE_METHODS = ['auto', 'table', 'figure', 'click', 'manual', 'ai', 'ocr'];

/** Extractor confidence levels. */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

/** Every numeric value slot a record carries (all string-typed, "" = empty). */
export const VALUE_FIELDS = [
  'n', 'nExp', 'nCtrl', 'meanExp', 'sdExp', 'meanCtrl', 'sdCtrl',
  'a', 'b', 'c', 'd', 'events', 'total', 'es', 'lo', 'hi',
];

/** provenance.method → mkStudy `source`. 'manual' maps to nothing (leave as-is). */
const SOURCE_BY_METHOD = { table: 'table', figure: 'figure', click: 'text', auto: 'text', ai: 'text' };

/** Study-level CITATION metadata inherited when a confirmed draft becomes a NEW
 *  per-outcome row (never the outcome/value fields — each outcome×timepoint is its
 *  own row, so a draft must not inherit another outcome's numbers). */
const CITATION_FIELDS = [
  'author', 'year', 'country', 'design', 'title', 'authors', 'journal', 'doi', 'pmid',
  'abstract', 'dataSource', 'enrollPeriod', 'populationDef', 'interventionDef', 'funding',
  'extractedBy', 'screeningRecordId', 'screeningProjectId',
  // 83.md §2 — the blob study-document pointer is STUDY-level (dedup-safe server-side),
  // so a new per-outcome row keeps resolving the paper's persisted PDF.
  'document',
];

/** citationTemplate(src) — a FRESH study (new id, empty value/outcome fields) that
 *  carries only the citation metadata of `src`, so recordToStudy fills the draft's
 *  values with no protection-rule conflict. */
function citationTemplate(src) {
  const t = mkStudy();
  for (const f of CITATION_FIELDS) if (valStr(src[f]) !== '') t[f] = src[f];
  return t;
}

/** Record fields bridged onto the study with the protection rule, in order. */
const BRIDGED_FIELDS = [
  ['author', 'author'],
  ['year', 'year'],
  ['outcome', 'outcome'],
  ['timepoint', 'timepoint'],
  ['esType', 'esType'],
  ['comparison', 'comparatorDef'],
];

/* ── small pure helpers ──────────────────────────────────────────────────── */

/** valStr(v) — coerce to the string-typed mkStudy convention ("" = empty). */
function valStr(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v).trim();
}

/** strOr(v, fallback) — plain string passthrough (numbers stringified). */
function strOr(v, fallback = '') {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** deepCopy(v) — manual deep copy (plain objects/arrays/primitives only). */
function deepCopy(v) {
  if (Array.isArray(v)) return v.map(deepCopy);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepCopy(v[k]);
    return out;
  }
  return v;
}

function isFilled(v) {
  return valStr(v) !== '';
}

/* ── 1. mkExtractionRecord ───────────────────────────────────────────────── */

/**
 * mkExtractionRecord(partial, idFn?) — build a canonical extraction record from
 * a partial. Unknown keys are ignored; every known key gets a sane default so
 * downstream code never has to null-check the shape. Nested partials (scope /
 * values / provenance) are merged onto their defaults safely; numeric values
 * are coerced to strings (mkStudy convention).
 *
 * @param {object} partial
 * @param {() => string} [idFn]  injectable id generator (determinism in tests)
 * @returns {object} record
 */
export function mkExtractionRecord(partial = {}, idFn = DEFAULT_ID_FN) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const scope = p.scope && typeof p.scope === 'object' ? p.scope : {};
  const values = p.values && typeof p.values === 'object' ? p.values : {};
  const prov = p.provenance && typeof p.provenance === 'object' ? p.provenance : {};

  const outValues = {};
  for (const f of VALUE_FIELDS) outValues[f] = valStr(values[f]);

  return {
    id: typeof p.id === 'string' && p.id ? p.id : idFn(),
    draft: p.draft === undefined ? true : !!p.draft,
    author: valStr(p.author),
    year: valStr(p.year),
    outcome: valStr(p.outcome),
    timepoint: valStr(p.timepoint),
    comparison: valStr(p.comparison),
    esType: valStr(p.esType),
    // sourceStudyId — the study a draft ORIGINATED from (so confirm can inherit that
    // study's citation instead of whatever row is currently selected). '' = none.
    sourceStudyId: valStr(p.sourceStudyId),
    // extractedBy — who captured this record; bridged onto study.extractedBy (fill-only).
    extractedBy: valStr(p.extractedBy),
    scope: {
      level: SCOPE_LEVELS.includes(scope.level) ? scope.level : 'other',
      outcomeId: strOr(scope.outcomeId, ''),
      // Back-compat boolean flag (truthy when a canonical outcome name was supplied)…
      canonical: !!scope.canonical,
      // …plus the distinct canonical outcome NAME string (autoExtract passes the
      // outcome's canonical here; the boolean above no longer clobbers it).
      canonicalName: strOr(
        scope.canonicalName,
        typeof scope.canonical === 'string' ? scope.canonical : '',
      ),
    },
    values: outValues,
    provenance: {
      method: PROVENANCE_METHODS.includes(prov.method) ? prov.method : 'manual',
      page: numOrNull(prov.page),
      region: normalizeRegion(prov.region),
      excerpt: typeof prov.excerpt === 'string' ? prov.excerpt : '',
      at: strOr(prov.at, ''),
    },
    confidence: CONFIDENCE_LEVELS.includes(p.confidence) ? p.confidence : 'low',
    alternates: Array.isArray(p.alternates) ? deepCopy(p.alternates) : [],
    conversions: Array.isArray(p.conversions) ? deepCopy(p.conversions) : [],
    needsReview: p.needsReview === undefined ? true : !!p.needsReview,
    notes: typeof p.notes === 'string' ? p.notes : '',
  };
}

/** normalizeRegion(r) — {x0,y0,x1,y1} all-numeric, or null. */
function normalizeRegion(r) {
  if (!r || typeof r !== 'object') return null;
  const x0 = numOrNull(r.x0), y0 = numOrNull(r.y0), x1 = numOrNull(r.x1), y1 = numOrNull(r.y1);
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
  return { x0, y0, x1, y1 };
}

/* ── 2. recordToStudy ────────────────────────────────────────────────────── */

/**
 * recordToStudy(record, base?) — bridge one record into an mkStudy-shaped row.
 *
 * With a base study, the result starts as a DEEP COPY of the base (so every
 * inherited field — title/authors/journal/doi/pmid/abstract/country/design,
 * screeningRecordId/screeningProjectId, rob, flags, … — is preserved) and record
 * values are laid on top under the PROTECTION RULE (see file header). Without a
 * base, the result starts from mkStudy().
 *
 * Also:
 *   - source: provenance.method table→'table', figure→'figure', click/auto/ai→
 *     'text'; 'manual' leaves source as-is. Only ever fills an EMPTY source.
 *   - scope + provenance are carried onto the study verbatim (deep copies).
 *   - needsReview is always true; extractedAt = record.provenance.at (base's
 *     value kept when the record has none).
 *   - record conversions are APPENDED after base conversions (never replace);
 *     `converted` flips true when the record contributed any.
 *
 * @param {object} record  an extraction record (normalized defensively)
 * @param {object|null} [base]  existing study to merge into (copied, not mutated)
 * @returns {{ study: object, overwrites: string[] }}
 *   overwrites — field names where a DIFFERENT non-empty record value was
 *   discarded in favour of the base (each also noted in study.notes).
 */
export function recordToStudy(record, base = null) {
  const rec = mkExtractionRecord(record);
  const study = base && typeof base === 'object' ? deepCopy(base) : mkStudy();
  const overwrites = [];
  const noteLines = [];

  const apply = (field, recVal) => {
    const rv = valStr(recVal);
    if (rv === '') return; // never overwrite anything with an empty record value
    const bv = valStr(study[field]);
    if (bv === '') { study[field] = rv; return; }
    if (bv === rv) return;
    // Conflict: the base (human) value wins.
    overwrites.push(field);
    noteLines.push(`[extraction] kept ${field}="${bv}" (extracted "${rv}")`);
  };

  for (const [recField, studyField] of BRIDGED_FIELDS) apply(studyField, rec[recField]);
  for (const f of VALUE_FIELDS) apply(f, rec.values[f]);

  // Source mapping — fills only an empty source; 'manual' maps to nothing.
  const mapped = SOURCE_BY_METHOD[rec.provenance.method];
  if (mapped && !valStr(study.source)) study.source = mapped;

  // extractedBy — fill only when the study has none (never overwrite a real name).
  if (isFilled(rec.extractedBy) && !valStr(study.extractedBy)) study.extractedBy = rec.extractedBy;

  // Carry scope + provenance onto the study.
  study.scope = deepCopy(rec.scope);
  study.provenance = deepCopy(rec.provenance);

  // Conversions are appended, never replaced.
  const baseConversions = Array.isArray(study.conversions) ? study.conversions : [];
  study.conversions = [...baseConversions, ...deepCopy(rec.conversions)];
  if (rec.conversions.length) study.converted = true;

  study.needsReview = true;
  study.extractedAt = rec.provenance.at || valStr(study.extractedAt);

  if (noteLines.length) {
    const existing = typeof study.notes === 'string' ? study.notes : '';
    study.notes = (existing ? existing + '\n' : '') + noteLines.join('\n');
  }

  return { study, overwrites };
}

/* ── 3. confirmDraft ─────────────────────────────────────────────────────── */

/**
 * confirmDraft(state, draftId, opts?) — confirm a draft record into the studies
 * list. Pure: the input arrays are never mutated (the returned arrays are deep
 * copies with the change applied).
 *
 * Modes:
 *   - opts.baseStudyId matches an existing study → the draft is MERGED into a COPY
 *     of that row (empty fields filled; human values protected — see recordToStudy).
 *     Use only when you truly mean to fill THAT row's outcome.
 *   - opts.citationBaseId matches an existing study → a NEW per-outcome row is
 *     APPENDED that inherits only the source study's CITATION metadata (not its
 *     outcome/values). This is the safe default for confirming an auto/assisted
 *     draft, since every study×outcome×timepoint is its own row — it can never
 *     overwrite or discard another outcome's data.
 *   - neither → a fresh mkStudy-shaped row is appended.
 * baseStudyId takes precedence over citationBaseId if both are given.
 *
 * @param {{ studies?: object[], drafts?: object[] }} state
 * @param {string} draftId
 * @param {{ at?: string, baseStudyId?: (string|null), citationBaseId?: (string|null) }} [opts]
 * @returns {{ ok: boolean, studies: object[], drafts: object[], study: (object|null) }}
 */
export function confirmDraft(state = {}, draftId, opts = {}) {
  const s = state && typeof state === 'object' ? state : {};
  const o = opts && typeof opts === 'object' ? opts : {};
  const at = strOr(o.at, '');
  const baseStudyId = o.baseStudyId === undefined ? null : o.baseStudyId;
  const citationBaseId = o.citationBaseId === undefined ? null : o.citationBaseId;

  const studies = Array.isArray(s.studies) ? s.studies.map(deepCopy) : [];
  const drafts = Array.isArray(s.drafts) ? s.drafts.map(deepCopy) : [];

  const idx = drafts.findIndex((d) => d && d.id === draftId);
  if (idx === -1) return { ok: false, studies, drafts, study: null };
  const draft = drafts[idx];

  const baseIdx = baseStudyId != null ? studies.findIndex((st) => st && st.id === baseStudyId) : -1;
  let base = baseIdx >= 0 ? studies[baseIdx] : null;
  // Append-with-citation: inherit citation metadata into a NEW row (never replace).
  if (baseIdx < 0 && citationBaseId != null) {
    const src = studies.find((st) => st && st.id === citationBaseId);
    if (src) base = citationTemplate(src);
  }

  const { study } = recordToStudy(draft, base);
  if (!study.extractedAt && at) study.extractedAt = at;
  if (at) study.updatedAt = at;

  if (baseIdx >= 0) {
    studies[baseIdx] = study;
  } else {
    if (at && !valStr(study.addedAt)) study.addedAt = at;
    studies.push(study);
  }
  drafts.splice(idx, 1);

  return { ok: true, studies, drafts, study };
}

/* ── 4. parkRecord ───────────────────────────────────────────────────────── */

/**
 * parkRecord(state, draftId, opts?) — move a draft to the parked list (an
 * off-protocol holding pen). The parked record gets draft:false, scope.level
 * forced to 'other', and parkedAt = opts.at. Pure — inputs never mutated.
 *
 * @param {{ drafts?: object[], parked?: object[] }} state
 * @param {string} draftId
 * @param {{ at?: string }} [opts]
 * @returns {{ ok: boolean, drafts: object[], parked: object[] }}
 */
export function parkRecord(state = {}, draftId, opts = {}) {
  const s = state && typeof state === 'object' ? state : {};
  const o = opts && typeof opts === 'object' ? opts : {};
  const drafts = Array.isArray(s.drafts) ? s.drafts.map(deepCopy) : [];
  const parked = Array.isArray(s.parked) ? s.parked.map(deepCopy) : [];

  const idx = drafts.findIndex((d) => d && d.id === draftId);
  if (idx === -1) return { ok: false, drafts, parked };

  const rec = drafts.splice(idx, 1)[0];
  rec.draft = false;
  rec.scope = {
    level: 'other',
    outcomeId: rec.scope && typeof rec.scope === 'object' ? strOr(rec.scope.outcomeId, '') : '',
    canonical: !!(rec.scope && rec.scope.canonical),
    // Preserve the canonical outcome NAME through the park round-trip.
    canonicalName: rec.scope && typeof rec.scope === 'object' ? strOr(rec.scope.canonicalName, '') : '',
  };
  rec.parkedAt = strOr(o.at, '');
  parked.push(rec);

  return { ok: true, drafts, parked };
}

/* ── 5. unparkToDraft ────────────────────────────────────────────────────── */

/**
 * unparkToDraft(state, recordId, opts) — move a parked record back to drafts.
 * REQUIRES a real protocol scope: opts.scope.level must be 'primary' or
 * 'secondary' AND opts.scope.outcomeId must be non-empty ('other' is refused —
 * a parked record can only come back once it is attached to a protocol
 * outcome). Pure — inputs never mutated.
 *
 * @param {{ parked?: object[], drafts?: object[] }} state
 * @param {string} recordId
 * @param {{ scope?: { level?: string, outcomeId?: string, canonical?: boolean } }} [opts]
 * @returns {{ ok: boolean, parked: object[], drafts: object[] }}
 */
export function unparkToDraft(state = {}, recordId, opts = {}) {
  const s = state && typeof state === 'object' ? state : {};
  const o = opts && typeof opts === 'object' ? opts : {};
  const parked = Array.isArray(s.parked) ? s.parked.map(deepCopy) : [];
  const drafts = Array.isArray(s.drafts) ? s.drafts.map(deepCopy) : [];

  const scope = o.scope && typeof o.scope === 'object' ? o.scope : null;
  const level = scope && (scope.level === 'primary' || scope.level === 'secondary') ? scope.level : null;
  const outcomeId = scope ? strOr(scope.outcomeId, '').trim() : '';
  if (!level || !outcomeId) return { ok: false, parked, drafts };

  const idx = parked.findIndex((r) => r && r.id === recordId);
  if (idx === -1) return { ok: false, parked, drafts };

  const rec = parked.splice(idx, 1)[0];
  rec.draft = true;
  rec.scope = {
    level,
    outcomeId,
    canonical: typeof scope.canonical === 'boolean'
      ? scope.canonical
      : !!(rec.scope && rec.scope.canonical),
    // Prefer a supplied canonicalName, else preserve the parked record's.
    canonicalName: strOr(
      scope.canonicalName,
      rec.scope && typeof rec.scope === 'object' ? strOr(rec.scope.canonicalName, '') : '',
    ),
  };
  // Give the unparked draft the chosen outcome NAME (parked off-protocol stats carry an
  // empty outcome), so it is confirmable — the confirm gate requires a non-empty outcome.
  // Only overwrite when a real name is supplied; never erase an existing one.
  const nm = strOr(scope.name, '').trim() || strOr(scope.canonicalName, '').trim();
  if (nm) rec.outcome = nm;
  delete rec.parkedAt;
  drafts.push(rec);

  return { ok: true, parked, drafts };
}

/* ── 6. recordCompleteness ───────────────────────────────────────────────── */

/** The three value families a record can complete. */
const EFFECT_FIELDS = ['es', 'lo', 'hi'];
const DICHOTOMOUS_FIELDS = ['a', 'b', 'c', 'd'];
const CONTINUOUS_FIELDS = ['nExp', 'nCtrl', 'meanExp', 'sdExp', 'meanCtrl', 'sdCtrl'];

/**
 * recordCompleteness(record) — what the record still needs before analysis.
 *   hasEffect — es + lo + hi all present.
 *   hasRaw    — full dichotomous 2×2 (a,b,c,d) OR full continuous arm stats
 *               (nExp,nCtrl,meanExp,sdExp,meanCtrl,sdCtrl).
 *   missing   — for every family the record has STARTED (≥1 field filled) but
 *               not finished, the fields still empty (dichotomous, then
 *               continuous, then effect order). A record with NOTHING filled in
 *               any family reports the effect fields (the minimum viable input).
 *
 * @param {object} record
 * @returns {{ hasEffect: boolean, hasRaw: boolean, missing: string[] }}
 */
export function recordCompleteness(record) {
  const values = record && record.values && typeof record.values === 'object' ? record.values : {};

  const famState = (fields) => {
    const missing = fields.filter((f) => !isFilled(values[f]));
    return { complete: missing.length === 0, started: missing.length < fields.length, missing };
  };

  const dich = famState(DICHOTOMOUS_FIELDS);
  const cont = famState(CONTINUOUS_FIELDS);
  const eff = famState(EFFECT_FIELDS);

  const missing = [];
  for (const fam of [dich, cont, eff]) {
    if (fam.started && !fam.complete) missing.push(...fam.missing);
  }
  if (!dich.started && !cont.started && !eff.started) missing.push(...EFFECT_FIELDS);

  return {
    hasEffect: eff.complete,
    hasRaw: dich.complete || cont.complete,
    missing,
  };
}
