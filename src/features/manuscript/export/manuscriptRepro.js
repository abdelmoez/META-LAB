/**
 * features/manuscript/export/manuscriptRepro.js — 64.md (P3). One-click
 * reproducibility package (.zip), assembled CLIENT-side (reuses the in-repo
 * zero-dependency STORE zip writer). Bundles the manuscript, PRISMA diagram +
 * checklists, datasets, analysis settings, methods text, and a manifest:
 *
 *   manuscript.docx
 *   prisma/prisma_2020.png, prisma/prisma_2020.svg
 *   prisma/prisma_checklist.csv, prisma/prisma_s_checklist.csv
 *   data/included_studies.csv, data/extraction_data.csv, data/analysis_dataset.csv
 *   data/risk_of_bias.csv, search/search_strategy.csv
 *   methods/methods.txt, settings/analysis_settings.json, manifest.json
 *
 * Missing data is represented honestly (empty CSVs carry a header + note; figures
 * are skipped when no analysis exists) — never fabricated.
 */
import {
  computePrismaCounts,
  buildStudyCharacteristicsTable, buildSummaryOfFindingsTable, buildPrismaCountsTable,
  buildRobTable, buildSearchStrategyTable,
  primaryAnalysis, analysisSettings, buildReproManifest, generateMethods,
} from '../../../research-engine/manuscript/index.js';
import { buildStudyTableCSV, getOutcomePairs, filterStudiesForOutcome } from '../../../research-engine/import-export/journalSubmission.js';
import { zipFiles } from '../../../frontend/components/exportCore.js';
import { prismaChecklistCsv, prismaSChecklistCsv } from './checklistExport.js';
import { buildManuscriptDocx } from './manuscriptDocx.js';
import { forestPng, forestSvg, prismaSvg } from './figures.js';

