/**
 * 85.md Objective 2 (B1) — block-level placement model: block grouping mirrors
 * markdownToParagraphs (whole lists/tables = ONE block), assets anchor after the
 * block of their FIRST body mention, abstract is a non-placement zone, legacy
 * plain-text mentions are detection-only.
 */
import { describe, it, expect } from 'vitest';
import {
  sectionBlocks, computePlacements, resolveNumbering,
} from '../../../src/research-engine/manuscript/index.js';

const A = (id, kind, { available = true, included = true } = {}) => ({ id, kind, available, included, title: id });
const sec = (id, content) => ({ id, content });

describe('sectionBlocks', () => {
  it('groups paragraphs (one line each), headings, whole lists and whole tables', () => {
    const md = [
      '## Study selection',          // 0 heading
      'Paragraph one.',              // 1 paragraph
      '',                            // 2 (blank)
      '1. step one',                 // 3 ┐
      '2. step two',                 // 4 │ ONE list block
      '- bullet',                    // 5 ┘ (contiguous list lines)
      '',                            // 6
      '| H1 | H2 |',                 // 7 ┐
      '| --- | --- |',               // 8 │ ONE table block
      '| a | b |',                   // 9 ┘
      'Tail paragraph.',             // 10
    ].join('\n');
    const blocks = sectionBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'table', 'paragraph']);
    expect(blocks[0]).toMatchObject({ startLine: 0, endLine: 0 });
    expect(blocks[2]).toMatchObject({ startLine: 3, endLine: 5 });
    expect(blocks[3]).toMatchObject({ startLine: 7, endLine: 9 });
    expect(blocks[4]).toMatchObject({ startLine: 10, endLine: 10 });
    expect(blocks[2].text).toBe('1. step one\n2. step two\n- bullet');
  });

  it('a blank line splits lists into separate blocks (separate numbering instances)', () => {
    const blocks = sectionBlocks('1. a\n2. b\n\n1. c');
    expect(blocks.map((b) => b.type)).toEqual(['list', 'list']);
  });

  it('a table line interrupts a list and vice versa (mirrors the docx converter)', () => {
    const blocks = sectionBlocks('- item\n| a |\n- item2');
    expect(blocks.map((b) => b.type)).toEqual(['list', 'table', 'list']);
  });

  it('empty / blank-only input → no blocks', () => {
    expect(sectionBlocks('')).toEqual([]);
    expect(sectionBlocks('\n\n')).toEqual([]);
  });
});

describe('computePlacements', () => {
  const assets = [
    A('table:study', 'table'),
    A('table:sof', 'table'),
    A('figure:prisma', 'figure'),
    A('figure:funnel', 'figure', { included: false }),
  ];
  const numberingFor = (sections) => resolveNumbering({ sections, assets });

  it('places an asset after the paragraph block of its first body mention', () => {
    const sections = [
      sec('results', 'Intro paragraph.\n\nSee the flow ([[figure:prisma]]).\n\nAfter paragraph.'),
    ];
    const pl = computePlacements({ sections, numbering: numberingFor(sections), assets });
    expect(pl.bySection.results).toEqual([{ afterBlockIndex: 1, assetId: 'figure:prisma' }]);
    expect(pl.fallback).toEqual(['table:study', 'table:sof']); // included, never mentioned
  });

  it('token in a heading → after the heading block; in a list/table → after the whole block', () => {
    const sections = [
      sec('results', [
        '## Selection [[figure:prisma]]',   // block 0 (heading)
        '1. one',                            // ┐ block 1 (whole list)
        '2. two [[table:study]]',            // ┘
        '| a | [[table:sof]] |',             // block 2 (whole table)
      ].join('\n')),
    ];
    const pl = computePlacements({ sections, numbering: numberingFor(sections), assets });
    expect(pl.bySection.results).toEqual([
      { afterBlockIndex: 0, assetId: 'figure:prisma' },
      { afterBlockIndex: 1, assetId: 'table:study' },
      { afterBlockIndex: 2, assetId: 'table:sof' },
    ]);
  });

  it('multiple first-mentions in one block keep token order; later mentions never re-insert', () => {
    const sections = [
      sec('methods', 'Both [[table:sof]] and [[table:study]] here.'),
      sec('results', 'Again [[table:study]] and [[table:sof]].'),
    ];
    const pl = computePlacements({ sections, numbering: numberingFor(sections), assets });
    expect(pl.bySection.methods).toEqual([
      { afterBlockIndex: 0, assetId: 'table:sof' },
      { afterBlockIndex: 0, assetId: 'table:study' },
    ]);
    expect(pl.bySection.results).toBeUndefined();
  });

  it('abstract/title are non-placement zones — abstract-only mention → fallback', () => {
    const sections = [
      sec('abstract', 'See [[figure:prisma]].'),
      sec('results', 'No tokens here.'),
    ];
    const pl = computePlacements({ sections, numbering: numberingFor(sections), assets });
    expect(pl.bySection).toEqual({});
    expect(pl.fallback).toContain('figure:prisma');
  });

  it('auto-included (referenced) excluded assets get placed too', () => {
    const sections = [sec('results', 'See [[figure:funnel]].')];
    const pl = computePlacements({ sections, numbering: numberingFor(sections), assets });
    expect(pl.bySection.results).toEqual([{ afterBlockIndex: 0, assetId: 'figure:funnel' }]);
  });

  it('legacy token-less draft: fallback carries EVERYTHING emitted, no prose placement', () => {
    const sections = [
      sec('results', 'Results are shown in Table 1 and Figure 1.'),
    ];
    const numbering = numberingFor(sections);
    const pl = computePlacements({ sections, numbering, assets });
    expect(pl.bySection).toEqual({});
    // all included+available assets fall back, tables before figures
    expect(pl.fallback).toEqual(['table:study', 'table:sof', 'figure:prisma']);
    // detection-only plain mentions recorded
    expect(pl.plainMentions).toEqual([
      { kind: 'table', number: 1, sectionId: 'results', line: 0 },
      { kind: 'figure', number: 1, sectionId: 'results', line: 0 },
    ]);
  });

  it('plain-mention detection skips pipe-table cells and caption lines above tables', () => {
    const sections = [
      sec('results', [
        'Table 3. Subgroup results',   // caption position (line start, table below) → skipped
        '| a | b |',
        '| --- | --- |',
        '| Table 9 | x |',             // inside table → skipped
        '',
        'Compare with Table 7 here.',  // mid-sentence → detected
      ].join('\n')),
    ];
    const pl = computePlacements({ sections, numbering: numberingFor(sections), assets });
    expect(pl.plainMentions).toEqual([{ kind: 'table', number: 7, sectionId: 'results', line: 5 }]);
    // 7 > 2 emitted tables → out-of-range warning
    expect(pl.warnings.some((w) => w.code === 'plain-mention-out-of-range' && /Table 7/.test(w.message))).toBe(true);
  });

  it('in-range plain mentions produce no out-of-range warning', () => {
    const sections = [sec('results', 'See Table 1.')];
    const pl = computePlacements({ sections, numbering: numberingFor(sections), assets });
    expect(pl.warnings).toEqual([]);
    expect(pl.plainMentions.length).toBe(1);
  });
});
