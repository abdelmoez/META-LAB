/**
 * 118.md §28-§40 / §49-§50 / §69 — the Overview command-center redesign.
 *
 * SSR contract tests (house style: renderToStaticMarkup, no jsdom — interaction is
 * asserted through control presence + ARIA state and through the PURE models the
 * page derives itself from).
 *
 * The spine of this file is §28: a first-time user opens the Overview and must be
 * able to answer, from the page alone —
 *   1. What is this page?          → the dismissible intro / the first-draft hero
 *   2. What has PecanRev prepared? → readiness + connected project data
 *   3. What needs attention?       → the EXPLAINED update list
 *   4. Where should I start?       → "Continue writing", aimed at a real section
 *   5. What is ready / incomplete? → the per-section structure summary
 *   6. What needs verification?    → the before-submission checklist
 *   7. What before exporting?      → the same checklist, from real export validation
 *
 * …plus the honesty pins: no number before the sources settle (§49/§69), no
 * "synchronized" while availability is unknown, the headline update count is the
 * SAME number the nav badge shows (§34), and warnings never masquerade as blockers.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import {
  ManuscriptOverview, OverviewIntro,
  continueTarget, attentionSummary, outdatedSections, connectedDataRows, failedSources,
  submissionChecklist, manuscriptObjects, exportNotes, readinessQualifier,
  INTRO_DISMISS_KEY, EMPTY_COPY, CONTINUE_REASON_COPY, CHECKLIST_CODE_ITEM, NO_PENDING_UPDATES,
} from '../../../src/features/manuscript/ManuscriptOverview.jsx';
import { OverviewPanel, sectionRowStatus as panelsSectionRowStatus } from '../../../src/features/manuscript/manuscriptPanels.jsx';
// r2 (118.md §32) — the section-status rule has ONE home now; the Overview and the
// panels both read it from here instead of each declaring their own copy.
import { sectionRowStatus, SECTION_STATUS_CHIP } from '../../../src/features/manuscript/sectionStatusRule.js';
// r2 — the REAL code the placement scanner emits, so the checklist mapping below is
// asserted against the emitter rather than against a hand-typed string.
import { PLAIN_MENTION_CODE, computePlacements, validateExport } from '../../../src/research-engine/manuscript/index.js';
import { updatesBadge } from '../../../src/features/manuscript/ManuscriptToolbar.jsx';
import {
  makeManuscriptDraft, normalizeDraft, SECTION_TYPES,
} from '../../../src/research-engine/manuscript/model.js';
import { setSection, setSectionLocked } from '../../../src/features/manuscript/manuscriptState.js';

const noop = () => {};
const noAI = (html) => expect(html).not.toMatch(/\bAI\b/);

const mockExporters = {
  onExportWord: noop, onExportRepro: noop, onPrismaChecklist: noop, onPrismaSChecklist: noop,
  exporting: null, exportError: '', exportProgress: '',
};

/* A draft with real content in every state the structure summary can show. */
function populatedDraft() {
  let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
  d.sections.introduction = { ...d.sections.introduction, content: 'gen intro', aiGenerated: true, userEdited: false };
  d = setSection(d, 'methods', 'my methods');
  d = setSection(d, 'results', 'locked results');
  d = setSectionLocked(d, 'results', true);
  d.sections.discussion = { ...d.sections.discussion, content: 'gen d', aiGenerated: true, userEdited: false };
  return normalizeDraft(d);
}

function mockM(draft, extra = {}) {
  return {
    activeDraft: draft,
    activeId: draft.id,
    drafts: [draft],
    references: [],
    referenceLibrary: { refs: [], aliases: {}, removedIds: new Set() },
    prismaCounts: { counts: { identified: 1200, screened: 950, included: 12 }, provenance: {}, warnings: [] },
    insights: [],
    readiness: {
      items: [
        { key: 'title', label: 'Title', complete: true },
        { key: 'prisma', label: 'PRISMA counts', complete: true, detail: '' },
        { key: 'studies', label: 'Included studies', complete: true, detail: '12 studies' },
        { key: 'analysis', label: 'Meta-analysis', complete: true, detail: 'k=12' },
        { key: 'references', label: 'References', complete: false, detail: 'No references' },
      ],
      score: { done: 4, total: 5, pct: 80 },
    },
    staleness: {}, tables: {},
    dataStatus: { screening: 'ok', search: 'ok', rob: 'off', grade: 'off', pecan: 'off' },
    screening: null, searchMethodsText: 'PubMed was searched…',
    searchProvenance: { latestValidSearchAt: '2026-02-03T10:00:00.000Z' },
    robAssessments: null, robByStudyId: null, perSource: null,
    outdated: {}, consistency: [], contradictions: [], missingInfo: [], changeGroups: [],
    freshDepState: {}, outdatedCount: 0,
    freshness: { status: 'synced', label: 'Fully synchronized', counts: { outdated: 0, contradictions: 0, critical: 0, missing: 0, staleBlocks: 0 } },
    gradeByOutcome: null,
    assets: [], assetNumbering: { byId: {}, unresolved: [] },
    assetPlacements: { bySection: {}, fallback: [], warnings: [], plainMentions: [] },
    sourcesSettled: true, sourcesFetchedAt: '2026-02-04T09:30:00.000Z',
    saveState: 'saved', lastError: null, retry: noop,
    updateSection: noop, setMeta: noop, setMetaDebounced: noop, setStatement: noop,
    setSectionLocked: noop,
    generate: () => ({ skipped: [], skippedLocked: [] }),
    refreshBlock: noop, refreshAllBlocks: noop, refreshSyncPlan: noop, prepareExport: noop,
    flush: noop,
    ...extra,
  };
}

