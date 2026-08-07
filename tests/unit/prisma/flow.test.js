/**
 * 103.md §20 — the ten named scenarios, plus the structural invariants that make
 * the flow trustworthy.
 *
 * The point of the record-level model is that these are not arithmetic tests. Each
 * count is the size of a record set, so a scenario is written as records and the
 * flow is asserted as sets — which is exactly what §11 means by being able to
 * answer "which records created this number?".
 */
import { describe, it, expect } from 'vitest';
import {
  derivePrismaFlow, reconcilePrismaFlow, dispositionOf, armOf,
  identificationSource, DISPOSITIONS,
  buildRecordProjections, resolveDecisions, resolveRetrieval,
  BOXES, UPDATED_REVIEW_BOXES, COLUMN_HEADERS, FOOTNOTES, SOURCE_CITATION,
} from '../../../src/research-engine/prisma/index.js';

let seq = 0;
const rec = (o = {}) => ({ id: `r${seq++}`, origin: 'search', sourceDb: 'PubMed', ...o });
const many = (n2, o) => Array.from({ length: n2 }, () => rec(typeof o === 'function' ? o() : o));

const included = (o = {}) => rec({
  screeningDecision: 'include', soughtRetrieval: true, retrieved: true,
  fullTextDecision: 'include', included: true, ...o,
});

describe('Scenario A — automated search', () => {
  it('5,000 identified → 1,000 duplicates → 4,000 screened', () => {
    const records = [
      ...many(1000, { isDuplicate: true, dedupStage: 'search' }),
      ...many(4000, {}),
    ];
    const f = derivePrismaFlow(records);
    expect(f.counts.identifiedDb).toBe(5000);
    expect(f.counts.duplicatesRemoved).toBe(1000);
    expect(f.counts.screened).toBe(4000);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });
});

describe('Scenario B — a second deduplication pass', () => {
  it('adds 200 more duplicates WITHOUT double-counting the first 1,000', () => {
    const records = [
      ...many(1000, { isDuplicate: true, dedupStage: 'search' }),
      ...many(200, { isDuplicate: true, dedupStage: 'screening' }),
      ...many(3800, {}),
    ];
    const f = derivePrismaFlow(records);
    expect(f.counts.duplicatesRemoved).toBe(1200);
    expect(f.counts.screened).toBe(3800);
    // §12 — the stage breakdown is a PARTITION of the same set, so it can never
    // exceed the total however many stages ran.
    const byStage = Object.fromEntries(f.removedBreakdown.byStage.map((s) => [s.key, s.n]));
    expect(byStage.search).toBe(1000);
    expect(byStage.screening).toBe(200);
    expect(f.removedBreakdown.byStage.reduce((a, s) => a + s.n, 0)).toBe(1200);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });

  it('a record can only be removed as a duplicate ONCE, by construction', () => {
    // Even if two stages both flagged it, it is one record with one disposition.
    const r = rec({ isDuplicate: true, dedupStage: 'screening' });
    expect(dispositionOf(r)).toBe('removed_duplicate');
    const f = derivePrismaFlow([r]);
    expect(f.counts.duplicatesRemoved).toBe(1);
  });
});

describe('Scenario C — manual import with existing records', () => {
  it('100 imported, 25 already present → 75 genuinely new', () => {
    // The 25 already-present arrive as duplicates of records already in the pool.
    const records = [
      ...many(75, { origin: 'file', sourceDb: 'Scopus' }),
      ...many(25, { origin: 'file', sourceDb: 'Scopus', isDuplicate: true, dedupStage: 'import' }),
    ];
    const f = derivePrismaFlow(records);
    expect(f.counts.identifiedDb).toBe(100);
    expect(f.counts.duplicatesRemoved).toBe(25);
    expect(f.counts.screened).toBe(75);
    expect(f.removedBreakdown.byStage[0].key).toBe('import');
  });
});

describe('Scenario D — a manually added study', () => {
  it('lands in the other-methods arm, not the database arm', () => {
    const f = derivePrismaFlow([rec({ origin: 'manual', sourceDb: '' })]);
    expect(f.counts.identifiedOther).toBe(1);
    expect(f.counts.identifiedDb).toBe(0);
  });
});

