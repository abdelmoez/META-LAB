/**
 * prisma117r2.test.js — the 117.md r2 adversarial-review fixes that are not already
 * covered by an existing suite.
 *
 * Grouped by the defect each one closes, because that is the only thing that makes a
 * regression legible later:
 *
 *   §14  the journal ZIP's methods-text.md described the LEGACY prisma blob while the
 *        same ZIP's figure and report.html were drawn from the canonical flow
 *   §17  overrides were applied AFTER the engine's reconciliation, so an impossible
 *        count reached the counts table, the narrative and the export in silence
 *   §24  the export dialog's decimal selector was silently beaten by the per-figure
 *        `decimals` override
 *   §13  PrismaFlowDiagram's 1.2s poke timer outlived the component;
 *        SecondReviewTab had no realtime channel at all
 *   §42  the edge-reveal zone stole every pointer event in the leftmost 6px
 *   §46  the pdf.js text layer was missing the z-index half of the end-of-content port;
 *        the annotation control's pointer latch could stick forever
 *   §79  the Final Review e2e locators matched two buttons for a project owner
 *
 * Pure logic is exercised directly. Client WIRING (effects, subscriptions, cleanup
 * functions, CSS injected as a string) is pinned through tests/helpers/readSource.js —
 * the repo has no jsdom, and these are ordering/lifetime facts a static render cannot
 * observe.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { overrideCoherenceWarnings, computePrismaCounts } from '../../src/research-engine/manuscript/prismaCounts.js';
import { exportFigureOpts } from '../../src/frontend/workspace/charts/svgBuilders.js';
import { releasesControlLatch } from '../../src/frontend/components/PdfAnnotationLayer.jsx';
import StitchAppShell from '../../src/frontend/stitch/shell/StitchAppShell.jsx';
import { AuthProvider } from '../../src/frontend/context/AuthContext.jsx';
import { FocusModeProvider } from '../../src/frontend/focus/FocusModeContext.jsx';
import { readSource } from '../helpers/readSource.js';

const src = (rel) => readSource(new URL(`../../${rel}`, import.meta.url));

const w2 = src('src/frontend/workspace/Workspace.jsx');

/* ════════════════════ §17 — an override cannot break the flow in silence ════════ */

