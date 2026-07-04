/**
 * features/manuscript/manuscriptData.js — 73.md Part 8 (data wiring). Pure
 * mappers + a soft-fail fetch orchestrator that ground the manuscript
 * generators in the project's LIVE data:
 *
 *   screening counts   GET /api/screening/metalab/:pid/summary    (linked-workspace
 *                      PRISMA rollup — import-dedup aware, the SAME source the
 *                      PRISMA Flow tab consumes; no client-side link resolution)
 *   screening workflow GET /api/screening/projects/:spid/overview (reviewers/blind;
 *                      spid = project._linkedMetaSift.id, mirrors
 *                      projectHelpers.linkedSiftId — also a COUNTS fallback when
 *                      the summary endpoint is unavailable)
 *   search methods     GET /api/search-builder/:pid/methods-text  (searchEngine flag)
 *   RoB v2             GET /api/rob/projects/:pid/assessments     (rob_engine_v2 flag)
 *   pecan per-source   GET /api/pecan-search/projects/:pid/runs (+ /runs/:rid) —
 *                      newest COMPLETED run's per-database record counts/queries
 *
 * EVERY fetch is soft-fail: a disabled flag, a 404, or a network error can never
 * block manuscript generation — the generators simply fall back to their legacy
 * inputs, and the Overview "Data sources" card reports availability honestly via
 *   dataStatus: { screening:'ok'|'unlinked'|'error', search:'ok'|'off'|'error',
 *                 rob:'ok'|'off'|'error', grade:'ok'|'off'|'error',
 *                 pecan:'ok'|'off'|'error' }
 *
 * Publication bias (73.md A6) is intentionally NOT computed here: the engine
 * already runs a deterministic Egger fallback for every outcome with k≥10 using
 * the same statistics module the Analysis tab uses, so precomputing client-side
 * would add cost without changing output.
 *
 * All mappers are PURE and exported for unit tests; `fetchImpl` is injectable.
 */

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Empty result — also the pre-fetch default state the hook starts from. */
export function emptyManuscriptSources() {
  return {
    screening: null,
    screeningWorkflow: null,
    searchMethodsText: '',
    robAssessments: null,
    robByStudyId: null,
    perSource: null,
    dataStatus: { screening: 'unlinked', search: 'off', rob: 'off', grade: 'off', pecan: 'off' },
  };
}

/**
 * recs round — the boolean availability vector of the soft-fetched sources a
 * generation actually saw. Stamped onto generated sections (sourceAvailability)
 * and compared before OUTDATED detection: a hash computed WITH live screening
 * counts must never be compared against one computed WITHOUT them (a fetch blip
 * would otherwise flag every grounded section as outdated — and one click of
 * "Regenerate" would replace real counts with placeholders).
 */
export function sourceAvailability(sources) {
  const s = sources || {};
  return {
    screening: !!s.screening,
    search: !!(typeof s.searchMethodsText === 'string' && s.searchMethodsText.trim()),
    rob: !!(s.robAssessments && Object.keys(s.robAssessments).length),
    pecan: !!s.perSource,
  };
}

/** True when two availability vectors describe the same set of live sources. */
export function availabilityEqual(a, b) {
  if (!a || !b) return false;
  return ['screening', 'search', 'rob', 'pecan'].every((k) => !!a[k] === !!b[k]);
}

/** Linked META·SIFT ScreenProject id (mirrors projectHelpers.linkedSiftId —
 *  duplicated here so the manuscript chunk never pulls the workspace helpers). */
export function linkedScreenProjectId(project) {
  return (project && project._linkedMetaSift && project._linkedMetaSift.id)
    || (project && project._screenProjectId) || null;
}

/**
 * GET /api/screening/metalab/:pid/summary → engine screening opts
 * ({identified, afterDedup, screened, excluded, included} — any subset).
 * The summary's `prisma` rollup already accounts for import-time dedup. Pure.
 */
