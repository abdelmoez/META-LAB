import { describe, it, expect } from 'vitest';
import { prismaCounts, reportToCsv, reportToHtml } from '../../../server/pecanSearch/report.js';

describe('report — PRISMA counts + exporters', () => {
  it('derives PRISMA identification figures (raw, not deduped)', () => {
    const counts = { rawRetrieved: 100, exactDup: 10, fuzzyDup: 5, existingMatched: 3, imported: 82, ambiguousDup: 2, failedRecords: 1, perSource: { pubmed: { raw: 100 } } };
    const p = prismaCounts(counts);
    expect(p.recordsIdentified).toBe(100);   // raw, not deduped
    expect(p.duplicatesRemoved).toBe(15);    // exact + fuzzy
    expect(p.recordsToScreening).toBe(82);
    expect(p.bySource.pubmed.raw).toBe(100);
  });

  it('CSV neutralizes spreadsheet formula injection', () => {
    const report = {
      searchName: 'X', runId: 'r1', runDate: '2026', canonicalQuery: 'q',
      counts: { recordsIdentified: 1, duplicatesRemoved: 0, recordsToScreening: 1 },
      perSource: [{ database: '=cmd|/c calc', provider: 'p', platform: '', finalQuery: 'a,b', queryHash: 'h', previewCount: 1, retrievedCount: 1, importedCount: 1, existingMatchCount: 0, duplicatesRemoved: 0, ambiguousPending: 0, failedRecords: 0, capReached: false, state: 'completed', startedAt: '', completedAt: '' }],
    };
    const csv = reportToCsv(report);
    expect(csv).toContain("'=cmd");           // leading = neutralized
    expect(csv).toContain('"a,b"');            // comma-quoted
  });

  it('HTML escapes user/provider text', () => {
    const report = {
      searchName: '<script>x</script>', runId: 'r1', runDate: '2026', state: 'completed',
      canonicalQuery: 'q', deduplicationMethod: 'm', engineVersion: 'v', generatedAt: 'now',
      counts: { recordsIdentified: 1, duplicatesRemoved: 0, existingMatched: 0, recordsToScreening: 1, ambiguousPending: 0 },
      perSource: [{ database: 'PubMed', finalQuery: '<b>q</b>', hasOverride: false, translationWarnings: [], previewCount: 1, retrievedCount: 1, importedCount: 1, duplicatesRemoved: 0, state: 'completed', errorDetail: '' }],
    };
    const html = reportToHtml(report);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;q&lt;/b&gt;');
  });
});
