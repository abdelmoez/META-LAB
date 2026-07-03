/**
 * gradeService.js — P12. SERVER-side orchestration for the per-OUTCOME, audited,
 * lockable GRADE certainty-of-evidence layer + Summary-of-Findings export.
 *
 * This service NEVER re-implements GRADE logic. It:
 *   - enumerates a project's outcomes (getOutcomePairs on the project studies blob),
 *   - assembles the per-outcome inputs the pure engine needs — the pooled
 *     meta-analysis (runMeta), small-study test (eggersTest), and a RoB→GRADE
 *     summary (summariseRobForGrade) filtered to that outcome,
 *   - asks the pure engine (src/research-engine/grade) to SUGGEST domain ratings and
 *     compute the certainty level, and
 *   - persists a reviewer's confirmed assessment (GradeOutcomeAssessment) + an
 *     append-only audit trail (GradeAuditLog).
 *
 * PRODUCT RULES (enforced here):
 *   - Suggestions are NEVER auto-final. A domain rating is authoritative only once a
 *     human SAVES it (stored source:'manual'); engine suggestions are source:'auto'.
 *   - Every save / lock / unlock writes a GradeAuditLog row.
 *   - A LOCKED outcome rejects further writes until it is explicitly unlocked
 *     (lock is reversible and logged).
 *
 * The pure engine may not be present yet (it is built by a parallel workstream), so
 * it is loaded LAZILY and guarded: when absent, service calls throw a typed
 * `GRADE_ENGINE_UNAVAILABLE` error that the controller maps to HTTP 503. Importing
 * this module therefore never crashes the server, even before the engine ships.
 */
import { prisma } from '../db/client.js';
import { touchProjectActivity } from '../store.js';
import { runMeta, eggersTest } from '../../src/research-engine/statistics/meta-analysis.js';
import { getOutcomePairs, filterStudiesForOutcome } from '../../src/research-engine/import-export/journalSubmission.js';
import { summariseRobForGrade } from '../../src/research-engine/rob/gradeSync.js';
import { buildSummaryOfFindingsTable } from '../../src/research-engine/manuscript/tables.js';

// ── Lazy, guarded engine loader ───────────────────────────────────────────────
// The engine lives at src/research-engine/grade/index.js. It is imported lazily so
// this module (and the whole server) still boots when the engine has not shipped
// yet. On success the resolved module is cached; failures are NOT cached so a later
// deploy of the engine is picked up without a restart. A missing/partial engine
// throws the typed error below → controllers answer 503 GRADE_ENGINE_UNAVAILABLE.
let _engine = null;
export function engineUnavailable(detail) {
  const e = new Error(detail || 'GRADE engine unavailable');
  e.code = 'GRADE_ENGINE_UNAVAILABLE';
  return e;
}
export async function loadGradeEngine() {
  if (_engine) return _engine;
  let mod;
  try {
    mod = await import('../../src/research-engine/grade/index.js');
  } catch {
    throw engineUnavailable('GRADE engine module not found');
  }
  const eng = (mod && typeof mod.computeCertainty === 'function')
    ? mod
    : (mod && mod.default && typeof mod.default.computeCertainty === 'function' ? mod.default : null);
  if (!eng || typeof eng.suggestDomains !== 'function' || typeof eng.startLevelForDesign !== 'function') {
    throw engineUnavailable('GRADE engine is incomplete');
  }
  _engine = eng;
  return eng;
}

