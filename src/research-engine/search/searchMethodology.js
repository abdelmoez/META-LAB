/**
 * search/searchMethodology.js — 104.md Part 2.
 *
 * ONE canonical answer to "what is this review's search methodology?", consumed by
 * every surface that reports it.
 *
 * 104.md is explicit about why this file exists: *"The database list and search
 * dates may appear in multiple manuscript locations… Do not independently calculate
 * them in every section. Create one canonical Search Methodology data source that
 * manuscript generation components consume."* Before this, the Abstract, the Methods
 * narration and the PRISMA-S search-strategy table each derived their own list — the
 * table from the `project.search.dbs` CHECKBOXES, which meant a manuscript could
 * claim in its Methods to have searched three databases while its own appendix table
 * listed four. That is the "four independent versions of the truth" the prompt names.
 *
 * This module derives, it does not store. Its input is `deriveSearchProvenance()`
 * output — execution records, never a settings page — so every fact here inherits
 * 101.md §1's rule that a configured-but-never-run database is not a searched one.
 *
 * Pure: no DOM, no network, no Date.now(). Same inputs ⇒ same output.
 */

import { reportableDatabases, canonicalDbKey, dbLabel } from './searchProvenance.js';

/* ════════════════════ helpers ════════════════════ */

const clean = (v) => String(v == null ? '' : v).trim();

