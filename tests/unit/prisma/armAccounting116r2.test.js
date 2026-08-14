/**
 * armAccounting116r2.test.js — 116.md §13/§14 (r2). The regression pack for the
 * adversarial-review findings against the Stage-2 PRISMA commit.
 *
 * The class of bug all of these share: §13 moved unattributed file imports into the
 * OTHER-METHODS arm, but every screening/removal set in derive.js was scoped to the
 * DATABASE arm and reconcile.js had no other-arm identity and no dispositions-vs-boxes
 * coverage check. So for a project whose records came from an ordinary RIS upload,
 * the title/abstract decisions and duplicate removals vanished from the boxes AND
 * from counts.screened / counts.excludedScreen / counts.duplicatesRemoved — which
 * prismaCounts.adaptFlow hands straight to the manuscript — while
 * `reconciliation.ok` stayed true. The paper reported "0 records were screened" for
 * a project that screened 80 and excluded 50.
 *
 * Every test here fails on the pre-repair engine. Where the failure was SILENT, the
 * test asserts the loud behaviour (`reconciliation.ok === false`), not just the
 * corrected number.
 */
import { describe, it, expect } from 'vitest';
import {
  derivePrismaFlow, reconcilePrismaFlow, buildRecordProjections,
  identificationSource, armOf, buildPrismaFlowSVG,
} from '../../../src/research-engine/prisma/index.js';
import { knownDatabaseOptions, dbKind } from '../../../src/research-engine/search/searchProvenance.js';
// Read-only: proves the repaired counts reach the manuscript adapter unchanged.
import { computePrismaCounts } from '../../../src/research-engine/manuscript/prismaCounts.js';

let seq = 0;
const id = () => `x${seq++}`;

/** The population §13 created: a plain RIS upload with no database attribution. */
function unattributedImport({ dupes = 0, excluded = 0, promoted = 0, awaiting = 0 } = {}) {
  const records = [];
  for (let i = 0; i < dupes; i++) {
    records.push({ id: id(), sourceDb: '', importBatchId: 'b1', isDuplicate: true, isPrimary: false });
  }
  for (let i = 0; i < excluded; i++) records.push({ id: id(), sourceDb: '', importBatchId: 'b1' });
  for (let i = 0; i < promoted; i++) {
    records.push({ id: id(), sourceDb: '', importBatchId: 'b1', currentStage: 'full_text', promotedAt: '2026-01-02' });
  }
  for (let i = 0; i < awaiting; i++) records.push({ id: id(), sourceDb: '', importBatchId: 'b1' });

  const decisionsByRecord = {};
  let n = 0;
  for (const r of records) {
    if (r.isDuplicate) continue;
    if (r.currentStage === 'full_text') {
      decisionsByRecord[r.id] = { titleAbstract: 'include', fullText: null, exclusionReason: '' };
    } else if (n++ < excluded) {
      decisionsByRecord[r.id] = { titleAbstract: 'exclude', fullText: null, exclusionReason: 'Wrong population' };
    }
  }
  return buildRecordProjections({
    records,
    // No ScreenRecordSource rows: importBatchId is the only origin signal (origin
    // 'file'), and the batch declares no database — the D6(c) other-methods path.
    batchById: { b1: { sourceDatabase: '' } },
    decisionsByRecord,
  });
}

/* ════════ #1 + #5 — the critical one ════════ */

