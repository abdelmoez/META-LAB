/**
 * 117.md §J.13 — MANUSCRIPT SAVE-STATUS HONESTY.
 *
 * The defect: `useManuscript.persist` calls `upd(field, value)`, which is synchronous
 * and returns undefined, so the hook could only ever report "the shell accepted my
 * write" — never "the server has it". The pill therefore said "Saved" while the real
 * blob PUT was still in flight, had failed, or had been REFUSED by the autosave
 * compare-and-set. The failure was visible only in the SHELL's separate indicator.
 *
 * Covered here:
 *   - `composeSaveState`: the full local × shell matrix, including the invariant that
 *     a MISSING shell channel reproduces the pre-117 behaviour exactly.
 *   - `normalizeShellSaveStatus`: the two shells speak slightly different words
 *     ('failed' vs 'error') and this is the one place that is reconciled.
 *   - `useShellSaveStatus` under SSR: provider present → the shell's value; provider
 *     absent (unit tests, SSR, a future shell) → null / 'none'.
 *   - `SaveStatusPill`: the new 'conflict' rendering, its reload language, and the
 *     deliberate absence of a Retry button on that state.
 *   - source pins for the composition wiring in useManuscript (no jsdom in this repo).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import {
  composeSaveState, normalizeShellSaveStatus, useShellSaveStatus, ShellSaveStatusProvider,
  SHELL_SAVE_STATUSES,
} from '../../../src/frontend/storage/shellSaveStatus.jsx';
import { SaveStatusPill } from '../../../src/features/manuscript/manuscriptPanels.jsx';

describe('117.md §J.13 — normalizeShellSaveStatus', () => {
  it('maps serverStorage’s “failed” onto the one vocabulary and passes the rest through', () => {
    expect(normalizeShellSaveStatus('failed')).toBe('error');
    for (const s of SHELL_SAVE_STATUSES) expect(normalizeShellSaveStatus(s)).toBe(s);
  });

  it('an absent / unknown channel has NO opinion (never a fabricated “saved”)', () => {
    expect(normalizeShellSaveStatus(null)).toBe(null);
    expect(normalizeShellSaveStatus(undefined)).toBe(null);
    expect(normalizeShellSaveStatus('')).toBe(null);
    expect(normalizeShellSaveStatus('   ')).toBe(null);
    expect(normalizeShellSaveStatus('whatever')).toBe(null);
    expect(normalizeShellSaveStatus(7)).toBe(null);
  });
});

describe('117.md §J.13 — composeSaveState: the local × shell matrix', () => {
  const LOCAL = ['saved', 'saving', 'error'];

  it('BOTH CHANNELS ABSENT → exactly the pre-117 behaviour (the compatibility invariant)', () => {
    for (const l of LOCAL) {
      expect(composeSaveState(l, null)).toBe(l);
      expect(composeSaveState(l, undefined)).toBe(l);
      expect(composeSaveState(l, '')).toBe(l);
    }
  });

  it('a shell that is idle or settled never overrides the editor’s own state', () => {
    for (const l of LOCAL) {
      expect(composeSaveState(l, 'idle')).toBe(l);
      expect(composeSaveState(l, 'saved')).toBe(l);
    }
  });

  it('conflict from the shell WINS over every local state, including a local “saved”', () => {
    for (const l of LOCAL) expect(composeSaveState(l, 'conflict')).toBe('conflict');
  });

  it('error from either side wins over “saving” and over a local “saved”', () => {
    expect(composeSaveState('saved', 'error')).toBe('error');
    expect(composeSaveState('saving', 'error')).toBe('error');
    // …and a shell that is merely busy cannot bury a local hard failure.
    expect(composeSaveState('error', 'saving')).toBe('error');
    expect(composeSaveState('error', 'saved')).toBe('error');
    expect(composeSaveState('error', 'idle')).toBe('error');
  });

  it('“saving” when EITHER side has unsent work — the local typing signal is kept', () => {
    // Local: field patches are debounced → a flush really is pending. This half was
    // always honest and §J.13 deliberately does not change it.
    expect(composeSaveState('saving', 'saved')).toBe('saving');
    expect(composeSaveState('saving', null)).toBe('saving');
    // Shell: the blob PUT is scheduled/in flight while the editor thinks it is done.
    // THIS is the case that used to render a lying "Saved".
    expect(composeSaveState('saved', 'saving')).toBe('saving');
  });

  it('“saved” only when both channels agree there is nothing outstanding', () => {
    expect(composeSaveState('saved', 'saved')).toBe('saved');
    expect(composeSaveState('saved', 'idle')).toBe('saved');
    expect(composeSaveState('saved', null)).toBe('saved');
  });

  it('conflict outranks error (the refused write is not a retryable failure)', () => {
    expect(composeSaveState('error', 'conflict')).toBe('conflict');
  });

  it('a garbage local state degrades to “saved”, never to a crash', () => {
    expect(composeSaveState(undefined, null)).toBe('saved');
    expect(composeSaveState('nonsense', 'saving')).toBe('saving');
  });
});

/* ── the hook, through SSR (this repo renders to static markup; no jsdom) ──── */
function Probe() {
  const s = useShellSaveStatus();
  return <i data-status={String(s.status)} data-source={s.source} />;
}

