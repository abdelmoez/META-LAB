/**
 * robInstrumentSelector.test.jsx — the redesigned Assess tool selector
 * (115.md §6-§8, §32, §37-§39).
 *
 * The project renders UI to static markup with react-dom/server (no jsdom — see
 * tests/unit/rob-workspace-ui.test.jsx), so interaction rules are pinned through
 * the PURE helpers in instrumentCatalog.js plus the markup the selector produces
 * for a given state.
 *
 * THE LOAD-BEARING ASSERTIONS:
 *   · every registered instrument is reachable (the bug 115.md exists to fix was a
 *     two-entry hardcode that made a fully-implemented instrument unselectable);
 *   · a design mismatch WARNS and never blocks — and an UNKNOWN design produces no
 *     recommendation and no warning at all, rather than a guess dressed as
 *     guidance;
 *   · work that already exists for a study under another tool is surfaced before a
 *     second instrument is started (§39).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import InstrumentSelector, { ToolCard, ToolProvenance, firstSentence } from '../../src/frontend/rob/InstrumentSelector.jsx';
import {
  filterInstruments, splitByRecommendation, mismatchWarningFor,
  existingToolNotice, assessmentsForTool, designsInCatalogue, designLabelsFor,
} from '../../src/frontend/rob/instrumentCatalog.js';
import { ROB_TOOLS, ROB_DESIGNS } from '../../src/research-engine/rob/tools.js';

/** A catalogue row shaped exactly like the server's `instrumentCatalogue()` output. */
const row = (t) => ({
  id: t.id,
  label: t.label,
  sublabel: t.sublabel || '',
  name: t.label,
  abbreviation: t.abbreviation || t.label,
  instrumentVersion: t.version || '',
  organization: t.organization || '',
  description: t.description || '',
  designs: t.designs || [],
  scoringAllowed: !!t.scoringAllowed,
  consensusSupported: true,
  domainCount: 4,
  citation: t.citation || '',
  guidanceUrl: t.guidanceUrl || '',
  license: t.license || '',
});

const CATALOGUE = ROB_TOOLS.filter(t => t.status === 'active').map(row);
const byId = (id) => CATALOGUE.find(t => t.id === id);

const rec = (over = {}) => ({
  design: '', recommendedToolIds: [], compatibleToolIds: CATALOGUE.map(t => t.id),
  mismatchToolIds: [], warning: '', ...over,
});

const render = (props = {}) => renderToStaticMarkup(
  <InstrumentSelector catalogue={CATALOGUE} recommendation={rec()} initialShowAll {...props} />,
);

/* ── §7/§40 — every registered instrument is reachable ─────────────────────── */

describe('InstrumentSelector — the catalogue, not a hardcoded pair', () => {
  it('offers every ACTIVE registered instrument, not just RoB 2 and ROBINS-I', () => {
    const html = render();
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(13);
    for (const t of CATALOGUE) expect(html).toContain(t.label);
    // The specific regression: the Newcastle–Ottawa forms and the tools added by
    // 115.md must be selectable from Assess, not merely visible elsewhere.
    for (const id of ['NOS', 'NOS-CC', 'QUADAS-2', 'AMSTAR-2', 'JBI-CaseSeries', 'QUIPS', 'PROBAST']) {
      expect(html).toContain(byId(id).label);
    }
  });

  it('renders no tool at all when the catalogue is empty (never a hardcoded fallback)', () => {
    const html = renderToStaticMarkup(<InstrumentSelector catalogue={[]} recommendation={rec()} initialShowAll />);
    expect(html).not.toContain('RoB 2');
    expect(html).toContain('No assessment tool matches that filter.');
  });

  it('exposes the tool\'s design fit and one-line description on its card', () => {
    const html = renderToStaticMarkup(<ToolCard tool={byId('QUADAS-2')} onSelect={() => {}} />);
    expect(html).toContain('QUADAS-2');
    expect(html).toContain('Diagnostic test accuracy study');
  });
});

