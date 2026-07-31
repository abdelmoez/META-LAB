/**
 * SSR-render tests for the article-level "Import provenance" section
 * (src/frontend/screening/components/ImportProvenance.jsx — 96.md 5D, M10).
 *
 * Repo component-test style: renderToStaticMarkup, no jsdom. The lazy fetch in
 * the stateful default export never runs under static render, so it is
 * smoke-tested collapsed; the PURE pieces — normalizeProvenance / describeChange
 * / ProvenanceContent — are asserted against the exact provenance contract:
 *
 *   GET /projects/:pid/records/:rid/provenance →
 *     { sources:[{runId,runName,origin,provider,providerRecordId,outcome,
 *        importedAt,batchId,filename,rolledBackAt}],
 *       changes:[{field,fromValue,toValue,runId,provider,createdAt}] }
 *   sources sorted importedAt ASC (first = the search that introduced it).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ImportProvenance, {
  normalizeProvenance, describeChange, sourceName, ProvenanceContent,
} from '../../src/frontend/screening/components/ImportProvenance.jsx';

const render = (el, props) => renderToStaticMarkup(createElement(el, props));

/* The exact wire shape: introduced by a pubmed run, re-found by a europepmc run
   (metadata merge) and a manual RIS file; one abstract fill + one title change. */
const payload = {
  sources: [
    {
      runId: 'run-1', runName: 'Primary search', origin: 'manual', provider: 'pubmed',
      providerRecordId: 'pmid:123', outcome: 'new', importedAt: '2026-06-01T10:00:00Z',
      batchId: 'b-1', filename: '', rolledBackAt: null,
    },
    {
      runId: 'run-2', runName: 'Weekly living update', origin: 'living', provider: 'europepmc',
      providerRecordId: 'ppr:9', outcome: 'updated', importedAt: '2026-07-01T10:00:00Z',
      batchId: 'b-2', filename: '', rolledBackAt: '2026-07-15T10:00:00Z',
    },
    {
      runId: '', runName: '', origin: 'file', provider: '',
      providerRecordId: '', outcome: 'already_present', importedAt: '2026-07-10T10:00:00Z',
      batchId: 'b-3', filename: 'refs.ris', rolledBackAt: null,
    },
  ],
  changes: [
    { field: 'abstract', fromValue: '', toValue: 'Background: a randomized trial…', runId: 'run-2', provider: 'europepmc', createdAt: '2026-07-01T10:00:00Z' },
    { field: 'title', fromValue: 'Old truncated title', toValue: 'Full corrected title', runId: 'run-2', provider: 'europepmc', createdAt: '2026-07-01T10:00:01Z' },
  ],
};

describe('normalizeProvenance — contract read model', () => {
  const data = normalizeProvenance(payload);

  it('keeps sources importedAt-ASC: first = the search that introduced the article', () => {
    expect(data.first.runId).toBe('run-1');
    // run-2 (Jul 1) precedes the file re-import (Jul 10).
    expect(data.others.map((s) => s.batchId)).toEqual(['b-2', 'b-3']);
  });

  it('re-sorts defensively when the server order is wrong', () => {
    const reversed = normalizeProvenance({ ...payload, sources: [...payload.sources].reverse() });
    expect(reversed.first.runId).toBe('run-1');
  });

  it('derives the unique database list from the source providers', () => {
    expect(data.databases).toEqual(['pubmed', 'europepmc']);
  });

  it('maps runId → run display name for the change log', () => {
    expect(data.runNameById['run-2']).toBe('Weekly living update');
  });

  it('tolerates an empty/absent payload', () => {
    expect(normalizeProvenance(null).sources).toEqual([]);
    expect(normalizeProvenance({}).first).toBeNull();
  });

  it('sourceName prefers runName, then filename, then an origin label', () => {
    expect(sourceName(payload.sources[0])).toBe('Primary search');
    expect(sourceName(payload.sources[2])).toBe('refs.ris');
    expect(sourceName({ origin: 'living' })).toBe('Living review run');
  });
});

describe('describeChange — "abstract added by <run> on <date>" compaction', () => {
  const { runNameById } = normalizeProvenance(payload);

  it('a blank→value fill reads as "added" with the run name', () => {
    const d = describeChange(normalizeProvenance(payload).changes[0], runNameById);
    expect(d.summary).toContain('abstract added by Weekly living update');
    expect(d.summary).toContain('2026');
    expect(d.detail).toContain('Background: a randomized trial…');
  });

  it('a value change reads as "updated" with a compact from → to', () => {
    const d = describeChange(normalizeProvenance(payload).changes[1], runNameById);
    expect(d.summary).toContain('title updated by Weekly living update');
    expect(d.detail).toBe('Old truncated title → Full corrected title');
  });

  it('falls back to the provider label when the run is unknown', () => {
    const d = describeChange({ field: 'doi', fromValue: '', toValue: '10.1/x', runId: 'gone', provider: 'europepmc', createdAt: null }, {});
    expect(d.summary).toContain('doi added by Europe PMC');
  });
});

describe('ProvenanceContent — the expanded 5D article view', () => {
  const html = render(ProvenanceContent, { data: normalizeProvenance(payload) });

  it('states the first search that introduced the article', () => {
    expect(html).toContain('First found by');
    expect(html).toContain('Primary search');
    expect(html).toContain('PubMed');
    expect(html).toContain('2026');
  });

  it('lists the other sources with their outcomes (incl. rolled-back marker)', () => {
    expect(html).toContain('Also found by');
    expect(html).toContain('Weekly living update');
    expect(html).toContain('updated its metadata');
    expect(html).toContain('refs.ris');
    expect(html).toContain('found it again');
    expect(html).toContain('rolled back');
  });

  it('shows the databases where the article appeared', () => {
    expect(html).toContain('Databases where it appeared');
    expect(html).toContain('Europe PMC');
  });

  it('shows the compacted metadata changes', () => {
    expect(html).toContain('Metadata changes');
    expect(html).toContain('abstract added by Weekly living update');
    expect(html).toContain('title updated by Weekly living update');
  });

  it('renders an honest empty state when nothing is recorded', () => {
    const empty = render(ProvenanceContent, { data: normalizeProvenance({}) });
    expect(empty).toContain('No import provenance is recorded');
  });

  it('says so when later imports changed nothing', () => {
    const noChanges = render(ProvenanceContent, { data: normalizeProvenance({ sources: payload.sources, changes: [] }) });
    expect(noChanges).toContain('No metadata was changed by later imports.');
  });
});

describe('ImportProvenance container — SSR smoke (collapsed, lazy)', () => {
  it('renders the collapsed toggle without fetching (effects never run in SSR)', () => {
    const html = render(ImportProvenance, { pid: 'p1', recordId: 'r1' });
    expect(html).toContain('Import provenance');
    expect(html).toContain('aria-expanded="false"');
    // Nothing fetched / no content until expanded.
    expect(html).not.toContain('First found by');
  });
});
