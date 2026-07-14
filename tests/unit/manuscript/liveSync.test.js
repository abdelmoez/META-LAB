/**
 * 84.md — live project-synchronization ENGINE tests. Covers the dependency graph,
 * the safe sync/review workflow, contradiction + missing-info detection, snapshots,
 * freshness rollup, and the additive normalizeDraft preservation (with the legacy
 * byte-compat guarantee). All engine imports come from the public barrel.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDependencyState, sectionDepState, diffDeps, explainKeys, DEPENDENCY_KEYS,
  buildSyncPlan, applySyncDecision, sectionSyncState,
  detectContradictions, collectMissingInfo, resolveAtFor,
  createSnapshot, restoreSnapshot, removeSnapshot, diffSnapshot,
  computeFreshness, perSectionStatus, collectEngineVersions,
  generateDraft, computeSectionInputsHashes,
  makeManuscriptDraft, normalizeDraft, SECTION_IDS,
} from '../../../src/research-engine/manuscript/index.js';
import { computeOutdatedSections } from '../../../src/features/manuscript/manuscriptState.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function baseProject() {
  return {
    id: 'p1',
    name: 'Statins for primary prevention',
    pico: { question: 'Do statins reduce CV events?', P: 'Adults', I: 'Statins', C: 'Placebo', O: 'MACE', prosperoId: 'CRD42024000001' },
    search: { dbs: { PubMed: true, Embase: true }, date: '2026-01-15', string: '(statin*)' },
    prisma: {},
    robMethod: 'RoB2',
    studies: [
      { id: 's1', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', rob: { D1: 'Low' } },
      { id: 's2', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06' },
      { id: 's3', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05' },
    ],
  };
}

/** Build a draft as if generated from `project` under `opts` (deterministic, no clock). */
function draftFrom(project, opts = {}) {
  const gen = generateDraft(project, opts);
  const base = makeManuscriptDraft();
  for (const id of SECTION_IDS) {
    base.sections[id] = {
      ...base.sections[id],
      content: gen[id],
      aiGenerated: true,
      userEdited: false,
      inputsHash: gen.sectionMeta[id].inputsHash,
      depState: gen.sectionMeta[id].depState,
    };
  }
  return base;
}

/* ── dependency graph ─────────────────────────────────────────────────────── */

describe('computeDependencyState / diffDeps', () => {
  it('is deterministic for identical (project, opts)', () => {
    const p = baseProject();
    expect(computeDependencyState(p, {})).toEqual(computeDependencyState(p, {}));
  });
  it('changing tau2Method changes analysis.tau2 and affects methods/results/abstract but not introduction', () => {
    const p1 = baseProject();
    const p2 = baseProject(); p2.analysisSettings = { tau2Method: 'REML' };
    const s1 = computeDependencyState(p1, {});
    const s2 = computeDependencyState(p2, {});
    expect(s2['analysis.tau2']).not.toBe(s1['analysis.tau2']);
    expect(s2['pico.question']).toBe(s1['pico.question']); // unrelated key stable

    for (const id of ['methods', 'results', 'abstract']) {
      expect(diffDeps(sectionDepState(id, s1), s2, id)).toContain('analysis.tau2');
    }
    expect(diffDeps(sectionDepState('introduction', s1), s2, 'introduction')).toEqual([]);
  });
  it('an empty/absent stored depState yields no reasons (unknown, never faked)', () => {
    const fresh = computeDependencyState(baseProject(), {});
    expect(diffDeps({}, fresh, 'methods')).toEqual([]);
    expect(diffDeps(undefined, fresh, 'methods')).toEqual([]);
  });
  it('explainKeys decorates with label + category', () => {
    const [e] = explainKeys(['analysis.tau2']);
    expect(e.label).toBe(DEPENDENCY_KEYS['analysis.tau2'].label);
    expect(e.category).toBe('methods');
  });
});

/* ── sync plan ────────────────────────────────────────────────────────────── */

