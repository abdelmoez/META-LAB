/**
 * 85.md Objective 2 (B1) — pre-export validation: exhaustive coverage of every
 * error / warning / info code, plus the closest-id suggestion for typo'd refs.
 */
import { describe, it, expect } from 'vitest';
import {
  validateExport, closestAssetId, resolveNumbering, computePlacements,
} from '../../../src/research-engine/manuscript/index.js';
import { makeManuscriptDraft } from '../../../src/research-engine/manuscript/model.js';

const A = (id, kind, extra = {}) => ({ id, kind, available: true, included: true, title: id, defaultCaption: id, ...extra });
const sec = (id, content) => ({ id, content });

/** Run the full pipeline on hand-built assets + sections. */
function run(assets, sections, extras = {}) {
  const numbering = resolveNumbering({ sections, assets });
  const placements = computePlacements({ sections, numbering, assets });
  const draft = makeManuscriptDraft({});
  for (const s of sections) if (draft.sections[s.id]) draft.sections[s.id].content = s.content;
  if (extras.draftAssets) draft.assets = extras.draftAssets;
  return validateExport({ draft, assets, numbering, placements, ...extras });
}

const codes = (arr) => arr.map((e) => e.code);

describe('closestAssetId', () => {
  it('suggests the nearest known id for a typo, none when hopeless', () => {
    const known = ['table:study', 'table:sof', 'figure:prisma'];
    expect(closestAssetId('table:sfo', known)).toBe('table:sof');
    expect(closestAssetId('table:studie', known)).toBe('table:study');
    expect(closestAssetId('figure:zzzzzzzzzzzz', known)).toBe(null);
  });
});

describe('validateExport — errors', () => {
  it('unknown reference → blocking error with closest-id suggestion', () => {
    const assets = [A('table:sof', 'table')];
    const v = run(assets, [sec('results', 'See [[table:sfo]].')]);
    expect(codes(v.errors)).toContain('unknown-asset-ref');
    const e = v.errors.find((x) => x.code === 'unknown-asset-ref');
    expect(e.message).toContain('[[table:sfo]]');
    expect(e.message).toContain('table:sof');
    expect(e.action).toContain('[[table:sof]]');
  });

  it('duplicate numbering (internal invariant) → error', () => {
    const assets = [A('table:study', 'table'), A('table:sof', 'table')];
    const numbering = { byId: { 'table:study': 1, 'table:sof': 1 }, unresolved: [], mentioned: new Set(), orderTables: [], orderFigures: [] };
    const v = validateExport({ assets, numbering, placements: { bySection: {}, fallback: [], warnings: [], plainMentions: [] } });
    expect(codes(v.errors)).toContain('duplicate-numbering');
  });

  it('included asset of unrenderable kind → error', () => {
    const assets = [A('supplement:zip', 'supplement')];
    const v = validateExport({ assets, numbering: { byId: {}, unresolved: [] }, placements: {} });
    expect(codes(v.errors)).toContain('unsupported-asset-kind');
  });

  it('clean draft → no errors', () => {
    const assets = [A('table:study', 'table'), A('figure:prisma', 'figure')];
    const v = run(assets, [sec('results', 'See [[table:study]] and [[figure:prisma]].')]);
    expect(v.errors).toEqual([]);
  });
});