export function mapScreeningSummary(d) {
  if (!d || d.linked !== true || !d.prisma) return null;
  const p = d.prisma;
  const identified = num(p.identified);
  const dups = num(p.duplicatesRemoved);
  const out = {};
  if (identified != null) out.identified = identified;
  if (identified != null && dups != null) out.afterDedup = identified - dups;
  if (num(p.screened) != null) out.screened = num(p.screened);
  if (num(p.excludedTitleAbstract) != null) out.excluded = num(p.excludedTitleAbstract);
  if (num(p.included) != null) out.included = num(p.included);
  return Object.keys(out).length ? out : null;
}

/**
 * GET /api/screening/projects/:spid/overview → screening-count SUBSET fallback.
 * Only fields with unambiguous PRISMA semantics are mapped (identified = total
 * records, afterDedup/screened = non-duplicate pool, included = accepted to
 * extraction); title/abstract exclusions are NOT derivable here so `excluded`
 * is honestly omitted. Pure.
 */
export function mapScreeningOverview(d) {
  const ds = d && d.dataSummary;
  if (!ds) return null;
  const out = {};
  if (num(ds.totalArticles) != null) out.identified = num(ds.totalArticles);
  if (num(ds.screeningPool) != null) {
    out.afterDedup = num(ds.screeningPool);
    out.screened = num(ds.screeningPool);
  }
  if (num(ds.acceptedToExtraction) != null) out.included = num(ds.acceptedToExtraction);
  return Object.keys(out).length ? out : null;
}

/** Overview → { reviewers, blind } for the Methods study-selection paragraph. Pure. */
export function mapScreeningWorkflow(d) {
  const p = d && d.project;
  if (!p) return null;
  const reviewers = num(p.requiredScreeningReviewers) != null
    ? num(p.requiredScreeningReviewers) : num(p.quorum);
  const out = {};
  if (reviewers != null) out.reviewers = reviewers;
  if (typeof p.blindMode === 'boolean') out.blind = p.blindMode;
  return Object.keys(out).length ? out : null;
}

/* RoB v2 judgement vocabulary → the display labels the tables/narration render.
   Covers RoB 2 (low/some/high) and ROBINS-I (low/moderate/serious/critical). */
const ROB_RANK = { low: 1, some: 2, moderate: 2, high: 3, serious: 3, critical: 4 };
const ROB_LABEL = {
  low: 'Low',
  some: 'Some concerns',
  moderate: 'Moderate',
  high: 'High',
  serious: 'Serious',
  critical: 'Critical',
  no_information: 'No information',
};

/** One RoB judgement value → display label ('' when empty). Pure. */
export function robJudgementLabel(v) {
  const k = String(v == null ? '' : v).toLowerCase().trim();
  if (!k) return '';
  if (ROB_LABEL[k]) return ROB_LABEL[k];
  return k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
}

/**
 * GET /api/rob/projects/:pid/assessments → the engine's structured shape:
 *   assessments  { [studyId]: { domains:{D1:'Low',…}, overall, tool } }
 *   robByStudyId { [studyId]: 'Low'|'Some concerns'|… } (study-table column)
 * When a study has several outcome-level assessments the WORST overall wins
 * (conservative — matches the journal-submission export). Returns null when the
 * list is empty. Pure.
 */
export function mapRobAssessments(rows) {
  const byStudy = {};
  for (const a of (Array.isArray(rows) ? rows : [])) {
    if (!a || !a.studyId) continue;
    const rank = ROB_RANK[String(a.overall || '').toLowerCase()] || 0;
    const prev = byStudy[a.studyId];
    if (prev && prev.rank >= rank) continue;
    byStudy[a.studyId] = { rank, a };
  }
  const assessments = {};
  const robByStudyId = {};
  for (const sid of Object.keys(byStudy)) {
    const { a } = byStudy[sid];
    const domains = {};
    const dj = (a.domainJudgments && typeof a.domainJudgments === 'object') ? a.domainJudgments
      : ((a.domains && typeof a.domains === 'object') ? a.domains : {});
    for (const k of Object.keys(dj)) {
      const lbl = robJudgementLabel(dj[k]);
      if (lbl) domains[k] = lbl;
    }
    const overall = robJudgementLabel(a.overall);
    const entry = { domains, overall };
    if (a.instrumentId) entry.tool = a.instrumentId;
    assessments[sid] = entry;
    if (overall) robByStudyId[sid] = overall;
  }
  return Object.keys(assessments).length ? { assessments, robByStudyId } : null;
}

