/**
 * 117.md §18/§21 — the Manuscript Editor's PRISMA panel (SSR contract tests, house
 * style: renderToStaticMarkup, no jsdom — interaction is asserted by control presence).
 *
 * Split from prismaSync117.test.js because JSX needs a .jsx extension in this repo's
 * vitest transform; the engine-level assertions for the same round live there.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { derivePrismaFlow, reconcilePrismaFlow } from '../../../src/research-engine/prisma/index.js';
import { computePrismaCounts } from '../../../src/research-engine/manuscript/prismaCounts.js';
import { buildPrismaCountsTable } from '../../../src/research-engine/manuscript/tables.js';
import { normalizeDraft, makeManuscriptDraft } from '../../../src/research-engine/manuscript/model.js';
import { PrismaPanel, PrismaReconciliationBanner, PrismaOverrideField } from '../../../src/features/manuscript/manuscriptPanels.jsx';

/* The §90 fixture, mirrored from prismaSync117.test.js (7 records → 2 studies /
   3 reports); see that file's header for the hand-worked expectations. */
function projections() {
  const db = (id, extra) => ({ id, origin: 'search', sourceDb: 'PubMed', sourceDbKey: 'pubmed', ...extra });
  return [
    db('r1', { isDuplicate: true, dedupStage: 'import', dedupMethod: 'exact' }),
    db('r2', { screeningDecision: 'exclude' }),
    db('r3', { screeningDecision: 'include', soughtRetrieval: true, retrieved: false }),
    db('r4', { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong population' }),
    db('r5', { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true, studyId: 'S1', inQuantitative: true }),
    db('r6', { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true, studyId: 'S1' }),
    { id: 'r7', origin: 'mining', sourceDb: 'PubMed', screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true, studyId: 'S2', inQuantitative: true },
  ];
}
function flowFixture() {
  const flow = derivePrismaFlow(projections());
  return { ...flow, reconciliation: reconcilePrismaFlow(flow) };
}
function project() {
  return {
    id: 'p1', name: 'Statins', pico: { question: 'Q' }, search: { dbs: { pubmed: true } },
    prisma: { dbs: '999', reg: '0', other: '0', dedupe: '111', excTA: '222', excFull: '33', included: '44', quant: '44' },
    studies: [],
  };
}
const draft = (over) => normalizeDraft({ ...makeManuscriptDraft({ nowIso: '2026-01-01T00:00:00.000Z' }), ...(over || {}) });

function mockM(over = {}) {
  const d = draft(over.draftOver);
  const pc = over.prismaCounts || computePrismaCounts(project(), { flow: flowFixture() });
  return {
    activeDraft: d,
    activeId: d.id,
    prismaCounts: pc,
    tables: { prisma: buildPrismaCountsTable(pc) },
    prismaOverrideLog: d.prismaOverrideLog || [],
    setPrismaOverride: () => {},
    revertPrismaOverride: () => {},
    primary: null,
    ...over.m,
  };
}
const exporters = { onPrismaChecklist: () => {}, onPrismaSChecklist: () => {}, exporting: null, exportError: '' };

describe('§21 — PrismaPanel shows both numbers and a revert control', () => {
  it('renders "Automated value → Manual override" and a per-field revert', () => {
    const flow = flowFixture();
    const html = renderToStaticMarkup(
      <PrismaPanel exporters={exporters} m={mockM({
        prismaCounts: computePrismaCounts(project(), { flow, overrides: { included: 3 } }),
        draftOver: { prismaOverrides: { included: 3 } },
      })} />,
    );
    expect(html).toContain('Automated value:');
    expect(html).toContain('Manual override:');
    expect(html).toContain('Revert to automatic');
    expect(html).toContain('data-testid="prisma-override-included"');
  });

  it('offers the retrieval fields ONLY when the canonical flow is present', () => {
    const withFlow = renderToStaticMarkup(<PrismaPanel exporters={exporters} m={mockM()} />);
    expect(withFlow).toContain('data-testid="prisma-override-sought"');
    expect(withFlow).toContain('data-testid="prisma-override-notRetrieved"');

    const legacy = renderToStaticMarkup(
      <PrismaPanel exporters={exporters} m={mockM({ prismaCounts: computePrismaCounts(project(), {}) })} />,
    );
    expect(legacy).not.toContain('data-testid="prisma-override-sought"');
    expect(legacy).toContain('data-testid="prisma-override-included"');
  });

  it('shows the §22 history once entries exist, and not before', () => {
    const none = renderToStaticMarkup(<PrismaPanel exporters={exporters} m={mockM()} />);
    expect(none).not.toContain('data-testid="prisma-override-log"');

    const logged = renderToStaticMarkup(<PrismaPanel exporters={exporters} m={mockM({
      m: { prismaOverrideLog: [{ field: 'included', from: null, to: 3, auto: 2, at: '2026-02-01T10:00:00.000Z' }] },
    })} />);
    expect(logged).toContain('data-testid="prisma-override-log"');
    expect(logged).toContain('Override history');
    expect(logged).toContain('Studies included in review');
  });

  it('a single field renders both numbers on its own', () => {
    const html = renderToStaticMarkup(
      <PrismaOverrideField field="included" label="Studies included in review" auto={2} value={3}
        onApply={() => {}} onRevert={() => {}} />,
    );
    expect(html).toContain('Automated value:');
    expect(html).toContain('Revert to automatic');
    const clean = renderToStaticMarkup(
      <PrismaOverrideField field="included" label="Studies included in review" auto={2} value={null}
        onApply={() => {}} onRevert={() => {}} />,
    );
    expect(clean).toContain('Automated value: 2');
    expect(clean).not.toContain('Revert to automatic');
  });
});

describe('§18 — the reconciliation banner is non-intrusive', () => {
  it('renders nothing while the flow reconciles', () => {
    expect(renderToStaticMarkup(<PrismaReconciliationBanner reconciliation={reconcilePrismaFlow(derivePrismaFlow(projections()))} />)).toBe('');
    expect(renderToStaticMarkup(<PrismaReconciliationBanner reconciliation={null} />)).toBe('');
  });

  it('states the issue count and the first messages when it does not', () => {
    const html = renderToStaticMarkup(<PrismaReconciliationBanner reconciliation={{
      ok: false,
      issues: [
        { id: 'a', severity: 'error', message: 'Records screened: 6 ≠ 5.' },
        { id: 'b', severity: 'warning', message: 'Nothing has been screened yet.' },
        { id: 'c', severity: 'warning', message: 'An unusually large not-retrieved count.' },
        { id: 'd', severity: 'info', message: 'Reporting guidance.' },
      ],
    }} />);
    expect(html).toContain('This PRISMA flow does not reconcile');
    expect(html).toContain('(3 issues)');            // the info row is not an issue
    expect(html).toContain('Records screened: 6 ≠ 5.');
    expect(html).toContain('+1 more');
    expect(html).not.toContain('Reporting guidance.');
  });

  it('appears inside the panel when the flow is inconsistent, and says it ONCE', () => {
    const flow = flowFixture();
    const broken = { ...flow, reconciliation: { ok: false, issues: [{ id: 'x', severity: 'error', message: 'Boom.' }] } };
    const html = renderToStaticMarkup(
      <PrismaPanel exporters={exporters} m={mockM({ prismaCounts: computePrismaCounts(project(), { flow: broken }) })} />,
    );
    expect(html).toContain('data-testid="manuscript-prisma-reconciliation"');
    // adaptFlow also maps reconciliation issues onto the legacy warnings channel;
    // the banner owns them here, so the panel must not repeat them underneath.
    expect(html.split('Boom.').length - 1).toBe(1);
  });

  it('still lists warnings the banner does NOT own (e.g. the override notice)', () => {
    const flow = flowFixture();
    const html = renderToStaticMarkup(
      <PrismaPanel exporters={exporters} m={mockM({
        prismaCounts: computePrismaCounts(project(), { flow, overrides: { included: 9 } }),
        draftOver: { prismaOverrides: { included: 9 } },
      })} />,
    );
    expect(html).toContain('manually overridden');
  });
});

