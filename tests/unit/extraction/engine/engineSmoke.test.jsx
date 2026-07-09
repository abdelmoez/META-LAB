/**
 * SSR smoke for the Pecan Extraction Engine UI (76.md). House style: renderToStaticMarkup
 * (no jsdom); effects/network never run, so we exercise the initial render of the article
 * list + orchestrator's empty/loading states and the pure→UI wiring only.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ArticleList from '../../../../src/features/extraction/engine/ArticleList.jsx';
import PecanExtractionEngine from '../../../../src/features/extraction/engine/PecanExtractionEngine.jsx';
import ArticleWorkspace from '../../../../src/features/extraction/engine/ArticleWorkspace.jsx';
import { buildArticleSummary } from '../../../../src/research-engine/extraction/engine/articleList.js';
import { mkStudy } from '../../../../src/research-engine/project-model/defaults.js';

describe('ArticleList SSR', () => {
  it('renders an empty state with no articles', () => {
    const html = renderToStaticMarkup(<ArticleList articles={[]} stats={{ total: 0, complete: 0, inProgress: 0, notStarted: 0, needsValidation: 0, readyForAnalysis: 0, avgProgress: 0 }} />);
    expect(html).toContain('Articles for extraction');
    expect(html).toMatch(/No articles have reached extraction/i);
  });
  it('renders a row per article with status + progress', () => {
    const arts = [
      buildArticleSummary({ ...mkStudy(), id: 'a', author: 'Smith', year: '2020', outcome: 'Mortality', es: '0.4', esType: 'GENERIC', lo: '0.1', hi: '0.7' }),
      buildArticleSummary({ ...mkStudy(), id: 'b', esType: 'PROP', events: '99', total: '3' }),
    ];
    const html = renderToStaticMarkup(<ArticleList articles={arts} stats={null} onOpen={() => {}} />);
    expect(html).toContain('Smith');
    expect(html).toMatch(/Validation required|Complete|In progress/);
  });
  it('shows the search + sort controls', () => {
    const html = renderToStaticMarkup(<ArticleList articles={[]} />);
    expect(html).toMatch(/Search title, author/i);
    expect(html).toMatch(/Recently edited/);
  });
});

describe('PecanExtractionEngine SSR', () => {
  it('renders the list view for a project (no article open)', () => {
    const project = { id: 'p1', studies: [{ ...mkStudy(), id: 's1', author: 'Jones', year: '2019', outcome: 'Relapse' }] };
    const html = renderToStaticMarkup(
      <PecanExtractionEngine project={project} updateProject={() => {}} activeId="p1" setTab={() => {}} saveStatus="" />,
    );
    expect(html).toContain('Articles for extraction');
  });
  it('is SSR-safe with an empty project (no window access crash)', () => {
    const html = renderToStaticMarkup(
      <PecanExtractionEngine project={{ id: 'p2', studies: [] }} updateProject={() => {}} activeId="p2" setTab={() => {}} />,
    );
    expect(html).toContain('Articles for extraction');
  });
});

describe('ArticleWorkspace SSR (77.md §3/§4/§8)', () => {
  const study = { ...mkStudy(), id: 's1', author: 'Adams', year: '2021', outcome: 'Mortality', esType: 'RR' };
  const html = renderToStaticMarkup(
    <ArticleWorkspace projectId="p1" study={study} article={{ id: 's1', status: 'in_progress' }} studies={[study]} />,
  );
  it('offers only Pick from PDF and Manual Entry modes', () => {
    expect(html).toContain('Pick from PDF');
    expect(html).toContain('Manual Entry');
  });
  it('no longer surfaces table- or figure-recognition modes (§3)', () => {
    expect(html).not.toMatch(/▦ Table|📈 Figure/);
  });
  it('surfaces the Converter and drops the "Also reported" slot (§4)', () => {
    expect(html).toContain('CONVERTER');
    expect(html).not.toMatch(/Also reported \(not in this review\)/);
  });
  it('shows a discoverable active pick target for the measure (§7/§8)', () => {
    expect(html).toMatch(/Next click fills/);
  });
});
