/**
 * manuscript/draft.js — 64.md (P3). Pure, DETERMINISTIC manuscript draft generator.
 * Extends the existing methods-paragraph generator (buildMethodsMarkdown) into a
 * full IMRAD draft built ENTIRELY from the project's real data — no LLM, so it
 * cannot hallucinate study findings, databases, dates, counts or effect sizes.
 *
 * Every generated section is data-grounded; wherever a value is missing it emits a
 * bracketed placeholder (e.g. "[Search date not entered]") instead of inventing
 * one. The UI flags these sections "AI draft — verify" and tracks aiGenerated vs
 * userEdited so refreshes never silently overwrite human edits.
 *
 * 73.md Part 8 — generateDraft/generate* opts contract (ALL optional; with none of
 * them the output for a DL/random project is byte-identical to the previous
 * generator):
 *   runMeta(studies, method, {tau2Method})  injectable engine (parity with Analysis tab)
 *   model                'fixed'|'random' (legacy; superseded by opts.analysis.model)
 *   analysis             { model, tau2Method } — the project's ACTUAL synthesis
 *                        settings; falls back to project.analysisSettings.tau2Method
 *   screening            { identified, afterDedup, screened, excluded, included } —
 *                        live screening rollup (any subset) → computePrismaCounts
 *                        COMPUTED tier (UI maps GET /api/screening/projects/:pid/overview)
 *   searchMethodsText    server-composed search paragraph (UI fetches
 *                        GET /api/search-builder/:projectId/methods-text) — replaces
 *                        the generic "Information sources" text when present
 *   reviewers/blind/conflictResolution  screening workflow facts (or bundle them as
 *   screeningWorkflow    { reviewers, blind, conflictResolution })
 *   pubBias              { [pairKey]: { egger:{intercept,pval,k}, trimFill:{k0,side} } }
 *                        precomputed per-outcome publication-bias results; when
 *                        absent Egger is computed locally (deterministic) for k≥10
 *   robAssessments       structured RoB map (used by tables + Results rob count)
 *   prismaCounts/primary/analyses  precomputed shares (perf/parity seams)
 */

import { runMeta as defaultRunMeta, eggersTest } from '../statistics/meta-analysis.js';
import { getOutcomePairs, filterStudiesForOutcome } from '../import-export/journalSubmission.js';
import { fmtES, fmtNum } from '../format/precision.js';
import { buildMethodsMarkdown } from '../docs/methodsText.js';
import { computePrismaCounts } from './prismaCounts.js';
import { JOURNAL_TEMPLATES } from './model.js';
import { describeSynthesisModel, resolveAnalysis } from './analysisDescribe.js';
import { computeSectionMeta } from './sources.js';

const clean = (s) => String(s == null ? '' : s).trim();
const PH = (label) => `[${label}]`;

const MEASURE = {
  OR: { label: 'odds ratio (OR)', kind: 'ratio' },
  RR: { label: 'risk ratio (RR)', kind: 'ratio' },
  HR: { label: 'hazard ratio (HR)', kind: 'ratio' },
  SMD: { label: 'standardised mean difference (SMD)', kind: 'mean' },
  MD: { label: 'mean difference (MD)', kind: 'mean' },
  COR: { label: 'correlation (r)', kind: 'fisherz' },
  PROP: { label: 'pooled proportion', kind: 'prop' },
  DIAG: { label: 'diagnostic odds ratio (DOR)', kind: 'ratio' },
};

function abstractFormatFor(templateId) {
  const tpl = JOURNAL_TEMPLATES.find((t) => t.id === templateId);
  return (tpl && tpl.abstractFormat) || 'structured';
}
const bt = (x, kind) => {
  if (x == null || !Number.isFinite(x)) return null;
  if (kind === 'ratio') return Math.exp(x);
  if (kind === 'fisherz') return Math.tanh(x);
  if (kind === 'prop') { const e = Math.exp(x); return e / (1 + e); }
  return x;
};

/** Pick the primary outcome (most studies with numeric ES) + its pooled result.
 *  73.md Part 8 — pools with the project's ACTUAL {model, tau2Method}
 *  (resolveAnalysis: opts.analysis → project.analysisSettings → DL default; DL
 *  keeps results byte-for-byte identical). */
