/**
 * 117.md §12-§22 / §57-§65 / §90 — MANUSCRIPT-SIDE PRISMA CANONICAL UNIFICATION.
 *
 * §90 asks for a representative project traced end to end, with the expected PRISMA
 * values calculated INDEPENDENTLY and then compared against what PecanRev reports on
 * every surface. That is what this file does: one hand-built record set whose numbers
 * are worked out in the fixture comment, then asserted against
 *
 *   - the canonical flow's own boxes                (research-engine/prisma)
 *   - the manuscript's adapted counts               (manuscript/prismaCounts)
 *   - the PRISMA counts TABLE                       (manuscript/tables)
 *   - the study-selection PARAGRAPH                 (manuscript/draft)
 *   - the live fact tokens                          (manuscript/factTokens)
 *   - the dependency fingerprint / contradictions / snapshots (no split brain)
 *   - the FIGURE builder the editor and every export choose
 *
 * plus the §21/§22 override overlay + audit, and source pins for the client wiring
 * (hook effects and SSE subscriptions cannot run under renderToStaticMarkup).
 *
 * The PANEL's rendered contract (§18 banner, §21 both-numbers + revert control) needs
 * JSX and therefore a .jsx file — see prismaSync117Ui.test.jsx.
 */
import { describe, it, expect } from 'vitest';

import { derivePrismaFlow, reconcilePrismaFlow } from '../../../src/research-engine/prisma/index.js';
import {
  computePrismaCounts,
  PRISMA_OVERRIDE_FIELDS, PRISMA_OVERRIDE_KEYS, PRISMA_OVERRIDE_LOG_CAP,
  prismaOverrideLabel, prismaOverrideOf, prismaOverrideMatches,
  setPrismaOverride, clearPrismaOverride,
} from '../../../src/research-engine/manuscript/prismaCounts.js';
import { buildPrismaCountsTable } from '../../../src/research-engine/manuscript/tables.js';
import { studySelectionParagraph } from '../../../src/research-engine/manuscript/draft.js';
import { resolveFacts, FACT_KEYS, FACTS } from '../../../src/research-engine/manuscript/factTokens.js';
import { computeDependencyState } from '../../../src/research-engine/manuscript/dependencies.js';
import { detectContradictions } from '../../../src/research-engine/manuscript/contradictions.js';
import { createSnapshot } from '../../../src/research-engine/manuscript/snapshots.js';
import { normalizeDraft, makeManuscriptDraft, readManuscripts } from '../../../src/research-engine/manuscript/model.js';
import { prismaSvg } from '../../../src/features/manuscript/export/figures.js';
import { readSource } from '../../helpers/readSource.js';

/* ════════════ the §90 fixture ════════════
 *
 * Seven records. Worked out by hand, independently of the code:
 *
 *   DATABASE ARM (PubMed) — 6 records
 *     r1  duplicate                              → removed before screening
 *     r2  excluded at title/abstract             → excluded (screening)
 *     r3  sought, NOT retrieved                  → report not retrieved
 *     r4  sought, retrieved, excluded full text  → report excluded (wrong population)
 *     r5  sought, retrieved, INCLUDED  study S1  → included report
 *     r6  sought, retrieved, INCLUDED  study S1  → included report of the SAME study
 *   OTHER-METHODS ARM (citation searching) — 1 record
 *     r7  sought, retrieved, INCLUDED  study S2  → included report
 *
 *   identified            = 6 + 1                       = 7
 *   duplicates removed    = 1                           = 1
 *   records screened      = (6 − 1) + (1 − 0)           = 6
 *   excluded (screening)  = 1                           = 1
 *   reports sought        = (r3,r4,r5,r6) + (r7)        = 5
 *   reports not retrieved = r3                          = 1
 *   reports assessed      = (r4,r5,r6) + (r7)           = 4
 *   reports excluded      = r4                          = 1
 *   reports of included studies = r5,r6,r7              = 3
 *   STUDIES included      = {S1, S2}                    = 2   ← NOT 3
 *   studies in synthesis  = {S1, S2}                    = 2
 */
const EXPECTED = Object.freeze({
  identified: 7,
  duplicatesRemoved: 1,
  screened: 6,
  excludedScreen: 1,
  sought: 5,
  notRetrieved: 1,
  reportsAssessed: 4,
  reportsExcluded: 1,
  includedReports: 3,
  included: 2,
  includedQuant: 2,
});

