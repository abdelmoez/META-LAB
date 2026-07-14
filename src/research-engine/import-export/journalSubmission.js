/**
 * journalSubmission.js — prompt42 Task 8. Pure, network-free helpers for the
 * one-click journal-submission ZIP. The heavy figure/report builders stay in the
 * monolith (they are SVG-producing JSX); this module owns the deterministic,
 * unit-testable pieces: outcome enumeration, the study table CSV, and the
 * README / manifest / warnings text. Keeping them here means the monolith
 * orchestrator only wires builders together — no duplicated keying/labelling logic.
 *
 * Exported for tests/unit/journalSubmission.test.js.
 */

/** Filesystem-safe slug for ZIP entry names. */
export function safeName(s, fallback = 'item') {
  const t = String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return t || fallback;
}

/**
 * Enumerate the distinct (outcome, timepoint) pairs that have at least one study
 * with a numeric effect size — mirrors ForestTab/AnalysisTab so the ZIP produces
 * exactly the same one-forest-plot-per-outcome set the UI shows. Labels are
 * disambiguated by measure when two outcomes share a name. PURE.
 */
export function getOutcomePairs(studies) {
  const list = Array.isArray(studies) ? studies : [];
  const seen = new Set();
  const pairs = [];
  list.filter(s => s && s.es !== '' && s.es != null && !isNaN(+s.es)).forEach(s => {
    const oc = String(s.outcome || '').trim();
    const tp = String(s.timepoint || '').trim();
    const key = `${oc}|||${tp}`;
    if (!seen.has(key)) { seen.add(key); pairs.push({ outcome: oc, timepoint: tp, esType: String(s.esType || '').trim(), key }); }
  });
  const nameCount = {};
  pairs.forEach(p => { const n = (p.outcome || '(unnamed)').toLowerCase(); nameCount[n] = (nameCount[n] || 0) + 1; });
  pairs.forEach(p => {
    const base = p.outcome || '(unnamed)';
    const dup = nameCount[base.toLowerCase()] > 1;
    p.label = base + (p.timepoint ? ` @ ${p.timepoint}` : '') + (dup && p.esType ? ` · ${p.esType}` : '');
  });
  return pairs;
}

/** Studies belonging to a given outcome pair (numeric ES only). PURE. */
export function filterStudiesForOutcome(studies, outcome) {
  const list = Array.isArray(studies) ? studies : [];
  if (!outcome) return [];
  return list.filter(s => {
    if (!s) return false;
    const oc = String(s.outcome || '').trim();
    const tp = String(s.timepoint || '').trim();
    return oc === String(outcome.outcome || '').trim() && tp === String(outcome.timepoint || '').trim() && s.es !== '' && s.es != null && !isNaN(+s.es);
  });
}

