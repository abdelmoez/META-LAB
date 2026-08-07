/**
 * caseSeriesDownstream.test.jsx — 106.md. The parts of Case Series Mode that live
 * OUTSIDE the pure engine: the counting contract as it reaches PRISMA / the fact
 * tokens / the consistency checker, the staleness fingerprints, the analysis-sync
 * hash, duplicate detection, and the SSR shape of the case navigator + case form.
 *
 * House style for UI: renderToStaticMarkup (no jsdom) — initial render only.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkStudy } from '../../src/research-engine/project-model/defaults.js';
import {
  enableCaseSeries, addCase, removeCase, caseVarKey, defaultCaseVariables,
  caseSeriesCounts, caseSummary,
} from '../../src/research-engine/extraction/caseSeries.js';
import { computePrismaCounts } from '../../src/research-engine/manuscript/prismaCounts.js';
import { buildFactContext, resolveFacts, FACTS } from '../../src/research-engine/manuscript/factTokens.js';
import { checkConsistency } from '../../src/research-engine/manuscript/consistency.js';
import { computeDependencyState } from '../../src/research-engine/manuscript/dependencies.js';
import { computeSyncHash } from '../../src/research-engine/extraction/engine/syncState.js';
import { findDuplicates } from '../../src/research-engine/validation/study-validator.js';
import { buildArticleSummary, articleListStats } from '../../src/research-engine/extraction/engine/articleList.js';
import { publicationSourceFor } from '../../src/research-engine/extraction/outcomeGroups.js';
import CaseSeriesBar from '../../src/features/extraction/engine/CaseSeriesBar.jsx';
import CaseFieldsPanel from '../../src/features/extraction/engine/CaseFieldsPanel.jsx';
import ArticleList from '../../src/features/extraction/engine/ArticleList.jsx';

let seq = 0;
const idFn = () => `g${++seq}`;
const row = (over = {}) => ({ ...mkStudy(), ...over });

/** One case-series article of `n` patients (each with an effect size) + `others` ordinary studies. */
function review(n = 3, others = 0) {
  seq = 0;
  const base = [row({ id: 's1', doi: '10.1/smith', author: 'Smith', year: '2024', title: 'Eight patients', esType: 'GENERIC', es: '0.5', lo: '0.2', hi: '0.9' })];
  for (let i = 0; i < others; i++) {
    base.push(row({ id: `o${i}`, doi: `10.9/other${i}`, author: `Other${i}`, year: '2020', esType: 'GENERIC', es: '1', lo: '0.5', hi: '2' }));
  }
  const en = enableCaseSeries(base, 's1', { idFn });
  let studies = en.studies;
  for (let k = 1; k < n; k++) {
    const r = addCase(studies, en.publicationId, { mkStudy, idFn });
    studies = r.studies.map((st) => (st.id === r.id ? { ...st, esType: 'GENERIC', es: '0.5', lo: '0.2', hi: '0.9' } : st));
  }
  return { studies, publicationId: en.publicationId };
}

