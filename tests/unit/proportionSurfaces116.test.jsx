/**
 * proportionSurfaces116.test.jsx — 116.md §41/§46/§49/§50 (r2).
 *
 * The adversarial-review pack for the SURFACES §41 left behind. §41 made raw proportion
 * rows poolable by deriving es/lo/hi at the analysis boundary; runMeta and the outcome
 * enumerators moved, but several counting/feedback surfaces kept scanning for a STORED
 * `es` and so contradicted the pool their own page was rendering:
 *
 *   §46  `gradeSuggestions` pre-filtered its input, so in a mixed project it graded a
 *        DIFFERENT primary outcome than the EVIDENCE BASE card beside it (I²=68% next to
 *        "I² = 0% … indicates consistent results"), and for a raw-only project produced
 *        no suggestions at all under a blurb promising data-derived ones.
 *   §46  `stepStatus.extraction` could never reach 'done' and `auditProject` nagged
 *        "N of M studies have no effect size" while analysis/forest/sensitivity were green.
 *   §49  A persisted override went permanently "out of date" the moment its conflict
 *        stopped blocking — telling the reviewer to "record a new override" beside a
 *        POOLED EFFECT, with no override form rendered anywhere.
 *   §50  An outcome whose every row is unusable never enumerates, so as soon as ANOTHER
 *        outcome was analysable it vanished from Analysis without a trace.
 *
 * House style: renderToStaticMarkup, no jsdom — initial render only, effects never run.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AnalysisTab, ForestTab, enumerateOutcomePairs, enumerateAllOutcomeGroups,
  proportionGate, proportionOverrideMoot, PROP_OVERRIDE_CLEAR_HINT,
} from '../../src/frontend/workspace/tabs/analysisTabs.jsx';
import { gradeSuggestions, stepStatus, auditProject } from '../../src/frontend/workspace/projectHelpers.js';
import { poolPrimaryOutcome } from '../../src/research-engine/statistics/summaryPool.js';
import { runMeta } from '../../src/research-engine/statistics/monolithStats.js';
import {
  checkProportionCompatibility, buildProportionOverride,
} from '../../src/research-engine/statistics/proportionCompatibility.js';

const OUTCOME = 'Diagnostic yield';
const KEY = `${OUTCOME}|||`;
const noop = () => {};

/** Raw §41 population: events/total only, no stored effect size. */
const raw = (over = {}) => ({
  id: 'r1', author: 'Smith', year: '2024', outcome: OUTCOME, timepoint: '', esType: 'PROP',
  es: '', lo: '', hi: '', events: '23', total: '59',
  design: 'cohort', adjusted: 'unadjusted', dataNature: 'primary', source: 'reported',
  denominatorPopulation: 'all_patients_tested', denominatorCustom: '', actionStatus: 'implemented',
  rob: {}, ...over,
});
const RAW_ROWS = [
  raw({ id: 'a', author: 'Alpha', events: '23', total: '59' }),
  raw({ id: 'b', author: 'Bravo', events: '31', total: '80' }),
  raw({ id: 'c', author: 'Charlie', events: '12', total: '44' }),
];
const smd = (id, over = {}) => ({
  id, author: 'S' + id, year: '2020', outcome: 'Pain score', timepoint: '', esType: 'SMD',
  es: '0.40', lo: '0.10', hi: '0.70', design: 'RCT', rob: {}, ...over,
});
const project = (studies, extra = {}) => ({
  id: 'p1', name: 'P', studies, prisma: {}, pico: {}, search: {}, reportChecked: {}, ...extra,
});

/* ═════════ §46 — GRADE grades the pool the panel beside it displays ═════════ */