describe('§17 (r2) — overridden counts are re-checked against the stage identities', () => {
  it('names the broken identity AND both numbers when screened exceeds identified', () => {
    // The reviewer's worked example: a review that identified 100 records cannot have
    // screened 2,164 of them. Before this the sentence "2,164 records were screened"
    // went into the Methods paragraph with no warning anywhere.
    const w = overrideCoherenceWarnings({ identified: 100, screened: 2164 });
    expect(w).toHaveLength(1);
    expect(w[0]).toBe('Override makes records screened (2,164) exceed records identified (100).');
  });

  it('checks identified − removed = screened as an EQUALITY once the removal is known', () => {
    const w = overrideCoherenceWarnings({ identified: 2481, dedupe: 317, screened: 2000 });
    expect(w).toEqual([
      'Override breaks records identified − duplicates removed = records screened '
      + '(2,481 − 317 = 2,164, but records screened is 2,000).',
    ]);
    // …and says nothing when the identity holds.
    expect(overrideCoherenceWarnings({ identified: 2481, dedupe: 317, screened: 2164 })).toEqual([]);
  });

  it('reports the outright impossibility ONCE, not twice, when a dedup count is also known', () => {
    // `screened > identified` is illegal whatever the dedup count is, so the headline
    // sentence stands alone rather than being joined by the equality break it implies.
    expect(overrideCoherenceWarnings({ identified: 100, dedupe: 0, screened: 2164 })).toEqual([
      'Override makes records screened (2,164) exceed records identified (100).',
    ]);
  });

  it('covers the retrieval, eligibility and inclusion stages too', () => {
    expect(overrideCoherenceWarnings({ screened: 100, excludedScreen: 120 })[0])
      .toMatch(/records excluded at screening \(120\) exceed records screened \(100\)/);
    expect(overrideCoherenceWarnings({ sought: 50, notRetrieved: 60 })[0])
      .toMatch(/reports not retrieved \(60\) exceed reports sought for retrieval \(50\)/);
    expect(overrideCoherenceWarnings({ sought: 50, notRetrieved: 5, reportsAssessed: 40 })[0])
      .toMatch(/50 − 5 = 45, but reports assessed is 40/);
    expect(overrideCoherenceWarnings({ reportsAssessed: 20, included: 25 })[0])
      .toMatch(/studies included \(25\) exceed reports assessed for eligibility \(20\)/);
    expect(overrideCoherenceWarnings({ included: 10, includedQuant: 12 })[0])
      .toMatch(/studies in the meta-analysis \(12\) exceed studies included in the review \(10\)/);
    expect(overrideCoherenceWarnings({ screened: -4 })[0])
      .toMatch(/records screened negative \(-4\)/);
  });

  it('never INFERS a missing count as zero — an unresolved pair is simply not compared', () => {
    expect(overrideCoherenceWarnings({ identified: 100 })).toEqual([]);
    expect(overrideCoherenceWarnings({ screened: 2164 })).toEqual([]);
    expect(overrideCoherenceWarnings({ identified: null, screened: 2164 })).toEqual([]);
    expect(overrideCoherenceWarnings({})).toEqual([]);
    expect(overrideCoherenceWarnings(null)).toEqual([]);
  });

  it('reaches the real result: an impossible override warns on the flow path', () => {
    const flow = {
      counts: {
        identified: 100, identifiedDb: 100, identifiedOther: 0, duplicatesRemoved: 0,
        screened: 100, excludedScreen: 10, sought: 90, notRetrieved: 0,
        reportsAssessed: 90, reportsExcluded: 80, included: 10, includedReports: 10, includedQuant: 10,
      },
      exclusionReasons: [],
      reconciliation: { issues: [] },
    };
    const clean = computePrismaCounts({}, { flow });
    expect(clean.warnings).toEqual([]);

    const bad = computePrismaCounts({}, { flow, overrides: { screened: 2164 } });
    expect(bad.counts.screened).toBe(2164);
    // The override is honoured (§21) AND contradicted out loud (§17) — both, never one.
    expect(bad.warnings.some(m => m.includes('Override makes records screened (2,164) exceed records identified (100)'))).toBe(true);
    expect(bad.warnings.some(m => m.includes('manually overridden'))).toBe(true);
    // The automated value is still recoverable — nothing derived was destroyed.
    expect(bad.overrides.screened).toEqual({ value: 2164, auto: 100 });
  });

  it('a LEGAL override stays silent apart from the "this is an override" notice', () => {
    const flow = {
      counts: {
        identified: 100, identifiedDb: 100, identifiedOther: 0, duplicatesRemoved: 0,
        screened: 100, excludedScreen: 10, sought: 90, notRetrieved: 0,
        reportsAssessed: 90, reportsExcluded: 80, included: 10, includedReports: 10, includedQuant: 10,
      },
      exclusionReasons: [],
      reconciliation: { issues: [] },
    };
    // 11 included studies out of 90 assessed, with 10 of them pooled — legal on every
    // identity, so nothing but the §21 "this is an override" notice may be said.
    const ok = computePrismaCounts({}, { flow, overrides: { included: 11 } });
    expect(ok.warnings.filter(m => m.startsWith('Override'))).toEqual([]);
    expect(ok.warnings).toHaveLength(1);            // just the §21 notice
  });
});

/* ════════════════════ §14 — one ZIP, one set of PRISMA numbers ══════════════════ */

describe('§14 (r2) — the journal ZIP cannot describe different counts than it draws', () => {
  const w = src('src/frontend/workspace/Workspace.jsx');

  it('methods-text.md derives its PRISMA block from the SAME canonical flow as the figure', () => {
    // One fetch feeds the figure, report.html and now the methods text.
    expect(w).toContain('const canonicalFlow=await fetchCanonicalPrismaFlow();');
    expect(w).toContain('const zipCounts=canonicalFlow?computePrismaCounts(project,{flow:canonicalFlow}).counts:null;');
    expect(w).toContain('prisma:prismaBlock,');
    expect(w).toContain('import { computePrismaCounts } from "../../research-engine/manuscript/prismaCounts.js";');
  });

  it('and falls back to the legacy blob on exactly the condition the FIGURE falls back on', () => {
    // Soft fallback, not a hard failure: a manuscript-only project still gets a
    // methods paragraph, drawn from the same numbers its figure uses.
    expect(w).toContain(':{identified:idTotal||null,deduped:(+pr.dedupe||null),included:(+pr.included||null)}');
    expect(w).toContain('canonicalFlow?buildPrismaFlowSVG(canonicalFlow,{title:"",perSource:true}):buildPrismaSVG(pr,{title:""})');
  });
});