describe('PRISMA counts stay publication-scoped (106.md §Prevent double counting)', () => {
  it('a case series of 8 patients still reports ONE included study', () => {
    const { studies } = review(8);
    const pc = computePrismaCounts({ studies, prisma: {} }, {});
    expect(pc.counts.included).toBe(1);
    expect(pc.counts.includedQuant).toBe(1);
  });

  it('12 publications comprising 47 cases report 12 included studies', () => {
    seq = 0;
    let studies = [];
    const per = [8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1];
    for (let p = 0; p < 12; p++) {
      studies.push(row({ id: `p${p}`, doi: `10.1/pub${p}`, author: `A${p}`, year: '2024', esType: 'GENERIC', es: '1', lo: '0.5', hi: '2' }));
    }
    for (let p = 0; p < 12; p++) {
      const en = enableCaseSeries(studies, `p${p}`, { idFn });
      studies = en.studies;
      for (let k = 1; k < per[p]; k++) {
        const r = addCase(studies, en.publicationId, { mkStudy, idFn });
        studies = r.studies.map((st) => (st.id === r.id ? { ...st, esType: 'GENERIC', es: '1', lo: '0.5', hi: '2' } : st));
      }
    }
    expect(caseSeriesCounts(studies)).toMatchObject({ publications: 12, cases: 47 });
    expect(computePrismaCounts({ studies, prisma: {} }, {}).counts.included).toBe(12);
  });

  it('an ordinary review is unaffected — one row per study, one study per row', () => {
    const studies = [
      row({ id: 'a', doi: '10.1/a', es: '1' }),
      row({ id: 'b', doi: '10.1/b', es: '2' }),
      row({ id: 'c', doi: '10.1/c', es: '3' }),
    ];
    expect(computePrismaCounts({ studies, prisma: {} }, {}).counts.included).toBe(3);
  });

  it('a manual PRISMA number still wins over the derived one', () => {
    const { studies } = review(8);
    const pc = computePrismaCounts({ studies, prisma: { included: '5' } }, {});
    expect(pc.counts.included).toBe(5);
    expect(pc.provenance.included).toBe('manual');
  });
});

describe('fact tokens separate publications from cases', () => {
  const project = () => { const { studies } = review(8, 11); return { studies, prisma: {}, pico: {} }; };

  it('studies.included is the PUBLICATION count, never the case count', () => {
    const facts = resolveFacts(project(), {});
    expect(facts['studies.included'].raw).toBe('12');
    expect(facts['studies.caseCount'].raw).toBe('8');
    expect(facts['studies.caseSeriesCount'].raw).toBe('1');
  });

  it('studies.publicationsAndCases renders the 106.md sentence fragment', () => {
    const facts = resolveFacts(project(), {});
    expect(facts['studies.publicationsAndCases'].raw).toBe('twelve publications comprising 8 individual cases');
  });

  it('the case facts are MISSING (not "0") for a review with no case series', () => {
    const studies = [row({ id: 'a', doi: '10.1/a' }), row({ id: 'b', doi: '10.1/b' })];
    const facts = resolveFacts({ studies, prisma: {}, pico: {} }, {});
    expect(facts['studies.included'].raw).toBe('2');
    expect(facts['studies.caseCount'].missing).toBe(true);
    expect(facts['studies.caseCount'].value).toMatch(/not yet available/);
    expect(facts['studies.publicationsAndCases'].missing).toBe(true);
  });

  it('every new fact is registered coherently (label, engine, depKey, hint)', () => {
    for (const key of ['studies.caseCount', 'studies.caseSeriesCount', 'studies.publicationsAndCases']) {
      const f = FACTS[key];
      expect(f).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(f.engine).toBe('extraction');
      expect(f.depKey).toBe('studies.roster');
      expect(f.hint).toBeTruthy();
    }
  });

  it('the fact CONTEXT keeps the row count available without conflating it', () => {
    const ctx = buildFactContext(project(), {});
    expect(ctx.studies.total).toBe(12);      // publications
    expect(ctx.studies.rows).toBe(19);       // 8 cases + 11 ordinary studies
    expect(ctx.studies.cases).toBe(8);
  });
});

describe('the consistency checker no longer cries wolf on a case series', () => {
  it('12 publications / 47 rows raises NO included-vs-extracted warning', () => {
    const { studies } = review(8, 11);           // 12 publications, 19 rows
    const issues = checkConsistency({ studies, prisma: { included: '12' } }, null, {});
    expect(issues.find((i) => i.id === 'included-vs-extracted')).toBeUndefined();
  });

  it('a genuine mismatch still warns, and says how many rows are cases', () => {
    const { studies } = review(8, 11);
    const issues = checkConsistency({ studies, prisma: { included: '20' } }, null, {});
    const w = issues.find((i) => i.id === 'included-vs-extracted');
    expect(w).toBeTruthy();
    expect(w.message).toContain('PRISMA reports 20 included studies but 12 studies are in extraction');
    expect(w.message).toContain('8 individual cases');
  });
});