export function primaryAnalysis(project, opts = {}) {
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const runMeta = typeof opts.runMeta === 'function' ? opts.runMeta : defaultRunMeta;
  const analysis = resolveAnalysis(project, opts);
  const pairs = getOutcomePairs(studies);
  if (!pairs.length) return null;
  let best = null;
  for (const pair of pairs) {
    const subset = filterStudiesForOutcome(studies, pair);
    if (!best || subset.length > best.subset.length) best = { pair, subset };
  }
  if (!best) return null;
  const result = best.subset.length >= 2
    ? runMeta(best.subset, analysis.model, { tau2Method: analysis.tau2Method }) : null;
  return { pair: best.pair, subset: best.subset, result, model: analysis.model, tau2Method: analysis.tau2Method };
}

/**
 * ALL outcome analyses, primary (most-studied) first, then by descending study
 * count (ties keep first-appearance order). Every pair is returned — pairs with
 * <2 numeric studies carry result:null so the narration can say so honestly.
 * Returns [{ pair, subset, result, model, tau2Method }]. Pure/deterministic.
 */
export function allAnalyses(project, opts = {}) {
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const runMeta = typeof opts.runMeta === 'function' ? opts.runMeta : defaultRunMeta;
  const analysis = resolveAnalysis(project, opts);
  const entries = getOutcomePairs(studies).map((pair, i) => ({ pair, subset: filterStudiesForOutcome(studies, pair), i }));
  entries.sort((a, b) => (b.subset.length - a.subset.length) || (a.i - b.i));
  return entries.map(({ pair, subset }) => ({
    pair, subset,
    result: subset.length >= 2 ? runMeta(subset, analysis.model, { tau2Method: analysis.tau2Method }) : null,
    model: analysis.model, tau2Method: analysis.tau2Method,
  }));
}

/* Time-frame presets mirror features/protocol/constants.js TIMEFRAME_OPTIONS
   (engine must not import from features/ — dependency direction). */
const TIMEFRAME_MODE_TEXT = {
  any: 'no time restriction',
  last1: 'the last 1 year',
  last3: 'the last 3 years',
  last5: 'the last 5 years',
  last10: 'the last 10 years',
  since2000: 'since 2000',
  inception: 'since database inception',
};

/** Human text for the eligibility time frame (legacy free text, preset, or custom range). Pure. */
export function timeframeText(pico) {
  const p = pico || {};
  if (clean(p.timeframe)) return clean(p.timeframe);
  if (p.timeframeMode === 'custom') {
    const s = clean(p.tfStart);
    const e = clean(p.tfEnd);
    if (s) return e ? `${s}–${e}` : `${s} to present`;
    return '';
  }
  return TIMEFRAME_MODE_TEXT[p.timeframeMode] || '';
}

