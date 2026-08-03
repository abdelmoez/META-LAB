/**
 * screeningExportZip.js — portable screening export ZIP (97.md Phase 2).
 *
 * Builds the researcher-facing "Download screening file" archive as an async
 * ScreenExportJob with format 'zip' (Decision E1 — always a background job; the
 * legacy sync csv/json/ris formats are untouched). Members:
 *
 *   references-and-screening-decisions.csv  — NEW CSV with its OWN append-only v1
 *     schema (SCREEN_ZIP_CSV_COLUMNS). The frozen legacy EXPORT_COLUMNS contract in
 *     screeningExportService.js is never touched (invariant 6). Stage-EXPLICIT
 *     per-reviewer families (ta/ft) — this file does not inherit the legacy
 *     "my decision has no stage filter" ambiguity.
 *   references.ris                          — NEW renderRisRecord writer
 *     (TY/TI/AU/JO/PY/VL/IS/SP/EP/DO/AN/UR/AB/KW); the legacy renderRisBlock and
 *     its pinned tests stay untouched (Decision E5). Screening state never enters
 *     RIS tags. OPTIONAL member: its failure produces EXPORT-WARNINGS.txt, not a
 *     failed job (Decision E6).
 *   screening-backup.json                   — structured, restorable backup,
 *     schemaVersion "1", streamed per-table with cursor paging (Decision E4;
 *     never a whole-project JSON.stringify).
 *   README.txt                              — project-specific explanation (core).
 *   EXPORT-WARNINGS.txt                     — only when an optional member failed.
 *
 * Blind-mode rule (top leak vector — 97.md plan §17): the SAME buildExportContext
 * verdict gates EVERY member. With !canSeeIdentity, reviewer ids become stable
 * ordinals ("reviewer-N"), reviewer names become "Reviewer N", record
 * authors/journal are blanked (CSV, RIS and JSON alike), and
 * ScreenConflict.reviewerDecisions KEYS are remapped through the same ordinal map.
 * The JSON backup carries ALL reviewers (no cap — it is a backup); the first
 * EXPORT_REVIEWER_CAP ordinals agree with the CSV because both use the same
 * reviewerId-ascending ordering.
 *
 * Memory bound: DB reads are cursor-paged (PAGE rows at a time) and each member
 * is fed to the ZIP builder as an async generator yielding ONE PAGE of rendered
 * bytes at a time (bit-3 streamed entries: streaming DEFLATE + incremental CRC in
 * server/utils/zip.js). The bound is one page of records, not one member and not
 * the archive — no query loads the whole project and no member is ever
 * concatenated in memory (Decision E2/E4).
 */
import { prisma } from '../db/client.js';
import { csvRow } from '../utils/csv.js';
import { createZipBuilder } from '../utils/zip.js';
import { consensusState } from '../../src/research-engine/screening/conflicts.js';
import { buildExportContext, EXPORT_REVIEWER_CAP } from './screeningExportService.js';
import { getVersion } from '../version.js';
import { getEngine } from '../engineVersion/engineVersionService.js';

export const SCREEN_ZIP_CSV_SCHEMA_VERSION = '1';
export const SCREENING_BACKUP_SCHEMA_VERSION = '1';

/** Member filenames inside the archive (fixed contract — the README explains each). */
export const ZIP_MEMBERS = Object.freeze({
  csv: 'references-and-screening-decisions.csv',
  ris: 'references.ris',
  json: 'screening-backup.json',
  readme: 'README.txt',
  warnings: 'EXPORT-WARNINGS.txt',
});

const PAGE = 1000; // records per DB page in every streaming pass (bounded memory)

/**
 * SCREEN_ZIP_CSV_COLUMNS — the v1 schema of references-and-screening-decisions.csv.
 * APPEND-ONLY and position-pinned (tests/unit/screening/exportZip.test.js): never
 * reorder, rename, or remove an entry — only append. Documented in README.txt.
 *
 * Column semantics (documented here once; the README carries the researcher copy):
 *   title_abstract_status        — consensus matrix over title/abstract decisions
 *                                  (awaiting_screening | awaiting_second_reviewer |
 *                                   conflict | agreement_included | agreement_excluded |
 *                                   agreement_other)
 *   full_text_status             — same matrix over full-text decisions; blank until
 *                                  any full-text decision exists
 *   final_status                 — the record's settled outcome ('' | accepted | rejected)
 *   exclusion_reason             — final rejectedReason, else the distinct reviewer
 *                                  exclusion reasons joined by '; '
 *   conflict_status              — the ScreenConflict row state (none | open | resolved)
 *   consensus_or_final_decision  — finalStatus, else the resolved conflict decision,
 *                                  else include/exclude from title/abstract agreement
 *   notes                        — conflict-resolution notes (reviewer notes live in
 *                                  the per-reviewer families and the JSON backup)
 *   other_identifiers            — documented `key:value; key:value` serialization
 *                                  (pmcid / nct), never a nested object
 *   reviewer_N_note              — the reviewer's title/abstract note, else their
 *                                  full-text note (both stages are complete in the
 *                                  JSON backup)
 *   updated_at                   — the record row's last-updated timestamp
 *                                  (appended after the reviewer families; the
 *                                  schema is append-only so trailing adds are safe)
 */
