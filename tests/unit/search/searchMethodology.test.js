/**
 * 104.md Part 2 — Search Engine → Manuscript synchronization.
 *
 * The scenarios below are the ones 104.md lists by name under "Testing — Search →
 * Manuscript". They are written against the manuscript's OWN output wherever
 * possible (what a reader would actually see) rather than against intermediate
 * shapes, because the requirement is about what the paper says.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveSearchProvenance,
} from '../../../src/research-engine/search/searchProvenance.js';
import {
  deriveSearchMethodology, checkPrismaConsistency,
} from '../../../src/research-engine/search/searchMethodology.js';
import { renderFacts, resolveFacts, buildFactContext, FACTS } from '../../../src/research-engine/manuscript/factTokens.js';
import { buildSearchStrategyTable } from '../../../src/research-engine/manuscript/tables.js';
import { computeDependencyState } from '../../../src/research-engine/manuscript/dependencies.js';
import { derivePrismaFlow } from '../../../src/research-engine/prisma/derive.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const run = (provider, completedAt, o = {}) => ({
  id: o.runId || `run-${provider}-${completedAt}`,
  state: 'completed',
  origin: o.origin || 'automated',
  rolledBackAt: o.rolledBackAt || null,
  completedAt,
  sources: [{
    provider, state: o.state || 'completed', rawCount: o.raw ?? 100,
    importedCount: o.imported ?? 100, completedAt, errorClass: '',
  }],
});

const batch = (name, createdAt, count = 40, o = {}) => ({
  id: o.id || `b-${name}-${createdAt}`,
  source: 'file',
  filename: `${name}.ris`,
  createdAt,
  recordCount: count,
  databases: [{ name, count }],
});

const methodologyOf = (input) => deriveSearchMethodology(deriveSearchProvenance(input));

// The manuscript sentence exactly as the generator emits it.
const SENTENCE = 'We searched [[fact:search.databases]] (last searched [[fact:search.date]]).';
const say = (methodology) => renderFacts(SENTENCE, resolveFacts({}, { searchMethodology: methodology }));

/* ═══════════════ the named scenarios ═══════════════ */

describe('automated-only search', () => {
  it('names every database the runs actually hit', () => {
    const m = methodologyOf({
      runs: [run('pubmed', '2026-01-10T09:00:00Z'), run('embase', '2026-01-12T09:00:00Z')],
    });
    expect(say(m)).toBe('We searched Embase and PubMed (last searched January 12, 2026).');
  });

  it('never names a database that was only configured', () => {
    const m = methodologyOf({ runs: [run('pubmed', '2026-01-10T09:00:00Z')], configured: ['embase', 'scopus'] });
    expect(m.databases).toEqual(['PubMed']);
    expect(say(m)).not.toMatch(/Embase|Scopus/);
    // …but the UI can still see that they were configured and never run.
    expect(m.excluded.map((d) => d.state)).toContain('configured');
  });
});

describe('manual-only search', () => {
  it('reports databases searched by hand and imported from a file', () => {
    const m = methodologyOf({ imports: [batch('Embase', '2026-02-01T00:00:00Z')] });
    expect(m.databases).toEqual(['Embase']);
    expect(m.workflow).toBe('manual');
    expect(say(m)).toBe('We searched Embase (last searched February 1, 2026).');
  });
});

describe('mixed search — PubMed automated + Embase manual', () => {
  const m = methodologyOf({
    runs: [run('pubmed', '2026-01-10T09:00:00Z')],
    imports: [batch('Embase', '2026-01-14T00:00:00Z')],
  });

  it('produces BOTH database names — how they were searched does not change what was searched', () => {
    expect(m.databases).toEqual(['Embase', 'PubMed']);
    expect(say(m)).toContain('Embase and PubMed');
  });

  it('still records HOW, for the sections where that is methodologically relevant', () => {
    expect(m.workflow).toBe('mixed');
    expect(m.automated).toBe(true);
    expect(m.manual).toBe(true);
  });
});

describe('updated search', () => {
  it('moves the reported date to the latest search, not the first', () => {
    const m = methodologyOf({
      runs: [
        run('pubmed', '2026-01-10T09:00:00Z'),
        run('embase', '2026-01-12T09:00:00Z'),
        run('scopus', '2026-01-15T09:00:00Z'),
      ],
    });
    expect(say(m)).toContain('last searched January 15, 2026');
    expect(m.firstSearchAt.slice(0, 10)).toBe('2026-01-10');
  });

  it('counts DISTINCT search days as updates, not runs', () => {
    // Four databases searched across three days is two updates, not three.
    const m = methodologyOf({
      runs: [
        run('pubmed', '2026-01-10T09:00:00Z'), run('embase', '2026-01-10T11:00:00Z'),
        run('scopus', '2026-02-12T09:00:00Z'), run('cochrane', '2026-03-01T09:00:00Z'),
      ],
    });
    expect(m.updateCount).toBe(2);
    expect(m.updated).toBe(true);
  });

  it('a single unrepeated search is zero updates, not unknown', () => {
    const m = methodologyOf({ runs: [run('pubmed', '2026-01-10T09:00:00Z')] });
    expect(m.updateCount).toBe(0);
    expect(FACTS['search.updateCount'].resolve(buildFactContext({}, { searchMethodology: m }))).toBe('0');
  });
});

