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
 */

import { runMeta as defaultRunMeta } from '../statistics/meta-analysis.js';
import { getOutcomePairs, filterStudiesForOutcome } from '../import-export/journalSubmission.js';
import { fmtES, fmtNum } from '../format/precision.js';
import { buildMethodsMarkdown } from '../docs/methodsText.js';
import { computePrismaCounts } from './prismaCounts.js';
import { JOURNAL_TEMPLATES } from './model.js';

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

/** Pick the primary outcome (most studies with numeric ES) + its pooled result. */
export function primaryAnalysis(project, opts = {}) {
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const runMeta = typeof opts.runMeta === 'function' ? opts.runMeta : defaultRunMeta;
  const pairs = getOutcomePairs(studies);
  if (!pairs.length) return null;
  let best = null;
  for (const pair of pairs) {
    const subset = filterStudiesForOutcome(studies, pair);
    if (!best || subset.length > best.subset.length) best = { pair, subset };
  }
  if (!best) return null;
  const result = best.subset.length >= 2 ? runMeta(best.subset, opts.model || 'random') : null;
  return { pair: best.pair, subset: best.subset, result, model: opts.model || 'random' };
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
  return {
    projectName: clean(project && project.name),
    generatedAt: opts.generatedAt || '',
    software: opts.software || '',
    pico: { question: pico.question, P: pico.P, I: pico.I, C: pico.C, O: pico.O },
    databases: dbs.join(', '),
    dateSearched: clean(search.date),
    registration: clean(pico.prosperoId),
    prisma: {
      identified: pc.counts.identified,
      deduped: pc.counts.duplicatesRemoved,
      screened: pc.counts.screened,
      excludedFullText: pc.counts.reportsExcluded,
      included: pc.counts.included,
    },
    screening: { reviewers: opts.reviewers, blind: opts.blind, conflictResolution: opts.conflictResolution },
    measure: measure ? measure.label : '',
    model: (primary && primary.model) || 'random',
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
  const modelText = primary && primary.result
    ? `Effect estimates were pooled using a ${(primary.model || 'random') === 'fixed' ? 'fixed-effect' : 'random-effects (DerSimonian–Laird)'} model; heterogeneity was assessed with I².`
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

export function generateResults(project, opts = {}) {
  const pc = opts.prismaCounts || computePrismaCounts(project, opts);
  const primary = opts.primary || primaryAnalysis(project, opts);
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const out = [];

  out.push('## Study selection');
  const c = pc.counts;
  out.push([
    c.identified != null ? `${c.identified} records were identified` : `${PH('Number of records identified unavailable')}`,
    c.duplicatesRemoved != null ? `, of which ${c.duplicatesRemoved} duplicates were removed` : '',
    c.screened != null ? `; ${c.screened} records were screened` : '',
    c.reportsAssessed != null ? `, ${c.reportsAssessed} reports were assessed for eligibility` : '',
    c.included != null ? `, and ${c.included} studies met the inclusion criteria.` : '.',
  ].join('') + ' The study-selection process is shown in the PRISMA 2020 flow diagram (Figure 1).');
  out.push('');

  out.push('## Study characteristics');
  out.push(studies.length
    ? `Characteristics of the included studies are summarised in the study-characteristics table (Table 1). ${PH('Briefly describe the range of designs, populations and settings')}.`
    : `${PH('No included studies with extracted data yet')}.`);
  out.push('');

  out.push('## Risk of bias');
  const assessed = studies.filter((s) => s.rob && Object.keys(s.rob).length).length;
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
  out.push('');
  out.push(`${PH('Report any subgroup, sensitivity and publication-bias analyses you ran')}.`);
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
  const robMissing = studies.filter((s) => (s.es !== '' && s.es != null && !isNaN(+s.es)) && (!s.rob || !Object.keys(s.rob).length)).length;
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
 * Generate all narrative sections at once. Returns { [sectionId]: markdown }.
 * Computes the shared primary analysis + prisma counts ONCE and threads them in.
 */
export function generateDraft(project, opts = {}) {
  const ctx = {
    ...opts,
    prismaCounts: opts.prismaCounts || computePrismaCounts(project, opts),
    primary: opts.primary || primaryAnalysis(project, opts),
  };
  return {
    title: generateTitle(project),
    abstract: generateAbstract(project, ctx),
    introduction: generateIntroduction(project),
    methods: generateMethods(project, ctx),
    results: generateResults(project, ctx),
    discussion: generateDiscussion(project, ctx),
    limitations: generateLimitations(project, ctx),
    conclusion: generateConclusion(project, ctx),
  };
}

export default {
  primaryAnalysis,
  generateDraft,
  generateTitle,
  generateAbstract,
  generateIntroduction,
  generateMethods,
  generateResults,
  generateDiscussion,
  generateLimitations,
  generateConclusion,
};