export const SCREEN_ZIP_CSV_COLUMNS = [
  'record_id', 'title', 'abstract', 'authors', 'journal', 'year', 'volume', 'issue',
  'pages', 'doi', 'pmid', 'url', 'other_identifiers', 'keywords', 'source_database',
  'imported_from', 'import_date', 'is_duplicate', 'is_primary', 'duplicate_group_id',
  'current_stage', 'title_abstract_status', 'full_text_status', 'final_status',
  'exclusion_reason', 'promoted_at', 'accepted_at', 'handoff_status', 'handoff_at',
  'conflict_status', 'consensus_or_final_decision', 'notes',
  ...Array.from({ length: EXPORT_REVIEWER_CAP }, (_, i) => [
    `reviewer_${i + 1}_name`,
    `reviewer_${i + 1}_ta_decision`,
    `reviewer_${i + 1}_ta_decided_at`,
    `reviewer_${i + 1}_ft_decision`,
    `reviewer_${i + 1}_ft_decided_at`,
    `reviewer_${i + 1}_note`,
  ]).flat(),
  // Appended after the reviewer families (append-only schema; 97.md "Date last
  // updated where available" — record-level ScreenRecord.updatedAt).
  'updated_at',
];

const isoOrBlank = (d) => {
  if (!d) return '';
  try { return new Date(d).toISOString(); } catch { return ''; }
};
const isoOrNull = (d) => (isoOrBlank(d) || null);

const NEUTRAL_CTX = Object.freeze({ canSeeIdentity: false, reviewers: [], requiredReviewers: 2 });

/* ══════════════════════════ pure builders (unit-tested) ══════════════════════════ */

/**
 * Best-effort volume/issue/pages/url/other-identifiers/keywords resolver
 * (97.md missing-optional-metadata rule): ScreenRecord has no such columns, so we
 * merge (fill-blank) across the record's PecanSourceRecord provenance rows where
 * they exist, then fall back to a try/catch parse of the TRUNCATED rawData import
 * JSON. A garbage record yields blanks — it can never fail the export.
 */
export function resolveRecordExtras(record, sourceRows = []) {
  const extras = { volume: '', issue: '', pages: '', url: '', otherIdentifiers: '', keywords: [] };
  const otherIds = [];
  const setIf = (k, v) => { if (!extras[k] && v != null && String(v).trim()) extras[k] = String(v).trim(); };
  for (const s of sourceRows || []) {
    if (!s) continue;
    setIf('volume', s.volume); setIf('issue', s.issue); setIf('pages', s.pages); setIf('url', s.url);
    if (s.pmcid) otherIds.push(['pmcid', s.pmcid]);
    if (s.nctId) otherIds.push(['nct', s.nctId]);
    if (!extras.keywords.length && s.keywords) {
      try {
        const arr = JSON.parse(s.keywords);
        if (Array.isArray(arr)) extras.keywords = arr.map((x) => String(x).trim()).filter(Boolean);
      } catch { /* malformed keywords JSON → skip */ }
    }
  }
  try {
    const raw = JSON.parse(record?.rawData || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      setIf('volume', raw.volume);
      setIf('issue', raw.issue);
      setIf('pages', raw.pages || (raw.startPage ? `${raw.startPage}${raw.endPage ? '-' + raw.endPage : ''}` : ''));
      setIf('url', raw.url || raw.link);
      if (raw.pmcid) otherIds.push(['pmcid', raw.pmcid]);
      if (raw.nctId || raw.nct) otherIds.push(['nct', raw.nctId || raw.nct]);
      if (!extras.keywords.length && Array.isArray(raw.keywords)) {
        extras.keywords = raw.keywords.map((x) => String(x).trim()).filter(Boolean);
      }
    }
  } catch { /* rawData is truncated to 2000 chars at import and may be invalid JSON → blanks */ }
  const seen = new Set();
  extras.otherIdentifiers = otherIds
    .map(([k, v]) => `${k}:${String(v).trim()}`)
    .filter((kv) => kv.split(':').slice(1).join(':') && !seen.has(kv) && seen.add(kv))
    .join('; ');
  return extras;
}

/**
 * Build one CSV row object for the ZIP schema. Pure. `record.decisions` and
 * `record.conflicts` ride on the record (as loaded by the pager); `ctx` is the
 * shared buildExportContext verdict (identity + capped reviewer roster);
 * `extras` comes from resolveRecordExtras; `batch` is the ScreenImportBatch row.
 */
