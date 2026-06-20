/**
 * protocolDraft.js — the Plan & Protocol engine's DETERMINISTIC protocol-draft
 * generator (prompt46 #1). Pure: no React, no DOM, no network, no Date.now /
 * Math.random — given the same input it always produces the same Markdown, so it
 * is fully unit-testable and the caller stamps any timestamp separately.
 *
 * This is the always-on draft engine (a service boundary): it turns the
 * structured PROSPERO fields + the PICO snapshot into a clean, editable
 * PROSPERO-style protocol draft. A smarter AI generator can later replace
 * `buildProtocolDraft` behind the same signature without touching the UI.
 *
 *   buildProtocolDraft(pico, fields, { databases, robTool }) -> string (Markdown)
 *   protocolDraftPicoKey(pico) -> string   // change-detection key for PICO drift
 */
import { PROSP_FIELDS } from '../project-model/monolithConstants.js';

const clean = (s) => String(s == null ? '' : s).trim();

/** Human time-frame phrase from the PICO time-frame fields (best-effort). */
function timeframePhrase(pico) {
  const p = pico || {};
  if (p.timeframeMode === 'custom') {
    const s = clean(p.tfStart);
    const e = clean(p.tfEnd);
    if (s && e) return `from ${s} to ${e}`;
    if (s) return `from ${s} to the present`;
  }
  const PRESET = {
    any: 'with no date restriction',
    last1: 'limited to the last 1 year',
    last3: 'limited to the last 3 years',
    last5: 'limited to the last 5 years',
    last10: 'limited to the last 10 years',
    since2000: 'from 2000 onwards',
    inception: 'from database inception to the present',
  };
  if (p.timeframeMode && PRESET[p.timeframeMode]) return PRESET[p.timeframeMode];
  if (clean(p.timeframe)) return clean(p.timeframe);
  return '';
}

/** Normalise an optional databases input (array | comma string) to a phrase. */
function databasesPhrase(databases) {
  let list = [];
  if (Array.isArray(databases)) list = databases.map(clean).filter(Boolean);
  else if (clean(databases)) list = clean(databases).split(/[,;]/).map(clean).filter(Boolean);
  if (!list.length) {
    return 'MEDLINE (via PubMed), Embase, and the Cochrane Central Register of Controlled Trials (CENTRAL)';
  }
  return list.join(', ');
}

/**
 * PICO-derived fallback text for each PROSPERO field id when the structured field
 * is empty. Returns '' when nothing meaningful can be derived. Pure + deterministic.
 */
function deriveFallback(id, pico, opts) {
  const p = pico || {};
  const P = clean(p.P) || '[population]';
  const I = clean(p.I) || '[intervention/exposure]';
  const C = clean(p.C) || '[comparator]';
  const O = clean(p.O) || '[outcome(s)]';
  const cond = clean(p.P);
  const tf = timeframePhrase(p);
  const design = clean(p.studyDesign) || 'Randomised controlled trials';

  switch (id) {
    case 'title':
      return `${clean(p.I) || '[Intervention]'} for ${cond || '[condition]'}: a systematic review and meta-analysis`;
    case 'question':
      return clean(p.question) ||
        `In ${P}, what is the effect of ${I} compared with ${C} on ${O}?`;
    case 'condition':
      return cond;
    case 'population':
      return cond ? `Studies enrolling ${cond}.` : '';
    case 'intervention':
      return clean(p.I) ? `${clean(p.I)}.` : '';
    case 'comparator':
      return clean(p.C) ? `${clean(p.C)}.` : '';
    case 'primary_outcomes':
      return clean(p.O) ? `${clean(p.O)}.` : '';
    case 'study_types':
      return `${design} will be eligible for inclusion. Study designs that do not meet the eligibility criteria will be excluded.`;
    case 'searches': {
      const dbs = databasesPhrase(opts && opts.databases);
      const when = tf ? ` Searches will be ${tf}.` : '';
      return `The following databases will be searched: ${dbs}.${when} Reference lists of included studies and relevant reviews will be hand-searched. No language restriction will be applied unless otherwise stated.`;
    }
    case 'data_extraction':
      return 'Two reviewers will independently screen titles/abstracts and full texts and extract data using a piloted form. Disagreements will be resolved by discussion or a third reviewer.';
    case 'risk_of_bias': {
      const tool = clean(opts && opts.robTool) || 'the Cochrane Risk of Bias 2 (RoB 2) tool';
      return `Risk of bias will be assessed independently by two reviewers using ${tool}. Disagreements will be resolved by discussion or adjudication by a third reviewer.`;
    }
    case 'synthesis':
      return 'Where studies are sufficiently homogeneous, results will be pooled using a random-effects meta-analysis (DerSimonian–Laird). Heterogeneity will be quantified with the I² statistic and the χ² test. Where meta-analysis is not appropriate, findings will be synthesised narratively.';
    case 'subgroups':
      return 'Pre-specified subgroup analyses will be conducted where data permit (e.g. by population, intervention intensity, or risk of bias).';
    case 'certainty':
      return 'The certainty of the body of evidence for each outcome will be assessed using the GRADE approach.';
    case 'language':
      return 'No language restriction will be applied.';
    default:
      return '';
  }
}

/**
 * Build a deterministic PROSPERO-style protocol draft (Markdown) from the PICO
 * snapshot + the structured PROSPERO fields. Structured field values always win;
 * empty fields fall back to a PICO-derived sentence or standard-methodology
 * boilerplate; fields that cannot be derived are emitted as a TODO placeholder so
 * the reviewer can see exactly what is left to complete.
 *
 * @param {object} pico    project.pico
 * @param {object} fields  the PROSPERO fields keyed by PROSP_FIELDS id
 * @param {object} [opts]  { databases?: string[]|string, robTool?: string }
 * @returns {string} Markdown
 */
export function buildProtocolDraft(pico, fields, opts = {}) {
  const f = fields || {};
  const titleText = clean(f.title) || deriveFallback('title', pico, opts);
  const prosperoId = clean(pico && pico.prosperoId);

  const lines = [];
  lines.push(`# ${titleText || 'Systematic Review Protocol'}`);
  lines.push('');
  lines.push('_Systematic review protocol draft_' + (prosperoId ? ` · PROSPERO ${prosperoId}` : ''));
  lines.push('');

  let currentSec = null;
  for (const field of PROSP_FIELDS) {
    if (field.sec !== currentSec) {
      currentSec = field.sec;
      lines.push(`## ${currentSec}`);
      lines.push('');
    }
    const explicit = clean(f[field.id]);
    const body = explicit || deriveFallback(field.id, pico, opts) || '_To be completed._';
    lines.push(`### ${field.label}`);
    lines.push('');
    lines.push(body);
    lines.push('');
  }

  // Trim a trailing blank line for a clean string.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

/**
 * A stable key over the PICO inputs the draft depends on, so the panel can detect
 * "PICO changed since this draft was generated" and offer a regenerate prompt.
 * Pure + deterministic.
 */
export function protocolDraftPicoKey(pico) {
  const p = pico || {};
  return [
    p.question, p.P, p.I, p.C, p.O,
    p.studyDesign, p.timeframe, p.timeframeMode, p.tfStart, p.tfEnd, p.prosperoId,
  ].map((x) => clean(x)).join('||');
}
