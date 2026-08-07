/**
 * caseSeries.test.js — 106.md (Case Series Extraction Mode). Pure engine over mkStudy
 * rows: the case namespace, add/duplicate/remove/rename/reorder, article-level
 * propagation, the counting contract (publications never inflate to cases), the
 * case-level export, and the structured patient-column table mapper. No server/DB.
 */
import { describe, it, expect } from 'vitest';
import { mkStudy } from '../../src/research-engine/project-model/defaults.js';
import { attachProvenance, readProvenance } from '../../src/research-engine/extraction/engine/articleProvenance.js';
import {
  ARTICLE_LEVEL_FIELDS, isArticleLevelField,
  caseInfoOf, isCaseRow, publicationIdOf, caseDisplayName, caseCitationLabel, publicationKeyOf,
  casesForPublication, activeCasesForPublication, caseGroupForStudy, caseSummary, caseProgressOf,
  mkCaseVariable, caseVarKey, isCaseVarKey, caseVarIdFromKey, normalizeCaseVariables, defaultCaseVariables,
  enableCaseSeries, disableCaseSeries, addCase, duplicateCase, removeCase, renameCase, reorderCases,
  propagateArticleFields,
  countPublications, countCases, countCaseSeriesArticles, caseSeriesCounts,
  caseObservations, buildCaseExportRows, buildCasesFromTable,
} from '../../src/research-engine/extraction/caseSeries.js';

let seq = 0;
const idFn = () => `gen${++seq}`;
const reset = () => { seq = 0; };
const row = (over = {}) => ({ ...mkStudy(), ...over });

/** A three-case series of Smith 2024, plus one ordinary study. */
function series() {
  reset();
  const studies = [
    row({ id: 's1', doi: '10.1/smith', author: 'Smith', year: '2024', title: 'Case series of 8 patients', journal: 'J Med', design: 'Case series' }),
    row({ id: 's2', doi: '10.2/jones', author: 'Jones', year: '2019', title: 'A cohort study' }),
  ];
  const en = enableCaseSeries(studies, 's1', { idFn });
  let out = en.studies;
  const pid = en.publicationId;
  out = addCase(out, pid, { mkStudy, idFn }).studies;
  out = addCase(out, pid, { mkStudy, idFn }).studies;
  return { studies: out, pid };
}

describe('the case namespace', () => {
  it('an ordinary study is not a case and has no publication id', () => {
    const st = row({ id: 'x' });
    expect(isCaseRow(st)).toBe(false);
    expect(caseInfoOf(st)).toBeNull();
    expect(publicationIdOf(st)).toBe('');
    expect(caseDisplayName(st)).toBe('');
  });

  it('a half-written namespace is not treated as a case', () => {
    const st = row({ id: 'x', extractionMeta: { caseSeries: { publicationId: 'pub_1' } } });
    expect(isCaseRow(st)).toBe(false);
  });

  it('names a case "Case N" until it is renamed', () => {
    const { studies } = series();
    const cases = casesForPublication(studies, publicationIdOf(studies[0]));
    expect(cases.map(caseDisplayName)).toEqual(['Case 1', 'Case 2', 'Case 3']);
    expect(caseCitationLabel(cases[2])).toBe('Smith 2024 — Case 3');
  });
});