describe('116.md §13 (r2) — other-arm screening work is counted, not deleted', () => {
  const projections = unattributedImport({ dupes: 20, excluded: 50, promoted: 30 });

  it('every projection really is in the other-methods arm (the precondition)', () => {
    expect(projections).toHaveLength(100);
    for (const p of projections) {
      expect(p.origin).toBe('file');
      expect(identificationSource(p)).toBe('manual');
      expect(armOf(p)).toBe('other');
    }
  });

  it('reports the screening the project actually did', () => {
    const f = derivePrismaFlow(projections);
    // BEFORE THE REPAIR: screened 0, excludedScreen 0, duplicatesRemoved 0 — the
    // numbers draft.js renders as "0 records were screened".
    expect(f.counts.screened).toBe(80);
    expect(f.counts.excludedScreen).toBe(50);
    expect(f.counts.duplicatesRemoved).toBe(20);
    expect(f.counts.removedBeforeScreening).toBe(20);
    expect(f.counts.awaitingScreening).toBe(0);
    // The DRAWN boxes stay column-scoped: PRISMA 2020 gives the other-methods
    // column no screening or removal box, and inventing one is the commonest
    // flow-diagram error.
    expect(f.boxes.screened.n).toBe(0);
    expect(f.boxes.excluded_screening.n).toBe(0);
    expect(f.boxes.removed_before_screening.n).toBe(0);
    expect(f.counts.screenedDb).toBe(0);
    // …and the work is published where it CAN be represented.
    expect(f.otherArm.screened.n).toBe(80);
    expect(f.otherArm.excludedScreening.n).toBe(50);
    expect(f.otherArm.removedDuplicate.n).toBe(20);
    expect(f.removedBreakdown.otherArm.duplicate.n).toBe(20);
  });

  it('the boxes and the dispositions no longer contradict each other', () => {
    const f = derivePrismaFlow(projections);
    // The contradiction that used to coexist with ok:true.
    expect(f.dispositions.excluded_screening.n).toBe(50);
    expect(f.boxes.excluded_screening.n + f.otherArm.excludedScreening.n).toBe(50);
    expect(f.dispositions.removed_duplicate.n).toBe(20);
    expect(f.boxes.removed_before_screening.n + f.otherArm.removed.n).toBe(20);
  });

  it('reconciles, and the project-level identity holds', () => {
    const rec = reconcilePrismaFlow(derivePrismaFlow(projections));
    expect(rec.ok).toBe(true);
    const byId = Object.fromEntries(rec.checks.map((c) => [c.id, c]));
    expect(byId.project_identified_minus_removed.ok).toBe(true);
    expect(byId.other_identified_minus_removed.ok).toBe(true);
    expect(byId.dispositions_excluded_screening_covered.ok).toBe(true);
    expect(byId.disposition_box_membership.ok).toBe(true);
  });

  it('the MANUSCRIPT now states the screening that happened', () => {
    // This is the blast radius the finding was about: manuscriptData feeds the
    // loader's flow into computePrismaCounts as opts.flow, adaptFlow copies
    // counts.screened / counts.excludedScreen / counts.duplicatesRemoved straight
    // through with provenance 'records' and zero warnings, and draft.js then emits
    // "; N records were screened". It used to emit 0 — confidently, from "records".
    const pc = computePrismaCounts({}, { flow: derivePrismaFlow(projections) });
    expect(pc.counts.screened).toBe(80);
    expect(pc.counts.excludedScreen).toBe(50);
    expect(pc.counts.duplicatesRemoved).toBe(20);
    expect(pc.provenance.screened).toBe('records');
    // identified − dedupe = screened still holds, so the sentence is coherent.
    expect(pc.counts.identified - pc.counts.dedupe).toBe(pc.counts.screened);
  });

  it('says out loud that the other arm\'s screening cannot be DRAWN', () => {
    // The figure genuinely cannot show it, so the flow reports it rather than
    // leaving a reader to wonder why the column does not add up.
    const rec = reconcilePrismaFlow(derivePrismaFlow(projections));
    const ids = rec.issues.map((i) => i.id);
    expect(ids).toContain('other_arm_screening_not_drawn');
    expect(ids).toContain('other_arm_removals_not_drawn');
  });
});

/* ════════ #1 — the guard that must go RED ════════ */

