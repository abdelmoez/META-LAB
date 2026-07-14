/**
 * 85.md Objective 2 (B1) — derived asset registry: ids/order, availability,
 * inclusion defaults, draft.assets overrides, stable per-outcome slugs, and the
 * normalizeDraft assets preservation pin (snapshots pattern — no phantom key).
 */
import { describe, it, expect } from 'vitest';
import {
  computeManuscriptAssets, assetSlug,
} from '../../../src/research-engine/manuscript/index.js';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';

function baseProject() {
  return {
    id: 'p1',
    name: 'Statins for primary prevention',
    pico: { question: 'Do statins reduce CV events?' },
    search: { dbs: { PubMed: true }, date: '2026-01-15', string: '(statin*)' },
    prisma: { dbs: '1200', dedupe: '250', excTA: '800', excFull: '180' },
    robMethod: 'RoB2',
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', rob: { D1: 'Low' } },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06' },
      { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05' },
      { id: 's4', title: 'Trial D', authors: 'Green A', year: '2022', outcome: 'Mortality', esType: 'OR', es: '-0.15', lo: '-0.40', hi: '0.10' },
      { id: 's5', title: 'Trial E', authors: 'White B', year: '2023', outcome: 'Mortality', esType: 'OR', es: '-0.25', lo: '-0.50', hi: '0.00' },
    ],
  };
}

const draft = () => makeManuscriptDraft({});

describe('assetSlug', () => {
  it('is deterministic, token-grammar safe, never empty', () => {
    expect(assetSlug('MACE|||5y')).toBe('mace-5y');
    expect(assetSlug('All-cause mortality @ 30 days|||')).toBe('all-cause-mortality-30-days');
    expect(assetSlug('   ')).toBe('outcome');
    expect(assetSlug('|||')).toBe('outcome');
    expect(/^[a-z0-9-]+$/.test(assetSlug('Weird — outcome (µg/mL)!'))).toBe(true);
  });
});

