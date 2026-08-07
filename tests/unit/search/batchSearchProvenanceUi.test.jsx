/**
 * 104.md Part 2 — the manual-search record UI.
 *
 * What matters is that a researcher can state the two facts a file cannot (which
 * database, when it was run) and can retire a test import without deleting it —
 * and that the consequence for the manuscript is visible before they save.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BatchSearchProvenance, {
  provenanceSummary, toDateInput,
} from '../../../src/frontend/screening/components/BatchSearchProvenance.jsx';
import { BatchEntry } from '../../../src/frontend/screening/components/ImportHistory.jsx';

const batch = (o = {}) => ({
  id: 'b1', filename: 'embase.ris', source: 'file', createdAt: '2026-08-11T00:00:00.000Z',
  recordCount: 40, preDedupCount: 40, duplicateCount: 0, rejectedCount: 0,
  remainingCount: 40, contributesToReview: true, sourceDatabase: '', searchedAt: null,
  exclusionNote: '', ...o,
});

const render = (props) => renderToStaticMarkup(<BatchSearchProvenance {...props} />);

describe('it tells you what the manuscript will do with this dataset', () => {
  it('warns while no database is recorded — the search cannot be named', () => {
    const s = provenanceSummary(batch());
    expect(s.tone).toBe('warn');
    expect(s.text).toMatch(/cannot be named in the manuscript/);
  });

  it('states the reported name and date once recorded', () => {
    const s = provenanceSummary(batch({ sourceDatabase: 'embase', searchedAt: '2026-08-03T00:00:00Z' }));
    expect(s.tone).toBe('ok');
    expect(s.text).toBe('Reported as Embase, searched 2026-08-03.');
  });

  it('says plainly when a dataset has been excluded', () => {
    const s = provenanceSummary(batch({ sourceDatabase: 'embase', contributesToReview: false }));
    expect(s.text).toMatch(/Excluded from the reported search methodology/);
  });

  it('falls back to the upload date only when no search date was given', () => {
    expect(provenanceSummary(batch({ sourceDatabase: 'embase' })).text).toContain('2026-08-11');
  });
});

describe('the form', () => {
  it('offers canonical databases, never free text', () => {
    // A free-typed name that does not canonicalize would be reported verbatim.
    const html = render({ batch: batch(), canEdit: true });
    expect(html).toContain('batch-search-provenance');
    // The picker itself only appears once opened; the affordance is always there.
    expect(html).toContain('Add search details');
  });

  it('is read-only for someone without edit rights', () => {
    const html = render({ batch: batch(), canEdit: false });
    expect(html).toContain('batch-search-summary');
    expect(html).not.toContain('Add search details');
  });

  it('offers to EDIT rather than ADD once a database is on record', () => {
    expect(render({ batch: batch({ sourceDatabase: 'embase' }), canEdit: true })).toContain('>Edit<');
  });
});

describe('dates', () => {
  it('normalizes whatever the server sent into the date input format', () => {
    expect(toDateInput('2026-08-03T09:30:00.000Z')).toBe('2026-08-03');
    expect(toDateInput('2026-08-03')).toBe('2026-08-03');
    expect(toDateInput(null)).toBe('');
    expect(toDateInput('not a date')).toBe('');
  });
});

describe('the dataset row', () => {
  it('marks an excluded dataset without hiding any of its numbers', () => {
    const html = renderToStaticMarkup(
      <BatchEntry batch={batch({ contributesToReview: false, sourceDatabase: 'scopus' })} canDelete={false} />,
    );
    expect(html).toContain('Not reported');
    expect(html).toContain('40'); // the counts are still all there
  });

  it('shows no such badge for a contributing dataset', () => {
    const html = renderToStaticMarkup(<BatchEntry batch={batch()} canDelete={false} />);
    expect(html).not.toContain('Not reported');
  });

  it('does not offer to override an automated run’s own execution record', () => {
    const html = renderToStaticMarkup(
      <BatchEntry batch={batch({ source: 'pecan-search' })} canDelete={false} canEditSearch />,
    );
    expect(html).not.toContain('batch-search-provenance');
  });

  it('offers the editor for a manual import', () => {
    const html = renderToStaticMarkup(
      <BatchEntry batch={batch()} canDelete={false} canEditSearch />,
    );
    expect(html).toContain('batch-search-provenance');
  });
});
