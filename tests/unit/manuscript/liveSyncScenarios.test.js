/**
 * 101.md §37 — the workflow scenarios the brief asks to be covered, exercised
 * end-to-end at the engine level (search provenance → facts → manuscript text →
 * provenance log → revert).
 *
 * These are the tests that would catch a SILENT INCONSISTENCY, which §37 calls out
 * as the dangerous failure mode: text that looks confident and is wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveFacts, renderFacts, findFactTokens, reconcileFacts, groupChanges,
} from '../../../src/research-engine/manuscript/index.js';
import { deriveSearchProvenance } from '../../../src/research-engine/search/searchProvenance.js';
import { deriveRobUsage, robToolsPhrase } from '../../../src/research-engine/rob/usage.js';
import { generateMethods } from '../../../src/research-engine/manuscript/draft.js';
import { buildMethodsMarkdown } from '../../../src/research-engine/docs/methodsText.js';

const source = (provider, o = {}) => ({
  provider, state: 'completed', rawCount: 25, importedCount: 25,
  completedAt: '2026-07-01T10:00:00.000Z', ...o,
});

const PROJECT = { pico: {}, studies: [] };

/** Render the manuscript sentence + reconcile in one step, like the editor does. */
function step(draft, provenance, md, nowIso, event) {
  const facts = resolveFacts(PROJECT, { searchProvenance: provenance });
  const used = findFactTokens(md).map((t) => t.key);
  const r = reconcileFacts(draft, facts, { usedKeys: used, nowIso, event });
  return { ...r, text: renderFacts(md, facts), facts };
}

const MD = 'We searched [[fact:search.databases]] [[fact:search.dateRange]].';