/* ════════════════════ §24 — the export dialog governs its own export ════════════ */

describe('§24/§41 (r2) — an explicit export decimal choice beats the per-figure override', () => {
  it('drops the per-figure `decimals` when an export precision is supplied', () => {
    const figure = { esType: 'OR', decimals: 4, title: 'T', prec: { decimals: 2, trailingZeros: true } };
    const out = exportFigureOpts(figure, { decimals: 3, trailingZeros: false });
    expect(out.decimals).toBeNull();
    expect(out.prec).toEqual({ decimals: 3, trailingZeros: false });
    // Everything else about the figure is untouched — this is a precision rule only.
    expect(out.title).toBe('T');
    expect(out.esType).toBe('OR');
  });

  it('is the IDENTITY without an export precision, so on-screen keeps the per-figure value', () => {
    const figure = { esType: 'OR', decimals: 4, prec: { decimals: 2 } };
    expect(exportFigureOpts(figure, null)).toBe(figure);
    expect(exportFigureOpts(figure, undefined)).toBe(figure);
    expect(exportFigureOpts(figure, 0)).toBe(figure);
    expect(exportFigureOpts(null, { decimals: 3 })).toEqual({ prec: { decimals: 3 }, decimals: null });
  });

  it('the builder then honours the export precision, where it used to be overruled', () => {
    // The builder's own merge rule is what made the old call sites wrong: `decimals`
    // non-null wins over `prec`. Pinned here so the two halves stay in agreement.
    const b = src('src/frontend/workspace/charts/svgBuilders.js');
    expect(b).toContain('const prec=o.decimals==null?o.prec:{...normalizePrecision(o.prec),decimals:o.decimals};');
    expect(b).toContain('export function exportFigureOpts(figureOpts,exportPrecision){');
  });

  it('every EXPORT call site is wrapped, and the on-screen preview deliberately is not', () => {
    const a = src('src/frontend/workspace/tabs/analysisTabs.jsx');
    expect(a).toContain('const expOpts=exportFigureOpts(pubOpts,choice.precision);');
    expect(a).toContain('buildPubForestSVG(result,{...expOpts,prec:ep})');
    expect(a).toContain('buildPubForestSVG(result,{...expOpts,prec:ep,noBg:!!choice.transparent})');
    // The preview keeps the per-figure decimals — that is the "on-screen" half of the rule.
    expect(a).toContain('const built=buildPubForestSVG(result,pubOpts);');
    expect(w2).toContain('exportFigureOpts({esType,...resolveForestFigure(p,_pooled.pair),prec},precOverride)');
  });

  it('the dialog OPENS on the figure\'s own decimals, so nothing is silently downgraded', () => {
    const a = src('src/frontend/workspace/tabs/analysisTabs.jsx');
    expect(a).toContain('precision:{...normalizePrecision(prec),...(figure.decimals==null?{}:{decimals:figure.decimals})},');
    const d = src('src/frontend/components/ExportDialog.jsx');
    expect(d).toContain('const precision = (item && item.precision) || projectPrecision;');
  });
});

/* ════════════════════ §13 — live surfaces, and timers that die with them ════════ */

describe('§13 (r2) — the debounced poke timers cannot outlive their components', () => {
  it('PrismaFlowDiagram clears its 1.2s timer on unmount', () => {
    const f = src('src/features/prisma/PrismaFlowDiagram.jsx');
    expect(f).toContain('useEffect(() => () => {\n    if (pokeTimer.current) { clearTimeout(pokeTimer.current); pokeTimer.current = null; }\n  }, []);');
    expect(f).toContain("import { useCallback, useEffect, useMemo, useRef, useState } from 'react';");
  });

  it('SecondReviewTab subscribes to the three flow-relevant events, debounced, silent', () => {
    const t = src('src/frontend/screening/tabs/SecondReviewTab.jsx');
    expect(t).toContain("import { useRealtime } from '../../hooks/useRealtime.js';");
    expect(t).toContain('const REALTIME_DEBOUNCE_MS = 1200;');
    expect(t).toContain("'handoff.updated': onPoke,");
    expect(t).toContain("'decision.saved': onPoke,");
    expect(t).toContain("'record.updated': onPoke,");
    expect(t).toContain("loadRef.current({ silent: true });");
    // …and its own timer is cleaned up for the same reason as the diagram's.
    expect(t).toContain('if (pokeTimer.current) { clearTimeout(pokeTimer.current); pokeTimer.current = null; }');
  });

  it('every refusal path reloads, so the note is followed by the truth', () => {
    const t = src('src/frontend/screening/tabs/SecondReviewTab.jsx');
    expect(t).toContain('const reloadAfterConflict = useCallback(() => { loadRef.current({ silent: true }); }, []);');
    // the forward write's failure branch (the optimistic patch was rolled back to a
    // belief the failure calls into question) …
    expect(t).toMatch(/patchRecord\(rid, \(\) => \(\{ \.\.\.prev \}\)\);[\s\S]{0,900}reloadAfterConflict\(\);/);
    // … and the undo/redo executor's 409 branch.
    expect(t).toMatch(/e\.status === 409[\s\S]{0,600}reloadAfterConflict\(\);/);
  });
});

