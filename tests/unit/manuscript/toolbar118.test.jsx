/**
 * 118.md §3-§9 / §41-§44 / §51-§54 / §57-§58 — the dedicated Manuscript Editor
 * toolbar (SSR contract tests, house style: renderToStaticMarkup, no jsdom —
 * interaction is asserted through control presence + ARIA state, and through the
 * PURE helpers the component derives its layout from).
 *
 * Covered here:
 *   - `updatesBadge`   : the real badge model (0 / 1-9 / large / critical / no
 *                        hardcoded number — §6, §69).
 *   - `toolbarDensity` : the §41 responsive thresholds.
 *   - Level A          : identity chip, the two SEMANTIC selects (§53/§54), the
 *                        condensed auto-draft notice + its full sentence (§5),
 *                        the save pill (§44), the §52 confirm popover copy.
 *   - Level B          : tablist semantics, aria-selected/aria-controls/roving
 *                        tabindex (§42), stable sub-tab test ids, underline
 *                        indicator, and that navigation is NOT eight CTA buttons (§9).
 *   - sticky           : position/top/z-index inside the engine (§7).
 *   - skeleton         : reserved toolbar dimensions while loading (§49).
 *   - wiring pins      : the workspace's one navigation seam + the `?ms=` round-trip.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import {
  ManuscriptToolbar, ManuscriptToolbarSkeleton, ManuscriptWorkspaceNav, NewDraftConfirm,
  AutoDraftNotice, ToolbarSelect, MANUSCRIPT_TABS, MANUSCRIPT_TAB_IDS, MS_PANEL_ID, msTabDomId,
  updatesBadge, toolbarDensity, levelAInline, LEVEL_A_CONTROLS, TOOLBAR_BREAKPOINTS, AUTO_DRAFT_FULL,
  MANUSCRIPT_TOOLBAR_CSS,
} from '../../../src/features/manuscript/ManuscriptToolbar.jsx';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';

const noop = () => {};

function mockM(extra = {}) {
  const draft = normalizeDraft(makeManuscriptDraft({ title: 'A pooled analysis' }));
  return {
    activeDraft: draft,
    activeId: draft.id,
    drafts: [draft],
    freshness: { status: 'ok', label: 'Up to date', counts: {} },
    outdatedCount: 0,
    saveState: 'saved', lastError: null, retry: noop,
    setMeta: noop, setActiveId: noop, addDraft: noop, flush: noop, refreshSyncPlan: noop,
    ...extra,
  };
}

const bar = (props = {}) => renderToStaticMarkup(
  <ManuscriptToolbar m={mockM(props.m)} tab={props.tab || 'overview'} onTabChange={noop} {...props.rest} />,
);

/* ══════════════ pure helpers ══════════════ */

describe('118.md §6/§69 — updatesBadge is derived from real sync state', () => {
  it('renders NO badge when the manuscript is in sync', () => {
    expect(updatesBadge({ status: 'ok', counts: {} }, 0)).toBe(null);
    expect(updatesBadge({ status: 'unknown', counts: {} }, 4)).toBe(null);
    expect(updatesBadge(null, 0)).toBe(null);
    expect(updatesBadge(undefined, undefined)).toBe(null);
  });

  it('renders NO badge when the status wants one but the real count is 0', () => {
    expect(updatesBadge({ status: 'updates', counts: { outdated: 0 } }, 0)).toBe(null);
  });

  it('1-9 shows the exact number, in the "updates" tone', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(updatesBadge({ status: 'updates', counts: { outdated: n } }, 0))
        .toEqual({ count: n, text: String(n), tone: 'yellow' });
    }
  });

  it('larger numbers keep counting; past 99 the TEXT caps but the count does not', () => {
    expect(updatesBadge({ status: 'updates', counts: { outdated: 42 } }, 0).text).toBe('42');
    expect(updatesBadge({ status: 'updates', counts: { outdated: 99 } }, 0).text).toBe('99');
    const big = updatesBadge({ status: 'updates', counts: { outdated: 250 } }, 0);
    expect(big.text).toBe('99+');
    expect(big.count).toBe(250);
  });

  it('critical sync state escalates the tone', () => {
    expect(updatesBadge({ status: 'critical', counts: { outdated: 3 } }, 0).tone).toBe('red');
  });

  it('falls back to the eager outdatedCount when the rollup has no count yet', () => {
    expect(updatesBadge({ status: 'updates', counts: {} }, 6)).toEqual({ count: 6, text: '6', tone: 'yellow' });
  });
});