const view = (m, props = {}) => renderToStaticMarkup(
  <ManuscriptOverview m={m} exporters={mockExporters} onOpenSection={noop} onNavigate={noop} {...props} />,
);

/* ══════════════ §28.1 — "What is this page?" ══════════════ */

describe('118.md §36/§37 — a first-time user is told what this page is', () => {
  it('shows the concise intro (not a tutorial wall) with a Got it dismissal', () => {
    const html = view(mockM(populatedDraft()));
    expect(html).toContain('data-testid="stitch-manuscript-overview-intro"');
    expect(html).toContain('How this manuscript works');
    expect(html).toContain('PecanRev builds your manuscript from the work you have already done in this review.');
    // the four things that are genuinely surprising about a manuscript wired to a project
    expect(html).toContain('Already drafted for you');
    expect(html).toContain('Updates');
    expect(html).toContain('Connected, not copied');
    expect(html).toContain('Verify before submission');
    expect(html).toContain('data-testid="stitch-manuscript-overview-intro-dismiss"');
    expect(html).toContain('Got it');
    noAI(html);
  });

  it('the intro is short — a note, never a blocking tutorial', () => {
    const html = renderToStaticMarkup(<OverviewIntro onDismiss={noop} />);
    // no dialog semantics, nothing modal, and no scrim
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('position:fixed');
  });

  it('the dismissal is a per-browser preference, never written to the manuscript blob', () => {
    expect(INTRO_DISMISS_KEY).toBe('ms-overview-intro-dismissed');
    const src = readSource('src/features/manuscript/ManuscriptOverview.jsx');
    expect(src).toContain("window.localStorage.setItem(INTRO_DISMISS_KEY, '1')");
    // …and it is read defensively (private mode / SSR must not throw)
    expect(src).toContain('function readDismissed()');
    expect(src).not.toContain('setMeta({ introDismissed');
  });

  it('an all-empty manuscript gets the first-draft hero instead of the intro', () => {
    const html = view(mockM(normalizeDraft(makeManuscriptDraft({ title: '' }))));
    expect(html).toContain('data-testid="stitch-manuscript-hero"');
    expect(html).toContain('data-testid="stitch-manuscript-hero-generate"');
    expect(html).toContain('Generate your first draft');
    // the two onboarding surfaces never stack
    expect(html).not.toContain('data-testid="stitch-manuscript-overview-intro"');
    // …and there is nothing to be "ready" about yet
    expect(html).not.toContain('data-testid="stitch-manuscript-readiness"');
    expect(html).not.toContain('data-testid="stitch-manuscript-section-grid"');
    noAI(html);
  });
});

/* ══════════════ §28.2/§30 — "What is ready?" (an HONEST percentage) ══════════════ */

describe('118.md §30/§69 — the readiness percentage is defined, not decorative', () => {
  const html = view(mockM(populatedDraft()));

  it('renders the readiness checklist\'s OWN score and says what it counts', () => {
    expect(html).toContain('data-testid="stitch-manuscript-readiness"');
    expect(html).toContain('data-testid="stitch-manuscript-readiness-pct"');
    expect(html).toContain('80%');
    expect(html).toContain('prepared — 4 of 5 readiness checks complete');
  });

  it('the contributing items are one disclosure away (§36 progressive disclosure)', () => {
    expect(html).toContain('data-testid="stitch-manuscript-readiness-explain"');
    expect(html).toContain('What counts towards this?');
    expect(html).toContain('aria-expanded="false"');
    // collapsed by default — the list is not dumped on the page
    expect(html).not.toContain('data-testid="stitch-manuscript-readiness-items"');
  });

  it('no percentage exists without a readiness model — nothing is invented', () => {
    const html2 = view(mockM(populatedDraft(), { readiness: null }));
    expect(html2).not.toContain('data-testid="stitch-manuscript-readiness-pct"');
    expect(html2).toContain('data-testid="stitch-manuscript-readiness-skeleton"');
  });

  /* r2 (§69) — computeReadiness scores its OWN eleven checks. Missing project
     information and unresolved manual placeholders are counted elsewhere, so the
     page could honestly print "100% prepared" directly above "11 items missing".
     Two true numbers, arranged into a contradiction. The fix is co-presence, not a
     second blended percentage: there is no honest one to compute. */
  it('r2 §69 — a complete readiness score names what it does NOT cover', () => {
    expect(readinessQualifier({ missing: 0, placeholders: 0 })).toBe('');
    expect(readinessQualifier({ missing: 11, placeholders: 0 }))
      .toBe('11 project details still missing — see Needs attention');
    expect(readinessQualifier({ missing: 1, placeholders: 0 }))
      .toBe('1 project detail still missing — see Needs attention');
    expect(readinessQualifier({ missing: 0, placeholders: 3 }))
      .toBe('3 fields still to fill in — see Needs attention');
    expect(readinessQualifier({ missing: 2, placeholders: 1 }))
      .toBe('2 project details still missing · 1 field still to fill in — see Needs attention');

    const clean = view(mockM(populatedDraft()));
    expect(clean).not.toContain('data-testid="stitch-manuscript-readiness-qualifier"');

    const html = view(mockM(populatedDraft(), {
      readiness: { items: [{ key: 'title', label: 'Title', complete: true }], score: { done: 11, total: 11, pct: 100 } },
      missingInfo: Array.from({ length: 11 }, (_x, i) => ({ field: `f${i}`, label: `Field ${i}`, hint: 'h' })),
      placeholderStats: { manual: 2, pending: 0, total: 2 },
    }));
    expect(html).toContain('100%');
    expect(html).toContain('data-testid="stitch-manuscript-readiness-qualifier"');
    expect(html).toContain('11 project details still missing');
    expect(html).toContain('2 fields still to fill in');
    expect(html).toContain('see Needs attention');
    // §69 — the percentage keeps its own meaning: still the readiness checklist's
    // own done/total, and there is exactly ONE score on the page (no blended second).
    expect(html).toContain('prepared — 11 of 11 readiness checks complete');
    expect((html.match(/data-testid="stitch-manuscript-readiness-pct"/g) || []).length).toBe(1);
  });
});