/* ════════════════════ §42 — the edge zone stops stealing clicks ═════════════════ */

describe('§42 (r2) — the reveal is a threshold, not an overlay', () => {
  const shellHtml = (focus) => renderToStaticMarkup(
    <MemoryRouter>
      <AuthProvider>
        <FocusModeProvider initial={focus}>
          <StitchAppShell
            focusable
            breadcrumb="Project / PICO"
            renderPrimaryRail={() => <nav data-testid="primary-rail">rail</nav>}
            contextRail={<nav data-testid="the-submenu">stepper</nav>}
            coordinatedNav
          >
            <div>work</div>
          </StitchAppShell>
        </FocusModeProvider>
      </AuthProvider>
    </MemoryRouter>,
  );

  it('the marker element is inert: no pointer handlers, pointer-events none', () => {
    const html = shellHtml(true);
    const at = html.indexOf('data-testid="focus-edge-zone"');
    expect(at).toBeGreaterThan(-1);
    const tag = html.slice(html.lastIndexOf('<div', at), html.indexOf('>', at) + 1);
    expect(tag).toContain('pointer-events:none');
    expect(tag).toContain('width:6px');
    // React would have rendered nothing for the handlers, so the real pin is on the
    // source: the props are GONE, not merely invisible in the markup.
    const s = src('src/frontend/stitch/shell/StitchAppShell.jsx');
    const marker = s.slice(s.indexOf('data-testid="focus-edge-zone"') - 200, s.indexOf('data-testid="focus-edge-zone"') + 400);
    expect(marker).not.toContain('onPointerEnter');
    expect(marker).not.toContain('onPointerLeave');
  });

  it('the reveal is driven by a throttled document pointermove with a trailing flush', () => {
    const s = src('src/frontend/stitch/shell/StitchAppShell.jsx');
    expect(s).toContain("document.addEventListener('pointermove', onMove, { capture: true, passive: true });");
    expect(s).toContain('const near = x <= EDGE_ZONE_W;');
    expect(s).toContain('if (near === inZone.current) return;');
    // The trailing flush is what keeps a single scripted move to x=1 working — a plain
    // leading-edge throttle would drop it and the e2e edge-reveal step would hang.
    expect(s).toContain('if (!trailing) trailing = setTimeout(flush, wait);');
    expect(s).toContain("document.removeEventListener('pointermove', onMove, true);");
    expect(s).toContain('const EDGE_SAMPLE_MS = 40;');
  });

  it('a move that leaves the threshold INTO the open drawer does not arm auto-hide', () => {
    const s = src('src/frontend/stitch/shell/StitchAppShell.jsx');
    expect(s).toContain('if (panel && target && typeof panel.contains === \'function\' && panel.contains(target)) return;');
  });

  it('and none of it exists outside Focus Mode', () => {
    expect(shellHtml(false)).not.toContain('focus-edge-zone');
  });
});

/* ════════════════════ §46 — PDF stacking + the pointer latch ════════════════════ */

describe('§46 (r2) — the text layer sits ABOVE the end-of-content sink', () => {
  const v = src('src/frontend/components/AppPdfViewer.jsx');

  it('ports the pdf_viewer.css z-index rule the sink half depended on', () => {
    expect(v).toContain('.mlpdf-tl > :not(.markedContent),\n.mlpdf-tl .markedContent span:not(.markedContent){z-index:1;}');
  });

  it('and the sink rule stays LATER in the sheet, so it keeps z-index 0', () => {
    // Equal specificity — source order decides. If the sink rule ever moves above the
    // span rule, the sink wins for itself too and covers the page again.
    const spans = v.indexOf('.mlpdf-tl > :not(.markedContent)');
    const sink = v.indexOf('.mlpdf-tl .mlpdf-eoc{');
    expect(spans).toBeGreaterThan(-1);
    expect(sink).toBeGreaterThan(spans);
    expect(v).toContain('.mlpdf-tl.mlpdf-selecting .mlpdf-eoc{top:0;}');
  });

  it('search highlights are CHILDREN of the lifted spans, so they ride above it too', () => {
    // The highlight effect rewrites the span's contents; it never replaces the span.
    expect(v).toContain("const spans = tl.querySelectorAll(':scope > span');");
    expect(v).toContain("const mark = document.createElement('mark');");
    expect(v).toContain('span.appendChild(frag);');
  });
});

