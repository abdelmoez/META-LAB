/**
 * 119.md §5 — the uploaded-figure workflow, pure layers.
 *
 * Covers the three things the whole feature stands on:
 *   1. the `[[figcap:<key>]]` block grammar (identity + position live in prose),
 *   2. the ONE registry (kind 'figure', origin 'upload' — never a new kind),
 *   3. ONE numbering sequence over generated and uploaded figures, driven by
 *      document position for the placed ones and first mention for the rest.
 *
 * Pure — no DOM, no network.
 */
import { describe, it, expect } from 'vitest';
import {
  figureCaptionLine, findFigureCaptions, collectPlacedFigures, figureUsage,
  figureUsageAcrossDrafts,
  dropDuplicateFigureMarkers, resolveNumbering, renderAssetMarkers, anchorsInProse,
  ASSET_KIND_IDS, findAssetTokens,
} from '../../../src/research-engine/manuscript/refTokens.js';
import { readSource } from '../../helpers/readSource.js';
import { computeManuscriptAssets } from '../../../src/research-engine/manuscript/assets.js';
import { normalizeDraft, makeManuscriptDraft } from '../../../src/research-engine/manuscript/model.js';

const draftWith = (sections) => normalizeDraft({
  ...makeManuscriptDraft({ id: 'd1' }),
  sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, { content: v }])),
});

const figRow = (over = {}) => ({
  id: 'row-1', figKey: 'fa1', fileName: 'flow.png', fileSize: 2048, mimeType: 'image/png',
  fileHash: 'h1', width: 800, height: 600, altText: '', sourceNote: '', origin: 'upload',
  uploadedBy: 'u1', uploadedByName: 'Dr A', createdAt: '2026-01-01T00:00:00.000Z',
  replacedCount: 0, ...over,
});

describe('119.md §5 — the figure marker grammar', () => {
  it('serializes and re-reads a marker line', () => {
    const line = figureCaptionLine('fa1', 'Study flow');
    expect(line).toBe('[[figcap:fa1]] Study flow');
    const found = findFigureCaptions(`intro\n${line}\nmore`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ figKey: 'fa1', assetId: 'figure:fa1', title: 'Study flow', line: 1 });
  });

  it('only a LINE-INITIAL marker is a figure (a mid-sentence one is not)', () => {
    expect(findFigureCaptions('see [[figcap:fa1]] here')).toHaveLength(0);
    expect(findFigureCaptions('   [[figcap:fa1]] Indented is still a figure')).toHaveLength(1);
  });

  it('cannot collide with the cross-reference token grammar', () => {
    // `figcap` is not in the closed kind alternation, so a marker is never a token.
    expect(ASSET_KIND_IDS).toEqual(['table', 'figure']);
    expect(findAssetTokens('[[figcap:fa1]] Title')).toHaveLength(0);
    expect(findAssetTokens('as shown in [[figure:fa1]]')).toHaveLength(1);
  });

  it('collects placed figures in document order, first occurrence wins', () => {
    const d = draftWith({
      methods: '[[figcap:fb2]] Method figure',
      results: '[[figcap:fa1]] Result figure\n\n[[figcap:fb2]] A copy',
    });
    const placed = collectPlacedFigures(d);
    expect(placed.map((p) => p.figKey)).toEqual(['fb2', 'fa1']);
    expect(placed[0].sectionId).toBe('methods');
  });

  it('figureUsage separates the placement from the cross-references', () => {
    const d = draftWith({
      methods: 'As shown in [[figure:fa1]] and again [[figure:fa1]].',
      results: '[[figcap:fa1]] Study flow',
    });
    const u = figureUsage(d, 'fa1');
    expect(u).toMatchObject({ placed: true, references: 2 });
    expect(u.sectionIds).toEqual(['results']);
    expect(u.referenceSections).toEqual(['methods']);
  });

  it('a pasted duplicate marker is DROPPED (its bytes belong to the original)', () => {
    const { md, dropped } = dropDuplicateFigureMarkers(
      '[[figcap:fa1]] Copy\n\nSome prose', new Set(['fa1']),
    );
    expect(dropped).toEqual(['fa1']);
    expect(md).not.toContain('[[figcap:');
    expect(md).toContain('Some prose');
    // …but MOVING one (its key not yet in use) keeps it, so cross-refs survive.
    const moved = dropDuplicateFigureMarkers('[[figcap:fa1]] Moved', new Set());
    expect(moved.dropped).toEqual([]);
    expect(moved.md).toContain('[[figcap:fa1]]');
  });
});