export function buildZipCsvRow(r, ctx = NEUTRAL_CTX, extras = {}, { batch = null } = {}) {
  const blind = !ctx.canSeeIdentity;
  const decisions = r.decisions || [];
  const ta = decisions.filter((d) => d.stage === 'title_abstract');
  const ft = decisions.filter((d) => d.stage === 'full_text');
  const conflict = (r.conflicts || [])[0] || null;
  const required = ctx.requiredReviewers ?? 2;
  const taStatus = consensusState(ta, required);
  const ftStatus = ft.length ? consensusState(ft, required) : '';
  const conflictStatus = !conflict ? 'none' : (conflict.resolvedAt ? 'resolved' : 'open');
  const consensusOrFinal =
    r.finalStatus ||
    conflict?.finalDecision ||
    (taStatus === 'agreement_included' ? 'include' : taStatus === 'agreement_excluded' ? 'exclude' : '');
  const decisionReasons = [...new Set(decisions.map((d) => String(d.exclusionReason || '').trim()).filter(Boolean))];

  const row = {
    record_id: r.id,
    title: r.title || '',
    abstract: r.abstract || '',
    authors: blind ? '' : (r.authors || ''),
    journal: blind ? '' : (r.journal || ''),
    year: r.year || '',
    volume: extras.volume || '',
    issue: extras.issue || '',
    pages: extras.pages || '',
    doi: r.doi || '',
    pmid: r.pmid || '',
    url: extras.url || '',
    other_identifiers: extras.otherIdentifiers || '',
    keywords: r.keywords || (Array.isArray(extras.keywords) ? extras.keywords.join('; ') : ''),
    source_database: r.sourceDb || '',
    imported_from: batch ? (batch.filename || batch.source || '') : '',
    import_date: isoOrBlank(batch?.createdAt || r.createdAt),
    is_duplicate: !!r.isDuplicate,
    is_primary: !!r.isPrimary,
    duplicate_group_id: r.duplicateGroupId || '',
    current_stage: r.currentStage || 'title_abstract',
    title_abstract_status: taStatus,
    full_text_status: ftStatus,
    final_status: r.finalStatus || '',
    exclusion_reason: r.rejectedReason || decisionReasons.join('; '),
    promoted_at: isoOrBlank(r.promotedAt),
    accepted_at: isoOrBlank(r.acceptedAt),
    handoff_status: r.handoffStatus || '',
    handoff_at: isoOrBlank(r.handoffAt),
    conflict_status: conflictStatus,
    consensus_or_final_decision: consensusOrFinal,
    notes: conflict?.notes || '',
  };
  for (let i = 0; i < EXPORT_REVIEWER_CAP; i++) {
    const rev = (ctx.reviewers || [])[i];
    const taD = rev ? ta.find((d) => d.reviewerId === rev.reviewerId) : null;
    const ftD = rev ? ft.find((d) => d.reviewerId === rev.reviewerId) : null;
    const n = i + 1;
    row[`reviewer_${n}_name`] = rev ? (ctx.canSeeIdentity ? (rev.name || `Reviewer ${n}`) : `Reviewer ${n}`) : '';
    row[`reviewer_${n}_ta_decision`] = taD ? (taD.decision || 'undecided') : '';
    row[`reviewer_${n}_ta_decided_at`] = taD ? isoOrBlank(taD.updatedAt || taD.createdAt) : '';
    row[`reviewer_${n}_ft_decision`] = ftD ? (ftD.decision || 'undecided') : '';
    row[`reviewer_${n}_ft_decided_at`] = ftD ? isoOrBlank(ftD.updatedAt || ftD.createdAt) : '';
    row[`reviewer_${n}_note`] = taD?.notes || ftD?.notes || '';
  }
  row.updated_at = isoOrBlank(r.updatedAt);
  return row;
}

/** Render one ZIP-schema CSV line (column-ordered, RFC-4180 + injection-safe). */
export function renderZipCsvRow(row) {
  return csvRow(SCREEN_ZIP_CSV_COLUMNS.map((c) => row[c]));
}

/**
 * renderRisRecord — the NEW RIS writer (Decision E5; the legacy renderRisBlock is
 * untouched). `rec` carries blind-SAFE values (authors/journal already blanked by
 * the caller when required — same pattern the legacy writer relies on); `extras`
 * is the resolveRecordExtras result. Emits only citation tags; screening state
 * never enters RIS.
 */
