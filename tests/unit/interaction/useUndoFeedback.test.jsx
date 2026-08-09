/**
 * useUndoFeedback.test.jsx — 108.md §17. The queued undo/redo feedback surface.
 *
 * SSR static markup (project convention; no jsdom, no RTL). The queue rules are a
 * pure reducer and are tested directly; the rendered surface is asserted through
 * the seeded `initialNotes` prop, because effects and clicks do not run under
 * renderToStaticMarkup.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import {
  UndoFeedbackProvider, useUndoFeedback, stampNote, feedbackPush,
  feedbackDismiss, feedbackClearScope, FEEDBACK_LIMIT,
} from '../../../src/frontend/history/useUndoFeedback.jsx';

const noop = () => {};
const note = (over = {}) => ({ id: 'n1', scope: 'screening', message: 'Keyword deleted', tone: 'info', ...over });

describe('the rendered surface reuses KeywordSnackbar unchanged', () => {
  it('renders the 107 snackbar markup and testids for the visible note', () => {
    const html = r(h(UndoFeedbackProvider, { initialNotes: [note({ undo: noop })] }, h('main', null, 'page')));
    expect(html).toContain('<main>page</main>');
    expect(html).toContain('data-testid="history-feedback"');
    expect(html).toContain('data-scope="screening"');
    expect(html).toContain('data-testid="screening-keyword-snackbar"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Keyword deleted');
    expect(html).toContain('data-testid="screening-keyword-undo"');
  });

  it('omits the Undo button for a note with no undo action', () => {
    const html = r(h(UndoFeedbackProvider, { initialNotes: [note({ message: 'Screening decision undone' })] }));
    expect(html).toContain('Screening decision undone');
    expect(html).not.toContain('data-testid="screening-keyword-undo"');
    expect(html).toContain('aria-label="Dismiss"');       // dismiss is always offered
  });

  it('renders NOTHING when the queue is empty', () => {
    const html = r(h(UndoFeedbackProvider, null, h('main', null, 'page')));
    expect(html).toBe('<main>page</main>');
  });

  it('shows exactly ONE note at a time and reports how many are waiting', () => {
    const html = r(h(UndoFeedbackProvider, {
      initialNotes: [
        note({ id: 'a', message: 'First note', undo: noop }),
        note({ id: 'b', message: 'Second note', undo: noop }),
      ],
    }));
    expect(html).toContain('First note');
    expect(html).not.toContain('Second note');
    expect(html).toContain('data-queued="2"');
  });

  it('carries the tone through to the snackbar and drops unusable seeds', () => {
    expect(r(h(UndoFeedbackProvider, { initialNotes: [note({ tone: 'error' })] }))).toContain('Keyword deleted');
    expect(r(h(UndoFeedbackProvider, { initialNotes: [{ message: '' }, null, 'junk'] }))).toBe('');
    expect(r(h(UndoFeedbackProvider, { initialNotes: 'nope' }))).toBe('');
  });
});

describe('useUndoFeedback outside a provider', () => {
  it('returns inert no-ops rather than throwing', () => {
    let ctx = null;
    function Capture() { ctx = useUndoFeedback(); return null; }
    r(h(Capture));
    expect(ctx.notify({ message: 'x' })).toBe('');
    expect(ctx.current).toBeNull();
    expect(ctx.queued).toBe(0);
    expect(() => { ctx.dismiss('n1'); ctx.clearScope('screening'); ctx.clear(); }).not.toThrow();
  });

  it('exposes the visible note through context when mounted', () => {
    let ctx = null;
    function Capture() { ctx = useUndoFeedback(); return null; }
    r(h(UndoFeedbackProvider, { initialNotes: [note()] }, h(Capture)));
    expect(ctx.current).toMatchObject({ id: 'n1', message: 'Keyword deleted', scope: 'screening' });
    expect(ctx.queued).toBe(1);
  });
});

describe('stampNote', () => {
  it('seeds a note id from the injected source and defaults scope/tone', () => {
    const n = stampNote({ message: 'hi' }, { idFn: () => 'zz' });
    expect(n).toEqual({ id: 'zz', scope: '', message: 'hi', tone: 'info' });
  });

  it('keeps a supplied id, coerces scope, and only allows known tones', () => {
    expect(stampNote({ id: 'k', scope: 3, message: 'hi', tone: 'warn' }, {}))
      .toMatchObject({ id: 'k', scope: '3', tone: 'warn' });
    expect(stampNote({ message: 'hi', tone: 'error' }, {}).tone).toBe('error');
    expect(stampNote({ message: 'hi', tone: 'chartreuse' }, {}).tone).toBe('info');
    expect(stampNote(null)).toBeNull();
  });
});

describe('feedbackPush — the queue rules', () => {
  it('queues a note that carries an Undo action, never dropping the affordance', () => {
    const q = feedbackPush(feedbackPush([], note({ id: 'a', undo: noop })), note({ id: 'b', undo: noop }));
    expect(q.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('a plain note supersedes a plain visible note (a live status line)', () => {
    let q = feedbackPush([], note({ id: 'a', message: 'Extraction change undone' }));
    q = feedbackPush(q, note({ id: 'b', message: 'Extraction change redone' }));
    expect(q).toHaveLength(1);
    expect(q[0].id).toBe('b');
  });

  it('a plain note does NOT displace a queued Undo affordance behind the head', () => {
    let q = feedbackPush([], note({ id: 'a', message: 'plain' }));
    q = feedbackPush(q, note({ id: 'b', message: 'with undo', undo: noop }));
    q = feedbackPush(q, note({ id: 'c', message: 'plain again' }));
    expect(q.map((n) => n.id)).toEqual(['c', 'b']);
  });

  it('a plain note queues behind a visible note that HAS an Undo action', () => {
    let q = feedbackPush([], note({ id: 'a', undo: noop }));
    q = feedbackPush(q, note({ id: 'b', message: 'plain' }));
    expect(q.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('caps the backlog, keeping the visible note and the newest ones', () => {
    let q = [];
    for (let i = 0; i < FEEDBACK_LIMIT + 3; i += 1) {
      q = feedbackPush(q, note({ id: `n${i}`, message: `m${i}`, undo: noop }));
    }
    expect(q).toHaveLength(FEEDBACK_LIMIT);
    expect(q[0].id).toBe('n0');                                   // still on screen
    expect(q[q.length - 1].id).toBe(`n${FEEDBACK_LIMIT + 2}`);    // newest kept
  });

  it('ignores an unusable note and returns the SAME array', () => {
    const q = [note()];
    expect(feedbackPush(q, null)).toBe(q);
    expect(feedbackPush(q, { id: '', message: 'x' })).toBe(q);
    expect(feedbackPush(q, { id: 'z', message: '' })).toBe(q);
    expect(feedbackPush(undefined, null)).toEqual([]);
  });
});

describe('feedbackDismiss / feedbackClearScope', () => {
  it('removes one note by id', () => {
    const q = [note({ id: 'a' }), note({ id: 'b' })];
    expect(feedbackDismiss(q, 'a').map((n) => n.id)).toEqual(['b']);
  });

  it('is referentially stable when the id is absent', () => {
    const q = [note({ id: 'a' })];
    expect(feedbackDismiss(q, 'zzz')).toBe(q);
    expect(feedbackDismiss(q, '')).toBe(q);
    expect(feedbackDismiss(q, null)).toBe(q);
  });

  it('clears every note for one scope and leaves the others', () => {
    const q = [note({ id: 'a', scope: 'screening' }), note({ id: 'b', scope: 'extraction' })];
    expect(feedbackClearScope(q, 'screening').map((n) => n.id)).toEqual(['b']);
    expect(feedbackClearScope(q, 'analysis')).toBe(q);
  });
});
