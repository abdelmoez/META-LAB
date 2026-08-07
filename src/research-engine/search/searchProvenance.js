/**
 * search/searchProvenance.js — 101.md §1/§2. The single honest answer to two
 * questions the manuscript is not allowed to guess:
 *
 *   1. WHICH databases were actually searched?
 *   2. WHEN was the most recent VALID search?
 *
 * 101.md §1 forbids deriving either from a settings page ("If a database was
 * configured but never actually searched, it should not be represented as though
 * it had been searched"), and §17 makes that a hard scientific rule. So this module
 * consumes EXECUTION records — per-provider `PecanSearchSource` rows for automated
 * runs and import batches / record source attribution for manual searches — and
 * classifies each database into one of the §1 provenance states.
 *
 * It deliberately does NOT read `project.search.dbs` (the checkbox list). The
 * caller may pass the configured list separately as `configured` so a database
 * that was selected but never run is still VISIBLE to the UI — reported with
 * status 'configured', which `reportableDatabases()` then excludes from anything
 * the manuscript states.
 *
 * Pure — no DOM/React/network/Date/Prisma. Timestamps arrive as ISO strings or
 * Date-likes and are compared lexicographically after normalization, so the same
 * inputs always produce the same output (testable, citable).
 */

import { classifySource } from '../screening/sourceClassify.js';

/* ════════════ provenance states (101.md §1) ════════════ */

/**
 * The states a database can be in. Ordered by "evidential strength" — when the
 * same database appears more than once (an automated run AND a manual import,
 * or a failed attempt followed by a successful one) the STRONGEST state wins,
 * because a later success genuinely supersedes an earlier failure.
 *
 * `invalidated` outranks `failed`/`attempted` (it describes a search that really
 * ran, which is more informative) but stays BELOW every reportable state, so a
 * later valid re-run correctly supersedes a rolled-back one.
 */
export const DB_STATES = Object.freeze({
  configured: 0,   // selected in settings, never attempted
  attempted: 1,    // started but never reached a terminal state
  failed: 2,       // reached a terminal error
  invalidated: 3,  // genuinely searched, then rolled back — records no longer in the review
  zero_results: 4, // executed successfully, returned no records
  imported: 5,     // records arrived by manual import attributed to this database
  completed: 6,    // executed successfully and returned records
});

export const DB_STATE_IDS = Object.keys(DB_STATES);

/** Human labels — used by the Search provenance UI and the provenance hover card. */
export const DB_STATE_LABELS = Object.freeze({
  invalidated: 'Removed / invalidated',
  configured: 'Configured, not searched',
  attempted: 'Search attempted',
  failed: 'Search failed',
  zero_results: 'Searched — no records',
  imported: 'Manually imported',
  completed: 'Searched',
});

/**
 * The states the manuscript may honestly describe as "we searched this database".
 * A zero-result search IS a real search (and must be reported — PRISMA requires
 * it); a configured/attempted/failed/invalidated one is NOT.
 */
export const REPORTABLE_STATES = Object.freeze(['completed', 'zero_results', 'imported']);

/** Did this database genuinely contribute a completed search? Pure. */
export function isReportable(state) {
  return REPORTABLE_STATES.includes(state);
}

/** Rank helper — higher wins when the same database has several records. */
function rank(state) {
  const r = DB_STATES[state];
  return r == null ? -1 : r;
}

/* ════════════ database identity ════════════ */

/**
 * Canonical database keys. Provider ids (automated connectors) and free-text
 * `sourceDb` values (manual imports) must collapse onto the SAME key or the
 * manuscript would double-count "PubMed" and "pubmed" as two databases.
 *
 * Only well-known aliases are folded; anything unrecognised keeps its own trimmed,
 * lower-cased identity (honest — never guessed into a neighbour).
 */