function projections() {
  const db = (id, extra) => ({ id, origin: 'search', sourceDb: 'PubMed', sourceDbKey: 'pubmed', ...extra });
  return [
    db('r1', { isDuplicate: true, dedupStage: 'import', dedupMethod: 'exact' }),
    db('r2', { screeningDecision: 'exclude' }),
    db('r3', { screeningDecision: 'include', soughtRetrieval: true, retrieved: false, notRetrievedReason: 'No full text available' }),
    db('r4', { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong population' }),
    db('r5', { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true, studyId: 'S1', inQuantitative: true }),
    db('r6', { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true, studyId: 'S1' }),
    { id: 'r7', origin: 'mining', sourceDb: 'PubMed', screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true, studyId: 'S2', inQuantitative: true },
  ];
}

/** The flow exactly as the wire delivers it: derived + reconciliation attached. */
function flowFixture() {
  const flow = derivePrismaFlow(projections());
  return { ...flow, reconciliation: reconcilePrismaFlow(flow) };
}

/**
 * A project whose LEGACY blob disagrees with the records on purpose — this is the
 * stale `project.prisma` snapshot MetaSiftPrismaSync stamps in, and the numbers are
 * deliberately nothing like the flow's so a single leaked legacy value is unmissable.
 */
function project() {
  return {
    id: 'p1',
    name: 'Statins',
    pico: { question: 'Do statins reduce MACE?' },
    search: { dbs: { pubmed: true } },
    prisma: { dbs: '999', reg: '0', other: '0', dedupe: '111', excTA: '222', excFull: '33', included: '44', quant: '44' },
    studies: [
      { id: 'S1', title: 'Trial A', authors: 'Smith J', year: '2020', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12' },
      { id: 'S2', title: 'Trial B', authors: 'Lee K', year: '2021', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06' },
    ],
  };
}

const draft = (over) => normalizeDraft({ ...makeManuscriptDraft({ nowIso: '2026-01-01T00:00:00.000Z' }), ...(over || {}) });

/* ════════════ §14/§90 — the manuscript reports the flow's numbers ════════════ */

describe('§14 — manuscript counts ARE the flow box values', () => {
  const flow = flowFixture();
  const pc = computePrismaCounts(project(), { flow });

  it('every stage matches the independently calculated expectation', () => {
    for (const [key, want] of Object.entries(EXPECTED)) {
      expect(pc.counts[key], key).toBe(want);
    }
  });

  it('matches the flow BOXES the diagram draws, box for box', () => {
    const b = flow.boxes;
    expect(pc.counts.identified).toBe(b.identified_db.n + b.identified_other.n);
    expect(pc.counts.sought).toBe(b.sought_db.n + b.sought_other.n);
    expect(pc.counts.notRetrieved).toBe(b.not_retrieved_db.n + b.not_retrieved_other.n);
    expect(pc.counts.reportsAssessed).toBe(b.assessed_db.n + b.assessed_other.n);
    expect(pc.counts.reportsExcluded).toBe(b.excluded_full_text_db.n + b.excluded_full_text_other.n);
    expect(pc.counts.included).toBe(b.included_studies.n);
    expect(pc.counts.includedReports).toBe(b.included_reports.n);
  });

  it('§15 — records, reports and studies stay three different numbers', () => {
    expect(pc.counts.identified).toBe(7);          // records
    expect(pc.counts.includedReports).toBe(3);     // reports
    expect(pc.counts.included).toBe(2);            // studies
  });

  it('the flow OUTRANKS the stale project.prisma blob (the §12 root cause)', () => {
    // Without the flow the legacy chain reports the MetaSiftPrismaSync snapshot…
    const legacy = computePrismaCounts(project(), {});
    expect(legacy.counts.identified).toBe(999);         // dbs 999 + reg 0 + other 0
    expect(legacy.provenance.dbs).toBe('manual');
    expect(legacy.counts.included).toBe(44);
    expect(legacy.provenance.included).toBe('manual');
    // …with it, not one legacy number survives, and every count is a record set.
    expect(pc.counts.identified).toBe(7);
    expect(pc.provenance.identified).toBe('records');
    expect(pc.provenance.included).toBe('records');
  });

  it('publishes the §18 reconciliation object alongside the counts', () => {
    expect(pc.reconciliation).toBeTruthy();
    expect(pc.reconciliation.ok).toBe(true);
    expect(pc.flow).toBe(flow);
  });
});

/* ════════════ §21/§22 — the override overlay ════════════ */

describe('§21 — a data override is an overlay, never a replacement', () => {
  const flow = flowFixture();

  it('marks provenance, keeps {value, auto}, and leaves the derived value intact', () => {
    const pc = computePrismaCounts(project(), { flow, overrides: { included: 3 } });
    expect(pc.counts.included).toBe(3);
    expect(pc.provenance.included).toBe('override');
    expect(pc.overrides.included).toEqual({ value: 3, auto: 2 });
    // Nothing else moved: the overlay touches exactly one field.
    expect(pc.counts.includedReports).toBe(EXPECTED.includedReports);
    expect(pc.provenance.includedReports).toBe('records');
    // The record sets behind the figure are untouched.
    expect(pc.flow.boxes.included_studies.n).toBe(2);
  });

  it('never applies silently — the override is stated as a warning', () => {
    const pc = computePrismaCounts(project(), { flow, overrides: { included: 3 } });
    expect(pc.warnings.some((w) => /manually overridden/i.test(w))).toBe(true);
    expect(pc.warnings.some((w) => /Studies included in review/.test(w))).toBe(true);
  });

  it('reverting to automatic restores the derived value exactly', () => {
    const overridden = computePrismaCounts(project(), { flow, overrides: { included: 3 } });
    const reverted = computePrismaCounts(project(), { flow, overrides: {} });
    expect(overridden.counts.included).toBe(3);
    expect(reverted.counts.included).toBe(overridden.overrides.included.auto);
    expect(reverted.provenance.included).toBe('records');
    expect(reverted.warnings.some((w) => /manually overridden/i.test(w))).toBe(false);
  });

  it('moves `dedupe` and its arithmetic twin `duplicatesRemoved` together', () => {
    const pc = computePrismaCounts(project(), { flow, overrides: { dedupe: 4 } });
    expect(pc.counts.dedupe).toBe(4);
    expect(pc.counts.duplicatesRemoved).toBe(4);
    expect(pc.provenance.duplicatesRemoved).toBe('override');
  });

  it('a project with NO overrides is untouched by the overlay', () => {
    const pc = computePrismaCounts(project(), { flow });
    expect(pc.overrides).toEqual({});
    expect(pc.warnings.some((w) => /manually overridden/i.test(w))).toBe(false);
  });

  it('the LEGACY path publishes the same {value, auto} shape', () => {
    // 999 identified is the legacy manual value; the override displaces it.
    const pc = computePrismaCounts(project(), { overrides: { identified: 500 } });
    expect(pc.counts.identified).toBe(500);
    expect(pc.provenance.identified).toBe('override');
    expect(pc.overrides.identified).toEqual({ value: 500, auto: 999 });
  });

  it('the flow-only fields are declared as such in the ONE registry', () => {
    const flowOnly = PRISMA_OVERRIDE_FIELDS.filter((f) => f.flowOnly).map((f) => f.key);
    expect(flowOnly).toEqual(['sought', 'notRetrieved', 'includedReports']);
    expect(PRISMA_OVERRIDE_KEYS).toContain('included');
    expect(prismaOverrideLabel('notRetrieved')).toBe('Reports not retrieved');
  });
});

describe('§22 — the manual-change audit on the draft', () => {
  it('records field / from / to / auto / at, and materializes only when non-empty', () => {
    const base = draft();
    expect(base.prismaOverrideLog).toBeUndefined();       // byte-stability: no phantom key

    const d1 = setPrismaOverride(base, 'included', 3, { auto: 2, nowIso: '2026-02-01T10:00:00.000Z' });
    expect(d1.prismaOverrides.included).toBe(3);
    expect(d1.prismaOverrideLog).toEqual([
      { field: 'included', from: null, to: 3, auto: 2, at: '2026-02-01T10:00:00.000Z' },
    ]);
    // The original draft is untouched (pure).
    expect(base.prismaOverrideLog).toBeUndefined();
    expect(base.prismaOverrides.included).toBeUndefined();
  });

  it('reverting DELETES the key and appends the reverting entry', () => {
    const d1 = setPrismaOverride(draft(), 'included', 3, { auto: 2, nowIso: 'A' });
    const d2 = clearPrismaOverride(d1, 'included', { auto: 2, nowIso: 'B' });
    expect(Object.prototype.hasOwnProperty.call(d2.prismaOverrides, 'included')).toBe(false);
    expect(prismaOverrideOf(d2, 'included')).toBeNull();
    expect(d2.prismaOverrideLog).toHaveLength(2);
    expect(d2.prismaOverrideLog[1]).toEqual({ field: 'included', from: 3, to: null, auto: 2, at: 'B' });
  });

  it('a no-op writes nothing at all', () => {
    const d1 = setPrismaOverride(draft(), 'included', 3, { auto: 2, nowIso: 'A' });
    expect(setPrismaOverride(d1, 'included', 3, { auto: 2, nowIso: 'B' })).toBe(d1);
    expect(clearPrismaOverride(draft(), 'included', { nowIso: 'B' })).not.toHaveProperty('prismaOverrideLog');
    // An unparseable value is ignored rather than stored as NaN.
    expect(setPrismaOverride(d1, 'included', 'twelve', { nowIso: 'C' })).toBe(d1);
  });

  it('caps the log, dropping the OLDEST entries', () => {
    let d = draft();
    for (let i = 1; i <= PRISMA_OVERRIDE_LOG_CAP + 5; i += 1) {
      d = setPrismaOverride(d, 'included', i, { auto: 2, nowIso: `t${i}` });
    }
    expect(d.prismaOverrideLog).toHaveLength(PRISMA_OVERRIDE_LOG_CAP);
    expect(d.prismaOverrideLog[0].to).toBe(6);            // 1..5 dropped
    expect(d.prismaOverrideLog[PRISMA_OVERRIDE_LOG_CAP - 1].to).toBe(PRISMA_OVERRIDE_LOG_CAP + 5);
  });

  it('an undo APPENDS a marked row rather than rewriting history (108.md)', () => {
    const d1 = setPrismaOverride(draft(), 'included', 3, { auto: 2, nowIso: 'A' });
    const d2 = setPrismaOverride(d1, 'included', null, { auto: 2, nowIso: 'B', via: 'undo' });
    expect(d2.prismaOverrideLog).toHaveLength(2);
    expect(d2.prismaOverrideLog[0]).not.toHaveProperty('via');   // the forward row is intact
    expect(d2.prismaOverrideLog[1].via).toBe('undo');
  });

  it('the §14 undo precondition refuses when the field moved', () => {
    const d1 = setPrismaOverride(draft(), 'included', 3, { auto: 2, nowIso: 'A' });
    expect(prismaOverrideMatches(d1, 'included', 3)).toBe(true);
    expect(prismaOverrideMatches(d1, 'included', null)).toBe(false);
    const d2 = setPrismaOverride(d1, 'included', 4, { auto: 2, nowIso: 'B' });
    expect(prismaOverrideMatches(d2, 'included', 3)).toBe(false);
    expect(prismaOverrideMatches(draft(), 'included', null)).toBe(true);
  });

  it('survives the persistence round trip, and never materializes on a clean draft', () => {
    const d1 = setPrismaOverride(draft(), 'included', 3, { auto: 2, nowIso: 'A' });
    // The blob path is readManuscripts → normalizeDraft; the log must come back
    // verbatim (it rides the additive spread, like factOverrides/factLog).
    const round = readManuscripts({ manuscripts: [d1] })[0];
    expect(round.prismaOverrideLog).toEqual(d1.prismaOverrideLog);
    expect(round.prismaOverrides.included).toBe(3);
    // …and a project that never overrode anything gains no key at all.
    expect(Object.prototype.hasOwnProperty.call(readManuscripts({ manuscripts: [draft()] })[0], 'prismaOverrideLog')).toBe(false);
  });

  it('optional reason/actor ride along without materializing when absent', () => {
    const d = setPrismaOverride(draft(), 'included', 3, {
      auto: 2, nowIso: 'A', by: 'Dr Smith', reason: 'One trial reported twice',
    });
    expect(d.prismaOverrideLog[0].by).toBe('Dr Smith');
    expect(d.prismaOverrideLog[0].reason).toBe('One trial reported twice');
    const plain = setPrismaOverride(draft(), 'included', 3, { auto: 2, nowIso: 'A' });
    expect(Object.keys(plain.prismaOverrideLog[0]).sort()).toEqual(['at', 'auto', 'field', 'from', 'to']);
  });
});

/* ════════════ §15 — the retrieval stage reaches the table and the prose ════════════ */

describe('§15 — records/reports/studies in the counts table', () => {
  const flow = flowFixture();

  it('adds the retrieval + included-reports rows WHEN the flow is present', () => {
    const t = buildPrismaCountsTable(computePrismaCounts(project(), { flow }));
    const stages = t.rows.map((r) => r.stage);
    expect(stages).toContain('Reports sought for retrieval');
    expect(stages).toContain('Reports not retrieved');
    expect(stages).toContain('Reports of included studies');
    const byStage = Object.fromEntries(t.rows.map((r) => [r.stage, r.n]));
    expect(byStage['Reports sought for retrieval']).toBe('5');
    expect(byStage['Reports not retrieved']).toBe('1');
    expect(byStage['Studies included in review']).toBe('2');
    expect(byStage['Reports of included studies']).toBe('3');
  });

  it('a LEGACY project keeps the exact previous row set (byte-stable)', () => {
    const t = buildPrismaCountsTable(computePrismaCounts(project(), {}));
    expect(t.rows.map((r) => r.stage)).toEqual([
      'Records identified',
      'Duplicate records removed',
      'Records screened',
      'Records excluded (screening)',
      'Reports assessed for eligibility',
      'Reports excluded (full text)',
      'Studies included in review',
      'Studies in meta-analysis',
    ]);
    expect(t.note).toBe('Counts resolved from manual PRISMA entries, overrides, and live screening data. "[not recorded]" marks values you must enter.');
  });

  it('labels an overridden row "override" in the Source column', () => {
    const t = buildPrismaCountsTable(computePrismaCounts(project(), { flow, overrides: { included: 3 } }));
    const row = t.rowsWithProvenance.find((r) => r.stage === 'Studies included in review');
    expect(row.n).toBe('3');
    expect(row.source).toBe('override');
    // Its neighbours still say the count came from records.
    expect(t.rowsWithProvenance.find((r) => r.stage === 'Records identified').source).toBe('records');
  });
});

describe('§15 — the study-selection paragraph', () => {
  const flow = flowFixture();

  it('states the retrieval clause when the flow is present', () => {
    const p = studySelectionParagraph(computePrismaCounts(project(), { flow }));
    expect(p).toContain('7 records were identified');
    expect(p).toContain('6 records were screened');
    expect(p).toContain('5 reports were sought for retrieval (1 could not be retrieved)');
    expect(p).toContain('4 reports were assessed for eligibility');
    expect(p).toContain('2 studies met the inclusion criteria');
  });

  it('a LEGACY project keeps its exact previous sentence (byte-identical)', () => {
    const p = studySelectionParagraph(computePrismaCounts(project(), {}));
    expect(p).toBe(
      '999 records were identified, of which 111 duplicates were removed; 888 records were screened,'
      + ' 666 reports were assessed for eligibility, and 44 studies met the inclusion criteria.'
      + ' The study-selection process is shown in the PRISMA 2020 flow diagram (Figure 1).',
    );
    expect(p).not.toContain('sought for retrieval');
  });
});

/* ════════════ §15 — the live fact tokens ════════════ */

describe('§15 — the retrieval facts are live tokens', () => {
  const flow = flowFixture();

  it('registers the three new facts against the prisma.counts dependency key', () => {
    for (const k of ['prisma.reportsSought', 'prisma.notRetrieved', 'prisma.includedReports']) {
      expect(FACT_KEYS).toContain(k);
      expect(FACTS[k].depKey).toBe('prisma.counts');
    }
  });

  it('resolves them from the canonical flow', () => {
    const f = resolveFacts(project(), { prismaCounts: computePrismaCounts(project(), { flow }) });
    expect(f['prisma.reportsSought'].raw).toBe('5');
    expect(f['prisma.notRetrieved'].raw).toBe('1');
    expect(f['prisma.includedReports'].raw).toBe('3');
    expect(f['prisma.included'].raw).toBe('2');
  });

  it('never fabricates them on a legacy project (§17)', () => {
    const f = resolveFacts(project(), { prismaCounts: computePrismaCounts(project(), {}) });
    expect(f['prisma.reportsSought'].missing).toBe(true);
    expect(f['prisma.reportsSought'].value).toBe('[Reports sought for retrieval — not yet available]');
    expect(f['prisma.includedReports'].missing).toBe(true);
  });
});

/* ════════════ §12/§57 — the figure builder choice ════════════ */

describe('§12/§57 — one PRISMA figure, one derivation', () => {
  const flow = flowFixture();

  it('prismaSvg draws the CANONICAL two-column figure when the result carries a flow', () => {
    const svg = prismaSvg(computePrismaCounts(project(), { flow }));
    expect(svg).toContain('Identification of studies via databases and registers');
    expect(svg).toContain('Identification of studies via other methods');
    expect(svg).toContain('Reports sought for retrieval');
    // …and it shows the RECORD-derived numbers, not the stale blob's. PRISMA 2020
    // draws identification PER ARM (6 + 1), never as one total, and the terminal box
    // carries both units — which is exactly the §15 distinction the legacy figure lost.
    expect(svg).toContain('Records identified from*: (n = 6)');
    expect(svg).toContain('Records identified from: (n = 1)');
    expect(svg).toContain('Studies included in review (n = 2)');
    expect(svg).toContain('Reports of included studies (n = 3)');
    expect(svg).not.toContain('999');
  });

  it('falls back to the legacy single-column figure without a flow', () => {
    const svg = prismaSvg(computePrismaCounts(project(), {}));
    expect(svg).not.toContain('Identification of studies via other methods');
    expect(svg).toContain('999');
  });

  it('an explicit opts.flow selects the canonical builder too (repro/report paths)', () => {
    const svg = prismaSvg({}, { flow });
    expect(svg).toContain('Identification of studies via databases and registers');
  });
});

/* ════════════ §12/§57 — no split brain ════════════ */

describe('§57 — dependency state, contradictions and snapshots read the DISPLAY result', () => {
  const flow = flowFixture();
  const p = project();
  const display = computePrismaCounts(p, { flow, overrides: { included: 3 } });

  it('the prisma.counts fingerprint is computed from the displayed counts', () => {
    const withDisplay = computeDependencyState(p, { flow, prismaCounts: display });
    // A dep state computed WITHOUT the caller's result would re-derive un-overridden
    // numbers and produce a different hash — that difference is the split brain.
    const reDerived = computeDependencyState(p, { flow });
    expect(withDisplay['prisma.counts']).not.toBe(reDerived['prisma.counts']);
    // Passing the same result twice is stable (a hash of the same object).
    expect(computeDependencyState(p, { flow, prismaCounts: display })['prisma.counts'])
      .toBe(withDisplay['prisma.counts']);
  });

  it('contradictions compare the manuscript against the DISPLAYED count', () => {
    // The manuscript states 3 — exactly what the override made the project report.
    const d = draft({ sections: { results: { content: '3 studies were included in the review.' } } });
    const clean = detectContradictions(p, d, { prismaCounts: display });
    expect(clean.find((c) => c.id === 'included-count')).toBeUndefined();
    // Against the un-overridden derivation the SAME sentence would be flagged, which
    // is the false alarm the unification removes.
    const stale = detectContradictions(p, d, { prismaCounts: computePrismaCounts(p, { flow }) });
    expect(stale.find((c) => c.id === 'included-count')).toBeTruthy();
  });

  it('a snapshot stores the counts the manuscript actually stated', () => {
    const { snapshot } = createSnapshot(draft(), p, {
      nowIso: '2026-03-01T00:00:00.000Z',
      genOpts: { flow, prismaCounts: display },
    });
    expect(snapshot.prismaCounts.included).toBe(3);
    expect(snapshot.prismaCounts.sought).toBe(5);
  });

  it('the fact layer, the table and the paragraph all read ONE object', () => {
    const facts = resolveFacts(p, { prismaCounts: display });
    const table = buildPrismaCountsTable(display);
    const para = studySelectionParagraph(display);
    expect(facts['prisma.included'].raw).toBe('3');
    expect(table.rows.find((r) => r.stage === 'Studies included in review').n).toBe('3');
    expect(para).toContain('3 studies met the inclusion criteria');
  });
});

/* ════════════ client wiring pins (effects/SSE cannot run under SSR) ════════════ */

describe('§12/§13 — useManuscript wiring (source pins)', () => {
  const s = readSource(new URL('../../../src/features/manuscript/useManuscript.js', import.meta.url));

  it('threads the canonical flow into BOTH computePrismaCounts call sites', () => {
    const occurrences = s.split('...(sources.prismaFlow ? { flow: sources.prismaFlow } : {})').length - 1;
    expect(occurrences).toBe(1);                                   // the display memo
    expect(s).toContain('...(fresh.prismaFlow ? { flow: fresh.prismaFlow } : {})'); // prepareExport
  });

  it('subscribes to the three PRISMA-moving pokes and debounces them', () => {
    expect(s).toContain("'record.updated': onPrismaPoke");
    expect(s).toContain("'decision.saved': onPrismaPoke");
    expect(s).toContain("'handoff.updated': onPrismaPoke");
    expect(s).toContain('shouldReloadForRecordPoke(ev, screenPid)');
    expect(s).toContain('refreshSourcesRef.current();');
    expect(s).toMatch(/\}, 2000\);/);
  });

  it('covers the same-user second tab, which the bus excludes from its pokes', () => {
    expect(s).toContain("document.addEventListener('visibilitychange', onVisible)");
    expect(s).toContain("document.removeEventListener('visibilitychange', onVisible)");
    expect(s).toContain("if (document.visibilityState !== 'visible') return;");
    expect(s).toContain('VISIBILITY_REFRESH_THROTTLE_MS');
  });

  it('registers the §22 undo executor and re-validates the precondition', () => {
    expect(s).toContain("registerExecutor('manuscript.prismaOverride'");
    expect(s).toContain('prismaOverrideMatches(d, op.field, op.expect)');
    expect(s).toContain('setPrismaOverride(cur, op.field, op.value');
    expect(s).toContain("via: (ctx && ctx.direction) === 'redo' ? 'redo' : 'undo'");
    expect(s).toContain('offPrisma();');
  });

  it('records the override entry with the exact inverse on both sides', () => {
    expect(s).toContain("kind: 'manuscript.prismaOverride'");
    expect(s).toContain('undoOp: { draftId, field, value: prev, auto, expect: to }');
    expect(s).toContain('redoOp: { draftId, field, value: to, auto, expect: prev }');
    expect(s).toContain('if (prev === to) return null;');
  });

  it('captures the pre-image BEFORE the write, and exposes the flow to exporters', () => {
    const at = s.indexOf('const writePrismaOverride');
    const body = s.slice(at, at + 1400);
    expect(body.indexOf('prismaOverrideOf(before, field)')).toBeLessThan(body.indexOf('mutateActive('));
    expect(s).toContain('prismaFlow: sources.prismaFlow');
  });
});

describe('§12 — export + report paths choose the canonical figure (source pins)', () => {
  it('the repro bundle and the .docx accept the flow', () => {
    const repro = readSource(new URL('../../../src/features/manuscript/export/manuscriptRepro.js', import.meta.url));
    expect(repro).toContain('...(opts.prismaFlow ? { flow: opts.prismaFlow } : {})');
    const docx = readSource(new URL('../../../src/features/manuscript/export/manuscriptDocx.js', import.meta.url));
    expect(docx).toContain('...(opts.prismaFlow ? { flow: opts.prismaFlow } : {})');
    const ws = readSource(new URL('../../../src/features/manuscript/ManuscriptWorkspace.jsx', import.meta.url));
    expect(ws).toContain('prismaFlow: m.prismaFlow');
  });

  it('the legacy Workspace report + journal ZIP fetch and draw the canonical flow', () => {
    const w = readSource(new URL('../../../src/frontend/workspace/Workspace.jsx', import.meta.url));
    expect(w).toContain('const fetchCanonicalPrismaFlow=async()=>{');
    expect(w).toContain('const prismaFig=flow?buildPrismaFlowSVG(flow,{title:"",perSource:true}):buildPrismaSVG(pr,{title:""});');
    expect(w).toContain('const canonicalFlow=await fetchCanonicalPrismaFlow();');
    expect(w).toContain('buildReportHTML(prec,canonicalFlow)');
    expect(w).toContain('buildReportHTML(choice.precision,await fetchCanonicalPrismaFlow())');
  });
});

describe('§13 — the server pokes once per import burst (source pin)', () => {
  const s = readSource(new URL('../../../server/services/screeningImportService.js', import.meta.url));

  it('debounces per project and emits a single ids-free record.updated', () => {
    expect(s).toContain('export function pokeImportLanded(projectId)');
    expect(s).toContain("emitToProjectMembers(projectId, { type: 'record.updated' })");
    expect(s).toContain('if (prev) clearTimeout(prev);');
    expect(s).toContain('if (typeof t.unref === \'function\') t.unref();');
  });

  it('fires only when the record set actually moved', () => {
    expect(s).toContain('if (imported > 0 || skippedDuplicates > 0 || updated > 0) pokeImportLanded(projectId);');
  });
});
