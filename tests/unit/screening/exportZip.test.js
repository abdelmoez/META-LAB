/**
 * 97.md Phase 2 — screeningExportZip pure-function contracts:
 *  - SCREEN_ZIP_CSV_COLUMNS is APPEND-ONLY and position-pinned (own v1 schema;
 *    the frozen legacy EXPORT_COLUMNS is a different, untouched contract);
 *  - buildZipCsvRow is stage-EXPLICIT (ta/ft reviewer families) and blind-safe;
 *  - the best-effort extras resolver never throws on garbage/truncated rawData;
 *  - renderRisRecord emits valid, citation-only RIS (VL/IS/SP/EP/UR/KW included);
 *  - the blind-mode ordinal remap covers decisions AND ScreenConflict
 *    reviewerDecisions keys — the #1 leak vector (plan §17);
 *  - README / EXPORT-WARNINGS content is project-specific.
 */
import { describe, it, expect } from 'vitest';
import {
  SCREEN_ZIP_CSV_COLUMNS, SCREEN_ZIP_CSV_SCHEMA_VERSION, SCREENING_BACKUP_SCHEMA_VERSION,
  ZIP_MEMBERS, resolveRecordExtras, buildZipCsvRow, renderZipCsvRow, renderRisRecord,
  makeOrdinalMapper, remapReviewerDecisions, shapeBackupRecord, shapeBackupDecision,
  shapeBackupConflict, shapeBackupBatch, shapeBackupAssessment,
  buildReadmeText, buildWarningsText,
} from '../../../server/services/screeningExportZip.js';
import { EXPORT_REVIEWER_CAP, EXPORT_COLUMNS } from '../../../server/services/screeningExportService.js';

const AT = '2026-06-01T10:00:00.000Z';

const dec = (reviewerId, stage, decision, over = {}) => ({
  id: `d-${reviewerId}-${stage}`, recordId: 'r1', reviewerId, reviewerName: `Name-${reviewerId}`,
  stage, decision, exclusionReason: '', notes: '', rating: null, labels: '[]',
  createdAt: AT, updatedAt: AT, ...over,
});

const record = (over = {}) => ({
  id: 'r1', title: 'A trial of EUS-BD', authors: 'Smith J; Doe A', year: '2021',
  journal: 'The Lancet', doi: '10.1/x', pmid: '123', abstract: 'Background text.',
  keywords: 'eus; drainage', sourceDb: 'pubmed', rawData: '{}',
  isDuplicate: false, isPrimary: true, duplicateGroupId: '', importBatchId: 'b1',
  currentStage: 'title_abstract', finalStatus: '', promotedAt: null, promotedVia: '',
  acceptedAt: null, rejectedReason: '', handoffStatus: '', handoffAt: null, handoffStudyId: '',
  createdAt: AT, updatedAt: AT, decisions: [], conflicts: [], ...over,
});

const ctx = (over = {}) => ({
  canSeeIdentity: true,
  reviewers: [{ reviewerId: 'u1', name: 'Alice' }, { reviewerId: 'u2', name: 'Bob' }],
  requiredReviewers: 2,
  ...over,
});