/* ── §32 — version / organization / citation / guidance ────────────────────── */

describe('ToolProvenance — the methodological identity of a tool (§32)', () => {
  const html = renderToStaticMarkup(<ToolProvenance tool={byId('QUADAS-2')} />);

  it('shows version, source organisation, citation and the official guidance link', () => {
    expect(html).toContain('2011');
    expect(html).toContain('University of Bristol');
    expect(html).toContain('Whiting PF');
    expect(html).toContain('bristol.ac.uk');
    expect(html).toContain('Official guidance');
  });

  it('states that a no-score instrument has no score (115.md decision 5)', () => {
    expect(html).toContain('No score');
    const nos = renderToStaticMarkup(<ToolProvenance tool={byId('NOS')} />);
    expect(nos).toContain('Additive score defined by the instrument');
  });
});

/* ── §6/§37 — recommend, never restrict ────────────────────────────────────── */

describe('splitByRecommendation — recommendations never remove options', () => {
  it('promotes the recommended tools and keeps every other tool available', () => {
    const { recommended, others } = splitByRecommendation(CATALOGUE, rec({ recommendedToolIds: ['QUADAS-2'] }));
    expect(recommended.map(t => t.id)).toEqual(['QUADAS-2']);
    expect(recommended.length + others.length).toBe(CATALOGUE.length);
    expect(others.some(t => t.id === 'QUADAS-2')).toBe(false);
  });

  it('yields no recommended section when the design could not be detected', () => {
    const { recommended, others } = splitByRecommendation(CATALOGUE, rec());
    expect(recommended).toEqual([]);
    expect(others.length).toBe(CATALOGUE.length);
  });

  it('renders the "Recommended for this study" section with the recorded design', () => {
    const html = render({ recommendation: rec({ design: 'randomised controlled trial', recommendedToolIds: ['RoB2'] }) });
    expect(html).toContain('Recommended for this study');
    expect(html).toContain('randomised controlled trial');
    expect(html).toContain('Recommended');
  });

  it('renders NO recommendation section for an unknown design', () => {
    const html = render();
    expect(html).not.toContain('Recommended for this study');
  });
});

/* ── §8 — search + design filter over the 13-design vocabulary ─────────────── */

describe('filterInstruments — search box + study-design filter (§8)', () => {
  it('filters by canonical design id', () => {
    expect(filterInstruments(CATALOGUE, { designId: 'case-control' }).map(t => t.id)).toEqual(['NOS-CC']);
    expect(filterInstruments(CATALOGUE, { designId: 'systematic-review' }).map(t => t.id)).toEqual(['AMSTAR-2']);
  });

  it('searches name, abbreviation, description, organisation AND design label', () => {
    expect(filterInstruments(CATALOGUE, { query: 'amstar' }).map(t => t.id)).toEqual(['AMSTAR-2']);
    expect(filterInstruments(CATALOGUE, { query: 'prognostic' }).map(t => t.id)).toContain('QUIPS');
    expect(filterInstruments(CATALOGUE, { query: 'joanna briggs' }).length).toBe(5);
    expect(filterInstruments(CATALOGUE, { query: 'diagnostic test accuracy' }).map(t => t.id)).toContain('QUADAS-2');
  });

  it('combines both filters and returns [] rather than a misleading fallback', () => {
    expect(filterInstruments(CATALOGUE, { query: 'amstar', designId: 'cohort' })).toEqual([]);
  });

  it('offers only designs that actually have a tool behind them', () => {
    const offered = designsInCatalogue(CATALOGUE).map(d => d.id);
    expect(offered.length).toBe(ROB_DESIGNS.length);
    for (const id of offered) expect(filterInstruments(CATALOGUE, { designId: id }).length).toBeGreaterThan(0);
  });

  it('labels a tool with the human design names, not the ids', () => {
    expect(designLabelsFor(byId('JBI-CaseReport'))).toEqual(['Case report']);
  });
});