/** Assemble the buildMethodsMarkdown ctx from the project + resolved counts. */
function methodsCtx(project, opts) {
  const pico = (project && project.pico) || {};
  const search = (project && project.search) || {};
  const dbs = Object.keys(search.dbs || {}).filter((k) => search.dbs[k]);
  const pc = opts.prismaCounts || computePrismaCounts(project, opts);
  const primary = opts.primary || primaryAnalysis(project, opts);
  const result = primary && primary.result;
  const measure = primary && (MEASURE[primary.pair.esType] || null);
  const pairs = getOutcomePairs(Array.isArray(project && project.studies) ? project.studies : []);
  const analysisCfg = resolveAnalysis(project, opts);
  const wf = opts.screeningWorkflow || {};
  return {
    projectName: clean(project && project.name),
    generatedAt: opts.generatedAt || '',
    software: opts.software || '',
    pico: { question: pico.question, P: pico.P, I: pico.I, C: pico.C, O: pico.O },
    // 73.md Part 8 — verbatim researcher eligibility text (rendered as bullet
    // lists in methodsText.js; omitted entirely when the project has none).
    eligibility: {
      incl: pico.incl,
      excl: pico.excl,
      studyDesign: pico.studyDesign,
      timeframe: timeframeText(pico),
    },
    databases: dbs.join(', '),
    dateSearched: clean(search.date),
    // Server-composed real search paragraph (overrides the generic sentence).
    searchMethodsText: clean(opts.searchMethodsText),
    registration: clean(pico.prosperoId),
    prisma: {
      identified: pc.counts.identified,
      deduped: pc.counts.duplicatesRemoved,
      screened: pc.counts.screened,
      excludedFullText: pc.counts.reportsExcluded,
      included: pc.counts.included,
    },
    screening: {
      reviewers: opts.reviewers != null ? opts.reviewers : wf.reviewers,
      blind: opts.blind != null ? opts.blind : wf.blind,
      conflictResolution: opts.conflictResolution != null ? opts.conflictResolution : wf.conflictResolution,
    },
    measure: measure ? measure.label : '',
    model: (primary && primary.model) || analysisCfg.model,
    tau2Method: analysisCfg.tau2Method,
    hksj: !!(result && result.hksj),
    k: result ? result.k : null,
    heterogeneity: result ? { I2: fmtNum(result.I2, opts.prec), tau2: fmtNum(result.tau2, opts.prec), Q: fmtNum(result.Q, opts.prec), Qdf: result.k - 1, Qp: result.Qpval < 0.001 ? '<0.001' : fmtNum(result.Qpval, opts.prec) } : {},
    predInterval: !!(result && result.predInt),
    outcomes: pairs.map((p) => p.label),
    robTool: clean(project && project.robMethod),
    grade: !!(project && project.grade && Object.keys(project.grade).length),
  };
}

/** Strip the leading "# Methods — …" H1 + the auto-note so it reads as a section body. */
function methodsBody(md) {
  const lines = String(md || '').split('\n');
  const out = [];
  let skippedH1 = false;
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    if (!skippedH1 && /^#\s+Methods/.test(ln)) { skippedH1 = true; continue; }
    if (skippedH1 && out.length === 0 && (/^_Auto-generated/.test(ln) || ln.trim() === '')) continue;
    out.push(ln);
  }
  return out.join('\n').trim();
}

function effectSentence(primary, prec) {
  if (!primary || !primary.result) return null;
  const m = MEASURE[primary.pair.esType] || { label: 'effect size', kind: 'mean' };
  const r = primary.result;
  const pe = bt(r.pES, m.kind);
  const lo = bt(r.lo95, m.kind);
  const hi = bt(r.hi95, m.kind);
  const fmt = m.kind === 'prop'
    ? (x) => (x == null ? '—' : `${fmtNum(x * 100, prec)}%`)
    : (x) => (x == null ? '—' : fmtES(x, prec));
  const p = r.pval < 0.001 ? 'P < 0.001' : `P = ${fmtNum(r.pval, prec)}`;
  return `Across ${r.k} studies, the pooled ${m.label} for ${primary.pair.label || 'the primary outcome'} was ${fmt(pe)} (95% CI ${fmt(lo)} to ${fmt(hi)}; ${p}; I² = ${fmtNum(r.I2, prec)}%).`;
}

/**
 * Generate the Abstract. Structure is TEMPLATE-DRIVEN: generic/BMJ/Cochrane use a
 * Background/Methods/Results/Conclusions structured abstract; JAMA uses the JAMA SR
 * format (Importance/Objective/Data Sources/…); Lancet uses Background/Methods/
 * Findings/Interpretation/Funding. opts.templateId (or opts.abstractFormat) selects.
 */
