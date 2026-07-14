/**
 * studyFilter.js
 * Shared, pure predicate for "should this extracted study take part in analysis?".
 *
 * 76.md added extraction-engine bookkeeping to `study.extractionMeta`
 * (`includedInAnalysis`, `archived`), but the analysis/pooling layer never read it,
 * so a study a reviewer explicitly EXCLUDED, or an outcome row they ARCHIVED, still
 * contributed to every pooled estimate, forest plot, heterogeneity statistic and
 * export (86.md audit finding P1.17). This module is the single source of truth so
 * the Analysis tab, GRADE, living-review snapshots and public synthesis all agree.
 *
 * Conservative by construction: a study is analyzable UNLESS it is explicitly
 * flagged out. Studies with no `extractionMeta` (classic tab, legacy projects) are
 * always included — the predicate never changes existing behaviour for them.
 */

/** True when the study is deliberately kept out of analysis (excluded or archived). */
export function isExcludedFromAnalysis(study) {
  const m = study && study.extractionMeta;
  if (!m || typeof m !== 'object') return false;
  return m.includedInAnalysis === false || m.archived === true;
}

/** Filter a study list down to the rows eligible for pooling. */
export function analyzableStudies(studies) {
  if (!Array.isArray(studies)) return [];
  return studies.filter((s) => !isExcludedFromAnalysis(s));
}