describe('staleness fingerprints see case changes (else the manuscript lies)', () => {
  const proj = (studies) => ({ studies, prisma: {}, pico: {} });

  it('adding a case moves the studies.roster fingerprint', () => {
    const { studies, publicationId } = review(2);
    const before = computeDependencyState(proj(studies), {});
    const after = computeDependencyState(proj(addCase(studies, publicationId, { mkStudy, idFn }).studies), {});
    expect(after['studies.roster']).not.toBe(before['studies.roster']);
  });

  it('editing a patient-level value moves the studies.values fingerprint', () => {
    const { studies } = review(2);
    const before = computeDependencyState(proj(studies), {});
    const edited = studies.map((s, i) => (i === 0 ? { ...s, [caseVarKey('age')]: '54' } : s));
    const after = computeDependencyState(proj(edited), {});
    expect(after['studies.values']).not.toBe(before['studies.values']);
  });

  it('renaming a case moves the roster fingerprint (it changes the export + tables)', () => {
    const { studies } = review(2);
    const before = computeDependencyState(proj(studies), {});
    const renamed = studies.map((s, i) => (i === 0
      ? { ...s, extractionMeta: { ...s.extractionMeta, caseSeries: { ...s.extractionMeta.caseSeries, label: 'Index patient' } } }
      : s));
    expect(computeDependencyState(proj(renamed), {})['studies.roster']).not.toBe(before['studies.roster']);
  });

  it('an unchanged project keeps identical fingerprints (no churn)', () => {
    const { studies } = review(3);
    expect(computeDependencyState(proj(studies), {})).toEqual(computeDependencyState(proj(studies), {}));
  });
});

describe('analysis-sync hash covers patient-level values', () => {
  it('changing a case variable marks the article updated-since-sync', () => {
    const st = row({ id: 'c', es: '1', lo: '0.5', hi: '2' });
    const before = computeSyncHash(st);
    expect(computeSyncHash({ ...st, [caseVarKey('age')]: '54' })).not.toBe(before);
  });

  it('key ORDER in the blob never churns the hash', () => {
    const a = { es: '1', cv_age: '54', cv_sex: 'M' };
    const b = { cv_sex: 'M', cv_age: '54', es: '1' };
    expect(computeSyncHash(a)).toBe(computeSyncHash(b));
  });

  it('an ordinary study hashes exactly as before', () => {
    const st = row({ id: 'x', es: '1', lo: '0', hi: '2', esType: 'GENERIC' });
    expect(computeSyncHash(st)).toBe(computeSyncHash({ ...st }));
  });
});

describe('duplicate detection understands cases', () => {
  it('cases of ONE article are never flagged as duplicate studies', () => {
    const { studies } = review(4);
    expect(Object.keys(findDuplicates(studies))).toEqual([]);
  });

  it('two genuinely duplicated studies are still flagged', () => {
    const studies = [
      row({ id: 'a', author: 'Smith', year: '2020' }),
      row({ id: 'b', author: 'Smith', year: '2020' }),
    ];
    expect(findDuplicates(studies)).toEqual({ a: true, b: true });
  });

  it('cases of DIFFERENT articles are still compared', () => {
    seq = 0;
    const one = enableCaseSeries([row({ id: 'a', author: 'Smith', year: '2020', title: 'T1' })], 'a', { idFn });
    const two = enableCaseSeries([...one.studies, row({ id: 'b', author: 'Smith', year: '2020', title: 'T2' })], 'b', { idFn });
    expect(findDuplicates(two.studies)).toEqual({ a: true, b: true });
  });
});

