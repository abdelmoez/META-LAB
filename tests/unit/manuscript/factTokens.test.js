/**
 * 101.md §5/§8/§9/§10/§14/§17/§38 — the live fact layer.
 *
 * The whole design claim being pinned here is: the manuscript's FACTS can change
 * without any of its PROSE changing, because only the inside of a token is ever
 * touched. These tests assert that property directly, plus the honesty rules
 * (nothing is ever invented) and the provenance/revert behaviour built on top.
 */
import { describe, it, expect } from 'vitest';
import {
  FACT_TOKEN_RE, FACT_KEYS, FACTS, FACT_ENGINE_IDS,
  factToken, factMeta, findFactTokens, resolveFacts, renderFacts, factPlaceholder,
  formatFactDate, numberWord, joinList,
  factsForDependencyKey, factsForDependencyKeys,
  reconcileFacts, groupChanges, describeChange,
  overrideFact, clearFactOverride, factDiscrepancies, markChangeReverted,
  CITATION_TOKEN_RE, ASSET_TOKEN_RE, DEPENDENCY_KEYS,
} from '../../../src/research-engine/manuscript/index.js';
import { deriveSearchProvenance } from '../../../src/research-engine/search/searchProvenance.js';

const src = (provider, o = {}) => ({
  provider, state: 'completed', rawCount: 10, importedCount: 10,
  completedAt: '2026-07-01T10:00:00.000Z', ...o,
});

const provenanceWith = (providers, imports = []) => deriveSearchProvenance({
  runs: [{ id: 'r1', completedAt: '2026-07-01T10:00:00.000Z', sources: providers.map((p) => src(p)) }],
  imports,
});

const PROJECT = { pico: { prosperoId: 'CRD42026123456' }, studies: [{ id: 's1', es: 0.2 }, { id: 's2', es: 0.3 }, { id: 's3' }] };

describe('token grammar', () => {
  it('builds and finds fact tokens', () => {
    expect(factToken('search.date')).toBe('[[fact:search.date]]');
    const found = findFactTokens('We searched [[fact:search.databases]] to [[fact:search.date]].');
    expect(found.map((f) => f.key)).toEqual(['search.databases', 'search.date']);
    expect(found.every((f) => f.known)).toBe(true);
  });

  it('never collides with the citation or asset token grammars, in either direction', () => {
    const fact = '[[fact:search.date]]';
    const cite = '[[cite:ref_1]]';
    const asset = '[[table:study]]';
    expect(new RegExp(FACT_TOKEN_RE.source).test(cite)).toBe(false);
    expect(new RegExp(FACT_TOKEN_RE.source).test(asset)).toBe(false);
    expect(new RegExp(CITATION_TOKEN_RE.source).test(fact)).toBe(false);
    expect(new RegExp(ASSET_TOKEN_RE.source).test(fact)).toBe(false);
  });

  it('flags an unknown key rather than treating it as a fact', () => {
    const found = findFactTokens('[[fact:not.a.real.fact]]');
    expect(found[0].known).toBe(false);
  });
});

describe('the registry is coherent', () => {
  it('every fact declares a real dependency key and a real engine', () => {
    for (const key of FACT_KEYS) {
      const m = FACTS[key];
      expect(DEPENDENCY_KEYS[m.depKey], `${key} depKey`).toBeTruthy();
      expect(FACT_ENGINE_IDS, `${key} engine`).toContain(m.engine);
      expect(typeof m.resolve).toBe('function');
      expect(m.label.length).toBeGreaterThan(0);
    }
  });

  it('maps a dependency key to exactly the facts it can change (§15 targeting)', () => {
    expect(factsForDependencyKey('search.date')).toEqual(expect.arrayContaining(['search.date', 'search.dateRange']));
    expect(factsForDependencyKey('search.databases')).toEqual(expect.arrayContaining(['search.databases', 'search.databaseCount']));
    // an event touching only the search date must NOT mark the database list changed
    expect(factsForDependencyKeys(['search.date'])).not.toContain('search.databases');
  });
});