describe('enableCaseSeries', () => {
  it('turns the open article into Case 1 without copying or losing anything', () => {
    reset();
    const studies = [row({ id: 's1', doi: '10.1/x', author: 'Smith', year: '2024', es: '1.5', a: '10' })];
    const r = enableCaseSeries(studies, 's1', { idFn });
    expect(r.error).toBeUndefined();
    expect(r.studies).toHaveLength(1);                 // no row was added
    expect(r.studies[0].es).toBe('1.5');               // no value was lost
    expect(r.studies[0].a).toBe('10');
    const info = caseInfoOf(r.studies[0]);
    expect(info.caseNumber).toBe(1);
    expect(info.publicationId).toBe(r.publicationId);
  });

  it('is idempotent — re-enabling returns the same publication id', () => {
    const { studies, pid } = series();
    const again = enableCaseSeries(studies, studies[0].id, { idFn });
    expect(again.publicationId).toBe(pid);
    expect(again.studies).toHaveLength(studies.length);
    expect(again.converted).toBe(0);
  });

  it('reports how many existing rows it converted, so the UI can say so', () => {
    reset();
    const one = enableCaseSeries([row({ id: 'a', doi: '10.1/x' })], 'a', { idFn });
    expect(one.converted).toBe(1);
    reset();
    const three = enableCaseSeries([
      row({ id: 'a', doi: '10.1/x', outcome: 'Mortality' }),
      row({ id: 'b', doi: '10.1/x', outcome: 'Survival' }),
      row({ id: 'c', doi: '10.1/x', outcome: 'QoL' }),
    ], 'a', { idFn });
    expect(three.converted).toBe(3);
  });

  it('is DETERMINISTIC for a given idFn — a re-invoked React updater cannot mint two series', () => {
    const rows = [row({ id: 'a', doi: '10.1/x' }), row({ id: 'b', doi: '10.1/x' })];
    const gen = () => { let n = 0; return () => `seed${n++}`; };
    const first = enableCaseSeries(rows, 'a', { idFn: gen() });
    const second = enableCaseSeries(rows, 'a', { idFn: gen() });
    expect(second.publicationId).toBe(first.publicationId);
    expect(JSON.stringify(second.studies)).toBe(JSON.stringify(first.studies));
  });

  it('sweeps the paper\'s existing outcome rows into the same publication', () => {
    reset();
    const studies = [
      row({ id: 'a', doi: '10.1/x', author: 'Smith', year: '2024', outcome: 'Mortality' }),
      row({ id: 'b', doi: '10.1/X', author: 'Smith', year: '2024', outcome: 'Survival' }),
      row({ id: 'c', doi: '10.9/other', author: 'Jones', year: '2020' }),
    ];
    const r = enableCaseSeries(studies, 'a', { idFn });
    expect(publicationIdOf(r.studies[0])).toBe(r.publicationId);
    expect(publicationIdOf(r.studies[1])).toBe(r.publicationId);
    expect(publicationIdOf(r.studies[2])).toBe('');     // an unrelated paper is untouched
    expect(caseInfoOf(r.studies[1]).caseNumber).toBe(2);
  });

  it('a WEAK citation identity never sweeps an unrelated study into the series', () => {
    reset();
    // Two different 2020 Smith trials, neither with a DOI/PMID/title → weak key.
    const studies = [row({ id: 'a', author: 'Smith', year: '2020' }), row({ id: 'b', author: 'Smith', year: '2020' })];
    const r = enableCaseSeries(studies, 'a', { idFn });
    expect(publicationIdOf(r.studies[0])).toBe(r.publicationId);
    expect(publicationIdOf(r.studies[1])).toBe('');
  });

  it('rejects an unknown row', () => {
    expect(enableCaseSeries([], 'nope', { idFn }).error).toBeTruthy();
  });
});

describe('disableCaseSeries', () => {
  it('strips the namespace without deleting rows or values', () => {
    const { studies, pid } = series();
    const withVals = studies.map((st) => (isCaseRow(st) ? { ...st, [caseVarKey('age')]: '54' } : st));
    const r = disableCaseSeries(withVals, pid);
    expect(r.error).toBeUndefined();
    expect(r.cleared).toBe(3);
    expect(r.studies).toHaveLength(withVals.length);                     // nothing deleted
    expect(r.studies.filter(isCaseRow)).toHaveLength(0);                 // no longer cases
    expect(r.studies[0][caseVarKey('age')]).toBe('54');                  // values preserved
  });

  it('rejects a publication that does not exist', () => {
    expect(disableCaseSeries([], 'pub_nope').error).toBeTruthy();
  });
});