describe('validateExport — warnings', () => {
  it('referenced-but-unavailable → warning (not error), deduped per id', () => {
    const assets = [A('figure:rob', 'figure', { available: false, included: false })];
    const v = run(assets, [sec('results', '[[figure:rob]] and again [[figure:rob]].')]);
    expect(v.errors).toEqual([]);
    expect(codes(v.warnings).filter((c) => c === 'ref-unavailable')).toEqual(['ref-unavailable']);
    expect(v.warnings[0].message).toContain('Figure ?');
  });

  it('EXPLICITLY-included-but-never-mentioned → per-asset fallback warning', () => {
    // B2 refinement: the warning fires only when the researcher explicitly set
    // draft.assets[id].included = true — an intent statement worth a nudge.
    const assets = [A('table:study', 'table'), A('table:sof', 'table')];
    const v = run(assets, [sec('results', 'Only [[table:study]].')], {
      draftAssets: { 'table:sof': { included: true } },
    });
    const w = v.warnings.filter((x) => x.code === 'included-not-mentioned');
    expect(w.length).toBe(1);
    expect(w[0].message).toContain('table:sof');
  });

  it('DEFAULT-included-but-never-mentioned stays silent (legacy end-section layout)', () => {
    const assets = [A('table:study', 'table'), A('table:sof', 'table')];
    const v = run(assets, [sec('results', 'Only [[table:study]].')]);
    expect(codes(v.warnings)).not.toContain('included-not-mentioned');
  });

  it('emitted asset without title/caption → missing-caption', () => {
    const assets = [A('table:study', 'table', { title: '', defaultCaption: '' })];
    const v = run(assets, [sec('results', '[[table:study]]')]);
    expect(codes(v.warnings)).toContain('missing-caption');
  });

  it('stale asset + stale freshness rollup → warnings', () => {
    const assets = [A('table:study', 'table', { stale: true })];
    const v = run(assets, [sec('results', '[[table:study]]')], {
      freshness: { status: 'updates', label: '2 updates available' },
    });
    expect(codes(v.warnings)).toContain('stale-asset');
    expect(codes(v.warnings)).toContain('stale-content');
    expect(v.warnings.find((x) => x.code === 'stale-content').message).toContain('2 updates available');
  });

  it('synced freshness produces NO stale-content warning', () => {
    const v = run([A('table:study', 'table')], [sec('results', '[[table:study]]')], {
      freshness: { status: 'synced', label: 'Fully synchronized' },
    });
    expect(codes(v.warnings)).not.toContain('stale-content');
  });

  it('pending save / failed save → warning; saved → none', () => {
    const assets = [A('table:study', 'table')];
    const secs = [sec('results', '[[table:study]]')];
    expect(codes(run(assets, secs, { saveState: 'saving' }).warnings)).toContain('pending-save');
    const failed = run(assets, secs, { saveState: 'error' });
    expect(failed.warnings.find((x) => x.code === 'pending-save').message).toContain('FAILED');
    expect(codes(run(assets, secs, { saveState: 'saved' }).warnings)).not.toContain('pending-save');
  });

  it('sources not settled → warning; settled → none', () => {
    const assets = [A('table:study', 'table')];
    const secs = [sec('results', '[[table:study]]')];
    expect(codes(run(assets, secs, { sourcesSettled: false }).warnings)).toContain('sources-unsettled');
    expect(codes(run(assets, secs, { sourcesSettled: true }).warnings)).not.toContain('sources-unsettled');
  });

  it('dataStatus errors → source-errors warning listing the sources', () => {
    const assets = [A('table:study', 'table')];
    const v = run(assets, [sec('results', '[[table:study]]')], {
      dataStatus: { screening: 'ok', rob: 'error', search: 'error' },
    });
    const w = v.warnings.find((x) => x.code === 'source-errors');
    expect(w.message).toContain('rob');
    expect(w.message).toContain('search');
    expect(w.message).not.toContain('screening,');
  });

  it('legacy plain-text mention out of range → forwarded warning', () => {
    const assets = [A('table:study', 'table')];
    const v = run(assets, [sec('results', 'See Table 9 for details.')]);
    expect(codes(v.warnings)).toContain('plain-mention-out-of-range');
  });

  it('mixed mode (tokens AND plain-text mentions) → mixed-references warning', () => {
    const assets = [A('table:study', 'table'), A('table:sof', 'table')];
    const v = run(assets, [sec('results', 'See [[table:study]] and Table 2.')]);
    expect(codes(v.warnings)).toContain('mixed-references');
    // token-less draft with prose mentions is NOT mixed mode
    const legacy = run(assets, [sec('results', 'See Table 1 and Table 2.')]);
    expect(codes(legacy.warnings)).not.toContain('mixed-references');
  });
});

describe('validateExport — info', () => {
  it('user pipe tables → count info (unnumbered by design)', () => {
    const assets = [A('table:study', 'table')];
    const v = run(assets, [
      sec('results', '| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntext\n\n| c |\n| --- |\n| 3 |'),
    ]);
    const i = v.info.find((x) => x.code === 'user-tables');
    expect(i.message).toContain('2 user-authored tables');
  });

  it('NMA data present → unsupported-figure-kinds info', () => {
    const assets = [A('table:study', 'table')];
    const v = run(assets, [sec('results', 'x')], {
      project: { nma: { sm: 'OR', studies: [{ study: 'S1' }] } },
    });
    expect(codes(v.info)).toContain('unsupported-figure-kinds');
    // empty NMA dataset stays silent
    const quiet = run(assets, [sec('results', 'x')], { project: { nma: { sm: 'OR', studies: [] } } });
    expect(codes(quiet.info)).not.toContain('unsupported-figure-kinds');
  });

  it('every entry carries {code, message, action}', () => {
    const assets = [A('table:study', 'table', { stale: true }), A('table:sof', 'table')];
    const v = run(assets, [sec('results', '[[table:study]] and [[table:gone]] and Table 9.')], {
      saveState: 'saving', sourcesSettled: false, freshness: { status: 'updates', label: 'x' },
      dataStatus: { rob: 'error' },
    });
    for (const list of [v.errors, v.warnings, v.info]) {
      for (const e of list) {
        expect(typeof e.code).toBe('string');
        expect(typeof e.message).toBe('string');
        expect(e.message.length).toBeGreaterThan(0);
        expect(typeof e.action).toBe('string');
      }
    }
  });
});
