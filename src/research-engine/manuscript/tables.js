/**
 * manuscript/tables.js — 64.md (P3). Pure builders for the five data-linked
 * manuscript tables. Each returns a normalized { columns, rows, … } structure the
 * UI renders to HTML and the exporter renders to a Word table — ONE source of
 * truth, no duplicated tabulation logic across dashboard/analysis/export/manuscript.
 *
 * Honesty rules:
 *   - Columns ADAPT to available data: a column only appears if ≥1 row has it.
 *   - Empty cells render as '' (the UI shows an em-dash); nothing is fabricated.
 *   - Numeric synthesis values come from runMeta (injectable so the manuscript can
 *     use the EXACT same engine instance the Forest/Analysis tab uses → no drift).
 *
 * Depends only on research-engine pure modules + injected helpers. No DOM/React.
 */

import { runMeta as defaultRunMeta } from '../statistics/meta-analysis.js';
import { getOutcomePairs, filterStudiesForOutcome } from '../import-export/journalSubmission.js';
import { fmtES, fmtNum } from '../format/precision.js';

const clean = (s) => String(s == null ? '' : s).trim();
const num = (x) => (x === '' || x == null || isNaN(+x) ? null : +x);

/** Sample size for a study from whatever raw fields exist. */
function sampleSize(s) {
  const n = num(s.n);
  if (n) return n;
  const exp = num(s.nExp) || ((num(s.a) || 0) + (num(s.b) || 0)) || num(s.events);
  const ctrl = num(s.nCtrl) || ((num(s.c) || 0) + (num(s.d) || 0));
  const total = num(s.total);
  const sum = (exp || 0) + (ctrl || 0);
  return sum || total || null;
}

/** Measure metadata for back-transform + labels (self-contained; no UI deps). */
const MEASURE = {
  OR: { label: 'Odds ratio (OR)', kind: 'ratio' },
  RR: { label: 'Risk ratio (RR)', kind: 'ratio' },
  HR: { label: 'Hazard ratio (HR)', kind: 'ratio' },
  SMD: { label: 'Standardised mean difference (SMD)', kind: 'mean' },
  MD: { label: 'Mean difference (MD)', kind: 'mean' },
  COR: { label: 'Correlation (r)', kind: 'fisherz' },
  PROP: { label: 'Proportion', kind: 'prop' },
  DIAG: { label: 'Diagnostic odds ratio (DOR)', kind: 'ratio' },
};

/** Total participants across a study subset; flags when some studies lack a size. */
function participantTotal(subset) {
  const sizes = subset.map(sampleSize).filter((n) => n != null && n > 0);
  return { total: sizes.reduce((a, n) => a + n, 0), partial: sizes.length < subset.length };
}

function backTransform(x, kind) {
  if (x == null || !Number.isFinite(x)) return null;
  if (kind === 'ratio') return Math.exp(x);
  if (kind === 'fisherz') return Math.tanh(x);
  if (kind === 'prop') { const e = Math.exp(x); return e / (1 + e); }
  return x;
}

/**
 * A. Study characteristics table — from included studies / extraction data.
 * Columns adapt to populated fields. RoB summary filled from opts.robByStudyId
 * (study.id → 'Low'|'Some concerns'|'High') when provided. Pure.
 */