describe('addCase / duplicateCase', () => {
  it('a new case inherits ARTICLE-level fields only — patient values start blank', () => {
    reset();
    const base = [row({
      id: 's1', doi: '10.1/x', author: 'Smith', year: '2024', journal: 'J Med',
      design: 'Case series', country: 'UK', funding: 'None',
      es: '1.5', a: '10', b: '20', notes: 'patient one',
      [caseVarKey('age')]: '42',
    })];
    const en = enableCaseSeries(base, 's1', { idFn });
    const r = addCase(en.studies, en.publicationId, { mkStudy, idFn });
    const fresh = r.studies.find((st) => st.id === r.id);

    expect(fresh.author).toBe('Smith');
    expect(fresh.journal).toBe('J Med');
    expect(fresh.design).toBe('Case series');
    expect(fresh.country).toBe('UK');
    expect(fresh.funding).toBe('None');
    // ...but nothing patient-level came across
    expect(fresh.es).toBe('');
    expect(fresh.a).toBe('');
    expect(fresh.notes).toBe('');
    expect(fresh[caseVarKey('age')]).toBeUndefined();
    expect(caseInfoOf(fresh).caseNumber).toBe(2);
  });

  it('inserts the new case directly after the article\'s last case', () => {
    const { studies, pid } = series();
    const r = addCase(studies, pid, { mkStudy, idFn });
    const ids = r.studies.map((st) => st.id);
    expect(ids.indexOf(r.id)).toBe(3);          // after s1 + 2 added cases, before Jones
    expect(ids[4]).toBe('s2');
  });

  it('requires an mkStudy factory and a real publication', () => {
    const { studies, pid } = series();
    expect(addCase(studies, pid, {}).error).toBeTruthy();
    expect(addCase(studies, 'pub_nope', { mkStudy, idFn }).error).toBeTruthy();
  });

  it('duplicateCase copies the values but clears completion and takes a new number', () => {
    const { studies, pid } = series();
    const first = casesForPublication(studies, pid)[0];
    const primed = studies.map((st) => (st.id === first.id
      ? { ...st, es: '2.0', [caseVarKey('age')]: '61', extractionMeta: { ...st.extractionMeta, completedAt: 'T', locked: true } }
      : st));
    const r = duplicateCase(primed, first.id, { idFn });
    const copy = r.studies.find((st) => st.id === r.id);
    expect(copy.es).toBe('2.0');
    expect(copy[caseVarKey('age')]).toBe('61');
    expect(copy.extractionMeta.completedAt).toBeUndefined();
    expect(copy.extractionMeta.locked).toBeUndefined();
    expect(caseInfoOf(copy).caseNumber).toBe(4);
    expect(caseInfoOf(copy).caseId).not.toBe(caseInfoOf(first).caseId);
  });

  it('duplicateCase refuses a non-case row', () => {
    const { studies } = series();
    expect(duplicateCase(studies, 's2', { idFn }).error).toBeTruthy();
  });

  it('a duplicate never inherits the source case\'s PDF COORDINATES', () => {
    const { studies, pid } = series();
    const first = casesForPublication(studies, pid)[0];
    const sourced = studies.map((st) => (st.id === first.id
      ? attachProvenance({ ...st, [caseVarKey('age')]: '61' }, caseVarKey('age'),
        { method: 'click', page: 4, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 }, excerpt: '61', fileKey: 'doc:smith.pdf' })
      : st));
    const r = duplicateCase(sourced, first.id, { idFn });
    const copy = r.studies.find((st) => st.id === r.id);

    expect(copy[caseVarKey('age')]).toBe('61');            // the VALUE is copied…
    const p = readProvenance(copy, caseVarKey('age'));
    expect(p).toBeTruthy();                                 // …and stays auditable…
    expect(p.page).toBeNull();                              // …but claims no location
    expect(p.bbox).toBeNull();
    expect(p.method).toBe('manual');
    // the source is untouched
    expect(readProvenance(sourced.find((st) => st.id === first.id), caseVarKey('age')).page).toBe(4);
  });

  it('a duplicate does not inherit "In analysis" from the case it was copied from', () => {
    const { studies, pid } = series();
    const first = casesForPublication(studies, pid)[0];
    const synced = studies.map((st) => (st.id === first.id
      ? { ...st, extractionMeta: { ...st.extractionMeta, syncHash: 'abc', syncedAt: 'T', syncedBy: 'u1' } } : st));
    const r = duplicateCase(synced, first.id, { idFn });
    const meta = r.studies.find((st) => st.id === r.id).extractionMeta;
    expect(meta.syncHash).toBeUndefined();
    expect(meta.syncedAt).toBeUndefined();
    expect(meta.syncedBy).toBeUndefined();
  });
});

