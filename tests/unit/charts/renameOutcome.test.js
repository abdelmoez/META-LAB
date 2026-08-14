/**
 * renameOutcome.test.js — 116.md §27 (decision D4).
 *
 * WHAT IS PINNED (the ONE outcome-rename path):
 *  1. studies[].outcome is rewritten and EVERY name-keyed analysisSettings map is
 *     migrated in the SAME atomic operation — a stale `oldName|||tp` key never
 *     survives a rename (that is how a project silently lost its proportion
 *     filters, compatibility overrides and figure labels).
 *  2. NAME_KEYED_ANALYSIS_MAPS is the registry any new per-outcome map must join;
 *     the test enumerates it so adding a map without migrating it fails here.
 *  3. Timepoint-safe: an explicitly scoped rename touches only that timepoint.
 *  4. A no-op (same name, empty name, no matching rows) returns the ORIGINAL
 *     project object — no blob churn, no autosave, no CAS round-trip.
 *  5. Merging into an existing outcome keeps the DESTINATION's configuration.
 *  6. serverKeyMigrations reports the exact `outcome|||timepoint` pairs the
 *     relational rows (GradeOutcomeAssessment.outcomeKey, RobAssessment.outcomeId)
 *     need, so the same act can migrate them.
 *  7. Figure-title edits and outcome renames are different writers: writeFigureLabels
 *     can never change an outcome name (116.md §27's explicit requirement).
 */
import { describe, it, expect } from 'vitest';
import {
  renameOutcome, setStudyDisplayName, outcomePairKey, splitPairKey, NAME_KEYED_ANALYSIS_MAPS,
} from '../../../src/research-engine/project-model/renameOutcome.js';
import {
  writeFigureLabels, writeProportionFilter, writeProportionOverride,
  enumerateOutcomePairs, pairFigureLabels,
} from '../../../src/frontend/workspace/tabs/analysisTabs.jsx';

const OLD = 'Mortalty';           // the typo a reviewer notices on the forest plot
const NEW = 'Mortality';
const study = (o = {}) => ({
  id: o.id || 's1', author: o.author || 'Smith', year: o.year || '2020',
  outcome: o.outcome === undefined ? OLD : o.outcome,
  timepoint: o.timepoint === undefined ? '30 d' : o.timepoint,
  esType: 'OR', es: '-0.3', lo: '-0.6', hi: '-0.05',
});

function project() {
  let p = {
    id: 'p1', name: 'Review',
    studies: [study({ id: 's1' }), study({ id: 's2', author: 'Lee' }), study({ id: 's3', timepoint: '1 y' })],
  };
  p = writeProportionFilter(p, outcomePairKey(OLD, '30 d'), 'denominatorPopulation', 'all_patients_tested');
  p = writeProportionOverride(p, outcomePairKey(OLD, '30 d'), { at: 'x', by: 'Lee', note: '', signature: 'sig' });
  p = writeFigureLabels(p, outcomePairKey(OLD, '30 d'), { title: 'Primary figure', favLow: 'Favours intervention' });
  p = writeFigureLabels(p, outcomePairKey(OLD, '1 y'), { esLabel: 'OR at one year' });
  return p;
}

describe('116.md §27 — the rename rewrites rows AND every name-keyed map', () => {
  it('renames every study row with that outcome, across timepoints', () => {
    const res = renameOutcome(project(), OLD, NEW);
    expect(res.changed).toBe(true);
    expect(res.studiesChanged).toBe(3);
    expect(res.project.studies.every((s) => s.outcome === NEW)).toBe(true);
    expect(res.project.studies.map((s) => s.timepoint)).toEqual(['30 d', '30 d', '1 y']);
  });

  it('migrates proportionFilters, proportionOverrides and figureLabels together', () => {
    const { project: p } = renameOutcome(project(), OLD, NEW);
    const as = p.analysisSettings;
    const k30 = outcomePairKey(NEW, '30 d');
    const k1y = outcomePairKey(NEW, '1 y');
    expect(as.proportionFilters[k30].denominatorPopulation).toBe('all_patients_tested');
    expect(as.proportionOverrides[k30].signature).toBe('sig');
    expect(as.figureLabels[k30].title).toBe('Primary figure');
    expect(as.figureLabels[k1y].esLabel).toBe('OR at one year');
  });

  it('NO stale key survives — the old pair keys are gone from every map', () => {
    const { project: p } = renameOutcome(project(), OLD, NEW);
    const stale = [outcomePairKey(OLD, '30 d'), outcomePairKey(OLD, '1 y')];
    NAME_KEYED_ANALYSIS_MAPS.forEach((name) => {
      const map = (p.analysisSettings || {})[name];
      if (!map) return;
      stale.forEach((k) => expect(Object.prototype.hasOwnProperty.call(map, k)).toBe(false));
      Object.keys(map).forEach((k) => expect(splitPairKey(k).outcome).toBe(NEW));
    });
  });

  it('the registry names exactly the maps 116 knows about (add new maps here)', () => {
    expect(NAME_KEYED_ANALYSIS_MAPS).toEqual([
      'proportionFilters', 'proportionOverrides', 'figureLabels', 'contributionColumns', 'modelOverrides',
    ]);
  });

  it('the renamed outcome is the one Analysis enumerates and reads labels for', () => {
    const { project: p } = renameOutcome(project(), OLD, NEW);
    const pairs = enumerateOutcomePairs(p.studies);
    expect(pairs.map((x) => x.outcome)).toEqual([NEW, NEW]);
    const pair30 = pairs.find((x) => x.timepoint === '30 d');
    expect(pairFigureLabels(p, pair30).title).toBe('Primary figure');
  });
});