describe('§46 (r2) — an aborted press on the control cannot wedge selection capture', () => {
  const box = {
    contains: (n) => !!n && n.__inControl === true,
  };
  const inPadding = { __inControl: true, closest: () => null };
  const onButton = { __inControl: true, closest: (sel) => (sel === 'button' ? { __inControl: true } : null) };
  const outside = { __inControl: false, closest: () => null };

  it('releases on a press that ended on the group PADDING — the stuck case', () => {
    expect(releasesControlLatch(inPadding, box)).toBe(true);
  });

  it('does NOT release on a real control button — its click is about to commit', () => {
    // Releasing here would undo §46 itself: WebKit does not focus buttons on click, so
    // `engagingControl()` would fall through and the collapsed-selection teardown would
    // unmount the control before its click landed.
    expect(releasesControlLatch(onButton, box)).toBe(false);
  });

  it('releases on a press that ended outside the control, and on pointercancel always', () => {
    expect(releasesControlLatch(outside, box)).toBe(true);
    expect(releasesControlLatch(onButton, box, true)).toBe(true);
    expect(releasesControlLatch(null, box)).toBe(true);
    expect(releasesControlLatch(inPadding, null)).toBe(true);
  });

  it('is wired at document capture for both pointerup and pointercancel', () => {
    const p = src('src/frontend/components/PdfAnnotationLayer.jsx');
    expect(p).toContain("document.addEventListener('pointerup', release, true);");
    expect(p).toContain("document.addEventListener('pointercancel', release, true);");
    expect(p).toContain('if (releasesControlLatch(e.target, controlRef.current, cancelled)) controlHeldRef.current = false;');
    // `latchedRef` is the commit payload — releasing the GUARD must not drop it.
    expect(p).not.toContain('latchedRef.current = null;\n      controlHeldRef.current = false;');
  });
});

/* ════════════════════ §79 — the e2e can address one button at a time ═══════════ */

describe('§79 (r2) — Final Review controls are addressable without ambiguity', () => {
  const t = src('src/frontend/screening/tabs/SecondReviewTab.jsx');
  const spec = src('e2e/screening/finalReviewUndo.spec.ts');

  it('the reviewer VOTE and the leader VERDICT carry distinct testids', () => {
    expect(t).toContain('data-testid={`final-review-vote-${opt.value}`}');
    expect(t).toContain('testId="final-review-accept"');
    expect(t).toContain('testId="final-review-exclude"');
    expect(t).toContain('testId="final-review-reopen"');
    expect(t).toContain('testId="final-review-exclude-confirm"');
    expect(t).toContain('testId="final-review-reopen-confirm"');
  });

  it('the screening Button primitive actually forwards testId to the DOM', () => {
    const c = src('src/frontend/screening/ui/components.jsx');
    expect(c).toContain('data-testid={testId}');
    expect(c).toContain('full, testId }');
  });

  it('the spec locates by testid, and asserts the ambiguity it used to trip over', () => {
    expect(spec).toContain("sift.main.getByTestId('final-review-exclude')");
    expect(spec).toContain("dialog(sift).getByTestId('final-review-exclude-confirm')");
    expect(spec).toContain("sift.main.getByTestId('final-review-accept')");
    expect(spec).toContain("sift.main.getByTestId('final-review-reopen')");
    expect(spec).toContain("dialog(sift).getByTestId('final-review-reopen-confirm')");
    // The two-Exclude / one-Include audit the reviewer asked for, kept in the spec so a
    // copy change that reintroduces the collision fails loudly.
    expect(spec).toContain("await expect(sift.main.getByRole('button', { name: /^Exclude$/ })).toHaveCount(2);");
    expect(spec).toContain("await expect(sift.main.getByRole('button', { name: /^Include$/ })).toHaveCount(1);");
  });
});
