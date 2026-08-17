/**
 * hookState120.test.js — 120.md §6, Wave 4b.
 *
 * The PURE half of `useWritingAssistant` (waState.js). This is where the hook's
 * genuinely dangerous decisions live — which blocks get rechecked, when a worker
 * result is stale, what a preference blob is allowed to contain, how the retry
 * backoff escalates — and every one of them is a function over plain data, so it is
 * tested here rather than through a rendered component.
 *
 * The repo runs no jsdom, by design. Anything that needs a live Range or a
 * TreeWalker is proven in e2e/manuscript/manuscript-writing-assistant-120.spec.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  WA_STATUS, statusFor,
  DEFAULT_WA_PREFS, normalizeWaPrefs, clampWaPrefs, waPrefsBytes, WA_PREFS_BYTE_CAP,
  waPrefsKey, waDismissKey, waIgnoreKey,
  backoffDelay, WA_BACKOFF_MS,
  prepareSection, sectionSignature, emptySectionState, changedBlocks, reconcileSection,
  applyResult, sectionIssues, issueSummary, stepIssue, announceIssue,
  readJson, writeJson,
} from '../../../../src/features/manuscript/writingAssistant/waState.js';
import { makeIssue, CATEGORY, SEVERITY } from '../../../../src/features/manuscript/writingAssistant/engine/issueModel.js';
import { buildWaProjectShape } from '../../../../src/features/manuscript/writingAssistant/waProjectShape.js';
import { buildProjectLexicon } from '../../../../src/features/manuscript/writingAssistant/engine/projectLexicon.js';
import { normalizeDictionaryInput, WA_TERM_MAX } from '../../../../src/shared/writingAssistantDictionary.js';

const issueAt = (blockIndex, start, end, original, extra = {}) => makeIssue({
  sectionId: 's1', blockIndex, blockRev: 'r', start, end, original,
  category: CATEGORY.SPELLING, severity: SEVERITY.ERROR, confidence: 0.9,
  ruleId: 'wa.spelling', suggestions: ['fixed'], ...extra,
});

describe('120.md §6 — the status machine', () => {
  it('is OFF whenever the user has not enabled it, whatever else is true', () => {
    expect(statusFor({ enabled: false, ready: true, issueCount: 9 })).toBe(WA_STATUS.OFF);
    expect(statusFor({ enabled: false, error: { code: 'x' } })).toBe(WA_STATUS.OFF);
  });

  it('NEVER reports "clean" when checking failed — error and clean are distinct states', () => {
    // §6 failure behaviour: "Do not falsely display `No issues found` when checking
    // actually failed." Zero issues + an error is an ERROR, not a clean bill.
    expect(statusFor({ enabled: true, ready: true, error: { code: 'dict-load-failed' }, issueCount: 0 }))
      .toBe(WA_STATUS.ERROR);
    expect(statusFor({ enabled: true, ready: true, error: null, issueCount: 0 }))
      .toBe(WA_STATUS.CLEAN);
  });

  it('orders loading → checking → issues/clean', () => {
    expect(statusFor({ enabled: true, ready: false })).toBe(WA_STATUS.LOADING);
    expect(statusFor({ enabled: true, ready: true, inFlight: true })).toBe(WA_STATUS.CHECKING);
    expect(statusFor({ enabled: true, ready: true, issueCount: 3 })).toBe(WA_STATUS.ISSUES);
  });
});

describe('120.md §6 — preferences ride the 500-byte profile allowlist', () => {
  it('defaults to OFF for every user (the feature is never forced on)', () => {
    expect(DEFAULT_WA_PREFS.enabled).toBe(false);
    expect(normalizeWaPrefs(null).enabled).toBe(false);
    expect(normalizeWaPrefs({}).enabled).toBe(false);
    // Only a real boolean true enables it — no truthy coercion from a stored string.
    expect(normalizeWaPrefs({ enabled: 'true' }).enabled).toBe(false);
  });

  it('rejects an unknown English variant rather than storing it', () => {
    expect(normalizeWaPrefs({ variant: 'en-AU' }).variant).toBe('en-US');
    expect(normalizeWaPrefs({ variant: 'en-GB' }).variant).toBe('en-GB');
  });

  it('clamps a blob that would exceed the profile allowlist cap, losing the least', () => {
    const many = Array.from({ length: 80 }, (_, i) => `wa.rule-with-a-long-name-${i}`);
    const cats = Array.from({ length: 18 }, (_, i) => `category-${i}`);
    const clamped = clampWaPrefs({ enabled: true, variant: 'en-GB', mutedRules: many, mutedCategories: cats });
    expect(waPrefsBytes(clamped)).toBeLessThanOrEqual(WA_PREFS_BYTE_CAP);
    // The three scalars are what the feature IS — they are never the thing dropped.
    expect(clamped.enabled).toBe(true);
    expect(clamped.variant).toBe('en-GB');
    // Rules go before categories.
    expect(clamped.mutedRules.length).toBeLessThan(many.length);
  });

  it('a realistic blob is nowhere near the cap', () => {
    const real = clampWaPrefs({ enabled: true, variant: 'en-GB', mutedCategories: ['style', 'repetition'], mutedRules: ['wa.repeated-opener'] });
    expect(waPrefsBytes(real)).toBeLessThan(200);
  });

  it('keys are per-user / per-manuscript and null without an id', () => {
    expect(waPrefsKey('u1')).toBe('metalab.writingAssistant.u1');
    expect(waPrefsKey(null)).toBe(null);
    expect(waDismissKey('p1:d1')).toBe('metalab.wa.dismissed.p1:d1');
    expect(waIgnoreKey('p1:d1')).toBe('metalab.wa.ignored.p1:d1');
    expect(waDismissKey(null)).toBe(null);
  });
});

describe('120.md §6 — retry backoff', () => {
  it('escalates 1s → 5s → 30s and then holds', () => {
    expect(WA_BACKOFF_MS).toEqual([1000, 5000, 30000]);
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(1)).toBe(5000);
    expect(backoffDelay(2)).toBe(30000);
    expect(backoffDelay(9)).toBe(30000);
    expect(backoffDelay(-3)).toBe(1000);
  });
});

describe('120.md §6 — incremental checking: only the changed blocks', () => {
  const md = [
    '## Methods',
    '',
    'We searched PubMed and Embase.',
    '',
    'Two reviewers screened independently.',
  ].join('\n');

  it('gives every block a content revision, so an edit ABOVE renumbers without dirtying', () => {
    const before = prepareSection(md);
    const after = prepareSection(`A new opening paragraph.\n\n${md}`);
    const beforeRevs = before.map((b) => b.rev);
    const afterRevs = after.map((b) => b.rev);
    // Every original block still exists with the SAME revision, one index later.
    for (let i = 0; i < beforeRevs.length; i += 1) {
      expect(afterRevs[i + 1]).toBe(beforeRevs[i]);
    }
  });

  it('sends nothing when nothing changed, and exactly one block when one did', () => {
    const blocks = prepareSection(md);
    let state = emptySectionState();
    expect(changedBlocks(state, blocks).length).toBe(blocks.filter((b) => b.checkable).length);

    state = applyResult(state, {
      blocks: blocks.map((b) => ({ index: b.index, rev: b.rev, issues: [] })),
      documentIssues: [],
    }, blocks);
    expect(changedBlocks(state, blocks)).toEqual([]);

    const edited = prepareSection(md.replace('Embase', 'Embase and CENTRAL'));
    const changed = changedBlocks(state, edited);
    expect(changed.length).toBe(1);
    expect(changed[0].text).toContain('CENTRAL');
  });

  it('never sends a non-checkable block (a table separator is not prose)', () => {
    const table = '| Outcome | n |\n| --- | --- |\n| Death | 12 |';
    const blocks = prepareSection(table);
    const changed = changedBlocks(emptySectionState(), blocks);
    expect(changed.some((b) => b.kind === 'separator')).toBe(false);
    expect(changed.length).toBe(2);
  });
});

describe('120.md §6 — stale-result protection', () => {
  const md = 'The hepatocelular injury was assessed.';

  it('VOIDS a result whose block revision no longer matches (protocol rule 2)', () => {
    const blocks = prepareSection(md);
    const stale = {
      blocks: [{ index: 0, rev: 'a-revision-from-the-past', issues: [issueAt(0, 4, 17, 'hepatocelular')] }],
      documentIssues: [],
    };
    const state = applyResult(emptySectionState(), stale, blocks);
    expect(state.voided).toBe(1);
    expect(sectionIssues(state)).toEqual([]);
  });

  it('accepts a result whose revision still matches', () => {
    const blocks = prepareSection(md);
    const fresh = {
      blocks: [{ index: 0, rev: blocks[0].rev, issues: [issueAt(0, 4, 17, 'hepatocelular')] }],
      documentIssues: [],
    };
    const state = applyResult(emptySectionState(), fresh, blocks);
    expect(state.voided).toBe(0);
    expect(sectionIssues(state).map((i) => i.original)).toEqual(['hepatocelular']);
  });

  it('drops the issues of an EDITED block and keeps the issues of its neighbours', () => {
    const two = 'The hepatocelular injury was assessed.\n\nAnother paragraph with speling.';
    const blocks = prepareSection(two);
    let state = applyResult(emptySectionState(), {
      blocks: [
        { index: 0, rev: blocks[0].rev, issues: [issueAt(0, 4, 17, 'hepatocelular')] },
        { index: 1, rev: blocks[1].rev, issues: [issueAt(1, 25, 32, 'speling')] },
      ],
      documentIssues: [],
    }, blocks);
    expect(sectionIssues(state)).toHaveLength(2);

    const edited = prepareSection(two.replace('hepatocelular', 'hepatocellular'));
    state = reconcileSection(state, edited);
    const left = sectionIssues(state);
    expect(left).toHaveLength(1);
    expect(left[0].original).toBe('speling');
  });

  it('voids the DOCUMENT passes on any block change — they read the whole section', () => {
    const blocks = prepareSection('Meta-analysis was used.\n\nThe meta analysis was updated.');
    const docIssue = issueAt(1, 4, 17, 'meta analysis', { category: CATEGORY.CONSISTENCY, ruleId: 'wa.variant-term' });
    let state = applyResult(emptySectionState(), { blocks: [], documentIssues: [docIssue], mode: 'document' }, blocks, { mode: 'document' });
    expect(state.docSig).toBe(sectionSignature(blocks));
    expect(sectionIssues(state)).toHaveLength(1);

    state = reconcileSection(state, prepareSection('Meta-analysis was used.\n\nThe meta analysis was revised.'));
    expect(state.docSig).toBe(null);
    expect(sectionIssues(state)).toEqual([]);
  });

  it('forgets issues for a block index the section no longer has', () => {
    const blocks = prepareSection('One paragraph.\n\nTwo paragraph.');
    let state = applyResult(emptySectionState(), {
      blocks: [
        { index: 0, rev: blocks[0].rev, issues: [issueAt(0, 0, 3, 'One')] },
        { index: 1, rev: blocks[1].rev, issues: [issueAt(1, 0, 3, 'Two')] },
      ],
      documentIssues: [],
    }, blocks);
    const shorter = prepareSection('One paragraph.');
    state = applyResult(state, { blocks: [], documentIssues: [] }, shorter);
    expect(sectionIssues(state).map((i) => i.blockIndex)).toEqual([0]);
  });
});

describe('120.md §6 — what the user sees', () => {
  const blocks = prepareSection('The the participants were followed.\n\nA lot of data was lost.');
  const dup = issueAt(0, 4, 11, 'the the', { category: CATEGORY.DUPLICATE, ruleId: 'wa.duplicate-word' });
  const informal = issueAt(1, 0, 8, 'A lot of', {
    category: CATEGORY.INFORMAL, ruleId: 'wa.informal', severity: SEVERITY.SUGGESTION, confidence: 0.5,
  });
  const state = applyResult(emptySectionState(), {
    blocks: [
      { index: 0, rev: blocks[0].rev, issues: [dup] },
      { index: 1, rev: blocks[1].rev, issues: [informal] },
    ],
    documentIssues: [],
  }, blocks);

  it('hides dismissed issues without deleting them from the store', () => {
    expect(sectionIssues(state)).toHaveLength(2);
    expect(sectionIssues(state, { dismissed: [dup.id] })).toHaveLength(1);
  });

  it('honours muted categories, muted rules and the style opt-out', () => {
    expect(sectionIssues(state, { mutedCategories: ['duplicate'] })).toHaveLength(1);
    expect(sectionIssues(state, { mutedRules: ['wa.informal'] })).toHaveLength(1);
    // The style GROUP covers informal/clarity/style/repetition in one switch.
    expect(sectionIssues(state, { showStyle: false }).map((i) => i.category)).toEqual(['duplicate']);
  });

  it('summarises by severity, category and decoration group from ONE list', () => {
    const s = issueSummary(sectionIssues(state));
    expect(s.total).toBe(2);
    expect(s.errors).toBe(1);
    expect(s.byCategory).toEqual({ duplicate: 1, informal: 1 });
    expect(s.byGroup).toEqual({ grammar: 1, style: 1 });
  });

  it('steps next/previous with wraparound and starts sensibly from nothing', () => {
    const list = sectionIssues(state);
    expect(stepIssue(list, null, 1).id).toBe(list[0].id);
    expect(stepIssue(list, null, -1).id).toBe(list[list.length - 1].id);
    expect(stepIssue(list, list[0].id, 1).id).toBe(list[1].id);
    expect(stepIssue(list, list[1].id, 1).id).toBe(list[0].id);   // wraps
    expect(stepIssue(list, list[0].id, -1).id).toBe(list[1].id);  // wraps backwards
    expect(stepIssue([], null, 1)).toBe(null);
  });

  it('announces an issue the way §6 words it', () => {
    const spelling = issueAt(0, 4, 17, 'hepatocelular', { suggestions: ['hepatocellular'] });
    expect(announceIssue(spelling, 2, 12, 'Spelling'))
      .toBe('Spelling: “hepatocelular”, suggestion “hepatocellular”, issue 3 of 12.');
    const none = issueAt(0, 0, 4, 'Xyzq', { suggestions: [] });
    expect(announceIssue(none, 0, 1, 'Spelling')).toContain('no suggestion');
  });
});

describe('120.md §6 — dictionary input rules (shared with the server)', () => {
  it('preserves meaningful capitalization and lowercases only the uniqueness key', () => {
    const r = normalizeDictionaryInput({ term: 'TP53' });
    expect(r.ok).toBe(true);
    expect(r.entry.term).toBe('TP53');
    expect(r.entry.termLower).toBe('tp53');
  });

  it('refuses a sentence, a blank, an over-long term and an unknown category', () => {
    expect(normalizeDictionaryInput({ term: 'two words' }).ok).toBe(false);
    expect(normalizeDictionaryInput({ term: '   ' }).ok).toBe(false);
    expect(normalizeDictionaryInput({ term: 'x'.repeat(WA_TERM_MAX + 1) }).ok).toBe(false);
    expect(normalizeDictionaryInput({ term: 'ok', category: 'nonsense' }).ok).toBe(false);
    expect(normalizeDictionaryInput({ term: '-leading' }).ok).toBe(false);
  });

  it('accepts the punctuation that genuinely occurs inside scientific tokens', () => {
    for (const t of ['follow-up', 'mg/dL', 'HbA1c', "patient's", '5-HT2A', 'CD4+']) {
      expect(normalizeDictionaryInput({ term: t }).ok, t).toBe(true);
    }
  });
});

describe('120.md §6 — the project shape the lexicon is built from', () => {
  it('feeds reference metadata as TRUSTED and project prose as free text', () => {
    const shape = buildWaProjectShape(
      { name: 'Upadacitinib in Crohn disease', pico: { question: 'Is upadacitinib effective?', P: 'adults with Crohn disease', keywords: ['upadacitinib'] }, studies: [{ title: 'Upadacitinib induction therapy', authors: 'Loftus EV', journal: 'NEJM', doi: '10.1000/x' }] },
      { references: [{ title: 'Risankizumab maintenance', authors: 'Ferrante M', journal: 'Lancet' }], tables: [{ title: 'Baseline characteristics' }], figures: [], keywords: ['JAK inhibitor'] },
    );
    expect(shape.studyTitles).toContain('Upadacitinib induction therapy');
    expect(shape.referenceTitles).toContain('Risankizumab maintenance');
    expect(shape.registeredIds).toContain('10.1000/x');
    expect(shape.title).toContain('Upadacitinib in Crohn disease');
    expect(shape.keywords).toEqual(expect.arrayContaining(['upadacitinib', 'JAK inhibitor']));

    // …and the engine then accepts the drug from a single TRUSTED appearance.
    const lex = buildProjectLexicon(shape);
    expect(lex.has('upadacitinib')).toBe(true);
    expect(lex.has('risankizumab')).toBe(true);
  });

  it('never treats manuscript prose as a lexicon source', () => {
    // Section content is deliberately absent from the shape: a misspelling in the
    // Discussion must not teach the checker to accept itself (§6).
    const shape = buildWaProjectShape({ name: 'A project' }, {});
    expect(Object.keys(shape)).not.toContain('sections');
    expect(Object.values(shape).flat().join(' ')).not.toContain('Discussion');
  });

  it('survives a project with nothing in it', () => {
    const shape = buildWaProjectShape(null, null);
    expect(Object.values(shape).every((v) => Array.isArray(v))).toBe(true);
    expect(() => buildProjectLexicon(shape)).not.toThrow();
  });
});

describe('waState storage helpers are storage-optional', () => {
  const store = new Map();
  beforeEach(() => { store.clear(); });

  it('reads the fallback when there is no localStorage at all (SSR)', () => {
    expect(readJson('anything', 'fallback')).toBe('fallback');
    expect(() => writeJson('anything', { a: 1 })).not.toThrow();
  });

  it('round-trips through a stubbed localStorage and survives corrupt JSON', () => {
    const stub = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    };
    vi.stubGlobal('localStorage', stub);
    try {
      writeJson('k', { enabled: true });
      expect(readJson('k', null)).toEqual({ enabled: true });
      store.set('bad', '{not json');
      expect(readJson('bad', 'fallback')).toBe('fallback');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
