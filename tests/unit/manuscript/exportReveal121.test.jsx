/**
 * 121.md §3 — "Automatically Reveal Export Errors and Warnings".
 *
 * House style, same split as pdfSplit119: the RULES are pure and are tested as such
 * (the reveal state machine, the navigability rule, the identity threading through
 * validateExport/validateCitations); the surfaces are asserted through SSR markup
 * (renderToStaticMarkup — no jsdom), i.e. through roles, ARIA state and control
 * presence; and the two guarantees no rendered assertion can reach — "one frame, not
 * a magic delay" and "the scroll goes through the manuscript's own sticky-aware
 * utilities and keeps the active-section indicator honest" — are pinned against the
 * SOURCE, which is where those guarantees live.
 *
 * SSR SAFETY is itself part of the contract: this suite renders the region and the
 * dialog with no window and no document, so the reveal must be effect-only and
 * guarded (see the source pins at the end).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import {
  ExportFeedbackRegion, ExportRunErrorNotice, ExportValidationDialog,
  EXPORT_FEEDBACK_HEADING_ID,
} from '../../../src/features/manuscript/manuscriptPanels.jsx';
import { exportRevealKey, destinationFor } from '../../../src/features/manuscript/ManuscriptWorkspace.jsx';
import {
  findingTarget, validateExport, validateCitations,
} from '../../../src/research-engine/manuscript/exportValidation.js';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import {
  computeManuscriptAssets, resolveNumbering, computePlacements,
} from '../../../src/research-engine/manuscript/index.js';

const noop = () => {};

/* ══════════ the live region ══════════ */