export function buildStudyCharacteristicsTable(project, opts = {}) {
  const studies = (Array.isArray(project && project.studies) ? project.studies : [])
    .filter((s) => s && (clean(s.title) || clean(s.author) || clean(s.authors) || s.es !== ''));
  const rob = opts.robByStudyId || {};

  const candidates = [
    { key: 'study', label: 'Study', get: (s) => clean(s.author || (s.authors || '').split(/[,;]/)[0]) + (s.year ? ` ${clean(s.year)}` : '') || clean(s.title) },
    { key: 'country', label: 'Country/region', get: (s) => clean(s.country) },
    { key: 'design', label: 'Design', get: (s) => clean(s.design) },
    { key: 'population', label: 'Population', get: (s) => clean(s.populationDef || s.population) },
    { key: 'sampleSize', label: 'Sample size', get: (s) => { const n = sampleSize(s); return n == null ? '' : String(n); } },
    { key: 'intervention', label: 'Intervention/exposure', get: (s) => clean(s.interventionDef || s.intervention) },
    { key: 'comparator', label: 'Comparator', get: (s) => clean(s.comparatorDef || s.comparator) },
    { key: 'outcome', label: 'Outcome(s)', get: (s) => clean(s.outcome || s.primaryOutcome) },
    { key: 'followup', label: 'Follow-up', get: (s) => clean(s.followup || s.timepoint) },
    { key: 'rob', label: 'Risk of bias', get: (s) => clean(rob[s.id]) },
  ];

  const rows = studies.map((s) => {
    const row = {};
    for (const c of candidates) row[c.key] = c.get(s);
    return row;
  });

  // keep "study" always; keep others only if any row populated
  const columns = candidates.filter((c) => c.key === 'study' || rows.some((r) => clean(r[c.key])));
  const warnings = [];
  if (!rows.length) warnings.push('No included studies with extracted data yet.');
  else {
    const missingDesign = rows.filter((r) => !clean(r.design)).length;
    if (missingDesign) warnings.push(`${missingDesign} stud${missingDesign === 1 ? 'y is' : 'ies are'} missing study design.`);
  }

  return {
    id: 'study_characteristics_table',
    title: 'Characteristics of included studies',
    columns: columns.map((c) => ({ key: c.key, label: c.label })),
    rows,
    note: 'Generated from included studies and extracted data. Empty cells indicate data not yet extracted.',
    warnings,
    available: rows.length > 0,
    generatedFrom: 'studies',
  };
}

/**
 * B. Summary-of-findings table — one row per outcome with a numeric synthesis.
 * runMeta is injectable (opts.runMeta) so the manuscript reuses the live engine
 * instance; GRADE certainty pulled from project.grade map / opts.gradeByOutcome.
 * Pure.
 */
export function buildSummaryOfFindingsTable(project, opts = {}) {
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const runMeta = typeof opts.runMeta === 'function' ? opts.runMeta : defaultRunMeta;
  const prec = opts.prec;
  const pairs = getOutcomePairs(studies);

  const rows = [];
  const warnings = [];
  let anyPartial = false;
  for (const pair of pairs) {
    const subset = filterStudiesForOutcome(studies, pair);
    const res = subset.length >= 2 ? runMeta(subset, opts.model || 'random') : null;
    const measure = MEASURE[pair.esType] || { label: pair.esType || 'Effect size', kind: 'mean' };
    const { total: participants, partial } = participantTotal(subset);
    if (partial && participants) anyPartial = true;
    const participantsCell = participants ? `${participants}${partial ? '*' : ''}` : '';
    if (!res) {
      rows.push({
        outcome: pair.label,
        nStudies: String(subset.length),
        nParticipants: participantsCell,
        measure: measure.label,
        estimate: subset.length < 2 ? '[<2 studies — not pooled]' : '',
        ci: '',
        pValue: '',
        i2: '',
        model: '',
        certainty: '',
      });
      continue;
    }
    const pe = backTransform(res.pES, measure.kind);
    const lo = backTransform(res.lo95, measure.kind);
    const hi = backTransform(res.hi95, measure.kind);
    const fmt = measure.kind === 'prop'
      ? (x) => (x == null ? '' : `${fmtNum(x * 100, prec)}%`)
      : (x) => (x == null ? '' : fmtES(x, prec));
    const grade = (opts.gradeByOutcome && opts.gradeByOutcome[pair.key]) || '';
    rows.push({
      outcome: pair.label,
      nStudies: String(res.k),
      nParticipants: participantsCell,
      measure: measure.label,
      estimate: fmt(pe),
      ci: lo != null && hi != null ? `${fmt(lo)} to ${fmt(hi)}` : '',
      pValue: res.pval != null ? (res.pval < 0.001 ? '<0.001' : fmtNum(res.pval, prec)) : '',
      i2: res.I2 != null ? `${fmtNum(res.I2, prec)}%` : '',
      model: (opts.model || 'random') === 'fixed' ? 'Fixed effect' : 'Random effects',
      certainty: clean(grade),
    });
  }

  const columns = [
    { key: 'outcome', label: 'Outcome' },
    { key: 'nStudies', label: 'No. studies' },
    { key: 'nParticipants', label: 'No. participants' },
    { key: 'measure', label: 'Effect measure' },
    { key: 'estimate', label: 'Pooled estimate' },
    { key: 'ci', label: '95% CI' },
    { key: 'pValue', label: 'P value' },
    { key: 'i2', label: 'I²' },
    { key: 'model', label: 'Model' },
  ];
  if (rows.some((r) => clean(r.certainty))) columns.push({ key: 'certainty', label: 'Certainty (GRADE)' });
  // drop participants column if entirely empty
  const finalCols = columns.filter((c) => c.key !== 'nParticipants' || rows.some((r) => clean(r.nParticipants)));

  if (!rows.length) warnings.push('No outcomes with effect estimates available for synthesis.');
  if (anyPartial) warnings.push('Participant totals marked * count only studies that reported a sample size.');

  return {
    id: 'summary_of_findings_table',
    title: 'Summary of findings',
    columns: finalCols,
    rows,
    note: 'Pooled estimates from the meta-analysis engine. Ratio measures are back-transformed for presentation. Participant totals marked * include only studies with a reported sample size. Verify against the Analysis tab before submission.',
    warnings,
    available: rows.length > 0,
    generatedFrom: 'analysis',
  };
}

