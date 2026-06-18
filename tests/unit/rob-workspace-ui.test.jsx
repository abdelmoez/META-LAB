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
import { WorkspaceFooter, ArticleHeaderBar } from '../../src/frontend/rob/RobWorkspace.jsx';
import { pdfFitWidthSrc } from '../../src/frontend/screening/components/PdfViewer.jsx';

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