describe('removeCase', () => {
  it('deletes a case and renumbers the survivors contiguously', () => {
    const { studies, pid } = series();
    const cases = casesForPublication(studies, pid);
    const r = removeCase(studies, cases[1].id);
    expect(r.error).toBeUndefined();
    const left = casesForPublication(r.studies, pid);
    expect(left).toHaveLength(2);
    expect(left.map((st) => caseInfoOf(st).caseNumber)).toEqual([1, 2]);
    expect(r.nextOpenId).toBe(left[1].id);
  });

  it('never removes the last case of a series', () => {
    reset();
    const en = enableCaseSeries([row({ id: 's1', doi: '10.1/x' })], 's1', { idFn });
    expect(removeCase(en.studies, 's1').error).toBeTruthy();
  });

  it('leaves other publications untouched', () => {
    const { studies, pid } = series();
    const cases = casesForPublication(studies, pid);
    const r = removeCase(studies, cases[2].id);
    expect(r.studies.find((st) => st.id === 's2')).toBeTruthy();
  });
});

describe('renameCase / reorderCases', () => {
  it('renaming sets a custom label; clearing it restores "Case N"', () => {
    const { studies, pid } = series();
    const c2 = casesForPublication(studies, pid)[1];
    const named = renameCase(studies, c2.id, '  62F, index patient ').studies;
    expect(caseDisplayName(named.find((st) => st.id === c2.id))).toBe('62F, index patient');
    const cleared = renameCase(named, c2.id, '').studies;
    expect(caseDisplayName(cleared.find((st) => st.id === c2.id))).toBe('Case 2');
  });

  it('renameCase refuses a non-case row', () => {
    const { studies } = series();
    expect(renameCase(studies, 's2', 'x').error).toBeTruthy();
  });

  it('reorderCases renumbers into the given order and appends the rest', () => {
    const { studies, pid } = series();
    const [a, b, c] = casesForPublication(studies, pid);
    const r = reorderCases(studies, pid, [c.id, a.id]);
    const after = casesForPublication(r.studies, pid);
    expect(after.map((st) => st.id)).toEqual([c.id, a.id, b.id]);
    expect(after.map((st) => caseInfoOf(st).caseNumber)).toEqual([1, 2, 3]);
  });
});

describe('propagateArticleFields (106.md §Shared article-level information)', () => {
  it('mirrors article-level edits onto every sibling case', () => {
    const { studies, pid } = series();
    const target = casesForPublication(studies, pid)[1];
    const r = propagateArticleFields(studies, target.id, { journal: 'NEJM', doi: '10.1/corrected' }, { at: 'T1' });
    expect(r.propagated.sort()).toEqual(['doi', 'journal']);
    for (const st of casesForPublication(r.studies, pid)) {
      expect(st.journal).toBe('NEJM');
      expect(st.doi).toBe('10.1/corrected');
    }
    expect(r.studies.find((st) => st.id === 's2').journal).toBe('');   // other papers untouched
  });

  it('keeps CASE-level edits on the edited case only', () => {
    const { studies, pid } = series();
    const [c1, c2] = casesForPublication(studies, pid);
    const r = propagateArticleFields(studies, c2.id, { es: '3.1', [caseVarKey('age')]: '56' });
    expect(r.propagated).toEqual([]);
    expect(r.studies.find((st) => st.id === c2.id).es).toBe('3.1');
    expect(r.studies.find((st) => st.id === c1.id).es).toBe('');
    expect(r.studies.find((st) => st.id === c1.id)[caseVarKey('age')]).toBeUndefined();
  });

  it('a mixed patch splits correctly', () => {
    const { studies, pid } = series();
    const [c1, c2] = casesForPublication(studies, pid);
    const r = propagateArticleFields(studies, c2.id, { year: '2025', es: '9' });
    expect(r.studies.find((st) => st.id === c1.id).year).toBe('2025');
    expect(r.studies.find((st) => st.id === c1.id).es).toBe('');
    expect(r.studies.find((st) => st.id === c2.id).es).toBe('9');
  });

  it('behaves as a plain single-row patch for an ordinary study', () => {
    const { studies } = series();
    const r = propagateArticleFields(studies, 's2', { journal: 'Lancet' });
    expect(r.propagated).toEqual([]);
    expect(r.studies.find((st) => st.id === 's2').journal).toBe('Lancet');
  });

  it('article-level fields cover the 106.md list', () => {
    for (const f of ['author', 'authors', 'year', 'journal', 'doi', 'pmid', 'country', 'design', 'funding']) {
      expect(isArticleLevelField(f)).toBe(true);
    }
    for (const f of ['es', 'lo', 'hi', 'a', 'notes', caseVarKey('age')]) {
      expect(isArticleLevelField(f)).toBe(false);
    }
    expect(ARTICLE_LEVEL_FIELDS).toContain('screeningRecordId');   // the PDF link is article-level
  });
});