describe('SCREEN_ZIP_CSV_COLUMNS — its own append-only v1 schema', () => {
  it('pins the base columns in exact positions (never reorder/remove — append only)', () => {
    const base = [
      'record_id', 'title', 'abstract', 'authors', 'journal', 'year', 'volume', 'issue',
      'pages', 'doi', 'pmid', 'url', 'other_identifiers', 'keywords', 'source_database',
      'imported_from', 'import_date', 'is_duplicate', 'is_primary', 'duplicate_group_id',
      'current_stage', 'title_abstract_status', 'full_text_status', 'final_status',
      'exclusion_reason', 'promoted_at', 'accepted_at', 'handoff_status', 'handoff_at',
      'conflict_status', 'consensus_or_final_decision', 'notes',
    ];
    expect(SCREEN_ZIP_CSV_COLUMNS.slice(0, base.length)).toEqual(base);
  });

  it('appends stage-explicit reviewer families up to the fixed cap', () => {
    const fam = SCREEN_ZIP_CSV_COLUMNS.slice(32, 32 + EXPORT_REVIEWER_CAP * 6);
    expect(fam.length).toBe(EXPORT_REVIEWER_CAP * 6);
    expect(fam.slice(0, 6)).toEqual([
      'reviewer_1_name', 'reviewer_1_ta_decision', 'reviewer_1_ta_decided_at',
      'reviewer_1_ft_decision', 'reviewer_1_ft_decided_at', 'reviewer_1_note',
    ]);
    expect(SCREEN_ZIP_CSV_COLUMNS).toContain(`reviewer_${EXPORT_REVIEWER_CAP}_note`);
    expect(SCREEN_ZIP_CSV_COLUMNS).not.toContain(`reviewer_${EXPORT_REVIEWER_CAP + 1}_name`);
  });

  it('carries the appended record-level updated_at as the (current) final column', () => {
    // Append-only schema: updated_at was appended AFTER the reviewer families
    // (97.md "Date last updated where available"). Future columns append after it.
    expect(SCREEN_ZIP_CSV_COLUMNS[SCREEN_ZIP_CSV_COLUMNS.length - 1]).toBe('updated_at');
    expect(SCREEN_ZIP_CSV_COLUMNS.length).toBe(32 + EXPORT_REVIEWER_CAP * 6 + 1);
  });

  it('is a NEW schema — the frozen legacy EXPORT_COLUMNS is not this array', () => {
    expect(SCREEN_ZIP_CSV_COLUMNS).not.toEqual(EXPORT_COLUMNS);
    expect(EXPORT_COLUMNS[0]).toBe('title'); // legacy contract untouched
    expect(SCREEN_ZIP_CSV_SCHEMA_VERSION).toBe('1');
    expect(SCREENING_BACKUP_SCHEMA_VERSION).toBe('1');
  });
});