describe('buildSyncPlan', () => {
  function planAfterTau2Change(mutate) {
    const p1 = baseProject();
    const draft = draftFrom(p1, {});
    if (mutate) mutate(draft);
    const p2 = baseProject(); p2.analysisSettings = { tau2Method: 'REML' };
    const generated = generateDraft(p2, {});
    const freshHashes = computeSectionInputsHashes(p2, {});
    const freshDepState = computeDependencyState(p2, {});
    const outdated = computeOutdatedSections(draft, freshHashes);
    return buildSyncPlan({ project: p2, draft, generated, freshDepState, freshHashes, outdated });
  }

  it('flags an outdated section with reasons + category', () => {
    const plan = planAfterTau2Change();
    const methods = plan.entries.find((e) => e.sectionId === 'methods');
    expect(methods.outdated).toBe(true);
    expect(methods.reasons.map((r) => r.key)).toContain('analysis.tau2');
    expect(methods.category).toBe('methods');
    expect(plan.counts.outdated).toBeGreaterThan(0);
  });
  it('a user-edited outdated section counts as a conflict and cannot auto-apply', () => {
    const plan = planAfterTau2Change((d) => { d.sections.methods.userEdited = true; });
    const methods = plan.entries.find((e) => e.sectionId === 'methods');
    expect(methods.syncState).toBe('edited');
    expect(methods.canAutoApply).toBe(false);
    expect(plan.counts.conflicts).toBeGreaterThan(0);
  });
  it('a locked section never auto-applies', () => {
    const plan = planAfterTau2Change((d) => { d.sections.abstract.locked = true; });
    const abstract = plan.entries.find((e) => e.sectionId === 'abstract');
    expect(abstract.locked).toBe(true);
    expect(abstract.canAutoApply).toBe(false);
  });
  it('interpretive sections (discussion) never auto-apply', () => {
    const plan = planAfterTau2Change();
    const disc = plan.entries.find((e) => e.sectionId === 'discussion');
    expect(disc.interpretive).toBe(true);
    expect(disc.canAutoApply).toBe(false);
  });
  it('sectionSyncState reflects lock/detach/edit/approve precedence', () => {
    expect(sectionSyncState({ locked: true, userEdited: true })).toBe('locked');
    expect(sectionSyncState({ detached: true })).toBe('detached');
    expect(sectionSyncState({ userEdited: true })).toBe('edited');
    expect(sectionSyncState({ approvedAt: 't' })).toBe('approved');
    expect(sectionSyncState({})).toBe('project');
  });
});

/* ── apply sync decision ──────────────────────────────────────────────────── */

describe('applySyncDecision', () => {
  function setup() {
    const draft = draftFrom(baseProject(), {});
    const p2 = baseProject(); p2.analysisSettings = { tau2Method: 'REML' };
    const generated = generateDraft(p2, {});
    const freshDepState = computeDependencyState(p2, {});
    const ctx = { generated, sectionMeta: generated.sectionMeta, freshDepState, nowIso: '2026-07-13T00:00:00Z' };
    return { draft, generated, freshDepState, ctx };
  }

  it('accept writes the proposed text, refreshes depState, and logs the decision', () => {
    const { draft, generated, freshDepState, ctx } = setup();
    const { draft: next, applied } = applySyncDecision(draft, 'methods', 'accept', ctx);
    expect(applied).toBe(true);
    expect(next.sections.methods.content).toBe(generated.methods);
    expect(next.sections.methods.aiGenerated).toBe(true);
    expect(next.sections.methods.userEdited).toBe(false);
    expect(next.sections.methods.depState).toEqual(sectionDepState('methods', freshDepState));
    expect(next.sections.methods.reviewedAt).toBe('2026-07-13T00:00:00Z');
    const last = next.syncLog[next.syncLog.length - 1];
    expect(last.action).toBe('accept');
    expect(last.sectionId).toBe('methods');
  });
  it('accept on a locked section is refused', () => {
    const { draft, ctx } = setup();
    const locked = { ...draft, sections: { ...draft.sections, methods: { ...draft.sections.methods, locked: true } } };
    const res = applySyncDecision(locked, 'methods', 'accept', ctx);
    expect(res.applied).toBe(false);
    expect(res.reason).toBe('locked');
    expect(res.draft).toBe(locked); // unchanged
  });
  it('keep preserves the text but stamps approvedAt + a fresh inputsHash', () => {
    const { draft, generated, ctx } = setup();
    const before = draft.sections.methods.content;
    const { draft: next } = applySyncDecision(draft, 'methods', 'keep', ctx);
    expect(next.sections.methods.content).toBe(before);
    expect(next.sections.methods.approvedAt).toBe('2026-07-13T00:00:00Z');
    expect(next.sections.methods.inputsHash).toBe(generated.sectionMeta.methods.inputsHash);
  });
  it('detach then relink round-trips', () => {
    const { draft, ctx } = setup();
    const d1 = applySyncDecision(draft, 'methods', 'detach', ctx).draft;
    expect(d1.sections.methods.detached).toBe(true);
    expect(d1.sections.methods.lastLinked).toBeTruthy();
    const d2 = applySyncDecision(d1, 'methods', 'relink', ctx).draft;
    expect(d2.sections.methods.detached).toBe(false);
  });
  it('the sync log is bounded to the last 100 entries', () => {
    const { draft, ctx } = setup();
    let d = draft;
    for (let i = 0; i < 130; i += 1) d = applySyncDecision(d, 'methods', 'keep', { ...ctx, nowIso: `t${i}` }).draft;
    expect(d.syncLog.length).toBe(100);
    expect(d.syncLog[d.syncLog.length - 1].at).toBe('t129');
  });
});

