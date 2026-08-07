/**
 * 101.md §6/§7/§8/§9/§34/§35 — the Show-Changes visual system and the two surfaces
 * that explain it.
 *
 * Repo convention: react-dom/server static markup (no jsdom). These assert the
 * contract rather than the pixels — every fact engine is painted, no origin is
 * distinguished by colour ALONE, the provenance card renders all six §9 fields, and
 * the panel collapses one research action into one entry (§14/§34).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ENGINE_STYLE, ENGINE_ORDER, LEGEND_ITEMS, SHOW_CHANGES_CSS,
  engineStyle, indexFactChanges, changeSummary, factChipTitle,
  formatChangeDate, formatChangeTime, formatChangeStamp,
} from '../../../src/features/manuscript/showChanges.js';
import { FactProvenanceCard, EngineBadge } from '../../../src/features/manuscript/FactProvenanceCard.jsx';
import { ChangeTrackingPanel, ShowChangesLegend } from '../../../src/features/manuscript/ChangeTrackingPanel.jsx';
import { RichSectionEditor, RICH_EDITOR_CSS } from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import { FACT_ENGINE_IDS, resolveFacts } from '../../../src/research-engine/manuscript/factTokens.js';
import { reconcileFacts, groupChanges } from '../../../src/research-engine/manuscript/factProvenance.js';

const noop = () => {};

/* ════════════ the colour system (§7 / §35) ════════════ */