describe('119.md §5 — the ONE registry', () => {
  it('an uploaded figure is kind:figure / origin:upload — NOT a new asset kind', () => {
    const d = draftWith({ results: '[[figcap:fa1]] Study flow' });
    const assets = computeManuscriptAssets({}, d, { figures: [figRow()] });
    const up = assets.find((a) => a.id === 'figure:fa1');
    expect(up).toBeTruthy();
    expect(up.kind).toBe('figure');
    expect(up.origin).toBe('upload');
    expect(anchorsInProse(up)).toBe(true);
    expect(up.placed).toBe(true);
    expect(up.available).toBe(true);
    expect(up.title).toBe('Study flow');
    expect(up).toMatchObject({ figureId: 'row-1', width: 800, height: 600, uploadedByName: 'Dr A' });
  });

  it('an uploaded-but-unplaced figure is listed, honestly, as not included', () => {
    const d = draftWith({ results: 'no figures here' });
    const assets = computeManuscriptAssets({}, d, { figures: [figRow()] });
    const up = assets.find((a) => a.id === 'figure:fa1');
    expect(up.placed).toBe(false);
    expect(up.included).toBe(false);
    expect(up.available).toBe(true);
  });

  it('a marker whose row is gone is honestly UNAVAILABLE when the store is known', () => {
    const d = draftWith({ results: '[[figcap:fghost]] Missing' });
    const known = computeManuscriptAssets({}, d, { figures: [] });
    expect(known.find((a) => a.id === 'figure:fghost').available).toBe(false);
    // …but with NO store knowledge, a real figure is never accused of being deleted.
    const unknown = computeManuscriptAssets({}, d, {});
    expect(unknown.find((a) => a.id === 'figure:fghost').available).toBe(true);
  });

  it('draft.assets overrides reach an uploaded figure through the existing channel', () => {
    const d = normalizeDraft({
      ...makeManuscriptDraft({ id: 'd1' }),
      sections: { results: { content: '[[figcap:fa1]] Study flow' } },
      assets: { 'figure:fa1': { caption: 'Cap', legend: 'Leg', altText: 'Alt', displayWidth: 60, align: 'left' } },
    });
    const up = computeManuscriptAssets({}, d, { figures: [figRow()] }).find((a) => a.id === 'figure:fa1');
    expect(up).toMatchObject({ caption: 'Cap', legend: 'Leg', altText: 'Alt', displayWidth: 60, align: 'left' });
  });

  it('a display width outside the safe layout range is clamped, never honoured', () => {
    const mk = (w) => normalizeDraft({
      ...makeManuscriptDraft({ id: 'd1' }),
      sections: { results: { content: '[[figcap:fa1]] F' } },
      assets: { 'figure:fa1': { displayWidth: w } },
    });
    const widthOf = (w) => computeManuscriptAssets({}, mk(w), { figures: [figRow()] })
      .find((a) => a.id === 'figure:fa1').displayWidth;
    expect(widthOf(500)).toBe(100);
    expect(widthOf(2)).toBe(20);
  });
});

describe('119.md §5 — ONE numbering sequence', () => {
  it('a placed picture numbers by POSITION, interleaved with generated figures', () => {
    const d = draftWith({
      // The PRISMA figure is referenced first, so it is Figure 1; the uploaded
      // picture sits after it in the document, so it is Figure 2.
      methods: 'Screening is summarised in [[figure:prisma]].',
      results: '[[figcap:fa1]] Study flow',
    });
    const assets = computeManuscriptAssets(
      { studies: [] }, d,
      { figures: [figRow()], prismaCounts: { hasAny: true } },
    );
    const n = resolveNumbering({ sections: d, assets });
    expect(n.byId['figure:prisma']).toBe(1);
    expect(n.byId['figure:fa1']).toBe(2);
  });

  it('moving the picture ABOVE the mention renumbers both', () => {
    const d = draftWith({
      methods: '[[figcap:fa1]] Study flow\n\nScreening is summarised in [[figure:prisma]].',
    });
    const assets = computeManuscriptAssets(
      { studies: [] }, d,
      { figures: [figRow()], prismaCounts: { hasAny: true } },
    );
    const n = resolveNumbering({ sections: d, assets });
    expect(n.byId['figure:fa1']).toBe(1);
    expect(n.byId['figure:prisma']).toBe(2);
  });

  it('a MENTION of a placed picture never moves its number (117.md §7 rule)', () => {
    const d = draftWith({
      introduction: 'We will return to [[figure:fa1]] later.',
      results: '[[figcap:fa1]] Study flow',
      discussion: '[[figcap:fb2]] Second figure',
    });
    const assets = computeManuscriptAssets({}, d, {
      figures: [figRow(), figRow({ id: 'row-2', figKey: 'fb2', fileName: 'b.png' })],
    });
    const n = resolveNumbering({ sections: d, assets });
    expect(n.byId['figure:fa1']).toBe(1);   // Results precedes Discussion
    expect(n.byId['figure:fb2']).toBe(2);
  });

  it('deleting the marker un-numbers the figure and its references go unresolved', () => {
    const before = draftWith({ results: '[[figcap:fa1]] Flow\n\nSee [[figure:fa1]].' });
    const after = draftWith({ results: 'See [[figure:fa1]].' });
    const rows = [figRow()];
    const nb = resolveNumbering({ sections: before, assets: computeManuscriptAssets({}, before, { figures: rows }) });
    expect(nb.byId['figure:fa1']).toBe(1);
    // The row still exists (deferred binary deletion), so the reference resolves —
    // the figure is simply not placed any more and prints at the end if referenced.
    const na = resolveNumbering({ sections: after, assets: computeManuscriptAssets({}, after, { figures: rows }) });
    expect(na.byId['figure:fa1']).toBe(1);
    expect(na.autoIncluded.has('figure:fa1')).toBe(true);
    // With the ROW gone too there is no registry entry at all, so the reference is
    // reported UNKNOWN — which is what paints the chip visibly broken rather than
    // letting it renumber to whatever now sits at that position (117.md §11).
    const gone = resolveNumbering({ sections: after, assets: computeManuscriptAssets({}, after, { figures: [] }) });
    expect(gone.byId['figure:fa1']).toBeUndefined();
    expect(gone.unresolved.map((u) => u.id)).toContain('figure:fa1');
    expect(gone.unresolved.find((u) => u.id === 'figure:fa1').reason).toBe('unknown');
  });

  it('renderAssetMarkers turns the marker into its formatted caption', () => {
    const d = draftWith({ results: '[[figcap:fa1]] Study flow' });
    const assets = computeManuscriptAssets({}, d, { figures: [figRow()] });
    const n = resolveNumbering({ sections: d, assets });
    expect(renderAssetMarkers('[[figcap:fa1]] Study flow', n, assets)).toBe('Figure 1. Study flow');
  });
});