/* ── contradictions ───────────────────────────────────────────────────────── */

describe('detectContradictions', () => {
  const rrProject = () => { const p = baseProject(); p.studies.forEach((s) => { s.esType = 'RR'; }); return p; };
  const smdProject = () => { const p = baseProject(); p.studies.forEach((s) => { s.esType = 'SMD'; }); return p; };

  it('flags a fixed-effect claim against a random-effects configuration', () => {
    const d = makeManuscriptDraft();
    d.sections.methods.content = 'Effect sizes were pooled using a fixed-effect model.';
    const hit = detectContradictions(baseProject(), d, {}).find((i) => i.id === 'model-mismatch');
    expect(hit).toBeTruthy();
    expect(hit.severity).toBe('critical');
  });
  it('flags an included-study count that differs from the project', () => {
    const d = makeManuscriptDraft();
    d.sections.results.content = 'In total, 7 studies were included in the review.';
    const hit = detectContradictions(baseProject(), d, {}).find((i) => i.id === 'included-count');
    expect(hit).toBeTruthy();
    expect(hit.found).toBe(7);
    expect(hit.expected).toBe(3);
  });
  it('flags a dual-review claim when only one reviewer is recorded', () => {
    const d = makeManuscriptDraft();
    d.sections.methods.content = 'Two reviewers independently screened all records.';
    expect(detectContradictions(baseProject(), d, { reviewers: 1 }).find((i) => i.id === 'dual-review-claim')).toBeTruthy();
  });
  it('flags a measure named in prose that is not the pooled measure', () => {
    const d = makeManuscriptDraft();
    d.sections.results.content = 'The pooled odds ratio favoured the intervention.';
    const hit = detectContradictions(rrProject(), d, {}).find((i) => i.id.startsWith('measure-mismatch'));
    expect(hit).toBeTruthy();
    expect(hit.found).toBe('OR');
    expect(hit.expected).toBe('RR');
  });
  it('does NOT mistake "standardised mean difference" for an MD mismatch', () => {
    const d = makeManuscriptDraft();
    d.sections.methods.content = 'We pooled the standardised mean difference across studies.';
    const hits = detectContradictions(smdProject(), d, {}).filter((i) => i.id.startsWith('measure-mismatch'));
    expect(hits).toEqual([]);
  });
  it('returns [] when the relevant sections have no content', () => {
    expect(detectContradictions(baseProject(), makeManuscriptDraft(), {})).toEqual([]);
  });
});

/* ── missing information ──────────────────────────────────────────────────── */

describe('collectMissingInfo', () => {
  it('aggregates per-section gaps and adds project-level rules with resolveAt', () => {
    const info = collectMissingInfo(baseProject(), makeManuscriptDraft(), {});
    const byField = Object.fromEntries(info.map((i) => [i.field, i]));
    // project-level: analysis model never persisted, funding required by generic template
    expect(byField['analysisSettings.tau2Method'].resolveAt).toBe('analysis');
    expect(byField['statements.funding'].resolveAt).toBe('manuscript');
    // aggregated section gaps map through resolveAtFor
    expect(byField['searchMethodsText'].resolveAt).toBe('search');
    expect(byField['searchMethodsText'].sections).toContain('methods');
    expect(byField['reviewers'].resolveAt).toBe('screening');
    expect(byField['pico.incl'].resolveAt).toBe('protocol');
  });
  it('drops the funding prompt once the statement is filled', () => {
    const d = makeManuscriptDraft(); d.statements.funding = 'None.';
    const info = collectMissingInfo(baseProject(), d, {});
    expect(info.map((i) => i.field)).not.toContain('statements.funding');
  });
  it('resolveAtFor maps field prefixes to project stages', () => {
    expect(resolveAtFor('pico.question')).toBe('protocol');
    expect(resolveAtFor('search.date')).toBe('search');
    expect(resolveAtFor('rob')).toBe('rob');
    expect(resolveAtFor('pubBias')).toBe('analysis');
    expect(resolveAtFor('something-else')).toBe('manuscript');
  });
});

