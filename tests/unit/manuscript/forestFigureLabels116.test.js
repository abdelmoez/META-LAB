/**
 * forestFigureLabels116.test.js — 116.md §26 / §32 (decision D15).
 *
 * figures.js's `forestOpts` docblock states that "the persisted per-figure labels
 * (axis name, favours texts) must reach the DOCX and the repro bundle exactly as they
 * reach the screen" — and no caller ever supplied them. A reviewer who replaced the
 * ambiguous default direction wording ("favours lower / favours higher" is backwards
 * for a harm outcome) saw the new text on screen, in the Forest-tab download and in the
 * journal ZIP, while the Word file that is actually submitted, the reproducibility
 * bundle's forest_plot.svg/png and the in-app figure preview all still printed the
 * generic default.
 *
 * The labels are now resolved ONCE, on the analysis entry (primaryAnalysis/allAnalyses
 * → forestFigureConfig), so every manuscript figure consumer reads the same record.
 *
 * Node-only: the DOCX rasterizer is mocked (no canvas); the repro bundle's SVG is a
 * pure string entry and is asserted unmocked.
 */
import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { primaryAnalysis, allAnalyses } from '../../../src/research-engine/manuscript/draft.js';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';

vi.mock('../../../src/features/manuscript/export/figures.js', async (orig) => {
  const actual = await orig();
  const fake = (w, h) => ({
    blob: new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]),
    width: w, height: h, svg: '<svg/>',
  });
  return {
    ...actual,
    prismaPng: vi.fn(async () => fake(1800, 2000)),
    forestPng: vi.fn(async () => fake(2200, 1200)),
    funnelPng: vi.fn(async () => fake(2200, 1500)),
    robPng: vi.fn(async () => fake(1800, 900)),
  };
});

// Imported AFTER the mock so the exporters bind the fakes; forestSvg stays REAL.
import { forestPng, forestSvg, FOREST_PRESENTATION_OPT_KEYS } from '../../../src/features/manuscript/export/figures.js';
import { buildManuscriptDocx } from '../../../src/features/manuscript/export/manuscriptDocx.js';
import { buildReproPackage } from '../../../src/features/manuscript/export/manuscriptRepro.js';

const LABELS = {
  esLabel: 'Odds ratio (adjusted)',
  favLow: 'Favours intervention',
  favHigh: 'Favours control',
  title: 'Primary outcome — MACE',
};