describe('116.md §13 (r2) — reconciliation FAILS when records belong to no box', () => {
  /**
   * The pre-repair engine's exact output for the 100-record scenario above,
   * reconstructed by hand. This is the shape that used to reconcile "OK": 70
   * identified records accounted for by nothing, and
   * `dispositions.excluded_screening.n` (50) directly contradicting
   * `boxes.excluded_screening.n` (0).
   */
  const brokenFlow = {
    boxes: {
      identified_db: { n: 0, ids: [] },
      identified_other: { n: 100, ids: Array.from({ length: 100 }, (_, i) => `r${i}`) },
      removed_before_screening: { n: 0, ids: [] },
      screened: { n: 0, ids: [] },
      excluded_screening: { n: 0, ids: [] },
      sought_db: { n: 0, ids: [] },
      not_retrieved_db: { n: 0, ids: [] },
      sought_other: { n: 30, ids: Array.from({ length: 30 }, (_, i) => `r${70 + i}`) },
      not_retrieved_other: { n: 0, ids: [] },
      assessed_db: { n: 0, ids: [] },
      excluded_full_text_db: { n: 0, ids: [] },
      assessed_other: { n: 30, ids: Array.from({ length: 30 }, (_, i) => `r${70 + i}`) },
      excluded_full_text_other: { n: 0, ids: [] },
      included_reports: { n: 0, ids: [] },
      included_studies: { n: 0, ids: [] },
    },
    dispositions: {
      removed_duplicate: { n: 20, ids: Array.from({ length: 20 }, (_, i) => `r${i}`) },
      excluded_screening: { n: 50, ids: Array.from({ length: 50 }, (_, i) => `r${20 + i}`) },
      awaiting_full_text: { n: 30, ids: Array.from({ length: 30 }, (_, i) => `r${70 + i}`) },
    },
    removedBreakdown: { duplicate: { n: 0, ids: [] }, automation: { n: 0, ids: [] }, other: { n: 0, ids: [] }, byStage: [] },
    sources: { db: [], other: [{ key: 'Hand-searching / manually added', label: 'Hand-searching / manually added', n: 100 }] },
    exclusionReasons: [],
    counts: {
      identified: 100, identifiedDb: 0, identifiedOther: 100,
      duplicatesRemoved: 0, removedBeforeScreening: 0,
      screened: 0, excludedScreen: 0, awaitingScreening: 0,
      sought: 30, includedQuant: 0,
    },
  };

  it('goes FALSE — this used to report ok:true with zero issues', () => {
    const rec = reconcilePrismaFlow(brokenFlow);
    expect(rec.ok).toBe(false);
    expect(rec.errorCount).toBeGreaterThan(0);
  });

  it('names the specific accounting that is missing', () => {
    const rec = reconcilePrismaFlow(brokenFlow);
    const failed = rec.checks.filter((c) => !c.ok).map((c) => c.id);
    // 50 title/abstract exclusions the boxes report nowhere.
    expect(failed).toContain('dispositions_excluded_screening_covered');
    // 20 duplicate removals the boxes report nowhere.
    expect(failed).toContain('dispositions_removed_covered');
    // and the project-level statement the manuscript makes.
    expect(failed).toContain('project_identified_minus_removed');
  });

  it('catches an id that belongs to no set even when the COUNTS happen to agree', () => {
    // Same sizes on both sides, different members: only the id-level check sees it.
    const flow = {
      boxes: {
        identified_db: { n: 2, ids: ['a', 'b'] },
        identified_other: { n: 0, ids: [] },
        removed_before_screening: { n: 0, ids: [] },
        screened: { n: 2, ids: ['a', 'b'] },
        excluded_screening: { n: 1, ids: ['ghost'] },   // ← wrong member
        sought_db: { n: 1, ids: ['b'] },
        not_retrieved_db: { n: 0, ids: [] },
        sought_other: { n: 0, ids: [] },
        not_retrieved_other: { n: 0, ids: [] },
        assessed_db: { n: 1, ids: ['b'] },
        excluded_full_text_db: { n: 0, ids: [] },
        assessed_other: { n: 0, ids: [] },
        excluded_full_text_other: { n: 0, ids: [] },
        included_reports: { n: 0, ids: [] },
        included_studies: { n: 0, ids: [] },
      },
      otherArm: {
        identified: { n: 0, ids: [] }, removed: { n: 0, ids: [] },
        removedDuplicate: { n: 0, ids: [] }, removedAutomation: { n: 0, ids: [] },
        removedOther: { n: 0, ids: [] }, screened: { n: 0, ids: [] },
        excludedScreening: { n: 0, ids: [] }, awaitingScreening: { n: 0, ids: [] },
        unrecordedDuplicates: 0,
      },
      dispositions: {
        excluded_screening: { n: 1, ids: ['a'] },
        awaiting_full_text: { n: 1, ids: ['b'] },
      },
      removedBreakdown: { duplicate: { n: 0, ids: [] }, automation: { n: 0, ids: [] }, other: { n: 0, ids: [] }, byStage: [] },
      sources: { db: [{ key: 'PubMed', label: 'PubMed', n: 2 }], other: [] },
      exclusionReasons: [],
      counts: {
        identified: 2, identifiedDb: 2, identifiedOther: 0, duplicatesRemoved: 0,
        removedBeforeScreening: 0, screened: 2, excludedScreen: 1,
        awaitingScreening: 0, awaitingScreeningDb: 0, includedQuant: 0,
      },
    };
    const rec = reconcilePrismaFlow(flow);
    const membership = rec.checks.find((c) => c.id === 'disposition_box_membership');
    expect(membership.ok).toBe(false);
    expect(rec.ok).toBe(false);
    expect(rec.issues.some((i) => i.id === 'disposition_box_membership' && i.severity === 'error')).toBe(true);
  });

  it('skips the id-level check on a SLIM flow rather than crying wolf (§11)', () => {
    const slimmed = {
      ...brokenFlow,
      dispositions: { excluded_screening: { n: 50 } },
    };
    const rec = reconcilePrismaFlow(slimmed);
    expect(rec.checks.some((c) => c.id === 'disposition_box_membership')).toBe(false);
  });
});