/* ── snapshots ────────────────────────────────────────────────────────────── */

describe('snapshots', () => {
  it('caps the history at 20', () => {
    let draft = makeManuscriptDraft();
    const p = baseProject();
    for (let i = 0; i < 25; i += 1) draft = createSnapshot(draft, p, { label: `v${i}`, nowIso: `2026-07-13T00:00:00Z-${i}` }).draft;
    expect(draft.snapshots.length).toBe(20);
    expect(draft.snapshots[draft.snapshots.length - 1].label).toBe('v24');
  });
  it('a snapshot records engine versions + resolved PRISMA counts', () => {
    const { snapshot } = createSnapshot(makeManuscriptDraft(), baseProject(), { label: 'v1', frozen: true, nowIso: '2026-07-13T00:00:00Z' });
    expect(snapshot.engineVersions).toEqual(collectEngineVersions());
    expect(snapshot.prismaCounts.included).toBe(3);
    expect(snapshot.frozen).toBe(true);
  });
  it('a frozen snapshot refuses removal unless forced', () => {
    const { draft, snapshot } = createSnapshot(makeManuscriptDraft(), baseProject(), { label: 'frozen', frozen: true, nowIso: '2026-07-13T00:00:00Z' });
    expect(removeSnapshot(draft, snapshot.id, {}).removed).toBe(false);
    expect(removeSnapshot(draft, snapshot.id, { force: true }).removed).toBe(true);
  });
  it('restore takes a safety backup first and marks restored sections user-edited', () => {
    let draft = makeManuscriptDraft();
    draft.sections.methods.content = 'Original methods.';
    const snap = createSnapshot(draft, baseProject(), { label: 'v1', nowIso: '2026-07-13T00:00:01Z' });
    draft = snap.draft;
    draft = { ...draft, sections: { ...draft.sections, methods: { ...draft.sections.methods, content: 'Edited methods.' } } };
    const before = draft.snapshots.length;
    const { draft: restored, restored: ok } = restoreSnapshot(draft, snap.snapshot.id, { nowIso: '2026-07-13T00:00:02Z' });
    expect(ok).toBe(true);
    expect(restored.sections.methods.content).toBe('Original methods.');
    expect(restored.sections.methods.userEdited).toBe(true);
    expect(restored.snapshots.length).toBe(before + 1);
    const safety = restored.snapshots.find((s) => s.label === 'Before restore');
    expect(safety.sections.methods.content).toBe('Edited methods.'); // captured CURRENT state
  });
  it('restore of an unknown id is a no-op', () => {
    const draft = makeManuscriptDraft();
    expect(restoreSnapshot(draft, 'nope', { nowIso: 't' })).toEqual({ draft, restored: false });
  });
  it('diffSnapshot flags changed sections only', () => {
    let draft = makeManuscriptDraft();
    draft.sections.methods.content = 'Original.';
    const { snapshot, draft: d1 } = createSnapshot(draft, baseProject(), { label: 'v1', nowIso: '2026-07-13T00:00:00Z' });
    const edited = { ...d1, sections: { ...d1.sections, methods: { ...d1.sections.methods, content: 'Changed.' } } };
    const diff = diffSnapshot(snapshot, edited);
    expect(diff.find((c) => c.sectionId === 'methods').changed).toBe(true);
    expect(diff.find((c) => c.sectionId === 'introduction').changed).toBe(false);
  });
});

/* ── freshness ────────────────────────────────────────────────────────────── */