export function generateAbstract(project, opts = {}) {
  const pico = (project && project.pico) || {};
  const pc = opts.prismaCounts || computePrismaCounts(project, opts);
  const primary = opts.primary || primaryAnalysis(project, opts);
  const eff = effectSentence(primary, opts.prec);
  const inc = pc.counts.included;
  const dbs = Object.keys((project.search && project.search.dbs) || {}).filter((k) => project.search.dbs[k]);
  const dbText = dbs.length ? dbs.join(', ') : PH('databases not selected');
  const dateText = clean(project.search && project.search.date) ? ` (last searched ${clean(project.search.date)})` : ` ${PH('Search date not entered')}`;
  // Shared synthesis-model wording (analysisDescribe.js) — byte-identical for
  // fixed / DL-random; reflects the configured τ² estimator otherwise.
  const desc = describeSynthesisModel(resolveAnalysis(project, {
    ...opts, model: (opts.analysis && opts.analysis.model) || (primary && primary.model) || opts.model,
  }));
  const modelText = primary && primary.result
    ? `Effect estimates were pooled using a ${desc.short} model; heterogeneity was assessed with I².`
    : PH('Describe the synthesis approach');
  const incText = inc != null ? `${inc} studies were included` : PH('Number of included studies unavailable');
  const resultText = eff ? `${incText}. ${eff}` : `${incText}. ${PH('Add the main pooled result once an analysis is available')}`;
  const objective = clean(pico.question) ? `To systematically review and meta-analyse ${clean(pico.question)}` : PH('State the review objective (PICO)');
  const fmt = opts.abstractFormat || abstractFormatFor(opts.templateId);
  const out = [];

  if (fmt === 'jama') {
    out.push('**Importance.** ' + (clean(pico.question) ? `${clean(pico.question)} ${PH('Add the clinical importance')}` : PH('State the importance of the question')));
    out.push('');
    out.push('**Objective.** ' + objective + '.');
    out.push('');
    out.push(`**Data Sources.** ${dbText}${dateText}.`);
    out.push('');
    out.push('**Study Selection.** ' + PH('State the eligibility criteria and how many studies were selected') + (inc != null ? ` (${inc} included).` : '.'));
    out.push('');
    out.push('**Data Extraction and Synthesis.** Two reviewers extracted data; ' + modelText);
    out.push('');
    out.push('**Main Outcomes and Measures.** ' + (clean(pico.O) ? clean(pico.O) : PH('State the primary outcome')) + '.');
    out.push('');
    out.push('**Results.** ' + resultText);
    out.push('');
    out.push('**Conclusions and Relevance.** ' + PH('State the main conclusion and its relevance, cautiously'));
    return out.join('\n');
  }

  if (fmt === 'lancet') {
    out.push('**Background.** ' + (clean(pico.question) ? `${clean(pico.question)} ${PH('Add 1–2 sentences of rationale')}` : PH('State the rationale and the knowledge gap')));
    out.push('');
    out.push(`**Methods.** We searched ${dbText}${dateText}. ${modelText} ${PH('State eligibility and registration')}`);
    out.push('');
    out.push('**Findings.** ' + resultText);
    out.push('');
    out.push('**Interpretation.** ' + PH('State what the findings mean for practice and research, cautiously'));
    out.push('');
    out.push('**Funding.** ' + PH('State the funding source, or “None.”'));
    return out.join('\n');
  }

  // generic / structured (also BMJ, Cochrane)
  out.push('**Background.** ' + (clean(pico.question) ? `${clean(pico.question)} ${PH('Add 1–2 sentences of rationale')}` : PH('State the rationale and the gap this review addresses')));
  out.push('');
  out.push('**Objectives.** ' + objective + '.');
  out.push('');
  out.push(`**Methods.** We searched ${dbText}${dateText}. ${modelText}`);
  out.push('');
  out.push('**Results.** ' + resultText);
  out.push('');
  out.push('**Conclusions.** ' + PH('State the main conclusion, cautiously, based on the certainty of evidence'));
  return out.join('\n');
}

export function generateIntroduction(project) {
  const pico = (project && project.pico) || {};
  const out = [];
  out.push(clean(pico.question)
    ? `This systematic review and meta-analysis addresses the question: ${clean(pico.question)}.`
    : `This systematic review and meta-analysis addresses ${PH('state your review question')}.`);
  out.push('');
  out.push(`${PH('Summarise what is already known and why a synthesis is needed (the knowledge gap)')}.`);
  out.push('');
  const parts = [
    pico.P && `the population of interest is ${clean(pico.P)}`,
    pico.I && `the intervention/exposure is ${clean(pico.I)}`,
    pico.C && `the comparator is ${clean(pico.C)}`,
    pico.O && `the primary outcome is ${clean(pico.O)}`,
  ].filter(Boolean);
  out.push(parts.length ? `In PICO terms, ${parts.join('; ')}.` : PH('Describe the PICO framing of the question'));
  return out.join('\n');
}

