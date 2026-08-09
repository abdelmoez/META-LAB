/**
 * historyProvider.test.jsx — 108.md §§8, §14-17. The React face of the history
 * system.
 *
 * SSR static markup (project convention; no jsdom, no React Testing Library).
 * Effects do not run under renderToStaticMarkup, so the provider is asserted on
 * (a) the contract it exposes through context and (b) the PURE helpers the
 * asynchronous path is built out of — stampEntry, normalizeExecutorResult and
 * historyNote. The stack transitions those helpers feed are covered end-to-end in
 * tests/unit/interaction/historyStacks.test.js.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import {
  HistoryProvider, useProjectHistory, stampEntry, normalizeExecutorResult,
  historyNote, shouldClearForProject, HISTORY_FAIL,
} from '../../../src/frontend/history/HistoryContext.jsx';

let captured = null;
function Capture() {
  captured = useProjectHistory();
  return h('span', { 'data-testid': 'probe', 'data-scope': captured.scope, 'data-can-undo': String(captured.canUndo) });
}

describe('HistoryProvider — rendering + context shape', () => {
  it('renders its children and adds no markup of its own', () => {
    const html = r(h(HistoryProvider, { projectId: 'p1', scope: 'screening' },
      h('main', { 'data-testid': 'page' }, 'workbench')));
    expect(html).toBe('<main data-testid="page">workbench</main>');
  });

  it('exposes the current scope and an empty, unavailable history', () => {
    const html = r(h(HistoryProvider, { projectId: 'p1', scope: 'screening' }, h(Capture)));
    expect(html).toContain('data-scope="screening"');
    expect(html).toContain('data-can-undo="false"');
    expect(captured).toMatchObject({
      scope: 'screening', projectId: 'p1',
      canUndo: false, canRedo: false, pending: false,
      undoCount: 0, redoCount: 0, nextUndo: null, nextRedo: null,
    });
    for (const fn of ['record', 'coalesce', 'undo', 'redo', 'registerExecutor', 'clearScope', 'clearScopes', 'clearAll']) {
      expect(typeof captured[fn]).toBe('function');
    }
  });

  it('normalises a missing/numeric scope rather than crashing', () => {
    r(h(HistoryProvider, { projectId: 7 }, h(Capture)));
    expect(captured.scope).toBe('');
    expect(captured.canUndo).toBe(false);
  });

  it('registerExecutor hands back an unregister function', () => {
    r(h(HistoryProvider, { projectId: 'p1', scope: 'screening' }, h(Capture)));
    const off = captured.registerExecutor('screening.decision', async () => true);
    expect(typeof off).toBe('function');
    off();
    expect(captured.registerExecutor('', () => {})).toBeInstanceOf(Function);
    expect(captured.registerExecutor('kind', 'not-a-fn')).toBeInstanceOf(Function);
  });
});

describe('useProjectHistory outside a provider', () => {
  it('returns an inert shape instead of throwing (engines can adopt it early)', async () => {
    const html = r(h(Capture));
    expect(html).toContain('data-can-undo="false"');
    expect(captured.canUndo).toBe(false);
    expect(captured.record({ kind: 'x' })).toBeNull();
    expect(await captured.undo()).toEqual({ ok: false, reason: HISTORY_FAIL.NO_ENTRY, entry: null });
    expect(await captured.redo()).toEqual({ ok: false, reason: HISTORY_FAIL.NO_ENTRY, entry: null });
    expect(() => captured.clearAll()).not.toThrow();
  });
});

describe('stampEntry — ids and timestamps are seeded OUTSIDE the updater', () => {
  const base = {
    kind: 'screening.decision', label: 'Screening decision',
    undoOp: { decision: '' }, redoOp: { decision: 'include' },
  };

  it('fills id, at, scope and projectId from the injected sources', () => {
    let n = 0;
    const e = stampEntry(base, {
      idFn: () => `id-${++n}`, now: () => 1234,
      scope: 'screening', projectId: 'p1',
    });
    expect(e).toMatchObject({ id: 'id-1', at: 1234, scope: 'screening', projectId: 'p1', label: 'Screening decision' });
  });

  it('never overwrites values the caller supplied', () => {
    const e = stampEntry({ ...base, id: 'mine', at: 9, scope: 'extraction', projectId: 'p9' }, {
      idFn: () => 'generated', now: () => 1234, scope: 'screening', projectId: 'p1',
    });
    expect(e).toMatchObject({ id: 'mine', at: 9, scope: 'extraction', projectId: 'p9' });
  });

  it('coerces non-string ids/scopes and normalises a missing redoOp to null', () => {
    const e = stampEntry({ ...base, redoOp: undefined }, { scope: 12, projectId: 34, idFn: () => 'i', now: () => 0 });
    expect(e.scope).toBe('12');
    expect(e.projectId).toBe('34');
    expect(e.redoOp).toBeNull();
    expect(e.label).toBe('Screening decision');
  });

  it('defaults the label to an empty string and returns null for junk', () => {
    expect(stampEntry({ kind: 'k', undoOp: {} }, { idFn: () => 'i', now: () => 0 }).label).toBe('');
    expect(stampEntry(null)).toBeNull();
    expect(stampEntry('nope')).toBeNull();
    expect(stampEntry([])).toBeNull();
  });

  it('produces a distinct id per call (two records are two entries)', () => {
    const e1 = stampEntry(base, { scope: 's', projectId: 'p' });
    const e2 = stampEntry(base, { scope: 's', projectId: 'p' });
    expect(e1.id).not.toBe(e2.id);
  });
});

describe('normalizeExecutorResult — the executor return contract', () => {
  it('treats undefined / true / a value as success', () => {
    for (const v of [undefined, null, true, 1, 'ok', {}, { ok: true }, { changed: true }]) {
      expect(normalizeExecutorResult(v).ok).toBe(true);
    }
  });

  it('treats false as a refusal', () => {
    expect(normalizeExecutorResult(false)).toEqual({ ok: false, reason: HISTORY_FAIL.REFUSED, detail: '' });
  });

  it('carries an explicit reason and detail through', () => {
    expect(normalizeExecutorResult({ ok: false, reason: HISTORY_FAIL.FAILED, detail: 'HTTP 409' }))
      .toEqual({ ok: false, reason: HISTORY_FAIL.FAILED, detail: 'HTTP 409' });
    expect(normalizeExecutorResult({ ok: false }).reason).toBe(HISTORY_FAIL.REFUSED);
  });
});

describe('historyNote — 108.md §17 feedback copy', () => {
  const entry = { label: 'Screening decision', scope: 'screening', kind: 'screening.decision' };

  it('confirms a successful undo and redo', () => {
    expect(historyNote(entry, 'undo', { ok: true })).toEqual({
      scope: 'screening', kind: 'screening.decision', direction: 'undo',
      tone: 'info', message: 'Screening decision undone',
    });
    expect(historyNote({ ...entry, label: 'Extraction change' }, 'redo', { ok: true }).message)
      .toBe('Extraction change redone');
  });

  it('explains a collaborator conflict, a failed write and an unknown kind', () => {
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.REFUSED }))
      .toMatchObject({ tone: 'warn', message: 'Could not undo — changed by a collaborator' });
    expect(historyNote(entry, 'redo', { ok: false, reason: HISTORY_FAIL.FAILED }))
      .toMatchObject({ tone: 'error', message: 'Could not redo — the change was not saved' });
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.NO_EXECUTOR }))
      .toMatchObject({ tone: 'error', message: 'Could not undo — this action is not reversible here' });
  });

  it('stays SILENT for a no-op and for a blocked in-flight press (§26)', () => {
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.NO_ENTRY })).toBeNull();
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.BUSY })).toBeNull();
    expect(historyNote(null, 'undo', { ok: false, reason: 'whatever' })).toBeNull();
  });

  it('falls back to a generic label and to undo for an unknown direction', () => {
    expect(historyNote({}, 'sideways', { ok: true }).message).toBe('Change undone');
  });
});

describe('shouldClearForProject — 108.md §16', () => {
  it('clears only when the project actually changes', () => {
    expect(shouldClearForProject('p1', 'p1')).toBe(false);
    expect(shouldClearForProject(7, '7')).toBe(false);
    expect(shouldClearForProject(undefined, null)).toBe(false);
    expect(shouldClearForProject('p1', 'p2')).toBe(true);
    expect(shouldClearForProject(undefined, 'p1')).toBe(true);
  });
});