/** Newest run with state 'completed' (by completedAt, falling back to createdAt). Pure. */
export function pickLatestCompletedRun(runs) {
  const list = (Array.isArray(runs) ? runs : []).filter((r) => r && r.state === 'completed');
  list.sort((x, y) => String(y.completedAt || y.createdAt || '')
    .localeCompare(String(x.completedAt || x.createdAt || '')));
  return list[0] || null;
}

/**
 * Pecan run detail → buildSearchStrategyTable's opts.perSource:
 *   { [dbKey]: { records, searchedAt, query } }
 * records = raw records retrieved from that database (the PRISMA-S count);
 * searchedAt = the source's completion date (YYYY-MM-DD); query = the exact
 * translated query executed. Returns null when nothing per-source exists. Pure.
 */
export function mapPecanPerSource(run) {
  if (!run) return null;
  const out = {};
  const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
  const ps = (run.counts && run.counts.perSource) || {};
  for (const s of (Array.isArray(run.sources) ? run.sources : [])) {
    if (!s || !s.provider) continue;
    const raw = s.rawCount != null ? s.rawCount : (ps[s.provider] && ps[s.provider].raw);
    out[s.provider] = {
      records: num(raw),
      searchedAt: day(s.completedAt || run.completedAt),
      query: s.finalQuery || s.generatedQuery || '',
    };
  }
  for (const k of Object.keys(ps)) {
    if (!out[k]) out[k] = { records: num(ps[k].raw), searchedAt: day(run.completedAt), query: '' };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Compose the generateDraft/tables opts from (project, gradeByOutcome, sources).
 * PURE so the exact genOpts contract is unit-testable without React:
 *   - always: runMeta, prec, analysis:{model:'random'[, tau2Method]} — the
 *     tau2Method is included ONLY when the project persisted one
 *     (project.analysisSettings.tau2Method), keeping legacy DL output
 *     byte-identical for projects that never touched the estimator picker;
 *   - conditionally: gradeByOutcome / screening / searchMethodsText /
 *     robAssessments / reviewers / blind — only when actually available, so an
 *     absent source can never change the legacy generation path.
 */
export function composeGenOpts({ project, runMeta, gradeByOutcome, sources } = {}) {
  const src = sources || emptyManuscriptSources();
  const projTau2 = project && project.analysisSettings && project.analysisSettings.tau2Method;
  const analysis = projTau2 ? { model: 'random', tau2Method: projTau2 } : { model: 'random' };
  const out = {
    runMeta,
    prec: project && project.analysisPrecision,
    analysis,
  };
  if (gradeByOutcome) out.gradeByOutcome = gradeByOutcome;
  if (src.screening) out.screening = src.screening;
  if (src.searchMethodsText) out.searchMethodsText = src.searchMethodsText;
  if (src.robAssessments) out.robAssessments = src.robAssessments;
  if (src.screeningWorkflow) {
    // methodsText + sources.js read the FLAT reviewers/blind keys.
    if (src.screeningWorkflow.reviewers != null) out.reviewers = src.screeningWorkflow.reviewers;
    if (src.screeningWorkflow.blind != null) out.blind = src.screeningWorkflow.blind;
  }
  return out;
}

/**
 * Fetch every live data source for the manuscript, in parallel, soft-fail.
 * Never throws; every failure degrades to the legacy generation inputs plus an
 * honest dataStatus entry. `fetchImpl` is injectable for tests.
 * @returns Promise<ReturnType<typeof emptyManuscriptSources>>
 */
export async function fetchManuscriptSources({ projectId, screenProjectId, fetchImpl } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const out = emptyManuscriptSources();
  if (!projectId) return out;
  const enc = encodeURIComponent;

  const j = async (url) => {
    const r = await f(url, { credentials: 'include' });
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return r.json();
  };

  let flags = {};
  try {
    const d = await j('/api/settings/public');
    flags = (d && d.featureFlags) || {};
  } catch { flags = {}; }

  // GRADE availability (the SoF certainty map itself is fetched by the existing
  // soft gradeApi path in useManuscript — this only powers the Data-sources card).
  out.dataStatus.grade = flags.gradeCertainty === true ? 'ok' : 'off';

  const tasks = [];

  // 1) Screening counts — linked-workspace PRISMA rollup keyed by the ML project id.
  tasks.push((async () => {
    try {
      const d = await j(`/api/screening/metalab/${enc(projectId)}/summary`);
      if (d && d.linked === true) {
        out.screening = mapScreeningSummary(d);
        out.dataStatus.screening = 'ok';
      } else {
        out.dataStatus.screening = 'unlinked';
      }
    } catch {
      out.dataStatus.screening = 'error';
    }
  })());

  // 1b) Screening workflow (reviewers/blind) + counts fallback, via the linked
  //     ScreenProject's overview. Enrichment only — failures stay silent.
  tasks.push((async () => {
    if (!screenProjectId) return;
    try {
      const d = await j(`/api/screening/projects/${enc(screenProjectId)}/overview`);
      out.screeningWorkflow = mapScreeningWorkflow(d);
      if (!out.screening) {
        const sc = mapScreeningOverview(d);
        if (sc) {
          out.screening = sc;
          out.dataStatus.screening = 'ok';
        }
      }
    } catch { /* workflow is enrichment only */ }
  })());

  // 2) Search-builder methods text (searchEngine flag).
  tasks.push((async () => {
    if (flags.searchEngine !== true) { out.dataStatus.search = 'off'; return; }
    try {
      const d = await j(`/api/search-builder/${enc(projectId)}/methods-text`);
      out.searchMethodsText = (d && typeof d.text === 'string') ? d.text : '';
      out.dataStatus.search = 'ok';
    } catch (e) {
      out.dataStatus.search = (e && e.status === 404) ? 'off' : 'error';
    }
  })());

  // 3) RoB v2 assessments (rob_engine_v2 flag; 404 also means "not owner").
  tasks.push((async () => {
    if (flags.rob_engine_v2 !== true) { out.dataStatus.rob = 'off'; return; }
    try {
      const d = await j(`/api/rob/projects/${enc(projectId)}/assessments`);
      const mapped = mapRobAssessments(d && d.assessments);
      if (mapped) {
        out.robAssessments = mapped.assessments;
        out.robByStudyId = mapped.robByStudyId;
      }
      out.dataStatus.rob = 'ok';
    } catch (e) {
      out.dataStatus.rob = (e && e.status === 404) ? 'off' : 'error';
    }
  })());

  // 4) Pecan per-source counts from the newest COMPLETED run (trio-gated like
  //    the run UI: pecanSearch AND searchEngine).
  tasks.push((async () => {
    if (flags.pecanSearch !== true || flags.searchEngine !== true) {
      out.dataStatus.pecan = 'off';
      return;
    }
    try {
      const d = await j(`/api/pecan-search/projects/${enc(projectId)}/runs?skip=0&take=20`);
      const latest = pickLatestCompletedRun(d && d.runs);
      if (latest) {
        const rd = await j(`/api/pecan-search/projects/${enc(projectId)}/runs/${enc(latest.id)}`);
        out.perSource = mapPecanPerSource(rd && rd.run);
      }
      out.dataStatus.pecan = 'ok'; // feature reachable ('ok' with perSource null = no completed run yet)
    } catch (e) {
      out.dataStatus.pecan = (e && e.status === 404) ? 'off' : 'error';
    }
  })());

  await Promise.all(tasks);
  return out;
}

export default {
  emptyManuscriptSources,
  linkedScreenProjectId,
  mapScreeningSummary,
  mapScreeningOverview,
  mapScreeningWorkflow,
  robJudgementLabel,
  mapRobAssessments,
  pickLatestCompletedRun,
  mapPecanPerSource,
  composeGenOpts,
  fetchManuscriptSources,
};
