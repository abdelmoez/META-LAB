/**
 * SSR smoke tests for the prompt34 RoB workspace UI pieces. The project's test
 * infra renders components to static markup (no jsdom), so these assert the
 * server-rendered output of the new presentational parts:
 *   - WorkspaceFooter: the always-visible action bar (Task 2/7).
 *   - ArticleHeaderBar: the persistent header spanning both columns (Task 4/5).
 *   - pdfFitWidthSrc: the fit-width default (Task 1).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WorkspaceFooter, ArticleHeaderBar, ResizeDivider, clampSplit,
  hasSavedResponse, isRetryableSaveError,
} from '../../src/frontend/rob/RobWorkspace.jsx';
import PdfViewer, { pdfFitWidthSrc } from '../../src/frontend/screening/components/PdfViewer.jsx';
import RobPdfPanel from '../../src/frontend/rob/RobPdfPanel.jsx';

const noop = () => {};
const footerProps = (over = {}) => ({
  active: 'D3', setActive: noop, setFocusedQ: noop,
  allComplete: false, finalised: false, readOnly: false,
  saving: false, saveState: 'idle',
  onFinalise: noop, onReopen: noop, onContinue: noop,
  ...over,
});

describe('WorkspaceFooter — always-visible action bar (Task 2/7)', () => {
  it('shows Finalise (not Re-open / Continue) while a draft is in progress', () => {
    const html = renderToStaticMarkup(<WorkspaceFooter {...footerProps()} />);
    expect(html).toContain('Finalise');
    expect(html).not.toContain('Re-open');
    expect(html).not.toContain('Continue to GRADE');
    expect(html).toContain('autosaves');
  });

  it('shows Re-open + Continue to GRADE once finalised', () => {
    const html = renderToStaticMarkup(<WorkspaceFooter {...footerProps({ finalised: true, allComplete: true })} />);
    expect(html).toContain('Re-open');
    expect(html).toContain('Continue to GRADE');
    expect(html).toContain('finalised');
  });

  it('hides Continue to GRADE when no onContinue is provided', () => {
    const html = renderToStaticMarkup(<WorkspaceFooter {...footerProps({ finalised: true, onContinue: undefined })} />);
    expect(html).toContain('Re-open');
    expect(html).not.toContain('Continue to GRADE');
  });

  it('offers no Finalise / Re-open for a read-only viewer', () => {
    const html = renderToStaticMarkup(<WorkspaceFooter {...footerProps({ readOnly: true })} />);
    expect(html).not.toContain('Finalise');
    expect(html).not.toContain('Re-open');
    expect(html).toContain('view only');
  });

  it('shows a "Back to D5" affordance on the summary step (no Next)', () => {
    const html = renderToStaticMarkup(<WorkspaceFooter {...footerProps({ active: 'summary' })} />);
    expect(html).toContain('Back to D5');
    expect(html).not.toContain('Next:');
  });
});

describe('ArticleHeaderBar — persistent header spanning both columns (Task 4/5)', () => {
  const record = { title: 'Effect of X on Y: an RCT', authors: 'Smith J, Doe A', journal: 'Lancet', year: 2024, doi: '10.1000/abc', pmid: '123456', sourceDb: 'PubMed', abstract: 'Background: ...', keywords: 'rct; mortality' };

  it('renders the article identity and links — and NO "Article Information" tab', () => {
    const html = renderToStaticMarkup(<ArticleHeaderBar record={record} loading={false} view={{ studyId: 's1' }} showDetails />);
    expect(html).toContain('Effect of X on Y: an RCT');
    expect(html).toContain('Smith J, Doe A');
    expect(html).toContain('DOI: 10.1000/abc');
    expect(html).toContain('PMID: 123456');
    // The removed tab must not reappear.
    expect(html).not.toContain('Article Information');
  });

  it('offers an Abstract & keywords disclosure (collapsed by default) when details are enabled', () => {
    const html = renderToStaticMarkup(<ArticleHeaderBar record={record} loading={false} view={{ studyId: 's1' }} showDetails />);
    // "&" is HTML-escaped in static markup; match the disclosure toggle + collapsed state.
    expect(html).toContain('Abstract &amp; keywords');
    expect(html).toContain('aria-expanded="false"');
    // Collapsed initially — the abstract body is not rendered until expanded.
    expect(html).not.toContain('Background: ...');
  });

  it('omits the disclosure when article details are admin-disabled', () => {
    const html = renderToStaticMarkup(<ArticleHeaderBar record={record} loading={false} view={{ studyId: 's1' }} showDetails={false} />);
    expect(html).not.toContain('Abstract & keywords');
  });

  it('shows a loading state, then a study fallback when no record', () => {
    const loadingHtml = renderToStaticMarkup(<ArticleHeaderBar record={null} loading view={{ studyId: 's1' }} showDetails />);
    expect(loadingHtml).toContain('Loading article');
    const emptyHtml = renderToStaticMarkup(<ArticleHeaderBar record={null} loading={false} view={{ studyId: 's1', outcomeId: 'o1' }} showDetails />);
    expect(emptyHtml).toContain('s1');
  });
});

describe('pdfFitWidthSrc — fit-width default (Task 1)', () => {
  it('appends the page-width fragment to a plain URL', () => {
    expect(pdfFitWidthSrc('/api/x/download')).toBe('/api/x/download#zoom=page-width&view=FitH');
  });
  it('returns null for a missing URL', () => {
    expect(pdfFitWidthSrc(null)).toBe(null);
    expect(pdfFitWidthSrc('')).toBe(null);
  });
  it('preserves an existing fragment rather than double-appending', () => {
    expect(pdfFitWidthSrc('/api/x#page=2')).toBe('/api/x#page=2');
  });
});

/* ── prompt36 Task 1 — resizable 70/30 split ──────────────────────────────── */
describe('clampSplit — keeps the PDF fraction within usable bounds', () => {
  // prompt41 Task 4 — bounds widened (0.20–0.82) so the assessment can shrink, not
  // only grow; PDF is capped at 82% (assessment floor ≈18%) and floored at 20%.
  it('clamps a too-wide PDF down to the 82% max (≈18% assessment floor)', () => {
    expect(clampSplit(0.95)).toBe(0.82);
  });
  it('clamps a too-narrow PDF up to the 20% min', () => {
    expect(clampSplit(0.10)).toBe(0.20);
  });
  it('passes through an in-range ratio unchanged (e.g. the 70/30 default)', () => {
    expect(clampSplit(0.70)).toBe(0.70);
    expect(clampSplit(0.55)).toBe(0.55);
  });
});