describe('buildZipCsvRow — stage-explicit statuses and reviewer families', () => {
  it('separates title/abstract and full-text decisions per reviewer', () => {
    const r = record({
      currentStage: 'full_text',
      decisions: [
        dec('u1', 'title_abstract', 'include'),
        dec('u2', 'title_abstract', 'include'),
        dec('u1', 'full_text', 'exclude', { notes: 'wrong design', exclusionReason: 'Wrong study design' }),
      ],
    });
    const row = buildZipCsvRow(r, ctx());
    expect(row.title_abstract_status).toBe('agreement_included');
    expect(row.full_text_status).toBe('awaiting_second_reviewer');
    expect(row.reviewer_1_ta_decision).toBe('include');
    expect(row.reviewer_1_ft_decision).toBe('exclude');
    expect(row.reviewer_1_ft_decided_at).toBe(AT);
    expect(row.reviewer_2_ta_decision).toBe('include');
    expect(row.reviewer_2_ft_decision).toBe('');
    expect(row.reviewer_1_note).toBe('wrong design');
    expect(row.exclusion_reason).toBe('Wrong study design');
    expect(row.consensus_or_final_decision).toBe('include'); // TA agreement, no final yet
  });

  it('conflict_status reflects the ScreenConflict row; consensus falls back through final/conflict', () => {
    const open = buildZipCsvRow(record({
      decisions: [dec('u1', 'title_abstract', 'include'), dec('u2', 'title_abstract', 'exclude')],
      conflicts: [{ id: 'c1', reviewerDecisions: '{"u1":"include","u2":"exclude"}', finalDecision: '', resolvedBy: '', resolvedAt: null, notes: '' }],
    }), ctx());
    expect(open.title_abstract_status).toBe('conflict');
    expect(open.conflict_status).toBe('open');
    expect(open.consensus_or_final_decision).toBe('');

    const resolved = buildZipCsvRow(record({
      decisions: [dec('u1', 'title_abstract', 'include'), dec('u2', 'title_abstract', 'exclude')],
      conflicts: [{ id: 'c1', reviewerDecisions: '{}', finalDecision: 'include', resolvedBy: 'u9', resolvedAt: AT, notes: 'leader call' }],
    }), ctx());
    expect(resolved.conflict_status).toBe('resolved');
    expect(resolved.consensus_or_final_decision).toBe('include');
    expect(resolved.notes).toBe('leader call');

    const final = buildZipCsvRow(record({ finalStatus: 'accepted', handoffStatus: 'sent' }), ctx());
    expect(final.conflict_status).toBe('none');
    expect(final.final_status).toBe('accepted');
    expect(final.consensus_or_final_decision).toBe('accepted');
    expect(final.handoff_status).toBe('sent');
  });

  it('stamps the record-level updated_at timestamp (blank when unavailable)', () => {
    expect(buildZipCsvRow(record(), ctx()).updated_at).toBe(AT);
    expect(buildZipCsvRow(record({ updatedAt: null }), ctx()).updated_at).toBe('');
  });

  it('carries citation, provenance and duplicate fields', () => {
    const row = buildZipCsvRow(
      record({ isDuplicate: true, duplicateGroupId: 'g7' }),
      ctx(),
      { volume: '12', issue: '3', pages: '100-110', url: 'https://x', otherIdentifiers: 'pmcid:PMC1', keywords: [] },
      { batch: { filename: 'search.ris', source: 'file', createdAt: AT } },
    );
    expect(row.volume).toBe('12');
    expect(row.pages).toBe('100-110');
    expect(row.url).toBe('https://x');
    expect(row.other_identifiers).toBe('pmcid:PMC1');
    expect(row.imported_from).toBe('search.ris');
    expect(row.import_date).toBe(AT);
    expect(row.is_duplicate).toBe(true);
    expect(row.duplicate_group_id).toBe('g7');
    expect(row.keywords).toBe('eus; drainage');
  });

  it('blind (non-leader) → anonymous ordinals + blanked authors/journal; title/doi still flow', () => {
    const row = buildZipCsvRow(record({
      decisions: [dec('u1', 'title_abstract', 'include')],
    }), ctx({ canSeeIdentity: false }));
    expect(row.reviewer_1_name).toBe('Reviewer 1');
    expect(row.reviewer_2_name).toBe('Reviewer 2');
    expect(row.authors).toBe('');
    expect(row.journal).toBe('');
    expect(row.title).toBe('A trial of EUS-BD');
    expect(row.doi).toBe('10.1/x');
    const line = renderZipCsvRow(row);
    expect(line).not.toContain('Alice');
    expect(line).not.toContain('Smith J');
    expect(line).not.toContain('The Lancet');
  });

  it('renderZipCsvRow emits exactly one cell per column for a clean synthetic row', () => {
    const row = buildZipCsvRow(record({ title: 'T', authors: 'A', journal: 'J', keywords: '', abstract: '' }), ctx());
    expect(renderZipCsvRow(row).split(',').length).toBe(SCREEN_ZIP_CSV_COLUMNS.length);
  });

  it('neutral ctx fails closed (blind, blank reviewer families)', () => {
    const row = buildZipCsvRow(record({ decisions: [dec('u1', 'title_abstract', 'include')] }));
    expect(row.authors).toBe('');
    expect(row.reviewer_1_name).toBe('');
    expect(row.reviewer_1_ta_decision).toBe('');
  });
});