describe('116.md §46 (r2) — gradeSuggestions pools the same rows the EVIDENCE BASE card does', () => {
  it('a raw-only proportion review gets the data-derived domains, not an empty panel', () => {
    const p = project(RAW_ROWS);
    // What the GRADE tab's own EVIDENCE BASE card shows (it pools project.studies raw):
    const shown = poolPrimaryOutcome(p.studies, 'random', {});
    expect(shown.result.k).toBe(3);

    const g = gradeSuggestions(p);
    // Every domain the blurb promises ("computed from your actual data — I², the pooled
    // CI, study count, and Egger's test") must be present when a pool exists.
    expect(g.inconsistency).toBeTruthy();
    expect(g.imprecision).toBeTruthy();
    expect(g.publicationBias).toBeTruthy();
    expect(g.inconsistency.reason).toContain(`I² = ${shown.result.I2}%`);
    expect(g.publicationBias.reason).toContain(`With only ${shown.result.k} studies (<10)`);
  });

  it('never grades a DIFFERENT outcome than the card reports', () => {
    // 3 raw PROP rows (first-seen outcome) + 2 stored-ES SMD rows. Pre-filtering the
    // input flipped the primary outcome to 'Pain score' while the card said
    // 'Diagnostic yield' — two contradictory I² values on one panel.
    const p = project([...RAW_ROWS, smd('x'), smd('y')]);
    const shown = poolPrimaryOutcome(p.studies, 'random', {});
    expect(shown.pair.key).toBe(KEY);
    const g = gradeSuggestions(p);
    expect(g.inconsistency.reason).toContain(`I² = ${shown.result.I2}%`);
    expect(g.publicationBias.reason).toContain(`With only ${shown.result.k} studies (<10)`);
  });

  it('still says so honestly when nothing pools', () => {
    const g = gradeSuggestions(project([raw({ id: 'z', total: '' })]));
    expect(g.inconsistency).toBeUndefined();
    expect(g.indirectness).toBeTruthy();   // the reviewer-judgement domain always shows
  });
});

/* ═════════ §46 — the workflow map + audit agree with runMeta ═════════ */

describe('116.md §46 (r2) — stepStatus and auditProject agree with the pool', () => {
  const p = project(RAW_ROWS);
  const k = runMeta(p.studies, 'random').k;

  it('extraction reaches done when every row is analyzable', () => {
    const st = stepStatus(p, false);
    expect(k).toBe(3);
    expect(st.analysis).toBe('done');
    expect(st.forest).toBe('done');
    // …and the step that FEEDS them can no longer be stuck at 'partial'.
    expect(st.extraction).toBe('done');
  });

  it('the audit stops reporting missing effect sizes for rows it simultaneously pools', () => {
    const msgs = auditProject(p).filter((i) => i.phase === 'Extract').map((i) => i.msg);
    expect(msgs.some((m) => /no effect size/.test(m))).toBe(false);
    // A genuinely empty row is still reported, in the wording analysisEligibility uses.
    const half = auditProject(project([...RAW_ROWS, raw({ id: 'z', events: '', total: '' })]));
    expect(half.filter((i) => i.phase === 'Extract').map((i) => i.msg)
      .some((m) => m === '1 of 4 studies have no effect size or raw data entered.')).toBe(true);
  });
});

/* ═════════ §46 — the Overview card's counts (source-level pin: no jsdom) ═════════ */

describe('116.md §46 (r2) — the Overview stat tile / .R gate read the shared predicate', () => {
  // overviewTabs.jsx imports serverStorage (touches `window`), so it cannot be loaded in
  // the hermetic Node env — the house technique for that is a source-level wiring pin
  // (see opsGovernanceWiring.test.jsx). The behaviour it guards is asserted above via
  // the SAME predicate module the file now imports.
  const SRC = readFileSync(new URL('../../src/frontend/workspace/tabs/overviewTabs.jsx', import.meta.url), 'utf8');
  it('withES / poolable come from poolableRow, never from an inlined stored-es scan', () => {
    expect(SRC).toMatch(/import \{ rowHasEffect, rowIsPoolable \} from "\.\.\/\.\.\/\.\.\/research-engine\/statistics\/poolableRow\.js"/);
    expect(SRC).toMatch(/const withES=studies\.filter\(s=>rowHasEffect\(s\)\)\.length;/);
    expect(SRC).toMatch(/const poolable=studies\.filter\(s=>rowIsPoolable\(s\)\)\.length;/);
    expect(SRC).not.toMatch(/studies\.filter\(s=>s\.es!==""\)/);
    expect(SRC).not.toMatch(/studies\.filter\(s=>s\.es!==""&&s\.lo!==""&&s\.hi!==""\)/);
  });
});

/* ═════════ §49 — a moot override never contradicts the result beside it ═════════ */

/* The upgrade shape: pre-116 `category-and-unclassified` was a BLOCKING issue, so the
   override form was offered for it for nine minor versions. §116 D2 moved it to the warn
   tier, which empties `check.issues` — every such stored consent record becomes stale
   AND moot on upgrade. */
const WARN_TIER = [
  raw({ id: '1', author: 'Smith' }),
  raw({ id: '2', author: 'Jones', events: '19', total: '61' }),
  raw({ id: '3', author: 'Lee', events: '9', total: '40', denominatorPopulation: '' }),
];
const PRE116_CHECK = (() => {
  const post = checkProportionCompatibility(WARN_TIER);
  return { ...post, issues: [...post.issues, ...post.warnings], blocking: true };
})();
const LEGACY_OVERRIDE = buildProportionOverride(PRE116_CHECK, {
  at: '2026-08-09T09:00:00.000Z', by: 'Dr Reviewer', note: 'Same tested cohort.',
});