describe('ResizeDivider — accessible drag handle (Task 1)', () => {
  const split = { ratio: 0.70, dragging: false, onPointerDown: () => {}, reset: () => {}, nudge: () => {} };
  it('renders a vertical separator exposing the current ratio for assistive tech', () => {
    const html = renderToStaticMarkup(<ResizeDivider split={split} reduced={false} />);
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuenow="70"');
    expect(html).toContain('aria-valuemin="20"');
    expect(html).toContain('aria-valuemax="82"');
    expect(html).toContain('tabindex="0"'); // keyboard reachable
  });
});

/* ── prompt36 Task 2 — PDF viewer flush full-width ────────────────────────── */
describe('PdfViewer flush mode (Task 2)', () => {
  it('drops its own card border/radius in flush mode so the host owns the frame', () => {
    const flush = renderToStaticMarkup(<PdfViewer pid="p" recordId="r" canManage={false} flush />);
    expect(flush).toContain('Full-text PDF');      // toolbar still present
    expect(flush).not.toContain('border-radius:10px'); // no nested rounded card
  });
  it('keeps its own bordered, rounded card when NOT flush (standalone use)', () => {
    const normal = renderToStaticMarkup(<PdfViewer pid="p" recordId="r" canManage={false} />);
    expect(normal).toContain('border-radius:10px');
  });
});

describe('RobPdfPanel — empty state when no screening record (Task 2)', () => {
  it('shows a safe empty state instead of mounting the viewer', () => {
    const html = renderToStaticMarkup(<RobPdfPanel loading={false} error="" screenProjectId={null} recordId={null} canManage={false} />);
    expect(html).toContain('No PDF for this study yet');
  });
  it('shows the error + retry affordance when resolution failed', () => {
    const html = renderToStaticMarkup(<RobPdfPanel loading={false} error="Could not load the study PDF." screenProjectId={null} recordId={null} canManage onRetry={() => {}} />);
    expect(html).toContain('Could not load the study PDF.');
    expect(html).toContain('Retry');
  });
});

/* ── r2 review finding 5 — the autosave queue's two decisions ─────────────────
 *
 * Both of these were bugs that no rendering test could see, and both could
 * silently destroy a reviewer's work:
 *
 *  · `response || 'NA'` sent the answer "Not applicable" for any question that
 *    had only a RATIONALE typed against it. On QUADAS-2 / QUIPS / AMSTAR 2 (no
 *    'NA' in their answer sets) the server 400s; on JBI / PROBAST (which do have
 *    one) it recorded a fabricated answer the reviewer never gave.
 *
 *  · the catch re-queued EVERY failure, so that rejected item came back on the
 *    next keystroke, was rejected again, and took every later edit down with it —
 *    a permanently poisoned save queue behind a single "save failed" chip.
 */
describe('autosave queue — what is sent (finding 5)', () => {
  it('sends a real answer', () => {
    expect(hasSavedResponse('Y')).toBe(true);
    expect(hasSavedResponse('NA')).toBe(true);   // when the reviewer CHOSE it
  });

  it('sends nothing for a meta-only edit on an unanswered question', () => {
    // This is the case that used to become response:'NA'.
    expect(hasSavedResponse('')).toBe(false);
    expect(hasSavedResponse(undefined)).toBe(false);
    expect(hasSavedResponse(null)).toBe(false);
  });

  it('keeps the Newcastle-Ottawa rule: an emptied selection is not a save', () => {
    expect(hasSavedResponse(['a', 'b'])).toBe(true);
    expect(hasSavedResponse([])).toBe(false);
  });
});

describe('autosave queue — what is retried (finding 5)', () => {
  it('DROPS a validation rejection instead of retrying it forever', () => {
    expect(isRetryableSaveError({ status: 400, message: 'Invalid response' })).toBe(false);
  });

  it('drops the other permanent 4xx verdicts too', () => {
    for (const status of [401, 403, 404, 409, 422]) {
      expect(isRetryableSaveError({ status }), `HTTP ${status}`).toBe(false);
    }
  });

  it('retries a transient failure exactly as before', () => {
    expect(isRetryableSaveError({ status: 500 })).toBe(true);
    expect(isRetryableSaveError({ status: 503 })).toBe(true);
    // A fetch that never reached the server carries no status at all.
    expect(isRetryableSaveError(new Error('Failed to fetch'))).toBe(true);
    expect(isRetryableSaveError(undefined)).toBe(true);
  });

  it('treats the two self-clearing 4xx codes as transient', () => {
    expect(isRetryableSaveError({ status: 408 })).toBe(true);   // request timeout
    expect(isRetryableSaveError({ status: 429 })).toBe(true);   // rate limited
  });
});