describe('118.md §41 — toolbarDensity thresholds', () => {
  it('unmeasured (SSR / first paint) stays on the roomy layout', () => {
    expect(toolbarDensity(0)).toBe('full');
    expect(toolbarDensity(undefined)).toBe('full');
    expect(toolbarDensity(-1)).toBe('full');
  });
  it('grades the condensation, each tier at its own measured budget', () => {
    expect(toolbarDensity(1440)).toBe('full');
    expect(toolbarDensity(TOOLBAR_BREAKPOINTS.compact)).toBe('full');
    expect(toolbarDensity(TOOLBAR_BREAKPOINTS.compact - 1)).toBe('compact');
    expect(toolbarDensity(900)).toBe('compact');
    expect(toolbarDensity(TOOLBAR_BREAKPOINTS.overflow)).toBe('compact');
    expect(toolbarDensity(TOOLBAR_BREAKPOINTS.overflow - 1)).toBe('overflow');
    expect(toolbarDensity(TOOLBAR_BREAKPOINTS.minimal)).toBe('overflow');
    expect(toolbarDensity(TOOLBAR_BREAKPOINTS.minimal - 1)).toBe('minimal');
    expect(toolbarDensity(320)).toBe('minimal');
  });
});

describe('118.md §41 — levelAInline: what overflows, and what never disappears', () => {
  it('keeps everything inline while there is room', () => {
    expect(levelAInline('full')).toEqual(LEVEL_A_CONTROLS);
    expect(levelAInline('compact')).toEqual(LEVEL_A_CONTROLS);
  });

  it('sheds the least-used controls first — the two selects are the last to go', () => {
    expect(levelAInline('overflow')).toEqual(['template', 'citation']);
    expect(levelAInline('minimal')).toEqual([]);
  });

  it('every control is accounted for at every density — nothing is ever dropped', () => {
    for (const d of ['full', 'compact', 'overflow', 'minimal']) {
      const inline = levelAInline(d);
      const overflowed = LEVEL_A_CONTROLS.filter((k) => !inline.includes(k));
      expect([...inline, ...overflowed].sort()).toEqual([...LEVEL_A_CONTROLS].sort());
      // …and never in two places at once.
      expect(inline.filter((k) => overflowed.includes(k))).toEqual([]);
    }
  });
});

/* ══════════════ Level A ══════════════ */

