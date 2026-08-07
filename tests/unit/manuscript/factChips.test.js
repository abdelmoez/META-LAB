/**
 * 101.md §5/§6/§7/§17 — the fact chip contract in richEditor/mdDom.js.
 *
 * The three properties that everything else in the live-sync design rests on:
 *   1. `[[fact:key]]` ⇄ chip ⇄ `[[fact:key]]` round-trips byte-for-byte, so what
 *      persists is a POINTER at project data and never the rendered text (§5).
 *   2. A key the project cannot answer degrades to a visible placeholder and never
 *      leaks raw `[[fact:…]]` syntax into the page or an export (§17).
 *   3. With Show Changes off the chip carries no styling and no tooltip — that is
 *      what makes "turn it off → completely clean manuscript" literally true (§6).
 */
import { describe, it, expect } from 'vitest';
import {
  mdToHtml, htmlToMd, factChipHtml, factChipText, stripInlineMd, FACT_CHIP_CLASS,
} from '../../../src/features/manuscript/richEditor/mdDom.js';
import { resolveFacts, factPlaceholder } from '../../../src/research-engine/manuscript/factTokens.js';

const rt = (md, opts) => htmlToMd(mdToHtml(md, opts));

/** Visible text of rendered HTML (tags stripped, entities decoded). */
function textContent(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** A minimal resolveFacts()-shaped map for the two facts these tests exercise. */
function facts(overrides = {}) {
  const resolved = resolveFacts({ pico: {}, studies: [], prisma: {} }, {
    searchProvenance: {
      reportable: [
        { label: 'PubMed', kind: 'database' },
        { label: 'Embase', kind: 'database' },
        { label: 'Scopus', kind: 'database' },
        { label: 'Web of Science', kind: 'database' },
      ],
      latestValidSearchAt: '2026-08-06T09:15:00.000Z',
    },
  });
  return { ...resolved, ...overrides };
}

describe('fact chips — token ⇄ chip round trip (101.md §5)', () => {
  it('renders a token as an atomic ms-fact chip carrying the stable key', () => {
    const html = mdToHtml('Searched [[fact:search.databaseCountWord]] databases.', { facts: facts() });
    expect(html).toContain(`class="${FACT_CHIP_CLASS}"`);
    expect(html).toContain('data-fact="search.databaseCountWord"');
    expect(html).toContain('contenteditable="false"');
    expect(textContent(html)).toBe('Searched four databases.');
    expect(html).not.toContain('[[fact:');
  });

  it('the chip reverses to its TOKEN, not to the resolved text', () => {
    const md = 'Databases were searched to [[fact:search.date]].';
    // resolved value present → the value renders, the markdown is unchanged
    expect(htmlToMd(mdToHtml(md, { facts: facts() }))).toBe(md);
    // and the same holds with no snapshot at all (placeholder rendering)
    expect(rt(md)).toBe(md);
    expect(rt(rt(md))).toBe(md);
  });

  it('is a fixed point inside every block type the subset supports', () => {
    const md = [
      '# Methods',
      '',
      'We searched [[fact:search.databases]] from inception to [[fact:search.date]].',
      '',
      '- identified: [[fact:prisma.identified]]',
      '- included: [[fact:prisma.included]]',
      '',
      '| Item | Value |',
      '| --- | --- |',
      '| Databases | [[fact:search.databaseCount]] |',
    ].join('\n');
    expect(rt(md, { facts: facts() })).toBe(md);
    expect(rt(rt(md, { facts: facts() }))).toBe(md);
  });

  it('a value that resolves is escaped, never injected as markup', () => {
    const hostile = { ...facts(), 'search.databases': { key: 'search.databases', label: 'x', engine: 'search', value: '<img src=x onerror=1>', missing: false } };
    const html = mdToHtml('[[fact:search.databases]]', { facts: hostile });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('fact chips — honest placeholders (101.md §17)', () => {
  it('an unknown key degrades to a placeholder and never leaks raw token syntax', () => {
    const html = mdToHtml('Value: [[fact:not.a.real.key]].', { facts: facts() });
    const txt = textContent(html);
    expect(txt).toContain(factPlaceholder('not.a.real.key'));
    expect(txt).not.toContain('[[fact:');
    // …and the unknown key still round-trips, so a fact key added in a later
    // version starts resolving without the researcher retyping anything
    expect(htmlToMd(html)).toBe('Value: [[fact:not.a.real.key]].');
  });

  it('a known-but-unanswerable fact renders its own placeholder and is flagged missing', () => {
    const html = mdToHtml('[[fact:analysis.pooledEffect]]', { facts: facts() });
    expect(textContent(html)).toBe('[Pooled effect estimate — not yet available]');
    expect(html).toContain('data-missing="true"');
    expect(html).not.toContain('[[fact:');
  });

  it('with no snapshot at all every fact is a placeholder — never a fabricated value', () => {
    const txt = textContent(mdToHtml('[[fact:search.databases]] to [[fact:search.date]]'));
    expect(txt).toBe('[Databases searched — not yet available] to [Date of the most recent search — not yet available]');
  });

  it('factChipText applies §10 overrides ahead of the live value', () => {
    const f = facts();
    expect(factChipText('search.date', f, null)).toBe('August 6, 2026');
    expect(factChipText('search.date', f, { 'search.date': 'July 1, 2026' })).toBe('July 1, 2026');
    // an empty override is not an override — it must not blank the manuscript
    expect(factChipText('search.date', f, { 'search.date': '' })).toBe('August 6, 2026');
  });
});

describe('fact chips — clean when Show Changes is off (101.md §6)', () => {
  it('carries no styling, no class beyond ms-fact, and no tooltip by default', () => {
    const html = mdToHtml('to [[fact:search.date]].', { facts: facts() });
    expect(html).not.toContain('style=');
    expect(html).not.toContain('title=');
    expect(html).toMatch(new RegExp(`class="${FACT_CHIP_CLASS}"`));
  });

  it('emits the engine hook so the overlay can attribute it, but only paints via CSS', () => {
    const html = mdToHtml('[[fact:search.date]] [[fact:analysis.model]]', { facts: facts() });
    expect(html).toContain('data-engine="search"');
    expect(html).toContain('data-engine="analysis"');
    expect(html).not.toContain('style=');
  });

  it('Show Changes on adds only attributes — the document text is identical', () => {
    const md = 'Searched to [[fact:search.date]].';
    const off = mdToHtml(md, { facts: facts() });
    const on = mdToHtml(md, { facts: facts(), showChanges: true, factChanges: [{ key: 'search.date', from: 'July 1, 2026', to: 'August 6, 2026', at: '2026-08-06T09:15:00.000Z', engine: 'search' }] });
    expect(textContent(on)).toBe(textContent(off));
    expect(htmlToMd(on)).toBe(htmlToMd(off));
    expect(on).toContain('data-changed="true"');
    expect(on).toContain('title="');
    expect(on).toContain('August 6, 2026');
  });

  it('accepts a Set of keys as well as a change log for the changed flag', () => {
    const html = mdToHtml('[[fact:search.date]] [[fact:search.databases]]', {
      facts: facts(), factChanges: new Set(['search.date']),
    });
    const chips = html.match(/<span class="ms-fact"[^>]*>/g) || [];
    expect(chips).toHaveLength(2);
    expect(chips[0]).toContain('data-changed="true"');
    expect(chips[1]).not.toContain('data-changed');
  });
});

describe('fact chips — no collision with cite/asset chips', () => {
  it('all three token families render distinctly and reverse exactly', () => {
    const md = 'See [[cite:r1]] and [[table:study]] and [[fact:search.date]].';
    const html = mdToHtml(md, {
      orderMap: new Map([['r1', 1]]),
      assetNumbers: { 'table:study': 2 },
      facts: facts(),
    });
    expect(html).toContain('class="ms-cite"');
    expect(html).toContain('class="ms-asset"');
    expect(html).toContain('class="ms-fact"');
    expect(htmlToMd(html)).toBe(md);
    const txt = textContent(html);
    expect(txt).toBe('See [1] and Table 2 and August 6, 2026.');
  });

  it('a fact key that looks like an asset id is still a fact', () => {
    const md = '[[fact:table.study]]';
    expect(rt(md)).toBe(md);
    expect(mdToHtml(md)).toContain('data-fact="table.study"');
    expect(mdToHtml(md)).not.toContain('data-asset');
  });

  it('degrades a corrupt data-fact span to its text instead of a broken token', () => {
    expect(htmlToMd('<p><span class="ms-fact" data-fact="not a key!">four</span></p>')).toBe('four');
    expect(htmlToMd('<p><span class="ms-fact" data-fact="9bad">four</span></p>')).toBe('four');
    // a pasted, well-formed chip survives as a live token
    expect(htmlToMd(`<p>x ${factChipHtml('search.date', 'August 6, 2026')} y</p>`))
      .toBe('x [[fact:search.date]] y');
  });
});

describe('fact tokens never leak into derived UI text', () => {
  it('stripInlineMd removes them from outline labels', () => {
    expect(stripInlineMd('Search to [[fact:search.date]] done')).toBe('Search to  done');
    expect(stripInlineMd('## [[fact:search.databases]] searched')).not.toContain('[[fact:');
  });
});

describe('the pinned mdDom round-trip contract still holds', () => {
  const CANONICAL = [
    '# Heading one',
    '',
    'Para with **bold**, *ital*, `code`, a [link](https://example.com/x) and [[cite:r1]].',
    '',
    '- first bullet',
    '- second bullet',
    '',
    '| Col A | Col B |',
    '| --- | --- |',
    '| a1 | b1 |',
  ].join('\n');

  it('canonical markdown with no fact tokens is byte-identical after a round trip', () => {
    expect(rt(CANONICAL)).toBe(CANONICAL);
    expect(rt(CANONICAL, { facts: facts() })).toBe(CANONICAL);
  });

  it('adding fact tokens to canonical markdown keeps it a fixed point', () => {
    const md = `${CANONICAL}\n\nSearched [[fact:search.databases]] to [[fact:search.date]].`;
    expect(rt(md, { facts: facts() })).toBe(md);
  });
});
