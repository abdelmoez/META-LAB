/**
 * 104.md Part 1 — Focus Mode.
 *
 * The assertions are about the two promises the prompt actually makes:
 *   1. the chrome really goes away (title, role, autosave, both sidebars),
 *   2. the user can still navigate, using the SAME step model as the sidebar —
 *      including its locks, so Next cannot smuggle anyone past a closed gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import StitchAppShell from '../../../src/frontend/stitch/shell/StitchAppShell.jsx';
import { AuthProvider } from '../../../src/frontend/context/AuthContext.jsx';
import {
  FocusModeProvider, FocusSurface, isFocusToggleEvent, isTypingTarget,
  createFullscreenBridge,
} from '../../../src/frontend/focus/FocusModeContext.jsx';
import { FocusToggle, FocusNavBar } from '../../../src/frontend/focus/FocusControls.jsx';
import {
  buildWorkflowSequence, sequenceIndex, sequenceNeighbours, stepTitle,
} from '../../../src/frontend/stitch/nav/workflowSequence.js';

const CTX = { projectId: 'p1', linkedSiftId: 'sp1' };

// AuthProvider is needed only for the UNFOCUSED renders — the utility header
// mounts the notifications bell, which reads the session. That it becomes
// unnecessary once focused is itself the feature working.
const shell = (props, focus = false) => renderToStaticMarkup(
  <MemoryRouter>
    <AuthProvider>
      <FocusModeProvider initial={focus}>
        <StitchAppShell {...props}>
          <div data-testid="the-work">workspace content</div>
        </StitchAppShell>
      </FocusModeProvider>
    </AuthProvider>
  </MemoryRouter>,
);

/* ═══════════════ the step model ═══════════════ */

describe('the Previous/Next model is the sidebar model', () => {
  const seq = buildWorkflowSequence(CTX);

  it('covers the whole workflow, in sidebar order', () => {
    const cats = [...new Set(seq.map((s) => s.categoryId))];
    expect(cats).toEqual(['overview', 'control', 'plan', 'search', 'screen', 'extract', 'analyze', 'report', 'reference']);
    expect(seq.length).toBeGreaterThan(10);
  });

  it('every step carries the href the sidebar itself would build', () => {
    const pico = seq.find((s) => s.stage === 'pico');
    expect(pico.href).toBe('/app/project/p1?tab=pico');
    const overview = seq.find((s) => s.categoryId === 'overview');
    expect(overview.href).toBe('/app/project/p1'); // overview is the bare route
  });

  it('locks the screening sub-pages when there is no linked workspace', () => {
    // screeningSubHref() returns null without a linked workspace — the white
    // stepper renders those rows disabled, and so must Next.
    const noLink = buildWorkflowSequence({ projectId: 'p1', linkedSiftId: null });
    const screening = noLink.filter((s) => s.categoryId === 'screen' && s.key !== 'prisma');
    expect(screening.length).toBeGreaterThan(0);
    expect(screening.every((s) => s.disabled)).toBe(true);
  });

  it('honours a permission gate the caller declares', () => {
    const gated = buildWorkflowSequence(CTX, { isBlocked: (stage) => stage === 'analysis' });
    const analysis = gated.find((s) => s.stage === 'analysis');
    expect(analysis.disabled).toBe(true);
    expect(analysis.href).toBe(null);
  });

  it('steps OVER a locked step rather than offering it', () => {
    const gated = buildWorkflowSequence(CTX, { isBlocked: (stage) => stage === 'analysis' });
    const i = gated.findIndex((s) => s.stage === 'analysis');
    const { prev, next } = sequenceNeighbours(gated, i - 1);
    expect(prev).toBeTruthy();
    expect(next.stage).not.toBe('analysis'); // skipped, never proposed
    expect(next.disabled).toBe(false);
  });

  it('a locked step is never reachable through Next from anywhere', () => {
    const gated = buildWorkflowSequence(CTX, { isBlocked: (s) => s === 'analysis' });
    const reachable = gated.map((_, i) => sequenceNeighbours(gated, i).next).filter(Boolean);
    expect(reachable.some((s) => s.stage === 'analysis')).toBe(false);
  });

  it('locates the current URL, including sub-page params', () => {
    expect(sequenceIndex(seq, '?tab=pico')).toBe(seq.findIndex((s) => s.stage === 'pico'));
    const scr = sequenceIndex(seq, '?tab=screening&screen=conflicts');
    expect(seq[scr].key).toBe('conflicts');
    expect(sequenceIndex(seq, '?tab=prisma')).toBe(seq.findIndex((s) => s.key === 'prisma'));
  });

  it('falls back to the category for a stage that is not its own submenu row', () => {
    // Project History renders under Project Control without being a submenu row —
    // it must still resolve, or both arrows would go dead on that page.
    const i = sequenceIndex(seq, '?tab=history');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(seq[i].categoryId).toBe('control');
  });

  it('has no previous at the very start and no next at the very end', () => {
    expect(sequenceNeighbours(seq, 0).prev).toBe(null);
    expect(sequenceNeighbours(seq, seq.length - 1).next).toBe(null);
  });

  it('disambiguates labels that repeat across categories', () => {
    expect(stepTitle({ label: 'Overview', categoryLabel: 'Screen' })).toBe('Screen · Overview');
    expect(stepTitle({ label: 'PICO & Question', categoryLabel: 'Plan & Protocol' })).toBe('PICO & Question');
  });
});

