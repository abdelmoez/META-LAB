/**
 * 85.md Objective 2 (B1) — structured asset references: token grammar,
 * body-order numbering, auto-include, unresolved honesty, marker rendering.
 * All imports come from the public barrel (pins the new barrel exports).
 */
import { describe, it, expect } from 'vitest';
import {
  ASSET_TOKEN_RE, BODY_SECTION_IDS, assetToken, findAssetTokens,
  orderedSections, resolveNumbering, renderAssetMarkers,
  CITATION_TOKEN_RE,
} from '../../../src/research-engine/manuscript/index.js';

const A = (id, kind, { available = true, included = true } = {}) => ({ id, kind, available, included, title: id });

const sec = (id, content) => ({ id, content });

describe('token grammar', () => {
  it('matches table/figure tokens and extracts kind + full id', () => {
    const md = 'See [[table:study]] and [[figure:forest:mace-5y]] here.';
    const toks = findAssetTokens(md);
    expect(toks).toEqual([
      { kind: 'table', id: 'table:study', index: 4 },
      { kind: 'figure', id: 'figure:forest:mace-5y', index: 24 },
    ]);
  });
  it('never collides with CITATION_TOKEN_RE in either direction', () => {
    const cite = '[[cite:ref_1]]';
    const asset = '[[table:study]]';
    expect(new RegExp(ASSET_TOKEN_RE.source).test(cite)).toBe(false);
    expect(new RegExp(CITATION_TOKEN_RE.source).test(asset)).toBe(false);
  });
  it('rejects ids with uppercase, whitespace or brackets', () => {
    expect(findAssetTokens('[[table:Study]]')).toEqual([]);
    expect(findAssetTokens('[[table:my id]]')).toEqual([]);
    expect(findAssetTokens('[[figure:a]b]]')).toEqual([]);
  });
  it('assetToken builds the token and strips grammar-breaking chars', () => {
    expect(assetToken('table:study')).toBe('[[table:study]]');
    expect(assetToken('table:st]ud y')).toBe('[[table:study]]');
  });
  it('BODY_SECTION_IDS excludes title and abstract', () => {
    expect(BODY_SECTION_IDS).toEqual(['introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion']);
  });
});

describe('orderedSections', () => {
  it('passes arrays through and normalizes drafts to canonical order', () => {
    const arr = [sec('results', 'x')];
    expect(orderedSections(arr)).toBe(arr);
    const draft = { sections: { results: { content: 'r' }, abstract: { content: 'a' } } };
    const out = orderedSections(draft);
    expect(out.map((s) => s.id)).toEqual(['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion']);
    expect(out.find((s) => s.id === 'results').content).toBe('r');
    expect(out.find((s) => s.id === 'methods').content).toBe('');
  });
});

describe('resolveNumbering', () => {
  const assets = [
    A('table:study', 'table'),
    A('table:sof', 'table'),
    A('table:rob', 'table', { included: false }),
    A('figure:prisma', 'figure'),
    A('figure:forest-primary', 'figure'),
    A('figure:funnel', 'figure', { included: false }),
    A('figure:rob', 'figure', { available: false, included: false }),
  ];

  it('numbers per kind by first BODY mention, then unmentioned in registry order', () => {
    const n = resolveNumbering({
      sections: [
        sec('abstract', 'Mentions [[table:sof]] early — abstract must NOT drive ordering.'),
        sec('methods', 'First body mention: [[figure:forest-primary]].'),
        sec('results', 'Then [[table:sof]] and [[table:study]] and [[figure:prisma]].'),
      ],
      assets,
    });
    // body order: sof (results) before study? No — methods comes first but has no
    // table; in results, sof appears before study.
    expect(n.byId['table:sof']).toBe(1);
    expect(n.byId['table:study']).toBe(2);
    expect(n.byId['figure:forest-primary']).toBe(1);
    expect(n.byId['figure:prisma']).toBe(2);
    expect(n.orderTables).toEqual(['table:sof', 'table:study']);
    expect(n.orderFigures).toEqual(['figure:forest-primary', 'figure:prisma']);
    // included-but-never-mentioned assets do not exist here; excluded ones are null
    expect(n.byId['table:rob']).toBe(null);
    expect(n.byId['figure:funnel']).toBe(null);
  });

  it('included-but-never-mentioned assets number AFTER mentioned ones', () => {
    const n = resolveNumbering({
      sections: [sec('results', 'Only [[table:sof]] is mentioned.')],
      assets,
    });
    expect(n.byId['table:sof']).toBe(1);
    expect(n.byId['table:study']).toBe(2); // registry order, after mentioned
    expect(n.orderFigures).toEqual(['figure:prisma', 'figure:forest-primary']);
  });

  it('a token reference auto-includes an available excluded asset', () => {
    const n = resolveNumbering({
      sections: [sec('results', 'See [[figure:funnel]].')],
      assets,
    });
    expect(n.byId['figure:funnel']).toBe(1);
    expect(n.autoIncluded.has('figure:funnel')).toBe(true);
    expect(n.autoIncluded.has('figure:prisma')).toBe(false); // already included
  });

  it('abstract-only mention still counts as a mention (and auto-includes)', () => {
    const n = resolveNumbering({
      sections: [sec('abstract', 'See [[figure:funnel]].')],
      assets,
    });
    expect(n.mentioned.has('figure:funnel')).toBe(true);
    // emitted → numbered, but in the unmentioned (registry-order) bucket
    expect(n.byId['figure:funnel']).not.toBe(null);
    expect(n.orderFigures[n.orderFigures.length - 1]).toBe('figure:funnel');
  });

  it('referenced-but-unavailable → number null + unresolved(unavailable)', () => {
    const n = resolveNumbering({
      sections: [sec('results', 'See [[figure:rob]].')],
      assets,
    });
    expect(n.byId['figure:rob']).toBe(null);
    expect(n.unresolved).toEqual([
      { token: '[[figure:rob]]', id: 'figure:rob', kind: 'figure', sectionId: 'results', reason: 'unavailable' },
    ]);
  });

  it('unknown id → unresolved(unknown), never numbered', () => {
    const n = resolveNumbering({
      sections: [sec('results', 'See [[table:sfo]].')],
      assets,
    });
    expect(n.unresolved[0]).toMatchObject({ id: 'table:sfo', reason: 'unknown', sectionId: 'results' });
    expect('table:sfo' in n.byId).toBe(false);
  });

  it('accepts a draft as the sections argument', () => {
    const draft = { sections: { results: { content: '[[table:study]]' } } };
    const n = resolveNumbering({ sections: draft, assets });
    expect(n.byId['table:study']).toBe(1);
  });
});

describe('renderAssetMarkers', () => {
  it('replaces tokens with Table N / Figure N text; unknown → ?', () => {
    const assets = [A('table:study', 'table'), A('figure:prisma', 'figure')];
    const n = resolveNumbering({ sections: [sec('results', '[[figure:prisma]] then [[table:study]]')], assets });
    const outText = renderAssetMarkers('See [[table:study]] and [[figure:prisma]] and [[table:gone]].', n, assets);
    expect(outText).toBe('See Table 1 and Figure 1 and Table ?.');
  });
});