describe('Scenario E — citation searching', () => {
  it('mined records are identified via other methods and never screened as a pool', () => {
    const records = [
      ...many(50, {}),
      ...many(10, { origin: 'mining' }),
    ];
    const f = derivePrismaFlow(records);
    expect(f.counts.identifiedDb).toBe(50);
    expect(f.counts.identifiedOther).toBe(10);
    // PRISMA 2020 gives the other-methods column no "records screened" box.
    expect(f.counts.screened).toBe(50);
    expect(identificationSource({ origin: 'mining', sourceDb: 'PubMed' })).toBe('citation');
    expect(armOf({ origin: 'mining' })).toBe('other');
  });

  it('classifies registers into the database arm and websites into other methods', () => {
    expect(identificationSource({ origin: 'search', sourceDb: 'ClinicalTrials.gov' })).toBe('register');
    expect(armOf({ origin: 'search', sourceDb: 'ClinicalTrials.gov' })).toBe('db');
    expect(armOf({ origin: 'manual' })).toBe('other');
  });
});

describe('Scenario F — progression through screening, retrieval and eligibility', () => {
  it('records flow accurately and every identity reconciles', () => {
    const records = [
      ...many(300, { screeningDecision: 'exclude' }),
      ...many(20, { screeningDecision: 'include', soughtRetrieval: true, retrieved: false, notRetrievedReason: 'No open-access copy' }),
      ...many(60, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong population' }),
      ...many(15, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong outcome' }),
      ...many(25, {}), // still awaiting a title/abstract decision
      ...many(40, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
    ];
    const f = derivePrismaFlow(records);
    expect(f.counts.screened).toBe(460);
    expect(f.counts.excludedScreen).toBe(300);
    expect(f.counts.sought).toBe(135);
    expect(f.counts.notRetrieved).toBe(20);      // the box the old model could not represent
    expect(f.counts.reportsAssessed).toBe(115);
    expect(f.counts.reportsExcluded).toBe(75);
    expect(f.counts.included).toBe(40);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });

  it('aggregates full-text exclusion reasons (§8)', () => {
    const f = derivePrismaFlow([
      ...many(42, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong population' }),
      ...many(31, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong intervention' }),
    ]);
    const byReason = Object.fromEntries(f.exclusionReasons.map((r) => [r.label, r.n]));
    expect(byReason['Wrong population']).toBe(42);
    expect(byReason['Wrong intervention']).toBe(31);
    // §12 — the reason rows carry the record ids behind them.
    expect(f.exclusionReasons[0].ids).toHaveLength(42);
  });
});

describe('Scenario G — multiple reports of one study (§9)', () => {
  it('three articles for one trial are 3 reports but 1 study', () => {
    const f = derivePrismaFlow([
      included({ studyId: 'TRIAL-1' }),
      included({ studyId: 'TRIAL-1' }),
      included({ studyId: 'TRIAL-1' }),
      included({ studyId: 'TRIAL-2' }),
    ]);
    expect(f.counts.includedReports).toBe(4);
    expect(f.counts.included).toBe(2);
    expect(f.studies.multiReport).toBe(true);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });

  it('a record with no study link is its own study — the safe default', () => {
    const f = derivePrismaFlow([included(), included()]);
    expect(f.counts.includedReports).toBe(2);
    expect(f.counts.included).toBe(2);
    expect(f.studies.multiReport).toBe(false);
  });

  it('counts distinct STUDIES in the meta-analysis, not reports', () => {
    const f = derivePrismaFlow([
      included({ studyId: 'T1', inQuantitative: true }),
      included({ studyId: 'T1', inQuantitative: true }),
      included({ studyId: 'T2' }),
    ]);
    expect(f.counts.included).toBe(2);
    expect(f.counts.includedQuant).toBe(1);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });
});

describe('Scenario H — decision reversal', () => {
  it('changing a full-text exclusion to an inclusion updates the whole flow', () => {
    const base = { screeningDecision: 'include', soughtRetrieval: true, retrieved: true };
    const before = derivePrismaFlow([
      rec({ ...base, fullTextDecision: 'exclude', exclusionReason: 'Wrong outcome' }),
      included(),
    ]);
    expect(before.counts.reportsExcluded).toBe(1);
    expect(before.counts.included).toBe(1);

    // The SAME record, re-decided. Nothing is added or subtracted — the record's
    // disposition changes and every box follows.
    const after = derivePrismaFlow([
      rec({ ...base, fullTextDecision: 'include', included: true }),
      included(),
    ]);
    expect(after.counts.reportsExcluded).toBe(0);
    expect(after.counts.included).toBe(2);
    expect(after.counts.reportsAssessed).toBe(2);
    expect(reconcilePrismaFlow(after).ok).toBe(true);
  });
});

describe('Scenario I — living review / updated search', () => {
  it('records retrieved again are not counted as newly screened', () => {
    // 400 retrieved by the update; 350 already existed and are duplicates of the
    // known pool; only 50 are genuinely new.
    const records = [
      ...many(2300, {}),                                                    // the original pool
      ...many(350, { isDuplicate: true, dedupStage: 'search' }),            // already known
      ...many(50, {}),                                                      // genuinely new
    ];
    const f = derivePrismaFlow(records);
    expect(f.counts.identifiedDb).toBe(2700);
    expect(f.counts.duplicatesRemoved).toBe(350);
    expect(f.counts.screened).toBe(2350);   // 2300 + 50, NOT 2700
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });

  it('reports previously included studies separately for an updated review (§7)', () => {
    const f = derivePrismaFlow([included(), included()], { previous: { studies: 12, reports: 15 } });
    expect(f.counts.included).toBe(2);
    expect(f.counts.previousStudies).toBe(12);
    expect(f.counts.totalStudies).toBe(14);
  });
});

describe('Scenario J — deletion and restoration', () => {
  it('a record removed for a documented reason leaves the screening pool coherently', () => {
    const f = derivePrismaFlow([
      ...many(10, {}),
      rec({ removedBeforeScreening: 'other', removedReason: 'Imported by mistake' }),
    ]);
    expect(f.counts.identifiedDb).toBe(11);
    expect(f.counts.removedOther).toBe(1);
    expect(f.counts.screened).toBe(10);
    expect(f.removedBreakdown.byReason[0].label).toBe('Imported by mistake');
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });

  it('restoring a record simply returns it to the flow', () => {
    const removed = derivePrismaFlow([rec({ removedBeforeScreening: 'other' }), ...many(5, {})]);
    expect(removed.counts.screened).toBe(5);
    const restored = derivePrismaFlow([rec({}), ...many(5, {})]);
    expect(restored.counts.screened).toBe(6);
    expect(reconcilePrismaFlow(restored).ok).toBe(true);
  });

  it('records marked ineligible by an automation tool are their own PRISMA sub-line', () => {
    const f = derivePrismaFlow([
      ...many(3, { removedBeforeScreening: 'automation' }),
      ...many(7, {}),
    ]);
    expect(f.counts.removedAutomation).toBe(3);
    expect(f.counts.screened).toBe(7);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });
});

describe('§11/§12 — every number is answerable to its records', () => {
  it('each box carries the ids that produced it', () => {
    const a = rec({ isDuplicate: true, dedupStage: 'search' });
    const b = rec({ screeningDecision: 'exclude' });
    const f = derivePrismaFlow([a, b]);
    expect(f.boxes.removed_before_screening.ids).toEqual([a.id]);
    expect(f.boxes.excluded_screening.ids).toEqual([b.id]);
    expect(f.boxes.identified_db.ids).toEqual([a.id, b.id]);
  });

  it('the duplicate breakdown names where each one was caught', () => {
    const f = derivePrismaFlow([
      rec({ isDuplicate: true, dedupStage: 'search' }),
      rec({ isDuplicate: true, dedupStage: 'screening' }),
    ]);
    const labels = f.removedBreakdown.byStage.map((s) => s.label);
    expect(labels).toContain('Removed during automated search');
    expect(labels).toContain('Removed in the Screening Engine');
  });
});

describe('§13 — reconciliation is structural', () => {
  it('every disposition is exhaustive and disjoint', () => {
    const records = [
      rec({ isDuplicate: true }), rec({ removedBeforeScreening: 'automation' }),
      rec({ removedBeforeScreening: 'other' }), rec({ screeningDecision: 'exclude' }),
      rec({}), rec({ screeningDecision: 'include', soughtRetrieval: true, retrieved: false }),
      rec({ screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude' }),
      rec({ screeningDecision: 'include', soughtRetrieval: true, retrieved: true }),
      included(),
    ];
    const f = derivePrismaFlow(records);
    const summed = Object.values(f.dispositions).reduce((a, d) => a + d.n, 0);
    expect(summed).toBe(records.length);
    for (const k of Object.keys(f.dispositions)) expect(DISPOSITIONS).toContain(k);
  });

  it('reports a contradiction rather than displaying it silently', () => {
    // A hand-built flow whose studies exceed its reports cannot arise from records,
    // so the checker must call it an ERROR, not smooth it over.
    const broken = {
      boxes: { included_studies: { n: 5, ids: [] }, included_reports: { n: 2, ids: [] } },
      counts: {}, removedBreakdown: {}, exclusionReasons: [], dispositions: {},
    };
    const r = reconcilePrismaFlow(broken);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.id === 'studies_exceed_reports')).toBe(true);
  });

  it('exposes every identity it tested so a discrepancy can be located', () => {
    const r = reconcilePrismaFlow(derivePrismaFlow(many(5, {})));
    expect(r.checks.length).toBeGreaterThanOrEqual(7);
    for (const c of r.checks) {
      expect(c).toHaveProperty('label');
      expect(c).toHaveProperty('lhs');
      expect(c).toHaveProperty('rhs');
    }
  });

  it('warns rather than assuming when no duplicates were removed', () => {
    const r = reconcilePrismaFlow(derivePrismaFlow(many(10, {})));
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.id === 'no_duplicates')).toBe(true);
  });
});

describe('projection — mapping PecanRev tables onto the model', () => {
  it('treats only NON-primary duplicate-group members as removed', () => {
    const p = buildRecordProjections({
      records: [
        // importBatchId present: these came from a database import, so they belong
        // to the database arm where PRISMA 2020 puts the removal box.
        { id: 'a', isDuplicate: true, isPrimary: true, sourceDb: 'PubMed', importBatchId: 'b1' },
        { id: 'b', isDuplicate: true, isPrimary: false, sourceDb: 'PubMed', importBatchId: 'b1' },
      ],
    });
    expect(p.find((x) => x.id === 'a').isDuplicate).toBe(false); // the kept record
    expect(p.find((x) => x.id === 'b').isDuplicate).toBe(true);
    expect(derivePrismaFlow(p).counts.duplicatesRemoved).toBe(1);
  });

  it('treats a record with no source row and no import batch as manually added (§5)', () => {
    // screeningController.createRecord inserts directly — no ScreenRecordSource,
    // no batch. That absence is the only signal that a human added it by hand.
    const [manual] = buildRecordProjections({ records: [{ id: 'm', sourceDb: '' }] });
    expect(manual.origin).toBe('manual');
    expect(derivePrismaFlow([manual]).counts.identifiedOther).toBe(1);

    const [imported] = buildRecordProjections({ records: [{ id: 'i', sourceDb: 'PubMed', importBatchId: 'b1' }] });
    expect(imported.origin).toBe('file');
    expect(derivePrismaFlow([imported]).counts.identifiedDb).toBe(1);
  });

  it('counts import-time duplicates that were never stored as records (§2)', () => {
    // PecanRev drops an import duplicate BEFORE it becomes a ScreenRecord, so a
    // purely record-level count would lose it and under-report records identified.
    const f = derivePrismaFlow(
      [rec({ origin: 'file' }), rec({ origin: 'file' })],
      { unrecordedDuplicates: 25 },
    );
    expect(f.counts.identified).toBe(27);
    expect(f.counts.duplicatesRemoved).toBe(25);
    expect(f.counts.screened).toBe(2);
    // Counted but NOT inspectable — there is no record to inspect, and the
    // breakdown says so rather than pretending otherwise.
    expect(f.removedBreakdown.duplicate.ids).toHaveLength(0);
    expect(f.removedBreakdown.byStage[0].label).toMatch(/not stored as records/i);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
  });

  it('leaves an unresolved reviewer disagreement UNDECIDED', () => {
    const d = resolveDecisions([
      { recordId: 'x', stage: 'title_abstract', verdict: 'include' },
      { recordId: 'x', stage: 'title_abstract', verdict: 'exclude' },
    ]);
    // A split with no resolution must not be silently resolved in the diagram.
    expect(d.x.titleAbstract).toBe(null);
  });

  it('takes a resolved decision over the individual votes', () => {
    const d = resolveDecisions([
      { recordId: 'x', stage: 'title_abstract', verdict: 'include' },
      { recordId: 'x', stage: 'title_abstract', verdict: 'exclude' },
      { recordId: 'x', stage: 'title_abstract', verdict: 'exclude', resolved: true, reason: 'Wrong design' },
    ]);
    expect(d.x.titleAbstract).toBe('exclude');
    expect(d.x.exclusionReason).toBe('Wrong design');
  });

  it('honours unanimous agreement', () => {
    const d = resolveDecisions([
      { recordId: 'y', stage: 'full_text', verdict: 'include' },
      { recordId: 'y', stage: 'full_text', verdict: 'include' },
    ]);
    expect(d.y.fullText).toBe('include');
  });

  it('never treats "not yet attempted" as "not retrieved"', () => {
    const r = resolveRetrieval({ candidates: [], requests: [], attachments: [] });
    expect(Object.keys(r)).toHaveLength(0);
    const attempted = resolveRetrieval({ candidates: [{ recordId: 'z', status: 'no_oa' }] });
    expect(attempted.z.retrieved).toBe(false);
    expect(attempted.z.reason).toMatch(/open-access/i);
  });

  it('lets a stored PDF and a received request override a failed lookup', () => {
    const viaPdf = resolveRetrieval({ candidates: [{ recordId: 'z', status: 'no_oa' }], attachments: ['z'] });
    expect(viaPdf.z.retrieved).toBe(true);
    const viaRequest = resolveRetrieval({
      candidates: [{ recordId: 'z', status: 'not_found' }],
      requests: [{ recordId: 'z', status: 'received' }],
    });
    expect(viaRequest.z.retrieved).toBe(true);
  });
});

describe('§19 — scales to a large project', () => {
  it('derives a 100,000-record flow in one pass', () => {
    const records = [
      ...many(20000, { isDuplicate: true, dedupStage: 'search' }),
      ...many(70000, { screeningDecision: 'exclude' }),
      ...many(9000, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude' }),
      ...many(1000, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
    ];
    const t0 = Date.now();
    const f = derivePrismaFlow(records);
    const ms = Date.now() - t0;
    expect(f.counts.identifiedDb).toBe(100000);
    expect(f.counts.included).toBe(1000);
    expect(reconcilePrismaFlow(f).ok).toBe(true);
    expect(ms).toBeLessThan(3000);
  });
});

describe('§17 — the official PRISMA 2020 template, verbatim', () => {
  const byId = Object.fromEntries(BOXES.map((b) => [b.id, b]));

  it('carries the official box wording, including the footnote asymmetry', () => {
    // The database-arm identification box has a footnote marker; the other-methods
    // one does not. That asymmetry is in the official templates.
    expect(byId.identified_db.label).toBe('Records identified from*:');
    expect(byId.identified_other.label).toBe('Records identified from:');
    expect(byId.excluded_screening.label).toBe('Records excluded**');
    expect(byId.removed_before_screening.label).toBe('Records removed before screening:');
    expect(byId.sought_db.label).toBe('Reports sought for retrieval');
    expect(byId.not_retrieved_db.label).toBe('Reports not retrieved');
    expect(byId.assessed_db.label).toBe('Reports assessed for eligibility');
    expect(byId.included_studies.label).toBe('Studies included in review');
    expect(byId.included_reports.label).toBe('Reports of included studies');
  });

  it('places each box in the correct column (the commonest diagram error)', () => {
    for (const id of ['removed_before_screening', 'screened', 'excluded_screening']) {
      expect(byId[id].arm, id).toBe('db');
    }
    for (const id of ['sought_db', 'not_retrieved_db', 'assessed_db', 'excluded_full_text_db']) {
      expect(byId[id].arm, id).toBe('db');
    }
    for (const id of ['sought_other', 'not_retrieved_other', 'assessed_other', 'excluded_full_text_other']) {
      expect(byId[id].arm, id).toBe('other');
    }
    expect(byId.included_studies.arm).toBe('both');
    expect(byId.included_reports.arm).toBe('both');
  });

  it('declares the unit each box counts — records, then reports, then studies', () => {
    expect(byId.identified_db.unit).toBe('records');
    expect(byId.screened.unit).toBe('records');
    expect(byId.sought_db.unit).toBe('reports');
    expect(byId.assessed_db.unit).toBe('reports');
    expect(byId.included_studies.unit).toBe('studies');
    expect(byId.included_reports.unit).toBe('reports');
  });

  it('encodes the updated-review template as its own variant (§7)', () => {
    const ids = UPDATED_REVIEW_BOXES.map((b) => b.id);
    expect(ids).toContain('previous_studies');
    expect(ids).toContain('total_included_studies');
    expect(COLUMN_HEADERS.dbUpdated).toBe('Identification of new studies via databases and registers');
    expect(COLUMN_HEADERS.db).toBe('Identification of studies via databases and registers');
  });

  it('carries the official footnotes and citation', () => {
    expect(FOOTNOTES[0]).toMatch(/^\*Consider, if feasible/);
    expect(FOOTNOTES[1]).toMatch(/^\*\*If automation tools were used/);
    expect(SOURCE_CITATION).toContain('BMJ 2021;372:n71');
  });
});