const csvCell = (v) => {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Generic table-builder result → CSV string (UTF-8 BOM). */
function tableCsv(tbl) {
  if (!tbl || !tbl.columns) return '';
  const header = tbl.columns.map((c) => csvCell(c.label)).join(',');
  const rows = (tbl.rows || []).map((r) => tbl.columns.map((c) => csvCell(r[c.key])).join(','));
  return '﻿' + [header, ...rows].join('\n') + '\n';
}

/** Analysis dataset CSV: one row per study × outcome with the inputs that drive the pool. */
function analysisDatasetCsv(project) {
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const pairs = getOutcomePairs(studies);
  const header = ['outcome', 'timepoint', 'effect_measure', 'study', 'year', 'es', 'ci_lower', 'ci_upper', 'n_exp', 'n_ctrl', 'n_total'].map(csvCell).join(',');
  const lines = [];
  for (const pair of pairs) {
    for (const s of filterStudiesForOutcome(studies, pair)) {
      const study = s.author || (s.authors || '').split(/[,;]/)[0] || s.title;
      const nTotal = s.n || (((Number(s.nExp) || 0) + (Number(s.nCtrl) || 0)) || '');
      lines.push([pair.outcome, pair.timepoint, pair.esType, study, s.year, s.es, s.lo, s.hi, s.nExp || '', s.nCtrl || '', nTotal].map(csvCell).join(','));
    }
  }
  return '﻿' + [header, ...lines].join('\n') + '\n';
}

/**
 * Build the reproducibility package Blob (.zip).
 * @param {object} project   Project.data blob
 * @param {object} draft     normalized manuscript draft
 * @param {object} [opts]    { runMeta, prec, appVersion, engineVersions, generatedAt,
 *   generatedBy, software, gradeByOutcome,
 *   // 73.md Part 8 — live-wired data (all optional; absent → legacy output):
 *   screening, screeningWorkflow, searchMethodsText, analysis,
 *   robAssessments, robByStudyId, perSource }
 * @returns {Promise<Blob>}
 */
export async function buildReproPackage(project, draft, opts = {}) {
  const warnings = [];
  // 73.md Part 8 — thread the SAME live-wired sources the on-screen tables use so
  // the bundle can never disagree with the workspace (screening → PRISMA counts,
  // RoB v2 → risk-of-bias table, pecan per-source → search table).
  const prismaResult = computePrismaCounts(project, {
    overrides: draft.prismaOverrides,
    ...(opts.screening ? { screening: opts.screening } : {}),
  });
  warnings.push(...(prismaResult.warnings || []));
  const primary = primaryAnalysis(project, { runMeta: opts.runMeta, ...(opts.analysis ? { analysis: opts.analysis } : {}) });

  const studyTbl = buildStudyCharacteristicsTable(project, opts.robByStudyId ? { robByStudyId: opts.robByStudyId } : {});
  const robTbl = buildRobTable(project, opts.robAssessments ? { assessments: opts.robAssessments } : {});
  const searchTbl = buildSearchStrategyTable(project, opts.perSource ? { perSource: opts.perSource } : {});
  const sofTbl = buildSummaryOfFindingsTable(project, { runMeta: opts.runMeta, prec: opts.prec, gradeByOutcome: opts.gradeByOutcome });

  const entries = [];

  // manuscript.docx (best-effort; never blocks the bundle). P12 — forward the GRADE
  // certainty map so the bundled manuscript's SoF gets its Certainty (GRADE) column;
  // 73.md — pass the live-wired tables so the docx matches the bundle CSVs exactly.
  try {
    const docxBlob = await buildManuscriptDocx(project, draft, {
      runMeta: opts.runMeta, prec: opts.prec, prismaResult, primary, includeFigures: true,
      gradeByOutcome: opts.gradeByOutcome,
      tables: {
        study: studyTbl,
        sof: sofTbl,
        prisma: buildPrismaCountsTable(prismaResult),
        rob: robTbl,
        search: searchTbl,
      },
    });
    entries.push({ name: 'manuscript.docx', blob: docxBlob });
  } catch (e) {
    warnings.push(`Manuscript .docx could not be generated for the bundle: ${e && e.message}`);
  }

  // PRISMA diagram (PNG + SVG)
  const svg = prismaSvg(prismaResult, {});
  if (svg) entries.push({ name: 'prisma/prisma_2020.svg', text: svg });
  try {
    const { prismaPng } = await import('./figures.js');
    const pr = await prismaPng(prismaResult, {});
    if (pr && pr.blob) entries.push({ name: 'prisma/prisma_2020.png', blob: pr.blob });
  } catch { warnings.push('PRISMA PNG could not be rasterized in this environment.'); }

  // Forest plot (SVG + PNG) when an analysis exists. The vector SVG comes from the
  // PURE builder so it survives even if PNG rasterization (DOM canvas) fails.
  if (primary && primary.result) {
    const fsvg = forestSvg(primary.result, { esType: primary.pair.esType, title: primary.pair.label, prec: opts.prec });
    if (fsvg) entries.push({ name: 'figures/forest_plot.svg', text: fsvg });
    try {
      const fp = await forestPng(primary.result, { esType: primary.pair.esType, title: primary.pair.label, prec: opts.prec });
      if (fp && fp.blob) entries.push({ name: 'figures/forest_plot.png', blob: fp.blob });
    } catch { warnings.push('Forest plot PNG could not be rasterized in this environment (SVG included).'); }
  } else {
    warnings.push('No pooled meta-analysis available — forest plot omitted.');
  }

  // Checklists
  entries.push({ name: 'prisma/prisma_checklist.csv', text: prismaChecklistCsv(project, draft) });
  entries.push({ name: 'prisma/prisma_s_checklist.csv', text: prismaSChecklistCsv(project) });

  // Datasets
  entries.push({ name: 'data/included_studies.csv', text: buildStudyTableCSV(project.studies || []) });
  entries.push({ name: 'data/extraction_data.csv', text: tableCsv(studyTbl) });
  entries.push({ name: 'data/analysis_dataset.csv', text: analysisDatasetCsv(project) });
  entries.push({ name: 'data/risk_of_bias.csv', text: tableCsv(robTbl) });
  entries.push({ name: 'search/search_strategy.csv', text: tableCsv(searchTbl) });

  // Methods text — grounded in the same live wiring (search-builder methods text,
  // screening workflow facts, configured synthesis model) when available.
  entries.push({
    name: 'methods/methods.txt',
    text: (draft.sections.methods && draft.sections.methods.content) || generateMethods(project, {
      prismaCounts: prismaResult, primary, software: opts.software,
      ...(opts.analysis ? { analysis: opts.analysis } : {}),
      ...(opts.screening ? { screening: opts.screening } : {}),
      ...(opts.searchMethodsText ? { searchMethodsText: opts.searchMethodsText } : {}),
      ...(opts.screeningWorkflow ? { screeningWorkflow: opts.screeningWorkflow } : {}),
      ...(opts.robAssessments ? { robAssessments: opts.robAssessments } : {}),
    }),
  });

  // Analysis settings
  const settings = analysisSettings(project, {
    primary, software: opts.software,
    ...(opts.analysis ? { analysis: opts.analysis } : {}),
    outcomes: getOutcomePairs(project.studies || []).map((p) => p.label),
  });
  entries.push({ name: 'settings/analysis_settings.json', text: JSON.stringify(settings, null, 2) });

  // Manifest LAST so it lists every file
  const manifest = buildReproManifest({
    projectId: project.id,
    projectName: project.name,
    manuscriptId: draft.id,
    generatedAt: opts.generatedAt || null,
    generatedBy: opts.generatedBy || null,
    appVersion: opts.appVersion || null,
    engineVersions: opts.engineVersions || null,
    citationStyle: draft.citationStyle,
    templateId: draft.templateId,
    analysisSettings: settings,
    files: entries.map((e) => e.name),
    warnings,
  });
  entries.push({ name: 'manifest.json', text: JSON.stringify(manifest, null, 2) });

  return zipFiles(entries, opts.date ? { date: opts.date } : {});
}

export default { buildReproPackage };