// ── Small measure metadata (self-contained; mirrors manuscript/tables.js) ──────
const MEASURE_KIND = {
  OR: 'ratio', RR: 'ratio', HR: 'ratio', DIAG: 'ratio',
  SMD: 'mean', MD: 'mean', COR: 'fisherz', PROP: 'prop',
};
function backTransform(x, kind) {
  if (x == null || !Number.isFinite(x)) return null;
  if (kind === 'ratio') return Math.exp(x);
  if (kind === 'fisherz') return Math.tanh(x);
  if (kind === 'prop') { const e = Math.exp(x); return e / (1 + e); }
  return x;
}
const numOr = (x) => (x === '' || x == null || isNaN(+x) ? null : +x);
function sampleSize(s) {
  const n = numOr(s.n);
  if (n) return n;
  const exp = numOr(s.nExp) || ((numOr(s.a) || 0) + (numOr(s.b) || 0)) || numOr(s.events);
  const ctrl = numOr(s.nCtrl) || ((numOr(s.c) || 0) + (numOr(s.d) || 0));
  const total = numOr(s.total);
  const sum = (exp || 0) + (ctrl || 0);
  return sum || total || null;
}
function participantTotal(subset) {
  const sizes = subset.map(sampleSize).filter((n) => n != null && n > 0);
  return { total: sizes.reduce((a, n) => a + n, 0), partial: sizes.length < subset.length };
}
/** Dominant study design across an outcome's studies (for start-level inference). */
function dominantDesign(subset) {
  const counts = {};
  for (const s of subset) {
    const d = String((s && s.design) || '').trim();
    if (d) counts[d] = (counts[d] || 0) + 1;
  }
  let best = '', bestN = 0;
  for (const [d, n] of Object.entries(counts)) if (n > bestN) { best = d; bestN = n; }
  return best;
}

// ── PURE helpers (no DB / no engine) — unit-tested directly ────────────────────

/**
 * A compact, UI-ready meta-analysis summary for one outcome. Ratio measures are
 * back-transformed for the `estimate`/`ci*` fields; raw log-scale values stay on
 * pES/lo95/hi95. Returns { pooled:false, … } (never throws) when < 2 studies.
 */
export function metaSummaryForOutcome(subset, model = 'random') {
  const list = Array.isArray(subset) ? subset : [];
  const esType = String((list.find((s) => s && s.esType)?.esType) || '').trim();
  const kind = MEASURE_KIND[esType] || 'mean';
  const { total: nParticipants, partial } = participantTotal(list);
  const res = list.length >= 2 ? runMeta(list, model === 'fixed' ? 'fixed' : 'random') : null;
  if (!res) {
    return {
      pooled: false, k: list.length, model, esType, kind,
      I2: null, i2Desc: null, pES: null, lo95: null, hi95: null, pval: null,
      estimate: null, ciLow: null, ciHigh: null, predInt: null,
      nParticipants, nParticipantsPartial: partial,
    };
  }
  const egg = eggersTest(list);
  return {
    pooled: true, k: res.k, model, esType, kind,
    I2: res.I2, i2Desc: res.I2desc,
    pES: res.pES, lo95: res.lo95, hi95: res.hi95, pval: res.pval,
    estimate: backTransform(res.pES, kind),
    ciLow: backTransform(res.lo95, kind),
    ciHigh: backTransform(res.hi95, kind),
    predInt: res.predInt ? { lo: backTransform(res.predInt.lo, kind), hi: backTransform(res.predInt.hi, kind) } : null,
    egger: egg ? { pval: egg.pval, k: egg.k, intercept: egg.intercept } : null,
    nParticipants, nParticipantsPartial: partial,
  };
}

/**
 * Best-effort filter of a project's RoB assessments down to one outcome. RoB
 * assessments carry a free-text `resultLabel` and optional `outcomeId`; when any
 * reference the outcome (by key, by name, or by label substring) that subset is
 * used, otherwise we fall back to the PROJECT-LEVEL set so the domain still gets a
 * sensible suggestion (transparently reflected in summariseRobForGrade's reason).
 * PURE.
 */
export function robForOutcome(allRob, pair) {
  const list = Array.isArray(allRob) ? allRob : [];
  const name = String((pair && pair.outcome) || '').trim().toLowerCase();
  const key = String((pair && pair.key) || '').trim().toLowerCase();
  const label = String((pair && pair.label) || '').trim().toLowerCase();
  if (!name && !key) return list;
  const matched = list.filter((a) => {
    const oid = String((a && a.outcomeId) || '').trim().toLowerCase();
    const rl = String((a && a.resultLabel) || '').trim().toLowerCase();
    if (oid && (oid === key || oid === name || oid === label)) return true;
    if (name && rl && rl.includes(name)) return true;
    return false;
  });
  return { list: matched.length ? matched : list, scoped: matched.length > 0 };
}

/** Domain ids the engine recognises (falls back to the canonical five). PURE.
 * The engine catalogues domains as { key, label, … } objects — so `.key` is read
 * first (with `.id` as a defensive fallback for any alternate engine shape). */
