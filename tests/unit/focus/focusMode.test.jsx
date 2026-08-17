/**
 * 104.md Part 1 — Focus Mode.
 *
 * The assertions are about the two promises the prompt actually makes:
 *   1. the chrome really goes away (title, role, autosave, both sidebars),
 *   2. the user can still navigate, using the SAME step model as the sidebar —
 *      including its locks, so Next cannot smuggle anyone past a closed gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { readSource } from '../../helpers/readSource.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import StitchAppShell from '../../../src/frontend/stitch/shell/StitchAppShell.jsx';
import { AuthProvider } from '../../../src/frontend/context/AuthContext.jsx';
import {
  FocusModeProvider, FocusSurface, isFocusToggleEvent, isTypingTarget,
  createFullscreenBridge, deriveFullscreenPhase, resolveExternalFullscreenExit,
  focusNavReducer, focusNavState,
} from '../../../src/frontend/focus/FocusModeContext.jsx';
import {
  markOverlayEscape, overlayEscapeRecent, clearOverlayEscape, OVERLAY_ESCAPE_GRACE_MS,
} from '../../../src/frontend/focus/overlayEscapeLatch.js';
import {
  FocusToggle, FocusNavBar, focusToggleCopy, focusNavMenuCopy, FOCUS_NAV_DRAWER_ID, FOCUS_BAR_H,
} from '../../../src/frontend/focus/FocusControls.jsx';
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
    // The hooks the rest of the suite (and the e2e spec) key off are untouched.
    expect(withSurface(true, false)).toContain('data-testid="focus-toggle"');
  });

  it('114-r2 §5 — the EXIT copy only promises a full screen we are actually in', () => {
    // Focus Mode outlives fullscreen: a refused request, a reload, F11, an
    // Escape the browser ate to close an overlay. A server render is exactly one
    // of those states (nothing has been granted), so the honest copy is the
    // windowed one — and "leave full screen" must be absent, not merely rare.
    const windowed = withSurface(true, true);
    expect(windowed).toContain('Exit focus mode — restore navigation');
    expect(windowed).not.toContain('leave full screen');

    // Both branches pinned at the source, since no server render can produce a
    // real fullscreen to assert the other one through.
    expect(focusToggleCopy(true, true).aria).toBe('Exit focus mode — restore navigation and leave full screen');
    expect(focusToggleCopy(true, false).aria).toBe('Exit focus mode — restore navigation');
    expect(focusToggleCopy(false, false).aria).toContain('use the full screen');
    // Esc is only offered as a way out once there is something to get out of.
    expect(focusToggleCopy(false, false).hint).not.toContain('Esc');
    expect(focusToggleCopy(true, false).hint).toContain('Esc');
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

  it('114-r2 §5 — offers the way back UP when focus outlived fullscreen', () => {
    // Server render ⇒ nothing was ever granted ⇒ the windowed-focus state. The
    // toggle cannot serve here (it exits Focus Mode entirely) and only a fresh
    // user gesture can restore fullscreen, so the bar carries one button that
    // asks for it. It is the ONLY state in which that button exists.
    expect(html).toContain('data-testid="focus-fullscreen"');
    expect(html).toContain('Enter full screen — hide the browser chrome too');
    expect(html).toContain('data-testid="focus-exit"');
    // …and the exit beside it does not claim a full screen either.
    expect(html).not.toContain('leave full screen');
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

  it('114-r2 — a HELD combination is one toggle, not an auto-repeat machine gun', () => {
    // keydown repeats at the OS rate while the keys are down. Each repeat used to
    // be a full enter/exit cycle, browser fullscreen and all.
    expect(isFocusToggleEvent(ev({ ctrlKey: true, repeat: true }))).toBe(false);
    expect(isFocusToggleEvent(ev({ metaKey: true, repeat: true }))).toBe(false);
    expect(isFocusToggleEvent(ev({ ctrlKey: true, repeat: false }))).toBe(true);
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
function fakeDoc({ prefixed = false, none = false, reject = false, defer = false } = {}) {
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
    /** …and the refusal the spec sends when a request cannot be honoured. */
    fireError: (type = prefixed ? 'webkitfullscreenerror' : 'fullscreenerror') => {
      (listeners[type] || []).forEach((f) => f());
    },
    count: (type) => (listeners[type] || []).length,
    grant: async () => {},
  };
  const key = prefixed ? 'webkitFullscreenElement' : 'fullscreenElement';
  if (!none) {
    let settle = null;
    root[prefixed ? 'webkitRequestFullscreen' : 'requestFullscreen'] = vi.fn(() => {
      if (reject) return Promise.reject(new Error('denied by permissions policy'));
      // `defer` models the timing 114-r2 §1 is about: requestFullscreen returns a
      // promise that stays pending until the user agent decides, and everything
      // the app does in between happens with nothing fullscreen at all.
      if (defer) return new Promise((res) => { settle = res; });
      doc[key] = root;
      return Promise.resolve();
    });
    doc[prefixed ? 'webkitExitFullscreen' : 'exitFullscreen'] = vi.fn(() => {
      doc[key] = null;
      return Promise.resolve();
    });
    /**
     * Grant a deferred request in the order the spec mandates: the element goes
     * fullscreen, fullscreenchange fires, and only THEN does the request promise
     * settle. Getting that order right is the point — the bridge has to arm
     * ownership from the event, not from the promise.
     */
    doc.grant = async () => {
      doc[key] = root;
      doc.fire();
      if (settle) { const s = settle; settle = null; s(); }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };
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

  /* ─────────── 114-r2: intent is the authority ─────────── */

  it('arms ownership from the CHANGE EVENT, before the request promise settles', async () => {
    // The real order is event-then-promise. A bridge that only learns from the
    // promise is blind for the whole gap in between.
    const doc = fakeDoc({ defer: true });
    const fs = createFullscreenBridge(doc);
    fs.attach(() => {});

    const entering = fs.enter();
    expect(fs.isOwned()).toBe(false); // nothing observed yet — nothing claimed
    expect(fs.isWanted()).toBe(true); // …but the intent is on record

    await doc.grant();
    expect(fs.isOwned()).toBe(true);
    await expect(entering).resolves.toBe(true);
  });

  it('114-r2 §1 — a toggle-off inside the pre-grant window undoes the grant', async () => {
    const doc = fakeDoc({ defer: true });
    const fs = createFullscreenBridge(doc);
    const onEnded = vi.fn();
    fs.attach(onEnded);

    const entering = fs.enter();
    expect(fs.element()).toBe(null); // the hole: nothing is fullscreen YET

    // The user toggles straight back off. There is nothing to exit, so the old
    // bridge returned and forgot — and the grant landed a moment later with the
    // chrome already back: browser fullscreen, owned false, focus false, and no
    // control anywhere admitting it.
    await expect(fs.leave()).resolves.toBe(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    expect(fs.isWanted()).toBe(false);

    await doc.grant();
    await entering;

    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(fs.element()).toBe(null);
    expect(fs.isOwned()).toBe(false);
    // We asked for this exit; it is not an external one and must not be reported
    // as though the browser did it behind our back.
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('114-r2 §3 — a SILENT refusal never leaves a stale ownership claim', async () => {
    // Prefixed WebKit can refuse by doing nothing at all: undefined return, no
    // rejection, no event. Claiming ownership at call time meant the next
    // foreign fullscreen to end — a video the researcher opened — cashed in that
    // stale claim and threw them out of Focus Mode.
    const doc = fakeDoc({ prefixed: true });
    doc.documentElement.webkitRequestFullscreen = vi.fn(() => undefined);
    const fs = createFullscreenBridge(doc);
    const onEnded = vi.fn();
    fs.attach(onEnded);

    await expect(fs.enter()).resolves.toBe(false);
    expect(fs.isOwned()).toBe(false);

    doc.webkitFullscreenElement = { tagName: 'VIDEO' };
    doc.fire('webkitfullscreenchange');
    doc.webkitFullscreenElement = null;
    doc.fire('webkitfullscreenchange');

    expect(onEnded).not.toHaveBeenCalled();
    expect(fs.isOwned()).toBe(false);
  });

  it('114-r2 §3 — a fullscreenerror drops the pending intent', async () => {
    const doc = fakeDoc({ defer: true });
    const fs = createFullscreenBridge(doc);
    fs.attach(() => {});

    fs.enter();
    expect(fs.isWanted()).toBe(true);

    doc.fireError();
    expect(fs.isWanted()).toBe(false);
    expect(fs.isOwned()).toBe(false);

    // Whatever happens on the page afterwards, the refused request has stopped
    // being something we might still adopt as ours.
    await doc.grant();
    expect(fs.isOwned()).toBe(false);
  });

  it('114-r2 §4 — leave() never closes a fullscreen that was not ours', async () => {
    const doc = fakeDoc();
    const fs = createFullscreenBridge(doc);
    fs.attach(() => {});

    const video = { tagName: 'VIDEO' };
    doc.fullscreenElement = video; // the researcher's own video, mid-playback
    doc.fire();

    await expect(fs.leave()).resolves.toBe(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    expect(doc.fullscreenElement).toBe(video);
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

  it('117.md §45 — reports the in-flight fact the phase view needs', async () => {
    // `pending` is what separates "a request is on its way" from "our fullscreen
    // ended and the intent has not been cleared yet": both have wanted=true and
    // owned=false, and the phase view would call the second one "entering"
    // without this accessor.
    const doc = fakeDoc({ defer: true });
    const fs = createFullscreenBridge(doc);
    fs.attach(() => {});
    expect(fs.isPending()).toBe(false);

    fs.enter();
    expect(fs.isPending()).toBe(true);
    expect(fs.isOwned()).toBe(false);

    await doc.grant();
    expect(fs.isPending()).toBe(false);
    expect(fs.isOwned()).toBe(true);

    // The external end that 114-r2 leaves wanted=true through.
    doc.fullscreenElement = null;
    doc.fire();
    expect(fs.isOwned()).toBe(false);
    expect(fs.isPending()).toBe(false);
    expect(fs.isWanted()).toBe(true);
  });
});

/* ═══════════════ 117.md §45 — the phase view ═══════════════ */

describe('the fullscreen phase', () => {
  const phase = (o) => deriveFullscreenPhase(o);

  it('names the four states 117.md §45 asks for, from the facts that exist', () => {
    expect(phase({ focus: false })).toBe('normal');
    expect(phase({ focus: true, wanted: true, pending: true })).toBe('entering');
    expect(phase({ focus: true, wanted: true, owned: true })).toBe('fullscreen');
    // The intent is gone but the browser has not caught up: a grant still landing
    // after a toggle-off (114-r2 §1), or an exit not yet observed.
    expect(phase({ focus: true, wanted: false, pending: true })).toBe('exiting');
    expect(phase({ focus: false, wanted: true, owned: true })).toBe('exiting');
  });

  it('calls focused-but-windowed NORMAL — the phase is about the browser, not the layout', () => {
    // After a reload, a refusal, or an external exit that degraded: Focus Mode is
    // on, nothing is fullscreen, nothing is on its way. Reporting anything else
    // here is what would make a control lie about a full screen (114-r2 §5).
    expect(phase({ focus: true, wanted: false, pending: false, owned: false })).toBe('normal');
    // …including the bridge state an external exit actually leaves behind, where
    // `wanted` is still true and only `pending` says the request is over.
    expect(phase({ focus: true, wanted: true, pending: false, owned: false })).toBe('normal');
  });

  it('is total — every combination of the four booleans resolves', () => {
    const named = ['normal', 'entering', 'fullscreen', 'exiting'];
    for (let i = 0; i < 16; i += 1) {
      const got = phase({
        focus: !!(i & 1), wanted: !!(i & 2), pending: !!(i & 4), owned: !!(i & 8),
      });
      expect(named).toContain(got);
    }
    expect(deriveFullscreenPhase()).toBe('normal');   // and no state at all is a state
  });
});

/* ═══════════════ 117.md §44 — the Escape contract ═══════════════ */

describe('an overlay that eats an Escape says so', () => {
  it('marks a window, and the window closes', () => {
    clearOverlayEscape();
    expect(overlayEscapeRecent(1000)).toBe(false);   // nothing has ever happened

    markOverlayEscape(1000);
    expect(overlayEscapeRecent(1000)).toBe(true);
    expect(overlayEscapeRecent(1000 + OVERLAY_ESCAPE_GRACE_MS)).toBe(true);
    expect(overlayEscapeRecent(1000 + OVERLAY_ESCAPE_GRACE_MS + 1)).toBe(false);
  });

  it('a clock that jumped backwards fails SAFE, not latched forever', () => {
    clearOverlayEscape();
    markOverlayEscape(10_000);
    expect(overlayEscapeRecent(9_000)).toBe(false);
    clearOverlayEscape();
  });
});

describe('117.md §44 — what an external fullscreen exit does to Focus Mode', () => {
  it('returns the NORMAL layout — the reversal of 114-r2 §2', () => {
    // The prompt's complaint is precisely the old behaviour: browser fullscreen
    // gone, application fullscreen still on. One press, one consistent state.
    expect(resolveExternalFullscreenExit({ focus: true, escapeRecent: false })).toBe('exit-focus');
  });

  it('keeps the workspace when the Escape belonged to a dialog', () => {
    // Escape inside fullscreen is not interceptable: closing a modal produces the
    // same fullscreenchange as leaving. Ejecting the workspace because a dialog
    // was dismissed is a worse bug than the one §44 fixes, so that press degrades
    // to the documented windowed-focus state instead.
    expect(resolveExternalFullscreenExit({ focus: true, escapeRecent: true })).toBe('keep-windowed');
  });

  it('has nothing to say when Focus Mode was never on (a video, F11 on a normal page)', () => {
    expect(resolveExternalFullscreenExit({ focus: false, escapeRecent: false })).toBe('ignore');
    expect(resolveExternalFullscreenExit({ focus: false, escapeRecent: true })).toBe('ignore');
    expect(resolveExternalFullscreenExit()).toBe('ignore');
  });
});

/* ═══════════════ 117.md §42/§43 — the focus nav drawer ═══════════════ */

describe('the focus nav drawer state', () => {
  const hidden = { open: false, pinned: false };
  const open = { open: true, pinned: false };
  const pinned = { open: true, pinned: true };

  it('names its three states', () => {
    expect(focusNavState(hidden)).toBe('hidden');
    expect(focusNavState(open)).toBe('open');
    expect(focusNavState(pinned)).toBe('pinned');
    expect(focusNavState(null)).toBe('hidden');
  });

  it('§42 — the edge dwell reveals it, and the pointer leaving hides it again', () => {
    expect(focusNavReducer(hidden, 'reveal')).toEqual(open);
    expect(focusNavReducer(open, 'hide')).toEqual(hidden);
    // Idempotent from both ends: the dwell can fire while it is already open, and
    // the auto-hide timer can land after a click already closed it.
    expect(focusNavReducer(open, 'reveal')).toBe(open);
    expect(focusNavReducer(hidden, 'hide')).toBe(hidden);
  });

  it('§42 — a PINNED drawer ignores auto-hide; that is what pinning means', () => {
    expect(focusNavReducer(pinned, 'hide')).toBe(pinned);
  });

  it('§43 — the hamburger toggles, and closing an open drawer also unpins', () => {
    expect(focusNavReducer(hidden, 'toggle')).toEqual(open);
    expect(focusNavReducer(open, 'toggle')).toEqual(hidden);
    // Otherwise the hamburger would visibly do nothing on a pinned drawer, which
    // is worse than unpinning something the user can pin again in one click.
    expect(focusNavReducer(pinned, 'toggle')).toEqual(hidden);
    expect(focusNavReducer(pinned, 'dismiss')).toEqual(hidden);
  });

  it('§43 — unpinning leaves it open; the user is looking at it', () => {
    expect(focusNavReducer(open, 'pin')).toEqual(pinned);
    expect(focusNavReducer(pinned, 'pin')).toEqual(open);
    // Pinning from hidden opens it too — the control only exists inside the drawer
    // today, but the state must be legal from anywhere.
    expect(focusNavReducer(hidden, 'pin')).toEqual(pinned);
  });

  it('closes with Focus Mode but the PIN survives it', () => {
    // Which is the entire point of persisting the pin: the next focus session
    // starts the way the researcher left it, without re-hovering the edge.
    expect(focusNavReducer(pinned, 'focus-off')).toEqual({ open: false, pinned: true });
    expect(focusNavReducer(open, 'focus-off')).toEqual({ open: false, pinned: false });
    expect(focusNavReducer({ open: false, pinned: true }, 'focus-on')).toEqual(pinned);
    expect(focusNavReducer(hidden, 'focus-on')).toBe(hidden);
  });

  it('never invents a state for an action it does not know', () => {
    expect(focusNavReducer(open, 'nonsense')).toBe(open);
  });
});

describe('the hamburger (117.md §43)', () => {
  it('names the control the same way every time, and the action honestly', () => {
    expect(focusNavMenuCopy(false)).toEqual({ aria: 'Navigation', tip: 'Show menu' });
    expect(focusNavMenuCopy(true)).toEqual({ aria: 'Navigation', tip: 'Hide menu' });
  });

  it('rides in the workspace focus bar, as a disclosure and not a pressed toggle', () => {
    const seq = buildWorkflowSequence(CTX);
    const i = sequenceIndex(seq, '?tab=pico');
    const { prev, next } = sequenceNeighbours(seq, i);
    const html = renderToStaticMarkup(
      <FocusModeProvider initial>
        <FocusSurface enabled>
          <FocusNavBar current={seq[i]} prev={prev} next={next} onGo={() => {}} />
        </FocusSurface>
      </FocusModeProvider>,
    );
    expect(html).toContain('data-testid="focus-nav-menu"');
    expect(html).toContain('aria-label="Navigation"');
    // It controls a region that really exists in the DOM ⇒ expanded/collapsed.
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-controls="${FOCUS_NAV_DRAWER_ID}"`);
    // …and NOT aria-pressed, which would announce one fact twice. Scoped to this
    // button: the exit toggle beside it legitimately reports a pressed state.
    const end = html.indexOf('data-testid="focus-nav-menu"');
    const menuButton = html.slice(html.lastIndexOf('<button', end), end);
    expect(menuButton).toContain('aria-expanded="false"');
    expect(menuButton).not.toContain('aria-pressed');
  });
});

describe('the focus nav drawer in the shell', () => {
  const props = {
    focusable: true,
    breadcrumb: 'Project / PICO & Question',
    renderPrimaryRail: () => <nav data-testid="primary-rail">rail</nav>,
    contextRail: <nav data-testid="the-submenu">stepper</nav>,
    coordinatedNav: true,
  };

  it('§42/§43 — focused, the navigation is hidden but REACHABLE', () => {
    const html = shell(props, true);
    expect(html).toContain('data-testid="focus-edge-zone"');
    expect(html).toContain('data-testid="focus-nav-drawer"');
    expect(html).toContain(`id="${FOCUS_NAV_DRAWER_ID}"`);
    expect(html).toContain('data-testid="focus-nav-menu"');
    // Closed: translated off-screen AND visibility:hidden, so its links are out of
    // the tab order rather than merely invisible.
    expect(html).toContain('data-state="hidden"');
    expect(html).toContain('translateX(-100%)');
    expect(html).toContain('visibility:hidden');
  });

  it('sits BELOW the focus bar, so the hamburger it toggles is never buried', () => {
    // In Focus Mode that bar is the only chrome there is: a full-height drawer
    // would cover the hamburger, Previous/Next and the exit with the very panel
    // they open. FOCUS_BAR_H is the one number both sides do their maths against.
    const html = shell(props, true);
    const at = html.indexOf('data-testid="focus-nav-drawer"');
    const tag = html.slice(html.lastIndexOf('<aside', at), html.indexOf('>', at) + 1);
    expect(tag).toContain(`top:${FOCUS_BAR_H}px`);
    expect(tag).toContain('left:0');
  });

  it('mounts the drawer CONTENT only once it has been revealed', () => {
    // The rails run live subscriptions — that is why Focus Mode unmounts them in
    // the first place. A drawer nobody opened must not re-subscribe them.
    const html = shell(props, true);
    expect(html).not.toContain('primary-rail');
    expect(html).not.toContain('the-submenu');
    // The frame is there all the same, so aria-controls is never dangling and the
    // pin/close controls exist for a keyboard user the moment it opens.
    expect(html).toContain('Pin navigation open');
    expect(html).toContain('Close navigation');
  });

  it('leaves the normal layout with no edge zone and no drawer at all', () => {
    const html = shell(props, false);
    expect(html).not.toContain('focus-edge-zone');
    expect(html).not.toContain('focus-nav-drawer');
    expect(html).not.toContain('focus-nav-menu');
    // The responsive off-canvas nav is a DIFFERENT drawer and is untouched.
    expect(html).toContain('stitch-drawer-toggle');
  });

  it('does not appear on a page that never opted into Focus Mode', () => {
    const html = shell({ ...props, focusable: false }, true);
    expect(html).not.toContain('focus-edge-zone');
    expect(html).not.toContain('focus-nav-drawer');
  });
});

/* ═══════════════ 121.md §2 — the layout-only entry ═══════════════ */

describe('121.md §2 — Focus Mode can be entered WITHOUT taking the screen', () => {
  const src = readSource('src/frontend/focus/FocusModeContext.jsx');

  /**
   * Focus Mode (a layout flag) and browser fullscreen (the bridge) have been two
   * states in this file since 114.md §1, but there was only ONE entry into the
   * layout and it always requested fullscreen with it. Windowed focus existed only
   * as a DEGRADE — a refusal, a reload, an external exit — never as an intent, which
   * is why opening the manuscript's PDF pane took over the whole screen (121.md §2:
   * "opening the PDF viewer must not automatically enter fullscreen").
   */
  it('setFocus takes a layout-only option, and skips the request for it', () => {
    expect(src).toContain('const setFocus = useCallback((on, opts) => {');
    expect(src).toContain('const wantsFullscreen = !(opts && opts.fullscreen === false);');
    expect(src).toContain('? (wantsFullscreen ? fsRef.current.enter() : Promise.resolve(false))');
  });

  it('the DEFAULT path is unchanged — every existing caller still asks for fullscreen', () => {
    // The header FocusToggle, Ctrl+Shift+F, Escape and exitFocus all go through
    // these three, and none of them passes an option: omitting it IS 114/117.
    expect(src).toContain('const toggleFocus = useCallback(() => setFocus((p) => !p), [setFocus]);');
    expect(src).toContain('const exitFocus = useCallback(() => setFocus(false), [setFocus]);');
    expect(src).toContain("if (!focusRef.current) { setFocus(true); return; }");
    // …and nothing in this file ever passes fullscreen:false to itself.
    expect(src).not.toContain('setFocus(true, {');
  });

  it('EXITING never needs the option — leave() is already a no-op when nothing is ours', async () => {
    // Which is why only the entry gained a parameter: a layout-only session owns no
    // fullscreen, so the ordinary exit path has nothing to exit and says so.
    const doc = fakeDoc();
    const fs = createFullscreenBridge(doc);
    fs.attach(() => {});
    await expect(fs.leave()).resolves.toBe(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('layout-only focus IS the windowed-focus state the phase view already names', () => {
    /* Nothing new is modelled: skipping enter() leaves wanted/pending/owned all
       false, so the phase is 'normal' (117.md §45 explicitly includes
       focused-but-windowed there), `isFullscreen` is false, and the focus bar shows
       the "Enter full screen" button that exists in exactly that state — which is
       121.md §2's "fullscreen should remain an optional, separate action". */
    const doc = fakeDoc();
    const fs = createFullscreenBridge(doc);
    fs.attach(() => {});
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(fs.isOwned()).toBe(false);
    expect(fs.isWanted()).toBe(false);
    expect(fs.isPending()).toBe(false);
    expect(deriveFullscreenPhase({
      focus: true, wanted: fs.isWanted(), pending: fs.isPending(), owned: fs.isOwned(),
    })).toBe('normal');
    // …and the honest exit copy for it does not promise to leave a full screen.
    expect(focusToggleCopy(true, false).aria).toBe('Exit focus mode — restore navigation');
  });

  it('the ONE caller that asks for it is the manuscript split, and it is gated on the shell', () => {
    const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
    expect(ws).toContain('api.setFocus(true, { fullscreen: false });');
    /* FocusModeProvider wraps every route (App.jsx), so this entry used to flip
       GLOBAL focus state — and request real fullscreen — in the legacy shell, whose
       chrome never subscribes to it and stayed fully visible. `useFocusAvailable` is
       the synchronous "can this shell render the focused layout?" answer. */
    expect(ws).toContain('const focusAvailable = useFocusAvailable();');
    expect(ws).toContain('if (focusAvailableRef.current && !api.focus && api.setFocus) {');
    // The RELEASE branch 119 §4 owns is untouched: only the split's own entry exits.
    expect(ws).toMatch(/} else if \(focusOwned\.current\) \{/);
  });
});