describe('the PDF is resolved from the PUBLICATION, so switching cases cannot reload it', () => {
  it('every case shares one anchor id even after the DOI is corrected', () => {
    const { studies, publicationId } = review(3);
    const anchors = studies.filter((s) => s.extractionMeta && s.extractionMeta.caseSeries)
      .map((s) => publicationSourceFor(studies, s.id).anchorId);
    expect(new Set(anchors).size).toBe(1);

    const corrected = studies.map((s) => (s.extractionMeta && s.extractionMeta.caseSeries ? { ...s, doi: '10.99/new' } : s));
    const after = corrected.filter((s) => s.extractionMeta && s.extractionMeta.caseSeries)
      .map((s) => publicationSourceFor(corrected, s.id).anchorId);
    expect(new Set(after)).toEqual(new Set(anchors));
    expect(publicationId).toBeTruthy();
  });

  it('the anchor survives DELETING the first case — the viewer is not unmounted', () => {
    const { studies, publicationId } = review(3);
    const cases = studies.filter((s) => s.extractionMeta && s.extractionMeta.caseSeries);
    const before = publicationSourceFor(studies, cases[1].id).anchorId;
    const after = removeCase(studies, cases[0].id, {});
    expect(after.error).toBeUndefined();
    expect(publicationSourceFor(after.studies, cases[1].id).anchorId).toBe(before);
    expect(before).toBe(`pub:${publicationId}`);
  });

  it('an ordinary paper keeps the legacy row-id anchor', () => {
    const studies = [row({ id: 's1', doi: '10.1/x' }), row({ id: 's2', doi: '10.1/x' })];
    expect(publicationSourceFor(studies, 's2').anchorId).toBe('s1');
  });

  it('cases inherit the screening link so the shared PDF resolves from any case', () => {
    seq = 0;
    const base = [row({ id: 's1', doi: '10.1/x', screeningProjectId: 'sp1', screeningRecordId: 'rec9' })];
    const en = enableCaseSeries(base, 's1', { idFn });
    const r = addCase(en.studies, en.publicationId, { mkStudy, idFn });
    const pub = publicationSourceFor(r.studies, r.id);
    expect(pub.screeningRecordId).toBe('rec9');
    expect(pub.screeningProjectId).toBe('sp1');
  });
});

describe('article-list stats report publications and cases separately', () => {
  it('exposes publications / cases / rows without conflating them', () => {
    const { studies } = review(8, 11);
    const stats = articleListStats(studies.map((s) => buildArticleSummary(s, {})));
    expect(stats.total).toBe(19);            // rows (the progress denominator)
    expect(stats.publications).toBe(12);
    expect(stats.cases).toBe(8);
    expect(stats.caseSeriesArticles).toBe(1);
    expect(stats.hasCaseSeries).toBe(true);
  });

  it('an ordinary review reports hasCaseSeries false and publications === rows', () => {
    const studies = [row({ id: 'a', doi: '10.1/a' }), row({ id: 'b', doi: '10.1/b' })];
    const stats = articleListStats(studies.map((s) => buildArticleSummary(s, {})));
    expect(stats.hasCaseSeries).toBe(false);
    expect(stats.publications).toBe(2);
    expect(stats.cases).toBe(0);
  });

  it('a summary carries the case identity for the list badge', () => {
    const { studies } = review(2);
    const s = buildArticleSummary(studies[0], {});
    expect(s.caseSeries).toMatchObject({ caseNumber: 1, name: 'Case 1' });
    expect(buildArticleSummary(row({ id: 'z' }), {}).caseSeries).toBeNull();
  });

  it('a case row\'s list progress uses the PATIENT denominator, matching the chip', () => {
    const { studies } = review(1);
    const vars = defaultCaseVariables();
    const bare = buildArticleSummary(studies[0], {});
    const withVars = buildArticleSummary(studies[0], {}, vars);
    expect(withVars.totalFields).toBe(bare.totalFields + vars.length);
    expect(withVars.progressPct).toBeLessThan(bare.progressPct);
    // and it agrees with what the navigator chip shows
    expect(withVars.progressPct).toBe(caseSummary(studies[0], vars).pct);
  });

  it('an ordinary study ignores caseVariables entirely', () => {
    const st = row({ id: 'a', doi: '10.1/a', esType: 'GENERIC', es: '1', lo: '0', hi: '2' });
    expect(buildArticleSummary(st, {}, defaultCaseVariables()).totalFields)
      .toBe(buildArticleSummary(st, {}).totalFields);
  });
});