const CANONICAL_ALIASES = Object.freeze({
  pubmed: 'pubmed',
  'pubmed/medline': 'pubmed',
  medline: 'medline',
  'medline (ovid)': 'medline',
  'ovid medline': 'medline',
  embase: 'embase',
  'embase (ovid)': 'embase',
  'embase (elsevier)': 'embase',
  scopus: 'scopus',
  'web of science': 'webofscience',
  'web of science core collection': 'webofscience',
  wos: 'webofscience',
  webofscience: 'webofscience',
  cochrane: 'central',
  central: 'central',
  'cochrane central': 'central',
  'cochrane central register of controlled trials': 'central',
  cdsr: 'cdsr',
  cinahl: 'cinahl',
  psycinfo: 'psycinfo',
  europepmc: 'europepmc',
  'europe pmc': 'europepmc',
  epmc: 'europepmc',
  pmc: 'pmc',
  clinicaltrials: 'clinicaltrials',
  'clinicaltrials.gov': 'clinicaltrials',
  ictrp: 'ictrp',
  'who ictrp': 'ictrp',
  openalex: 'openalex',
  crossref: 'crossref',
  doaj: 'doaj',
  semanticscholar: 'semanticscholar',
  'semantic scholar': 'semanticscholar',
  lilacs: 'lilacs',
  scielo: 'scielo',
  base: 'base',
  core: 'core',
  lens: 'lens',
  'the lens': 'lens',
});

/** Fold a provider id or free-text source name onto a canonical database key. Pure. */
export function canonicalDbKey(name) {
  const s = String(name == null ? '' : name).trim().toLowerCase();
  if (!s) return '';
  if (CANONICAL_ALIASES[s]) return CANONICAL_ALIASES[s];
  // Strip a trailing platform qualifier — "Embase (Ovid)" → "embase" — but only
  // when the stripped stem is itself a known alias (never invent a fold).
  const stem = s.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
  if (stem && CANONICAL_ALIASES[stem]) return CANONICAL_ALIASES[stem];
  return s;
}

/**
 * Display labels. Extends the Search-Builder catalogue vocabulary
 * (searchBuilder/methodsText.js DB_LABELS) with the canonical keys this module
 * emits, so the manuscript and the Search Engine name databases identically.
 */
const DB_LABELS = Object.freeze({
  pubmed: 'PubMed',
  medline: 'MEDLINE',
  embase: 'Embase',
  central: 'the Cochrane Central Register of Controlled Trials (CENTRAL)',
  cdsr: 'the Cochrane Database of Systematic Reviews (CDSR)',
  scopus: 'Scopus',
  webofscience: 'Web of Science',
  cinahl: 'CINAHL',
  psycinfo: 'PsycINFO',
  clinicaltrials: 'ClinicalTrials.gov',
  ictrp: 'the WHO ICTRP',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  core: 'CORE',
  doaj: 'the Directory of Open Access Journals (DOAJ)',
  europepmc: 'Europe PMC',
  pmc: 'PubMed Central (PMC)',
  semanticscholar: 'Semantic Scholar',
  lens: 'The Lens',
  base: 'BASE',
  lilacs: 'LILACS',
  scielo: 'SciELO',
});

/** Human label for a canonical key; unknown keys keep the caller's own text. Pure. */
export function dbLabel(key, fallback) {
  const k = canonicalDbKey(key);
  if (DB_LABELS[k]) return DB_LABELS[k];
  const raw = String(fallback == null ? key : fallback).trim();
  return raw || k;
}

/**
 * PRISMA 2020 identification kind for a KNOWN canonical key. Explicit, because
 * classifying the display LABEL would misfile CENTRAL ("…Register of Controlled
 * Trials…") as a trial register when PRISMA counts it as a bibliographic
 * database. Unknown keys fall back to the shared free-text classifier.
 */
const DB_KINDS = Object.freeze({
  pubmed: 'database', medline: 'database', embase: 'database', scopus: 'database',
  webofscience: 'database', central: 'database', cdsr: 'database', cinahl: 'database',
  psycinfo: 'database', europepmc: 'database', pmc: 'database', openalex: 'database',
  crossref: 'database', doaj: 'database', semanticscholar: 'database', lens: 'database',
  base: 'database', core: 'database', lilacs: 'database', scielo: 'database',
  clinicaltrials: 'register', ictrp: 'register',
});

/** 'database' | 'register' | 'other' for a database key (raw name as fallback). Pure. */
export function dbKind(key, rawName) {
  const k = canonicalDbKey(key);
  if (DB_KINDS[k]) return DB_KINDS[k];
  return classifySource(rawName == null ? key : rawName);
}