export function generateMethods(project, opts = {}) {
  return methodsBody(buildMethodsMarkdown(methodsCtx(project, opts)));
}

/**
 * The PRISMA study-selection paragraph (counts narrative + Figure 1 pointer).
 * Shared by generateResults and the editor's "Insert PRISMA summary" button
 * (65.md MS-8), so the inserted text can never drift from the generated one.
 * @param {object} pc normalized result of computePrismaCounts — pass opts.screening
 *   ({identified, afterDedup, screened, excluded, included} — the UI's mapping of
 *   GET /api/screening/projects/:pid/overview) into computePrismaCounts /
 *   generateResults / generateDraft and live screening counts fill any stage the
 *   researcher has not entered manually (manual/override still win).
 */
export function studySelectionParagraph(pc) {
  const c = (pc && pc.counts) || {};
  return [
    c.identified != null ? `${c.identified} records were identified` : `${PH('Number of records identified unavailable')}`,
    c.duplicatesRemoved != null ? `, of which ${c.duplicatesRemoved} duplicates were removed` : '',
    c.screened != null ? `; ${c.screened} records were screened` : '',
    c.reportsAssessed != null ? `, ${c.reportsAssessed} reports were assessed for eligibility` : '',
    c.included != null ? `, and ${c.included} studies met the inclusion criteria.` : '.',
  ].join('') + ' The study-selection process is shown in the PRISMA 2020 flow diagram (Figure 1).';
}

/** Narration lines for a NON-primary outcome analysis (fuller stats incl. τ²). */
function secondaryNarration(a, prec) {
  const lines = [];
  const label = (a.pair && a.pair.label) || 'a further outcome';
  if (!a.result) {
    // recs round — say exactly why nothing is pooled: the subset is already filtered
    // to studies WITH numeric estimates, so "had no studies with a numeric effect
    // estimate" was false whenever ≥2 such studies existed but pooling failed.
    if (a.subset.length === 0) lines.push(`${label} had no studies with a numeric effect estimate and was not pooled.`);
    else if (a.subset.length === 1) lines.push(`${label} was reported by only one study and was not pooled.`);
    else lines.push(`${label} (${a.subset.length} studies) could not be pooled and is summarised narratively.`);
    return lines;
  }
  const m = MEASURE[a.pair.esType] || { label: 'effect size', kind: 'mean' };
  const r = a.result;
  const fmt = m.kind === 'prop'
    ? (x) => (x == null ? '—' : `${fmtNum(x * 100, prec)}%`)
    : (x) => (x == null ? '—' : fmtES(x, prec));
  const p = r.pval < 0.001 ? 'P < 0.001' : `P = ${fmtNum(r.pval, prec)}`;
  const tau2Bit = a.model !== 'fixed' ? `; τ² = ${fmtNum(r.tau2, prec)}` : '';
  lines.push(`For ${label} (${r.k} studies), the pooled ${m.label} was ${fmt(bt(r.pES, m.kind))} (95% CI ${fmt(bt(r.lo95, m.kind))} to ${fmt(bt(r.hi95, m.kind))}; ${p}; I² = ${fmtNum(r.I2, prec)}%${tau2Bit}).`);
  if (r.predInt) {
    const lo = bt(r.predInt.lo, m.kind);
    const hi = bt(r.predInt.hi, m.kind);
    if (lo != null && hi != null) lines.push(`The 95% prediction interval for ${label} was ${fmt(lo)} to ${fmt(hi)}.`);
  }
  return lines;
}

/**
 * Publication-bias sentence for one outcome analysis. Only when k≥10 (formal
 * tests are under-powered below that). Prefers CALLER-precomputed results
 * (opts.pubBias[pair.key] = { egger:{intercept,pval,k}, trimFill:{k0,side} });
 * otherwise Egger is computed locally from the same subset (deterministic,
 * same engine the Analysis tab uses). Returns null when nothing to report.
 */