describe('computeManuscriptAssets — registry', () => {
  it('emits the 5 tables + figure set in registry order with stable ids', () => {
    const assets = computeManuscriptAssets(baseProject(), draft());
    const ids = assets.map((a) => a.id);
    expect(ids).toEqual([
      'table:study', 'table:sof', 'table:prisma', 'table:rob', 'table:search',
      'figure:prisma', 'figure:forest-primary', 'figure:forest:mortality',
      'figure:rob', 'figure:funnel',
    ]);
    // every id satisfies the token grammar
    for (const id of ids) expect(/^(table|figure):[a-z0-9:-]+$/.test(id)).toBe(true);
  });

  it('table assets wrap the builders (availability, title, note, source)', () => {
    const assets = computeManuscriptAssets(baseProject(), draft());
    const study = assets.find((a) => a.id === 'table:study');
    expect(study.kind).toBe('table');
    expect(study.builderId).toBe('study');
    expect(study.available).toBe(true);
    expect(study.title).toBe('Characteristics of included studies');
    expect(study.defaultCaption).toBe('Characteristics of included studies');
    expect(study.source).toBe('studies');
    expect(study.note).toContain('Generated from included studies');
  });

  it('inclusion defaults: tables+prisma+forest-primary in, secondary figures out', () => {
    const assets = computeManuscriptAssets(baseProject(), draft());
    const by = Object.fromEntries(assets.map((a) => [a.id, a]));
    expect(by['table:study'].included).toBe(true);
    expect(by['table:sof'].included).toBe(true);
    expect(by['figure:prisma'].included).toBe(true);
    expect(by['figure:forest-primary'].included).toBe(true);
    expect(by['figure:forest:mortality'].included).toBe(false);
    expect(by['figure:rob'].included).toBe(false);
    expect(by['figure:funnel'].included).toBe(false);
    // includedDefault mirrors that
    expect(by['figure:forest:mortality'].includedDefault).toBe(false);
    expect(by['table:study'].includedDefault).toBe(true);
  });

  it('an unavailable table defaults to NOT included', () => {
    const p = baseProject();
    p.studies = [];
    p.prisma = {};
    const assets = computeManuscriptAssets(p, draft());
    const by = Object.fromEntries(assets.map((a) => [a.id, a]));
    expect(by['table:study'].available).toBe(false);
    expect(by['table:study'].included).toBe(false);
    expect(by['figure:forest-primary'].available).toBe(false);
    expect(by['figure:forest-primary'].included).toBe(false);
  });

  it('figure availability is honest: rob needs structured assessments, funnel needs ≥3 primary studies', () => {
    const p = baseProject();
    const noRob = computeManuscriptAssets(p, draft());
    expect(noRob.find((a) => a.id === 'figure:rob').available).toBe(false);
    const withRob = computeManuscriptAssets(p, draft(), {
      robAssessments: { s1: { domains: { D1: 'Low' }, overall: 'Low' } },
    });
    expect(withRob.find((a) => a.id === 'figure:rob').available).toBe(true);
    // funnel: primary (MACE) has 3 studies with full CIs → available
    expect(withRob.find((a) => a.id === 'figure:funnel').available).toBe(true);
    // drop to 2 primary studies → funnel unavailable
    const p2 = baseProject();
    p2.studies = p2.studies.filter((s) => s.id !== 's3');
    const two = computeManuscriptAssets(p2, draft());
    expect(two.find((a) => a.id === 'figure:funnel').available).toBe(false);
  });

  it('per-outcome forest ids come from the stable pair.key, label stored separately', () => {
    const assets = computeManuscriptAssets(baseProject(), draft());
    const sec = assets.find((a) => a.id === 'figure:forest:mortality');
    expect(sec.pairKey).toBe('Mortality|||');
    expect(sec.outcomeLabel).toBe('Mortality');
    expect(sec.title).toBe('Forest plot — Mortality');
    expect(sec.available).toBe(true); // 2 studies pooled
  });

  it('slug collisions get deterministic suffixes independent of the study-count sort', () => {
    const p = baseProject();
    // two outcomes whose keys slug identically ('MACE 1y' vs 'MACE-1y')
    p.studies.push(
      { id: 'c1', title: 'X1', authors: 'A', year: '2020', outcome: 'Stroke 1y', esType: 'OR', es: '-0.1', lo: '-0.3', hi: '0.1' },
      { id: 'c2', title: 'X2', authors: 'B', year: '2021', outcome: 'Stroke 1y', esType: 'OR', es: '-0.2', lo: '-0.4', hi: '0.0' },
      { id: 'c3', title: 'X3', authors: 'C', year: '2020', outcome: 'Stroke-1y', esType: 'OR', es: '-0.1', lo: '-0.3', hi: '0.1' },
    );
    const ids = computeManuscriptAssets(p, draft()).map((a) => a.id);
    // 'Stroke 1y|||' < 'Stroke-1y|||' lexicographically → base slug goes to 'Stroke 1y'
    expect(ids).toContain('figure:forest:stroke-1y');
    expect(ids).toContain('figure:forest:stroke-1y-2');
    const byKey = Object.fromEntries(
      computeManuscriptAssets(p, draft()).filter((a) => a.pairKey).map((a) => [a.pairKey, a.id]),
    );
    expect(byKey['Stroke 1y|||']).toBe('figure:forest:stroke-1y');
    expect(byKey['Stroke-1y|||']).toBe('figure:forest:stroke-1y-2');
  });

  it('draft.assets overrides merge over defaults (included/title/caption/legend/note)', () => {
    const d = draft();
    d.assets = {
      'table:study': { included: false, title: 'My table', caption: 'My caption', legend: 'My legend', note: 'My note' },
      'figure:funnel': { included: true },
    };
    const assets = computeManuscriptAssets(baseProject(), d);
    const study = assets.find((a) => a.id === 'table:study');
    expect(study.included).toBe(false);
    expect(study.includedDefault).toBe(true); // default untouched
    expect(study.title).toBe('My table');
    expect(study.defaultCaption).toBe('My caption');
    expect(study.legend).toBe('My legend');
    expect(study.note).toBe('My note');
    expect(assets.find((a) => a.id === 'figure:funnel').included).toBe(true);
  });

  it('staleAssets opt stamps stale:true (map or Set)', () => {
    const assets = computeManuscriptAssets(baseProject(), draft(), { staleAssets: { 'table:sof': true } });
    expect(assets.find((a) => a.id === 'table:sof').stale).toBe(true);
    expect('stale' in assets.find((a) => a.id === 'table:study')).toBe(false);
    const assets2 = computeManuscriptAssets(baseProject(), draft(), { staleAssets: new Set(['figure:prisma']) });
    expect(assets2.find((a) => a.id === 'figure:prisma').stale).toBe(true);
  });

  it('accepts precomputed tables/analyses seams (parity with buildManuscriptDocx)', () => {
    const fake = { available: false, title: 'T', note: '', generatedFrom: 'studies' };
    const assets = computeManuscriptAssets(baseProject(), draft(), {
      tables: { study: fake, sof: fake, prisma: fake, rob: fake, search: fake },
      analyses: [],
    });
    expect(assets.filter((a) => a.kind === 'table').every((a) => !a.available)).toBe(true);
    expect(assets.find((a) => a.id === 'figure:forest-primary').available).toBe(false);
  });
});

describe('normalizeDraft — draft.assets (snapshots pattern)', () => {
  it('preserves non-empty assets and drops empty ones (no phantom key)', () => {
    const withAssets = normalizeDraft({ assets: { 'table:study': { included: false } } });
    expect(withAssets.assets).toEqual({ 'table:study': { included: false } });
    const emptyObj = normalizeDraft({ assets: {} });
    expect('assets' in emptyObj).toBe(false);
    const legacy = normalizeDraft({ sections: { results: { content: 'x' } } });
    expect('assets' in legacy).toBe(false);
    const junk = normalizeDraft({ assets: { a: 'not-an-object', b: null } });
    expect('assets' in junk).toBe(false);
    const arr = normalizeDraft({ assets: ['x'] });
    expect('assets' in arr).toBe(false);
  });
  it('makeManuscriptDraft never materializes assets', () => {
    expect('assets' in makeManuscriptDraft({})).toBe(false);
  });
});
