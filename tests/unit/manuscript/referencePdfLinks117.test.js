/**
 * 117.md §38 / §J.3 — "Open PDF" resolves through the EXISTING screening attachment
 * endpoint.
 *
 * Before this, `pdfAttachmentId` was written by nothing, so the chip-menu action
 * never appeared and §38's "Open PDF" was a seam rather than a feature. The fix does
 * not store anything new: a DERIVED reference is an included study, a screened study
 * names its screening record, and that record's attachment listing is the same
 * pre-117 route the screening viewer, `usePdfSource` and `robFullText` already call.
 *
 * What this file pins:
 *   - which references have a resolvable target, and which screening workspace they
 *     resolve against (a reference's own id beats the project's linked one);
 *   - that the lookup is BATCHED per screening record, CACHED both ways, and that an
 *     in-flight lookup is shared rather than repeated (§33 performance);
 *   - that a FAILED listing stays unknown — never "no PDF" — and is retried;
 *   - the decoration step the chip menu renders from, and the source pins for the
 *     two UI seams (resolve on menu open, and the honest Files-tab fallback).
 */
import { describe, it, expect } from 'vitest';
import {
  pdfTargetKey, pdfLinkTargetOf, collectPdfLinkTargets, pdfAttachmentIdFor,
  withResolvedPdfIds, createReferencePdfResolver,
} from '../../../src/features/manuscript/referencePdfLinks.js';
import { resolveReferenceLibrary } from '../../../src/research-engine/manuscript/referenceLibrary.js';
import { readSource } from '../../helpers/readSource.js';

const SCREENED = { id: 's1', title: 'Screened trial', screeningRecordId: 'rec1' };
const FOREIGN = { id: 's2', title: 'From another workspace', screeningRecordId: 'rec2', screeningProjectId: 'sift-other' };
const MANUAL = { id: 'm1', title: 'Typed by hand' };
const ALREADY = { id: 's3', title: 'Already linked', pdfAttachmentId: 'att-9', screeningRecordId: 'rec3' };

/* ════════════ which reference resolves where ════════════ */

describe('117.md §J.3 — the screening record a reference resolves against', () => {
  it('uses the project’s linked workspace when the reference names none', () => {
    expect(pdfLinkTargetOf(SCREENED, 'sift-1')).toEqual({ screenProjectId: 'sift-1', recordId: 'rec1' });
  });

  it('a reference that names its OWN workspace wins (an imported review keeps its link)', () => {
    expect(pdfLinkTargetOf(FOREIGN, 'sift-1')).toEqual({ screenProjectId: 'sift-other', recordId: 'rec2' });
  });

  it('a reference with no screening record has no target at all', () => {
    expect(pdfLinkTargetOf(MANUAL, 'sift-1')).toBeNull();
    expect(pdfLinkTargetOf(SCREENED, '')).toBeNull();   // …and neither does an unlinked project
    expect(pdfLinkTargetOf(null, 'sift-1')).toBeNull();
  });

  it('the derived reference CARRIES the linkage through the resolver seam', () => {
    const project = {
      studies: [{
        id: 's1', title: 'Screened trial', authors: 'Lee K', year: '2020',
        screeningRecordId: 'rec1', screeningProjectId: 'sift-1',
      }],
    };
    const ref = resolveReferenceLibrary(project).refs[0];
    expect(ref.screeningRecordId).toBe('rec1');
    expect(ref.screeningProjectId).toBe('sift-1');
    expect(pdfLinkTargetOf(ref, null)).toEqual({ screenProjectId: 'sift-1', recordId: 'rec1' });
  });
});

/* ════════════ batching + caching ════════════ */

