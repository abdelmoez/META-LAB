/**
 * 73.md Part 8 — manuscript ENGINE enrichment tests.
 * Covers: multi-outcome Results narration, τ² estimator wording threading
 * (analysisDescribe), eligibility-criteria rendering, searchMethodsText override,
 * screening→PRISMA precedence, RoB assessments-vs-legacy preference, per-section
 * sources/missing/inputsHash provenance, consistency checks, statement seeding,
 * and the backward-compat regression pin (no new opts → legacy output).
 */
import { describe, it, expect } from 'vitest';
import {
  describeSynthesisModel, resolveAnalysis, TAU2_PHRASES,
} from '../../../src/research-engine/manuscript/analysisDescribe.js';
import {
  generateDraft, generateMethods, generateResults, generateAbstract,
  primaryAnalysis, allAnalyses, timeframeText, suggestStatements,
  studySelectionParagraph,
} from '../../../src/research-engine/manuscript/draft.js';
import { buildMethodsMarkdown } from '../../../src/research-engine/docs/methodsText.js';
import { computePrismaCounts } from '../../../src/research-engine/manuscript/prismaCounts.js';
import {
  buildRobTable, buildStudyCharacteristicsTable, buildSearchStrategyTable,
} from '../../../src/research-engine/manuscript/tables.js';
import {
  computeSectionMeta, computeSectionInputsHashes, SOURCE_LABELS,
} from '../../../src/research-engine/manuscript/sources.js';
import {
  checkConsistency, mentionedEstimators,
} from '../../../src/research-engine/manuscript/consistency.js';
import { analysisSettings, smartInsights } from '../../../src/research-engine/manuscript/readiness.js';
import { makeManuscriptDraft, normalizeDraft, SECTION_IDS } from '../../../src/research-engine/manuscript/model.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function baseProject() {
  return {
    id: 'p1',
    name: 'Statins for primary prevention',
    pico: { question: 'Do statins reduce CV events?', P: 'Adults without CVD', I: 'Statins', C: 'Placebo', O: 'MACE', prosperoId: 'CRD42024000001' },
    search: { dbs: { PubMed: true, Embase: true }, date: '2026-01-15', string: '(statin*)' },
    prisma: {},
    robMethod: 'RoB2',
    studies: [
      { id: 's1', title: 'Trial A', author: 'Smith J', authors: 'Smith J', year: '2020', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', rob: { D1: 'Low', D2: 'Low', D3: 'Low', D4: 'Low', D5: 'Low' } },
      { id: 's2', title: 'Trial B', authors: 'Lee K; Park S', year: '2021', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06', rob: { D1: 'Low', D2: 'Some concerns', D3: 'Low', D4: 'Low', D5: 'Low' } },
      { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', outcome: 'MACE', timepoint: '5y', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05' },
    ],
  };
}

function twoOutcomeProject() {
  const p = baseProject();
  p.studies.push(
    { id: 's4', title: 'Trial D', authors: 'Green A', year: '2022', outcome: 'Mortality', esType: 'OR', es: '-0.15', lo: '-0.40', hi: '0.10' },
    { id: 's5', title: 'Trial E', authors: 'White B', year: '2023', outcome: 'Mortality', esType: 'OR', es: '-0.25', lo: '-0.50', hi: '0.00' },
  );
  return p;
}

function tenStudyProject() {
  const p = baseProject();
  p.studies = [];
  for (let i = 0; i < 10; i += 1) {
    const es = -0.3 + i * 0.05;
    p.studies.push({
      id: `t${i}`, title: `T${i}`, authors: `Auth ${i}`, year: String(2010 + i),
      outcome: 'Death', esType: 'OR',
      es: String(es), lo: String(es - 0.2 - i * 0.03), hi: String(es + 0.2 + i * 0.03),
    });
  }
  return p;
}

/* ── analysisDescribe ─────────────────────────────────────────────────────── */

describe('describeSynthesisModel / resolveAnalysis', () => {
  it('DL defaults reproduce the legacy strings byte-for-byte', () => {
    const d = describeSynthesisModel({});
    expect(d.short).toBe('random-effects (DerSimonian–Laird)');
    expect(d.methodsPhrase).toBe('a DerSimonian–Laird random-effects model');
    expect(d.heterogeneityMethod).toBe('DerSimonian-Laird (I², τ², Cochran Q)');
    const f = describeSynthesisModel({ model: 'fixed' });
    expect(f.short).toBe('fixed-effect');
    expect(f.methodsPhrase).toBe('an inverse-variance common (fixed) effect model');
  });
  it('REML produces the estimator-specific label', () => {
    const d = describeSynthesisModel({ model: 'random', tau2Method: 'REML' });
    expect(d.label).toBe('random-effects model (restricted maximum likelihood τ² estimator)');
    expect(d.methodsPhrase).toContain('restricted maximum likelihood');
  });
  it('unknown estimators clamp to DL (mirrors runMeta)', () => {
    expect(describeSynthesisModel({ tau2Method: 'BOGUS' }).tau2Method).toBe('DL');
  });
  it('resolveAnalysis: opts.analysis > project.analysisSettings > DL', () => {
    const p = { analysisSettings: { tau2Method: 'PM' } };
    expect(resolveAnalysis(p, {}).tau2Method).toBe('PM');
    expect(resolveAnalysis(p, { analysis: { tau2Method: 'REML' } }).tau2Method).toBe('REML');
    expect(resolveAnalysis({}, {}).tau2Method).toBe('DL');
    expect(resolveAnalysis({}, { analysis: { model: 'fixed' } }).model).toBe('fixed');
  });
});

/* ── τ² wording threading ─────────────────────────────────────────────────── */

describe('tau2Method wording threading', () => {
  it('REML from project.analysisSettings reaches Methods, Abstract and Results', () => {
    const p = baseProject();
    p.analysisSettings = { tau2Method: 'REML' };
    const d = generateDraft(p, {});
    expect(d.methods).toContain('a random-effects model with the restricted maximum likelihood τ² estimator');
    expect(d.methods).not.toContain('DerSimonian–Laird random-effects model');
    expect(d.abstract).toContain('random-effects (restricted maximum likelihood τ² estimator) model');
    expect(d.results).toContain('restricted maximum likelihood estimator');
    expect(d.results).toMatch(/Between-study variance was τ² = /);
  });
  it('primaryAnalysis pools with the configured estimator (result.tau2Method)', () => {
    const p = baseProject();
    p.analysisSettings = { tau2Method: 'REML' };
    const a = primaryAnalysis(p, {});
    expect(a.tau2Method).toBe('REML');
    expect(a.result.tau2Method).toBe('REML');
  });
  it('analysisSettings snapshot kills the hardcoded DL string honestly', () => {
    const p = baseProject();
    expect(analysisSettings(p, {}).heterogeneityMethod).toBe('DerSimonian-Laird (I², τ², Cochran Q)');
    p.analysisSettings = { tau2Method: 'REML' };
    const s = analysisSettings(p, {});
    expect(s.heterogeneityMethod).toBe('Restricted maximum likelihood (REML) (I², τ², Cochran Q)');
    expect(s.tau2Method).toBe('REML');
    expect(s.synthesisModel).toContain('restricted maximum likelihood');
  });
});

/* ── multi-outcome Results ────────────────────────────────────────────────── */

describe('multi-outcome Results narration', () => {
  it('narrates every outcome pair, primary (most-studied) first', () => {
    const p = twoOutcomeProject();
    const analyses = allAnalyses(p, {});
    expect(analyses.length).toBe(2);
    expect(analyses[0].pair.outcome).toBe('MACE'); // 3 studies > 2
    const r = generateResults(p, {});
    expect(r).toMatch(/pooled odds ratio \(OR\) for MACE @ 5y/);
    expect(r).toMatch(/For Mortality \(2 studies\), the pooled odds ratio/);
    expect(r).toMatch(/τ² = /); // secondary narration carries τ²
  });
  it('single-study outcomes are reported honestly, never pooled', () => {
    const p = baseProject();
    p.studies.push({ id: 's9', title: 'T', authors: 'X', year: '2024', outcome: 'Stroke', esType: 'OR', es: '-0.1', lo: '-0.3', hi: '0.1' });
    const r = generateResults(p, {});
    expect(r).toContain('Stroke was reported by only one study and was not pooled.');
  });
  it('publication bias: precomputed opts.pubBias is narrated for k≥10', () => {
    const p = tenStudyProject();
    const key = 'Death|||';
    const r = generateResults(p, { pubBias: { [key]: { egger: { intercept: 1.23, pval: 0.04, k: 10 }, trimFill: { k0: 2, side: 'left' } } } });
    expect(r).toContain('## Publication bias');
    expect(r).toMatch(/Egger's regression test .* intercept of 1\.230? \(P = 0\.040?\)/);
    expect(r).toContain('trim-and-fill imputed 2 studies on the left');
    expect(r).toContain('[Report any subgroup and sensitivity analyses you ran]');
  });
  it('publication bias: local deterministic Egger when k≥10 and no opts.pubBias', () => {
    const r = generateResults(tenStudyProject(), {});
    expect(r).toContain('## Publication bias');
    expect(r).toMatch(/Egger's regression test/);
  });
  it('no publication-bias section below k=10 (legacy placeholder preserved)', () => {
    const r = generateResults(baseProject(), {});
    expect(r).not.toContain('## Publication bias');
    expect(r).toContain('[Report any subgroup, sensitivity and publication-bias analyses you ran].');
  });
});

/* ── eligibility criteria + searchMethodsText ─────────────────────────────── */

describe('Methods eligibility + search text', () => {
  it('renders verbatim incl/excl bullets, study design and time frame', () => {
    const p = baseProject();
    p.pico.incl = '• RCTs in adults\n• English language';
    p.pico.excl = '• Case reports';
    p.pico.studyDesign = 'RCT';
    p.pico.timeframeMode = 'since2000';
    const m = generateMethods(p, {});
    expect(m).toContain('**Inclusion criteria.**');
    expect(m).toContain('- RCTs in adults');
    expect(m).toContain('- English language');
    expect(m).toContain('**Exclusion criteria.**');
    expect(m).toContain('- Case reports');
    expect(m).toContain('- **Study designs:** RCT');
    expect(m).toContain('- **Time frame:** since 2000');
  });
  it('timeframeText handles legacy text, presets and custom ranges', () => {
    expect(timeframeText({ timeframe: '2010 onwards' })).toBe('2010 onwards');
    expect(timeframeText({ timeframeMode: 'last5' })).toBe('the last 5 years');
    expect(timeframeText({ timeframeMode: 'custom', tfStart: '2015', tfEnd: '2024' })).toBe('2015–2024');
    expect(timeframeText({ timeframeMode: 'custom', tfStart: '2015' })).toBe('2015 to present');
    expect(timeframeText({})).toBe('');
  });
  it('searchMethodsText replaces the generic search sentence', () => {
    const custom = 'We executed strategy S1 in PubMed and Embase on 15 January 2026.';
    const m = generateMethods(baseProject(), { searchMethodsText: custom });
    expect(m).toContain(custom);
    expect(m).not.toContain('The full search strategy for at least one database is reported in the search-strategy export.');
  });
  it('screening workflow facts render (bundled screeningWorkflow accepted)', () => {
    const m = generateMethods(baseProject(), { screeningWorkflow: { reviewers: 3, blind: true, conflictResolution: 'third-reviewer adjudication' } });
    expect(m).toContain('by 3 independent reviewers');
    expect(m).toContain("blinded to each other's decisions");
    expect(m).toContain('third-reviewer adjudication');
  });
  it('legacy buildMethodsMarkdown ctx (no new fields) is unchanged', () => {
    const md = buildMethodsMarkdown({ projectName: 'X', model: 'random', hksj: true });
    expect(md).toContain('a DerSimonian–Laird random-effects model');
    expect(md).toContain('inverse-variance fixed effect and DerSimonian–Laird random effects');
    expect(md).not.toContain('Inclusion criteria');
  });
});

/* ── screening → PRISMA precedence ────────────────────────────────────────── */

describe('screening → PRISMA counts', () => {
  const screening = { identified: 500, afterDedup: 450, screened: 450, excluded: 430, included: 20 };
  it('computed tier fills gaps when no manual/override values exist', () => {
    const r = computePrismaCounts({ prisma: {}, studies: [] }, { screening });
    expect(r.counts.identified).toBe(500);
    expect(r.provenance.identified).toBe('computed');
    expect(r.counts.duplicatesRemoved).toBe(50); // identified − afterDedup
    expect(r.counts.screened).toBe(450);
  });
  it('manual PRISMA entries still win over screening', () => {
    const r = computePrismaCounts({ prisma: { dbs: '600' }, studies: [] }, { screening });
    expect(r.counts.identified).toBe(600);
  });
  it('generateResults threads opts.screening into the selection paragraph', () => {
    const r = generateResults(baseProject(), { screening });
    expect(r).toContain('500 records were identified');
    expect(r).toContain('450 records were screened');
  });
});

/* ── tables: RoB preference, funding, perSource ───────────────────────────── */

describe('tables enrichment', () => {
  it('buildRobTable prefers structured assessments over legacy studies[].rob', () => {
    const p = baseProject();
    const t = buildRobTable(p, {
      assessments: {
        s2: { domains: { D1: 'High', D2: 'High', D3: 'Low', D4: 'Low', D5: 'Low' }, overall: 'High' },
        s3: { overall: 'Some concerns' }, // overall-only entry still contributes
      },
    });
    const s2 = t.rows.find((r) => /Lee K/.test(r.study));
    expect(s2.D1).toBe('High');
    expect(s2.overall).toBe('High');
    const s3 = t.rows.find((r) => /Brown T/.test(r.study));
    expect(s3.overall).toBe('Some concerns');
    // legacy-only s1 unaffected
    const s1 = t.rows.find((r) => /Smith J/.test(r.study));
    expect(s1.overall).toBe('Low');
  });
  it('an EMPTY structured domains map never shadows a populated legacy rob', () => {
    const p = baseProject();
    const t = buildRobTable(p, { assessments: { s1: { domains: {} } } });
    const s1 = t.rows.find((r) => /Smith J/.test(r.study));
    expect(s1.D1).toBe('Low');
  });
  it('study characteristics renders funding only when present', () => {
    const p = baseProject();
    let t = buildStudyCharacteristicsTable(p);
    expect(t.columns.map((c) => c.key)).not.toContain('funding');
    p.studies[0].funding = 'Industry (Pfizer)';
    t = buildStudyCharacteristicsTable(p);
    expect(t.columns.map((c) => c.key)).toContain('funding');
    expect(t.rows[0].funding).toBe('Industry (Pfizer)');
  });
  it('search strategy honours perSource records/searchedAt/query aliases', () => {
    const t = buildSearchStrategyTable(baseProject(), {
      perSource: { PubMed: { records: 321, searchedAt: '2026-02-01', query: 'statins[tiab]' } },
    });
    const pm = t.rows.find((r) => r.database === 'PubMed');
    expect(pm.records).toBe('321');
    expect(pm.date).toBe('2026-02-01');
    expect(pm.string).toBe('statins[tiab]');
    const em = t.rows.find((r) => r.database === 'Embase');
    expect(em.date).toBe('2026-01-15'); // project-level fallback intact
  });
});

/* ── sources / inputsHash provenance ──────────────────────────────────────── */

describe('sources + inputsHash provenance', () => {
  it('generateDraft returns sectionMeta for every section', () => {
    const d = generateDraft(baseProject(), {});
    for (const id of SECTION_IDS) {
      expect(d.sectionMeta[id]).toBeTruthy();
      expect(Array.isArray(d.sectionMeta[id].sources)).toBe(true);
      expect(Array.isArray(d.sectionMeta[id].missing)).toBe(true);
      expect(typeof d.sectionMeta[id].inputsHash).toBe('string');
    }
    const resultsKeys = d.sectionMeta.results.sources.map((s) => s.key);
    expect(resultsKeys).toContain('studies');
    expect(resultsKeys).toContain('analysis');
    // every source carries the canonical label
    for (const s of d.sectionMeta.results.sources) expect(s.label).toBe(SOURCE_LABELS[s.key]);
  });
  it('missing reports enrichment gaps and clears when data arrives', () => {
    const meta = computeSectionMeta(baseProject(), {});
    expect(meta.methods.missing.map((m) => m.field)).toContain('searchMethodsText');
    const meta2 = computeSectionMeta(baseProject(), { searchMethodsText: 'Real paragraph.' });
    expect(meta2.methods.missing.map((m) => m.field)).not.toContain('searchMethodsText');
  });
  it('hashes are stable for identical inputs and precise to the section', () => {
    const h1 = computeSectionInputsHashes(baseProject(), {});
    const h2 = computeSectionInputsHashes(baseProject(), {});
    expect(h1).toEqual(h2);
    const changed = baseProject();
    changed.studies[0].es = '-0.99';
    const h3 = computeSectionInputsHashes(changed, {});
    expect(h3.results).not.toBe(h1.results);
    expect(h3.title).toBe(h1.title); // unrelated section unaffected
  });
  it('generateDraft sectionMeta hashes match computeSectionInputsHashes', () => {
    const p = baseProject();
    const d = generateDraft(p, {});
    const fresh = computeSectionInputsHashes(p, {});
    for (const id of SECTION_IDS) expect(d.sectionMeta[id].inputsHash).toBe(fresh[id]);
  });
  it('normalizeDraft preserves the additive section fields and tolerates old blobs', () => {
    const raw = makeManuscriptDraft();
    raw.sections.results.sources = [{ key: 'analysis', label: 'Meta-analysis results' }];
    raw.sections.results.missing = [{ field: 'pubBias', hint: 'x' }];
    raw.sections.results.inputsHash = 'abcd1234';
    raw.sections.results.locked = true;
    const n = normalizeDraft(raw);
    expect(n.sections.results.sources.length).toBe(1);
    expect(n.sections.results.inputsHash).toBe('abcd1234');
    expect(n.sections.results.locked).toBe(true);
    // old blob → no phantom fields
    const old = normalizeDraft({ sections: { results: { content: 'x' } } });
    expect('sources' in old.sections.results).toBe(false);
    expect('inputsHash' in old.sections.results).toBe(false);
    // 85.md B1 — draft.assets follows the same pattern: absent/empty → no phantom key
    expect('assets' in old).toBe(false);
    expect('assets' in normalizeDraft({ assets: {} })).toBe(false);
    const withAssets = normalizeDraft({ assets: { 'table:study': { included: false } } });
    expect(withAssets.assets['table:study']).toEqual({ included: false });
  });
});

/* ── consistency checks ───────────────────────────────────────────────────── */

describe('checkConsistency', () => {
  function cleanDraft() {
    const d = makeManuscriptDraft();
    d.sections.methods.content = 'Effect sizes were pooled using a DerSimonian–Laird random-effects model, with the Hartung–Knapp–Sidik–Jonkman adjustment to the confidence interval.';
    d.sections.results.content = 'For MACE, the pooled odds ratio was 0.75.';
    d.references = [{ id: 'r1', title: 'Trial A' }];
    return d;
  }
  it('stays silent on a clean fixture (HKSJ never mistaken for Sidik–Jonkman)', () => {
    expect(checkConsistency(baseProject(), cleanDraft(), {})).toEqual([]);
  });
  it('(a) fires when Methods names an estimator ≠ configured tau2Method', () => {
    const p = baseProject();
    p.analysisSettings = { tau2Method: 'REML' };
    const issues = checkConsistency(p, cleanDraft(), {});
    const hit = issues.find((i) => i.id === 'estimator-mismatch');
    expect(hit).toBeTruthy();
    expect(hit.severity).toBe('warn');
    expect(hit.message).toContain('DerSimonian–Laird');
    expect(hit.message).toContain('Restricted maximum likelihood (REML)');
  });
  it('(b) fires when PRISMA included ≠ numeric-ES study count (both known)', () => {
    const p = baseProject();
    p.prisma = { included: '10' };
    const issues = checkConsistency(p, cleanDraft(), {});
    expect(issues.find((i) => i.id === 'included-vs-extracted')).toBeTruthy();
  });
  it('(c) fires when a poolable outcome is never mentioned in Results', () => {
    const p = twoOutcomeProject();
    const d = cleanDraft(); // mentions MACE but not Mortality
    const issues = checkConsistency(p, d, {});
    const hit = issues.find((i) => i.id.startsWith('outcome-missing:'));
    expect(hit).toBeTruthy();
    expect(hit.message).toContain('Mortality');
  });
  it('(d) fires when references are empty while studies exist', () => {
    const d = cleanDraft();
    d.references = [];
    const issues = checkConsistency(baseProject(), d, {});
    expect(issues.find((i) => i.id === 'references-empty')).toBeTruthy();
  });
  it('(e) fires on leftover [placeholders] but ignores [[cite:x]] and links', () => {
    const d = cleanDraft();
    d.sections.discussion.content = 'See [[cite:s1]] and [the docs](https://x) — but [Add interpretation here].';
    const issues = checkConsistency(baseProject(), d, {});
    const hit = issues.find((i) => i.id === 'placeholders:discussion');
    expect(hit).toBeTruthy();
    expect(hit.message).toMatch(/^1 bracketed placeholder/);
  });
  it('(f) fires when Results narrates a pooled analysis but Methods is empty', () => {
    const d = cleanDraft();
    d.sections.methods.content = '';
    const issues = checkConsistency(baseProject(), d, {});
    expect(issues.find((i) => i.id === 'methods-empty')).toBeTruthy();
  });
  it('mentionedEstimators handles the REML/ML overlap', () => {
    expect(mentionedEstimators('pooled via restricted maximum likelihood')).toEqual(['REML']);
    expect(mentionedEstimators('pooled via maximum likelihood')).toEqual(['ML']);
  });
  it('smartInsights surfaces consistency findings additively', () => {
    const p = baseProject();
    p.analysisSettings = { tau2Method: 'REML' };
    const d = cleanDraft();
    const keys = smartInsights(p, d, {}).map((i) => i.key);
    expect(keys).toContain('consistency:estimator-mismatch');
  });
});

/* ── statements seeding ───────────────────────────────────────────────────── */

describe('statement suggestions', () => {
  it('seeds registration from pico.prosperoId, nothing else', () => {
    const st = suggestStatements(baseProject());
    expect(st.registration).toBe('PROSPERO registration: CRD42024000001.');
    expect(Object.keys(st)).toEqual(['registration']); // funding/COI NEVER autofilled
    expect(suggestStatements({ pico: {} })).toEqual({});
  });
  it('generateDraft carries the suggestions additively', () => {
    const d = generateDraft(baseProject(), {});
    expect(d.statements.registration).toContain('CRD42024000001');
  });
});

/* ── backward-compat regression pin ───────────────────────────────────────── */

describe('backward compat (no new opts → legacy output)', () => {
  it('single-outcome DL project keeps the legacy section text', () => {
    const d = generateDraft(baseProject(), {});
    // legacy synthesis wording, no τ² sentence, no publication-bias section
    expect(d.abstract).toContain('pooled using a random-effects (DerSimonian–Laird) model; heterogeneity was assessed with I².');
    expect(d.methods).toContain('a DerSimonian–Laird random-effects model');
    expect(d.results).not.toContain('Between-study variance');
    expect(d.results).not.toContain('## Publication bias');
    expect(d.results).toContain('[Report any subgroup, sensitivity and publication-bias analyses you ran].');
    expect(d.results).toContain('The study-selection process is shown in the PRISMA 2020 flow diagram (Figure 1).');
    // all eight sections still strings
    for (const id of SECTION_IDS) expect(typeof d[id]).toBe('string');
  });
  it('empty project still emits placeholders, never fabricates', () => {
    const d = generateDraft({ name: '', pico: {}, search: { dbs: {} }, prisma: {}, studies: [] }, {});
    expect(d.abstract).toMatch(/\[/);
    expect(d.results).toMatch(/\[/);
    expect(d.methods).not.toContain('Inclusion criteria');
  });
  it('explicit opts.analysis DL matches legacy text except the additive τ² sentence', () => {
    const legacy = generateDraft(baseProject(), {});
    const explicit = generateDraft(baseProject(), { analysis: { model: 'random', tau2Method: 'DL' } });
    expect(explicit.abstract).toBe(legacy.abstract);
    expect(explicit.methods).toBe(legacy.methods);
    expect(explicit.results).toContain('Between-study variance was τ² = ');
    expect(explicit.results.replace(/\nBetween-study variance was τ²[^\n]*/, '')).toBe(legacy.results);
  });
  it('TAU2_PHRASES covers every estimator runMeta accepts', () => {
    for (const m of ['DL', 'REML', 'ML', 'PM', 'EB', 'SJ', 'HO', 'HS']) {
      expect(typeof TAU2_PHRASES[m]).toBe('string');
    }
  });
});

/* ── 85.md B1 — assetRefs:true parallel pin (token emission) ──────────────── */

describe('assetRefs:true emits structured tokens (parallel pin)', () => {
  it('swaps frozen (Table 1)/(Figure 1) prose for [[…]] tokens, otherwise identical', () => {
    const legacy = generateDraft(baseProject(), {});
    const tokens = generateDraft(baseProject(), { assetRefs: true });
    expect(tokens.results).toContain('the PRISMA 2020 flow diagram ([[figure:prisma]]).');
    expect(tokens.results).toContain('the study-characteristics table ([[table:study]]).');
    expect(tokens.results).toContain('the risk-of-bias table ([[table:rob]]).');
    expect(tokens.results).toContain('the summary-of-findings table ([[table:sof]]).');
    expect(tokens.results).not.toContain('(Figure 1)');
    expect(tokens.results).not.toContain('(Table 1)');
    // sections without token emission points are byte-identical
    expect(tokens.abstract).toBe(legacy.abstract);
    expect(tokens.methods).toBe(legacy.methods);
    expect(tokens.introduction).toBe(legacy.introduction);
    expect(tokens.discussion).toBe(legacy.discussion);
    expect(tokens.limitations).toBe(legacy.limitations);
    expect(tokens.conclusion).toBe(legacy.conclusion);
    // results differ ONLY by the token swaps + the additive SoF sentence
    const normalized = tokens.results
      .replace(' ([[figure:prisma]])', ' (Figure 1)')
      .replace(' ([[table:study]])', ' (Table 1)')
      .replace(' ([[table:rob]])', '')
      .replace('\nPooled results for every outcome are summarised in the summary-of-findings table ([[table:sof]]).', '');
    expect(normalized).toBe(legacy.results);
  });

  it('studySelectionParagraph variant is exported for the editor Insert-PRISMA button', () => {
    const pc = computePrismaCounts(baseProject(), {});
    const legacy = studySelectionParagraph(pc);
    const tokened = studySelectionParagraph(pc, { assetRefs: true });
    expect(legacy).toContain('(Figure 1).');
    expect(tokened).toContain('([[figure:prisma]]).');
    expect(tokened.replace('([[figure:prisma]])', '(Figure 1)')).toBe(legacy);
  });

  it('no-studies project: assetRefs on emits no table:study token (honest placeholder kept)', () => {
    const r = generateResults({ name: '', pico: {}, search: { dbs: {} }, prisma: {}, studies: [] }, { assetRefs: true });
    expect(r).not.toContain('[[table:study]]');
    expect(r).not.toContain('[[table:sof]]');
    expect(r).not.toContain('[[table:rob]]');
    expect(r).toContain('[No included studies with extracted data yet]');
  });
});
