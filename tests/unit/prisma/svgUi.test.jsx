/**
 * 103.md §12/§16/§21 — the PRISMA 2020 diagram and its inspection layer.
 *
 * The assertions are about METHODOLOGICAL correctness, not pixels: which boxes
 * exist, which column they sit in, and whether a count can be traced to records.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  derivePrismaFlow, reconcilePrismaFlow, buildPrismaFlowSVG,
} from '../../../src/research-engine/prisma/index.js';
import {
  PrismaFlowDiagram, PrismaInspector, PrismaValidationBanner,
} from '../../../src/features/prisma/PrismaFlowDiagram.jsx';

let seq = 0;
const rec = (o = {}) => ({ id: `r${seq++}`, origin: 'search', sourceDb: 'PubMed', ...o });
const many = (n, o) => Array.from({ length: n }, () => rec(o));

const FLOW = derivePrismaFlow([
  ...many(1000, { isDuplicate: true, dedupStage: 'search' }),
  ...many(3000, { screeningDecision: 'exclude' }),
  ...many(50, { screeningDecision: 'include', soughtRetrieval: true, retrieved: false, notRetrievedReason: 'No open-access copy' }),
  ...many(600, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong population' }),
  ...many(150, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
  ...many(12, { origin: 'mining', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
]);

describe('§17/§21 — the diagram is PRISMA 2020, not the old single column', () => {
  const built = buildPrismaFlowSVG(FLOW, { perSource: true });

  it('draws BOTH identification columns', () => {
    expect(built.hasOther).toBe(true);
    expect(built.svg).toContain('Identification of studies via databases and registers');
    expect(built.svg).toContain('Identification of studies via other methods');
  });

  it('draws the retrieval boxes the old diagram lacked entirely', () => {
    expect(built.svg).toContain('Reports sought for retrieval');
    expect(built.svg).toContain('Reports not retrieved');
    const ids = built.boxes.map((b) => b.id);
    expect(ids).toContain('sought_db');
    expect(ids).toContain('not_retrieved_db');
    expect(ids).toContain('sought_other');
  });

  it('draws all three official removal sub-lines', () => {
    // 116.md §18 — the automation-tools sub-line WRAPS inside its box now (it
    // used to overflow ~300px of text into a 250px box), so the official wording
    // is asserted across the wrapped <text> runs rather than as one line.
    const textOnly = built.svg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(textOnly).toContain('Duplicate records removed');
    expect(textOnly).toContain('Records marked as ineligible by automation tools');
    expect(textOnly).toContain('Records removed for other reasons');
  });

  it('gives the other-methods column NO screening box', () => {
    // The commonest flow-diagram error. Only ONE "Records screened" may exist.
    expect(built.boxes.filter((b) => b.id === 'screened')).toHaveLength(1);
    expect(built.svg.match(/Records screened/g)).toHaveLength(1);
    expect(built.svg.match(/Records excluded\*\*/g)).toHaveLength(1);
  });

  it('shares ONE terminal box between the columns', () => {
    expect(built.boxes.filter((b) => b.id === 'included_studies')).toHaveLength(1);
    expect(built.svg).toContain('Studies included in review');
    expect(built.svg).toContain('Reports of included studies');
  });

  it('carries the official footnotes and citation', () => {
    expect(built.svg).toContain('Consider, if feasible to do so');
    expect(built.svg).toContain('BMJ 2021;372:n71');
  });

  it('renders counts straight from the flow — no export-time arithmetic (§16)', () => {
    expect(built.svg).toContain(`Records screened (n = ${FLOW.counts.screened})`);
    expect(built.svg).toContain(`Reports not retrieved (n = ${FLOW.boxes.not_retrieved_db.n})`);
    expect(built.svg).toContain(`Studies included in review (n = ${FLOW.counts.included})`);
  });

  it('keeps each column exclusion reasons to its own arm', () => {
    const f = derivePrismaFlow([
      ...many(5, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong population' }),
      ...many(2, { origin: 'mining', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong design' }),
    ]);
    expect(f.exclusionReasonsByArm.db.map((r) => r.label)).toEqual(['Wrong population']);
    expect(f.exclusionReasonsByArm.other.map((r) => r.label)).toEqual(['Wrong design']);
  });

  it('names the METHOD in the other-methods column, not the database', () => {
    // A record mined from a reference list is "Citation searching" even though its
    // sourceDb says PubMed — PRISMA asks how it was found.
    expect(FLOW.sources.other.map((s) => s.label)).toContain('Citation searching');
  });

  it('collapses to a single column when nothing came from other methods', () => {
    const single = buildPrismaFlowSVG(derivePrismaFlow(many(10, {})));
    expect(single.hasOther).toBe(false);
    expect(single.svg).not.toContain('Identification of studies via other methods');
  });

  it('switches to the updated-review template on request (§7)', () => {
    const upd = buildPrismaFlowSVG(FLOW, { updated: true });
    expect(upd.svg).toContain('Identification of new studies via databases and registers');
    expect(upd.svg).toContain('New studies included in review');
  });
});

describe('§12 — counts are inspectable', () => {
  it('every box is a labelled hit-target', () => {
    const html = renderToStaticMarkup(
      <PrismaFlowDiagram flow={FLOW} reconciliation={reconcilePrismaFlow(FLOW)} />,
    );
    expect(html).toContain('stitch-prisma-box-removed_before_screening');
    expect(html).toContain('stitch-prisma-box-excluded_full_text_db');
    expect(html).toContain('aria-label="Inspect Records screened');
  });

  it('the inspector explains the count and pages its records from the server (116.md §9/§11)', () => {
    // 116.md §11 — the record list is FETCHED (paginated box endpoint), never a
    // client-side filter over a shipped array; the initial render carries the
    // header, the §9.3 explanation and the loading state.
    const html = renderToStaticMarkup(
      <PrismaInspector boxId="excluded_screening" flow={FLOW} screenProjectId="sp1" />,
    );
    expect(html).toContain('Records excluded');
    expect(html).toContain(`n = ${FLOW.counts.excludedScreen}`);
    expect(html).toContain('resolved decisions'); // the explanation, not raw internals
    expect(html).toContain('stitch-prisma-search');
    expect(html).toContain('Loading records');
  });

  it('shows the §12 duplicate-stage breakdown', () => {
    const html = renderToStaticMarkup(
      <PrismaInspector boxId="removed_before_screening" flow={FLOW} records={[]} />,
    );
    expect(html).toContain('Removed during automated search');
  });

  it('is honest that import-discarded duplicates cannot be listed', () => {
    // The phantom count reaches the inspector two ways: the breakdown row here
    // (initial render), and the server's `uninspectable` notice once the box
    // endpoint responds (asserted in the loader/endpoint tests).
    const f = derivePrismaFlow(many(3, {}), { unrecordedDuplicates: 25 });
    const html = renderToStaticMarkup(
      <PrismaInspector boxId="removed_before_screening" flow={f} screenProjectId="sp1" />,
    );
    expect(html).toMatch(/not stored as records/i);
  });

  it('renders a plain diagram when interaction is off (export preview)', () => {
    const html = renderToStaticMarkup(<PrismaFlowDiagram flow={FLOW} interactive={false} />);
    expect(html).not.toContain('stitch-prisma-box-screened');
    expect(html).toContain('stitch-prisma-svg');
  });
});

describe('§13 — validation is never silent', () => {
  it('confirms a reconciling flow', () => {
    const html = renderToStaticMarkup(
      <PrismaValidationBanner reconciliation={reconcilePrismaFlow(FLOW)} />,
    );
    expect(html).toMatch(/reconciles/i);
  });

  it('raises an alert on a contradictory flow', () => {
    const broken = reconcilePrismaFlow({
      boxes: { included_studies: { n: 5, ids: [] }, included_reports: { n: 2, ids: [] } },
      counts: {}, removedBreakdown: {}, exclusionReasons: [], dispositions: {},
    });
    const html = renderToStaticMarkup(<PrismaValidationBanner reconciliation={broken} />);
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/does not reconcile/i);
  });
});

describe('empty state', () => {
  it('says the flow will populate rather than showing zeros', () => {
    const html = renderToStaticMarkup(<PrismaFlowDiagram flow={null} />);
    expect(html).toMatch(/will populate as searches run/i);
  });
});