describe('§37 — search scenario', () => {
  it('PubMed+Embase on July 1, then a manual Scopus search on August 6', () => {
    // 1-2. Two databases searched on July 1; the manuscript states them.
    const july = deriveSearchProvenance({
      runs: [{ id: 'r1', sources: [source('pubmed'), source('embase')] }],
    });
    let s = step({ sections: {} }, july, MD, '2026-07-01T12:00:00.000Z');
    expect(s.text).toBe('We searched Embase and PubMed from inception to July 1, 2026.');
    expect(s.changes).toEqual([]); // first observation is not a change (§38)

    // 3-4. The researcher manually searches Scopus and imports the records.
    const august = deriveSearchProvenance({
      runs: [{ id: 'r1', sources: [source('pubmed'), source('embase')] }],
      imports: [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', databases: [{ name: 'Scopus', count: 41 }] }],
    });
    s = step(s.draft, august, MD, '2026-08-06T09:05:00.000Z', {
      id: 77, eventType: 'SEARCH_RESULTS_IMPORTED', correlationId: 'c-1',
      actorName: 'A. Researcher', reason: 'Scopus records imported',
    });

    // 5. The manuscript updated its databases AND its date — with no refresh action.
    expect(s.text).toBe('We searched Embase, PubMed, and Scopus from inception to August 6, 2026.');

    // 7. Show Changes can attribute both to the Search Engine.
    expect(s.changes.every((c) => c.engine === 'search')).toBe(true);
    // 8. Hover metadata carries the before/after and the reason.
    const byKey = Object.fromEntries(s.changes.map((c) => [c.key, c]));
    expect(byKey['search.databases'].from).toBe('Embase and PubMed');
    expect(byKey['search.databases'].to).toBe('Embase, PubMed, and Scopus');
    expect(byKey['search.dateRange'].reason).toBe('Scopus records imported');
    // 14. Both land in ONE group, not two notifications.
    expect(groupChanges(s.draft.factLog)).toHaveLength(1);
  });
});

describe('§37 — no-impact search scenario', () => {
  it('changing a search term without executing leaves the manuscript untouched', () => {
    // The search STRATEGY is project state; the manuscript's databases/date come
    // from the EXECUTION record, so editing a term cannot move them.
    const executed = deriveSearchProvenance({ runs: [{ id: 'r1', sources: [source('pubmed')] }] });
    let s = step({ sections: {} }, executed, MD, 'T1');
    const textBefore = s.text;

    // The researcher edits a term and does not run the search: the provenance
    // input is IDENTICAL because no new run exists.
    s = step(s.draft, executed, MD, 'T2');
    expect(s.text).toBe(textBefore);
    expect(s.changes).toEqual([]);
  });

  it('a failed test search never enters the manuscript', () => {
    const withFailure = deriveSearchProvenance({
      runs: [
        { id: 'r1', sources: [source('pubmed')] },
        { id: 'r2', sources: [source('scopus', { state: 'failed', completedAt: '2026-08-06T10:00:00.000Z', errorClass: 'PROVIDER_UNAVAILABLE' })] },
      ],
    });
    const s = step({ sections: {} }, withFailure, MD, 'T1');
    expect(s.text).not.toContain('Scopus');
    expect(s.text).toContain('July 1, 2026'); // the date did not jump to the failed attempt
  });
});

describe('§37 — repeated search with zero new records', () => {
  it('updates the search date but reports the database as searched', () => {
    const first = deriveSearchProvenance({ runs: [{ id: 'r1', sources: [source('pubmed')] }] });
    let s = step({ sections: {} }, first, MD, 'T1');
    expect(s.text).toContain('July 1, 2026');

    // Re-run on August 6 returning NOTHING new. It is still a real search.
    const rerun = deriveSearchProvenance({
      runs: [
        { id: 'r1', sources: [source('pubmed')] },
        { id: 'r2', sources: [source('pubmed', { rawCount: 0, importedCount: 0, completedAt: '2026-08-06T10:00:00.000Z' })] },
      ],
    });
    s = step(s.draft, rerun, MD, 'T2', { id: 9, eventType: 'SEARCH_RERUN', correlationId: 'c-2' });

    // The date moves...
    expect(s.text).toContain('August 6, 2026');
    // ...and the database list does NOT, so nothing downstream of the roster is
    // disturbed by a zero-result re-run.
    expect(s.text).toContain('PubMed');
    expect(s.changes.map((c) => c.key)).toEqual(['search.dateRange']);
  });
});

describe('§37 — the manuscript never states more than the project knows', () => {
  it('an empty project makes no methodological claims at all', () => {
    const md = buildMethodsMarkdown({
      projectName: 'Empty', prisma: {}, screening: {}, robUsage: deriveRobUsage([]),
    });
    expect(md).not.toMatch(/independent reviewers/);
    expect(md).not.toMatch(/Disagreements were resolved by discussion/);
    expect(md).toContain('[not recorded — please complete]');
  });

  it('states the reviewer workflow only when the project records one', () => {
    const one = buildMethodsMarkdown({ prisma: {}, screening: { reviewers: 1 } });
    expect(one).toContain('by a single reviewer');
    expect(one).not.toMatch(/independent reviewers/);

    const two = buildMethodsMarkdown({
      prisma: {}, screening: { reviewers: 2, conflictResolution: 'consensus' },
    });
    expect(two).toContain('by 2 independent reviewers');
    expect(two).toContain('Disagreements were resolved by consensus');
  });

  it('flags an unrecorded conflict process for a two-reviewer project', () => {
    const md = buildMethodsMarkdown({ prisma: {}, screening: { reviewers: 2 } });
    // Two reviewers but no recorded resolution process → ask, never assume.
    expect(md).toContain('Disagreement resolution: [not recorded — please complete]');
  });
});

describe('§37 / §27 — risk-of-bias tools reflect actual usage', () => {
  it('names only instruments with completed assessments', () => {
    const usage = deriveRobUsage([
      { instrumentId: 'RoB2', status: 'complete', studyId: 's1' },
      { instrumentId: 'NOS', status: 'complete', studyId: 's2' },
      { instrumentId: 'QUADAS-2', status: 'draft', studyId: 's3' },
    ]);
    const phrase = robToolsPhrase(usage);
    expect(phrase).toContain('RoB 2');
    expect(phrase).toContain('Newcastle–Ottawa');
    expect(phrase).not.toContain('QUADAS');
  });

  it('does not claim the selected tool was used when nothing was assessed', () => {
    const md = buildMethodsMarkdown({
      prisma: {}, screening: {}, robTool: 'Cochrane RoB 2', robUsage: deriveRobUsage([]),
    });
    expect(md).toContain('no assessment has been completed');
  });

  it('describes a multi-instrument review per study design (§27)', () => {
    const usage = deriveRobUsage([
      { instrumentId: 'RoB2', status: 'complete', studyId: 's1' },
      { instrumentId: 'ROBINS-I', status: 'complete', studyId: 's2' },
      { instrumentId: 'NOS', status: 'complete', studyId: 's3' },
    ]);
    const md = buildMethodsMarkdown({ prisma: {}, screening: {}, robUsage: usage });
    expect(md).toContain('the instrument appropriate to each study design');
    expect(md).toContain('randomised trials');
    expect(md).toContain('non-randomised studies of interventions');
    expect(md).toContain('cohort studies');
  });

  it('counts a study assessed by two reviewers once, not twice (§25)', () => {
    const usage = deriveRobUsage([
      { instrumentId: 'NOS', status: 'complete', studyId: 's1', reviewerId: 'u1' },
      { instrumentId: 'NOS', status: 'complete', studyId: 's1', reviewerId: 'u2' },
      { instrumentId: 'NOS', status: 'consensus', studyId: 's1', reviewerId: 'u3' },
    ]);
    expect(usage.tools[0].count).toBe(1);
    expect(usage.assessedCount).toBe(1);
  });
});

describe('§16 — no partial states across the manuscript', () => {
  it('all counts in one render come from one snapshot', () => {
    const project = { pico: {}, studies: [{ id: 'a', es: 1 }, { id: 'b', es: 2 }] };
    const facts = resolveFacts(project, {});
    // Results, Abstract and the roster all read the SAME resolved object, so the
    // "Results says 12, PRISMA says 13, forest plot says 11" failure §16 describes
    // cannot arise from the fact layer.
    const md = 'Results: [[fact:studies.included]]. Abstract: [[fact:studies.included]]. Synthesis: [[fact:studies.inAnalysis]].';
    const out = renderFacts(md, facts);
    const included = out.match(/Results: (\d+)/)[1];
    const abstract = out.match(/Abstract: (\d+)/)[1];
    expect(included).toBe(abstract);
  });
});

describe('§4/§42 — the generator emits LIVE tokens, not frozen text', () => {
  it('generated Methods carries fact tokens when the caller opts in', () => {
    const project = { name: 'T', pico: { question: 'Q' }, studies: [], search: {} };
    const prov = deriveSearchProvenance({
      runs: [{ id: 'r1', sources: [source('pubmed'), source('embase')] }],
    });
    const md = generateMethods(project, {
      factTokens: true, searchProvenance: prov,
      screening: { identified: 412, afterDedup: 300, screened: 300, included: 12 },
    });
    const keys = findFactTokens(md).map((t) => t.key);
    expect(keys).toContain('search.databases');
    expect(keys).toContain('search.date');
    expect(keys).toContain('prisma.included');
  });

  it('the SAME stored markdown re-renders after a later search — no regeneration', () => {
    const project = { name: 'T', pico: {}, studies: [], search: {} };
    const july = deriveSearchProvenance({ runs: [{ id: 'r1', sources: [source('pubmed'), source('embase')] }] });
    // Generated ONCE, in July, and never touched again.
    const stored = generateMethods(project, { factTokens: true, searchProvenance: july });
    const line = stored.split('\n').find((l) => /We searched/.test(l));

    expect(renderFacts(line, resolveFacts(project, { searchProvenance: july })))
      .toContain('Embase and PubMed');

    const august = deriveSearchProvenance({
      runs: [{ id: 'r1', sources: [source('pubmed'), source('embase')] }],
      imports: [{ id: 'b1', createdAt: '2026-08-06T09:00:00.000Z', databases: [{ name: 'Scopus', count: 41 }] }],
    });
    const after = renderFacts(line, resolveFacts(project, { searchProvenance: august }));
    expect(after).toContain('Scopus');
    expect(after).toContain('August 6, 2026');
  });

  it('legacy generation (flag off) is unchanged and emits no tokens', () => {
    const project = { name: 'T', pico: {}, studies: [], search: {} };
    const prov = deriveSearchProvenance({ runs: [{ id: 'r1', sources: [source('pubmed')] }] });
    const md = generateMethods(project, { searchProvenance: prov });
    expect(findFactTokens(md)).toEqual([]);
    expect(md).toContain('PubMed');
  });

  it('does not tokenize a count the project does not have (§17)', () => {
    // An unknown PRISMA count must stay absent, not become a token that renders a
    // placeholder reading like a pending value.
    const md = generateMethods({ name: 'T', pico: {}, studies: [], search: {} }, { factTokens: true });
    expect(findFactTokens(md).map((t) => t.key)).not.toContain('prisma.identified');
  });
});