/* ════════ #2 + #4 — phantom duplicates fabricating a database column ════════ */

describe('116.md §13 (r2) — import-time duplicates are credited to the RIGHT arm', () => {
  it('an unattributed file batch never invents a database search', () => {
    const projections = buildRecordProjections({
      records: Array.from({ length: 10 }, () => ({ id: id(), sourceDb: '', importBatchId: 'b1' })),
      batchById: { b1: { sourceDatabase: '' } },
    });
    const f = derivePrismaFlow(projections, { unrecordedDuplicates: { db: 0, other: 30 } });
    // BEFORE: identified_db 30, removed_before_screening 30, sources.db [] — and the
    // figure printed "Records identified from*: (n = 30) / Databases / registers".
    expect(f.boxes.identified_db.n).toBe(0);
    expect(f.boxes.removed_before_screening.n).toBe(0);
    expect(f.sources.db).toEqual([]);
    expect(f.counts.identifiedDb).toBe(0);
    expect(f.counts.unrecordedDuplicatesOther).toBe(30);
    // Nothing is lost: the discards are reported in the arm that produced them.
    expect(f.counts.duplicatesRemoved).toBe(30);
    expect(f.boxes.identified_other.n).toBe(40);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });

  it('the drawn diagram stops claiming a database search that never happened', () => {
    const projections = buildRecordProjections({
      records: Array.from({ length: 10 }, () => ({ id: id(), sourceDb: '', importBatchId: 'b1' })),
      batchById: { b1: { sourceDatabase: '' } },
    });
    const { svg } = buildPrismaFlowSVG(
      derivePrismaFlow(projections, { unrecordedDuplicates: { db: 0, other: 30 } }),
      { perSource: true },
    );
    expect(svg).toContain('Records identified from*: (n = 0)');
    expect(svg).not.toContain('Records identified from*: (n = 30)');
  });

  it('a bare number stays database-arm, for back-compatibility', () => {
    const f = derivePrismaFlow(
      [{ id: 'd1', origin: 'search', sourceDb: 'PubMed' }],
      { unrecordedDuplicates: 25 },
    );
    expect(f.boxes.identified_db.n).toBe(26);
    expect(f.counts.unrecordedDuplicatesDb).toBe(25);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });

  it('warns when a column reports records that nothing backs', () => {
    const f = derivePrismaFlow([], { unrecordedDuplicates: { db: 0, other: 12 } });
    const rec = reconcilePrismaFlow(f);
    expect(rec.issues.some((i) => i.id === 'unbacked_identified_other' && i.severity === 'warning')).toBe(true);
  });

  it('advises on deduplication for an all-other-arm project too', () => {
    // The `no_duplicates` advisory was gated on identified_db > 0, so exactly the
    // projects §13 created skipped even this warning.
    const f = derivePrismaFlow(unattributedImport({ excluded: 3, awaiting: 2 }));
    expect(f.boxes.identified_db.n).toBe(0);
    expect(reconcilePrismaFlow(f).issues.some((i) => i.id === 'no_duplicates')).toBe(true);
  });
});

/* ════════ #3 + #7 — classify the canonical KEY, not the display label ════════ */