/* ══════════════ §28.4/§31 — "Where should I start?" ══════════════ */

describe('118.md §31 — the "Continue writing" target rule', () => {
  const at = (d, id, iso, patch = {}) => {
    d.sections[id] = { ...d.sections[id], content: 'text', updatedAt: iso, ...patch };
    return d;
  };

  it('goes to the most recently EDITED section', () => {
    let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d = at(d, 'introduction', '2026-01-01T00:00:00.000Z', { userEdited: true });
    d = at(d, 'discussion', '2026-03-01T00:00:00.000Z', { userEdited: true });
    d = at(d, 'methods', '2026-02-01T00:00:00.000Z', { userEdited: true });
    expect(continueTarget(d)).toEqual({ id: 'discussion', reason: 'last-edited' });
  });

  it('IGNORES generation stamps — generating a section also stamps updatedAt', () => {
    let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    // the researcher edited Methods in January…
    d = at(d, 'methods', '2026-01-01T00:00:00.000Z', { userEdited: true });
    // …then regenerated Results today, which stamps a NEWER updatedAt on a section
    // the researcher has never touched. "Continue writing" must not land there.
    d = at(d, 'results', '2026-09-09T00:00:00.000Z', { aiGenerated: true, userEdited: false });
    expect(continueTarget(d)).toEqual({ id: 'methods', reason: 'last-edited' });
  });

  it('falls back to the first EMPTY section in canonical order', () => {
    let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    for (const s of SECTION_TYPES) d = at(d, s.id, '2026-01-01T00:00:00.000Z', { aiGenerated: true });
    d.sections.limitations = { ...d.sections.limitations, content: '' };
    d.sections.conclusion = { ...d.sections.conclusion, content: '' };
    expect(continueTarget(d)).toEqual({ id: 'limitations', reason: 'first-empty' });
  });

  it('a brand-new draft starts at the first section — never a hardcoded Introduction', () => {
    const d = normalizeDraft(makeManuscriptDraft({ title: '' }));
    expect(continueTarget(d)).toEqual({ id: SECTION_TYPES[0].id, reason: 'first-empty' });
  });

  it('a fully generated, never-edited manuscript honestly says "start at the top"', () => {
    let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    for (const s of SECTION_TYPES) d = at(d, s.id, '2026-01-01T00:00:00.000Z', { aiGenerated: true });
    expect(continueTarget(d)).toEqual({ id: SECTION_TYPES[0].id, reason: 'start' });
  });

  it('ties fall back to the canonical section order, not to insertion order', () => {
    let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d = at(d, 'discussion', '', { userEdited: true });
    d = at(d, 'introduction', '', { userEdited: true });
    expect(continueTarget(d).id).toBe('introduction');
  });

  /* r2 — a LOCKED section is read-only by contract: the editor disables typing and
     generation always skips it. "Continue writing" is the strongest CTA on the page,
     so pointing it at one opens a section that cannot be written in. Locking the
     section you just finished is the ordinary way to protect it, which makes this
     the common case rather than an edge one. */
  it('r2 §31 — a LOCKED section is never the "Continue writing" target', () => {
    // the only edited section is locked → fall through to the first empty one
    let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d = at(d, 'results', '2026-09-09T00:00:00.000Z', { userEdited: true, locked: true });
    expect(continueTarget(d)).toEqual({ id: SECTION_TYPES[0].id, reason: 'first-empty' });

    // a locked MOST-RECENT edit yields to the most recent UNLOCKED one
    let d2 = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d2 = at(d2, 'methods', '2026-01-01T00:00:00.000Z', { userEdited: true });
    d2 = at(d2, 'discussion', '2026-09-09T00:00:00.000Z', { userEdited: true, locked: true });
    expect(continueTarget(d2)).toEqual({ id: 'methods', reason: 'last-edited' });

    // a locked EMPTY section is not the first-empty target either
    let d3 = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    for (const sx of SECTION_TYPES) d3 = at(d3, sx.id, '2026-01-01T00:00:00.000Z', { aiGenerated: true });
    d3.sections.limitations = { ...d3.sections.limitations, content: '', locked: true };
    d3.sections.conclusion = { ...d3.sections.conclusion, content: '' };
    expect(continueTarget(d3)).toEqual({ id: 'conclusion', reason: 'first-empty' });

    // everything locked → the honest answer is still the top of the manuscript
    let d4 = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    for (const sx of SECTION_TYPES) d4 = at(d4, sx.id, '2026-01-01T00:00:00.000Z', { userEdited: true, locked: true });
    expect(continueTarget(d4)).toEqual({ id: SECTION_TYPES[0].id, reason: 'start' });
  });

  it('the CTA names the destination and WHY it was chosen', () => {
    let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d = at(d, 'methods', '2026-01-01T00:00:00.000Z', { userEdited: true });
    const html = view(mockM(normalizeDraft(d)));
    expect(html).toContain('data-testid="stitch-manuscript-continue-writing"');
    expect(html).toContain('Continue writing');
    expect(html).toContain('aria-label="Continue writing in Methods"');
    expect(html).toContain(CONTINUE_REASON_COPY['last-edited']);
  });
});

/* ══════════════ §28.3/§34 — "What needs attention?" ══════════════ */