/**
 * C. PRISMA counts table — from a computePrismaCounts() result. Pure.
 * @param {object} prismaResult  output of computePrismaCounts(project, …)
 */
export function buildPrismaCountsTable(prismaResult) {
  const c = (prismaResult && prismaResult.counts) || {};
  const prov = (prismaResult && prismaResult.provenance) || {};
  const fmtCell = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '[not recorded]');
  const def = [
    ['identified', 'Records identified', c.identified],
    ['duplicatesRemoved', 'Duplicate records removed', c.duplicatesRemoved],
    ['screened', 'Records screened', c.screened],
    ['excludedScreen', 'Records excluded (screening)', c.excludedScreen],
    ['reportsAssessed', 'Reports assessed for eligibility', c.reportsAssessed],
    ['reportsExcluded', 'Reports excluded (full text)', c.reportsExcluded],
    ['included', 'Studies included in review', c.included],
    ['includedQuant', 'Studies in meta-analysis', c.includedQuant],
  ];
  const rows = def.map(([key, label, val]) => ({
    stage: label,
    n: fmtCell(val),
    source: prov[key] || 'missing',
  }));
  return {
    id: 'prisma_counts_table',
    title: 'PRISMA 2020 flow counts',
    columns: [
      { key: 'stage', label: 'Stage' },
      { key: 'n', label: 'n' },
    ],
    rows: rows.map((r) => ({ stage: r.stage, n: r.n })),
    rowsWithProvenance: rows,
    note: 'Counts resolved from manual PRISMA entries, overrides, and live screening data. "[not recorded]" marks values you must enter.',
    warnings: (prismaResult && prismaResult.warnings) || [],
    available: !!(prismaResult && prismaResult.hasAny),
    generatedFrom: 'prisma',
  };
}

/**
 * D. Risk of bias summary table — from legacy per-study judgements (studies[].rob)
 * and/or injected structured assessments (opts.assessments: study.id → {domains:{},
 * overall}). Domains adapt to whatever the instrument used. Pure.
 */