describe('ENGINE_STYLE — every originating engine is painted', () => {
  it('has an entry for every FACT_ENGINES id', () => {
    for (const id of FACT_ENGINE_IDS) {
      expect(ENGINE_STYLE[id], `missing paint for engine "${id}"`).toBeTruthy();
      expect(ENGINE_STYLE[id].id).toBe(id);
    }
  });

  it('also paints the two non-engine origins §7 names', () => {
    expect(ENGINE_STYLE.manual.label).toBe('Manual manuscript edit');
    // §38 — history whose origin was never recorded is labelled honestly
    expect(ENGINE_STYLE.other.label).toBe('Unattributed change');
    expect(ENGINE_ORDER).toEqual([...FACT_ENGINE_IDS, 'manual', 'other']);
  });

  it('never distinguishes an origin by colour alone — each has a label AND a glyph', () => {
    const glyphs = new Set();
    const labels = new Set();
    for (const e of LEGEND_ITEMS) {
      expect(e.label, e.id).toBeTruthy();
      expect(e.short, e.id).toBeTruthy();
      expect(e.glyph, e.id).toBeTruthy();
      glyphs.add(e.glyph);
      labels.add(e.label);
    }
    // distinctness is what makes the non-colour channel actually informative
    expect(glyphs.size).toBe(LEGEND_ITEMS.length);
    expect(labels.size).toBe(LEGEND_ITEMS.length);
  });

  it('carries a light ink AND a dark twin, and a var() with a hex fallback', () => {
    for (const e of LEGEND_ITEMS) {
      expect(e.ink, e.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(e.dark, e.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(e.ink).not.toBe(e.dark);
      expect(e.cssVar).toBe(`var(--ms-eng-${e.id}, ${e.ink})`);
    }
  });

  it('an unknown engine id resolves to the honest fallback, never to a wrong engine', () => {
    expect(engineStyle('nope').id).toBe('other');
    expect(engineStyle(null).id).toBe('other');
    expect(engineStyle('search').id).toBe('search');
  });
});

describe('SHOW_CHANGES_CSS — the toggle is a pure CSS switch (§6)', () => {
  const paintRules = SHOW_CHANGES_CSS
    .split('\n')
    .filter((l) => l.includes('.ms-fact'));

  it('scopes EVERY .ms-fact rule under [data-show-changes="true"]', () => {
    expect(paintRules.length).toBeGreaterThan(0);
    for (const rule of paintRules) {
      expect(rule, rule).toContain('[data-show-changes="true"]');
    }
  });

  it('paints each engine with its own ink and its own glyph', () => {
    for (const e of LEGEND_ITEMS) {
      expect(SHOW_CHANGES_CSS).toContain(`span.ms-fact[data-engine="${e.id}"]{text-decoration-color:${e.ink};}`);
      expect(SHOW_CHANGES_CSS).toContain(`content:"${e.glyph}"`);
    }
  });

  it('defines theme-aware ink tokens for chrome outside the white page', () => {
    expect(SHOW_CHANGES_CSS).toContain(':root{');
    expect(SHOW_CHANGES_CSS).toContain(':root[data-theme="night"]{');
    expect(SHOW_CHANGES_CSS).toContain(`--ms-eng-search:${ENGINE_STYLE.search.ink};`);
    expect(SHOW_CHANGES_CSS).toContain(`--ms-eng-search:${ENGINE_STYLE.search.dark};`);
  });

  it('uses no animation or transition, so it is reduced-motion-safe by construction (§35)', () => {
    const declarations = SHOW_CHANGES_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations).not.toContain('transition');
    expect(declarations).not.toContain('animation');
  });

  it('ships inside RICH_EDITOR_CSS, and the resting chip inherits everything (§6)', () => {
    expect(RICH_EDITOR_CSS).toContain(SHOW_CHANGES_CSS);
    expect(RICH_EDITOR_CSS).toContain('.ms-page-body .ms-fact{background:none;border:0;');
  });
});

describe('change helpers (§8)', () => {
  it('indexFactChanges accepts a log, a keyed object, a Map or a Set', () => {
    const log = [
      { key: 'search.date', from: 'a', to: 'b' },
      { key: 'search.date', from: 'b', to: 'c' },
      { key: 'prisma.included', from: '1', to: '2' },
    ];
    const idx = indexFactChanges(log);
    expect(idx.size).toBe(2);
    expect(idx.get('search.date').to).toBe('c'); // latest wins
    expect(indexFactChanges(new Set(['x'])).has('x')).toBe(true);
    expect(indexFactChanges({ x: null }).has('x')).toBe(true);
    expect(indexFactChanges(new Map([['x', { key: 'x' }]])).get('x').key).toBe('x');
    expect(indexFactChanges(null).size).toBe(0);
  });

  it('changeSummary states the §8 before/after in one line', () => {
    expect(changeSummary({ from: 'three', to: 'four' })).toBe('three → four');
    expect(changeSummary({ from: null, to: 'four' })).toBe('four');
    expect(changeSummary(null)).toBe('');
  });

  it('formats dates in UTC so a search date cannot drift across timezones', () => {
    expect(formatChangeDate('2026-08-06T09:15:00.000Z')).toBe('August 6, 2026');
    expect(formatChangeTime('2026-08-06T09:15:00.000Z')).toBe('09:15');
    expect(formatChangeStamp('2026-08-06T09:15:00.000Z')).toBe('August 6, 2026 · 09:15');
    expect(formatChangeStamp('')).toBe('');
  });

  it('factChipTitle names the field and the engine — colour is never the only channel', () => {
    const fact = { key: 'search.date', label: 'Date of the most recent search', engine: 'search', missing: false };
    const t = factChipTitle('search.date', fact, {
      key: 'search.date', from: 'July 1, 2026', to: 'August 6, 2026',
      at: '2026-08-06T09:15:00.000Z', reason: 'Updated PubMed and Embase searches executed',
    });
    expect(t).toContain('Date of the most recent search');
    expect(t).toContain('Search Engine');
    expect(t).toContain('July 1, 2026 → August 6, 2026');
    expect(t).toContain('Updated PubMed and Embase searches executed');
  });

  it('a missing fact says so in the tooltip rather than implying a value (§17)', () => {
    const t = factChipTitle('analysis.model', { label: 'Synthesis model', engine: 'analysis', missing: true, hint: 'Choose a synthesis model.' }, null);
    expect(t).toContain('Not yet available');
    expect(t).toContain('Choose a synthesis model.');
  });
});

/* ════════════ the editor root (§6) ════════════ */

describe('RichSectionEditor — the Show Changes toggle only sets an attribute', () => {
  const md = 'Databases were searched to [[fact:search.date]].';
  const facts = resolveFacts({ pico: {}, studies: [], prisma: {} }, {
    searchProvenance: { reportable: [{ label: 'PubMed', kind: 'database' }], latestValidSearchAt: '2026-08-06T00:00:00.000Z' },
  });
  const text = (html) => String(html).replace(/<[^>]*>/g, '');

  it('renders the same words in both modes; only data-show-changes differs', () => {
    const off = renderToStaticMarkup(<RichSectionEditor value={md} facts={facts} onChange={noop} />);
    const on = renderToStaticMarkup(<RichSectionEditor value={md} facts={facts} showChanges onChange={noop} />);
    expect(text(off)).toBe(text(on));
    expect(off).toContain('data-show-changes="false"');
    expect(on).toContain('data-show-changes="true"');
    expect(text(on)).toContain('August 6, 2026');
    expect(on).not.toContain('[[fact:');
  });

  it('the chip is unstyled prose in both modes — no inline styling ever', () => {
    const on = renderToStaticMarkup(<RichSectionEditor value={md} facts={facts} showChanges onChange={noop} />);
    expect(on).toMatch(/<span class="ms-fact"[^>]*>/);
    expect(on.match(/<span class="ms-fact"[^>]*>/)[0]).not.toContain('style=');
  });
});

/* ════════════ the provenance card (§9 / §10) ════════════ */

describe('FactProvenanceCard — all six §9 fields', () => {
  const change = {
    id: 'fc_1', groupId: 'grp_1', key: 'search.date',
    label: 'Date of the most recent search', engine: 'search', engineLabel: 'Search Engine',
    from: 'July 1, 2026', to: 'August 6, 2026', at: '2026-08-06T09:15:00.000Z',
    reason: 'Updated PubMed and Embase searches executed',
    actorName: 'R. Okafor', eventId: 'ev_9f3', correlationId: 'tx_2b7',
  };
  const fact = {
    key: 'search.date', label: 'Date of the most recent search', engine: 'search',
    engineLabel: 'Search Engine', value: 'August 6, 2026', raw: 'August 6, 2026', missing: false, hint: '',
  };
  const sections = ['Methods → Information sources', 'Methods → Search strategy'];
  const html = renderToStaticMarkup(
    <FactProvenanceCard change={change} fact={fact} sections={sections} onRevert={noop} onKeep={noop} />,
  );

  it('renders Updated by, Changed, Reason, Previous, Current and Affected field', () => {
    expect(html).toContain('Updated by');
    expect(html).toContain('Search Engine');
    expect(html).toContain('Changed');
    expect(html).toContain('August 6, 2026');
    expect(html).toContain('Reason');
    expect(html).toContain('Updated PubMed and Embase searches executed');
    expect(html).toContain('Previous value');
    expect(html).toContain('July 1, 2026');
    expect(html).toContain('Current value');
    expect(html).toContain('Affected manuscript field');
    expect(html).toContain('Methods → Information sources');
    for (const id of ['updated-by', 'changed-at', 'reason', 'previous', 'current', 'sections']) {
      expect(html, id).toContain(`data-testid="stitch-manuscript-fact-${id}"`);
    }
  });

  it('offers both §10 actions and says plainly that a revert is manuscript-only', () => {
    expect(html).toContain('Restore previous wording');
    expect(html).toContain('Keep current wording');
    expect(html).toContain('changes the manuscript only');
  });

  it('does NOT expose internal ids as content (§9)', () => {
    expect(html).not.toContain('ev_9f3');
    expect(html).not.toContain('tx_2b7');
    expect(html).not.toContain('fc_1');
    expect(html).not.toContain('grp_1');
  });

  it('is labelled for assistive tech and keyboard-reachable', () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Provenance for Date of the most recent search"');
    // actions are real buttons, not clickable divs
    expect(html).toContain('<button type="button"');
  });

  it('without a change it explains the fact instead of inventing a history (§38)', () => {
    const plain = renderToStaticMarkup(<FactProvenanceCard fact={fact} sections={sections} />);
    expect(plain).toContain('No automatic updates recorded for this value yet.');
    expect(plain).not.toContain('Restore previous wording');
  });

  it('a missing fact shows the placeholder reason and its hint, never a value (§17)', () => {
    const missing = renderToStaticMarkup(
      <FactProvenanceCard fact={{ ...fact, missing: true, value: '[Date … — not yet available]', hint: 'Execute a search.' }} />,
    );
    expect(missing).toContain('Not yet available');
    expect(missing).toContain('Execute a search.');
  });

  it('EngineBadge pairs colour with a glyph and a label', () => {
    const badge = renderToStaticMarkup(<EngineBadge engine="rob" />);
    expect(badge).toContain(ENGINE_STYLE.rob.glyph);
    expect(badge).toContain(ENGINE_STYLE.rob.short);
    expect(badge).toContain('aria-hidden="true"');
  });
});