export function domainIdsFromEngine(engine) {
  const g = engine && engine.GRADE_DOMAINS;
  if (Array.isArray(g)) return g.map((d) => (typeof d === 'string' ? d : (d && (d.key || d.id)))).filter(Boolean);
  if (g && typeof g === 'object') return Object.keys(g);
  return ['rob', 'inconsistency', 'indirectness', 'imprecision', 'publicationBias'];
}

/** Valid rating strings the engine defines (empty Set → lenient). PURE. The engine
 * exposes GRADE_RATINGS as a registry keyed BY the rating name ({ serious: {…} }),
 * so the keys are the vocabulary; array/value-string shapes are also supported. */
export function ratingSetFromEngine(engine) {
  const out = new Set();
  const r = engine && engine.GRADE_RATINGS;
  const add = (x) => { if (typeof x === 'string' && x) out.add(x); else if (x && typeof x.value === 'string') out.add(x.value); };
  if (Array.isArray(r)) r.forEach(add);
  else if (r && typeof r === 'object') { Object.keys(r).forEach((k) => out.add(k)); Object.values(r).forEach(add); }
  return out;
}

/**
 * Normalise a client-supplied `domains` payload to the stored shape. Accepts either
 * `{ id: 'serious' }` or `{ id: { rating, note } }`; every provided domain is marked
 * source:'manual' (a human confirmed it). Invalid domain ids / ratings are dropped.
 * PURE.
 */
export function normalizeDomainsInput(domains, validIds, validRatings) {
  const out = {};
  if (!domains || typeof domains !== 'object') return out;
  const idOk = (id) => !Array.isArray(validIds) || validIds.length === 0 || validIds.includes(id);
  const rateOk = (r) => !(validRatings instanceof Set) || validRatings.size === 0 || validRatings.has(r);
  for (const [id, raw] of Object.entries(domains)) {
    if (!idOk(id)) continue;
    let rating = '', note = '';
    if (raw && typeof raw === 'object') { rating = String(raw.rating || '').trim(); note = String(raw.note || '').trim(); }
    else { rating = String(raw == null ? '' : raw).trim(); }
    if (!rating || !rateOk(rating)) continue;
    out[id] = { rating, source: 'manual', note: note.slice(0, 2000) };
  }
  return out;
}