function project({ labels = LABELS } = {}) {
  return {
    id: 'p1', name: 'Statins', pico: { question: 'Q' }, search: { dbs: {} },
    prisma: { dbs: '1200', reg: '50', other: '0', dedupe: '250', excTA: '800', excFull: '180', included: '', quant: '' },
    ...(labels ? { analysisSettings: { figureLabels: { 'MACE|||': labels } } } : {}),
    studies: [
      { id: 's1', title: 'Trial A', author: 'Smith', authors: 'Smith J', year: '2020', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12' },
      { id: 's2', title: 'Trial B', author: 'Lee', authors: 'Lee K', year: '2021', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06' },
      { id: 's3', title: 'Trial C', author: 'Brown', authors: 'Brown T', year: '2019', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05' },
    ],
  };
}

const draft = () => normalizeDraft(makeManuscriptDraft({ title: 'T' }));

describe('116.md §26/§32 — persisted figure labels ride on the analysis entry', () => {
  /* 117.md §24/§81 — DELIBERATE RE-PIN: the entry now carries the whole PRESENTATION
     record (subtitle/note/columns/decimals/bounded geometry), not just the three labels,
     so a control a reviewer set on the Forest tab reaches the submitted Word file too. */
  it('primaryAnalysis and allAnalyses resolve them for their pair', () => {
    const p = project();
    expect(primaryAnalysis(p).figure).toEqual({
      esLabel: LABELS.esLabel, favLow: LABELS.favLow, favHigh: LABELS.favHigh,
      subtitle: '', note: '', showCounts: true, showWeights: true, showPI: true,
      decimals: null, metrics: {},
    });
    expect(allAnalyses(p)[0].figure).toEqual(primaryAnalysis(p).figure);
  });

  it('a project with no persisted labels resolves to empty strings, never an invented default', () => {
    const fig = primaryAnalysis(project({ labels: null })).figure;
    expect(fig).toEqual({
      esLabel: '', favLow: '', favHigh: '', subtitle: '', note: '',
      showCounts: true, showWeights: true, showPI: true, decimals: null, metrics: {},
    });
  });

  it('the FIGURE TITLE deliberately stays off the entry — Word numbers and captions the image', () => {
    expect('title' in primaryAnalysis(project()).figure).toBe(false);
  });
});

describe('116.md §26/§32 — every manuscript figure surface carries them', () => {
  it('the Word export hands the labels to the forest builder (title stays empty for the caption)', async () => {
    forestPng.mockClear();
    const d = draft();
    d.sections.results.content = 'Effects are shown in [[figure:forest-primary]].';
    await buildManuscriptDocx(project(), d, {});
    expect(forestPng).toHaveBeenCalled();
    const opts = forestPng.mock.calls[0][1];
    expect(opts.esLabel).toBe(LABELS.esLabel);
    expect(opts.favLow).toBe(LABELS.favLow);
    expect(opts.favHigh).toBe(LABELS.favHigh);
    expect(opts.title).toBe('');
    expect(opts.esType).toBe('OR');
  });

  it('the reproducibility bundle writes a forest SVG with the reviewer\'s own wording', async () => {
    const blob = await buildReproPackage(project(), draft(), { appVersion: 'test' });
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const svg = await zip.file('figures/forest_plot.svg').async('string');
    expect(svg).toContain(LABELS.esLabel);
    expect(svg).toContain(LABELS.favLow);
    expect(svg).toContain(LABELS.favHigh);
    // …and never the generic direction wording it used to print instead
    expect(svg).not.toContain('favours lower');
    expect(svg).not.toContain('favours higher');
    expect(svg).not.toContain('>Odds Ratio<');
  });

  it('an unlabelled project still gets the measure-derived defaults (no regression)', async () => {
    const blob = await buildReproPackage(project({ labels: null }), draft(), { appVersion: 'test' });
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const svg = await zip.file('figures/forest_plot.svg').async('string');
    expect(svg).toContain('>Odds Ratio<');
    expect(svg).toContain('favours lower');
  });

  it('forestSvg itself forwards whatever the caller resolved (the seam every surface uses)', () => {
    const p = project();
    const a = primaryAnalysis(p);
    const svg = forestSvg(a.result, { esType: a.pair.esType, ...a.figure, title: a.pair.label });
    expect(svg).toContain(LABELS.esLabel);
    expect(svg).toContain(LABELS.favHigh);
  });
});

/* ── 117.md §24/§81 — the PRESENTATION half of the same seam ─────────────────
   The labels above were the first half of the D15 drift class; the controls a
   reviewer sets on the Forest tab are the second. A hidden weight column, a
   figure note or a per-figure decimal setting that stops at the Forest tab is
   exactly the defect this file exists for, one field later. */

const PRESENTATION = {
  ...LABELS,
  subtitle: 'Intention-to-treat population',
  note: 'Two trials reported adjudicated events only.',
  showWeights: false,
  decimals: 2,
  metrics: { plotW: 420 },
};

describe('117.md §24/§81 — the persisted presentation reaches the manuscript too', () => {
  it('rides on the analysis entry beside the labels (still without the title)', () => {
    const fig = primaryAnalysis(project({ labels: PRESENTATION })).figure;
    expect(fig.subtitle).toBe(PRESENTATION.subtitle);
    expect(fig.note).toBe(PRESENTATION.note);
    expect(fig.showWeights).toBe(false);
    expect(fig.decimals).toBe(2);
    expect(fig.metrics).toEqual({ plotW: 420 });
    expect('title' in fig).toBe(false);
  });

  it('the Word export forwards every one of them through the forestOpts whitelist', async () => {
    forestPng.mockClear();
    const d = draft();
    d.sections.results.content = 'Effects are shown in [[figure:forest-primary]].';
    await buildManuscriptDocx(project({ labels: PRESENTATION }), d, {});
    expect(forestPng).toHaveBeenCalled();
    const opts = forestPng.mock.calls[0][1];
    expect(opts.subtitle).toBe(PRESENTATION.subtitle);
    expect(opts.note).toBe(PRESENTATION.note);
    expect(opts.showWeights).toBe(false);
    expect(opts.decimals).toBe(2);
    expect(opts.metrics).toEqual({ plotW: 420 });
    // the title still belongs to Word's own caption, not to the image
    expect(opts.title).toBe('');
  });

  it('the whitelist is not a second opinion — it admits exactly what the resolver emits', () => {
    Object.keys(primaryAnalysis(project({ labels: PRESENTATION })).figure).forEach((k) => {
      expect(FOREST_PRESENTATION_OPT_KEYS).toContain(k);
    });
  });

  it('the reproducibility bundle draws the same figure the Forest tab shows', async () => {
    const blob = await buildReproPackage(project({ labels: PRESENTATION }), draft(), { appVersion: 'test' });
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const svg = await zip.file('figures/forest_plot.svg').async('string');
    expect(svg).toContain(PRESENTATION.subtitle);
    expect(svg).toContain('adjudicated events only');
    expect(svg).not.toContain('>Weight<');
  });

  it('a project that configured nothing still produces the historical figure', async () => {
    const blob = await buildReproPackage(project({ labels: null }), draft(), { appVersion: 'test' });
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const svg = await zip.file('figures/forest_plot.svg').async('string');
    expect(svg).toContain('>Weight<');
    expect(svg).toContain('Prediction interval');
  });
});
