/**
 * manuscript/readiness.js — 64.md (P3). Pure "manuscript readiness" checklist,
 * Smart-Insights warnings, and reproducibility metadata (analysis settings +
 * manifest). All derived honestly from live data — this is a helpful checklist,
 * NOT a fake score. No DOM/React.
 */

import { computePrismaCounts } from './prismaCounts.js';
import { primaryAnalysis } from './draft.js';
import { evaluateStaleness } from './sourceHash.js';
import { auditReferences, referencesFromProject } from './citations.js';
import { SECTION_IDS } from './model.js';
import { describeSynthesisModel, resolveAnalysis } from './analysisDescribe.js';
import { checkConsistency } from './consistency.js';

const clean = (s) => String(s == null ? '' : s).trim();
const nonEmpty = (sect, id) => !!(sect && sect[id] && clean(sect[id].content));

/**
 * Readiness checklist. Returns { items:[{key,label,complete,detail}], score }.
 * @param {object} project   Project.data blob
 * @param {object} draft     normalized manuscript draft (model.normalizeDraft)
 */
export function computeReadiness(project, draft, opts = {}) {
  const sect = (draft && draft.sections) || {};
  const pc = opts.prismaCounts || computePrismaCounts(project, { overrides: draft && draft.prismaOverrides });
  const refs = (draft && draft.references && draft.references.length) ? draft.references : referencesFromProject(project);
  const primary = opts.primary || primaryAnalysis(project, opts);
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const includedNumeric = studies.filter((s) => s && s.es !== '' && s.es != null && !isNaN(+s.es)).length;

  const prismaComplete = ['identified', 'screened', 'included'].every((k) => typeof pc.counts[k] === 'number');

  const items = [
    { key: 'title', label: 'Title', complete: nonEmpty(sect, 'title') || !!clean(project && project.name) },
    { key: 'abstract', label: 'Abstract', complete: nonEmpty(sect, 'abstract') },
    { key: 'introduction', label: 'Introduction', complete: nonEmpty(sect, 'introduction') },
    { key: 'methods', label: 'Methods', complete: nonEmpty(sect, 'methods') },
    { key: 'results', label: 'Results', complete: nonEmpty(sect, 'results') },
    { key: 'discussion', label: 'Discussion', complete: nonEmpty(sect, 'discussion') },
    { key: 'prisma', label: 'PRISMA counts', complete: prismaComplete, detail: prismaComplete ? '' : 'Identified/screened/included counts incomplete' },
    { key: 'studies', label: 'Included studies', complete: studies.length > 0, detail: studies.length ? `${studies.length} studies` : 'No studies' },
    { key: 'analysis', label: 'Meta-analysis', complete: !!(primary && primary.result), detail: primary && primary.result ? `k=${primary.result.k}` : 'No pooled analysis yet' },
    { key: 'references', label: 'References', complete: refs.length > 0, detail: refs.length ? `${refs.length} references` : 'No references' },
    { key: 'reproducibility', label: 'Reproducibility package', complete: includedNumeric > 0 && prismaComplete },
  ];

  const done = items.filter((i) => i.complete).length;
  return { items, score: { done, total: items.length, pct: Math.round((done / items.length) * 100) } };
}

/**
 * Smart-Insights — actionable submission warnings. Returns
 * [{ key, severity:'warning'|'info', message }]. Pure.
 */