/* ════════════ timestamps ════════════ */

/** Normalize a Date | ISO string | null to a comparable ISO string (or ''). Pure. */
export function isoOf(v) {
  if (!v) return '';
  if (typeof v === 'string') {
    // Already ISO-ish → keep verbatim so no timezone re-interpretation occurs.
    return /^\d{4}-\d{2}-\d{2}/.test(v) ? v : '';
  }
  if (typeof v.toISOString === 'function') {
    try { return v.toISOString(); } catch { return ''; }
  }
  return '';
}

/** The later of two normalized ISO strings ('' loses to anything). Pure. */
function laterIso(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return a >= b ? a : b;
}

/* ════════════ the derivation ════════════ */

/**
 * Map one automated `PecanSearchSource` row (+ its run) to a provenance state.
 * The run's rolledBackAt dominates everything — a rolled-back import means those
 * records are no longer part of the review, so the search must not be reported.
 */
function stateOfAutomatedSource(source, run) {
  if (run && run.rolledBackAt) return 'invalidated';
  const st = String((source && source.state) || '').toLowerCase();
  if (st === 'failed') return 'failed';
  if (st === 'cancelled') return 'attempted';
  if (st === 'skipped') return 'configured';
  if (st === 'pending') return 'configured';
  if (st === 'running') return 'attempted';
  if (st === 'completed' || st === 'partial') {
    const raw = Number(source && source.rawCount);
    // A completed source that retrieved nothing is a genuine zero-result search —
    // reportable, and PRISMA requires it to be visible.
    return Number.isFinite(raw) && raw <= 0 ? 'zero_results' : 'completed';
  }
  // Unknown/blank state with a completion stamp still counts as attempted, never
  // as completed — we do not upgrade on missing information (§17).
  return source && source.startedAt ? 'attempted' : 'configured';
}

/**
 * deriveSearchProvenance(input) — the honest per-database provenance record.
 *
 * @param {object} input
 *   runs        [{ id, state, rolledBackAt, completedAt, createdAt, origin, name,
 *                  sources: [{ provider, state, rawCount, importedCount,
 *                              completedAt, startedAt, errorClass, errorDetail }] }]
 *               automated executions (PecanSearchRun + PecanSearchSource).
 *   imports     [{ id, source, filename, createdAt, recordCount, databases:[{name,count}] }]
 *               manual/file import batches. `databases` is the per-batch breakdown of
 *               ScreenRecord.sourceDb — the only honest attribution a file import has.
 *   configured  string[] database ids selected in project settings (NEVER reported
 *               on their own; present only so the UI can show "configured, not searched").
 *
 * @returns {{
 *   databases: Array<{ key, label, state, stateLabel, reportable, method,
 *                      lastSearchedAt, recordCount, runIds:string[], batchIds:string[],
 *                      error:string|null, kind:'database'|'register'|'other' }>,
 *   reportable: Array<same>,            // only genuinely-searched databases, label-sorted
 *   latestValidSearchAt: string,        // '' when nothing has been validly searched
 *   latestValidSource: object|null,     // which database set that date (provenance for §9)
 *   counts: { configured, searched, failed, invalidated, zeroResult },
 * }}
 */
