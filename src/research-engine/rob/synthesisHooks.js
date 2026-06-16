/**
 * synthesisHooks.js — STUB extension points so RoB can later feed synthesis
 * (rob.md §6 / build step 6). These are intentionally minimal, pure, and inert:
 * they define the SHAPE of the integration without building forest-plot
 * annotation or GRADE now — so the rest of the app is not painted into a corner.
 *
 * PURE: no Prisma / Express / React / Date.now(). Each takes resolved per-result
 * RoB judgements and returns a plain, serialisable structure a future consumer
 * (forest plot / GRADE table) can render.
 */

/**
 * Map resolved RoB judgements onto study/effect rows so a forest plot can later
 * annotate each row with a risk-of-bias marker. STUB: returns the join only.
 * @param {Array<{studyId:string}>} effectRows  rows already on the forest plot
 * @param {Record<string,{overall:string, domains?:Record<string,string>}>} robByStudy
 * @returns {Array<{studyId:string, rob: {overall:string|null, domains?:object}|null}>}
 */
export function annotateForestRows(effectRows = [], robByStudy = {}) {
  return effectRows.map(r => ({
    studyId: r.studyId,
    rob: robByStudy[r.studyId] ? { overall: robByStudy[r.studyId].overall || null, domains: robByStudy[r.studyId].domains || null } : null,
  }));
}

/**
 * Summarise a set of RoB judgements into the "risk of bias" input GRADE uses to
 * decide whether to rate down for study limitations. STUB: tallies overall
 * judgements; the actual GRADE downgrade decision is deliberately NOT made here.
 * @param {Array<{overall:string}>} assessments
 * @returns {{ counts:{low:number,some:number,high:number}, total:number, gradeConcern:'none'|'serious'|'very_serious'|'unknown' }}
 */
export function gradeRiskOfBiasInput(assessments = []) {
  const counts = { low: 0, some: 0, high: 0 };
  for (const a of assessments) if (counts[a.overall] != null) counts[a.overall] += 1;
  const total = assessments.length;
  // Placeholder heuristic ONLY to expose the shape — a real GRADE assessment is
  // weight-aware and a human judgement; that is out of scope for v1 (stub).
  let gradeConcern = 'unknown';
  if (total > 0) {
    if (counts.high === 0 && counts.some === 0) gradeConcern = 'none';
    else if (counts.high > 0) gradeConcern = 'serious';
    else gradeConcern = 'none';
  }
  return { counts, total, gradeConcern };
}

export const ROB_SYNTHESIS_HOOKS_VERSION = 'v1-stub';