export function smartInsights(project, draft, opts = {}) {
  const out = [];
  const push = (key, severity, message) => out.push({ key, severity, message });
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const search = (project && project.search) || {};
  const sect = (draft && draft.sections) || {};

  // PRISMA completeness
  const pc = opts.prismaCounts || computePrismaCounts(project, { overrides: draft && draft.prismaOverrides });
  for (const w of pc.warnings || []) push('prisma', 'warning', w);

  // Search date
  if (!clean(search.date)) push('search-date', 'warning', 'Search date is not entered — required for PRISMA / PRISMA-S reporting.');

  // Included studies missing extraction fields
  const incl = studies.filter((s) => s && (s.es !== '' && s.es != null && !isNaN(+s.es)));
  if (incl.length) {
    const noDesign = incl.filter((s) => !clean(s.design)).length;
    const noOutcome = incl.filter((s) => !clean(s.outcome)).length;
    if (noDesign) push('extraction', 'warning', `${noDesign} included stud${noDesign === 1 ? 'y is' : 'ies are'} missing study design.`);
    if (noOutcome) push('extraction', 'info', `${noOutcome} included stud${noOutcome === 1 ? 'y is' : 'ies are'} missing an outcome label.`);
  }

  // References lacking DOI/PMID
  const refs = (draft && draft.references && draft.references.length) ? draft.references : referencesFromProject(project);
  if (refs.length) {
    const audit = auditReferences(refs);
    if (audit.missingDoiOrPmid) push('references', 'warning', `${audit.missingDoiOrPmid} reference(s) lack a DOI or PMID.`);
    if (audit.missingJournal) push('references', 'info', `${audit.missingJournal} reference(s) have no journal name.`);
  }

  // RoB completeness
  const robMissing = incl.filter((s) => !s.rob || !Object.keys(s.rob).length).length;
  if (robMissing) push('rob', 'warning', `${robMissing} included stud${robMissing === 1 ? 'y has' : 'ies have'} no risk-of-bias assessment.`);

  // Analysis settings
  const primary = opts.primary || primaryAnalysis(project, opts);
  if (!primary || !primary.result) push('analysis', 'info', 'No pooled meta-analysis available yet — Results/SOF will use placeholders.');

  // Stale data blocks
  if (draft) {
    const stale = evaluateStaleness(draft, project);
    const staleIds = Object.keys(stale).filter((k) => stale[k].stale && draft.dataBlocks && draft.dataBlocks[k] && draft.dataBlocks[k].lastRefreshedAt);
    if (staleIds.length) push('stale', 'warning', `${staleIds.length} data-linked block(s) are out of date — refresh before exporting.`);
  }

  // AI-drafted, unreviewed
  if (draft) {
    const aiUnverified = SECTION_IDS.filter((id) => sect[id] && sect[id].aiGenerated && !sect[id].userEdited && clean(sect[id].content));
    if (aiUnverified.length) push('ai-review', 'info', `${aiUnverified.length} auto-drafted section(s) have not been reviewed/edited — verify before submission.`);
  }

  // 73.md Part 8 — cross-artefact consistency checks (estimator wording vs the
  // configured τ² method, PRISMA vs extraction, un-narrated outcomes, empty
  // references, leftover placeholders, Results-without-Methods). Additive
  // 'consistency:*' keys; the raw list is also exported via checkConsistency
  // for per-section UI badges.
  if (draft) {
    for (const c of checkConsistency(project, draft, { ...opts, prismaCounts: pc })) {
      push(`consistency:${c.id}`, c.severity === 'warn' ? 'warning' : 'info', c.message);
    }
  }

  return out;
}

/** Reproducibility analysis settings snapshot. 73.md Part 8 — describes the
 *  CONFIGURED estimator (opts.analysis → project.analysisSettings → DL) via the
 *  shared describeSynthesisModel instead of a hardcoded DL string; DL output is
 *  byte-identical, and tau2Method/synthesisModel are additive fields. Pure. */
export function analysisSettings(project, opts = {}) {
  const primary = opts.primary || primaryAnalysis(project, opts);
  const cfg = resolveAnalysis(project, {
    ...opts, model: (opts.analysis && opts.analysis.model) || (primary && primary.model) || opts.model,
  });
  const desc = describeSynthesisModel(cfg);
  return {
    effectMeasure: primary ? (primary.pair.esType || null) : null,
    model: (primary && primary.model) || cfg.model,
    tau2Method: cfg.tau2Method,
    synthesisModel: desc.label,
    heterogeneityMethod: desc.heterogeneityMethod,
    hksj: !!(primary && primary.result && primary.result.hksj),
    predictionInterval: !!(primary && primary.result && primary.result.predInt),
    continuityCorrection: null,
    k: primary && primary.result ? primary.result.k : null,
    outcomes: opts.outcomes || null,
    software: opts.software || null,
  };
}

/** Reproducibility manifest object (serialised to manifest.json). Pure. */
export function buildReproManifest(opts = {}) {
  return {
    schema: 'pecanrev-reproducibility/1',
    projectId: opts.projectId || null,
    projectName: opts.projectName || null,
    manuscriptId: opts.manuscriptId || null,
    generatedAt: opts.generatedAt || null,
    generatedBy: opts.generatedBy || null,
    appVersion: opts.appVersion || null,
    engineVersions: opts.engineVersions || null,
    citationStyle: opts.citationStyle || null,
    templateId: opts.templateId || null,
    analysisSettings: opts.analysisSettings || null,
    files: (opts.files || []).map((f) => (typeof f === 'string' ? { name: f } : { name: f.name, note: f.note || '' })),
    warnings: opts.warnings || [],
  };
}

export default { computeReadiness, smartInsights, analysisSettings, buildReproManifest };