describe('118.md §34 — updates are EXPLAINED, and the number matches the badge', () => {
  const outdatedM = () => mockM(populatedDraft(), {
    outdated: { methods: true, results: true },
    outdatedCount: 2,
    freshness: { status: 'updates', label: '2 updates available', counts: { outdated: 2, contradictions: 0, critical: 0, missing: 0, staleBlocks: 0 } },
    freshDepState: { 'analysis.tau2': 'h2', 'analysis.model': 'h1' },
  });

  it('the headline echoes freshness.counts.outdated — the SAME field the badge reads', () => {
    const m = outdatedM();
    const badge = updatesBadge(m.freshness, m.outdatedCount);
    expect(badge.count).toBe(2);
    const html = view(m);
    expect(html).toContain('2 updates need review');
    expect(html).toContain(`Review ${badge.count} updates`);
  });

  it('every outdated section is listed WITH the dependency that changed', () => {
    const draft = populatedDraft();
    // the section stored a fingerprint under a DIFFERENT tau² estimator
    draft.sections.methods = { ...draft.sections.methods, depState: { 'analysis.tau2': 'old', 'analysis.model': 'h1' } };
    const m = mockM(draft, {
      outdated: { methods: true },
      outdatedCount: 1,
      freshness: { status: 'updates', label: '1 update available', counts: { outdated: 1, staleBlocks: 0 } },
      freshDepState: { 'analysis.tau2': 'h2', 'analysis.model': 'h1' },
    });
    const rows = outdatedSections({ draft, outdated: m.outdated, freshDepState: m.freshDepState });
    expect(rows).toHaveLength(1);
    expect(rows[0].reasons.map((r) => r.key)).toEqual(['analysis.tau2']);

    const html = view(m);
    expect(html).toContain('1 update needs review');
    expect(html).toContain('data-testid="stitch-manuscript-attention-methods"');
    expect(html).toContain(rows[0].reasons[0].label);
    expect(html).toContain('data-testid="stitch-manuscript-review-updates"');
    expect(html).toContain('Review updates');
  });

  it('a section that never stored a fingerprint says so instead of inventing a reason', () => {
    const m = outdatedM();
    const html = view(m);
    expect(html).toContain('Reason not recorded for this section — compare it in Updates.');
  });

  it('contradictions and missing information are counted SEPARATELY from the headline', () => {
    const m = mockM(populatedDraft(), {
      outdated: { methods: true },
      outdatedCount: 1,
      contradictions: [{ id: 'c1', severity: 'critical', section: 'results', message: 'Results states 11 studies; the project has 12.' }],
      missingInfo: [{ field: 'search.date', hint: 'Search date is not recorded', resolveAt: 'the Search tab' }],
      freshness: { status: 'critical', label: '1 critical issue needs review', counts: { outdated: 1, contradictions: 1, critical: 1, missing: 1, staleBlocks: 0 } },
    });
    const summary = attentionSummary(m);
    expect(summary.headline).toBe(1);              // NOT 1 + 1 + 1
    expect(summary.contradictions).toHaveLength(1);
    expect(summary.missing).toHaveLength(1);

    const html = view(m);
    expect(html).toContain('1 update needs review');
    expect(html).toContain('Results states 11 studies; the project has 12.');
    expect(html).toContain('Search date is not recorded');
    expect(html).toContain('add it in the Search tab.');
  });

  it('§38/§40 — a long list is capped, and the page SAYS how many it is holding back', () => {
    const many = (n, make) => Array.from({ length: n }).map((_x, i) => make(i));
    const m = mockM(populatedDraft(), {
      missingInfo: many(13, (i) => ({ field: `f${i}`, hint: `Missing fact ${i}`, resolveAt: 'the Search tab' })),
      contradictions: many(5, (i) => ({ id: `c${i}`, severity: 'warn', section: '', message: `Contradiction ${i}` })),
      consistency: many(7, (i) => ({ id: `k${i}`, severity: 'warn', section: '', message: `Finding ${i}` })),
      freshness: { status: 'missing-info', label: '13 items of project information missing', counts: { outdated: 0, contradictions: 5, critical: 0, missing: 13, staleBlocks: 0 } },
    });
    const html = view(m);
    expect(html).toContain('Missing fact 0');
    expect(html).toContain('Missing fact 2');
    expect(html).not.toContain('Missing fact 3');
    expect(html).toContain('+10 more missing items — the full list is in Updates.');
    expect(html).toContain('+2 more contradictions — the full list is in Updates.');
    expect(html).toContain('+3 more checks — the full list is in Updates.');
    // the singular reads correctly too
    const one = view(mockM(populatedDraft(), {
      missingInfo: many(4, (i) => ({ field: `f${i}`, hint: `Missing fact ${i}` })),
    }));
    expect(one).toContain('+1 more missing item — the full list is in Updates.');
  });

  it('consistency findings keep their jump-to-section action', () => {
    const m = mockM(populatedDraft(), {
      consistency: [
        { id: 'estimator-mismatch', severity: 'warn', section: 'methods', message: 'Methods mentions a different estimator.' },
        { id: 'references-empty', severity: 'info', section: 'references', message: 'Reference list is empty.' },
      ],
    });
    const html = view(m);
    expect(html).toContain('Methods mentions a different estimator.');
    expect(html).toContain('data-testid="stitch-manuscript-consistency-open-estimator-mismatch"');
    expect(html).toContain('data-testid="stitch-manuscript-consistency-open-references-empty"');
    expect(html).toContain('Check');
    expect(html).toContain('Note');
  });

  it('§39 — nothing to review renders the synchronized sentence, not an empty "0" card', () => {
    const html = view(mockM(populatedDraft()));
    expect(html).toContain(EMPTY_COPY.updates);
    expect(html).not.toContain('0 updates need review');   // no zero headline
    expect(html).not.toContain('data-testid="stitch-manuscript-review-updates"');
  });

  it('the page never claims "synchronized" above a listed contradiction', () => {
    const m = mockM(populatedDraft(), {
      contradictions: [{ id: 'c1', severity: 'critical', section: 'results', message: 'Results states 11 studies; the project has 12.' }],
      freshness: { status: 'critical', label: '1 critical issue needs review', counts: { outdated: 0, contradictions: 1, critical: 1, missing: 0, staleBlocks: 0 } },
    });
    const summary = attentionSummary(m);
    expect(summary.updatesClear).toBe(true);
    expect(summary.clear).toBe(false);
    const html = view(m);
    // no section is waiting for an update — but the manuscript is NOT "synchronized"
    expect(html).toContain(NO_PENDING_UPDATES);
    expect(html).not.toContain(EMPTY_COPY.updates);
    expect(html).toContain('Results states 11 studies; the project has 12.');
  });
});