describe('121.md §3 — ONE announced surface, with the right politeness', () => {
  const render = (props, children) => renderToStaticMarkup(
    <ExportFeedbackRegion headingId={EXPORT_FEEDBACK_HEADING_ID} {...props}>{children}</ExportFeedbackRegion>,
  );

  it('a blocking failure is an assertive alert', () => {
    const html = render({ blocked: true }, <p>x</p>);
    expect(html).toContain('data-testid="stitch-manuscript-export-feedback"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('data-tone="blocking"');
    // …labelled by the heading the reveal also focuses, so the announcement names it.
    expect(html).toContain(`aria-labelledby="${EXPORT_FEEDBACK_HEADING_ID}"`);
  });

  it('a warnings-only review is a polite status, not an alert', () => {
    const html = render({ blocked: false }, <p>x</p>);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-tone="advisory"');
    expect(html).not.toContain('role="alert"');
  });

  it('§3 — the run-error notice carries the focusable heading and a next step', () => {
    const html = renderToStaticMarkup(
      <ExportRunErrorNotice message="Word export failed" headingId={EXPORT_FEEDBACK_HEADING_ID} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-export-error"');
    expect(html).toContain(`id="${EXPORT_FEEDBACK_HEADING_ID}"`);
    // Focus can be MOVED to it without putting it in the tab order (§3's "move
    // keyboard focus to the message or its heading").
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('Export failed — nothing was downloaded');
    expect(html).toContain('Word export failed');
    expect(html).toContain('Fix the problem and run the export again');
    // The three-way distinction §3 asks for reuses the tone tags that already exist.
    expect(html).toContain('Blocks export');
    // It is NOT its own live region — that would announce the same failure twice.
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-live');
    expect(renderToStaticMarkup(<ExportRunErrorNotice message="" />)).toBe('');
  });
});

/* ══════════ the dialog's new wiring ══════════ */

describe('121.md §3 — the review dialog joins the region instead of pretending to be a modal', () => {
  const review = (validation, extra) => ({ validation, fetchedAt: '2026-07-14T10:00:00.000Z', ...extra });

  it('RE-PINNED (was role="alertdialog"): the card announces nothing on its own', () => {
    /* 85.md B2 gave this Card role="alertdialog". It is an in-flow panel: nothing
       ever moved focus into it and nothing traps focus in it, so a screen reader was
       told "dialog" about something that never behaved like one. 121.md §3 puts the
       announcement on the ONE live region it now renders inside; the dialog's own
       anatomy (testids, headings, copy, the Export-anyway rule) is unchanged. */
    const html = renderToStaticMarkup(
      <ExportValidationDialog review={review({ errors: [], warnings: [{ code: 'x', message: 'Figure never referenced.', action: 'Insert a reference.' }], info: [] })}
        onExportAnyway={noop} onClose={noop} exporting={null} />,
    );
    expect(html).not.toContain('alertdialog');
    expect(html).toContain('data-testid="stitch-manuscript-export-validation"');
    expect(html).toContain('Check before you export');
    expect(html).toContain('data-testid="stitch-manuscript-export-anyway"');
  });

  it('the heading takes the region label + focus target only when it is given one', () => {
    const withId = renderToStaticMarkup(
      <ExportValidationDialog review={review({ errors: [{ code: 'e', message: 'Broken.', action: 'Fix.' }], warnings: [], info: [] })}
        onExportAnyway={noop} onClose={noop} headingId={EXPORT_FEEDBACK_HEADING_ID} />,
    );
    expect(withId).toContain(`id="${EXPORT_FEEDBACK_HEADING_ID}"`);
    expect(withId).toContain('tabindex="-1"');
    expect(withId).toContain('Export blocked');
    // Stand-alone (a host that does not wrap it) — no stray id, no stray tabstop.
    const bare = renderToStaticMarkup(
      <ExportValidationDialog review={review({ errors: [], warnings: [], info: [{ code: 'i', message: 'FYI.', action: 'None.' }] })}
        onExportAnyway={noop} onClose={noop} />,
    );
    expect(bare).not.toContain(`id="${EXPORT_FEEDBACK_HEADING_ID}"`);
    expect(bare).not.toContain('tabindex="-1"');
  });

  it('§3 — "Go to it" appears exactly for findings that HAVE a destination', () => {
    const v = {
      errors: [{ code: 'unknown-asset-ref', message: 'Broken ref.', action: 'Fix.', target: { sectionId: 'methods' } }],
      warnings: [{ code: 'pending-save', message: 'Still saving.', action: 'Wait.' }],
      info: [{ code: 'cite-statement', message: 'In a declaration.', action: 'Fix.', target: { statementKey: 'funding' } }],
    };
    const html = renderToStaticMarkup(
      <ExportValidationDialog review={review(v)} onExportAnyway={noop} onClose={noop} onGoTo={noop} />,
    );
    // the targeted error …
    expect(html).toContain('data-testid="stitch-manuscript-export-goto-err-0"');
    expect(html).toContain('data-code="unknown-asset-ref"');
    expect(html).toContain('Go to it');
    // … and NOT the untargeted warning, nor the statement-anchored info (there is no
    // place `statement:<key>` can be navigated to today, so the control is omitted
    // honestly rather than rendered dead).
    expect(html).not.toContain('data-testid="stitch-manuscript-export-goto-warn-0"');
    expect(html).not.toContain('data-testid="stitch-manuscript-export-goto-info-0"');
  });

  it('a host that cannot navigate gets no buttons at all', () => {
    const html = renderToStaticMarkup(
      <ExportValidationDialog
        review={review({ errors: [{ code: 'c', message: 'm', action: 'a', target: { sectionId: 'methods' } }], warnings: [], info: [] })}
        onExportAnyway={noop} onClose={noop} />,
    );
    expect(html).not.toContain('Go to it');
  });
});

/* ══════════ the reveal state machine ══════════ */

describe('121.md §3 — when there is something NEW to reveal', () => {
  const rev = (over) => ({ fetchedAt: '2026-07-14T10:00:00.000Z', validation: { errors: [], warnings: [{ code: 'w' }], info: [] }, ...over });

  it('nothing to say is the empty key (which also RESETS the latch)', () => {
    expect(exportRevealKey('', null)).toBe('');
  });

  it('a run error outranks a review — it is the thing that just happened', () => {
    expect(exportRevealKey('Word export failed', rev())).toContain('error Word export failed');
  });

  it('the SAME review object, re-created, is the same key (no re-scroll, no focus theft)', () => {
    // The workspace builds a fresh {model, validation, fetchedAt} on every attempt, so
    // keying the effect on object identity would re-fire on any unrelated re-render.
    expect(exportRevealKey('', rev())).toBe(exportRevealKey('', rev()));
    expect(exportRevealKey('', rev())).not.toBe('');
  });

  it('a re-check ALWAYS re-reveals: newer fetchedAt, and the recheck flag as well', () => {
    const first = exportRevealKey('', rev());
    const recheck = exportRevealKey('', rev({ fetchedAt: '2026-07-14T10:05:00.000Z', recheck: true }));
    expect(recheck).not.toBe(first);
    expect(recheck).toContain('recheck');
    // …and even a same-instant re-check is distinguishable by the flag alone.
    expect(exportRevealKey('', rev({ recheck: true }))).not.toBe(first);
  });

  it('finding counts are part of the key, so a changed review re-reveals', () => {
    const more = rev({ validation: { errors: [{ code: 'e' }], warnings: [{ code: 'w' }], info: [] } });
    expect(exportRevealKey('', more)).not.toBe(exportRevealKey('', rev()));
  });

  it('a review with no validation at all does not crash the key', () => {
    expect(typeof exportRevealKey('', { fetchedAt: 'x' })).toBe('string');
  });
});

/* ══════════ the navigability rule ══════════ */

describe('121.md §3 — findingTarget is the ONE rule for "can this go somewhere?"', () => {
  it('accepts the four destinations the manuscript navigation really has', () => {
    expect(findingTarget({ target: { sectionId: 'methods' } })).toEqual({ sectionId: 'methods' });
    expect(findingTarget({ target: { assetId: 'table:study', sectionId: 'results' } }))
      .toEqual({ assetId: 'table:study', sectionId: 'results' });
    expect(findingTarget({ target: { manualId: 't1', sectionId: 'results' } })).toBeTruthy();
    expect(findingTarget({ target: { refId: 'r1' } })).toEqual({ refId: 'r1' });
  });

  /* 121.md r2 — F0/F7. A GENERATED table/figure carries no sectionId (it is not
     anchored in the prose), so `findingTarget` returned a bare {assetId} that
     `goToFinding` could not route: the "Go to it" control rendered and did nothing,
     while still flipping the narrow stacked split away from the PDF. The target is
     navigable — the Tables & Figures panel is where these very entries' action text
     sends the researcher — so the fix is to ROUTE it, and the identity that makes the
     routing honest (which panel) now travels with the target. */
  it('a bare-assetId target is accepted AND says which panel it belongs to', () => {
    expect(findingTarget({ target: { assetId: 'table:study', kind: 'table' } }))
      .toEqual({ assetId: 'table:study', kind: 'table' });
    expect(findingTarget({ target: { assetId: 'figure:prisma', kind: 'figure' } }).kind)
      .toBe('figure');
  });

  it('refuses a statement-anchored finding, and anything with no identity', () => {
    // citations.js emits `statement:<key>` pseudo-sections for the declaration fields;
    // openSection cannot go there, so the control is omitted rather than offered.
    expect(findingTarget({ target: { statementKey: 'funding' } })).toBe(null);
    expect(findingTarget({ code: 'pending-save', message: 'm', action: 'a' })).toBe(null);
    expect(findingTarget(null)).toBe(null);
    expect(findingTarget({ target: 'methods' })).toBe(null);
  });
});

/* ══════════ identity threading, against the real engine ══════════ */

function draftWith(content) {
  const draft = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
  draft.sections.results.content = content;
  return draft;
}

describe('121.md §3 — every producing site keeps the identity it already had', () => {
  it('a broken table/figure reference points at the SECTION it is written in', () => {
    const draft = draftWith('See [[table:nope]] for details.');
    const assets = computeManuscriptAssets({ id: 'p1', studies: [] }, draft, { tables: {} });
    const numbering = resolveNumbering({ sections: draft, assets });
    const placements = computePlacements({ sections: draft, assets, numbering });
    const v = validateExport({ project: { id: 'p1' }, draft, assets, numbering, placements });
    const broken = v.errors.find((e) => e.code === 'unknown-asset-ref');
    expect(broken).toBeTruthy();
    expect(findingTarget(broken)).toEqual({ sectionId: 'results' });
  });

  it('a citation to a missing reference points at its section; one in a DECLARATION does not', () => {
    const inProse = draftWith('A claim [[cite:ghost]].');
    const proseV = validateCitations({ draft: inProse, references: [{ id: 'r1', title: 'Real' }] });
    const cite = proseV.errors.find((e) => e.code === 'cite-unknown');
    expect(cite).toBeTruthy();
    expect(findingTarget(cite)).toEqual({ sectionId: 'results' });

    const inStatement = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    inStatement.statements = { ...(inStatement.statements || {}), funding: 'Funded [[cite:ghost]].' };
    const stV = validateCitations({ draft: inStatement, references: [{ id: 'r1', title: 'Real' }] });
    const stCite = stV.errors.find((e) => e.code === 'cite-unknown');
    expect(stCite).toBeTruthy();
    expect(stCite.target).toEqual({ statementKey: 'funding' });
    expect(findingTarget(stCite)).toBe(null);   // honest omission, not a dead button
  });

  it('a library finding points at the REFERENCE, which is where it is fixed', () => {
    const draft = draftWith('A claim [[cite:r1]].');
    const v = validateCitations({ draft, references: [{ id: 'r1', title: 'Only a title' }] });
    const incomplete = v.warnings.find((e) => e.code === 'cited-ref-incomplete');
    expect(incomplete).toBeTruthy();
    expect(findingTarget(incomplete)).toEqual({ refId: 'r1' });
  });

  /* 121.md r2 — F0/F7, against the real validator: the most common warning class of
     all (a generated table that has gone stale after a data refresh) is exactly the
     one that produced a dead control. */
  it('a stale GENERATED asset points at the object and at the panel that owns it', () => {
    const v = validateExport({
      draft: { sections: [] },
      assets: [{
        id: 'table:study', kind: 'table', origin: 'auto',
        title: 'Study characteristics', available: true, included: true, stale: true,
      }],
      numbering: { byId: { 'table:study': 1 }, unresolved: [] },
      placements: {},
    });
    const stale = v.warnings.find((e) => e.code === 'stale-asset');
    expect(stale).toBeTruthy();
    // No sectionId — a generated asset is not in the prose — but not a dead end either.
    expect(findingTarget(stale)).toEqual({ assetId: 'table:study', kind: 'table' });
    expect(stale.target.sectionId).toBeUndefined();
  });

  it('untargeted findings keep the exact {code,message,action} shape they always had', () => {
    const draft = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    const v = validateExport({ draft, assets: [], numbering: {}, placements: {}, saveState: 'saving' });
    const pending = v.warnings.find((e) => e.code === 'pending-save');
    expect(pending).toBeTruthy();
    expect(Object.keys(pending).sort()).toEqual(['action', 'code', 'message']);
  });
});

/* ══════════ the guarantees only the source can carry ══════════ */

describe('121.md §3 — the reveal itself', () => {
  const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');

  it('ONE requestAnimationFrame — never a setTimeout with a magic delay', () => {
    // §3: "Avoid timing bugs where scrolling occurs before the message has rendered.
    // Use the framework's appropriate post-render lifecycle rather than arbitrary
    // delays." An effect runs after the commit; the frame is what guarantees the
    // browser has LAID the region out before its box is measured.
    expect(ws).toContain('window.requestAnimationFrame');
    expect(ws).not.toMatch(/setTimeout\(\s*run\s*,\s*[1-9]/);
  });

  it('scrolls through the manuscript’s OWN sticky-aware utility, never raw scrollIntoView', () => {
    // 118.md §17 — a naive scrollIntoView({block:'start'}) puts the message UNDER the
    // sticky purple toolbar, which is the exact bug §17 fixed for sections.
    expect(ws).toContain('scrollSectionIntoView(el)');
    expect(ws).not.toContain('el.scrollIntoView(');
  });

  /* ── 121.md r2 — the routing half of §3 ─────────────────────────────────────── */

  it('every target the control offers is one goToFinding actually reaches', () => {
    // F0/F7 — a bare-assetId target (a generated table/figure) goes to the panel that
    // owns it, which is where the entry's own action text points.
    expect(ws).toContain("setTab(target.kind === 'figure' ? 'figures' : 'tables');");
    // F1 — …and the References panel is one of the EDITOR tabpanels, so a refId jump
    // in the narrow stacked layout has to bring that pane forward too, or it updates a
    // display:none box and the researcher keeps looking at the PDF.
    expect(ws).toContain(
      'const editorBound = !!(target.sectionId || target.assetId || target.manualId || target.refId);',
    );
  });

  it('keeps the 118.md §16/§17 active-section indicator honest', () => {
    expect(ws).toContain('suppressActiveScroll(800);');
  });

  it('moves focus WITHOUT letting the browser fight the reduced-motion scroll', () => {
    expect(ws).toContain('h.focus({ preventScroll: true })');
  });

  it('is effect-only and SSR-guarded (this suite renders with no window)', () => {
    expect(ws).toContain("if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;");
  });

  it('the narrow stacked split shows the editor before jumping into it', () => {
    // A jump into a display:none pane silently no-ops.
    expect(ws).toContain("if (editorBound) setStackPane('editor');");
  });

  it('reuses the three navigation callbacks that already exist', () => {
    expect(ws).toContain('openAsset({ sectionId: target.sectionId, assetId: target.assetId, manualId: target.manualId });');
    expect(ws).toContain('if (target.sectionId) { openSection(target.sectionId); return; }');
    expect(ws).toContain("if (target.refId) { openReference(target.refId, 'view'); return; }");
  });

  it('a jump into the manuscript does not close the researcher’s PDF pane', () => {
    /* `setTab('editor')` is one end of the ONE open/close path, so asking for the
       editor BY NAME closed an open pane as a side effect of a jump that was never
       about the pane — and, because the workspace un-full-bleeds with it, the scroll
       the jump had just computed was measured against a column that no longer
       existed. destinationFor is the projection that already knows the answer. */
    expect(destinationFor('editor', true)).toBe('pdfview');
    expect(destinationFor('editor', false)).toBe('editor');
    expect(ws).toContain("() => setTab(destinationFor('editor', splitOpenRef.current)), [setTab],");
    expect(ws).toContain('if (!draftSectionIds(m.activeDraft).includes(id)) { openEditorDestination(); return; }');
    // …and the asset jump takes the same route.
    const openAsset = ws.slice(ws.indexOf('const openAsset = useCallback('));
    expect(openAsset.slice(0, openAsset.indexOf('}, ['))).toContain('openEditorDestination();');
  });

  it('…and the section it jumps to is not undone by the panel’s own mount scroll', () => {
    /* Arriving from another destination MOUNTS EditorPanel, so its "land on the
       section you were last in" mount effect is scheduled in the same commit as the
       request. That effect's rAF reads a ref that a setState from a passive effect
       had not refreshed yet, so it scrolled back and won. */
    const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
    const eff = panels.slice(panels.indexOf('const id = sectionRequest.id;'));
    expect(eff.slice(0, eff.indexOf('}, [sectionRequest]);'))).toContain('selRef.current = id;');
    // The mount effect still reads the ref — that is the whole reason the write works.
    expect(panels).toContain('scrollToSection(selRef.current, { instant: true })');
  });

  it('there is exactly ONE announced surface — the panel copies stay unannounced echoes', () => {
    const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
    const overview = readSource('src/features/manuscript/ManuscriptOverview.jsx');
    // The four per-panel InfoBoxes are still plain InfoBoxes: no role, no aria-live.
    expect(panels).not.toContain('<InfoBox role=');
    expect(overview).not.toContain('<InfoBox role=');
    // …and the workspace mounts exactly one region.
    expect(ws.split('<ExportFeedbackRegion').length - 1).toBe(1);
  });

  it('nothing about the feedback reaches the project blob (byte stability)', () => {
    const region = ws.slice(ws.indexOf('const exportFeedbackRef'), ws.indexOf('const runExport'));
    expect(region).not.toContain('upd(');
    expect(region).not.toContain('localStorage');
  });
});