describe('118.md §5/§44/§53/§54 — Level A document controls', () => {
  const html = bar();

  it('renders as ONE header with both levels', () => {
    expect(html).toContain('data-testid="stitch-manuscript-header"');
    expect(html).toContain('data-testid="stitch-manuscript-header-level-a"');
    expect(html).toContain('data-testid="stitch-manuscript-nav"');
  });

  it('§4 — carries the workspace identity, not a page heading', () => {
    expect(html).toContain('data-testid="stitch-manuscript-wordmark"');
    expect(html).toContain('Manuscript');
  });

  it('§53/§54 — Template and Citation style are ONE semantic control each', () => {
    expect(html).toContain('data-testid="stitch-manuscript-template-select"');
    expect(html).toContain('data-testid="stitch-manuscript-citation-select"');
    // the label and the value read as one phrase — "Template: <name> ▾"
    expect(html).toContain('Template:');
    expect(html).toContain('Citation style:');
    // …and the value is still a NATIVE select (keyboard, mobile picker, e2e).
    expect(html).toContain('aria-label="Template"');
    expect(html).toContain('aria-label="Citation style"');
    expect(html).toContain('<select');
  });

  it('§5 — the auto-draft warning is condensed, and the FULL sentence is still reachable', () => {
    expect(html).toContain('data-testid="stitch-manuscript-autodraft"');
    expect(html).toContain('Auto-draft');
    expect(html).toContain('· Verify generated content before submission');
    // the fuller explanation lives on the info trigger: tooltip content, native
    // title AND accessible name, so it never depends on a hover firing (§42).
    expect(html).toContain('data-testid="stitch-manuscript-autodraft-info"');
    expect(html).toContain(`aria-label="${AUTO_DRAFT_FULL}"`);
    expect(html).toContain(`title="${AUTO_DRAFT_FULL}"`);
    // …and it is a real focusable control, not a hover-only span.
    expect(html).toMatch(/<button[^>]*data-testid="stitch-manuscript-autodraft-info"/);
  });

  it('§44 — the save pill is in the toolbar, with its stable test id and wording', () => {
    expect(html).toContain('data-testid="stitch-manuscript-save-status"');
    expect(html).toContain('Saved');
  });

  it('§52 — New draft is a subtle action guarded by a confirmation popover', () => {
    expect(html).toContain('data-testid="stitch-manuscript-new-draft"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    // closed by default — the popover is not in the markup until it is asked for
    expect(html).not.toContain('data-testid="stitch-manuscript-new-draft-popover"');
  });

  it('the Draft select appears only once there is more than one draft', () => {
    expect(html).not.toContain('data-testid="stitch-manuscript-draft-select"');
    const two = normalizeDraft(makeManuscriptDraft({ title: 'Second' }));
    const multi = bar({ m: { drafts: [normalizeDraft(makeManuscriptDraft({ title: 'A pooled analysis' })), two] } });
    expect(multi).toContain('data-testid="stitch-manuscript-draft-select"');
    expect(multi).toContain('Draft:');
  });
});

describe('118.md §52 — the New draft confirmation says what it actually does', () => {
  it('names the additive behaviour explicitly (nothing is overwritten or deleted)', () => {
    const html = renderToStaticMarkup(
      <NewDraftConfirm currentTitle="A pooled analysis" onCancel={noop} onConfirm={noop} />,
    );
    expect(html).toContain('Start a new draft?');
    expect(html).toContain('<strong>adds</strong>');
    expect(html).toContain('A pooled analysis');
    expect(html).toContain('overwritten or deleted');
    expect(html).toContain('switch back at any time from the Draft menu');
    expect(html).toContain('data-testid="stitch-manuscript-new-draft-confirm"');
    expect(html).toContain('data-testid="stitch-manuscript-new-draft-cancel"');
    expect(html).toContain('Create draft');
    expect(html).toContain('Cancel');
  });

  it('degrades honestly when the draft has no title', () => {
    const html = renderToStaticMarkup(<NewDraftConfirm currentTitle="" onCancel={noop} onConfirm={noop} />);
    expect(html).toContain('the current draft');
  });
});

describe('118.md §41 — condensed Level A controls stay complete', () => {
  it('the auto-draft chip drops its tail but never its full explanation', () => {
    const html = renderToStaticMarkup(<AutoDraftNotice condensed />);
    expect(html).toContain('Auto-draft');
    expect(html).not.toContain('· Verify generated content before submission');
    expect(html).toContain(`aria-label="${AUTO_DRAFT_FULL}"`);
  });

  it('a condensed semantic select keeps its label, its value and its accessible name', () => {
    const html = renderToStaticMarkup(
      <ToolbarSelect label="Template" testid="t" condensed value="generic"
        onChange={noop} options={[{ id: 'generic', label: 'Generic biomedical journal' }]} />,
    );
    expect(html).toContain('Template:');
    expect(html).toContain('aria-label="Template"');
    expect(html).toContain('Generic biomedical journal');
  });
});

/* ══════════════ Level B ══════════════ */

describe('118.md §6/§9/§42 — Level B is a TAB LIST, not eight CTA buttons', () => {
  const html = bar({ tab: 'editor' });

  it('exposes tablist/tab semantics with the active destination announced', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Manuscript workspace"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect((html.match(/role="tab"/g) || []).length).toBe(MANUSCRIPT_TABS.length);
    expect((html.match(/aria-selected="true"/g) || []).length).toBe(1);
    expect(html).toContain(`id="${msTabDomId('editor')}"`);
    expect(html).toMatch(new RegExp(`id="${msTabDomId('editor')}"[^>]*aria-selected="true"`));
  });

  it('every tab points at the one tabpanel and uses a roving tabindex', () => {
    expect((html.match(new RegExp(`aria-controls="${MS_PANEL_ID}"`, 'g')) || []).length).toBe(MANUSCRIPT_TABS.length);
    expect((html.match(/tabindex="0"/g) || []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) || []).length).toBe(MANUSCRIPT_TABS.length - 1);
  });

  it('keeps the eight destinations and their stable test ids', () => {
    expect(MANUSCRIPT_TAB_IDS).toEqual(['overview', 'updates', 'editor', 'tables', 'figures', 'references', 'prisma', 'export']);
    for (const s of MANUSCRIPT_TABS) {
      expect(html).toContain(`data-testid="stitch-manuscript-subtab-${s.id}"`);
      expect(html).toContain(s.label);
    }
  });

  it('§9 — no nav item is styled as a filled CTA button', () => {
    const nav = html.slice(html.indexOf('role="tablist"'));
    expect(nav).not.toContain('linear-gradient');
  });

  it('§58 — the active destination carries a sliding underline (and a static one before it measures)', () => {
    expect(html).toContain('data-testid="stitch-manuscript-nav-indicator"');
    // SSR has no measurement yet, so the active tab paints its own underline: the
    // active destination is never ambiguous, even with JS still booting.
    expect(html).toMatch(/data-testid="stitch-manuscript-subtab-editor"[^>]*data-active="true"/);
  });
});