export function renderRisRecord(rec, extras = {}) {
  const oneLine = (v) => String(v ?? '').replace(/\r?\n/g, ' ').trim();
  const lines = ['TY  - JOUR'];
  const push = (tag, v) => { const s = oneLine(v); if (s) lines.push(`${tag}  - ${s}`); };
  push('TI', rec.title);
  const authorsRaw = oneLine(rec.authors);
  if (authorsRaw) {
    const authors = authorsRaw.includes(';') ? authorsRaw.split(/;\s*/) : authorsRaw.split(/,\s*/);
    for (const a of authors.map((s) => s.trim()).filter(Boolean)) lines.push(`AU  - ${a}`);
  }
  push('JO', rec.journal);
  push('PY', rec.year);
  push('VL', extras.volume);
  push('IS', extras.issue);
  const pages = oneLine(extras.pages);
  if (pages) {
    const m = pages.match(/^([^-–]+)[-–]+(.+)$/);
    if (m) { push('SP', m[1]); push('EP', m[2]); } else push('SP', pages);
  }
  push('DO', rec.doi);
  push('AN', rec.pmid);
  push('UR', extras.url);
  push('AB', rec.abstract);
  const kws = Array.isArray(extras.keywords) && extras.keywords.length
    ? extras.keywords
    : String(rec.keywords || '').split(/;\s*/).map((s) => s.trim()).filter(Boolean);
  for (const k of kws) push('KW', k);
  lines.push('ER  - ');
  return lines.join('\n');
}

/**
 * Stable reviewer-ordinal mapper for the blind JSON backup. Seeded with the
 * project's full reviewer roster in reviewerId-ASCENDING order (the same rule
 * buildExportContext uses, so CSV and JSON ordinals agree). Ids encountered later
 * (e.g. stale ScreenConflict.reviewerDecisions keys or eligibility rows) extend
 * the map deterministically in first-seen order — an unknown id is NEVER emitted
 * raw under blind mode.
 */
export function makeOrdinalMapper(reviewerIds = []) {
  const idx = new Map();
  for (const id of reviewerIds) if (id && !idx.has(id)) idx.set(id, idx.size + 1);
  const ordinal = (id) => {
    if (!idx.has(id)) idx.set(id, idx.size + 1);
    return idx.get(id);
  };
  return {
    mapId: (id) => (id ? `reviewer-${ordinal(id)}` : ''),
    mapName: (id) => (id ? `Reviewer ${ordinal(id)}` : ''),
  };
}

/**
 * Re-key a ScreenConflict.reviewerDecisions JSON string through `mapId` (blind
 * ordinal remap — the #1 leak vector). Malformed JSON degrades to {}.
 */
export function remapReviewerDecisions(reviewerDecisionsJson, mapId) {
  let obj;
  try { obj = JSON.parse(reviewerDecisionsJson || '{}'); } catch { return {}; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) out[mapId(id)] = v;
  return out;
}

/** Backup shape for one ScreenRecord (rawData is intentionally excluded — it can carry blinded fields). */
export function shapeBackupRecord(r, { blind = false, extras = {} } = {}) {
  return {
    id: r.id,
    importBatchId: r.importBatchId || null,
    duplicateGroupId: r.duplicateGroupId || null,
    isPrimary: !!r.isPrimary,
    isDuplicate: !!r.isDuplicate,
    title: r.title || '',
    authors: blind ? '' : (r.authors || ''),
    journal: blind ? '' : (r.journal || ''),
    year: r.year || '',
    doi: r.doi || '',
    pmid: r.pmid || '',
    abstract: r.abstract || '',
    keywords: r.keywords || '',
    sourceDb: r.sourceDb || '',
    volume: extras.volume || '',
    issue: extras.issue || '',
    pages: extras.pages || '',
    url: extras.url || '',
    otherIdentifiers: extras.otherIdentifiers || '',
    currentStage: r.currentStage || 'title_abstract',
    finalStatus: r.finalStatus || '',
    promotedAt: isoOrNull(r.promotedAt),
    promotedVia: r.promotedVia || '',
    acceptedAt: isoOrNull(r.acceptedAt),
    rejectedReason: r.rejectedReason || '',
    handoffStatus: r.handoffStatus || '',
    handoffAt: isoOrNull(r.handoffAt),
    handoffStudyId: r.handoffStudyId || '',
    createdAt: isoOrNull(r.createdAt),
    updatedAt: isoOrNull(r.updatedAt),
  };
}

/** Backup shape for one ScreenDecision (blind → ordinal id + name). */
export function shapeBackupDecision(d, mapper, blind) {
  let labels = [];
  try { const arr = JSON.parse(d.labels || '[]'); if (Array.isArray(arr)) labels = arr; } catch { /* keep [] */ }
  return {
    id: d.id,
    recordId: d.recordId,
    reviewerId: blind ? mapper.mapId(d.reviewerId) : d.reviewerId,
    reviewerName: blind ? mapper.mapName(d.reviewerId) : (d.reviewerName || ''),
    stage: d.stage,
    decision: d.decision || 'undecided',
    exclusionReason: d.exclusionReason || '',
    notes: d.notes || '',
    rating: d.rating ?? null,
    labels,
    createdAt: isoOrNull(d.createdAt),
    updatedAt: isoOrNull(d.updatedAt),
  };
}