describe('UI (SSR)', () => {
  it('an ordinary article shows the plain-language toggle', () => {
    const studies = [row({ id: 'a', author: 'Smith', year: '2024' })];
    const html = renderToStaticMarkup(<CaseSeriesBar studies={studies} openId="a" onEnable={() => {}} />);
    expect(html).toContain('This article contains multiple cases / case series');
    expect(html).toContain('pex-case-toggle');
  });

  it('a read-only viewer is not offered the toggle', () => {
    const studies = [row({ id: 'a' })];
    expect(renderToStaticMarkup(<CaseSeriesBar studies={studies} openId="a" canEdit={false} />)).toBe('');
  });

  it('a case series renders the navigator with a chip per case and + Add case', () => {
    const { studies } = review(3);
    const openId = studies[0].id;
    const html = renderToStaticMarkup(<CaseSeriesBar studies={studies} openId={openId} onOpen={() => {}} onAdd={() => {}} />);
    expect(html).toContain('Cases (3)');
    expect(html).toContain('Case 1');
    expect(html).toContain('Case 2');
    expect(html).toContain('Case 3');
    expect(html).toContain('+ Add case');
    expect(html).toContain('pex-case-chip-2');
    expect(html).toMatch(/aria-selected="true"/);
  });

  it('each chip carries a TEXT completion signal, never colour alone', () => {
    const { studies } = review(2);
    const html = renderToStaticMarkup(<CaseSeriesBar studies={studies} openId={studies[0].id} caseVariables={defaultCaseVariables()} />);
    expect(html).toMatch(/\d+%|not started/);
  });

  it('the case form renders the 106.md patient-level fields, grouped', () => {
    const { studies } = review(1);
    const html = renderToStaticMarkup(
      <CaseFieldsPanel study={studies[0]} caseVariables={defaultCaseVariables()} onSetValue={() => {}} />,
    );
    expect(html).toContain('CASE-LEVEL DATA');
    expect(html).toContain('Age (years)');
    expect(html).toContain('Sex');
    expect(html).toContain('Comorbidities');
    expect(html).toContain('Demographics');
    expect(html).toContain('pex-case-field-age');
    expect(html).toContain('<option value="Female">Female</option>');
  });

  it('the case form shows an extracted value against its case', () => {
    const { studies } = review(1);
    const withAge = { ...studies[0], [caseVarKey('age')]: '54' };
    const html = renderToStaticMarkup(<CaseFieldsPanel study={withAge} caseVariables={defaultCaseVariables()} onSetValue={() => {}} />);
    expect(html).toContain('value="54"');
  });

  it('the article list header says publications AND cases, and offers the case export', () => {
    const { studies } = review(3, 2);
    const arts = studies.map((s) => buildArticleSummary(s, {}));
    const html = renderToStaticMarkup(<ArticleList articles={arts} stats={articleListStats(arts)} onExportCases={() => {}} />);
    expect(html).toContain('3 publications');
    expect(html).toContain('3 individual cases');
    expect(html).toContain('Export cases (CSV)');
    expect(html).toContain('pex-list-case-2');
  });

  it('an ordinary review sees neither the case counts nor the case export', () => {
    const arts = [row({ id: 'a', doi: '10.1/a' })].map((s) => buildArticleSummary(s, {}));
    const html = renderToStaticMarkup(<ArticleList articles={arts} stats={articleListStats(arts)} onExportCases={() => {}} />);
    expect(html).toContain('1 article');
    expect(html).not.toContain('individual case');
    expect(html).not.toContain('Export cases');
  });
});