/* ── §38 — warn intelligently, block never ─────────────────────────────────── */

describe('mismatchWarningFor — the §38 caution', () => {
  const rctRec = rec({
    design: 'randomised controlled trial',
    recommendedToolIds: ['RoB2'],
    mismatchToolIds: CATALOGUE.filter(t => t.id !== 'RoB2').map(t => t.id),
  });

  it('names the tool\'s intended design, the study\'s design and the better fit', () => {
    const w = mismatchWarningFor('QUADAS-2', CATALOGUE, rctRec);
    expect(w).toContain('QUADAS-2 is designed for diagnostic test accuracy studies');
    expect(w).toContain('randomised controlled trial');
    expect(w).toContain('RoB 2');
    expect(w).toContain('continue');
  });

  it('says nothing when the chosen tool IS the recommended one', () => {
    expect(mismatchWarningFor('RoB2', CATALOGUE, rctRec)).toBe('');
  });

  it('says nothing when the study design is unknown — silence beats a guess', () => {
    expect(mismatchWarningFor('QUADAS-2', CATALOGUE, rec())).toBe('');
    expect(mismatchWarningFor('QUADAS-2', CATALOGUE, rec({ design: 'ambispective chart audit' }))).toBe('');
  });

  it('renders the caution inline WITH an explicit continue, and never disables the tool', () => {
    const html = render({ recommendation: rctRec, initialToolId: 'QUADAS-2' });
    expect(html).toContain('is designed for diagnostic test accuracy studies');
    expect(html).toContain('Use QUADAS-2 anyway');
    // The tool card itself is still a live control — warning, not a block.
    expect(html).not.toContain('disabled=""><span style="font-size:13px;font-weight:800');
  });

  it('leaves the Start action gated until the mismatch is acknowledged (explicit continue)', () => {
    const html = render({ recommendation: rctRec, initialToolId: 'QUADAS-2' });
    expect(html).toContain('Confirm the design mismatch above first');
  });
});

/* ── §39 — changing tool never destroys the earlier assessment ─────────────── */

describe('existingToolNotice — tool-change safety (§39)', () => {
  const existing = [
    { id: 'a1', instrumentId: 'ROBINS-I', instrumentLabel: 'ROBINS-I', status: 'draft', resultLabel: 'Mortality', reviewerName: 'A. Reviewer' },
  ];

  it('names the tool and state of the work that already exists for the study', () => {
    const notice = existingToolNotice(existing, 'QUADAS-2');
    expect(notice).toContain('ROBINS-I');
    expect(notice).toContain('draft');
    expect(notice).toContain('leaves it untouched');
  });

  it('says nothing about assessments made with the tool being started', () => {
    expect(existingToolNotice(existing, 'ROBINS-I')).toBe('');
  });

  it('partitions the study\'s assessments by tool', () => {
    expect(assessmentsForTool(existing, 'ROBINS-I')).toHaveLength(1);
    expect(assessmentsForTool(existing, 'QUADAS-2')).toHaveLength(0);
  });

  it('renders the notice plus an open affordance for the earlier assessment', () => {
    const html = render({ existingAssessments: existing, initialToolId: 'QUADAS-2', onOpenExisting: () => {} });
    expect(html).toContain('ROBINS-I');
    expect(html).toContain('Open');
  });
});

/* ── small pure helpers ────────────────────────────────────────────────────── */

describe('firstSentence — a card shows a line, never a paragraph', () => {
  it('stops at the first sentence boundary', () => {
    expect(firstSentence('Four-domain tool. Every domain is judged.')).toBe('Four-domain tool.');
  });
  it('truncates a long unpunctuated description rather than overflowing the card', () => {
    const long = 'x'.repeat(400);
    expect(firstSentence(long).length).toBeLessThanOrEqual(180);
  });
});