describe('118.md §6 — the Updates badge on the nav', () => {
  const withBadge = (freshness, outdatedCount) => bar({ m: { freshness, outdatedCount } });

  it('is absent when there is nothing to review', () => {
    expect(withBadge({ status: 'ok', counts: {} }, 0)).not.toContain('data-testid="stitch-manuscript-updates-badge"');
  });

  it('shows a single-digit count', () => {
    const html = withBadge({ status: 'updates', counts: { outdated: 6 } }, 6);
    expect(html).toContain('data-testid="stitch-manuscript-updates-badge"');
    expect(html).toContain('>6</span>');
    expect(html).toContain('aria-label="6 updates to review"');
  });

  it('says "update" in the singular for exactly one', () => {
    expect(withBadge({ status: 'updates', counts: { outdated: 1 } }, 1))
      .toContain('aria-label="1 update to review"');
  });

  it('caps the visible text for large counts but keeps the true number accessible', () => {
    const html = withBadge({ status: 'critical', counts: { outdated: 128 } }, 128);
    expect(html).toContain('>99+</span>');
    expect(html).toContain('aria-label="128 updates to review"');
  });
});

describe('118.md §42/§58 — focus states and motion', () => {
  it('every toolbar style rule is scoped to the bar — nothing reaches the document', () => {
    for (const rule of MANUSCRIPT_TOOLBAR_CSS.split('}').map((r) => r.trim()).filter(Boolean)) {
      expect(rule.startsWith('.ms-toolbar ')).toBe(true);
    }
  });

  it('§42 — the welded label+select chip rings as ONE control on focus', () => {
    // The app-wide `select:focus` ring would draw around the <select> alone, i.e.
    // half inside the chip. :focus-within is the only way to ring what the user
    // perceives as the control, and it cannot be expressed as an inline style.
    expect(MANUSCRIPT_TOOLBAR_CSS).toContain('.ms-toolbar .ms-tb-select:focus-within');
    expect(MANUSCRIPT_TOOLBAR_CSS).toContain('.ms-toolbar .ms-tb-select select:focus{box-shadow:none !important;}');
    // …and the rules are actually shipped with the bar.
    expect(bar()).toContain('.ms-toolbar .ms-tb-select:focus-within');
  });

  it('§58 — reduced motion removes the underline slide instead of shortening it', () => {
    const moving = renderToStaticMarkup(<ManuscriptWorkspaceNav tab="editor" onTabChange={noop} badge={null} />);
    const still = renderToStaticMarkup(<ManuscriptWorkspaceNav tab="editor" onTabChange={noop} badge={null} reduceMotion />);
    expect(moving).toContain('cubic-bezier(0.4,0,0.2,1)');
    const ind = still.slice(still.indexOf('data-testid="stitch-manuscript-nav-indicator"'));
    expect(ind.slice(0, ind.indexOf('>'))).toContain('transition:none');
    expect(still).not.toContain('cubic-bezier(0.4,0,0.2,1)');
  });
});

describe('118.md §41 — a condensed nav keeps every destination visible', () => {
  it('drops decoration, never labels or destinations', () => {
    const full = renderToStaticMarkup(<ManuscriptWorkspaceNav tab="overview" onTabChange={noop} badge={null} density="full" />);
    const compact = renderToStaticMarkup(<ManuscriptWorkspaceNav tab="overview" onTabChange={noop} badge={null} density="compact" />);
    for (const s of MANUSCRIPT_TABS) {
      expect(compact).toContain(`data-testid="stitch-manuscript-subtab-${s.id}"`);
      expect(compact).toContain(s.label);
    }
    // the icons are the thing that goes
    expect((full.match(/<svg/g) || []).length).toBe(MANUSCRIPT_TABS.length);
    expect(compact).not.toContain('<svg');
  });
});

/* ══════════════ sticky + loading ══════════════ */

describe('118.md §7 — sticky WITHIN the manuscript engine', () => {
  it('sticks at the engine scroller edge, under the shell and every modal', () => {
    const html = bar();
    const tag = html.slice(html.indexOf('data-testid="stitch-manuscript-header"'));
    const style = tag.slice(0, tag.indexOf('>'));
    expect(style).toMatch(/position:sticky/);
    expect(style).toMatch(/top:0/);
    expect(style).toMatch(/z-index:20/);
  });

  it('the surface is opaque — the document can never scroll visibly through it', () => {
    const src = readSource('src/features/manuscript/ManuscriptToolbar.jsx');
    // brand tint layered OVER an opaque token, not instead of one
    expect(src).toContain('${alpha(C.acc, \'05\')}), ${C.card}`');
  });
});

