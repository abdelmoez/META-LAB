/**
 * SSR-render tests for the "Delete All Imported Search Records" confirmation
 * flow (src/frontend/screening/components/ResetImportedRecordsModal.jsx —
 * 96.md Phase 6A–6C, plan D11).
 *
 * Repo component-test style: renderToStaticMarkup, no jsdom. The pure
 * ResetModalContent carries every state as props, so each modal state (preview
 * counts, scope options, disabled-until-typed-match, 409/403 copy, success) is
 * asserted directly; the stateful default export is smoke-tested in its
 * preview-loading state (effects never run under static render).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ResetImportedRecordsModal, {
  ResetModalContent, normalizeResetPreview, normalizeResetResult, resetErrorView,
} from '../../src/frontend/screening/components/ResetImportedRecordsModal.jsx';

const render = (el, props) => renderToStaticMarkup(createElement(el, props));
const noop = () => {};

const preview = normalizeResetPreview({
  projectName: 'My SR Project',
  confirmToken: 'My SR Project',
  blockedBy: null,
  counts: {
    records: 224, decisions: 310, notes: 12, conflicts: 4, pdfs: 7,
    runsAffected: 3, manualRecordsKept: 55, batches: 9, handedOff: 2,
  },
});

const base = {
  scope: 'search', onScopeChange: noop, preview, previewLoading: false, previewError: '',
  onRetryPreview: noop, projectName: 'My SR Project', confirmText: '', onConfirmChange: noop,
  busy: false, error: null, result: null, onSubmit: noop, onDone: noop, onClose: noop,
};

describe('normalizeResetPreview / normalizeResetResult', () => {
  it('reads nested counts, the project name and the confirmToken', () => {
    expect(preview.records).toBe(224);
    expect(preview.manualRecordsKept).toBe(55);
    expect(preview.projectName).toBe('My SR Project');
    expect(preview.confirmToken).toBe('My SR Project');
    expect(preview.blockedBy).toBeNull();
  });

  it('tolerates a flat counts payload and missing fields', () => {
    const p = normalizeResetPreview({ records: 5 });
    expect(p.records).toBe(5);
    expect(p.decisions).toBe(0);
    expect(p.projectName).toBe('');
    expect(p.confirmToken).toBe('');
    expect(p.blockedBy).toBeNull();
  });

  it('carries a non-empty blockedBy reason and drops blank ones', () => {
    expect(normalizeResetPreview({ blockedBy: 'a search import is running' }).blockedBy)
      .toBe('a search import is running');
    expect(normalizeResetPreview({ blockedBy: '   ' }).blockedBy).toBeNull();
    expect(normalizeResetPreview({ blockedBy: null }).blockedBy).toBeNull();
  });

  it('result normalizer reads the contract key runsMarked (older aliases kept)', () => {
    // Contract shape: { counts: { …, runsMarked } }.
    expect(normalizeResetResult({ counts: { records: 224, runsMarked: 3 } }).runsAffected).toBe(3);
    // Older aliases still accepted.
    const r = normalizeResetResult({ recordsRemoved: 224, runsRolledBack: 3 });
    expect(r.records).toBe(224);
    expect(r.runsAffected).toBe(3);
    expect(r.decisions).toBeNull();
  });
});

describe('ResetModalContent — preview counts (spec 6B)', () => {
  const html = render(ResetModalContent, base);

  it('states exactly what will be removed', () => {
    expect(html).toContain('This will permanently remove');
    expect(html).toContain('224');   // articles
    expect(html).toContain('310');   // decisions
    expect(html).toContain('12');    // notes
    expect(html).toContain('conflict');
    expect(html).toContain('PDF');
    expect(html).toContain('marked as rolled back');
  });

  it('says manual/file-imported records are kept for the default scope', () => {
    expect(html).toContain('55');
    expect(html).toContain('kept');
  });

  it('states that the strategy/history remain and that this is irreversible', () => {
    expect(html).toContain('search strategy and search history remain');
    expect(html).toContain('This cannot be undone.');
  });

  it('warns about handed-off extraction studies when present', () => {
    expect(html).toContain('handed off');
    expect(html).toContain('Data Extraction');
  });
});

describe('ResetModalContent — scope options (spec 6C)', () => {
  it('offers both scopes as radios with search selected by default', () => {
    const html = render(ResetModalContent, base);
    expect(html).toContain('Delete all Search Engine–imported records');
    expect(html).toContain('Delete ALL screening records and restart');
    expect((html.match(/type="radio"/g) || []).length).toBe(2);
    // React SSR renders `checked=""` before `value="…"` on controlled inputs.
    expect(html).toMatch(/checked=""[^>]*value="search"/);
    expect(html).not.toMatch(/checked=""[^>]*value="all"/);
  });

  it('shows the extra warning + harder copy for the full restart scope', () => {
    const html = render(ResetModalContent, { ...base, scope: 'all' });
    expect(html).toContain('restart');
    expect(html).toContain('every');
    expect(html).toContain('nothing is kept');
    expect(html).toContain('Delete ALL screening records');
    expect(html).not.toContain('will be <strong');
  });
});

describe('ResetModalContent — typed confirmation gate (server confirmToken)', () => {
  it('disables the danger button until the exact confirmToken is typed', () => {
    const html = render(ResetModalContent, base);
    expect(html).toContain('Type the exact confirmation text to enable');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete imported search records<\/button>/);
  });

  it('enables the danger button on an exact match', () => {
    const html = render(ResetModalContent, { ...base, confirmText: 'My SR Project' });
    expect(html).not.toContain('Type the exact confirmation text to enable');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Delete imported search records<\/button>/);
  });

  it('a partial/incorrect name never enables the button', () => {
    const html = render(ResetModalContent, { ...base, confirmText: 'My SR' });
    expect(html).toContain('Type the exact confirmation text to enable');
  });

  it('the server confirmToken wins over the project-name props', () => {
    const p = { ...preview, confirmToken: 'Token From Server' };
    const noMatch = render(ResetModalContent, { ...base, preview: p, confirmText: 'My SR Project' });
    expect(noMatch).toMatch(/<button[^>]*disabled=""[^>]*>Delete imported search records<\/button>/);
    const match = render(ResetModalContent, { ...base, preview: p, confirmText: 'Token From Server' });
    expect(match).not.toMatch(/<button[^>]*disabled=""[^>]*>Delete imported search records<\/button>/);
  });

  it('falls back to the literal DELETE when no name is known (L14 — never vacuous)', () => {
    const p = { ...preview, confirmToken: '', projectName: '' };
    const html = render(ResetModalContent, { ...base, preview: p, projectName: '', confirmText: 'anything' });
    expect(html).toContain('DELETE');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete imported search records<\/button>/);
    const match = render(ResetModalContent, { ...base, preview: p, projectName: '', confirmText: 'DELETE' });
    expect(match).not.toMatch(/<button[^>]*disabled=""[^>]*>Delete imported search records<\/button>/);
  });
});

describe('ResetModalContent — blockedBy (M15 / 96.md 6F: warn BEFORE the 409)', () => {
  const blocked = { ...preview, blockedBy: 'a search import job is processing' };

  it('shows a warning banner with the reason and a refresh affordance', () => {
    const html = render(ResetModalContent, { ...base, preview: blocked, onRetryPreview: () => {} });
    expect(html).toContain('a search import job is processing');
    expect(html).toContain('blocked until it finishes');
    expect(html).toContain('Check again');
    expect(html).toContain('role="alert"');
  });

  it('keeps the danger button disabled even with an exact typed match', () => {
    const html = render(ResetModalContent, { ...base, preview: blocked, confirmText: 'My SR Project' });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete imported search records<\/button>/);
    expect(html).toContain('Blocked while another operation is running');
  });

  it('renders no banner when blockedBy is null', () => {
    const html = render(ResetModalContent, base);
    expect(html).not.toContain('blocked until it finishes');
    expect(html).not.toContain('Check again');
  });
});

describe('ResetModalContent — error states', () => {
  it('409 → operation-in-progress explanation with wait/cancel guidance', () => {
    const html = render(ResetModalContent, { ...base, error: { status: 409, message: 'conflict' } });
    expect(html).toContain('currently running');
    expect(html).toContain('Wait for it to finish');
    expect(html).toContain('Nothing was deleted');
  });

  it('403 → a clear access explanation, not a dead button', () => {
    const html = render(ResetModalContent, { ...base, error: { status: 403, message: 'forbidden' } });
    expect(html).toContain('do not have permission');
    expect(html).toContain('project owner');
  });

  it('other errors surface the server message', () => {
    const html = render(ResetModalContent, { ...base, error: { status: 400, message: 'Confirmation text does not match.' } });
    expect(html).toContain('Confirmation text does not match.');
  });

  it('resetErrorView tones: 409 warns, 403 errors', () => {
    expect(resetErrorView({ status: 409 }).tone).toBe('warn');
    expect(resetErrorView({ status: 403 }).tone).toBe('error');
    expect(resetErrorView({ status: 500, message: 'boom' }).message).toBe('boom');
  });
});

describe('ResetModalContent — success view', () => {
  it('shows the result counts and what survives', () => {
    const html = render(ResetModalContent, {
      ...base,
      result: normalizeResetResult({ records: 224, decisions: 310, runsAffected: 3, batches: 9 }),
    });
    expect(html).toContain('Imported records deleted');
    expect(html).toContain('224');
    expect(html).toContain('310');
    expect(html).toContain('rolled back');
    expect(html).toContain('Done');
    // The confirmation form is gone.
    expect(html).not.toContain('type="radio"');
  });

  it('falls back to a generic confirmation when the server returns no counts', () => {
    const html = render(ResetModalContent, { ...base, result: normalizeResetResult({}) });
    expect(html).toContain('The selected records were deleted.');
  });
});

describe('ResetImportedRecordsModal — SSR smoke (stateful shell)', () => {
  it('renders a labelled dialog in its preview-loading state', () => {
    const html = render(ResetImportedRecordsModal, { pid: 'p1', projectName: 'My SR Project', onClose: noop, onDone: noop });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Delete All Imported Search Records');
    expect(html).toContain('Calculating exactly what will be removed…');
  });
});