/* ═══════════════ the chrome actually goes ═══════════════ */

describe('entering Focus Mode removes the chrome', () => {
  const props = {
    focusable: true,
    breadcrumb: 'Project / PICO & Question',
    renderPrimaryRail: () => <nav data-testid="primary-rail">rail</nav>,
    contextRail: <nav data-testid="the-submenu">stepper</nav>,
    coordinatedNav: true,
  };

  it('normally shows both sidebars and the utility header', () => {
    const html = shell(props, false);
    expect(html).toContain('primary-rail');
    expect(html).toContain('the-submenu');
    expect(html).toContain('stitch-top-header');
  });

  it('hides the left rail, the step sidebar AND the utility header when focused', () => {
    const html = shell(props, true);
    expect(html).not.toContain('primary-rail');
    expect(html).not.toContain('the-submenu');
    expect(html).not.toContain('stitch-top-header');
  });

  it('keeps the actual workspace content — that is the whole point', () => {
    expect(shell(props, true)).toContain('workspace content');
  });

  it('always leaves a way out, even for a page that supplies no bar of its own', () => {
    const html = shell(props, true);
    expect(html).toContain('focus-nav-bar');
    expect(html).toContain('focus-toggle');
  });

  it('lifts the content width so the freed area is actually used', () => {
    expect(shell({ ...props, maxWidth: 1560 }, false)).toContain('max-width:1560px');
    expect(shell({ ...props, maxWidth: 1560 }, true)).not.toContain('max-width:1560px');
  });

  it('leaves a page that did not opt in completely untouched', () => {
    // The dashboard must not be strippable — there would be no way to navigate.
    const html = shell({ ...props, focusable: false }, true);
    expect(html).toContain('primary-rail');
    expect(html).toContain('stitch-top-header');
    expect(html).not.toContain('focus-toggle');
  });
});

/* ═══════════════ the control ═══════════════ */

describe('the Focus Mode control', () => {
  const withSurface = (enabled, focus) => renderToStaticMarkup(
    <FocusModeProvider initial={focus}>
      <FocusSurface enabled={enabled}><FocusToggle /></FocusSurface>
    </FocusModeProvider>,
  );

  it('does not appear where there is no chrome to hide', () => {
    expect(withSurface(false, false)).toBe('');
  });

  it('says what it does in words, not only in an icon', () => {
    const html = withSurface(true, false);
    expect(html).toContain('aria-label="Enter focus mode');
    expect(html).toContain('aria-pressed="false"');
  });

  it('114.md §1/§7 — the label admits it takes the whole screen now', () => {
    expect(withSurface(true, false)).toContain('hide navigation and use the full screen');
    expect(withSurface(true, true)).toContain('leave full screen');
    // The hooks the rest of the suite (and the e2e spec) key off are untouched.
    expect(withSurface(true, false)).toContain('data-testid="focus-toggle"');
  });

  it('reports its pressed state and offers the way back once active', () => {
    const html = withSurface(true, true);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Exit focus mode');
  });

  it('suppresses the browser-default tooltip in favour of the designed one', () => {
    expect(withSurface(true, false)).not.toContain('title=');
  });
});