describe('the counting contract (106.md §Prevent double counting)', () => {
  it('12 publications yielding 47 cases still count as 12 publications', () => {
    reset();
    let studies = [];
    for (let p = 0; p < 12; p++) studies.push(row({ id: `p${p}`, doi: `10.1/pub${p}`, author: `A${p}`, year: '2024' }));
    // 12 articles; the first is a series of 36 patients → 35 extra cases + 11 = 47 cases
    // once every article is a series. Make ALL of them series, 47 cases in total.
    const perArticle = [8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1];      // sums to 47
    for (let p = 0; p < 12; p++) {
      const en = enableCaseSeries(studies, `p${p}`, { idFn });
      studies = en.studies;
      for (let k = 1; k < perArticle[p]; k++) studies = addCase(studies, en.publicationId, { mkStudy, idFn }).studies;
    }
    const counts = caseSeriesCounts(studies);
    expect(counts.publications).toBe(12);
    expect(counts.cases).toBe(47);
    expect(counts.caseSeriesArticles).toBe(12);
    expect(counts.rows).toBe(47);
    expect(counts.analyticalUnits).toBe(47);
    expect(countPublications(studies)).toBe(12);
  });

  it('a mixed review separates publications, case-series articles and cases', () => {
    const { studies } = series();               // Smith (3 cases) + Jones (ordinary)
    const c = caseSeriesCounts(studies);
    expect(c.publications).toBe(2);
    expect(c.caseSeriesArticles).toBe(1);
    expect(c.cases).toBe(3);
    expect(c.rows).toBe(4);
    expect(c.analyticalUnits).toBe(4);          // 3 cases + 1 ordinary study
    expect(c.hasCaseSeries).toBe(true);
  });

  it('an ordinary study contributes zero cases', () => {
    const studies = [row({ id: 'a', doi: '10.1/x' }), row({ id: 'b', doi: '10.2/y' })];
    expect(countCases(studies)).toBe(0);
    expect(countCaseSeriesArticles(studies)).toBe(0);
    expect(countPublications(studies)).toBe(2);
    expect(caseSeriesCounts(studies).hasCaseSeries).toBe(false);
  });

  it('multi-outcome rows of ONE paper count as one publication', () => {
    const studies = [
      row({ id: 'a', doi: '10.1/x', outcome: 'Mortality' }),
      row({ id: 'b', doi: '10.1/x', outcome: 'Survival' }),
    ];
    expect(countPublications(studies)).toBe(1);
  });

  it('an AMBIGUOUS citation never merges two rows', () => {
    const studies = [row({ id: 'a', author: 'Smith', year: '2020' }), row({ id: 'b', author: 'Smith', year: '2020' })];
    expect(countPublications(studies)).toBe(2);
    expect(publicationKeyOf(studies[0])).toBe('row:a');
  });

  it('the parent link survives a citation correction', () => {
    const { studies, pid } = series();
    // The reviewer fixes the DOI on one case — the citation key changes, the series must not split.
    const edited = propagateArticleFields(studies, casesForPublication(studies, pid)[0].id, { doi: '10.1/corrected' }).studies;
    expect(countPublications(edited)).toBe(2);
    expect(casesForPublication(edited, pid)).toHaveLength(3);
  });

  // A row can join a case-series article WITHOUT the case stamp: confirming an
  // auto-extracted draft copies CITATION_FIELDS only (records.js `citationTemplate`),
  // and so does `addOutcome`. Its key is `doi:…` while the cases key on `pub:…`.
  it('a same-paper row added AFTER the mode is on does not become a second publication', () => {
    reset();
    const en = enableCaseSeries([row({ id: 'a', doi: '10.1/x' }), row({ id: 'b', doi: '10.1/x' })], 'a', { idFn });
    const withOrphan = [...en.studies, row({ id: 'c', doi: '10.1/x' })];
    expect(countPublications(withOrphan)).toBe(1);
    expect(caseSeriesCounts(withOrphan)).toMatchObject({ publications: 1, cases: 2, rows: 3 });
  });

  it('adoption only folds rows onto a series they PROVABLY belong to', () => {
    reset();
    const en = enableCaseSeries([row({ id: 'a', doi: '10.1/x' })], 'a', { idFn });
    const other = [
      ...en.studies,
      row({ id: 'c', doi: '10.9/different' }),      // a different paper
      row({ id: 'd', author: 'Smith', year: '2020' }), // too thin to identify
    ];
    expect(countPublications(other)).toBe(3);
  });

  it('the per-row key is unchanged when no adoption map is supplied', () => {
    reset();
    const en = enableCaseSeries([row({ id: 'a', doi: '10.1/x' })], 'a', { idFn });
    expect(publicationKeyOf(row({ id: 'c', doi: '10.1/x' }))).toBe('doi:10.1/x');
    expect(publicationKeyOf(en.studies[0])).toBe(`pub:${en.publicationId}`);
  });

  it('archived cases are excluded by default and included on request', () => {
    const { studies, pid } = series();
    const c2 = casesForPublication(studies, pid)[1];
    const archived = studies.map((st) => (st.id === c2.id
      ? { ...st, extractionMeta: { ...st.extractionMeta, archived: true } } : st));
    expect(countCases(archived)).toBe(2);
    expect(countCases(archived, { includeArchived: true })).toBe(3);
    expect(activeCasesForPublication(archived, pid)).toHaveLength(2);
  });
});

