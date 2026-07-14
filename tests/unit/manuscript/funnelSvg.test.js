/**
 * 85.md Objective 2 (B1) — pure SVG builders for the Word export:
 * buildFunnelSVG (new) and the forest-plot favours arrows (◄/► glyphs → <path>
 * triangles: Georgia has no glyph for those codepoints, Word rendered tofu).
 */
import { describe, it, expect } from 'vitest';
import { buildFunnelSVG, buildPubForestSVG } from '../../../src/frontend/workspace/charts/svgBuilders.js';
import { runMeta } from '../../../src/research-engine/statistics/meta-analysis.js';

function fixtureStudies() {
  return [
    { id: 's1', author: 'Smith', year: '2020', es: '-0.36', lo: '-0.6', hi: '-0.12' },
    { id: 's2', author: 'Lee', year: '2021', es: '-0.22', lo: '-0.5', hi: '0.06' },
    { id: 's3', author: 'Brown', year: '2019', es: '-0.30', lo: '-0.55', hi: '-0.05' },
    { id: 's4', author: 'Green', year: '2022', es: '-0.15', lo: '-0.40', hi: '0.10' },
  ];
}

describe('buildFunnelSVG', () => {
  it('builds a deterministic standalone SVG with points, cone, pooled line and axis labels', () => {
    const result = runMeta(fixtureStudies(), 'random');
    const out = buildFunnelSVG(result, { esType: 'OR', prec: undefined });
    expect(out).not.toBe(null);
    expect(out.W).toBe(620);
    expect(out.H).toBe(440);
    const svg = out.svg;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    // 4 study points
    expect((svg.match(/<circle /g) || []).length).toBe(4);
    // pseudo-CI cone (dashed path) + pooled vertical line
    expect(svg).toContain('stroke-dasharray="4,4"');
    expect(svg).toContain('stroke-dasharray="3,3"');
    // review-round #16: the effect axis carries the MEASURE name in display units
    // (back-transformed), matching the forest plot in the same export.
    expect(svg).toContain('>Odds Ratio</text>');
    expect(svg).toContain('>Standard error</text>');
    expect(svg).toContain('Pooled: ');
    // export-safe: absolute hex only, Georgia, no CSS variables
    expect(svg).not.toContain('var(--');
    expect(svg).toContain('Georgia');
    // deterministic: same input → byte-identical output
    expect(buildFunnelSVG(runMeta(fixtureStudies(), 'random'), { esType: 'OR' }).svg).toBe(svg);
  });

  it('PROP outcomes are labelled as percentages, matching the forest plot (review-round #16)', () => {
    const result = runMeta(fixtureStudies(), 'random'); // es on the logit scale for PROP
    const svg = buildFunnelSVG(result, { esType: 'PROP' }).svg;
    expect(svg).toContain('>Proportion (%)</text>');
    expect(svg).toMatch(/Pooled: [\d.]+%/); // pooled annotation in percent, not a 0–1 fraction
  });

  it('adds a title block when opts.title is given', () => {
    const result = runMeta(fixtureStudies(), 'random');
    const out = buildFunnelSVG(result, { esType: 'OR', title: 'Funnel plot — MACE' });
    expect(out.H).toBe(468);
    expect(out.svg).toContain('Funnel plot — MACE');
  });

  it('returns null for fewer than 3 usable studies and for junk input', () => {
    const result = runMeta(fixtureStudies().slice(0, 2), 'random');
    expect(buildFunnelSVG(result, { esType: 'OR' })).toBe(null);
    expect(buildFunnelSVG(null, {})).toBe(null);
    expect(buildFunnelSVG({}, {})).toBe(null);
  });

  it('noBg skips the white background rect', () => {
    const result = runMeta(fixtureStudies(), 'random');
    const withBg = buildFunnelSVG(result, { esType: 'OR' }).svg;
    const noBg = buildFunnelSVG(result, { esType: 'OR', noBg: true }).svg;
    expect(withBg).toContain('fill="#ffffff"/>');
    expect(noBg.indexOf('<rect x="0" y="0"')).toBe(-1);
  });
});

describe('buildPubForestSVG favours arrows', () => {
  it('uses <path> triangles instead of ◄/► glyphs (Word-safe), same labels', () => {
    const result = runMeta(fixtureStudies(), 'random');
    const out = buildPubForestSVG(result, { esType: 'OR', showCounts: true, showWeights: true });
    expect(out.svg).not.toContain('◄');
    expect(out.svg).not.toContain('►');
    expect(out.svg).toContain('favours experimental');
    expect(out.svg).toContain('favours control');
    // two filled triangle paths flanking the axis
    const tris = out.svg.match(/<path d="M[\d.]+,[\d.]+ L[\d.]+,[\d.]+ L[\d.]+,[\d.]+ Z" fill="#555555"\/>/g) || [];
    expect(tris.length).toBe(2);
  });
});