describe('the focus bar navigation', () => {
  const seq = buildWorkflowSequence(CTX);
  const i = sequenceIndex(seq, '?tab=pico');
  const { prev, next } = sequenceNeighbours(seq, i);
  const html = renderToStaticMarkup(
    <FocusModeProvider initial>
      <FocusSurface enabled>
        <FocusNavBar current={seq[i]} prev={prev} next={next} onGo={() => {}}
          stageLabel="PICO & Question" projectName="Vitamin D trial" />
      </FocusSurface>
    </FocusModeProvider>,
  );

  it('names the destination, so Next is never a leap of faith', () => {
    expect(html).toContain(`aria-label="Next: ${stepTitle(next)}"`);
    expect(html).toContain(`aria-label="Previous: ${stepTitle(prev)}"`);
  });

  it('keeps the one orientation fact worth keeping', () => {
    expect(html).toContain('PICO &amp; Question');
    expect(html).toContain('Vitamin D trial');
  });

  it('groups the arrows as real navigation for assistive tech', () => {
    expect(html).toContain('aria-label="Workflow navigation"');
  });

  it('disables an arrow with no destination instead of hiding it', () => {
    const start = renderToStaticMarkup(
      <FocusModeProvider initial>
        <FocusSurface enabled><FocusNavBar current={seq[0]} prev={null} next={seq[1]} onGo={() => {}} /></FocusSurface>
      </FocusModeProvider>,
    );
    expect(start).toContain('focus-nav-prev');
    expect(start).toContain('disabled');
    expect(start).toContain('aria-label="No previous step"');
  });
});

/* ═══════════════ the shortcut ═══════════════ */