/* ══════════════ §28.5/§32 — "What is incomplete?" ══════════════ */

describe('118.md §32 — the structure summary is the SECTIONS, not the readiness list', () => {
  const html = view(mockM(populatedDraft(), { outdated: { discussion: true } }));

  it('iterates SECTION_TYPES — all eight, in canonical order', () => {
    expect(html).toContain('data-testid="stitch-manuscript-section-grid"');
    for (const s of SECTION_TYPES) {
      expect(html).toContain(`data-testid="stitch-manuscript-secrow-${s.id}"`);
      expect(html).toContain(s.label);
    }
    // the readiness checklist covers only SIX sections (no limitations/conclusions),
    // which is exactly why the structure summary is not built from it.
    const order = SECTION_TYPES.map((s) => html.indexOf(`stitch-manuscript-secrow-${s.id}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('data-testid="stitch-manuscript-secrow-limitations"');
    expect(html).toContain('data-testid="stitch-manuscript-secrow-conclusion"');
  });

  it('shows every status the rule can produce, with restrained tones', () => {
    for (const label of ['Empty', 'Auto-draft', 'Edited', 'Locked', 'Outdated']) {
      expect(html).toContain(label);
    }
    expect(sectionRowStatus({ content: 'x', locked: true }, true)).toBe('locked');
    expect(sectionRowStatus({ content: 'x', aiGenerated: true }, true)).toBe('outdated');
    expect(sectionRowStatus({ content: 'x', aiGenerated: true }, false)).toBe('ai-draft');
    expect(sectionRowStatus({ content: 'x', userEdited: true }, false)).toBe('edited');
    expect(sectionRowStatus({ content: '' }, false)).toBe('empty');
  });

  /* r2 (118.md §32) — the rule and its palette used to exist TWICE: once here and
     once in manuscriptPanels, whose copy had already drifted to a five-tone palette
     (Auto-draft yellow, Locked purple). §32's "do not turn the page into a rainbow"
     is the tie-break, so the four-tone palette is canonical and there is now exactly
     one implementation for both surfaces to read. */
  it('r2 §32 — ONE status rule and ONE palette, shared with the panels', () => {
    expect(panelsSectionRowStatus).toBe(sectionRowStatus);
    expect(Object.keys(SECTION_STATUS_CHIP).sort())
      .toEqual(['ai-draft', 'edited', 'empty', 'locked', 'outdated']);
    // four tones, deliberately — no purple, no fifth colour
    const tones = new Set(Object.values(SECTION_STATUS_CHIP).map((c) => c.tone));
    expect([...tones].sort()).toEqual(['blue', 'gray', 'green', 'yellow']);
    // …and no second copy of the rule survives in either component
    const panelsSrc = readSource('src/features/manuscript/manuscriptPanels.jsx');
    const overviewSrc = readSource('src/features/manuscript/ManuscriptOverview.jsx');
    expect(panelsSrc).not.toContain('const STATUS_CHIP = {');
    expect(overviewSrc).not.toContain('const SECTION_CHIP = {');
    expect(overviewSrc).not.toContain('export function overviewSectionStatus');
  });

  it('every row can be opened; a locked row cannot be regenerated', () => {
    expect(html).toContain('data-testid="stitch-manuscript-secrow-open-methods"');
    const tagStart = html.lastIndexOf('<button', html.indexOf('data-testid="stitch-manuscript-secrow-generate-results"'));
    expect(html.slice(tagStart, html.indexOf('>', tagStart))).toContain('disabled');
    const okStart = html.lastIndexOf('<button', html.indexOf('data-testid="stitch-manuscript-secrow-generate-methods"'));
    expect(html.slice(okStart, html.indexOf('>', okStart))).not.toContain('disabled');
  });

  it('§39 — no tables/figures/references renders the honest empty copy, never a "0"', () => {
    expect(html).toContain(EMPTY_COPY.tables);
    expect(html).toContain(EMPTY_COPY.figures);
    expect(html).toContain(EMPTY_COPY.references);
    expect(html).not.toContain('0 references');
    expect(html).not.toContain('0 figures');
  });

  it('objects are counted the way the EXPORT counts them (numbered = it will appear)', () => {
    const m = mockM(populatedDraft(), {
      assets: [
        { id: 'table:study-characteristics', kind: 'table' },
        { id: 'figure:prisma-flow', kind: 'figure' },
        { id: 'figure:funnel', kind: 'figure' },   // present but NOT numbered
      ],
      assetNumbering: { byId: { 'table:study-characteristics': 1, 'figure:prisma-flow': 1 }, unresolved: [] },
      references: [{ id: 'r1' }, { id: 'r2' }],
    });
    expect(manuscriptObjects(m)).toEqual({ tables: 1, figures: 1, references: 2 });
    const populated = view(m);
    expect(populated).toContain('1 table in the manuscript.');
    expect(populated).toContain('1 figure in the manuscript.');
    expect(populated).toContain('2 references in the manuscript.');
    expect(populated).not.toContain(EMPTY_COPY.figures);
  });
});

/* ══════════════ §28.6/§33 — "How is this connected?" ══════════════ */

describe('118.md §33 — Connected project data exposes the review it is wired to', () => {
  it('reports the real stage values, including the last synchronization', () => {
    const html = view(mockM(populatedDraft()));
    expect(html).toContain('data-testid="stitch-manuscript-data-sources"');
    expect(html).toContain('data-testid="stitch-manuscript-datasource-search"');
    expect(html).toContain('data-testid="stitch-manuscript-datasource-screening"');
    expect(html).toContain('data-testid="stitch-manuscript-datasource-extraction"');
    expect(html).toContain('data-testid="stitch-manuscript-datasource-analysis"');
    expect(html).toContain('data-testid="stitch-manuscript-datasource-prisma"');
    expect(html).toContain('Included studies: 12');
    expect(html).toContain('Meta-analysis results available (k=12)');
    expect(html).toContain('data-testid="stitch-manuscript-last-sync"');
    expect(html).toContain('Last synchronized');
    expect(html).toContain('Last searched');
  });

  it('an UNLINKED screening workspace says where the number really came from (§69)', () => {
    const rows = connectedDataRows(mockM(populatedDraft(), {
      dataStatus: { screening: 'unlinked', search: 'off', rob: 'off', grade: 'off', pecan: 'off' },
      searchProvenance: null,
    }));
    const screening = rows.find((r) => r.key === 'screening');
    expect(screening.detail).toBe('From the PRISMA counts you entered — the screening workspace is not linked.');
    expect(screening.state).toBe('warn');
    const search = rows.find((r) => r.key === 'search');
    expect(search.value).toBe('No completed search run yet');
  });

  it('§50 — a source that failed to load is named, and the manuscript keeps working', () => {
    const m = mockM(populatedDraft(), {
      dataStatus: { screening: 'ok', search: 'error', rob: 'error', grade: 'off', pecan: 'off' },
    });
    expect(failedSources(m.dataStatus)).toEqual(['search builder', 'risk of bias']);
    const html = view(m);
    expect(html).toContain('data-testid="stitch-manuscript-datasource-errors"');
    expect(html).toContain('Could not load: search builder, risk of bias.');
    expect(html).toContain('The manuscript still opens and exports');
  });

  it('a PRISMA flow that does not reconcile is stated, not hidden', () => {
    const rows = connectedDataRows(mockM(populatedDraft(), {
      prismaCounts: {
        counts: { identified: 1200, screened: 950, included: 12 },
        reconciliation: { ok: false, issues: [{ id: 'i1', severity: 'error', message: 'Included ≠ records' }] },
      },
    }));
    const prisma = rows.find((r) => r.key === 'prisma');
    expect(prisma.value).toBe('Counts do not reconcile');
    expect(prisma.state).toBe('error');
  });
});

/* ══════════════ §28.7/§35 — "What should I do before exporting?" ══════════════ */

describe('118.md §35 — the checklist reflects real state, from real export validation', () => {
  const base = () => ({
    draft: populatedDraft(),
    attention: { headline: 0 },
    readiness: { items: [{ key: 'prisma', label: 'PRISMA counts', complete: true }] },
    template: { id: 'generic', label: 'Generic biomedical journal', requiredStatements: [] },
    validation: { errors: [], warnings: [], info: [] },
  });
  const itemOf = (items, key) => items.find((i) => i.key === key);

  it('has no decorative checkboxes — every line carries a real state', () => {
    const html = view(mockM(populatedDraft()));
    expect(html).toContain('data-testid="stitch-manuscript-checklist"');
    expect(html).toContain('Before submission');
    const list = html.slice(html.indexOf('data-testid="stitch-manuscript-checklist"'));
    expect(list.slice(0, list.indexOf('stitch-manuscript-authorship'))).not.toContain('type="checkbox"');
    for (const key of ['verify-numbers', 'updates', 'prisma', 'objects', 'citations', 'journal']) {
      expect(html).toContain(`data-testid="stitch-manuscript-checklist-${key}"`);
    }
  });

  it('an export ERROR blocks; a WARNING never does (the 85.md B2 severity contract)', () => {
    const withError = submissionChecklist({
      ...base(),
      validation: { errors: [{ code: 'unknown-asset-ref', message: '[[table:x]] matches nothing.', action: 'Fix it.' }], warnings: [], info: [] },
    });
    expect(itemOf(withError, 'objects').state).toBe('blocked');

    const withWarning = submissionChecklist({
      ...base(),
      validation: { errors: [], warnings: [{ code: 'missing-caption', message: 'Table "t" has no caption.', action: 'Add one.' }], info: [] },
    });
    expect(itemOf(withWarning, 'objects').state).toBe('attention');
    expect(itemOf(withWarning, 'objects').detail).toBe('Table "t" has no caption.');
    // …and the page says so in words, without ever calling a warning a blocker
    const html = view(mockM(populatedDraft(), {
      assetNumbering: { byId: {}, unresolved: [] },
      // r2 — the code the placement scanner REALLY emits, taken from the engine
      // constant. This literal used to be 'plain-mention-mismatch', which nothing
      // emits, so the assertion below passed while the page silently mapped nothing.
      assetPlacements: { bySection: {}, fallback: [], warnings: [{ code: PLAIN_MENTION_CODE, message: 'Table 2 is mentioned but numbered 3.' }], plainMentions: [] },
    }));
    expect(html).toContain('Needs a look');
    expect(html).not.toContain('Blocks export');
  });

  it('every validateExport code the checklist claims maps to exactly one line', () => {
    const keys = new Set(['objects', 'citations', 'updates']);
    for (const code of Object.keys(CHECKLIST_CODE_ITEM)) {
      expect(keys.has(CHECKLIST_CODE_ITEM[code])).toBe(true);
    }
    // r2 — and no PHANTOM code survives in the map. The Overview shipped
    // 'plain-mention-mismatch'; the engine emits 'plain-mention-out-of-range'
    // (placement.js -> exportValidation.js), so the §35 numbering line read "Done"
    // while the export dialog was warning about exactly that finding. A
    // mapped-but-never-emitted code is indistinguishable from a clean manuscript.
    expect(CHECKLIST_CODE_ITEM['plain-mention-mismatch']).toBeUndefined();
    expect(CHECKLIST_CODE_ITEM[PLAIN_MENTION_CODE]).toBe('objects');
    /* r2 — and the map is checked against the REAL EMITTER, not against a string
       typed twice. A draft whose prose names "Table 4" when nothing will export
       under that number is exactly the drift §35 exists to surface: run the real
       scanner, take the code it produces, and require the checklist to own it. */
    const sections = [{ id: 'results', content: 'The pooled estimate is shown in Table 4.' }];
    const numbering = { orderTables: [], orderFigures: [], byId: {}, mentioned: new Set(), unresolved: [] };
    const pl = computePlacements({ sections, numbering, assets: [] });
    expect(pl.warnings.length).toBeGreaterThan(0);
    for (const w of pl.warnings) {
      expect(w.code, 'the emitter must produce a code the checklist owns').toBe(PLAIN_MENTION_CODE);
      expect(CHECKLIST_CODE_ITEM[w.code]).toBe('objects');
    }
    // …and it survives the trip through validateExport, which is what the page reads.
    const v = validateExport({
      draft: { sections: { results: { content: sections[0].content } } },
      assets: [], numbering, placements: pl,
    });
    const emitted = [...(v.errors || []), ...(v.warnings || [])].map((e) => e.code);
    expect(emitted).toContain(PLAIN_MENTION_CODE);
    const line = submissionChecklist({
      ...base(), validation: { errors: [], warnings: v.warnings.filter((w) => w.code === PLAIN_MENTION_CODE), info: [] },
    }).find((i) => i.key === 'objects');
    expect(line.state).toBe('attention');   // a warning, never a blocker (85.md B2)

    // findings nobody owns are reported separately — never silently dropped (§69)
    const rest = exportNotes({
      errors: [], warnings: [{ code: 'pending-save', message: 'A manuscript save is still in progress.' }], info: [],
    });
    expect(rest).toHaveLength(1);
    expect(rest[0].code).toBe('pending-save');
  });

  it('a real broken citation lands on the citations line, with a jump to References', () => {
    let d = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    d = setSection(d, 'results', 'The pooled estimate was large [[cite:missing-ref]].');
    const html = view(mockM(normalizeDraft(d), {
      references: [], referenceLibrary: { refs: [], aliases: {}, removedIds: new Set() },
    }));
    expect(html).toContain('data-testid="stitch-manuscript-checklist-citations"');
    expect(html).toContain('not in the reference library');
    expect(html).toContain('data-testid="stitch-manuscript-checklist-action-citations"');
    expect(html).toContain('Blocks export');
  });

  it('auto-drafted sections that were never read are what "verify results" means', () => {
    const items = submissionChecklist(base());
    const verify = itemOf(items, 'verify-numbers');
    expect(verify.state).toBe('attention');
    expect(verify.detail).toContain('auto-drafted section');
    expect(verify.action).toEqual({ label: 'Open Introduction', kind: 'section', target: 'introduction' });

    let read = populatedDraft();
    read = setSection(read, 'introduction', 'reviewed intro');
    read = setSection(read, 'discussion', 'reviewed discussion');
    expect(itemOf(submissionChecklist({ ...base(), draft: normalizeDraft(read) }), 'verify-numbers').state).toBe('done');
  });

  it('journal requirements are the TEMPLATE\'s required declarations vs what is written', () => {
    const draft = populatedDraft();
    draft.statements = { funding: 'None.' };
    const items = submissionChecklist({
      ...base(),
      draft,
      template: { id: 'x', label: 'JAMA', requiredStatements: ['funding', 'conflicts', 'ethics'] },
    });
    const journal = itemOf(items, 'journal');
    expect(journal.state).toBe('attention');
    expect(journal.detail).toBe('Missing required declarations: Conflicts of interest, Ethics approval.');
    expect(journal.action).toEqual({ label: 'Open Export', kind: 'tab', target: 'export' });
  });

  it('the updates line repeats the headline number and jumps to Updates', () => {
    const items = submissionChecklist({ ...base(), attention: { headline: 3 } });
    const upd = itemOf(items, 'updates');
    expect(upd.state).toBe('attention');
    expect(upd.detail).toBe('3 sections are behind the current project data.');
    expect(upd.action).toEqual({ label: 'Review updates', kind: 'tab', target: 'updates' });
    expect(itemOf(submissionChecklist(base()), 'updates').detail).toBe(EMPTY_COPY.updates);
  });
});

/* ══════════════ §49/§69 — no fake numbers, ever ══════════════ */

describe('118.md §49/§69 — nothing is claimed before the project data settles', () => {
  const loading = () => view(mockM(populatedDraft(), {
    sourcesSettled: false,
    sourcesFetchedAt: null,
    freshness: { status: 'unknown', label: 'Freshness unknown — source availability could not be determined', counts: {} },
    readiness: { items: [], score: { done: 0, total: 11, pct: 0 } },
  }));

  it('reserves the space with skeletons instead of rendering zeroes', () => {
    const html = loading();
    expect(html).toContain('data-testid="stitch-manuscript-readiness-skeleton"');
    expect(html).toContain('data-testid="stitch-manuscript-attention-skeleton"');
    expect(html).toContain('data-testid="stitch-manuscript-data-sources-skeleton"');
    expect(html).toContain('data-testid="stitch-manuscript-checklist-skeleton"');
    expect(html).toContain('data-testid="stitch-manuscript-objects-skeleton"');
    // …and every group heading is still there, so nothing moves when the data lands
    expect(html).toContain('Manuscript readiness');
    expect(html).toContain('Needs attention');
    expect(html).toContain('Connected project data');
    expect(html).toContain('Before submission');
  });

  it('never shows "0 references", a percentage, or a synchronized claim while loading', () => {
    const html = loading();
    expect(html).not.toContain('data-testid="stitch-manuscript-readiness-pct"');
    expect(html).not.toContain('0 references');
    expect(html).not.toContain('Included studies:');
    expect(html).not.toContain(EMPTY_COPY.updates);
    expect(html).not.toContain(EMPTY_COPY.references);
    expect(html).not.toContain('Last synchronized');
    // it says what it is doing instead
    expect(html).toContain('Reading your project data…');
    expect(html).toContain('Counting tables, figures and references…');
  });

  it('unknown freshness is displayed as unknown — never as "up to date"', () => {
    const html = loading();
    expect(html).toContain('Freshness unknown');
    expect(html).not.toContain('Fully synchronized');
  });

  it('the sections summary is still real while sources load (it needs no live data)', () => {
    const html = loading();
    expect(html).toContain('data-testid="stitch-manuscript-secrow-methods"');
    expect(html).toContain('Edited');
  });

  it('the CHEAP path only — the Overview never triggers the heavy sync plan or an export', () => {
    const refreshSyncPlan = vi.fn();
    const prepareExport = vi.fn();
    view(mockM(populatedDraft(), { refreshSyncPlan, prepareExport, outdated: { methods: true }, outdatedCount: 1 }));
    expect(refreshSyncPlan).not.toHaveBeenCalled();
    expect(prepareExport).not.toHaveBeenCalled();
    // …and no CODE path calls either of them (the module header names both, in prose,
    // to say why they are avoided — so the pin reads the code, not the comments).
    const code = readSource('src/features/manuscript/ManuscriptOverview.jsx')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('refreshSyncPlan');
    expect(code).not.toContain('prepareExport');
    const src = readSource('src/features/manuscript/ManuscriptOverview.jsx');
    // the reasons come from the pure hash diff the sections already carry
    expect(src).toContain('explainKeys(diffDeps(sec.depState, fresh, s.id))');
  });
});

/* ══════════════ §40 / §70 — shape and wiring ══════════════ */

describe('118.md §40 — grouped rows and dividers, not fifteen cards', () => {
  const html = view(mockM(populatedDraft()));

  it('the page is built from sections, not from a card per statistic', () => {
    expect((html.match(/<section/g) || []).length).toBeGreaterThanOrEqual(6);
    // the only rounded 12px surfaces left are the ones that are genuinely objects
    // (the intro note and the hero) — the old Card-per-Block wall is gone.
    expect((html.match(/border-radius:12px/g) || []).length).toBeLessThanOrEqual(2);
  });

  it('the duplicated Template / Citation style / Status selects are gone (the toolbar owns them)', () => {
    expect(html).not.toContain('Journal template');
    expect(html).not.toContain('Submission setup');
    expect((html.match(/<select/g) || []).length).toBe(0);
  });

  it('§28.7 — the page still ends with the real export action', () => {
    expect(html).toContain('data-testid="stitch-manuscript-overview-export"');
    expect(html).toContain('data-testid="stitch-manuscript-export-word"');
    expect(html).toContain('Export Word');
    // …and the other three export artefacts stay in the Export destination
    expect(html).not.toContain('Reproducibility .zip');
    expect(html).not.toContain('PRISMA-S checklist');
    expect(html).toContain('data-testid="stitch-manuscript-overview-export-more"');
  });

  it('§50 — a failed export is stated with the retry one click away', () => {
    const html2 = view(mockM(populatedDraft()), {}, );
    expect(html2).not.toContain('fix the problem and run the export again');
    const failed = renderToStaticMarkup(
      <ManuscriptOverview m={mockM(populatedDraft())} onOpenSection={noop} onNavigate={noop}
        exporters={{ ...mockExporters, exportError: 'Word export failed' }} />,
    );
    expect(failed).toContain('Word export failed — fix the problem and run the export again.');
  });

  it('the authorship editor is kept, with its stable ids', () => {
    expect(html).toContain('data-testid="stitch-manuscript-authorship"');
    expect(html).toContain('data-testid="stitch-manuscript-authorship-list"');
    expect(html).toContain('data-testid="stitch-manuscript-add-author"');
  });
});

describe('118.md §70 — the Overview is its own component, mounted by the panel', () => {
  it('OverviewPanel is a mount point that forwards the navigation seam', () => {
    const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
    expect(panels).toContain("import { ManuscriptOverview } from './ManuscriptOverview.jsx';");
    expect(panels).toContain('export function OverviewPanel({ m, exporters, onOpenSection, onNavigate }) {');
    expect(panels).toContain('<ManuscriptOverview m={m} exporters={exporters} onOpenSection={onOpenSection} onNavigate={onNavigate} />');
  });

  it('renders identically through the panel', () => {
    const m = mockM(populatedDraft());
    const direct = view(m);
    const viaPanel = renderToStaticMarkup(
      <OverviewPanel m={m} exporters={mockExporters} onOpenSection={noop} onNavigate={noop} />,
    );
    expect(viaPanel).toBe(direct);
  });

  it('stays on LEGACY tokens only — it renders in both shells', () => {
    const src = readSource('src/features/manuscript/ManuscriptOverview.jsx');
    expect(src).not.toMatch(/from '.*stitch.*'/);
    expect(src).not.toContain('var(--s-');
  });
});