describe('117.md §J.13 — useShellSaveStatus resolves whichever channel exists', () => {
  it('inside a provider (the Stitch shell) it reports the shell’s real status', () => {
    for (const s of ['saving', 'saved', 'error', 'conflict', 'idle']) {
      const html = renderToStaticMarkup(
        <ShellSaveStatusProvider status={s}><Probe /></ShellSaveStatusProvider>,
      );
      expect(html).toContain(`data-status="${s}"`);
      expect(html).toContain('data-source="shell"');
    }
  });

  it('a provider publishing an unknown value normalises to “no opinion”', () => {
    const html = renderToStaticMarkup(
      <ShellSaveStatusProvider status="wat"><Probe /></ShellSaveStatusProvider>,
    );
    expect(html).toContain('data-status="null"');
  });

  it('“failed” from a shell that speaks serverStorage’s word arrives as “error”', () => {
    const html = renderToStaticMarkup(
      <ShellSaveStatusProvider status="failed"><Probe /></ShellSaveStatusProvider>,
    );
    expect(html).toContain('data-status="error"');
  });

  it('with NO provider and no legacy bridge → null / “none” (current behaviour preserved)', () => {
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain('data-status="null"');
    expect(html).toContain('data-source="none"');
  });
});

describe('117.md §J.13 — SaveStatusPill', () => {
  const pill = (props) => renderToStaticMarkup(<SaveStatusPill {...props} />);

  it('conflict renders the reload language and offers NO retry', () => {
    const html = pill({ saveState: 'conflict', lastError: null, onRetry: () => {} });
    expect(html).toContain('Updated elsewhere — not saved');
    expect(html).toContain('Load the latest version before editing further.');
    expect(html).toContain('data-testid="stitch-manuscript-save-status"');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Saved</span>');
  });

  it('the other three states are unchanged', () => {
    expect(pill({ saveState: 'saved' })).toContain('Saved');
    expect(pill({ saveState: 'saving' })).toContain('Saving…');
    const failed = pill({ saveState: 'error', lastError: 'boom', onRetry: () => {} });
    expect(failed).toContain('Save failed');
    expect(failed).toContain('Retry');
  });

  it('the test id is stable across all four states (e2e + the shell chip read it)', () => {
    for (const s of ['saved', 'saving', 'error', 'conflict']) {
      expect(pill({ saveState: s, onRetry: () => {} })).toContain('data-testid="stitch-manuscript-save-status"');
    }
  });
});

describe('117.md §J.13 — the composition is wired at the seam (source pins)', () => {
  const src = () => readSource('src/features/manuscript/useManuscript.js');

  it('useManuscript subscribes to the shell channel and returns the COMPOSED state', () => {
    const s = src();
    expect(s).toContain("import { useShellSaveStatus, composeSaveState } from '../../frontend/storage/shellSaveStatus.jsx';");
    expect(s).toContain('const shellSave = useShellSaveStatus();');
    expect(s).toContain('const effectiveSaveState = composeSaveState(saveState, shellSaveStatus);');
    expect(s).toContain('saveState: effectiveSaveState, lastError: effectiveLastError, retry,');
  });

  it('the EXPORT validator reads the composed state, not the local one', () => {
    const s = src();
    // saveStateRef is what prepareExport hands to validateExport — it must carry the
    // composed value or a refused save would export as a clean "Saved".
    expect(s).toContain('const saveStateRef = useRef(effectiveSaveState);');
    expect(s).toContain('saveStateRef.current = effectiveSaveState;');
    expect(s).toContain('saveState: saveStateRef.current, sourcesSettled: true,');
  });

  it('Retry is a real write attempt even when the failure was the SHELL’s…', () => {
    expect(src()).toContain('const list = lastFailed.current || readManuscripts(projectRef.current);');
  });

  it('…but never invents a `manuscripts: []` write on a project that never had one', () => {
    // Byte-stability: a Retry press must not materialise a key the blob never carried.
    expect(src()).toContain('if (!lastFailed.current && (!Array.isArray(list) || !list.length)) {');
  });

  it('the Stitch shell publishes doc.saveStatus to every engine below it', () => {
    const s = readSource('src/frontend/stitch/pages/StitchProjectWorkspace.jsx');
    expect(s).toContain("import { ShellSaveStatusProvider } from '../../storage/shellSaveStatus.jsx';");
    expect(s).toContain('<ShellSaveStatusProvider status={doc.saveStatus}>');
    expect(s).toContain('</ShellSaveStatusProvider>');
  });

  it('neither shell’s own save logic was touched — this is a READ seam', () => {
    const s = readSource('src/frontend/storage/shellSaveStatus.jsx');
    expect(s).not.toContain('fetch(');
    expect(s).not.toContain('autosave(');
    // The legacy channel is reached only when the monolith's bridge is really there,
    // so this hook can never install serverStorage's window.storage side effect.
    expect(s).toContain('if (typeof window === \'undefined\' || !window.storage) return undefined;');
    expect(s).toContain("window.addEventListener('metalab:autosave-conflict', onConflict);");
  });
});