describe('116.md §14 (r2) — every pickable database lands in the database arm', () => {
  const options = knownDatabaseOptions();

  it('offers a non-trivial catalogue (guards the loop below)', () => {
    expect(options.length).toBeGreaterThanOrEqual(20);
    expect(options.map((o) => o.key)).toEqual(expect.arrayContaining(['crossref', 'core', 'lens', 'central']));
  });

  for (const { key } of options) {
    it(`batch-declared "${key}" → the arm its dbKind says, never hand-searching`, () => {
      const [p] = buildRecordProjections({
        records: [{ id: `k_${key}`, sourceDb: '', importBatchId: 'b1' }],
        batchById: { b1: { sourceDatabase: key } },
      });
      // BEFORE: crossref/core/lens fell to 'manual' (other arm) because their
      // DISPLAY labels match no DATABASE_PATTERN, and central resolved to
      // 'register' because its label contains "Register of Controlled Trials".
      expect(identificationSource(p)).toBe(dbKind(key));
      expect(armOf(p)).toBe('db');
    });
  }

  it('a record whose own sourceDb holds the raw canonical key classifies too', () => {
    // screeningImportService writes `r.sourceDb || sourceDatabase`, i.e. the
    // canonical key, straight onto the record.
    const [p] = buildRecordProjections({ records: [{ id: 'ck', sourceDb: 'crossref', importBatchId: 'b1' }] });
    expect(identificationSource(p)).toBe('database');
    expect(armOf(p)).toBe('db');
    expect(p.sourceDb).toBe('Crossref');   // rendered with its catalogue label
  });

  it('CENTRAL is a database, not a trial register', () => {
    const [p] = buildRecordProjections({
      records: [{ id: 'c1', sourceDb: '', importBatchId: 'b1' }],
      batchById: { b1: { sourceDatabase: 'central' } },
    });
    expect(identificationSource(p)).toBe('database');
  });

  it('a real trial register still classifies as a register', () => {
    const [p] = buildRecordProjections({
      records: [{ id: 'c2', sourceDb: '', importBatchId: 'b1' }],
      batchById: { b1: { sourceDatabase: 'clinicaltrials' } },
    });
    expect(identificationSource(p)).toBe('register');
    expect(armOf(p)).toBe('db');
  });

  it('unrecognised free text keeps its verbatim name and its old classification', () => {
    const [p] = buildRecordProjections({ records: [{ id: 'c3', sourceDb: 'Departmental reprint file', importBatchId: 'b1' }] });
    expect(p.sourceDb).toBe('Departmental reprint file');
    expect(armOf(p)).toBe('other');
  });
});

/* ════════ #8 — a format token must not shadow an explicit declaration ════════ */

describe('116.md §14 (r2) — legacy format tokens are read as "no attribution"', () => {
  it('a batch declaration wins over parser junk', () => {
    const [p] = buildRecordProjections({
      records: [{ id: 'y1', sourceDb: 'ris', importBatchId: 'b2' }],
      batchById: { b2: { sourceDatabase: 'embase' } },
    });
    // BEFORE: 'ris' is non-blank, so it won — the Methods said "we searched Embase"
    // while PRISMA filed the same records under hand-searching.
    expect(p.sourceDb).toBe('Embase');
    expect(armOf(p)).toBe('db');
  });

  it('with no declaration the record is honestly unattributed, not "Ris"', () => {
    const [p] = buildRecordProjections({ records: [{ id: 'y2', sourceDb: 'ciw', importBatchId: 'b2' }] });
    expect(p.sourceDb).toBe('');
    expect(armOf(p)).toBe('other');
    expect(derivePrismaFlow([p]).sources.other[0].label).toBe('Hand-searching / manually added');
  });

  it('MEDLINE is ambiguous, so it is kept — and "wos" is a real alias', () => {
    const [m] = buildRecordProjections({ records: [{ id: 'y3', sourceDb: 'medline', importBatchId: 'b2' }] });
    expect(armOf(m)).toBe('db');
    const [w] = buildRecordProjections({ records: [{ id: 'y4', sourceDb: 'wos', importBatchId: 'b2' }] });
    expect(w.sourceDb).toBe('Web of Science');
    expect(armOf(w)).toBe('db');
  });

  it('a genuine record-level name still outranks the batch declaration', () => {
    const [p] = buildRecordProjections({
      records: [{ id: 'y5', sourceDb: 'Scopus', importBatchId: 'b2' }],
      batchById: { b2: { sourceDatabase: 'embase' } },
    });
    expect(p.sourceDb).toBe('Scopus');
  });
});
