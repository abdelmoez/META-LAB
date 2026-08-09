/**
 * shellHistory.test.jsx — 108.md §§2-3, §17, §22-24. The SHELL half of the
 * interaction layer: the shared provider stack, the header Undo/Redo pair, the
 * Stitch modal stamp, and the migration of the two remaining ad-hoc global keydown
 * listeners into the router.
 *
 * House style: renderToStaticMarkup, no jsdom, no RTL. Effects never run, so
 * anything effect-driven (the window listener, the executors) is asserted through
 * the pure modules it is built from; the SOURCE-level migrations are pinned by
 * reading the files, the same fallback tests/unit/screening/keywordUndoWiring.test.js
 * uses for logic trapped inside a very large component.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import ProjectInteractionProvider from '../../../src/frontend/history/ProjectInteractionProvider.jsx';
import { useProjectHistory } from '../../../src/frontend/history/HistoryContext.jsx';
import { useUndoFeedback } from '../../../src/frontend/history/useUndoFeedback.jsx';
import { useShortcuts } from '../../../src/frontend/shortcuts/ShortcutProvider.jsx';
import {
  HistoryControlsView, StitchHistoryControls,
} from '../../../src/frontend/stitch/shell/StitchHistoryControls.jsx';
import { STITCH_MODAL_ATTR } from '../../../src/research-engine/interaction/modalSignal.js';

const src = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

let seen = null;
function Probe() {
  const hist = useProjectHistory();
  const fb = useUndoFeedback();
  const sc = useShortcuts();
  seen = { hist, fb, sc };
  return h('span', {
    'data-testid': 'probe',
    'data-scope': hist.scope,
    'data-project': String(hist.projectId == null ? '' : hist.projectId),
    'data-can-undo': String(hist.canUndo),
    'data-can-redo': String(hist.canRedo),
  });
}

describe('ProjectInteractionProvider — the one stack every shell mounts', () => {
  it('supplies history, feedback and the shortcut registry to its children', () => {
    const html = r(h(ProjectInteractionProvider, { projectId: 'p1', scope: 'extraction' }, h(Probe)));
    expect(html).toContain('data-scope="extraction"');
    expect(html).toContain('data-project="p1"');
    expect(html).toContain('data-can-undo="false"');
    expect(typeof seen.hist.record).toBe('function');
    expect(typeof seen.hist.registerExecutor).toBe('function');
    expect(typeof seen.fb.notify).toBe('function');
    expect(typeof seen.sc.register).toBe('function');
  });

  it('adds no markup of its own when there is nothing to say', () => {
    const html = r(h(ProjectInteractionProvider, { projectId: 'p1', scope: 'screening' },
      h('main', { 'data-testid': 'page' }, 'workbench')));
    expect(html).toBe('<main data-testid="page">workbench</main>');
  });

  it('renders the §17 feedback surface with its scope and queue depth', () => {
    const html = r(h(ProjectInteractionProvider, {
      projectId: 'p1', scope: 'screening', idFn: () => 'n1',
      initialNotes: [{ message: 'Screening decision undone', scope: 'screening' }],
    }, h('main', null, 'x')));
    expect(html).toContain('data-testid="history-feedback"');
    expect(html).toContain('data-scope="screening"');
    expect(html).toContain('data-queued="1"');
    // KeywordSnackbar is reused UNMODIFIED — its 107 testids must survive.
    expect(html).toContain('data-testid="screening-keyword-snackbar"');
    expect(html).toContain('Screening decision undone');
  });

  it('shows the queued Undo button only for a note that carries an action', () => {
    const withUndo = r(h(ProjectInteractionProvider, {
      projectId: 'p1', scope: 'screening', idFn: () => 'n1',
      initialNotes: [{ message: 'Keyword deleted', scope: 'screening', undo: () => {} }],
    }, h('main', null, 'x')));
    expect(withUndo).toContain('data-testid="screening-keyword-undo"');
    const plain = r(h(ProjectInteractionProvider, {
      projectId: 'p1', scope: 'screening', idFn: () => 'n2',
      initialNotes: [{ message: 'Screening decision undone', scope: 'screening' }],
    }, h('main', null, 'x')));
    expect(plain).not.toContain('data-testid="screening-keyword-undo"');
  });

  it('normalises a missing scope/projectId instead of crashing', () => {
    const html = r(h(ProjectInteractionProvider, {}, h(Probe)));
    expect(html).toContain('data-scope=""');
    expect(html).toContain('data-can-undo="false"');
  });
});

describe('§22 — the header Undo/Redo pair', () => {
  it('renders both controls with their testids, labels and shortcut hints', () => {
    const html = r(h(HistoryControlsView, { canUndo: true, canRedo: true }));
    expect(html).toContain('data-testid="stitch-history-controls"');
    expect(html).toContain('data-testid="stitch-history-undo"');
    expect(html).toContain('data-testid="stitch-history-redo"');
    expect(html).toContain('aria-label="Undo"');
    expect(html).toContain('aria-label="Redo"');
  });

  it('is DISABLED in both directions when the current page has no history', () => {
    const html = r(h(HistoryControlsView, { canUndo: false, canRedo: false }));
    const undo = html.slice(html.indexOf('stitch-history-undo') - 400, html.indexOf('stitch-history-undo') + 60);
    const redo = html.slice(html.indexOf('stitch-history-redo') - 400, html.indexOf('stitch-history-redo') + 60);
    expect(undo).toContain('disabled');
    expect(redo).toContain('disabled');
    expect(html).toContain('aria-disabled="true"');
  });

  it('enables each side independently (undo available, redo branch spent)', () => {
    const html = r(h(HistoryControlsView, { canUndo: true, canRedo: false }));
    const upTo = (id) => html.slice(0, html.indexOf(id));
    // Only ONE button carries `disabled`, and it is the redo one.
    expect((html.match(/disabled=""/g) || []).length).toBe(1);
    expect(upTo('stitch-history-redo')).toContain('stitch-history-undo');
    expect(html).toContain('aria-disabled="false"');
  });

  it('is inert and disabled outside a provider (mounted before a shell adopts it)', () => {
    const html = r(h(StitchHistoryControls));
    expect(html).toContain('data-testid="stitch-history-undo"');
    expect((html.match(/disabled=""/g) || []).length).toBe(2);
  });

  it('is disabled inside a provider whose current scope has no entries', () => {
    const html = r(h(ProjectInteractionProvider, { projectId: 'p1', scope: 'analysis' },
      h(StitchHistoryControls)));
    expect((html.match(/disabled=""/g) || []).length).toBe(2);
  });
});

describe('the shells mount the provider (source pins)', () => {
  it('StitchProjectWorkspace wraps its workspace and derives the scope from the stage', () => {
    const s = src('src/frontend/stitch/pages/StitchProjectWorkspace.jsx');
    expect(s).toContain("import ProjectInteractionProvider from '../../history/ProjectInteractionProvider.jsx'");
    expect(s).toContain('<ProjectInteractionProvider projectId={projectId} scope={historyScopeForStage(stage)} saveStatus={doc.saveStatus}>');
    expect(s).toContain('</ProjectInteractionProvider>');
    expect(s).toContain('<StitchHistoryControls />');
  });

  it('the standalone /sift-beta route mounts its own, and the EMBEDDED branch does not', () => {
    const s = src('src/frontend/screening/pages/SiftProject.jsx');
    expect(s).toContain('<ProjectInteractionProvider projectId={pid} scope={SCOPE_SCREENING}>');
    // Exactly one mount — a second would shadow the host shell's stacks.
    expect((s.match(/<ProjectInteractionProvider/g) || []).length).toBe(1);
  });

  it('the legacy monolith maps its React tab state through the adapter', () => {
    const s = src('src/frontend/workspace/Workspace.jsx');
    expect(s).toContain('<ProjectInteractionProvider projectId={activeId} scope={legacyTabScope(tab)}>');
    expect(s).toContain('legacyTabScope');
  });
});

describe('§23 — the migrated listeners', () => {
  it('SearchBuilderTab no longer owns a document-level Ctrl+Z listener', () => {
    const s = src('src/features/searchBuilder/SearchBuilderTab.jsx');
    // The document-bubble listener would have shadowed the window-bubble router.
    expect(s).not.toContain('document.addEventListener("keydown",onKey)');
    expect(s).not.toContain('document.removeEventListener("keydown",onKey)');
    expect(s).not.toMatch(/shouldHandleGlobalUndo\(\{tagName/);
    // …and the predicate is no longer imported here at all.
    expect(s).not.toMatch(/^\s*recordRenameConcept.*shouldHandleGlobalUndo,\s*$/m);
  });

  it('SearchBuilderTab registers its undo through the router at the ENGINE tier', () => {
    const s = src('src/features/searchBuilder/SearchBuilderTab.jsx');
    expect(s).toContain("id:'searchBuilder.undo'");
    expect(s).toContain('tier:TIER.ENGINE');
    expect(s).toContain('match:isUndoChord');
    // The exact mount gate the old listener had, now declarative.
    expect(s).toContain('embedded&&visible&&!readOnly&&undoAvailable');
    expect(s).toContain('historyShortcutAllowed(ctx)');
    expect(s).toContain('ctx.scope===SCOPE_SEARCH');
    expect(s).toContain('undoLastAction(); return true;');
  });

  it('SearchBuilderTab registers NO redo binding (documented limitation)', () => {
    const s = src('src/features/searchBuilder/SearchBuilderTab.jsx');
    expect(s).not.toContain('isRedoChord');
    expect(s).not.toContain('searchBuilder.redo');
  });

  it('the manuscript Ctrl/Cmd+Enter listener is routed and no longer dep-array-less', () => {
    const s = src('src/features/manuscript/manuscriptPanels.jsx');
    expect(s).not.toContain("window.addEventListener('keydown', onKey)");
    expect(s).toContain("id: 'manuscript.stepPlaceholder'");
    expect(s).toContain('tier: TIER.ENGINE');
    expect(s).toContain("(e.ctrlKey || e.metaKey) && e.key === 'Enter'");
  });

  it('the global undo/redo bindings gate on availability AND the shared context rule', () => {
    const s = src('src/frontend/history/ProjectInteractionProvider.jsx');
    expect(s).toContain("id: 'history.undo'");
    expect(s).toContain("id: 'history.redo'");
    expect(s).toContain('when: (ctx) => historyShortcutAllowed(ctx) && hist.canUndo');
    expect(s).toContain('when: (ctx) => historyShortcutAllowed(ctx) && hist.canRedo');
    // 108.md §15 — the blob-conflict handler, both channels.
    expect(s).toContain("window.addEventListener('metalab:autosave-conflict', onConflict)");
    expect(s).toContain("if (saveStatus === 'conflict') clearScopes(isBlobScope)");
  });
});

describe('§24 — the Stitch modal stamp', () => {
  it('useFocusTrap marks and unmarks the dialog node', () => {
    const s = src('src/frontend/stitch/primitives/overlay.jsx');
    expect(s).toContain('node?.setAttribute?.(STITCH_MODAL_ATTR');
    expect(s).toContain('node?.removeAttribute?.(STITCH_MODAL_ATTR)');
    expect(STITCH_MODAL_ATTR).toBe('data-stitch-modal');
  });
});