describe('117.md §J.3/§33 — the lookup is lazy, batched and cached', () => {
  it('collects ONE target per screening record and skips what is already known', () => {
    const twice = { id: 's4', title: 'Same record, second reference', screeningRecordId: 'rec1' };
    const { targets, byRefId } = collectPdfLinkTargets([SCREENED, twice, MANUAL, ALREADY], 'sift-1', {});
    expect(targets).toEqual([{ screenProjectId: 'sift-1', recordId: 'rec1' }]);
    expect([...byRefId.keys()].sort()).toEqual(['s1', 's4']);
    // A reference that already names its attachment is never looked up.
    expect(byRefId.has('s3')).toBe(false);
  });

  it('an already-resolved record is not fetched again (either answer counts)', () => {
    const known = { 'sift-1::rec1': 'att-1', 'sift-1::rec9': null };
    const nine = { id: 's9', title: 'Checked, has none', screeningRecordId: 'rec9' };
    expect(collectPdfLinkTargets([SCREENED, nine], 'sift-1', known).targets).toEqual([]);
  });

  it('resolves a batch with ONE call per record and caches both outcomes', async () => {
    const calls = [];
    const resolver = createReferencePdfResolver({
      listPdf: (pid, rid) => {
        calls.push(`${pid}::${rid}`);
        return Promise.resolve(rid === 'rec1' ? { attachments: [{ id: 'att-1' }] } : { attachments: [] });
      },
    });
    const patch = await resolver.resolve([
      { screenProjectId: 'sift-1', recordId: 'rec1' },
      { screenProjectId: 'sift-1', recordId: 'rec2' },
    ]);
    expect(patch).toEqual({ 'sift-1::rec1': 'att-1', 'sift-1::rec2': null });
    expect(calls).toEqual(['sift-1::rec1', 'sift-1::rec2']);

    // A second ask learns nothing new and costs no request.
    expect(await resolver.resolve([{ screenProjectId: 'sift-1', recordId: 'rec1' }])).toEqual({});
    expect(calls).toHaveLength(2);
  });

  it('two overlapping asks share ONE in-flight request', async () => {
    let calls = 0;
    let release = null;
    const resolver = createReferencePdfResolver({
      listPdf: () => { calls += 1; return new Promise((res) => { release = () => res({ attachments: [{ id: 'att-1' }] }); }); },
    });
    const t = [{ screenProjectId: 'sift-1', recordId: 'rec1' }];
    const a = resolver.resolve(t);
    const b = resolver.resolve(t);
    // `listPdf` is invoked in a microtask, so let both asks reach it before releasing.
    await Promise.resolve(); await Promise.resolve();
    release();
    expect(await a).toEqual({ 'sift-1::rec1': 'att-1' });
    expect(await b).toEqual({ 'sift-1::rec1': 'att-1' });
    expect(calls).toBe(1);
  });

  it('a FAILED listing is unknown, not "no PDF", and is retried next time', async () => {
    let attempt = 0;
    const resolver = createReferencePdfResolver({
      listPdf: () => {
        attempt += 1;
        return attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ attachments: [{ id: 'att-7' }] });
      },
    });
    const t = [{ screenProjectId: 'sift-1', recordId: 'rec1' }];
    expect(await resolver.resolve(t)).toEqual({});               // nothing learned
    expect(resolver.known['sift-1::rec1']).toBeUndefined();       // and nothing cached
    expect(await resolver.resolve(t)).toEqual({ 'sift-1::rec1': 'att-7' });
    expect(attempt).toBe(2);
  });

  it('an empty ask makes no request at all', async () => {
    const resolver = createReferencePdfResolver({ listPdf: () => { throw new Error('must not be called'); } });
    expect(await resolver.resolve([])).toEqual({});
  });
});

/* ════════════ what the menu renders from ════════════ */