describe('case variables', () => {
  it('keys are flat on the row so per-value provenance works unchanged', () => {
    const k = caseVarKey('age');
    expect(k).toBe('cv_age');
    expect(isCaseVarKey(k)).toBe(true);
    expect(isCaseVarKey('es')).toBe(false);
    expect(caseVarIdFromKey(k)).toBe('age');

    const st = attachProvenance(row({ id: 'c1', [k]: '54' }), k, { method: 'click', page: 3, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } });
    const p = readProvenance(st, k);
    expect(p.page).toBe(3);
    expect(p.field).toBe(k);
    expect(p.bbox).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
  });

  it('mkCaseVariable canonicalizes and normalizeCaseVariables drops junk', () => {
    const v = mkCaseVariable({ label: ' Age ', type: 'nonsense', options: ['a', '', 'b'], group: 'Nope' }, idFn);
    expect(v.type).toBe('text');
    expect(v.group).toBe('Other');
    expect(v.options).toEqual(['a', 'b']);
    expect(normalizeCaseVariables([null, {}, { id: 'a' }, { id: 'a' }])).toHaveLength(1);
    expect(normalizeCaseVariables('nope')).toEqual([]);
  });

  it('the seeded defaults cover the 106.md case-level list with stable ids', () => {
    const vars = defaultCaseVariables();
    const ids = vars.map((v) => v.id);
    for (const want of ['age', 'sex', 'presentation', 'symptoms', 'comorbidities', 'labs', 'imaging', 'treatment', 'intervention', 'complications', 'followUp', 'caseOutcome', 'survival', 'timeToEvent']) {
      expect(ids).toContain(want);
    }
    expect(vars.find((v) => v.id === 'sex').options).toContain('Female');
  });

  it('case variables extend the progress denominator', () => {
    const st = row({ id: 'c', author: 'S', year: '2024', outcome: 'Death', esType: 'PROP', timepoint: '30d', events: '1', total: '1' });
    const base = caseProgressOf(st, []);
    expect(base.pct).toBe(100);
    const withVars = caseProgressOf(st, [mkCaseVariable({ id: 'age', label: 'Age' }), mkCaseVariable({ id: 'sex', label: 'Sex' })]);
    expect(withVars.totalFields).toBe(base.totalFields + 2);
    expect(withVars.pct).toBeLessThan(100);
    const filled = caseProgressOf({ ...st, cv_age: '54', cv_sex: 'M' }, [mkCaseVariable({ id: 'age' }), mkCaseVariable({ id: 'sex' })]);
    expect(filled.pct).toBe(100);
  });
});