describe('119.md §5 — byte stability', () => {
  it('a draft that never used figures normalizes without any new key', () => {
    const raw = { ...makeManuscriptDraft({ id: 'd1' }) };
    const before = JSON.stringify(normalizeDraft(raw));
    const after = JSON.stringify(normalizeDraft(JSON.parse(before)));
    expect(after).toBe(before);
    expect(JSON.parse(after)).not.toHaveProperty('figures');
    expect(JSON.parse(after)).not.toHaveProperty('figureMeta');
  });
});

/* ══ r2 — ONE delete-safety counter, shared by the client and the server ══════ */

/**
 * The delete route destroys nothing while a figure is still used, and the client
 * refuses to even ask when its own freshly-flushed draft already places it. Two
 * counts, one function: if they could disagree, the disagreement IS the window in
 * which a figure's bytes are deleted out from under a marker Ctrl+Z would restore.
 */
describe('119.md §5 (r2) — figureUsageAcrossDrafts is the ONE usage gate', () => {
  const drafts = [
    { id: 'd1', sections: { results: { content: '[[figcap:fa1]] Flow' + String.fromCharCode(10, 10) + 'see [[figure:fa1]] and [[figure:fa1]]' } } },
    { id: 'd2', sections: { methods: { content: 'nothing here' } }, statements: { data: 'also [[figure:fa1]]' } },
  ];

  it('counts placements and cross-references across EVERY draft, sections and statements', () => {
    expect(figureUsageAcrossDrafts(drafts, 'fa1')).toEqual({ placements: 1, references: 3, total: 4 });
    expect(figureUsageAcrossDrafts(drafts, 'other')).toEqual({ placements: 0, references: 0, total: 0 });
  });

  it('is total-safe on junk input — an unreadable blob never reads as "unused"', () => {
    expect(figureUsageAcrossDrafts(null, 'fa1').total).toBe(0);
    expect(figureUsageAcrossDrafts([null, 7, {}], 'fa1').total).toBe(0);
    expect(figureUsageAcrossDrafts(drafts, '').total).toBe(0);
    expect(figureUsageAcrossDrafts(drafts, null).total).toBe(0);
  });

  it('a figure token of another KIND is never counted as a figure reference', () => {
    const d = [{ sections: { results: { content: '[[table:fa1]] and [[figure:fa1]]' } } }];
    expect(figureUsageAcrossDrafts(d, 'fa1')).toEqual({ placements: 0, references: 1, total: 1 });
  });

  it('both gates really call it — the server delete route and the client hook', () => {
    const ctrl = readSource('server/controllers/manuscriptFigureController.js');
    expect(ctrl).toContain("import { figureUsageAcrossDrafts } from '../../src/research-engine/manuscript/refTokens.js';");
    expect(ctrl).toContain('return figureUsageAcrossDrafts((data && data.manuscripts) || [], figKey);');
    const hook = readSource('src/features/manuscript/useManuscript.js');
    expect(hook).toContain("import { figureUsageAcrossDrafts } from '../../research-engine/manuscript/refTokens.js';");
    const del = hook.slice(hook.indexOf('const deleteFigure = useCallback('));
    // The flush comes FIRST: the point is to count the draft including the last
    // ~600 ms of typing, which is exactly what the server cannot see.
    expect(del.indexOf('const flushed = flushPending();')).toBeLessThan(del.indexOf('figureUsageAcrossDrafts('));
    expect(del.slice(0, 1200)).toContain('return { deleted: false, blocked: true, usage: local };');
  });
});