function pubBiasNarration(a, opts, prec) {
  if (!a || !a.result || a.result.k < 10) return null;
  const supplied = opts.pubBias && (opts.pubBias[a.pair.key] || opts.pubBias[a.pair.label]);
  let egger = supplied && supplied.egger;
  const tf = supplied && supplied.trimFill;
  if (!supplied) {
    const e = eggersTest(a.subset);
    if (e) egger = { intercept: e.intercept, pval: e.pval, k: e.k };
  }
  if (!egger && !tf) return null;
  const bits = [];
  if (egger && egger.intercept != null) {
    const p = egger.pval != null ? (egger.pval < 0.001 ? 'P < 0.001' : `P = ${fmtNum(egger.pval, prec)}`) : '';
    bits.push(`Egger's regression test for funnel-plot asymmetry gave an intercept of ${fmtES(egger.intercept, prec)}${p ? ` (${p})` : ''}`);
  }
  if (tf && tf.k0 != null) {
    bits.push(`trim-and-fill imputed ${tf.k0} stud${tf.k0 === 1 ? 'y' : 'ies'}${tf.side ? ` on the ${tf.side}` : ''}`);
  }
  if (!bits.length) return null;
  return `For ${(a.pair && a.pair.label) || 'the primary outcome'}, ${bits.join('; ')}.`;
}

/**
 * Results section. 73.md Part 8 — narrates EVERY outcome pair (primary first),
 * pooled with the project's actual {model, tau2Method}; honours opts.screening
 * for PRISMA counts and opts.pubBias / local Egger (k≥10) for publication bias.
 * With none of the new opts and a single DL/random outcome the output is
 * byte-identical to the previous generator.
 */
export function generateResults(project, opts = {}) {
  const pc = opts.prismaCounts || computePrismaCounts(project, opts);
  const analyses = opts.analyses || allAnalyses(project, opts);
  const primary = opts.primary || analyses[0] || null;
  const secondaries = analyses.filter((a) => !primary || a.pair.key !== primary.pair.key);
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const out = [];

  out.push('## Study selection');
  out.push(studySelectionParagraph(pc));
  out.push('');

  out.push('## Study characteristics');
  out.push(studies.length
    ? `Characteristics of the included studies are summarised in the study-characteristics table (Table 1). ${PH('Briefly describe the range of designs, populations and settings')}.`
    : `${PH('No included studies with extracted data yet')}.`);
  out.push('');

  out.push('## Risk of bias');
  const robAss = opts.robAssessments || {};
  const assessed = studies.filter((s) => (s.rob && Object.keys(s.rob).length)
    || (robAss[s.id] && ((robAss[s.id].domains && Object.keys(robAss[s.id].domains).length) || clean(robAss[s.id].overall)))).length;
  out.push(assessed
    ? `Risk of bias was assessed for ${assessed} stud${assessed === 1 ? 'y' : 'ies'}; results are summarised in the risk-of-bias table. ${PH('State how many were at low/some/high risk')}.`
    : `${PH('Risk-of-bias assessment incomplete')}.`);
  out.push('');

  out.push('## Results of syntheses');
  const eff = effectSentence(primary, opts.prec);
  out.push(eff || `${PH('Add the main pooled result; at least 2 studies with effect estimates are required')}.`);
  if (primary && primary.result && primary.result.predInt) {
    const m = MEASURE[primary.pair.esType] || { kind: 'mean' };
    const lo = bt(primary.result.predInt.lo, m.kind);
    const hi = bt(primary.result.predInt.hi, m.kind);
    const f = m.kind === 'prop' ? (x) => `${fmtNum(x * 100, opts.prec)}%` : (x) => fmtES(x, opts.prec);
    if (lo != null && hi != null) out.push(`The 95% prediction interval was ${f(lo)} to ${f(hi)}.`);
  }
  // τ² / estimator sentence for the primary — only under a NON-default estimator
  // or an explicit opts.analysis (keeps legacy DL output byte-identical).
  // recs round — report the estimator the engine ACTUALLY used: with k = 2 or a
  // non-converged iterative fit, runMeta falls back to DL (result.tau2Fallback),
  // and stating the configured estimator would misdescribe the analysis.
  const analysisCfg = resolveAnalysis(project, opts);
  if (eff && primary && primary.result && analysisCfg.model !== 'fixed'
      && (analysisCfg.tau2Method !== 'DL' || (opts.analysis && opts.analysis.tau2Method))) {
    const usedMethod = primary.result.tau2Fallback === 'DL' ? 'DL' : (primary.result.tau2Method || analysisCfg.tau2Method);
    const desc = describeSynthesisModel({ model: analysisCfg.model, tau2Method: usedMethod });
    const fellBack = usedMethod !== analysisCfg.tau2Method;
    out.push(`Between-study variance was τ² = ${fmtNum(primary.result.tau2, opts.prec)} (${desc.estimatorPhrase} estimator${fellBack ? `; the configured ${describeSynthesisModel(analysisCfg).estimatorPhrase} estimator was not estimable for this outcome and the engine fell back` : ''}).`);
  }
  for (const a of secondaries) {
    for (const ln of secondaryNarration(a, opts.prec)) out.push(ln);
  }
  out.push('');
  const pubBiasLines = [];
  for (const a of (primary ? [primary, ...secondaries] : secondaries)) {
    const t = pubBiasNarration(a, opts, opts.prec);
    if (t) pubBiasLines.push(t);
  }
  if (pubBiasLines.length) {
    out.push('## Publication bias');
    for (const ln of pubBiasLines) out.push(ln);
    out.push('');
    out.push(`${PH('Report any subgroup and sensitivity analyses you ran')}.`);
  } else {
    out.push(`${PH('Report any subgroup, sensitivity and publication-bias analyses you ran')}.`);
  }
  return out.join('\n');
}