// ── DB helpers ─────────────────────────────────────────────────────────────────
/** Load a project's RoB assessments in the {id,status,overall,outcomeId,resultLabel} shape. */
async function loadRobAssessments(projectId) {
  try {
    const rows = await prisma.robAssessment.findMany({
      where: { projectId, deletedAt: null },
      include: { overall: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((a) => {
      const ov = a.overall;
      const overall = ov ? ((ov.overridden && ov.finalOverall) ? ov.finalOverall : ov.proposedOverall) : null;
      return { id: a.id, status: a.status, overall, outcomeId: a.outcomeId, resultLabel: a.resultLabel, studyId: a.studyId };
    });
  } catch {
    return []; // RoB is optional — a project with no assessments simply has none
  }
}

async function getStoredRow(projectId, outcomeKey) {
  return prisma.gradeOutcomeAssessment.findUnique({
    where: { metaLabProjectId_outcomeKey: { metaLabProjectId: projectId, outcomeKey } },
  }).catch(() => null);
}

async function writeAudit(projectId, outcomeKey, action, before, after, user) {
  try {
    await prisma.gradeAuditLog.create({
      data: {
        metaLabProjectId: projectId,
        outcomeKey: outcomeKey || '',
        action,
        beforeJson: JSON.stringify(before ?? {}).slice(0, 8000),
        afterJson: JSON.stringify(after ?? {}).slice(0, 8000),
        changedById: user?.id || null,
        changedByName: user?.name || user?.email || null,
      },
    });
  } catch { /* audit is best-effort — never fails the action */ }
}

// ── Assembly ────────────────────────────────────────────────────────────────────
function parseJson(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

function certaintyLabel(level, engine) {
  const raw = String(level == null ? '' : level).trim();
  if (!raw) return '';
  const cl = engine && engine.CERTAINTY_LEVELS;
  // CERTAINTY_LEVELS is an array of { numeric, key, label } — match on any of them
  // (the stored value may be a levelKey like "moderate", a label like "Moderate",
  // or a numeric string) so the human label is always resolved.
  const eq = (x) => x && (x.key === raw || x.label === raw || x.value === raw || x.id === raw || x.level === raw || String(x.numeric) === raw);
  let hit = null;
  if (Array.isArray(cl)) hit = cl.find(eq);
  else if (cl && typeof cl === 'object') hit = cl[raw];
  if (hit && typeof hit === 'object' && (hit.label || hit.name)) return hit.label || hit.name;
  if (typeof hit === 'string') return hit;
  // e.g. "very_low" → "Very low"
  return raw.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function storedRowDTO(row, engine) {
  if (!row) return null;
  return {
    outcomeKey: row.outcomeKey,
    outcomeLabel: row.outcomeLabel,
    startLevel: row.startLevel,
    startLevelSource: row.startLevelSource,
    domains: parseJson(row.domainsJson, {}),
    suggestionsSnapshot: parseJson(row.suggestionsJson, {}),
    certaintyLevel: row.certaintyLevel,
    certaintyLabel: certaintyLabel(row.certaintyLevel, engine),
    certaintyNumeric: row.certaintyNumeric,
    robSignature: row.robSignature,
    locked: !!row.locked,
    lockedBy: row.lockedById ? { id: row.lockedById, name: row.lockedByName || '' } : null,
    lockedAt: row.lockedAt,
    notes: row.notes || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Build the full per-outcome DTO the API returns and the SoF/engine consume.
 * `engine`, `allRob` and `pico` are passed in so a whole-project list assembles them
 * once. When `storedRow` exists its manual domains win over the (auto) suggestions.
 */
function assembleOutcome({ project, pair, allRob, storedRow, engine, model }) {
  const studies = Array.isArray(project.studies) ? project.studies : [];
  const subset = filterStudiesForOutcome(studies, pair);
  const meta = metaSummaryForOutcome(subset, model);
  const robPick = robForOutcome(allRob, pair);
  const robSummary = summariseRobForGrade(robPick.list);
  const pico = (project && project.pico) || {};
  const designOrPico = { ...pico, studyDesign: pico.studyDesign, design: dominantDesign(subset), designs: subset.map((s) => (s && s.design) || '') };

  // Engine suggestions (guarded — a throwing engine call degrades to empty).
  let suggestions = {};
  try { suggestions = engine.suggestDomains({ robSummary, meta, pico, design: designOrPico }) || {}; } catch { suggestions = {}; }

  // Start level: stored (reviewer-confirmed) wins, else engine inference.
  let startLevel;
  try { startLevel = engine.startLevelForDesign(designOrPico) || {}; } catch { startLevel = {}; }
  const startNumeric = storedRow ? storedRow.startLevel : (Number.isFinite(startLevel.numeric) ? startLevel.numeric : 4);
  const startLabelText = startLevel.label || '';

  const validIds = domainIdsFromEngine(engine);
  const storedDomains = storedRow ? parseJson(storedRow.domainsJson, {}) : {};

  // Effective per-domain rating: stored manual value wins; else the auto suggestion.
  const effective = {};
  const ratingsMap = {};
  for (const id of validIds) {
    const sd = storedDomains[id];
    const sg = suggestions[id];
    if (sd && sd.rating) {
      effective[id] = { rating: sd.rating, source: sd.source || 'manual', note: sd.note || '', reason: sg ? sg.reason : '' };
      ratingsMap[id] = sd.rating;
    } else if (sg && sg.suggest) {
      effective[id] = { rating: sg.suggest, source: 'auto', reason: sg.reason || '', note: '' };
      ratingsMap[id] = sg.suggest;
    } else {
      effective[id] = { rating: '', source: 'auto', reason: sg ? sg.reason || '' : '', note: '' };
    }
  }

  // Certainty (guarded).
  let certainty = null;
  try { certainty = engine.computeCertainty({ startLevel: startNumeric, domains: ratingsMap }) || null; } catch { certainty = null; }
  const level = certainty ? (certainty.level != null ? certainty.level : '') : (storedRow ? storedRow.certaintyLevel : '');

  return {
    outcomeKey: pair.key,
    outcomeLabel: pair.label,
    outcome: pair.outcome,
    timepoint: pair.timepoint,
    esType: pair.esType,
    meta,
    robSummary,
    robScoped: robPick.scoped,
    robSignature: robSummary.signature,
    startLevel: { numeric: startNumeric, label: startLabelText || startLevel.label || '' },
    suggestions,
    domains: effective,       // rating + source + reason per domain (UI-ready)
    ratings: ratingsMap,      // { id: rating } — what the engine scored
    certainty: certainty || { level, numeric: storedRow ? storedRow.certaintyNumeric : null, startLevel: startNumeric, modifiersApplied: [] },
    certaintyLabel: certaintyLabel(level, engine),
    confirmed: !!storedRow,   // false until a human has saved this outcome
    locked: storedRow ? !!storedRow.locked : false,
    assessment: storedRowDTO(storedRow, engine),
  };
}

// ── Public service API ────────────────────────────────────────────────────────

/** List every outcome with its meta summary, suggestions, and stored assessment. */
export async function listOutcomes(project, { model = 'random' } = {}) {
  const engine = await loadGradeEngine();
  const studies = Array.isArray(project.studies) ? project.studies : [];
  const pairs = getOutcomePairs(studies);
  const allRob = await loadRobAssessments(project.id);
  const rows = await prisma.gradeOutcomeAssessment.findMany({ where: { metaLabProjectId: project.id } }).catch(() => []);
  const byKey = new Map(rows.map((r) => [r.outcomeKey, r]));
  const outcomes = pairs.map((pair) => assembleOutcome({ project, pair, allRob, storedRow: byKey.get(pair.key) || null, engine, model }));
  return { outcomes, count: outcomes.length };
}

/** Single outcome by key. Falls back to a stored-only view if the outcome no longer has studies. */
export async function getOutcome(project, outcomeKey, { model = 'random' } = {}) {
  const engine = await loadGradeEngine();
  const studies = Array.isArray(project.studies) ? project.studies : [];
  const pair = getOutcomePairs(studies).find((p) => p.key === outcomeKey);
  const allRob = await loadRobAssessments(project.id);
  const storedRow = await getStoredRow(project.id, outcomeKey);
  if (!pair) {
    if (!storedRow) return null;
    // Outcome no longer present in studies — return the stored assessment as-is.
    return {
      outcomeKey, outcomeLabel: storedRow.outcomeLabel, meta: metaSummaryForOutcome([], model),
      robSummary: summariseRobForGrade([]), suggestions: {}, domains: parseJson(storedRow.domainsJson, {}),
      startLevel: { numeric: storedRow.startLevel, label: '' },
      certainty: { level: storedRow.certaintyLevel, numeric: storedRow.certaintyNumeric, startLevel: storedRow.startLevel, modifiersApplied: [] },
      certaintyLabel: certaintyLabel(storedRow.certaintyLevel, engine),
      confirmed: true, locked: !!storedRow.locked, assessment: storedRowDTO(storedRow, engine), orphaned: true,
    };
  }
  return assembleOutcome({ project, pair, allRob, storedRow, engine, model });
}

/**
 * Save (upsert) a reviewer's domain ratings for one outcome. Recomputes the
 * certainty via the engine, snapshots the current suggestions + RoB signature,
 * writes an audit row, and refuses to write when the outcome is LOCKED.
 * `payload`: { domains, notes?, startLevel? }.
 */
export async function saveOutcome(project, outcomeKey, payload, user, { model = 'random' } = {}) {
  const engine = await loadGradeEngine();
  const existing = await getStoredRow(project.id, outcomeKey);
  if (existing && existing.locked) {
    const err = new Error('This outcome is locked. Unlock it before making changes.');
    err.code = 'GRADE_LOCKED';
    throw err;
  }

  const studies = Array.isArray(project.studies) ? project.studies : [];
  const pair = getOutcomePairs(studies).find((p) => p.key === outcomeKey)
    || { key: outcomeKey, outcome: '', timepoint: '', esType: '', label: (payload && payload.label) || existing?.outcomeLabel || outcomeKey };
  const subset = filterStudiesForOutcome(studies, pair);
  const allRob = await loadRobAssessments(project.id);
  const robPick = robForOutcome(allRob, pair);
  const robSummary = summariseRobForGrade(robPick.list);
  const pico = (project && project.pico) || {};
  const designOrPico = { ...pico, studyDesign: pico.studyDesign, design: dominantDesign(subset), designs: subset.map((s) => (s && s.design) || '') };
  const meta = metaSummaryForOutcome(subset, model);

  const validIds = domainIdsFromEngine(engine);
  const validRatings = ratingSetFromEngine(engine);

  // Merge the reviewer's (manual) domains over any prior stored domains.
  const prior = existing ? parseJson(existing.domainsJson, {}) : {};
  const incoming = normalizeDomainsInput(payload && payload.domains, validIds, validRatings);
  const mergedDomains = { ...prior, ...incoming };
  const ratingsMap = {};
  for (const [id, v] of Object.entries(mergedDomains)) if (v && v.rating) ratingsMap[id] = v.rating;

  // Start level: explicit override wins (source:'manual'), else engine inference.
  let startNumeric, startSource;
  const provided = payload && Number(payload.startLevel);
  if (Number.isFinite(provided) && provided >= 1 && provided <= 4) { startNumeric = Math.round(provided); startSource = 'manual'; }
  else {
    let sl = {};
    try { sl = engine.startLevelForDesign(designOrPico) || {}; } catch { sl = {}; }
    startNumeric = Number.isFinite(sl.numeric) ? sl.numeric : (existing ? existing.startLevel : 4);
    startSource = sl.label ? `design:${sl.label}` : (existing ? existing.startLevelSource : 'design');
  }

  let certainty = null;
  try { certainty = engine.computeCertainty({ startLevel: startNumeric, domains: ratingsMap }) || null; } catch { certainty = null; }
  let suggestions = {};
  try { suggestions = engine.suggestDomains({ robSummary, meta, pico, design: designOrPico }) || {}; } catch { suggestions = {}; }

  const before = existing ? storedRowDTO(existing, engine) : null;
  const data = {
    metaLabProjectId: project.id,
    outcomeKey,
    outcomeLabel: pair.label || existing?.outcomeLabel || outcomeKey,
    startLevel: startNumeric,
    startLevelSource: startSource,
    domainsJson: JSON.stringify(mergedDomains),
    suggestionsJson: JSON.stringify(suggestions),
    // Store the stable level KEY ('moderate') when available (falls back to the label).
    certaintyLevel: certainty ? String(certainty.levelKey != null ? certainty.levelKey : (certainty.level != null ? certainty.level : '')) : '',
    certaintyNumeric: certainty && Number.isFinite(certainty.numeric) ? Math.round(certainty.numeric) : null,
    robSignature: robSummary.signature,
    notes: payload && payload.notes != null ? String(payload.notes).slice(0, 4000) : (existing ? existing.notes : ''),
  };

  const saved = await prisma.gradeOutcomeAssessment.upsert({
    where: { metaLabProjectId_outcomeKey: { metaLabProjectId: project.id, outcomeKey } },
    update: data,
    create: data,
  });

  await writeAudit(project.id, outcomeKey, 'SAVE', before, storedRowDTO(saved, engine), user);
  void touchProjectActivity(project.id);
  return getOutcome(project, outcomeKey, { model });
}

/** Lock an outcome (leader/owner). Requires a saved assessment. Reversible + logged. */
export async function lockOutcome(project, outcomeKey, user) {
  const engine = await loadGradeEngine();
  const existing = await getStoredRow(project.id, outcomeKey);
  if (!existing) {
    const err = new Error('Save the GRADE assessment before locking it.');
    err.code = 'GRADE_NOT_SAVED';
    throw err;
  }
  if (existing.locked) return getOutcome(project, outcomeKey);
  const before = storedRowDTO(existing, engine);
  const saved = await prisma.gradeOutcomeAssessment.update({
    where: { id: existing.id },
    data: { locked: true, lockedById: user?.id || null, lockedByName: user?.name || user?.email || null, lockedAt: new Date() },
  });
  await writeAudit(project.id, outcomeKey, 'LOCK', before, storedRowDTO(saved, engine), user);
  void touchProjectActivity(project.id);
  return getOutcome(project, outcomeKey);
}

/** Unlock an outcome (leader/owner). Logged. */
export async function unlockOutcome(project, outcomeKey, user) {
  const engine = await loadGradeEngine();
  const existing = await getStoredRow(project.id, outcomeKey);
  if (!existing) {
    const err = new Error('No saved GRADE assessment for this outcome.');
    err.code = 'GRADE_NOT_SAVED';
    throw err;
  }
  if (!existing.locked) return getOutcome(project, outcomeKey);
  const before = storedRowDTO(existing, engine);
  const saved = await prisma.gradeOutcomeAssessment.update({
    where: { id: existing.id },
    data: { locked: false, lockedById: null, lockedByName: null, lockedAt: null },
  });
  await writeAudit(project.id, outcomeKey, 'UNLOCK', before, storedRowDTO(saved, engine), user);
  void touchProjectActivity(project.id);
  return getOutcome(project, outcomeKey);
}

/** Full audit history for a project (newest first). */
export async function getAudit(projectId, { limit = 500 } = {}) {
  const rows = await prisma.gradeAuditLog.findMany({
    where: { metaLabProjectId: projectId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(2000, Math.max(1, limit)),
  }).catch(() => []);
  return rows.map((r) => ({
    id: r.id, outcomeKey: r.outcomeKey, action: r.action,
    before: parseJson(r.beforeJson, null), after: parseJson(r.afterJson, null),
    changedBy: r.changedById ? { id: r.changedById, name: r.changedByName || '' } : null,
    createdAt: r.createdAt,
  }));
}

// ── Summary of Findings ─────────────────────────────────────────────────────────
function csvEsc(v) {
  const t = String(v == null ? '' : v).replace(/"/g, '""');
  return /[",\n]/.test(t) ? `"${t}"` : t;
}
function htmlEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** SoF table + footnotes → CSV (UTF-8 BOM). PURE. */
export function sofToCsv(table, footnotes) {
  const cols = table.columns || [];
  const header = cols.map((c) => csvEsc(c.label)).join(',');
  const rows = (table.rows || []).map((r) => cols.map((c) => csvEsc(r[c.key])).join(','));
  const out = [header, ...rows];
  const fns = footnotes || [];
  if (fns.length) {
    out.push('');
    out.push(csvEsc('Footnotes'));
    for (const f of fns) out.push(csvEsc(`${f.marker ? f.marker + ' ' : ''}${f.outcome ? f.outcome + ': ' : ''}${f.text}`));
  }
  return '﻿' + out.join('\n');
}

/** SoF table + footnotes → standalone HTML fragment. PURE. */
export function sofToHtml(table, footnotes, { title = 'Summary of findings' } = {}) {
  const cols = table.columns || [];
  const head = cols.map((c) => `<th>${htmlEsc(c.label)}</th>`).join('');
  const body = (table.rows || []).map((r) => `<tr>${cols.map((c) => `<td>${htmlEsc(r[c.key] || '')}</td>`).join('')}</tr>`).join('');
  const fns = (footnotes || []).map((f) => `<li>${f.marker ? `<strong>${htmlEsc(f.marker)}</strong> ` : ''}${f.outcome ? `${htmlEsc(f.outcome)}: ` : ''}${htmlEsc(f.text)}</li>`).join('');
  return [
    `<section class="sof-table">`,
    `<h3>${htmlEsc(title)}</h3>`,
    `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    table.note ? `<p class="sof-note">${htmlEsc(table.note)}</p>` : '',
    fns ? `<div class="sof-footnotes"><p><strong>Footnotes</strong></p><ol>${fns}</ol></div>` : '',
    `</section>`,
  ].filter(Boolean).join('\n');
}

/**
 * Build a Summary-of-Findings table for the whole project + GRADE certainty per
 * outcome + explanatory footnotes, in the requested format (json | csv | html).
 * Reuses the manuscript SoF builder (one source of truth for the table shape).
 */
export async function buildSof(project, { format = 'json', model = 'random' } = {}) {
  const engine = await loadGradeEngine();
  const studies = Array.isArray(project.studies) ? project.studies : [];
  const pairs = getOutcomePairs(studies);
  const allRob = await loadRobAssessments(project.id);
  const rows = await prisma.gradeOutcomeAssessment.findMany({ where: { metaLabProjectId: project.id } }).catch(() => []);
  const byKey = new Map(rows.map((r) => [r.outcomeKey, r]));

  const assessments = pairs.map((pair) => assembleOutcome({ project, pair, allRob, storedRow: byKey.get(pair.key) || null, engine, model }));

  // Shape each DTO into the engine's assessment contract for buildGradeByOutcome:
  //  - `startLevel` as a design-family descriptor ('observational' | 'randomized')
  //    so startLevelForDesign resolves the SAME numeric the per-outcome view used
  //    (the engine's start model is 4=RCT / 2=observational);
  //  - `domains` as a clean { key: ratingString } map;
  //  - `reasons` from each domain's stored note or suggestion reason (→ footnotes).
  const engineAssessments = assessments.map((a) => {
    const reasons = {};
    for (const [k, v] of Object.entries(a.domains || {})) { const r = (v && (v.note || v.reason)) || ''; if (r) reasons[k] = r; }
    return {
      key: a.outcomeKey,
      outcomeKey: a.outcomeKey,
      label: a.outcomeLabel,
      startLevel: (a.startLevel && Number(a.startLevel.numeric) <= 2) ? 'observational' : 'randomized',
      domains: a.ratings,
      reasons,
    };
  });

  // Engine → { [key]: { certainty, footnotes } } (guarded; falls back to DTO values).
  let gradeMap = {};
  try { if (typeof engine.buildGradeByOutcome === 'function') gradeMap = engine.buildGradeByOutcome(engineAssessments) || {}; } catch { gradeMap = {}; }

  const gradeByOutcome = {};        // { key: certaintyLabelString } for the SoF table cell
  const footnotes = [];
  let fnIndex = 0;
  for (const a of assessments) {
    const g = gradeMap[a.outcomeKey];
    const levelRaw = g && g.certainty != null ? (typeof g.certainty === 'object' ? g.certainty.level : g.certainty) : a.certainty.level;
    gradeByOutcome[a.outcomeKey] = certaintyLabel(levelRaw, engine);
    // Footnotes: prefer engine footnotes; else derive from the engine's per-assessment helper.
    let fns = (g && Array.isArray(g.footnotes)) ? g.footnotes : null;
    if (!fns && typeof engine.gradeFootnotes === 'function') {
      const ea = engineAssessments.find((e) => e.outcomeKey === a.outcomeKey) || a;
      try { fns = engine.gradeFootnotes(ea) || []; } catch { fns = []; }
    }
    for (const text of (fns || [])) {
      fnIndex += 1;
      footnotes.push({ marker: `${fnIndex}`, outcome: a.outcomeLabel, text: String(text) });
    }
    if (!a.confirmed) {
      fnIndex += 1;
      footnotes.push({ marker: `${fnIndex}`, outcome: a.outcomeLabel, text: 'Provisional certainty — the domain ratings are engine suggestions not yet confirmed by a reviewer.' });
    }
  }

  const table = buildSummaryOfFindingsTable(project, { runMeta, model, gradeByOutcome });
  // Ensure the certainty column is present even if every cell is blank (P12 always
  // reports certainty), so the exported SoF has an explicit GRADE column.
  if (!table.columns.some((c) => c.key === 'certainty')) table.columns.push({ key: 'certainty', label: 'Certainty (GRADE)' });

  if (format === 'csv') return { format: 'csv', mime: 'text/csv', content: sofToCsv(table, footnotes) };
  if (format === 'html') return { format: 'html', mime: 'text/html', content: sofToHtml(table, footnotes, { title: table.title || 'Summary of findings' }) };
  return {
    format: 'json',
    table,
    gradeByOutcome,
    footnotes,
    outcomes: assessments.map((a) => ({
      outcomeKey: a.outcomeKey, outcomeLabel: a.outcomeLabel,
      certainty: a.certainty, certaintyLabel: a.certaintyLabel, confirmed: a.confirmed, locked: a.locked,
    })),
    generatedAt: new Date().toISOString(),
  };
}

export default {
  loadGradeEngine, listOutcomes, getOutcome, saveOutcome, lockOutcome, unlockOutcome, getAudit, buildSof,
  metaSummaryForOutcome, robForOutcome, normalizeDomainsInput, domainIdsFromEngine, ratingSetFromEngine, sofToCsv, sofToHtml,
};