describe('added database', () => {
  it('appears in the sentence with no regeneration — the token re-resolves', () => {
    const before = methodologyOf({ runs: [run('pubmed', '2026-01-04T09:00:00Z'), run('embase', '2026-01-04T09:00:00Z')] });
    expect(say(before)).toBe('We searched Embase and PubMed (last searched January 4, 2026).');

    const after = methodologyOf({
      runs: [run('pubmed', '2026-01-04T09:00:00Z'), run('embase', '2026-01-04T09:00:00Z'),
        run('scopus', '2026-02-12T09:00:00Z')],
    });
    // The STORED markdown never changed — only what it resolves to.
    expect(say(after)).toBe('We searched Embase, PubMed, and Scopus (last searched February 12, 2026).');
  });

  it('moves the dependency fingerprint, so dependent sections are flagged', () => {
    // Without this the manuscript would silently disagree with itself until
    // someone thought to regenerate.
    const p1 = deriveSearchProvenance({ runs: [run('pubmed', '2026-01-04T09:00:00Z')] });
    const p2 = deriveSearchProvenance({ runs: [run('pubmed', '2026-01-04T09:00:00Z'), run('scopus', '2026-02-12T09:00:00Z')] });
    const a = computeDependencyState({}, { searchProvenance: p1 });
    const b = computeDependencyState({}, { searchProvenance: p2 });
    expect(a['search.databases']).not.toBe(b['search.databases']);
    expect(a['search.date']).not.toBe(b['search.date']);
  });
});

describe('removed / invalid search', () => {
  it('a rolled-back automated run stops being reported', () => {
    const m = methodologyOf({
      runs: [
        run('pubmed', '2026-01-10T09:00:00Z'),
        run('scopus', '2026-03-01T09:00:00Z', { rolledBackAt: '2026-03-02T00:00:00Z' }),
      ],
    });
    expect(m.databases).toEqual(['PubMed']);
    // Crucially, the withdrawn search must not still be setting the review's date.
    expect(say(m)).toContain('last searched January 10, 2026');
  });

  it('keeps the withdrawn search visible for the audit trail', () => {
    const m = methodologyOf({
      runs: [run('scopus', '2026-03-01T09:00:00Z', { rolledBackAt: '2026-03-02T00:00:00Z' })],
    });
    expect(m.excluded.map((d) => d.state)).toContain('invalidated');
    expect(m.known).toBe(false); // nothing reportable — and it says so
  });

  it('a later valid re-run supersedes a rolled-back one', () => {
    const m = methodologyOf({
      runs: [
        run('scopus', '2026-03-01T09:00:00Z', { runId: 'bad', rolledBackAt: '2026-03-02T00:00:00Z' }),
        run('scopus', '2026-03-05T09:00:00Z', { runId: 'good' }),
      ],
    });
    expect(m.databases).toEqual(['Scopus']);
    expect(say(m)).toContain('last searched March 5, 2026');
  });
});

describe('living review', () => {
  it('preserves the whole history while reporting only the most recent date', () => {
    const m = methodologyOf({
      runs: [
        run('pubmed', '2026-01-04T09:00:00Z'),
        run('pubmed', '2026-04-04T09:00:00Z', { runId: 'r2', origin: 'living' }),
        run('pubmed', '2026-07-04T09:00:00Z', { runId: 'r3', origin: 'living' }),
      ],
    });
    expect(m.searchDays).toEqual(['2026-01-04', '2026-04-04', '2026-07-04']);
    expect(m.updateCount).toBe(2);
    expect(m.firstSearchAt.slice(0, 10)).toBe('2026-01-04');
    expect(say(m)).toContain('last searched July 4, 2026');
  });
});