describe('computeFreshness / perSectionStatus', () => {
  it('applies the status precedence critical > updates > missing-info > warnings > synced', () => {
    expect(computeFreshness({ availabilityKnown: false }).status).toBe('unknown');
    expect(computeFreshness({ contradictions: [{ severity: 'critical' }], outdated: { a: true }, missing: [1] }).status).toBe('critical');
    expect(computeFreshness({ outdated: { a: true }, missing: [1] }).status).toBe('updates');
    expect(computeFreshness({ staleBlocks: ['x'] }).status).toBe('updates');
    expect(computeFreshness({ missing: [1], contradictions: [{ severity: 'warn' }] }).status).toBe('missing-info');
    expect(computeFreshness({ contradictions: [{ severity: 'warn' }] }).status).toBe('warnings');
    expect(computeFreshness({}).status).toBe('synced');
  });
  it('perSectionStatus derives conflict / issue / locked / empty', () => {
    const draft = makeManuscriptDraft();
    draft.sections.methods.content = 'x'; draft.sections.methods.userEdited = true;
    draft.sections.results.content = 'y';
    draft.sections.abstract.content = 'z'; draft.sections.abstract.locked = true;
    const st = perSectionStatus(draft, { methods: true }, [{ section: 'results' }]);
    expect(st.methods).toBe('conflict');
    expect(st.results).toBe('issue');
    expect(st.abstract).toBe('locked');
    expect(st.introduction).toBe('empty');
  });
});

/* ── normalizeDraft additive preservation + legacy pin ────────────────────── */

describe('normalizeDraft — 84.md additive fields', () => {
  it('preserves detached/approvedAt/reviewedAt/depState/lastLinked + snapshots + syncLog', () => {
    const raw = makeManuscriptDraft();
    raw.sections.methods.detached = true;
    raw.sections.methods.approvedAt = '2026-07-13T00:00:00Z';
    raw.sections.methods.reviewedAt = '2026-07-13T00:00:01Z';
    raw.sections.methods.depState = { 'analysis.tau2': 'abcd1234' };
    raw.sections.methods.lastLinked = { inputsHash: 'ff00ff00', at: 't' };
    raw.snapshots = [{ id: 'snap_1_x', label: 'v1' }];
    raw.syncLog = [{ at: 't', action: 'accept', sectionId: 'methods', reasons: [] }];
    const n = normalizeDraft(raw);
    expect(n.sections.methods.detached).toBe(true);
    expect(n.sections.methods.approvedAt).toBe('2026-07-13T00:00:00Z');
    expect(n.sections.methods.reviewedAt).toBe('2026-07-13T00:00:01Z');
    expect(n.sections.methods.depState['analysis.tau2']).toBe('abcd1234');
    expect(n.sections.methods.lastLinked.inputsHash).toBe('ff00ff00');
    expect(n.snapshots.length).toBe(1);
    expect(n.syncLog.length).toBe(1);
  });
  it('a legacy draft normalizes without any 84.md phantom keys', () => {
    const legacy = normalizeDraft({ sections: { results: { content: 'x' } } });
    expect('snapshots' in legacy).toBe(false);
    expect('syncLog' in legacy).toBe(false);
    expect('detached' in legacy.sections.results).toBe(false);
    expect('depState' in legacy.sections.results).toBe(false);
  });
  it('caps a persisted over-long history on read', () => {
    const raw = makeManuscriptDraft();
    raw.snapshots = Array.from({ length: 30 }, (_, i) => ({ id: `snap_${i}`, label: `v${i}` }));
    raw.syncLog = Array.from({ length: 150 }, (_, i) => ({ at: `t${i}`, action: 'keep' }));
    const n = normalizeDraft(raw);
    expect(n.snapshots.length).toBe(20);
    expect(n.syncLog.length).toBe(100);
  });
});

/* ── adversarial-review fixes ─────────────────────────────────────────────── */