/** Backup shape for one ScreenConflict (blind → reviewerDecisions keys + resolvedBy remapped). */
export function shapeBackupConflict(c, mapper, blind) {
  let reviewerDecisions;
  if (blind) {
    reviewerDecisions = remapReviewerDecisions(c.reviewerDecisions, mapper.mapId);
  } else {
    try { reviewerDecisions = JSON.parse(c.reviewerDecisions || '{}'); } catch { reviewerDecisions = {}; }
    if (!reviewerDecisions || typeof reviewerDecisions !== 'object' || Array.isArray(reviewerDecisions)) reviewerDecisions = {};
  }
  const resolvedBy = c.resolvedBy === 'auto'
    ? 'auto'
    : blind ? (c.resolvedBy ? mapper.mapId(c.resolvedBy) : '') : (c.resolvedBy || '');
  return {
    id: c.id,
    recordId: c.recordId,
    reviewerDecisions,
    finalDecision: c.finalDecision || '',
    resolvedBy,
    resolvedAt: isoOrNull(c.resolvedAt),
    notes: c.notes || '',
    createdAt: isoOrNull(c.createdAt),
    updatedAt: isoOrNull(c.updatedAt),
  };
}

/** Backup shape for one ScreenImportBatch (blind → importer identity blanked). */
export function shapeBackupBatch(b, blind) {
  return {
    id: b.id,
    filename: b.filename || '',
    format: b.format || '',
    source: b.source || 'file',
    searchRunId: b.searchRunId || '',
    recordCount: b.recordCount ?? 0,
    preDedupCount: b.preDedupCount ?? 0,
    duplicateCount: b.duplicateCount ?? 0,
    rejectedCount: b.rejectedCount ?? 0,
    updatedCount: b.updatedCount ?? 0,
    importedByName: blind ? '' : (b.importedByName || ''),
    createdAt: isoOrNull(b.createdAt),
  };
}

/** Backup shape for one EligibilityAssessment (blind → reviewer identity remapped). */
export function shapeBackupAssessment(a, mapper, blind) {
  let answers = [];
  try { const arr = JSON.parse(a.answersJson || '[]'); if (Array.isArray(arr)) answers = arr; } catch { /* keep [] */ }
  return {
    id: a.id,
    recordId: a.recordId,
    stage: a.stage || 'title_abstract',
    answers,
    suggestedDecision: a.suggestedDecision || '',
    decisionConfidence: a.decisionConfidence ?? null,
    engineVersion: a.engineVersion || '',
    configVersion: a.configVersion || '',
    criteriaVersion: a.criteriaVersion ?? 1,
    autoApplied: !!a.autoApplied,
    autoApplyPolicy: a.autoApplyPolicy || '',
    autoAppliedAt: isoOrNull(a.autoAppliedAt),
    reviewerDecision: a.reviewerDecision || '',
    reviewerId: blind ? (a.reviewerId ? mapper.mapId(a.reviewerId) : null) : (a.reviewerId || null),
    reviewerName: blind ? (a.reviewerId ? mapper.mapName(a.reviewerId) : '') : (a.reviewerName || ''),
    overrideReason: a.overrideReason || '',
    decidedAt: isoOrNull(a.decidedAt),
    createdAt: isoOrNull(a.createdAt),
    updatedAt: isoOrNull(a.updatedAt),
  };
}

/** README.txt content — project-specific, researcher-facing (97.md Phase 2). */
export function buildReadmeText({
  projectTitle, exportedAt, exportedByName, recordCount,
  appName = 'PecanRev', appVersion = '', appCommit = '', engineVersion = '',
  blind = false, failedFormats = [],
} = {}) {
  const lines = [
    `${appName} screening export`,
    '='.repeat(`${appName} screening export`.length),
    '',
    `Project:      ${projectTitle || '(untitled project)'}`,
    `Exported:     ${exportedAt || ''}${exportedByName ? ` by ${exportedByName}` : ''}`,
    `Records:      ${recordCount ?? 0} (every record in the project is included)`,
    '',
    'Files in this export',
    '--------------------',
    `${ZIP_MEMBERS.csv}`,
    '  Human-readable spreadsheet of every reference together with its screening',
    '  decisions: citation details, duplicate status, title/abstract and full-text',
    '  screening status, exclusion reasons, notes, conflict and consensus state,',
    '  Data Extraction handoff status, per-reviewer decisions with dates, and the',
    '  record\'s last-updated timestamp (updated_at).',
    `${ZIP_MEMBERS.ris}`,
    '  Citation-compatible references for reference managers (Zotero, EndNote,',
    `  Mendeley, and similar). Citation fields only — ${appName} screening decisions`,
    '  are intentionally not written into RIS tags.',
    `${ZIP_MEMBERS.json}`,
    `  The complete structured ${appName} screening backup (schema version`,
    `  ${SCREENING_BACKUP_SCHEMA_VERSION}): project settings, references, screening stages, reviewer decisions,`,
    '  notes, exclusion reasons, conflict and consensus state, duplicate groups,',
    '  import provenance, and extraction handoff status — enough structure to',
    `  support a future ${appName} restore or migration.`,
    `${ZIP_MEMBERS.readme}`,
    '  This file.',
    '',
    'Compatibility',
    '-------------',
    'The CSV opens in spreadsheet applications such as Excel, Google Sheets or',
    'LibreOffice Calc. The RIS file imports into most',
    'reference managers. Not every third-party application preserves',
    `${appName}-specific fields (screening stages, reviewer decisions, conflict`,
    'state, duplicate groups, handoff status) — those travel in the CSV and JSON',
    'files only.',
  ];
  if (blind) {
    lines.push('', 'Blind mode', '----------',
      'This project uses blind screening mode. Reviewer identities are replaced by',
      'anonymous ordinals (Reviewer 1, Reviewer 2, …) and record author/journal',
      'fields are blank throughout this export.');
  }
  if (failedFormats.length) {
    lines.push('', 'Warnings', '--------',
      'One or more optional files could not be generated for this export:');
    for (const f of failedFormats) lines.push(`  - ${f}`);
    lines.push(`See ${ZIP_MEMBERS.warnings} for details. The remaining files are complete.`);
  }
  lines.push('', 'Versions', '--------',
    `${appName} version:        ${appVersion}${appCommit ? ` (${appCommit})` : ''}`,
    `Screening engine version:  ${engineVersion || 'unknown'}`,
    `CSV schema version:        ${SCREEN_ZIP_CSV_SCHEMA_VERSION}`,
    `Backup schema version:     ${SCREENING_BACKUP_SCHEMA_VERSION}`,
    '',
    'CSV columns (stable, append-only)',
    '---------------------------------',
    SCREEN_ZIP_CSV_COLUMNS.join(', '),
    '');
  return lines.join('\n');
}