export function generateDiscussion(project, opts = {}) {
  const primary = opts.primary || primaryAnalysis(project, opts);
  const eff = effectSentence(primary, opts.prec);
  const out = [];
  out.push('## Summary of evidence');
  out.push(eff ? `In summary, ${eff.charAt(0).toLowerCase()}${eff.slice(1)} ${PH('Interpret the direction and clinical importance')}` : `${PH('Summarise the main finding once an analysis is available')}.`);
  out.push('');
  out.push('## Comparison with previous literature');
  out.push(`${PH('Compare your findings with prior reviews/primary studies you have read')}.`);
  out.push('');
  out.push('## Strengths');
  out.push(`This review followed a pre-specified PICO and a systematic, reproducible workflow (screening, extraction, risk-of-bias assessment and meta-analysis). ${PH('Add review-specific strengths')}.`);
  out.push('');
  out.push('## Implications');
  out.push(`${PH('State implications for practice and for future research')}.`);
  return out.join('\n');
}

/** Limitations drawn from objective signals (small k, high I², incomplete RoB, pub-bias power). */
export function generateLimitations(project, opts = {}) {
  const primary = opts.primary || primaryAnalysis(project, opts);
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const flags = [];
  const r = primary && primary.result;
  if (r) {
    if (r.k < 5) flags.push(`only ${r.k} studies contributed to the primary synthesis, so the pooled estimate is imprecise and small-study effects cannot be reliably assessed`);
    if (r.I2 >= 75) flags.push(`heterogeneity was considerable (I² = ${fmtNum(r.I2, opts.prec)}%), so the summary estimate may not represent any single setting well`);
    else if (r.I2 >= 50) flags.push(`heterogeneity was substantial (I² = ${fmtNum(r.I2, opts.prec)}%), so the true effect likely varies across studies`);
    if (r.k < 10) flags.push('with fewer than 10 studies, formal assessment of publication bias has low power');
  } else {
    flags.push(PH('A quantitative synthesis was not available; describe the limits of the qualitative synthesis'));
  }
  // recs round — a study counts as assessed when EITHER the legacy per-study rob map
  // OR a structured RoB v2 assessment (opts.robAssessments, keyed by study id) exists;
  // otherwise reviews assessed entirely in the RoB workspace were told their studies
  // had "no risk-of-bias assessment" — a false, contradiction-inviting limitation.
  const robAssessed = opts.robAssessments && typeof opts.robAssessments === 'object' ? opts.robAssessments : {};
  const robMissing = studies.filter((s) => (s.es !== '' && s.es != null && !isNaN(+s.es))
    && (!s.rob || !Object.keys(s.rob).length)
    && !robAssessed[s.id]).length;
  if (robMissing) flags.push(`${robMissing} included stud${robMissing === 1 ? 'y has' : 'ies have'} no risk-of-bias assessment, limiting credibility judgements`);

  const out = [];
  out.push('This review has several limitations.');
  out.push('');
  if (flags.length) {
    for (const f of flags) out.push(`- ${f.charAt(0).toUpperCase()}${f.slice(1)}.`);
  } else {
    out.push(PH('List the main limitations (study quality, heterogeneity, reporting/publication bias, generalisability)'));
  }
  out.push('');
  out.push(`${PH('Add any other context-specific limitations and how they affect interpretation')}.`);
  return out.join('\n');
}