/** Oxford-comma list, matching the manuscript's own joinList convention. */
function joinList(items) {
  const a = (items || []).map(clean).filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`;
}

/* ════════════════════ the canonical object ════════════════════ */

/**
 * @param {object} provenance  deriveSearchProvenance() output (or null)
 * @param {object} opts
 *   - otherMethods: string[]  — non-database identification methods actually used
 *     (citation searching, hand searching…). Supplied by the caller because the
 *     evidence for those lives in PRISMA record origins, not in search runs.
 * @returns {object} the canonical search methodology
 */
export function deriveSearchMethodology(provenance, opts = {}) {
  const sp = provenance || null;
  const all = (sp && Array.isArray(sp.databases)) ? sp.databases : [];
  const reportable = (sp && Array.isArray(sp.reportable)) ? sp.reportable : [];

  // The database/register split is PRISMA's, not ours: a trial register is not a
  // bibliographic database, and the Methods text names them in separate clauses.
  // reportableDatabases() is the ONE place that split is decided — before 104.md
  // it was dead code and two call sites re-implemented it inline.
  const { databases, registers, all: allLabels } = reportableDatabases(sp);

  // ── dates ────────────────────────────────────────────────────────────────
  // Only a REPORTABLE database can move either date. A failed attempt or a
  // rolled-back run is not a search that happened, so it cannot be the day the
  // review's evidence base closed.
  const events = (sp && Array.isArray(sp.history)) ? sp.history : [];
  let firstSearchAt = '';
  let latestSearchAt = '';
  // The event history is the honest source for BOTH ends: a database record's
  // `lastSearchedAt` is by definition its LAST search, so taking the earliest of
  // those would report a re-run database's most recent date as the day the review's
  // searching began.
  for (const e of events) {
    const at = clean(e && e.at);
    if (!at) continue;
    if (!firstSearchAt || at < firstSearchAt) firstSearchAt = at;
    if (at > latestSearchAt) latestSearchAt = at;
  }
  if (!events.length) {
    for (const d of reportable) {
      const at = clean(d.lastSearchedAt);
      if (!at) continue;
      if (!firstSearchAt || at < firstSearchAt) firstSearchAt = at;
      if (at > latestSearchAt) latestSearchAt = at;
    }
  }
  // Trust the provenance layer's own answer when it has one — it is computed from
  // the same rule and is what 101.md pinned by test.
  if (sp && sp.latestValidSearchAt) latestSearchAt = sp.latestValidSearchAt;

  // ── how the searching was done ───────────────────────────────────────────
  // 104.md: "If the user searched PubMed automatically but Embase manually, the
  // manuscript should still correctly state that both were searched." Both appear
  // in `databases`; `workflow` records HOW, for the places where that is
  // methodologically relevant (it deliberately does not enter the abstract).
  const methods = new Set();
  for (const d of reportable) {
    const m = clean(d.method);
    if (m === 'mixed') { methods.add('automated'); methods.add('manual'); }
    else if (m) methods.add(m);
  }
  const workflow = methods.has('automated') && methods.has('manual') ? 'mixed'
    : methods.has('manual') ? 'manual'
      : methods.has('automated') ? 'automated' : '';

  // ── update history (Living Reviews / updated searches) ───────────────────
  // "number of search updates" = how many DISTINCT search DAYS there were after
  // the first. Counting individual executions would inflate it (one update that
  // re-runs four databases is one update, not four); counting days is what a reader
  // understands by "the search was updated twice".
  //
  // This MUST come from the event history, not from the per-database rollup: a
  // Living Review that re-runs PubMed every quarter collapses to a single database
  // record whose lastSearchedAt is only the newest date, so the rollup would report
  // a repeatedly-updated review as never updated.
  const history = (sp && Array.isArray(sp.history)) ? sp.history : [];
  const days = new Set();
  for (const e of history) {
    const at = clean(e && e.at);
    if (at) days.add(at.slice(0, 10));
  }
  if (!days.size) {
    // No event history (a caller passing a hand-built provenance object) — fall
    // back to the rollup, which is a floor rather than a lie.
    for (const d of reportable) {
      const at = clean(d.lastSearchedAt);
      if (at) days.add(at.slice(0, 10));
    }
  }
  const searchDays = Array.from(days).sort();
  const updateCount = Math.max(0, searchDays.length - 1);

  // ── what was NOT searched, and why ───────────────────────────────────────
  // Kept so a UI can be honest without the manuscript ever stating it. 104.md's
  // "Preserve audit logs, but generate the manuscript from the correct active/final
  // research state" cuts both ways: the excluded searches stay visible here, they
  // just never reach generated prose.
  const excluded = all.filter((d) => !d.reportable).map((d) => ({
    key: d.key, label: d.label, state: d.state, stateLabel: d.stateLabel,
    reason: d.error || '', method: d.method || '',
  }));

  const otherMethods = Array.isArray(opts.otherMethods)
    ? opts.otherMethods.map(clean).filter(Boolean) : [];

  const recordCount = reportable.reduce(
    (n, d) => n + (Number.isFinite(Number(d.recordCount)) ? Number(d.recordCount) : 0), 0,
  );

  return {
    /* the lists the manuscript may name */
    databases,          // bibliographic databases, display labels
    registers,          // trial registers, display labels
    all: allLabels,     // both, in provenance order
    otherMethods,       // citation searching, hand searching…

    /* prose-ready phrases — computed ONCE so no two sections can word it differently */
    databasesPhrase: joinList(databases),
    registersPhrase: joinList(registers),
    allPhrase: joinList(allLabels),

    /* dates — ISO, formatted by the caller in its own house style */
    firstSearchAt,
    latestSearchAt,
    searchDays,
    updateCount,
    updated: updateCount > 0,

    /* how */
    workflow,                                 // '' | 'automated' | 'manual' | 'mixed'
    automated: methods.has('automated'),
    manual: methods.has('manual'),

    /* the individual search events, preserved (104.md "Search history") */
    history: events,

    /* counts + audit */
    databaseCount: databases.length,
    registerCount: registers.length,
    sourceCount: allLabels.length,
    recordCount,
    perDatabase: reportable.map((d) => ({
      key: d.key, label: d.label, kind: d.kind, method: d.method || '',
      searchedAt: d.lastSearchedAt || '', recordCount: Number(d.recordCount) || 0,
      state: d.state,
    })),
    excluded,

    /* the honest floor: is there anything at all to report? */
    known: allLabels.length > 0 || !!latestSearchAt,
  };
}

/* ════════════════════ PRISMA cross-check (104.md "Data consistency") ════════ */

/**
 * Compare what the manuscript will SAY was searched against what PRISMA shows
 * records actually CAME FROM.
 *
 * 104.md calls a mismatch here "a data-integrity problem", and it is: if the flow
 * diagram credits Scopus with 400 records while the Methods sentence never mentions
 * Scopus, one of the two is wrong and a reader cannot tell which. The comparison is
 * done on CANONICAL keys, not display strings — otherwise "PubMed", "pubmed" and
 * "PubMed/MEDLINE" would read as three different databases and the check would cry
 * wolf on every project.
 *
 * Returns issues, never a verdict: this reports a discrepancy for a human to
 * resolve, it does not silently rewrite either side.
 *
 * @param {object} methodology  deriveSearchMethodology() output
 * @param {object} flow         derivePrismaFlow() output (or null — no flow, no check)
 */
/** Labels PRISMA uses when a record names no specific source (see derive.js). */
const GENERIC_SOURCE_LABELS = new Set([
  'unspecified source', 'databases', 'registers', 'other methods',
  'citation searching', 'websites', 'organisations', 'hand-searching / manually added',
]);

export function checkPrismaConsistency(methodology, flow) {
  const issues = [];
  if (!methodology || !flow || !flow.sources) return { ok: true, issues, checked: false };

  const dbRows = Array.isArray(flow.sources.db) ? flow.sources.db : [];
  // A row whose label names no specific database carries no claim to check.
  //
  // PRISMA source rows fall back through several generic labels when a record has
  // no `sourceDb` text: 'Unspecified source', and the ARM labels ('Databases',
  // 'Registers') that IDENTIFICATION_SOURCES supplies. Treating those as database
  // names would raise a contradiction on every project with an unattributed
  // import — the check would cry wolf precisely where the data is thinnest.
  const prismaKeys = new Map();
  for (const r of dbRows) {
    const raw = clean(r && r.label);
    if (!raw || GENERIC_SOURCE_LABELS.has(raw.toLowerCase())) continue;
    const key = canonicalDbKey(raw);
    if (!key) continue;
    const prev = prismaKeys.get(key) || { label: dbLabel(key) || raw, n: 0 };
    prev.n += Number(r.n) || 0;
    prismaKeys.set(key, prev);
  }

  const saidKeys = new Set(
    (methodology.perDatabase || []).map((d) => d.key).filter(Boolean),
  );

  // Records exist from a source the manuscript never names. This is the dangerous
  // direction — the review reports fewer sources than it actually used.
  for (const [key, info] of prismaKeys) {
    if (!saidKeys.has(key)) {
      issues.push({
        id: `prisma-source-unreported:${key}`,
        severity: 'error',
        source: info.label,
        message: `PRISMA shows ${info.n} record${info.n === 1 ? '' : 's'} identified from ${info.label}, but the manuscript's search methodology does not report searching it.`,
      });
    }
  }

  // The manuscript names a database that contributed no records. Legitimate (a
  // search can genuinely return nothing, and PRISMA still requires reporting it),
  // so this is a warning to check, not an error.
  for (const d of (methodology.perDatabase || [])) {
    if (!d.key || prismaKeys.has(d.key)) continue;
    if (d.state === 'zero_results') continue; // already explained by its own state
    issues.push({
      id: `prisma-source-norecords:${d.key}`,
      severity: 'warning',
      source: d.label,
      message: `The manuscript reports searching ${d.label}, but no records in the PRISMA flow are attributed to it.`,
    });
  }

  return {
    ok: issues.every((i) => i.severity !== 'error'),
    checked: true,
    issues,
  };
}

export default deriveSearchMethodology;