/** EXPORT-WARNINGS.txt content — only produced when an optional member failed. */
export function buildWarningsText(warnings = []) {
  const lines = [
    'Export warnings',
    '===============',
    '',
    'This export completed, but one or more OPTIONAL files could not be generated:',
    '',
  ];
  warnings.forEach((w, i) => lines.push(`${i + 1}. ${w}`));
  lines.push('', 'The other files in this ZIP are complete and safe to use.', '');
  return lines.join('\n');
}

/* ══════════════════════════ streaming DB passes ══════════════════════════ */

/** Page records (+ decisions + conflicts) by id cursor — PAGE rows in memory at a time. */
async function* pageRecords(projectId) {
  let cursor = null;
  for (;;) {
    const page = await prisma.screenRecord.findMany({
      where: { projectId },
      include: { decisions: true, conflicts: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!page.length) return;
    yield page;
    if (page.length < PAGE) return;
    cursor = page[page.length - 1].id;
  }
}

/** Batch-resolve extras for one record page (one provenance query per page). */
async function extrasForPage(page) {
  const ids = page.map((r) => r.id);
  const bySrc = new Map();
  try {
    const rows = await prisma.pecanSourceRecord.findMany({
      where: { screenRecordId: { in: ids } },
      select: {
        screenRecordId: true, volume: true, issue: true, pages: true, url: true,
        pmcid: true, nctId: true, keywords: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const s of rows) {
      if (!bySrc.has(s.screenRecordId)) bySrc.set(s.screenRecordId, []);
      bySrc.get(s.screenRecordId).push(s);
    }
  } catch { /* provenance table unavailable → rawData fallback only (best-effort) */ }
  const map = new Map();
  for (const r of page) map.set(r.id, resolveRecordExtras(r, bySrc.get(r.id) || []));
  return map;
}

/** Full (uncapped) reviewer roster in reviewerId-ascending order. */
async function loadReviewerRoster(projectId) {
  return prisma.screenDecision.findMany({
    where: { projectId },
    select: { reviewerId: true },
    distinct: ['reviewerId'],
    orderBy: { reviewerId: 'asc' },
  });
}

/** Generic id-cursor pager for a flat, project-scoped table. */
async function* pageTable(model, projectId) {
  let cursor = null;
  for (;;) {
    const page = await model.findMany({
      where: { projectId },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!page.length) return;
    yield page;
    if (page.length < PAGE) return;
    cursor = page[page.length - 1].id;
  }
}

/* ══════════════════════════ orchestration ══════════════════════════ */

/**
 * generateScreeningZip — render the whole ZIP incrementally to an async
 * `write(Buffer)` sink. CSV + JSON + README are CORE (any failure throws → the
 * job fails with an actionable error); RIS is OPTIONAL (failure → warning +
 * EXPORT-WARNINGS.txt, job still completes). Returns counts + warnings.
 *
 * @param {object} o
 * @param {string} o.projectId
 * @param {string} o.userId       creator — the identity the permission verdict is built for
 * @param {{id?:string,name?:string}} [o.exportedBy]
 * @param {(chunk:Buffer)=>Promise<void>|void} o.write
 * @param {(p:{processed:number,total:number})=>Promise<void>|void} [o.onProgress]
 * @param {Date} [o.now]
 * @param {(rec:object, extras:object)=>string} [o.risRenderer]  test hook for partial-failure injection
 */
export async function generateScreeningZip({
  projectId, userId, exportedBy = {}, write, onProgress, now = new Date(), risRenderer = renderRisRecord,
}) {
  const project = await prisma.screenProject.findUnique({
    where: { id: projectId },
    select: { id: true, title: true, blindMode: true, requiredScreeningReviewers: true, createdAt: true },
  });
  if (!project) throw new Error('Project not found');

  // ONE identity verdict for every member (reuse — never duplicate the blind rule).
  const ctx = await buildExportContext(projectId, userId);
  const blind = !ctx.canSeeIdentity;
  const roster = await loadReviewerRoster(projectId);
  const mapper = makeOrdinalMapper(roster.map((r) => r.reviewerId));
  // Blind-mode: the exporter is a non-leader reviewer — their OWN name/id must not
  // ride along in README/JSON metadata either (the archive can be shared onward);
  // they appear as their stable ordinal instead (leak tests pin this).
  const exporter = blind
    ? { id: userId ? mapper.mapId(userId) : '', name: userId ? mapper.mapName(userId) : '' }
    : { id: exportedBy.id || userId || '', name: exportedBy.name || '' };

  const total = await prisma.screenRecord.count({ where: { projectId } });
  const batches = await prisma.screenImportBatch.findMany({ where: { projectId } });
  const batchById = new Map(batches.map((b) => [b.id, b]));

  const warnings = [];
  const members = [];
  const zip = createZipBuilder({ write, date: now });
  let processed = 0;
  const totalWork = Math.max(1, total * 3); // csv + ris + json record passes
  const tick = async () => { if (onProgress) await onProgress({ processed, total: totalWork }); };

  // ── 1. references-and-screening-decisions.csv (CORE — streamed per page) ──
  {
    const csvSource = (async function* () {
      yield Buffer.from(SCREEN_ZIP_CSV_COLUMNS.join(','), 'utf8');
      for await (const page of pageRecords(projectId)) {
        const extras = await extrasForPage(page);
        const parts = [];
        for (const r of page) {
          const batch = r.importBatchId ? batchById.get(r.importBatchId) || null : null;
          parts.push('\n' + renderZipCsvRow(buildZipCsvRow(r, ctx, extras.get(r.id), { batch })));
          processed++;
        }
        yield Buffer.from(parts.join(''), 'utf8');
        await tick();
      }
    })();
    await zip.addEntry(ZIP_MEMBERS.csv, csvSource);
    members.push(ZIP_MEMBERS.csv);
  }

  // ── 2. references.ris (OPTIONAL — per-member try/catch, Decision E6) ───────
  // Streamed per page. A renderer that fails on the FIRST page fails before the
  // generator's first yield, so the archive is untouched and the member is
  // cleanly skipped (zip.js defers the local header until the first chunk); a
  // mid-stream failure leaves only dead bytes that central-directory readers
  // ignore — the ZIP stays valid either way.
  try {
    let first = true;
    const risSource = (async function* () {
      for await (const page of pageRecords(projectId)) {
        const extras = await extrasForPage(page);
        const parts = [];
        for (const r of page) {
          // Blind blanking mirrors the legacy pattern: the writer reads off a
          // blind-safe record object, so a blinded export can never carry AU/JO.
          const rec = {
            title: r.title, authors: blind ? '' : r.authors, journal: blind ? '' : r.journal,
            year: r.year, doi: r.doi, pmid: r.pmid, abstract: r.abstract, keywords: r.keywords,
          };
          parts.push((first ? '' : '\n\n') + risRenderer(rec, extras.get(r.id)));
          first = false;
          processed++;
        }
        yield Buffer.from(parts.join(''), 'utf8');
        await tick();
      }
      if (!first) yield Buffer.from('\n', 'utf8');
    })();
    await zip.addEntry(ZIP_MEMBERS.ris, risSource);
    members.push(ZIP_MEMBERS.ris);
  } catch (e) {
    processed = total * 2; // keep progress monotonic past the skipped pass
    // Cap the embedded driver/renderer message so the stored warnings JSON can
    // never be truncated into invalid JSON downstream (97.md partial-failure UX).
    const reason = String(e?.message || 'unknown error').slice(0, 500);
    warnings.push(`${ZIP_MEMBERS.ris} could not be generated: ${reason}. The CSV and JSON files in this export are complete.`);
  }

  // ── 3. screening-backup.json (CORE — streamed per-table, page-sized chunks) ─
  let engineVersion = '';
  {
    const app = getVersion();
    let engine = null;
    try { engine = await getEngine('screening'); } catch { engine = null; }
    engineVersion = engine?.version || '';
    const head = {
      schemaVersion: SCREENING_BACKUP_SCHEMA_VERSION,
      restorable: true,
      exportedAt: now.toISOString(),
      exportedBy: exporter,
      app: { name: app.name, version: app.version, commit: app.commit },
      engines: { screening: engine ? { id: engine.id, version: engine.version } : null },
      project: {
        id: project.id,
        title: project.title,
        blindMode: !!project.blindMode,
        requiredScreeningReviewers: project.requiredScreeningReviewers ?? 2,
        createdAt: isoOrNull(project.createdAt),
      },
    };
    // The member is fed to the ZIP as an async generator — one small section or
    // one PAGE of shaped rows per yield, never the whole JSON document.
    const jsonSource = (async function* () {
      const buf = (s) => Buffer.from(s, 'utf8');
      yield buf(JSON.stringify(head).slice(0, -1)); // keep the object open for the streamed arrays

      const reasons = await prisma.screenExclusionReason.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
      yield buf(',"exclusionReasons":' + JSON.stringify(reasons.map((x) => ({ id: x.id, text: x.text, createdAt: isoOrNull(x.createdAt) }))));

      const labels = await prisma.screenLabel.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
      yield buf(',"labels":' + JSON.stringify(labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))));

      yield buf(',"records":[');
      let first = true;
      for await (const page of pageRecords(projectId)) {
        const extras = await extrasForPage(page);
        const parts = [];
        for (const r of page) {
          parts.push((first ? '' : ',') + JSON.stringify(shapeBackupRecord(r, { blind, extras: extras.get(r.id) })));
          first = false;
          processed++;
        }
        yield buf(parts.join(''));
        await tick();
      }
      yield buf(']');

      yield buf(',"decisions":[');
      first = true;
      for await (const page of pageTable(prisma.screenDecision, projectId)) {
        const parts = [];
        for (const d of page) {
          parts.push((first ? '' : ',') + JSON.stringify(shapeBackupDecision(d, mapper, blind)));
          first = false;
        }
        yield buf(parts.join(''));
      }
      yield buf(']');

      yield buf(',"conflicts":[');
      first = true;
      for await (const page of pageTable(prisma.screenConflict, projectId)) {
        const parts = [];
        for (const c of page) {
          parts.push((first ? '' : ',') + JSON.stringify(shapeBackupConflict(c, mapper, blind)));
          first = false;
        }
        yield buf(parts.join(''));
      }
      yield buf(']');

      const groups = await prisma.screenDuplicateGroup.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
      yield buf(',"duplicateGroups":' + JSON.stringify(groups.map((g) => ({
        id: g.id, primaryId: g.primaryId || '', resolvedAt: isoOrNull(g.resolvedAt), createdAt: isoOrNull(g.createdAt),
      }))));

      yield buf(',"importBatches":' + JSON.stringify(batches.map((b) => shapeBackupBatch(b, blind))));

      // Optional richness: criteria-based eligibility (tables may not exist on an
      // under-migrated deployment — degrade to an empty section, never fail CORE).
      let criteria = [];
      try {
        criteria = await prisma.eligibilityCriterion.findMany({ where: { projectId }, orderBy: { orderIndex: 'asc' } });
      } catch { criteria = []; }
      yield buf(',"eligibility":{"criteria":' + JSON.stringify(criteria.map((c) => ({
        id: c.id, key: c.key, category: c.category, question: c.question, kind: c.kind,
        required: !!c.required, polarity: c.polarity, orderIndex: c.orderIndex,
        version: c.version, active: !!c.active, notes: c.notes || '',
      }))));
      yield buf(',"assessments":[');
      first = true;
      try {
        for await (const page of pageTable(prisma.eligibilityAssessment, projectId)) {
          const parts = [];
          for (const a of page) {
            parts.push((first ? '' : ',') + JSON.stringify(shapeBackupAssessment(a, mapper, blind)));
            first = false;
          }
          yield buf(parts.join(''));
        }
      } catch { /* table unavailable → empty assessments */ }
      yield buf(']}');

      yield buf('}');
    })();
    await zip.addEntry(ZIP_MEMBERS.json, jsonSource);
    members.push(ZIP_MEMBERS.json);
  }

  // ── 4. README.txt (CORE) ───────────────────────────────────────────────────
  {
    const app = getVersion();
    const readme = buildReadmeText({
      projectTitle: project.title,
      exportedAt: now.toISOString(),
      exportedByName: exporter.name,
      recordCount: total,
      appName: app.name,
      appVersion: app.version,
      appCommit: app.commit,
      engineVersion,
      blind,
      failedFormats: warnings.length ? [ZIP_MEMBERS.ris] : [],
    });
    await zip.addEntry(ZIP_MEMBERS.readme, readme);
    members.push(ZIP_MEMBERS.readme);
  }

  // ── 5. EXPORT-WARNINGS.txt (only on optional-member failure) ───────────────
  if (warnings.length) {
    await zip.addEntry(ZIP_MEMBERS.warnings, buildWarningsText(warnings));
    members.push(ZIP_MEMBERS.warnings);
  }

  await zip.finalize();
  processed = totalWork;
  await tick();
  return { total, processed, warnings, members, blind };
}