describe('navigator model', () => {
  it('caseGroupForStudy exposes the article citation and its ordered cases', () => {
    const { studies, pid } = series();
    const g = caseGroupForStudy(studies, casesForPublication(studies, pid)[2].id);
    expect(g.publicationId).toBe(pid);
    expect(g.citation.author).toBe('Smith');
    expect(g.cases.map((st) => caseInfoOf(st).caseNumber)).toEqual([1, 2, 3]);
    expect(caseGroupForStudy(studies, 's2')).toBeNull();
  });

  it('caseSummary reports per-case completion for the chips', () => {
    const { studies, pid } = series();
    const vars = [mkCaseVariable({ id: 'age', label: 'Age' })];
    const cases = casesForPublication(studies, pid);
    const sum = caseSummary(cases[0], vars);
    expect(sum.name).toBe('Case 1');
    expect(sum.caseNumber).toBe(1);
    expect(sum.complete).toBe(false);
    expect(sum.pct).toBeGreaterThanOrEqual(0);
    expect(sum.total).toBe(caseProgressOf(cases[0], vars).totalFields);
  });
});

describe('downstream handoff + export', () => {
  it('caseObservations keeps every case tied to its parent article', () => {
    const { studies, pid } = series();
    const obs = caseObservations(studies);
    expect(obs).toHaveLength(3);
    expect(new Set(obs.map((o) => o.publicationId))).toEqual(new Set([pid]));
    expect(new Set(obs.map((o) => o.caseId)).size).toBe(3);   // each case is its own observation
    expect(obs[0].citation.doi).toBe('10.1/smith');
  });

  it('buildCaseExportRows emits one row per case with article identifiers retained', () => {
    const { studies, pid } = series();
    const vars = [mkCaseVariable({ id: 'age', label: 'Age', unit: 'years' }), mkCaseVariable({ id: 'sex', label: 'Sex' })];
    const cases = casesForPublication(studies, pid);
    const filled = studies.map((st, i) => (st.id === cases[0].id ? { ...st, cv_age: '42', cv_sex: 'M', es: '1.2' } : st));
    const { columns, rows } = buildCaseExportRows(filled, vars);
    expect(rows).toHaveLength(3);
    expect(columns.map((c) => c.label)).toContain('Age (years)');
    expect(columns.map((c) => c.key)).toEqual(expect.arrayContaining(['doi', 'pmid', 'publicationId', 'caseId', 'caseNumber']));
    expect(rows[0].publication).toBe('Smith 2024');
    expect(rows[0].doi).toBe('10.1/smith');
    expect(rows[0].caseLabel).toBe('Case 1');
    expect(rows[0][caseVarKey('age')]).toBe('42');
    expect(rows[1][caseVarKey('age')]).toBe('');
  });

  it('exports nothing for a review with no case series', () => {
    const { rows } = buildCaseExportRows([row({ id: 'a', doi: '10.1/x' })], defaultCaseVariables());
    expect(rows).toEqual([]);
  });
});