describe('review fixes', () => {
  it('(1) frozen snapshots are never evicted by the cap; ids stay unique after eviction', () => {
    let draft = makeManuscriptDraft();
    const p = baseProject();
    // one frozen submission snapshot, then 25 routine ones
    draft = createSnapshot(draft, p, { label: 'submission', frozen: true, nowIso: '2026-07-13T00:00:00Z-0' }).draft;
    for (let i = 1; i <= 25; i += 1) draft = createSnapshot(draft, p, { label: `v${i}`, nowIso: `2026-07-13T00:00:00Z-${i}` }).draft;
    expect(draft.snapshots.length).toBe(20);
    const frozen = draft.snapshots.filter((s) => s.frozen);
    expect(frozen.length).toBe(1);
    expect(frozen[0].label).toBe('submission'); // survived eviction
    expect(new Set(draft.snapshots.map((s) => s.id)).size).toBe(draft.snapshots.length); // no id reuse
  });
  it('(1) normalizeDraft read-cap also preserves frozen over non-frozen', () => {
    const raw = makeManuscriptDraft();
    raw.snapshots = Array.from({ length: 30 }, (_, i) => ({ id: `snap_${i}_x`, label: `v${i}`, frozen: i < 3 }));
    const n = normalizeDraft(raw);
    expect(n.snapshots.length).toBe(20);
    expect(n.snapshots.filter((s) => s.frozen).length).toBe(3);
  });
  it('(2) restore never overwrites a locked section and reports it in skippedLocked', () => {
    let draft = makeManuscriptDraft();
    draft.sections.methods.content = 'Snapshot methods.';
    draft.sections.results.content = 'Snapshot results.';
    const snap = createSnapshot(draft, baseProject(), { label: 'v1', nowIso: '2026-07-13T00:00:01Z' });
    draft = snap.draft;
    draft = { ...draft, sections: {
      ...draft.sections,
      methods: { ...draft.sections.methods, content: 'Locked edit.', locked: true },
      results: { ...draft.sections.results, content: 'Later results.' },
    } };
    const res = restoreSnapshot(draft, snap.snapshot.id, { nowIso: '2026-07-13T00:00:02Z' });
    expect(res.restored).toBe(true);
    expect(res.skippedLocked).toContain('methods');
    expect(res.draft.sections.methods.content).toBe('Locked edit.'); // kept current
    expect(res.draft.sections.methods.locked).toBe(true);
    expect(res.draft.sections.results.content).toBe('Snapshot results.'); // restored
  });
  it('(3) accept clears a stale approvedAt so the section classifies as project-controlled', () => {
    const draft = draftFrom(baseProject(), {});
    // pretend the section was previously approved
    draft.sections.methods.approvedAt = '2026-01-01T00:00:00Z';
    const p2 = baseProject(); p2.analysisSettings = { tau2Method: 'REML' };
    const generated = generateDraft(p2, {});
    const ctx = { generated, sectionMeta: generated.sectionMeta, freshDepState: computeDependencyState(p2, {}), nowIso: '2026-07-13T00:00:00Z' };
    const { draft: next } = applySyncDecision(draft, 'methods', 'accept', ctx);
    expect(next.sections.methods.approvedAt).toBeNull();
    expect(sectionSyncState(next.sections.methods)).toBe('project');
  });
  it('(4) with identical opts, a freshly generated depState diffs to [] for every section (no phantom reasons)', () => {
    const p = baseProject();
    const opts = { templateId: 'jama', citationStyle: 'jama', reviewers: 2 };
    const gen = generateDraft(p, opts);
    const fresh = computeDependencyState(p, opts);
    for (const id of SECTION_IDS) {
      expect(diffDeps(gen.sectionMeta[id].depState, fresh, id)).toEqual([]);
    }
  });
  it('(5) abstract-estimate only compares the token matching the primary measure', () => {
    const p = baseProject(); // pooled OR
    const primary = { pair: { esType: 'OR', label: 'MACE' }, result: { pES: Math.log(0.70) } };
    const d = makeManuscriptDraft();
    // an RR number is present but the pooled measure is OR — must NOT be compared to the OR pool
    d.sections.abstract.content = 'The pooled RR 1.50 favoured control for a secondary outcome.';
    expect(detectContradictions(p, d, { primary }).find((i) => i.id === 'abstract-estimate')).toBeFalsy();
    // a matching OR number that disagrees WITH the pool → flagged
    d.sections.abstract.content = 'The pooled OR 1.90 favoured control overall.';
    expect(detectContradictions(p, d, { primary }).find((i) => i.id === 'abstract-estimate')).toBeTruthy();
  });
  it('(6) included-count needs the finite verb — qualitative-synthesis phrasing does not false-fire', () => {
    const d = makeManuscriptDraft();
    d.sections.results.content = 'Overall, 7 studies included in the qualitative synthesis provided context.';
    expect(detectContradictions(baseProject(), d, {}).find((i) => i.id === 'included-count')).toBeFalsy();
    d.sections.results.content = 'In total, 7 studies were included in the review.';
    expect(detectContradictions(baseProject(), d, {}).find((i) => i.id === 'included-count')).toBeTruthy();
  });
});