describe('§17 — nothing is ever invented', () => {
  it('resolves search facts ONLY from execution provenance', () => {
    // A project with databases ticked in settings but nothing executed.
    const configuredOnly = deriveSearchProvenance({ configured: ['pubmed', 'embase'], runs: [] });
    const f = resolveFacts(PROJECT, { searchProvenance: configuredOnly });
    expect(f['search.databases'].missing).toBe(true);
    expect(f['search.date'].missing).toBe(true);
  });

  it('resolves every search fact as MISSING when no provenance is supplied at all', () => {
    const f = resolveFacts(PROJECT, {});
    expect(f['search.databases'].missing).toBe(true);
    expect(f['search.date'].missing).toBe(true);
  });

  it('renders a visible placeholder, never a blank or a zero', () => {
    const f = resolveFacts(PROJECT, {});
    const out = renderFacts('Searched [[fact:search.databases]].', f);
    expect(out).toContain('not yet available');
    expect(out).not.toContain('[[fact:');
  });

  it('never renders an unknown PRISMA count as 0', () => {
    // Number(null) === 0; a naive resolver would claim "0 records identified".
    const f = resolveFacts({ pico: {}, studies: [] }, {});
    expect(f['prisma.identified'].missing).toBe(true);
    expect(f['prisma.identified'].raw).toBe(null);
    expect(renderFacts('[[fact:prisma.identified]]', f)).not.toBe('0');
  });

  it('degrades an unknown token to a placeholder instead of leaking raw syntax', () => {
    const out = renderFacts('[[fact:no.such.fact]]', {});
    expect(out).not.toContain('[[fact:');
    expect(out).toContain('no.such.fact');
  });
});

describe('deterministic formatting', () => {
  it('formats dates as the brief does, in UTC so co-authors see one date', () => {
    expect(formatFactDate('2026-08-06T09:00:00.000Z')).toBe('August 6, 2026');
    expect(formatFactDate('2026-07-01T23:59:59.000Z')).toBe('July 1, 2026');
    expect(formatFactDate('nonsense')).toBe('');
    expect(formatFactDate(null)).toBe('');
  });

  it('spells small numbers and joins lists grammatically', () => {
    expect(numberWord(3)).toBe('three');
    expect(numberWord(4)).toBe('four');
    expect(numberWord(20)).toBe('20');
    expect(joinList(['A'])).toBe('A');
    expect(joinList(['A', 'B'])).toBe('A and B');
    expect(joinList(['A', 'B', 'C'])).toBe('A, B, and C');
  });
});