describe('resolveRecordExtras — best-effort, never throws', () => {
  it('prefers provenance rows, merging fill-blank across them', () => {
    const extras = resolveRecordExtras(record(), [
      { volume: '', issue: '4', pages: '', url: '', pmcid: 'PMC9', nctId: '', keywords: '["a","b"]' },
      { volume: '15', issue: '9', pages: '22-33', url: 'https://doi.org/x', pmcid: '', nctId: 'NCT0001', keywords: '[]' },
    ]);
    expect(extras.issue).toBe('4');       // first non-blank wins
    expect(extras.volume).toBe('15');     // filled from the later row
    expect(extras.pages).toBe('22-33');
    expect(extras.url).toBe('https://doi.org/x');
    expect(extras.otherIdentifiers).toBe('pmcid:PMC9; nct:NCT0001');
    expect(extras.keywords).toEqual(['a', 'b']);
  });

  it('falls back to rawData JSON where provenance is missing', () => {
    const extras = resolveRecordExtras(record({
      rawData: JSON.stringify({ volume: '7', issue: '2', startPage: '10', endPage: '19', url: 'https://j.org/a', keywords: ['k1'] }),
    }), []);
    expect(extras.volume).toBe('7');
    expect(extras.pages).toBe('10-19');
    expect(extras.url).toBe('https://j.org/a');
    expect(extras.keywords).toEqual(['k1']);
  });

  it('garbage / truncated rawData yields blanks, never an exception', () => {
    for (const raw of ['{"truncated": "mid-str', 'not json at all', '', null, '[]', '"str"']) {
      const extras = resolveRecordExtras(record({ rawData: raw }), []);
      expect(extras.volume).toBe('');
      expect(extras.otherIdentifiers).toBe('');
    }
  });
});

describe('renderRisRecord — valid citation-only RIS', () => {
  const extras = { volume: '12', issue: '3', pages: '100-110', url: 'https://x.org/1', keywords: ['eus', 'drainage'] };

  it('maps every supported tag and frames the block TY..ER', () => {
    const ris = renderRisRecord(record(), extras);
    const lines = ris.split('\n');
    expect(lines[0]).toBe('TY  - JOUR');
    expect(lines[lines.length - 1]).toBe('ER  - ');
    expect(ris).toContain('TI  - A trial of EUS-BD');
    expect(ris).toContain('AU  - Smith J');
    expect(ris).toContain('AU  - Doe A');
    expect(ris).toContain('JO  - The Lancet');
    expect(ris).toContain('PY  - 2021');
    expect(ris).toContain('VL  - 12');
    expect(ris).toContain('IS  - 3');
    expect(ris).toContain('SP  - 100');
    expect(ris).toContain('EP  - 110');
    expect(ris).toContain('DO  - 10.1/x');
    expect(ris).toContain('AN  - 123');
    expect(ris).toContain('UR  - https://x.org/1');
    expect(ris).toContain('AB  - Background text.');
    expect(ris).toContain('KW  - eus');
    expect(ris).toContain('KW  - drainage');
  });

  it('un-ranged pages emit SP only; missing extras emit nothing', () => {
    const sp = renderRisRecord(record(), { pages: 'e1002' });
    expect(sp).toContain('SP  - e1002');
    expect(sp).not.toMatch(/^EP {2}- /m);
    const bare = renderRisRecord(record({ keywords: '' }), {});
    expect(bare).not.toMatch(/^VL {2}- /m);
    expect(bare).not.toMatch(/^UR {2}- /m);
    expect(bare).not.toMatch(/^KW {2}- /m);
  });

  it('keywords fall back to the record string when extras carry none', () => {
    const ris = renderRisRecord(record(), {});
    expect(ris).toContain('KW  - eus');
    expect(ris).toContain('KW  - drainage');
  });

  it('a blind-safe record omits AU/JO entirely (blanked upstream)', () => {
    const ris = renderRisRecord({ ...record(), authors: '', journal: '' }, extras);
    expect(ris).not.toMatch(/^AU {2}- /m);
    expect(ris).not.toMatch(/^JO {2}- /m);
    expect(ris).toContain('TI  - A trial of EUS-BD');
  });

  it('screening state never enters RIS tags', () => {
    const ris = renderRisRecord(record({ finalStatus: 'accepted', handoffStatus: 'sent' }), extras);
    expect(ris).not.toMatch(/include|exclude|accepted|handoff|conflict|reviewer/i);
  });
});