describe('118.md §49 — the loading skeleton reserves the toolbar', () => {
  const html = renderToStaticMarkup(<ManuscriptToolbarSkeleton />);
  it('reserves the dimensions without claiming any state', () => {
    expect(html).toContain('data-testid="stitch-manuscript-header-skeleton"');
    expect(html).toContain('Manuscript');
    // §69 — no fabricated save state, no fabricated counts.
    expect(html).not.toContain('Saved');
    expect(html).not.toContain('data-testid="stitch-manuscript-save-status"');
    expect(html).not.toContain('data-testid="stitch-manuscript-updates-badge"');
  });
});

/* ══════════════ wiring pins (not observable through SSR) ══════════════ */

describe('118.md §46/§47 — the workspace wiring', () => {
  const src = () => readSource('src/features/manuscript/ManuscriptWorkspace.jsx');

  it('there is ONE navigation seam, and it owns the Updates sync-plan refresh', () => {
    const s = src();
    expect(s).toContain("if (id === 'updates' && refreshPlanRef.current) refreshPlanRef.current();");
    // 118.md §12 (Wave 2) — RE-PINNED deliberately: the seam now reports BOTH engine
    // sub-params, because the view is URL state too and a href that carried only one
    // of them would drop the other on every push.
    expect(s).toContain("if (typeof hostNavRef.current === 'function') hostNavRef.current(id, viewRef.current);");
    // the toolbar and every panel change destination through the SAME function
    expect(s).toContain('<ManuscriptToolbar m={m} tab={tab} onTabChange={setTab}');
    expect(s).toContain('onNavigate={setTab}');
  });

  it('useManuscript stays mounted ABOVE the panels (edits survive a tab switch — §46)', () => {
    const s = src();
    expect(s.indexOf('const m = useManuscript(project, upd);')).toBeLessThan(s.indexOf("{tab === 'overview' &&"));
  });

  it('the old control row, banner and CTA button row are gone (§9)', () => {
    const s = src();
    expect(s).not.toContain('AI verify banner');
    expect(s).not.toContain("btnS(tab === s.id ? 'primary' : 'ghost')");
    expect(s).not.toContain('<SectionHeader');
  });

  it('the export validation dialog is still mounted ABOVE every panel', () => {
    const s = src();
    expect(s.indexOf('<ExportValidationDialog')).toBeLessThan(s.indexOf("{tab === 'overview' &&"));
  });

  it('the legacy shell keeps component state — the URL props are optional', () => {
    const s = src();
    // Re-pinned for 118.md §12: `initialView` joined the optional URL props; the
    // legacy shell passes none of them and still runs on component state alone.
    expect(s).toContain('export function ManuscriptWorkspace({ project, upd, initialSubtab, onSubtabChange, initialView })');
    expect(s).toContain("if (typeof hostNavRef.current !== 'function' || initialSubtab == null) return;");
  });

  it('§47 — Stitch drives the destination from ?ms= and pushes changes back', () => {
    const nav = readSource('src/frontend/stitch/nav/navConfig.js');
    expect(nav).toContain('export function readManuscriptSubParam(search)');
    expect(nav).toContain("return qs.get('ms') || 'overview';");
    expect(nav).toContain('export function manuscriptSubHref(subtabId, ctx = {})');
    expect(nav).toContain('?tab=manuscript&ms=${id}');

    const page = readSource('src/frontend/stitch/pages/StitchProjectWorkspace.jsx');
    expect(page).toContain('initialSubtab={readManuscriptSubParam(search)}');
    expect(page).toContain('onSubtabChange={(id, view) => navigate(manuscriptSubHref(id, { projectId, view }))}');
  });

  it('§43 — the toolbar adds no modifier chords, so Ctrl/Cmd+Z still reaches the editor', () => {
    const src2 = readSource('src/features/manuscript/ManuscriptToolbar.jsx');
    expect(src2).toContain('if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;');
    expect(src2).not.toContain('useShortcut');
  });

  it('§44 — the tools column no longer carries a second save pill', () => {
    const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
    expect(panels).not.toContain('<ToolsLabel>Save status</ToolsLabel>');
    expect((panels.match(/<SaveStatusPill/g) || []).length).toBe(0);
  });
});