/* ════════════ the change-tracking panel (§14 / §34) ════════════ */

describe('ChangeTrackingPanel — one research action, one entry (§14/§34)', () => {
  /** One reconcile pass over an updated search moves several values at once. */
  function searchUpdateLog() {
    const facts0 = resolveFacts({ pico: {}, studies: [], prisma: { dbs: '900' } }, {
      searchProvenance: {
        reportable: [{ label: 'PubMed', kind: 'database' }, { label: 'Embase', kind: 'database' }, { label: 'Scopus', kind: 'database' }],
        latestValidSearchAt: '2026-07-01T00:00:00.000Z',
      },
    });
    const used = ['search.databases', 'search.databaseCountWord', 'search.date', 'prisma.identified'];
    const seeded = reconcileFacts({}, facts0, { usedKeys: used, nowIso: '2026-07-01T00:00:00.000Z' }).draft;

    const facts1 = resolveFacts({ pico: {}, studies: [], prisma: { dbs: '1200' } }, {
      searchProvenance: {
        reportable: [
          { label: 'PubMed', kind: 'database' }, { label: 'Embase', kind: 'database' },
          { label: 'Scopus', kind: 'database' }, { label: 'Web of Science', kind: 'database' },
        ],
        latestValidSearchAt: '2026-08-06T09:15:00.000Z',
      },
    });
    return reconcileFacts(seeded, facts1, {
      usedKeys: used,
      nowIso: '2026-08-06T09:15:00.000Z',
      event: { id: 'ev_1', correlationId: 'tx_1', eventType: 'SEARCH_RUN_COMPLETED', reason: 'Updated search executed' },
    }).draft;
  }

  const draft = searchUpdateLog();

  it('collapses the whole search update into a single grouped entry', () => {
    const groups = groupChanges(draft.factLog);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBeGreaterThan(1);
    const html = renderToStaticMarkup(<ChangeTrackingPanel factLog={draft.factLog} onNavigate={noop} />);
    expect(html).toContain('data-testid="stitch-manuscript-change-panel"');
    expect((html.match(/data-testid="stitch-manuscript-change-group-/g) || [])).toHaveLength(1);
    expect(html).toContain(`${groups[0].count} values`);
  });

  it('entries are buttons that navigate, and carry engine badges plus a timestamp', () => {
    const html = renderToStaticMarkup(<ChangeTrackingPanel factLog={draft.factLog} onNavigate={noop} />);
    expect(html).toContain('<button type="button"');
    expect(html).toContain('stitch-manuscript-engine-badge-search');
    expect(html).toContain('August 6, 2026 · 09:15');
  });

  it('shows the §8 before/after inline when a group moved exactly one value', () => {
    const one = [{ id: 'c1', groupId: 'g1', key: 'search.date', label: 'Date of the most recent search', engine: 'search', engineLabel: 'Search Engine', from: 'July 1, 2026', to: 'August 6, 2026', at: '2026-08-06T09:15:00.000Z' }];
    const html = renderToStaticMarkup(<ChangeTrackingPanel factLog={one} onNavigate={noop} />);
    expect(html).toContain('July 1, 2026 → August 6, 2026');
  });

  it('renders an honest empty state rather than pretending nothing ever changed', () => {
    const html = renderToStaticMarkup(<ChangeTrackingPanel factLog={[]} />);
    expect(html).toContain('data-testid="stitch-manuscript-change-panel-empty"');
    expect(html).toContain('No automatic updates yet.');
  });

  it('renders the Show Changes toggle with a pressed state when asked to', () => {
    const on = renderToStaticMarkup(<ChangeTrackingPanel factLog={[]} showChanges onToggle={noop} />);
    expect(on).toContain('data-testid="stitch-manuscript-show-changes-toggle"');
    expect(on).toContain('aria-pressed="true"');
    const off = renderToStaticMarkup(<ChangeTrackingPanel factLog={[]} onToggle={noop} />);
    expect(off).toContain('aria-pressed="false"');
  });

  it('caps the list and says how many earlier updates exist (§34 lightweight)', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`, groupId: `g${i}`, key: 'search.date', label: 'Date of the most recent search',
      engine: 'search', engineLabel: 'Search Engine', from: `${i}`, to: `${i + 1}`, at: '2026-08-06T09:15:00.000Z',
    }));
    const html = renderToStaticMarkup(<ChangeTrackingPanel factLog={many} limit={3} onNavigate={noop} />);
    expect((html.match(/data-testid="stitch-manuscript-change-group-/g) || [])).toHaveLength(3);
    expect(html).toContain('9 earlier updates');
  });
});

describe('ShowChangesLegend — explains the colours (§7)', () => {
  it('lists every painted origin with its glyph and full label', () => {
    const html = renderToStaticMarkup(<ShowChangesLegend />);
    for (const e of LEGEND_ITEMS) {
      expect(html, e.id).toContain(`data-testid="stitch-manuscript-legend-${e.id}"`);
      expect(html, e.id).toContain(e.label);
      expect(html, e.id).toContain(e.glyph);
    }
  });

  it('can be narrowed to only the engines actually in play', () => {
    const html = renderToStaticMarkup(<ShowChangesLegend engines={['search', 'rob']} />);
    expect(html).toContain('stitch-manuscript-legend-search');
    expect(html).toContain('stitch-manuscript-legend-rob');
    expect(html).not.toContain('stitch-manuscript-legend-analysis');
  });
});