describe('§5 — facts update without touching prose', () => {
  it('changes only the fact, leaving the researcher sentence byte-identical', () => {
    const humanSentence = 'These findings suggest that the intervention may be especially useful in high-risk populations.';
    const md = `We searched [[fact:search.databases]] to [[fact:search.date]]. ${humanSentence}`;

    const before = renderFacts(md, resolveFacts(PROJECT, { searchProvenance: provenanceWith(['pubmed', 'embase']) }));
    const after = renderFacts(md, resolveFacts(PROJECT, {
      searchProvenance: provenanceWith(['pubmed', 'embase'], [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', databases: [{ name: 'Scopus', count: 41 }] }]),
    }));

    expect(before).not.toBe(after);              // the facts moved
    expect(before).toContain(humanSentence);     // ...and the prose did not
    expect(after).toContain(humanSentence);
    expect(after).toContain('Scopus');
    expect(before).not.toContain('Scopus');
  });
});

describe('§8 — showing what changed', () => {
  const md = '[[fact:search.databaseCountWord]] databases were searched [[fact:search.dateRange]].';
  const used = findFactTokens(md).map((t) => t.key);
  const july = () => resolveFacts(PROJECT, { searchProvenance: provenanceWith(['pubmed', 'embase', 'webofscience']) });
  const august = () => resolveFacts(PROJECT, {
    searchProvenance: provenanceWith(['pubmed', 'embase', 'webofscience'], [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', databases: [{ name: 'Scopus', count: 41 }] }]),
  });

  it('reproduces the brief\'s worked example exactly', () => {
    let draft = { sections: {} };
    draft = reconcileFacts(draft, july(), { usedKeys: used, nowIso: '2026-07-01T12:00:00.000Z' }).draft;
    expect(renderFacts(md, july())).toBe('three databases were searched from inception to July 1, 2026.');

    const r = reconcileFacts(draft, august(), {
      usedKeys: used,
      nowIso: '2026-08-06T09:05:00.000Z',
      event: { id: 412, eventType: 'SEARCH_RESULTS_IMPORTED', correlationId: 'c-77', actorName: 'A. Researcher', reason: 'Scopus search executed and imported' },
    });

    expect(renderFacts(md, august())).toBe('four databases were searched from inception to August 6, 2026.');
    const byKey = Object.fromEntries(r.changes.map((c) => [c.key, c]));
    expect(byKey['search.databaseCountWord'].from).toBe('three');
    expect(byKey['search.databaseCountWord'].to).toBe('four');
    expect(byKey['search.dateRange'].from).toContain('July 1, 2026');
    expect(byKey['search.dateRange'].to).toContain('August 6, 2026');
    expect(byKey['search.dateRange'].engine).toBe('search');
  });

  it('exposes the §9 hover-card fields', () => {
    let draft = reconcileFacts({ sections: {} }, july(), { usedKeys: used, nowIso: '2026-07-01T12:00:00.000Z' }).draft;
    const r = reconcileFacts(draft, august(), {
      usedKeys: used, nowIso: '2026-08-06T09:05:00.000Z',
      event: { id: 412, eventType: 'SEARCH_RESULTS_IMPORTED', correlationId: 'c-77', actorName: 'A. Researcher', reason: 'Updated PubMed and Embase searches executed' },
    });
    const card = describeChange(r.changes[0], { sections: ['methods'] });
    expect(card.updatedBy).toBe('Search Engine');
    expect(card.changedAt).toBe('2026-08-06T09:05:00.000Z');
    expect(card.reason).toBe('Updated PubMed and Embase searches executed');
    expect(card.previousValue).toBeTruthy();
    expect(card.currentValue).toBeTruthy();
    expect(card.field).toBeTruthy();
  });

  it('tracks only the facts the manuscript actually uses', () => {
    // The project changed a hundred things; the manuscript states two of them.
    const r = reconcileFacts({ sections: {} }, july(), { usedKeys: ['search.date'], nowIso: 'T' });
    expect(Object.keys(r.draft.factState)).toEqual(['search.date']);
  });
});

describe('§38 — honest migration', () => {
  it('records the first observation without inventing a change', () => {
    const f = resolveFacts(PROJECT, { searchProvenance: provenanceWith(['pubmed']) });
    const r = reconcileFacts({ sections: {} }, f, { usedKeys: ['search.date'], nowIso: 'T1' });
    expect(r.changes).toEqual([]);
    expect(r.group).toBe(null);
    expect(r.draft.factState['search.date'].value).toBeTruthy();
  });

  it('does not report a transition into "missing" as a change', () => {
    const known = resolveFacts(PROJECT, { searchProvenance: provenanceWith(['pubmed']) });
    let draft = reconcileFacts({ sections: {} }, known, { usedKeys: ['search.date'], nowIso: 'T1' }).draft;
    // provenance temporarily unavailable (a fetch blip) must not read as a deletion
    const blip = resolveFacts(PROJECT, {});
    const r = reconcileFacts(draft, blip, { usedKeys: ['search.date'], nowIso: 'T2' });
    expect(r.changes).toEqual([]);
    expect(r.draft.factState['search.date'].value).toBeTruthy();
  });
});

describe('§14 — grouping one research action', () => {
  it('collapses everything one action moved into a single entry', () => {
    const md = '[[fact:search.databases]] [[fact:search.databaseCount]] [[fact:search.date]] [[fact:search.dateRange]]';
    const used = findFactTokens(md).map((t) => t.key);
    const before = resolveFacts(PROJECT, { searchProvenance: provenanceWith(['pubmed']) });
    const after = resolveFacts(PROJECT, {
      searchProvenance: provenanceWith(['pubmed'], [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', databases: [{ name: 'Scopus', count: 4 }] }]),
    });
    let draft = reconcileFacts({ sections: {} }, before, { usedKeys: used, nowIso: 'T1' }).draft;
    const r = reconcileFacts(draft, after, {
      usedKeys: used, nowIso: 'T2',
      event: { id: 9, correlationId: 'c-1', eventType: 'SEARCH_RESULTS_IMPORTED' },
      groupLabel: 'Updated literature search — August 6, 2026',
    });
    expect(r.changes.length).toBe(4);
    expect(r.group.count).toBe(4);
    expect(r.group.label).toBe('Updated literature search — August 6, 2026');
    // one panel entry, not four notifications
    expect(groupChanges(r.draft.factLog)).toHaveLength(1);
  });
});

describe('§10 — reverting manuscript wording', () => {
  const md = 'Searched [[fact:search.dateRange]].';
  const august = resolveFacts(PROJECT, {
    searchProvenance: provenanceWith(['pubmed'], [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', databases: [{ name: 'Scopus', count: 4 }] }]),
  });

  it('pins the previous wording without changing project data', () => {
    const { draft, override } = overrideFact({ sections: {} }, 'search.dateRange', 'from inception to July 1, 2026', {
      nowIso: 'T3', by: 'A. Researcher', reason: 'August search was exploratory only',
      projectValue: august['search.dateRange'].raw,
    });
    expect(override.value).toContain('July 1, 2026');
    const overrides = Object.fromEntries(Object.entries(draft.factOverrides).map(([k, v]) => [k, v.value]));
    expect(renderFacts(md, august, { overrides })).toContain('July 1, 2026');
    // the PROJECT still says August — reverting wording must not falsify the record
    expect(august['search.dateRange'].raw).toContain('August 6, 2026');
  });

  it('reports the resulting discrepancy so it can be communicated clearly', () => {
    const { draft } = overrideFact({ sections: {} }, 'search.dateRange', 'from inception to July 1, 2026', {
      nowIso: 'T3', by: 'A. Researcher', reason: 'exploratory only',
    });
    const d = factDiscrepancies(draft, august);
    expect(d).toHaveLength(1);
    expect(d[0].manuscriptValue).toContain('July 1, 2026');
    expect(d[0].projectValue).toContain('August 6, 2026');
    expect(d[0].reason).toBe('exploratory only');
  });

  it('clearing the pin re-synchronises the fact', () => {
    const { draft } = overrideFact({ sections: {} }, 'search.dateRange', 'X', { nowIso: 'T' });
    const { draft: cleared, cleared: ok } = clearFactOverride(draft, 'search.dateRange');
    expect(ok).toBe(true);
    expect(cleared.factOverrides).toBeUndefined();
    expect(factDiscrepancies(cleared, august)).toEqual([]);
  });

  it('marks a reverted change instead of deleting it (§12)', () => {
    const before = resolveFacts(PROJECT, { searchProvenance: provenanceWith(['pubmed']) });
    let draft = reconcileFacts({ sections: {} }, before, { usedKeys: ['search.dateRange'], nowIso: 'T1' }).draft;
    const r = reconcileFacts(draft, august, { usedKeys: ['search.dateRange'], nowIso: 'T2' });
    const { draft: marked, marked: ok } = markChangeReverted(r.draft, r.changes[0].id, { nowIso: 'T3', by: 'A. Researcher' });
    expect(ok).toBe(true);
    expect(marked.factLog[0].reverted).toBe(true);
    expect(marked.factLog).toHaveLength(1); // still there — provenance never disappears
  });
});

describe('§16 — one snapshot, no contradictions', () => {
  it('every fact in a render resolves from the same project state', () => {
    const f = resolveFacts(PROJECT, { searchProvenance: provenanceWith(['pubmed', 'embase']) });
    expect(f['search.databaseCount'].raw).toBe('2');
    expect(f['search.databaseCountWord'].raw).toBe('two');
    expect(f['search.databases'].raw.split(' and ')).toHaveLength(2);
  });
});