function csvEsc(v) {
  if (Array.isArray(v)) v = v.join('; ');
  else if (v && typeof v === 'object') v = JSON.stringify(v);
  const t = String(v == null ? '' : v).replace(/"/g, '""');
  return /[",\n]/.test(t) ? `"${t}"` : t;
}

/** Sample size for a study from whatever fields are present. */
function sampleSize(s) {
  const num = (x) => (x === '' || x == null || isNaN(+x) ? 0 : +x);
  const n = num(s.n);
  if (n) return n;
  const exp = num(s.nExp) || (num(s.a) + num(s.b)) || num(s.events);
  const ctrl = num(s.nCtrl) || (num(s.c) + num(s.d));
  const total = num(s.total);
  const sum = exp + ctrl;
  return sum || total || '';
}

/**
 * Build the journal-ready study table CSV (UTF-8 BOM for Excel). Columns follow
 * the prompt's required set; RoB summary is filled from `robByStudyId` when given
 * (study.id -> 'Low'/'Some concerns'/'High'), else left blank. PURE.
 */
// 82.md Part 12 — a compact summary of the REPORTED-as-stated numbers (so the export
// shows original values, not only the converted es/lo/hi), and how the analysis value
// was derived. PURE; reads only additive fields (absent on legacy rows → '').
const REPORTED_BASES = [
  ['nExp', 'nExp'], ['meanExp', 'meanExp'], ['sdExp', 'sdExp'], ['medianExp', 'medExp'], ['q1Exp', 'q1Exp'], ['q3Exp', 'q3Exp'], ['minExp', 'minExp'], ['maxExp', 'maxExp'], ['seExp', 'seExp'], ['ciLoExp', 'ciLoExp'], ['ciHiExp', 'ciHiExp'],
  ['nCtrl', 'nCtrl'], ['meanCtrl', 'meanCtrl'], ['sdCtrl', 'sdCtrl'], ['medianCtrl', 'medCtrl'], ['q1Ctrl', 'q1Ctrl'], ['q3Ctrl', 'q3Ctrl'], ['minCtrl', 'minCtrl'], ['maxCtrl', 'maxCtrl'], ['seCtrl', 'seCtrl'], ['ciLoCtrl', 'ciLoCtrl'], ['ciHiCtrl', 'ciHiCtrl'],
  ['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'd'], ['events', 'events'], ['total', 'total'], ['tp', 'tp'], ['fp', 'fp'], ['fn', 'fn'], ['tn', 'tn'],
];
function reportedSummary(s) {
  const parts = [];
  for (const [k, lbl] of REPORTED_BASES) { const v = s[k]; if (v !== '' && v !== null && v !== undefined) parts.push(`${lbl}=${v}`); }
  return parts.join('; ');
}
function conversionSummary(s) {
  const list = Array.isArray(s.conversions) ? s.conversions : [];
  if (!list.length) return '';
  return list.map((c) => c && (c.methodLabel || c.method || c.type)).filter(Boolean).join('; ');
}

export function buildStudyTableCSV(studies, robByStudyId = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const cols = [
    ['title', 'Title'], ['authors', 'Authors'], ['year', 'Year'], ['journal', 'Journal'],
    ['country', 'Country'], ['design', 'Study design'], ['population', 'Population'],
    ['intervention', 'Intervention/Exposure'], ['comparator', 'Comparator'], ['outcome', 'Outcome(s)'],
    ['timepoint', 'Timepoint'], ['sampleSize', 'Sample size'], ['esType', 'Effect measure'],
    // 82.md Part 12 — reported-as-stated values + provenance BEFORE the analysis es/lo/hi.
    ['reportedFormat', 'Reported format'], ['reported', 'Reported values (as stated)'],
    ['es', 'Effect size (analysis scale)'], ['lo', 'CI lower'], ['hi', 'CI upper'],
    ['dataSource', 'Data location'], ['converted', 'Value converted?'], ['conversionMethod', 'Conversion method(s)'],
    ['rob', 'Risk of bias'],
  ];
  const rob = robByStudyId || {};
  const rowOf = (s) => ({
    title: s.title || '',
    authors: s.authors || s.author || '',
    year: s.year || '',
    journal: s.journal || '',
    country: s.country || '',
    design: s.design || '',
    population: s.populationDef || s.population || '',
    intervention: s.interventionDef || s.intervention || '',
    comparator: s.comparatorDef || s.comparator || '',
    outcome: s.outcome || '',
    timepoint: s.timepoint || '',
    sampleSize: sampleSize(s),
    esType: s.esType || '',
    reportedFormat: s.reportedFormat || '',
    reported: reportedSummary(s),
    es: s.es ?? '', lo: s.lo ?? '', hi: s.hi ?? '',
    dataSource: s.source || '',
    converted: s.converted ? 'Yes' : 'No',
    conversionMethod: conversionSummary(s),
    rob: rob[s.id] || '',
  });
  const header = cols.map(c => c[1]).join(',');
  const rows = list.map(s => { const r = rowOf(s); return cols.map(c => csvEsc(r[c[0]])).join(','); });
  return '﻿' + [header, ...rows].join('\n');
}

/** README.md describing the package. PURE. */
export function buildReadmeMarkdown({ projectName, generatedAt, appVersion, files = [], warnings = [] } = {}) {
  const out = [];
  out.push(`# Journal submission package — ${projectName || 'Project'}`);
  out.push('');
  out.push(`Generated by PecanRev${appVersion ? ` ${appVersion}` : ''}${generatedAt ? ` on ${generatedAt}` : ''}.`);
  out.push('');
  out.push('## Contents');
  if (files.length) for (const f of files) out.push(`- \`${f.name}\`${f.note ? ` — ${f.note}` : ''}`);
  else out.push('- (no files were generated)');
  out.push('');
  if (warnings.length) {
    out.push('## Warnings');
    for (const w of warnings) out.push(`- ⚠ ${w}`);
    out.push('');
  }
  out.push('## Notes');
  out.push('- Figures are provided as vector SVG (best for journals) and high-resolution PNG.');
  out.push('- The Methods text is auto-drafted from your project settings — review and complete any bracketed placeholders before submission.');
  out.push('- Verify all statistical values against your primary analysis before publication.');
  out.push('');
  return out.join('\n');
}

/** manifest.json content (as a plain object). PURE. */
export function buildManifest({ projectId, projectTitle, generatedAt, generatedBy, appVersion, includedFiles = [], warnings = [] } = {}) {
  return {
    projectId: projectId || null,
    projectTitle: projectTitle || null,
    generatedAt: generatedAt || null,
    generatedBy: generatedBy || null,
    appVersion: appVersion || null,
    includedFiles: includedFiles.map(f => (typeof f === 'string' ? f : f.name)),
    warnings: warnings || [],
  };
}

/** warnings.txt content. PURE. */
export function buildWarningsText(warnings = []) {
  if (!warnings || !warnings.length) return 'No warnings — all expected components were included.\n';
  return warnings.map(w => `- ${w}`).join('\n') + '\n';
}