describe('the keyboard shortcut', () => {
  const ev = (o) => ({ key: 'f', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false, ...o });

  it('fires on Ctrl+Shift+F and Cmd+Shift+F', () => {
    expect(isFocusToggleEvent(ev({ ctrlKey: true }))).toBe(true);
    expect(isFocusToggleEvent(ev({ metaKey: true }))).toBe(true);
    expect(isFocusToggleEvent(ev({ ctrlKey: true, key: 'F' }))).toBe(true);
  });

  it('leaves the browser shortcuts it must not steal alone', () => {
    expect(isFocusToggleEvent(ev({ ctrlKey: true, shiftKey: false }))).toBe(false); // Ctrl+F = Find
    expect(isFocusToggleEvent(ev({ shiftKey: true }))).toBe(false); // bare Shift+F is typing
    expect(isFocusToggleEvent(ev({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isFocusToggleEvent(ev({ ctrlKey: true, key: 'g' }))).toBe(false);
  });

  it('knows a text-entry surface when it sees one', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

/* ═══════════════ true browser fullscreen (114.md §1) ═══════════════ */

/**
 * The repo runs no jsdom, so the Fullscreen API contract is driven against a
 * hand-rolled document — the same approach usePageHead.test.js takes for
 * applyHead. The stub implements exactly the calls createFullscreenBridge makes,
 * plus a `fire` to play the browser's part.
 *
 * The provider itself only ever calls enter() from inside setFocus and leave()
 * from every exit path, so these assertions ARE the provider's behaviour; the
 * wiring in a real browser is covered by e2e/focus/fullscreen.spec.ts.
 */
function fakeDoc({ prefixed = false, none = false, reject = false } = {}) {
  const listeners = {};
  const root = {};
  const doc = {
    documentElement: root,
    fullscreenElement: null,
    webkitFullscreenElement: null,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    /** Play the browser: dispatch the change event both spellings fan into. */
    fire: (type = prefixed ? 'webkitfullscreenchange' : 'fullscreenchange') => {
      (listeners[type] || []).forEach((f) => f());
    },
    count: (type) => (listeners[type] || []).length,
  };
  const key = prefixed ? 'webkitFullscreenElement' : 'fullscreenElement';
  if (!none) {
    root[prefixed ? 'webkitRequestFullscreen' : 'requestFullscreen'] = vi.fn(() => {
      if (reject) return Promise.reject(new Error('denied by permissions policy'));
      doc[key] = root;
      return Promise.resolve();
    });
    doc[prefixed ? 'webkitExitFullscreen' : 'exitFullscreen'] = vi.fn(() => {
      doc[key] = null;
      return Promise.resolve();
    });
  }
  return doc;
}

describe('the fullscreen bridge', () => {
  it('takes the DOCUMENT ELEMENT fullscreen, not a shell div', async () => {
    const doc = fakeDoc();
    const fs = createFullscreenBridge(doc);
    await expect(fs.enter()).resolves.toBe(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(fs.element()).toBe(doc.documentElement);
    expect(fs.isOwned()).toBe(true);
  });

  it('exits only when something is actually fullscreen — and never twice', async () => {
    const doc = fakeDoc();
    const fs = createFullscreenBridge(doc);

    // Nothing is fullscreen (the plain viewport-only fallback, or a second exit):
    // exitFullscreen must not be called at all.
    await expect(fs.leave()).resolves.toBe(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();

    await fs.enter();
    await expect(fs.leave()).resolves.toBe(true);
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(fs.element()).toBe(null);

    // Escape fires BOTH our keydown and fullscreenchange — the double exit is a
    // no-op, not a second API call.
    await expect(fs.leave()).resolves.toBe(false);
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('reports OUR fullscreen ending externally (browser Esc / F11 / the OS)', async () => {
    const doc = fakeDoc();
    const fs = createFullscreenBridge(doc);
    const onEnded = vi.fn();
    const detach = fs.attach(onEnded);

    await fs.enter();
    doc.fire(); // the ENTER event — nothing ended yet
    expect(onEnded).not.toHaveBeenCalled();

    doc.fullscreenElement = null; // the browser took it away behind our back
    doc.fire();
    expect(onEnded).toHaveBeenCalledTimes(1);

    // Idempotent: a repeat event (or a late one after our own exit) says nothing.
    doc.fire();
    expect(onEnded).toHaveBeenCalledTimes(1);

    detach();
    expect(doc.count('fullscreenchange')).toBe(0);
    expect(doc.count('webkitfullscreenchange')).toBe(0);
  });

  it('ignores a fullscreen that was never ours (a video, say)', () => {
    const doc = fakeDoc();
    const fs = createFullscreenBridge(doc);
    const onEnded = vi.fn();
    fs.attach(onEnded);

    doc.fullscreenElement = { tagName: 'VIDEO' }; // somebody else entered
    doc.fire();
    doc.fullscreenElement = null;                 // …and left again
    doc.fire();

    expect(onEnded).not.toHaveBeenCalled();
    expect(fs.isOwned()).toBe(false);
  });

  it('a refused request degrades to the viewport-only mode instead of breaking', async () => {
    const doc = fakeDoc({ reject: true });
    const fs = createFullscreenBridge(doc);
    const onEnded = vi.fn();
    fs.attach(onEnded);

    await expect(fs.enter()).resolves.toBe(false); // rejection swallowed
    expect(fs.isOwned()).toBe(false);              // ownership released…

    // …so the change event that a denial can still produce never yanks the user
    // back out of the Focus Mode layout they just asked for.
    doc.fire();
    expect(onEnded).not.toHaveBeenCalled();
    await expect(fs.leave()).resolves.toBe(false);
  });

  it('speaks the webkit-prefixed dialect too', async () => {
    const doc = fakeDoc({ prefixed: true });
    const fs = createFullscreenBridge(doc);
    const onEnded = vi.fn();
    fs.attach(onEnded);

    await expect(fs.enter()).resolves.toBe(true);
    expect(doc.documentElement.webkitRequestFullscreen).toHaveBeenCalledTimes(1);
    doc.webkitFullscreenElement = null;
    doc.fire('webkitfullscreenchange');
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('a browser with no Fullscreen API at all is a no-op, not a crash', async () => {
    const fs = createFullscreenBridge(fakeDoc({ none: true }));
    await expect(fs.enter()).resolves.toBe(false);
    await expect(fs.leave()).resolves.toBe(false);
    // …and neither is a document (SSR / the prerenderer).
    const ssr = createFullscreenBridge(null);
    await expect(ssr.enter()).resolves.toBe(false);
    await expect(ssr.leave()).resolves.toBe(false);
    expect(ssr.element()).toBe(null);
    expect(typeof ssr.attach(() => {})).toBe('function');
  });

  it('RELOAD: restoring focus from sessionStorage requests nothing', () => {
    // The provider builds a bridge on mount and attaches its listener; enter() is
    // only ever called from setFocus. A reload therefore restores the LAYOUT with
    // no fullscreen request — no browser grants one without a fresh user gesture,
    // and faking one is not on the table. The next click re-enters properly.
    const doc = fakeDoc();
    const fs = createFullscreenBridge(doc);
    fs.attach(() => {});
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(fs.isOwned()).toBe(false);
    expect(fs.element()).toBe(null);
  });
});