describe('116.md §49 (r2) — an override with nothing left to block is OBSOLETE, not "out of date"', () => {
  const p = project(WARN_TIER, { analysisSettings: { proportionOverrides: { [KEY]: LEGACY_OVERRIDE } } });
  const pair = enumerateOutcomePairs(WARN_TIER)[0];

  it('the gate reports it as moot, and pooling is unaffected', () => {
    const g = proportionGate(p, pair, WARN_TIER);
    expect(g.check.blocking).toBe(false);
    expect(g.stale).toBe(true);
    expect(g.honored).toBe(false);
    expect(g.moot).toBe(true);
    expect(g.blocked).toBe(false);
    // one formula, shared with the panel
    expect(proportionOverrideMoot(g.check, g.override, g.stale)).toBe(true);
  });

  it('AnalysisTab shows the pooled result and does NOT ask for an override it cannot offer', () => {
    const html = renderToStaticMarkup(createElement(AnalysisTab, { project: p, updateProject: noop }));
    expect(html).toContain('POOLED EFFECT');
    expect(html).toContain('Recorded override no longer applies');
    expect(html).toContain('Remove the obsolete override record');
    // the three contradictions
    expect(html).not.toContain('record a new override if you still intend to pool');
    expect(html).not.toContain('The estimates have changed since');
    expect(html).not.toContain('Recorded override is out of date');
    // …and the copy is honest about the form's absence
    expect(html).not.toContain('Pool anyway (record override)');
  });

  it('the compact Forest mount offers a way out instead of a banner with no actions', () => {
    const html = renderToStaticMarkup(createElement(ForestTab, { project: p }));
    expect(html).toContain('Recorded override no longer applies');
    expect(html).toContain(PROP_OVERRIDE_CLEAR_HINT);
    expect(html).not.toContain('record a new override if you still intend to pool');
    expect(html).toContain('PUBLICATION-STYLE FIGURE');   // the figure really did render
  });
});

/* ═════════ §50 — an outcome nobody can analyse is still visible ═════════ */

const BROKEN_PROP = [
  raw({ id: 'p1', author: 'Nolan', outcome: 'Complication rate', events: '4', total: '' }),
  raw({ id: 'p2', author: 'Ochoa', outcome: 'Complication rate', events: '7', total: '' }),
  raw({ id: 'p3', author: 'Pike', outcome: 'Complication rate', events: '2', total: '' }),
];

describe('116.md §50 (r2) — an outcome with zero usable rows is named, not silently dropped', () => {
  it('enumerateAllOutcomeGroups sees what enumerateOutcomePairs cannot', () => {
    const rows = [...RAW_ROWS, ...BROKEN_PROP];
    expect(enumerateOutcomePairs(rows).map((p) => p.key)).toEqual([KEY]);
    expect(enumerateAllOutcomeGroups(rows).map((g) => g.key)).toEqual([KEY, 'Complication rate|||']);
    // reviewer-excluded rows stay out of both
    const excluded = [...RAW_ROWS, raw({ id: 'x', outcome: 'Archived', extractionMeta: { archived: true } })];
    expect(enumerateAllOutcomeGroups(excluded).map((g) => g.key)).toEqual([KEY]);
  });

  it('AnalysisTab names it with counted reasons while another outcome pools', () => {
    const html = renderToStaticMarkup(createElement(AnalysisTab, {
      project: project([...RAW_ROWS, ...BROKEN_PROP]), updateProject: noop,
    }));
    expect(html).toContain('POOLED EFFECT');                 // the good outcome still pools
    expect(html).toContain('CANNOT BE ANALYSED');
    expect(html).toContain('Complication rate');
    expect(html).toContain('3 studies are missing total sample size.');
  });

  it('reports it with ≥2 analysable outcomes too (the ≥1 case is not a special case)', () => {
    const html = renderToStaticMarkup(createElement(AnalysisTab, {
      project: project([...RAW_ROWS, smd('x'), smd('y'), ...BROKEN_PROP]), updateProject: noop,
    }));
    expect(html).toContain('2 outcomes detected');
    expect(html).toContain('Complication rate');
    expect(html).toContain('3 studies are missing total sample size.');
  });

  it('an ordinary project renders no such block', () => {
    const html = renderToStaticMarkup(createElement(AnalysisTab, { project: project(RAW_ROWS), updateProject: noop }));
    expect(html).not.toContain('CANNOT BE ANALYSED');
    expect(html).not.toContain('unanalyzable-outcomes');
  });
});