export function generateConclusion(project, opts = {}) {
  const primary = opts.primary || primaryAnalysis(project, opts);
  const eff = effectSentence(primary, opts.prec);
  if (eff) return `${eff} However, this conclusion should be interpreted in light of the certainty of evidence and the limitations above. ${PH('State the bottom-line conclusion, cautiously')}.`;
  return `${PH('State the main conclusion once a synthesis is available, cautiously and in proportion to the certainty of evidence')}.`;
}

export function generateTitle(project) {
  const pico = (project && project.pico) || {};
  if (clean(project && project.name)) return clean(project.name);
  const bits = [clean(pico.I), clean(pico.P) && `in ${clean(pico.P)}`].filter(Boolean);
  return bits.length ? `${bits.join(' ')}: a systematic review and meta-analysis` : PH('Add a descriptive title');
}

/**
 * Suggested short statements seeded from project data (73.md Part 8). Currently
 * only `registration` (from pico.prosperoId). The UI must apply a suggestion ONLY
 * when the draft's statement is still empty — never overwrite researcher text.
 * Author-level funding/COI are deliberately NEVER autofilled (per-study funding
 * belongs in the characteristics table, not the manuscript funding statement).
 * Returns {} when nothing can be grounded. Pure.
 */
export function suggestStatements(project) {
  const pico = (project && project.pico) || {};
  const out = {};
  const reg = clean(pico.prosperoId);
  if (reg) out.registration = /^CRD/i.test(reg) ? `PROSPERO registration: ${reg}.` : `Registration: ${reg}.`;
  return out;
}

/**
 * Generate all narrative sections at once. Returns { [sectionId]: markdown }
 * PLUS (73.md Part 8, additive — applyGeneratedSections ignores unknown keys):
 *   sectionMeta  { [sectionId]: { sources:[{key,label}], missing:[{field,hint}],
 *                inputsHash } } — provenance + per-section OUTDATED detection
 *                (compare stored inputsHash vs computeSectionInputsHashes)
 *   statements   suggestStatements(project) — apply only into EMPTY statements
 * Computes the shared analyses + prisma counts ONCE and threads them in.
 */
export function generateDraft(project, opts = {}) {
  const ctx = {
    ...opts,
    prismaCounts: opts.prismaCounts || computePrismaCounts(project, opts),
    analyses: opts.analyses || allAnalyses(project, opts),
  };
  ctx.primary = opts.primary || ctx.analyses[0] || null;
  return {
    title: generateTitle(project),
    abstract: generateAbstract(project, ctx),
    introduction: generateIntroduction(project),
    methods: generateMethods(project, ctx),
    results: generateResults(project, ctx),
    discussion: generateDiscussion(project, ctx),
    limitations: generateLimitations(project, ctx),
    conclusion: generateConclusion(project, ctx),
    sectionMeta: computeSectionMeta(project, ctx),
    statements: suggestStatements(project),
  };
}

export default {
  primaryAnalysis,
  allAnalyses,
  timeframeText,
  suggestStatements,
  generateDraft,
  studySelectionParagraph,
  generateTitle,
  generateAbstract,
  generateIntroduction,
  generateMethods,
  generateResults,
  generateDiscussion,
  generateLimitations,
  generateConclusion,
};