describe('blind-mode ordinal remap — the #1 leak vector', () => {
  it('makeOrdinalMapper is stable, roster-seeded, and extends deterministically', () => {
    const m = makeOrdinalMapper(['uA', 'uB']);
    expect(m.mapId('uA')).toBe('reviewer-1');
    expect(m.mapId('uB')).toBe('reviewer-2');
    expect(m.mapName('uB')).toBe('Reviewer 2');
    expect(m.mapId('uA')).toBe('reviewer-1');       // repeat lookups stable
    expect(m.mapId('u-unknown')).toBe('reviewer-3'); // stale id → NEW ordinal, never raw
    expect(m.mapId('u-unknown')).toBe('reviewer-3');
    expect(m.mapId('')).toBe('');
  });

  it('remapReviewerDecisions re-keys conflict maps and degrades malformed JSON to {}', () => {
    const m = makeOrdinalMapper(['uA', 'uB']);
    expect(remapReviewerDecisions('{"uA":"include","uB":"exclude"}', m.mapId))
      .toEqual({ 'reviewer-1': 'include', 'reviewer-2': 'exclude' });
    expect(remapReviewerDecisions('{"uZ":"maybe"}', m.mapId)).toEqual({ 'reviewer-3': 'maybe' });
    expect(remapReviewerDecisions('not-json', m.mapId)).toEqual({});
    expect(remapReviewerDecisions('[1,2]', m.mapId)).toEqual({});
  });

  it('shapeBackupDecision / shapeBackupConflict / shapeBackupAssessment leak nothing when blind', () => {
    const m = makeOrdinalMapper(['uA', 'uB']);
    // Real decision ids are opaque uuids — give the fixture one too, so the
    // whole-object leak scan below is meaningful.
    const d = shapeBackupDecision(dec('uA', 'title_abstract', 'include', { labels: '["rct"]', id: 'd1' }), m, true);
    expect(d.reviewerId).toBe('reviewer-1');
    expect(d.reviewerName).toBe('Reviewer 1');
    expect(d.labels).toEqual(['rct']);
    expect(JSON.stringify(d)).not.toContain('uA');
    expect(JSON.stringify(d)).not.toContain('Name-uA');

    const c = shapeBackupConflict({
      id: 'c1', recordId: 'r1', reviewerDecisions: '{"uA":"include","uB":"exclude"}',
      finalDecision: 'include', resolvedBy: 'uB', resolvedAt: AT, notes: 'n', createdAt: AT, updatedAt: AT,
    }, m, true);
    expect(c.reviewerDecisions).toEqual({ 'reviewer-1': 'include', 'reviewer-2': 'exclude' });
    expect(c.resolvedBy).toBe('reviewer-2');
    expect(JSON.stringify(c)).not.toContain('uA');
    expect(JSON.stringify(c)).not.toContain('uB');

    const auto = shapeBackupConflict({ id: 'c2', recordId: 'r1', reviewerDecisions: '{}', finalDecision: 'exclude', resolvedBy: 'auto', resolvedAt: AT, notes: '' }, m, true);
    expect(auto.resolvedBy).toBe('auto'); // system marker, not an identity

    const a = shapeBackupAssessment({
      id: 'e1', recordId: 'r1', stage: 'title_abstract', answersJson: '[]', suggestedDecision: 'include',
      criteriaVersion: 1, reviewerId: 'uA', reviewerName: 'Name-uA', reviewerDecision: 'include',
    }, m, true);
    expect(a.reviewerId).toBe('reviewer-1');
    expect(a.reviewerName).toBe('Reviewer 1');
    expect(JSON.stringify(a)).not.toContain('Name-uA');
  });

  it('non-blind keeps real identities intact', () => {
    const m = makeOrdinalMapper(['uA']);
    const d = shapeBackupDecision(dec('uA', 'full_text', 'exclude'), m, false);
    expect(d.reviewerId).toBe('uA');
    expect(d.reviewerName).toBe('Name-uA');
  });

  it('shapeBackupRecord blanks authors/journal and excludes rawData when blind', () => {
    const shaped = shapeBackupRecord(record({ rawData: '{"authors":"Smith J"}' }), { blind: true, extras: {} });
    expect(shaped.authors).toBe('');
    expect(shaped.journal).toBe('');
    expect(shaped.title).toBe('A trial of EUS-BD');
    expect('rawData' in shaped).toBe(false); // rawData never ships (can embed blinded fields)
    expect(JSON.stringify(shaped)).not.toContain('Smith J');
  });

  it('shapeBackupBatch blanks importer identity when blind', () => {
    const b = { id: 'b1', filename: 'f.ris', format: 'ris', source: 'file', recordCount: 2, importedByName: 'Owner Person', createdAt: AT };
    expect(shapeBackupBatch(b, true).importedByName).toBe('');
    expect(shapeBackupBatch(b, false).importedByName).toBe('Owner Person');
  });
});