describe('117.md §38/§J.3 — the decoration the chip menu reads', () => {
  const resolved = { 'sift-1::rec1': 'att-1', 'sift-1::rec2': null };

  it('names the attachment for a resolved reference and nothing for an unresolved one', () => {
    expect(pdfAttachmentIdFor(SCREENED, 'sift-1', resolved)).toBe('att-1');
    expect(pdfAttachmentIdFor({ id: 'x', screeningRecordId: 'rec2' }, 'sift-1', resolved)).toBe('');
    expect(pdfAttachmentIdFor(MANUAL, 'sift-1', resolved)).toBe('');
    expect(pdfAttachmentIdFor(SCREENED, 'sift-1', {})).toBe('');
  });

  it('a reference that already carries an id keeps it, resolver or not', () => {
    expect(pdfAttachmentIdFor(ALREADY, 'sift-1', {})).toBe('att-9');
  });

  it('decorating adds pdfAttachmentId without touching anything else', () => {
    const out = withResolvedPdfIds([SCREENED, MANUAL], 'sift-1', resolved);
    expect(out[0]).toEqual({ ...SCREENED, pdfAttachmentId: 'att-1' });
    expect(out[1]).toBe(MANUAL);
  });

  it('nothing to decorate returns the SAME array (a hover must not re-render)', () => {
    const list = [MANUAL, ALREADY];
    expect(withResolvedPdfIds(list, 'sift-1', {})).toBe(list);
    expect(withResolvedPdfIds(list, 'sift-1', resolved)).toBe(list);
  });

  it('the cache key names the record, so two references on one record share it', () => {
    expect(pdfTargetKey({ screenProjectId: 'sift-1', recordId: 'rec1' })).toBe('sift-1::rec1');
    expect(pdfTargetKey(null)).toBe('');
  });
});

/* ════════════ the UI seams (source pins) ════════════ */

describe('117.md §J.3 — the surfaces are wired to the resolver (source pins)', () => {
  const panels = readSource(new URL('../../../src/features/manuscript/manuscriptPanels.jsx', import.meta.url));
  const hook = readSource(new URL('../../../src/features/manuscript/useManuscript.js', import.meta.url));

  it('the chip menu resolves on MENU OPEN, never on hover', () => {
    expect(panels).toContain('const openCiteMenu = (info) => {');
    expect(panels).toContain('m.resolveReferencePdfs(info.ids || [])');
    // 118.md §18 — RE-PINNED: the callbacks are built per MOUNTED section now (the
    // continuous document mounts ten editors), so the chip reports which section it
    // belongs to. The resolver still fires from the MENU path only.
    expect(panels).toContain('onCiteChipMenu: (info) => openCiteMenu({ ...info, sectionId: id })');
    expect(panels).toContain('onCiteChipHover: (info) => setCiteHover(info ? { ...info, sectionId: id } : null)');
    // the hover path must not touch the resolver
    expect(panels).not.toContain('setCiteHover(info ? { ...info, sectionId: id } : null); m.resolveReferencePdfs');
  });

  it('the menu decorates its references from the resolution map', () => {
    expect(panels).toContain('return withResolvedPdfIds(list, m.screenProjectId, m.referencePdfIds);');
  });

  it('"Open PDF" opens the SCREENING viewer, not a new one', () => {
    expect(panels).toContain("import('../../frontend/screening/components/PdfViewer.jsx')");
    expect(panels).toContain('<Viewer pid={target.screenProjectId} recordId={target.recordId} canManage={false} defaultOpen flush />');
  });

  it('an unresolvable PDF still falls back to the honest Files-tab notice', () => {
    expect(panels).toContain('export const REFERENCE_PDF_MISSING_NOTE =');
    expect(panels).toContain('setNotice(REFERENCE_PDF_MISSING_NOTE)');
  });

  it('the hook owns the cache, keyed per project, and calls the pre-117 endpoint', () => {
    expect(hook).toContain('createReferencePdfResolver({ listPdf: screeningApi.listPdf })');
    expect(hook).toContain('if (!refPdfResolverRef.current || refPdfProjectRef.current !== pid) {');
    expect(hook).toContain('resolveReferencePdfs, referencePdfTarget,');
  });
});