describe('buildCasesFromTable (106.md §Tables and structured case series)', () => {
  const table = {
    patients: [
      { values: { age: '42', sex: 'M', caseOutcome: 'Recovered' } },
      { values: { age: '56', sex: 'F', caseOutcome: 'Recovered' } },
      { label: 'Index patient', values: { age: '61', sex: 'M', caseOutcome: 'Died' } },
    ],
  };

  it('maps patient COLUMNS onto three individual case records', () => {
    reset();
    const en = enableCaseSeries([row({ id: 's1', doi: '10.1/x', author: 'Smith', year: '2024' })], 's1', { idFn });
    const r = buildCasesFromTable(en.studies, en.publicationId, table, { mkStudy, idFn });
    expect(r.error).toBeUndefined();
    expect(r.filled).toBe(9);
    const cases = casesForPublication(r.studies, en.publicationId);
    expect(cases).toHaveLength(3);
    expect(cases.map((st) => st[caseVarKey('age')])).toEqual(['42', '56', '61']);
    expect(cases.map((st) => st[caseVarKey('sex')])).toEqual(['M', 'F', 'M']);
    expect(caseDisplayName(cases[2])).toBe('Index patient');
  });

  it('re-running it fills the SAME cases rather than duplicating them', () => {
    reset();
    const en = enableCaseSeries([row({ id: 's1', doi: '10.1/x' })], 's1', { idFn });
    const once = buildCasesFromTable(en.studies, en.publicationId, table, { mkStudy, idFn });
    const twice = buildCasesFromTable(once.studies, en.publicationId, table, { mkStudy, idFn });
    expect(casesForPublication(twice.studies, en.publicationId)).toHaveLength(3);
  });

  it('carries per-cell provenance so each value points at its own table cell', () => {
    reset();
    const en = enableCaseSeries([row({ id: 's1', doi: '10.1/x' })], 's1', { idFn });
    const r = buildCasesFromTable(en.studies, en.publicationId, table, {
      mkStudy,
      idFn,
      provenance: { '2:age': { method: 'table', page: 4, bbox: { x0: 10, y0: 20, x1: 30, y1: 40 }, excerpt: '61' } },
    });
    const third = casesForPublication(r.studies, en.publicationId)[2];
    const p = readProvenance(third, caseVarKey('age'));
    expect(p.method).toBe('table');
    expect(p.page).toBe(4);
    expect(p.excerpt).toBe('61');
    // a cell with no provenance stays unlinked rather than borrowing another's
    expect(readProvenance(casesForPublication(r.studies, en.publicationId)[0], caseVarKey('age'))).toBeNull();
  });

  it('normalizes provenance through mkValueProvenance (a junk bbox never reaches the blob)', () => {
    reset();
    const en = enableCaseSeries([row({ id: 's1', doi: '10.1/x' })], 's1', { idFn });
    const r = buildCasesFromTable(en.studies, en.publicationId, { patients: [{ values: { age: '42' } }] }, {
      mkStudy, idFn,
      provenance: { '0:age': { method: 'not-a-method', page: -3, bbox: { x0: 'nope' }, junkKey: 'x', excerpt: 'e' } },
    });
    const p = readProvenance(casesForPublication(r.studies, en.publicationId)[0], caseVarKey('age'));
    expect(p.method).toBe('manual');      // unknown method coerced, not stored raw
    expect(p.page).toBeNull();            // negative page dropped
    expect(p.bbox).toBeNull();            // malformed rect dropped
    expect(p.junkKey).toBeUndefined();    // unknown key discarded
  });

  it('re-running with a CORRECTED value invalidates the old cell coordinates', () => {
    reset();
    const en = enableCaseSeries([row({ id: 's1', doi: '10.1/x' })], 's1', { idFn });
    const first = buildCasesFromTable(en.studies, en.publicationId, { patients: [{ values: { age: '42' } }] }, {
      mkStudy, idFn, provenance: { '0:age': { method: 'table', page: 4, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } } },
    });
    // The reviewer re-runs the mapper after fixing the parse — no provenance this time.
    const second = buildCasesFromTable(first.studies, en.publicationId, { patients: [{ values: { age: '43' } }] }, { mkStudy, idFn, at: 'T2' });
    const only = casesForPublication(second.studies, en.publicationId);
    expect(only).toHaveLength(1);                       // reused, not duplicated
    expect(only[0][caseVarKey('age')]).toBe('43');
    const p = readProvenance(only[0], caseVarKey('age'));
    expect(p.page).toBeNull();                          // no longer points at the old cell
    expect(p.bbox).toBeNull();
    expect(p.history.map((h) => h.value)).toContain('42');   // the replaced value is kept
  });

  it('rejects an empty table or an unknown publication', () => {
    const { studies, pid } = series();
    expect(buildCasesFromTable(studies, pid, { patients: [] }, { mkStudy, idFn }).error).toBeTruthy();
    expect(buildCasesFromTable(studies, 'pub_nope', table, { mkStudy, idFn }).error).toBeTruthy();
  });
});