export function deriveSearchProvenance(input = {}) {
  const runs = Array.isArray(input.runs) ? input.runs : [];
  const imports = Array.isArray(input.imports) ? input.imports : [];
  const configured = Array.isArray(input.configured) ? input.configured : [];

  /** key → accumulating record */
  const byKey = new Map();

  const touch = (rawName) => {
    const key = canonicalDbKey(rawName);
    if (!key) return null;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        label: dbLabel(key, rawName),
        state: 'configured',
        method: '',
        lastSearchedAt: '',
        recordCount: 0,
        runIds: [],
        batchIds: [],
        error: null,
        kind: dbKind(key, rawName),
      });
    }
    return byKey.get(key);
  };

  // Configured-but-never-run databases exist only so the UI can say so.
  for (const db of configured) touch(db);

  // ── automated executions ───────────────────────────────────────────────────
  for (const run of runs) {
    const sources = Array.isArray(run && run.sources) ? run.sources : [];
    for (const src of sources) {
      const rec = touch(src && src.provider);
      if (!rec) continue;
      const state = stateOfAutomatedSource(src, run);
      if (rank(state) > rank(rec.state)) {
        rec.state = state;
        rec.error = state === 'failed'
          ? (String((src && src.errorDetail) || (src && src.errorClass) || '').trim() || null)
          : null;
      }
      if (!rec.runIds.includes(run.id) && run.id) rec.runIds.push(run.id);
      if (isReportable(state)) {
        rec.method = rec.method === 'manual' ? 'mixed' : (rec.method || 'automated');
        rec.lastSearchedAt = laterIso(
          rec.lastSearchedAt,
          isoOf((src && src.completedAt) || (run && run.completedAt) || null),
        );
        const imported = Number(src && src.importedCount);
        if (Number.isFinite(imported) && imported > 0) rec.recordCount += imported;
      }
    }
  }

  // ── manual / file imports ──────────────────────────────────────────────────
  // A file import's only honest database attribution is the per-record `sourceDb`
  // the parser read out of the file. A batch whose records carry no source at all
  // cannot be attributed to any database and is intentionally dropped here — the
  // records still count in PRISMA, they just cannot name a database (§17).
  for (const batch of imports) {
    const at = isoOf(batch && batch.createdAt);
    const dbs = Array.isArray(batch && batch.databases) ? batch.databases : [];
    for (const d of dbs) {
      const rec = touch(d && d.name);
      if (!rec) continue;
      if (rank('imported') > rank(rec.state)) rec.state = 'imported';
      if (batch.id && !rec.batchIds.includes(batch.id)) rec.batchIds.push(batch.id);
      rec.method = rec.method && rec.method !== 'manual' ? 'mixed' : 'manual';
      rec.lastSearchedAt = laterIso(rec.lastSearchedAt, at);
      const n = Number(d && d.count);
      if (Number.isFinite(n) && n > 0) rec.recordCount += n;
    }
  }

  const databases = Array.from(byKey.values()).map((r) => ({
    ...r,
    stateLabel: DB_STATE_LABELS[r.state] || r.state,
    reportable: isReportable(r.state),
    method: r.method || (r.state === 'configured' ? '' : 'automated'),
  }));

  // Stable, human order: reportable first, then by label (locale-free compare so
  // the same project renders identically on every machine).
  databases.sort((a, b) => (Number(b.reportable) - Number(a.reportable))
    || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  const reportable = databases.filter((d) => d.reportable);

  // §2 — the most recent VALID search date. Only reportable databases can set it,
  // so a failed retry or a rolled-back run can never move the manuscript's date.
  let latestValidSearchAt = '';
  let latestValidSource = null;
  for (const d of reportable) {
    if (d.lastSearchedAt && d.lastSearchedAt > latestValidSearchAt) {
      latestValidSearchAt = d.lastSearchedAt;
      latestValidSource = d;
    }
  }

  return {
    databases,
    reportable,
    latestValidSearchAt,
    latestValidSource,
    counts: {
      configured: databases.filter((d) => d.state === 'configured').length,
      searched: reportable.length,
      failed: databases.filter((d) => d.state === 'failed').length,
      invalidated: databases.filter((d) => d.state === 'invalidated').length,
      zeroResult: databases.filter((d) => d.state === 'zero_results').length,
    },
  };
}

/**
 * The databases the manuscript may name, as display labels in a stable order.
 * PRISMA distinguishes bibliographic databases from trial registers, so registers
 * are returned separately — the Methods text names them in their own clause
 * rather than pretending a registry is a database.
 * Pure.
 */
export function reportableDatabases(provenance) {
  const list = (provenance && provenance.reportable) || [];
  return {
    databases: list.filter((d) => d.kind !== 'register').map((d) => d.label),
    registers: list.filter((d) => d.kind === 'register').map((d) => d.label),
    all: list.map((d) => d.label),
  };
}

export default {
  DB_STATES,
  DB_STATE_IDS,
  DB_STATE_LABELS,
  REPORTABLE_STATES,
  isReportable,
  canonicalDbKey,
  dbLabel,
  dbKind,
  isoOf,
  deriveSearchProvenance,
  reportableDatabases,
};