export function buildRobTable(project, opts = {}) {
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const robMethod = (project && project.robMethod) || 'RoB2';
  const assessments = opts.assessments || {};
  const domainDefs = opts.domainDefs || (robMethod === 'RoB2'
    ? [['D1', 'D1 Randomization'], ['D2', 'D2 Deviations'], ['D3', 'D3 Missing data'], ['D4', 'D4 Measurement'], ['D5', 'D5 Selection']]
    : [['sel', 'Selection'], ['comp', 'Comparability'], ['out', 'Outcome']]);

  const rows = [];
  for (const s of studies) {
    const fromStruct = assessments[s.id];
    const rob = (fromStruct && fromStruct.domains) || s.rob || {};
    if (!rob || !Object.keys(rob).length) continue;
    const row = { study: clean(s.author || (s.authors || '').split(/[,;]/)[0]) + (s.year ? ` ${clean(s.year)}` : '') || clean(s.title) };
    for (const [k] of domainDefs) row[k] = clean(rob[k]);
    row.overall = clean((fromStruct && fromStruct.overall) || deriveOverall(rob, domainDefs));
    rows.push(row);
  }

  const columns = [{ key: 'study', label: 'Study' }]
    .concat(domainDefs.filter(([k]) => rows.some((r) => clean(r[k]))).map(([k, label]) => ({ key: k, label })))
    .concat([{ key: 'overall', label: 'Overall' }]);

  const warnings = [];
  const assessed = rows.length;
  const totalIncluded = studies.filter((s) => s && (s.es !== '' && s.es != null && !isNaN(+s.es))).length;
  if (assessed === 0) warnings.push('No risk-of-bias assessments recorded yet.');
  else if (totalIncluded && assessed < totalIncluded) warnings.push(`${totalIncluded - assessed} of ${totalIncluded} included studies have no risk-of-bias assessment.`);

  return {
    id: 'risk_of_bias_table',
    title: 'Risk of bias summary',
    columns,
    rows,
    note: `Risk-of-bias judgements (${robMethod}). Only assessed studies are shown.`,
    warnings,
    available: rows.length > 0,
    generatedFrom: 'rob',
  };
}

function deriveOverall(rob, domainDefs) {
  const vals = domainDefs.map(([k]) => clean(rob[k])).filter(Boolean);
  if (!vals.length) return '';
  const norm = vals.map((v) => v.toLowerCase());
  if (norm.some((v) => v.includes('high'))) return 'High';
  if (norm.some((v) => v.includes('some') || v.includes('moderate'))) return 'Some concerns';
  if (norm.every((v) => v.includes('low'))) return 'Low';
  return '';
}

/**
 * E. Search strategy table — from search builder / PRISMA-S data. One row per
 * database searched, with date/string/records when available. Pure.
 */
export function buildSearchStrategyTable(project, opts = {}) {
  const search = (project && project.search) || {};
  const dbs = search.dbs || {};
  const enabled = Object.keys(dbs).filter((k) => dbs[k]);
  const perSource = opts.perSource || {}; // db → { records, string, date, filters }

  const rows = enabled.map((db) => ({
    database: db,
    date: clean((perSource[db] && perSource[db].date) || search.date),
    string: clean((perSource[db] && perSource[db].string) || search.string),
    records: (() => { const n = num(perSource[db] && perSource[db].records); return n == null ? '' : String(n); })(),
    filters: clean((perSource[db] && perSource[db].filters) || ''),
    notes: clean((perSource[db] && perSource[db].notes) || search.notes),
  }));

  const candidates = [
    { key: 'database', label: 'Database' },
    { key: 'date', label: 'Search date' },
    { key: 'string', label: 'Search string' },
    { key: 'records', label: 'Records retrieved' },
    { key: 'filters', label: 'Filters/limits' },
    { key: 'notes', label: 'Notes' },
  ];
  const columns = candidates.filter((c) => c.key === 'database' || rows.some((r) => clean(r[c.key])));
  const warnings = [];
  if (!rows.length) warnings.push('No databases selected in the Search tab.');
  else if (!clean(search.date)) warnings.push('Search date not entered (required for PRISMA-S).');

  return {
    id: 'search_strategy_table',
    title: 'Search strategy',
    columns,
    rows,
    note: 'Databases searched and (where recorded) the strategy and record counts. Complete missing fields for PRISMA-S compliance.',
    warnings,
    available: rows.length > 0,
    generatedFrom: 'search',
  };
}

export default {
  buildStudyCharacteristicsTable,
  buildSummaryOfFindingsTable,
  buildPrismaCountsTable,
  buildRobTable,
  buildSearchStrategyTable,
};
