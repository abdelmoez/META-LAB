/**
 * manuscript/consistency.js — 73.md Part 8. Pure cross-artefact consistency
 * checks between the manuscript draft text and the live project data. Catches
 * the "manuscript says X, analysis is configured to do Y" class of submission
 * errors that no single generator can see.
 *
 * checkConsistency(project, draft, opts) → [{ id, severity:'warn'|'info',
 * section, message }] — deterministic order, empty when everything agrees.
 * Consumed by readiness.smartInsights (additive `consistency:*` keys) and
 * exported for the UI to render per-section. Pure — no DOM/React/network.
 */

import { computePrismaCounts } from './prismaCounts.js';
import { getOutcomePairs, filterStudiesForOutcome } from '../import-export/journalSubmission.js';
import { resolveAnalysis } from './analysisDescribe.js';
import { TAU2_LABELS } from '../statistics/tau2.js';
import { SECTION_TYPES } from './model.js';

const clean = (s) => String(s == null ? '' : s).trim();

/* Known τ² estimator names as they appear in prose (any dash variant). */
const DASH = '[\\u2010-\\u2015-]';
const ESTIMATOR_PATTERNS = {
  DL: new RegExp(`DerSimonian${DASH}+\\s*Laird`, 'i'),
  REML: /restricted maximum likelihood|\bREML\b/i,
  ML: /maximum likelihood/i,
  PM: new RegExp(`Paule${DASH}+\\s*Mandel`, 'i'),
  EB: /empirical bayes/i,
  SJ: new RegExp(`Sidik${DASH}+\\s*Jonkman`, 'i'),
  HO: new RegExp(`Hedges${DASH}+\\s*Olkin`, 'i'),
  HS: new RegExp(`Hunter${DASH}+\\s*Schmidt`, 'i'),
};

/** Estimator method keys mentioned in a prose text. Handles the two overlaps:
 *  'Hartung–Knapp–Sidik–Jonkman' is NOT an SJ τ² mention, and
 *  'restricted maximum likelihood' is NOT an ML mention. */
export function mentionedEstimators(text) {
  const base = String(text || '').replace(
    new RegExp(`Hartung${DASH}+\\s*Knapp${DASH}+\\s*Sidik${DASH}+\\s*Jonkman`, 'gi'), ' ');
  const found = [];
  for (const m of Object.keys(ESTIMATOR_PATTERNS)) {
    let probe = base;
    if (m === 'ML') probe = base.replace(/restricted maximum likelihood/gi, ' ').replace(/\bREML\b/gi, ' ');
    if (ESTIMATOR_PATTERNS[m].test(probe)) found.push(m);
  }
  return found;
}

/* Bracketed placeholders (the PH convention), excluding inline citation tokens
   [[cite:id]] and markdown links [text](url). */
const PLACEHOLDER_RE = /\[(?!\[)(?!cite:)[^\][\n]{3,}\](?!\()/g;

/**
 * @param {object} project  Project.data blob
 * @param {object} draft    normalized manuscript draft (model.normalizeDraft) —
 *                          reads draft.sections[id].content, draft.references,
 *                          draft.prismaOverrides.
 * @param {object} [opts]   { analysis:{model,tau2Method}, screening, prismaCounts }
 *                          (same shapes as generateDraft opts)
 * @returns {Array<{id:string, severity:'warn'|'info', section:string, message:string}>}
 */
export function checkConsistency(project, draft, opts = {}) {
  const out = [];
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const sect = (draft && draft.sections) || {};
  const text = (id) => String((sect[id] && sect[id].content) || '');
  const methodsTxt = text('methods');
  const resultsTxt = text('results');

  // (a) Methods mentions a τ² estimator that is NOT the configured one.
  const cfg = resolveAnalysis(project, opts);
  if (clean(methodsTxt) && cfg.model !== 'fixed') {
    const foreign = mentionedEstimators(methodsTxt).filter((m) => m !== cfg.tau2Method);
    if (foreign.length) {
      out.push({
        id: 'estimator-mismatch', severity: 'warn', section: 'methods',
        message: `Methods mentions the ${foreign.map((m) => TAU2_LABELS[m]).join(', ')} τ² estimator but the analysis is configured to use ${TAU2_LABELS[cfg.tau2Method]} — regenerate Methods or align the analysis settings.`,
      });
    }
  }

  // (b) PRISMA "included" disagrees with the number of studies carrying a
  // numeric effect estimate (skipped when included was itself computed from them).
  const pc = opts.prismaCounts
    || computePrismaCounts(project, { overrides: draft && draft.prismaOverrides, screening: opts.screening });
  const numeric = studies.filter((s) => s && s.es !== '' && s.es != null && !isNaN(+s.es)).length;
  if (pc.counts.included != null && studies.length > 0
      && pc.provenance.included !== 'computed' && pc.counts.included !== numeric) {
    out.push({
      id: 'included-vs-extracted', severity: 'warn', section: 'results',
      message: `PRISMA reports ${pc.counts.included} included studies but ${numeric} extracted stud${numeric === 1 ? 'y has' : 'ies have'} a numeric effect estimate — reconcile the flow counts with extraction.`,
    });
  }

  // (c) A poolable outcome (≥2 studies) is never mentioned in Results.
  if (clean(resultsTxt)) {
    const lower = resultsTxt.toLowerCase();
    for (const pair of getOutcomePairs(studies)) {
      const oc = clean(pair.outcome);
      if (!oc) continue;
      const subset = filterStudiesForOutcome(studies, pair);
      if (subset.length < 2) continue;
      if (!lower.includes(oc.toLowerCase())) {
        out.push({
          id: `outcome-missing:${pair.key}`, severity: 'warn', section: 'results',
          message: `The outcome "${pair.label}" has ${subset.length} studies with effect estimates but is never mentioned in Results — regenerate Results or add it.`,
        });
      }
    }
  }

  // (d) Reference list empty while included studies exist.
  if (studies.length && (!draft || !Array.isArray(draft.references) || !draft.references.length)) {
    out.push({
      id: 'references-empty', severity: 'info', section: 'references',
      message: `${studies.length} included stud${studies.length === 1 ? 'y exists' : 'ies exist'} but the manuscript reference list is empty — import references from the included studies.`,
    });
  }

  // (e) Sections still containing [bracketed placeholders].
  for (const s of SECTION_TYPES) {
    const t = text(s.id);
    if (!clean(t)) continue;
    const n = (t.match(PLACEHOLDER_RE) || []).length;
    if (n) {
      out.push({
        id: `placeholders:${s.id}`, severity: 'info', section: s.id,
        message: `${n} bracketed placeholder${n === 1 ? '' : 's'} remain${n === 1 ? 's' : ''} in ${s.label} — replace before submission.`,
      });
    }
  }

  // (f) Results narrates a pooled analysis but Methods is empty.
  if (clean(resultsTxt) && /pooled/i.test(resultsTxt) && !clean(methodsTxt)) {
    out.push({
      id: 'methods-empty', severity: 'warn', section: 'methods',
      message: 'Results reports a pooled analysis but the Methods section is empty — generate or write Methods before submission.',
    });
  }

  return out;
}

export default { checkConsistency, mentionedEstimators };