describe('README + EXPORT-WARNINGS content', () => {
  it('README is project-specific, explains each member, versions and schema versions', () => {
    const txt = buildReadmeText({
      projectTitle: 'EUS-BD Review', exportedAt: AT, exportedByName: 'Alice', recordCount: 42,
      appVersion: '4.3.0', appCommit: 'abc1234', engineVersion: '2.5',
    });
    expect(txt).toContain('EUS-BD Review');
    expect(txt).toContain(AT);
    expect(txt).toContain('Alice');
    expect(txt).toContain(ZIP_MEMBERS.csv);
    expect(txt).toContain(ZIP_MEMBERS.ris);
    expect(txt).toContain(ZIP_MEMBERS.json);
    expect(txt).toContain('4.3.0');
    expect(txt).toContain('2.5');
    expect(txt).toContain(`CSV schema version:        ${SCREEN_ZIP_CSV_SCHEMA_VERSION}`);
    expect(txt).toContain(`Backup schema version:     ${SCREENING_BACKUP_SCHEMA_VERSION}`);
    expect(txt).toContain('Not every third-party application preserves');
    expect(txt).toContain('record_id, title'); // documented CSV schema
    expect(txt).toContain('updated_at');       // appended column is documented too
    expect(txt).not.toContain('Warnings');     // no failed formats → no warnings section
  });

  it('README names example spreadsheet applications, never a universal-compatibility claim', () => {
    const txt = buildReadmeText({ projectTitle: 'P' });
    // 97.md Phase 2: "Do not claim universal compatibility with external tools."
    expect(txt).not.toMatch(/any spreadsheet/i);
    expect(txt).toContain('Excel');
    expect(txt).toContain('Google Sheets');
    expect(txt).toContain('LibreOffice');
  });

  it('README names failed optional formats and blind mode when applicable', () => {
    const txt = buildReadmeText({ projectTitle: 'P', blind: true, failedFormats: [ZIP_MEMBERS.ris] });
    expect(txt).toContain('Blind mode');
    expect(txt).toContain('anonymous ordinals');
    expect(txt).toContain(`- ${ZIP_MEMBERS.ris}`);
    expect(txt).toContain(ZIP_MEMBERS.warnings);
  });

  it('EXPORT-WARNINGS lists each warning and reassures about the rest', () => {
    const txt = buildWarningsText(['references.ris could not be generated: boom.']);
    expect(txt).toContain('1. references.ris could not be generated: boom.');
    expect(txt).toContain('complete and safe to use');
  });
});