describe('116.md §27 — timepoint-safe scoping', () => {
  it('an explicitly scoped rename touches only that timepoint', () => {
    const res = renameOutcome(project(), OLD, NEW, { timepoint: '30 d' });
    expect(res.studiesChanged).toBe(2);
    expect(res.project.studies.map((s) => s.outcome)).toEqual([NEW, NEW, OLD]);
    const as = res.project.analysisSettings;
    expect(as.figureLabels[outcomePairKey(NEW, '30 d')].title).toBe('Primary figure');
    expect(as.figureLabels[outcomePairKey(OLD, '1 y')].esLabel).toBe('OR at one year');
  });
});

describe('no-ops leave the project object untouched (no blob churn)', () => {
  it.each([
    ['the same name', NEW, NEW, 'same'],
    ['an empty new name', OLD, '   ', 'empty'],
    ['an outcome that does not exist', 'Nope', 'Other', 'no-match'],
  ])('%s → unchanged', (_label, from, to, reason) => {
    const p = project();
    const res = renameOutcome(p, from, to, {});
    expect(res.changed).toBe(false);
    expect(res.reason).toBe(reason);
    expect(res.project).toBe(p);
  });

  it('a null project is inert', () => {
    expect(renameOutcome(null, OLD, NEW).changed).toBe(false);
  });

  it('trims whitespace on both sides before comparing', () => {
    const res = renameOutcome(project(), `  ${OLD}  `, `  ${NEW}  `);
    expect(res.changed).toBe(true);
    expect(res.project.studies[0].outcome).toBe(NEW);
  });
});

describe('merging into an existing outcome', () => {
  it('keeps the DESTINATION configuration rather than clobbering it with the source', () => {
    let p = project();
    p = { ...p, studies: [...p.studies, study({ id: 's4', outcome: NEW })] };
    p = writeFigureLabels(p, outcomePairKey(NEW, '30 d'), { title: 'Existing figure' });
    const res = renameOutcome(p, OLD, NEW);
    expect(res.changed).toBe(true);
    expect(res.project.analysisSettings.figureLabels[outcomePairKey(NEW, '30 d')].title).toBe('Existing figure');
    expect(res.migratedKeys.some((m) => m.merged)).toBe(true);
  });
});

describe('116.md §27 — relational rows keyed by the outcome text', () => {
  it('reports the exact key pairs GradeOutcomeAssessment / RobAssessment need', () => {
    const res = renameOutcome(project(), OLD, NEW);
    const pairs = res.serverKeyMigrations.map((m) => `${m.from} => ${m.to}`).sort();
    expect(pairs).toEqual([
      `${outcomePairKey(OLD, '1 y')} => ${outcomePairKey(NEW, '1 y')}`,
      `${outcomePairKey(OLD, '30 d')} => ${outcomePairKey(NEW, '30 d')}`,
    ]);
  });
});

describe('116.md §27 — figure-local edits can never rename an outcome', () => {
  it('writeFigureLabels changes only analysisSettings.figureLabels', () => {
    const p = project();
    const next = writeFigureLabels(p, outcomePairKey(OLD, '30 d'), { title: 'A different caption' });
    expect(next.studies).toBe(p.studies);
    expect(next.studies.every((s) => s.outcome === OLD)).toBe(true);
    expect(next.analysisSettings.figureLabels[outcomePairKey(OLD, '30 d')].title).toBe('A different caption');
  });

  it('clearing a label field deletes it, and an emptied container disappears', () => {
    let p = { id: 'p', studies: [] };
    p = writeFigureLabels(p, 'k|||', { title: 'x', favLow: 'y' });
    p = writeFigureLabels(p, 'k|||', { title: '' });
    expect(p.analysisSettings.figureLabels['k|||']).toEqual({ favLow: 'y' });
    p = writeFigureLabels(p, 'k|||', { favLow: null });
    expect('analysisSettings' in p).toBe(false);
  });
});

describe('116.md §27 — study display names are PROJECT edits', () => {
  it('setStudyDisplayName writes the extraction row every surface reads', () => {
    const p = project();
    const next = setStudyDisplayName(p, 's2', { author: 'Lee-Hamilton', year: '2022' });
    expect(next.studies.find((s) => s.id === 's2')).toMatchObject({ author: 'Lee-Hamilton', year: '2022' });
    expect(next.studies.find((s) => s.id === 's1')).toBe(p.studies[0]);
  });

  it('introduces NO new study-row keys (global invariant 4 — syncHash stability)', () => {
    const p = project();
    const before = Object.keys(p.studies[0]).sort();
    const next = setStudyDisplayName(p, 's1', { author: 'Smythe' });
    expect(Object.keys(next.studies[0]).sort()).toEqual(before);
  });

  it('is a no-op when nothing actually changes', () => {
    const p = project();
    expect(setStudyDisplayName(p, 's1', { author: 'Smith' })).toBe(p);
    expect(setStudyDisplayName(p, 'nope', { author: 'X' })).toBe(p);
  });
});