describe('placeholder resolution', () => {
  it('shows an honest placeholder while nothing is known', () => {
    const m = deriveSearchMethodology(null);
    expect(say(m)).toBe(
      'We searched [Databases searched — not yet available] (last searched [Date of the most recent search — not yet available]).',
    );
  });

  it('resolves both the moment a search exists — nobody types what the system knows', () => {
    const m = methodologyOf({ runs: [run('pubmed', '2026-05-06T09:00:00Z')] });
    const out = say(m);
    expect(out).toBe('We searched PubMed (last searched May 6, 2026).');
    expect(out).not.toMatch(/not yet available/);
  });

  it('never renders an internal identifier where a database name belongs', () => {
    // 'pubmed' is the internal provider key; the manuscript must say PubMed.
    const m = methodologyOf({ runs: [run('pubmed', '2026-05-06T09:00:00Z'), run('clinicaltrials', '2026-05-06T09:00:00Z')] });
    expect(say(m)).not.toMatch(/\bpubmed\b|clinicaltrials/);
    expect(m.registers).toEqual(['ClinicalTrials.gov']);
    // A register is not a database — PRISMA reports them in separate clauses.
    expect(m.databases).toEqual(['PubMed']);
  });
});

/* ═══════════════ one source, every section ═══════════════ */

describe('Abstract, Methods and the strategy table use the SAME source', () => {
  const prov = deriveSearchProvenance({
    runs: [run('pubmed', '2026-01-10T09:00:00Z')],
    imports: [batch('Embase', '2026-01-14T00:00:00Z')],
  });
  const m = deriveSearchMethodology(prov);

  it('the PRISMA-S strategy table lists exactly what the prose names', () => {
    const t = buildSearchStrategyTable({}, { searchProvenance: prov });
    expect(t.rows.map((r) => r.database)).toEqual(m.databases);
    expect(t.generatedFrom).toBe('searchProvenance');
  });

  it('the table dates come from the execution record, not a settings field', () => {
    const project = { search: { dbs: { Cinahl: true }, date: '2020-01-01' } };
    const t = buildSearchStrategyTable(project, { searchProvenance: prov });
    // The stale checkbox database is gone; the recorded dates are used.
    expect(t.rows.map((r) => r.database)).not.toContain('Cinahl');
    expect(t.rows.find((r) => r.database === 'PubMed').date).toContain('2026-01-10');
  });

  it('falls back to the checkbox list for a project with no provenance at all', () => {
    const project = { search: { dbs: { PubMed: true, Embase: true }, date: '2020-01-01' } };
    const t = buildSearchStrategyTable(project, {});
    expect(t.rows.map((r) => r.database).sort()).toEqual(['Embase', 'PubMed']);
    expect(t.generatedFrom).toBe('search');
  });
});

/* ═══════════════ cross-system validation ═══════════════ */

describe('PRISMA and the manuscript must describe the same review', () => {
  const rec = (i, o = {}) => ({ id: `r${i}`, origin: 'search', sourceDb: 'PubMed', ...o });

  it('flags a source PRISMA counts but the manuscript never reports', () => {
    const flow = derivePrismaFlow([
      rec(1), rec(2, { sourceDb: 'Scopus' }), rec(3, { sourceDb: 'Scopus' }),
    ]);
    const m = methodologyOf({ runs: [run('pubmed', '2026-01-10T09:00:00Z')] });
    const check = checkPrismaConsistency(m, flow);
    expect(check.ok).toBe(false);
    const err = check.issues.find((i) => i.severity === 'error');
    expect(err.message).toMatch(/Scopus/);
    expect(err.message).toMatch(/does not report searching it/);
  });

  it('is quiet when the two agree — even across label spellings', () => {
    // PRISMA rows carry raw record text ('pubmed'); provenance carries the
    // canonical label. Comparing display strings would cry wolf here.
    const flow = derivePrismaFlow([rec(1, { sourceDb: 'pubmed' }), rec(2, { sourceDb: 'PubMed' })]);
    const m = methodologyOf({ runs: [run('pubmed', '2026-01-10T09:00:00Z')] });
    expect(checkPrismaConsistency(m, flow).ok).toBe(true);
  });

  it('warns (not errors) when a reported database contributed no records', () => {
    const flow = derivePrismaFlow([rec(1, { sourceDb: 'PubMed' })]);
    const m = methodologyOf({
      runs: [run('pubmed', '2026-01-10T09:00:00Z'), run('embase', '2026-01-10T09:00:00Z')],
    });
    const check = checkPrismaConsistency(m, flow);
    expect(check.ok).toBe(true); // still publishable — a search CAN return nothing
    expect(check.issues.some((i) => i.severity === 'warning' && /Embase/.test(i.message))).toBe(true);
  });

  it('does not claim to have checked when there is no flow to check against', () => {
    const m = methodologyOf({ runs: [run('pubmed', '2026-01-10T09:00:00Z')] });
    expect(checkPrismaConsistency(m, null).checked).toBe(false);
  });

  it('ignores unattributed records rather than inventing a contradiction', () => {
    const flow = derivePrismaFlow([rec(1, { sourceDb: '' }), rec(2, { sourceDb: 'PubMed' })]);
    const m = methodologyOf({ runs: [run('pubmed', '2026-01-10T09:00:00Z')] });
    expect(checkPrismaConsistency(m, flow).ok).toBe(true);
  });
});
