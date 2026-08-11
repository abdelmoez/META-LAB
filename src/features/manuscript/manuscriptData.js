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
 *   search provenance  GET /api/search-builder/:pid/provenance    (searchEngine flag)
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

// 101.md §27 — the tools actually used, derived from the assessment rows.
import { deriveRobUsage } from '../../research-engine/rob/usage.js';
import { deriveSearchMethodology } from '../../research-engine/search/searchMethodology.js';

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
    // 115.md decision 7 — the per-INSTRUMENT breakdown behind the two flat maps
    // above: [{ instrumentId, studyCount, assessments, robByStudyId }]. Present so
    // a mixed-tool review can be reported per tool instead of pooled into one
    // figure; the flat maps stay single-tool by construction.
    robByInstrument: null,
    // 101.md §27 — { tools:[{id,label,designLabel,scoring,count}], assessedCount, … }
    robUsage: null,
    perSource: null,
    // 103.md §10/§15 — the canonical record-derived PRISMA flow. When present it
    // OUTRANKS every legacy counter tier, so the manuscript reports numbers that
    // came from records and a user-typed value can no longer win.
    prismaFlow: null,
    // 101.md §1/§2 — deriveSearchProvenance output. null = "we do not know which
    // databases were searched", which is NOT the same as "none were" and must
    // never be rendered as a database list.
    searchProvenance: null,
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
  // 77.md §1 — thread the honest dedup metadata so the manuscript can state whether
  // deduplication was performed (and how/when), never inferring "0 duplicates" from
  // silence. `dedupePerformed:false` is a meaningful signal, not missing data.
  const dd = d.dedup && typeof d.dedup === 'object' ? d.dedup : null;
  if (dd) {
    out.dedupePerformed = dd.performed === true;
    if (dd.method) out.dedupeMethod = String(dd.method);
    if (dd.lastRunAt) out.dedupeLastRunAt = String(dd.lastRunAt);
  }
  // 77.md §1 — per-source identification split. Only feed dbs/reg/other into the PRISMA
  // counts when it is EXACT (no import-time dups), so identified = dbs+reg+other stays
  // consistent with the separately-reported identified total.
  const sr = d.sources && typeof d.sources === 'object' ? d.sources : null;
  if (sr && sr.exact === true) {
    if (num(sr.databases) != null) out.dbs = num(sr.databases);
    if (num(sr.registers) != null) out.reg = num(sr.registers);
    if (num(sr.other) != null) out.other = num(sr.other);
  }
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

/** The instrument a row with no `instrumentId` belongs to (the server's default). */
const DEFAULT_ROB_TOOL_ID = 'RoB2';

/**
 * The instruments whose OVERALL value is a RISK-OF-BIAS severity scale, so two
 * values of the SAME tool may legitimately be compared for "which is worse".
 *
 * This qualifier exists because the vocabularies COLLIDE on polarity: AMSTAR 2's
 * overall is a CONFIDENCE rating whose best level is literally 'high', which
 * ROB_RANK scores as the worst possible risk. Ranking an AMSTAR 2 row would
 * therefore invert its meaning, so its rows are taken in list order instead. The
 * JBI checklists end in an appraisal DECISION (include / exclude / seek further
 * info), which has no severity order at all.
 */
const RANKED_ROB_TOOLS = new Set(['RoB2', 'ROBINS-I', 'QUADAS-2', 'QUIPS', 'PROBAST']);
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

/** One assessment row → the `{ domains, overall, tool }` entry the tables read. */
function robEntryFor(a) {
  const domains = {};
  const dj = (a.domainJudgments && typeof a.domainJudgments === 'object') ? a.domainJudgments
    : ((a.domains && typeof a.domains === 'object') ? a.domains : {});
  for (const k of Object.keys(dj)) {
    const lbl = robJudgementLabel(dj[k]);
    if (lbl) domains[k] = lbl;
  }
  const entry = { domains, overall: robJudgementLabel(a.overall) };
  if (a.instrumentId) entry.tool = a.instrumentId;
  return entry;
}

/** Of two rows of the SAME instrument, the one this tool's scale calls worse. */
function worseOfSameTool(instrumentId, prev, next) {
  // A tool with no severity order (AMSTAR 2's confidence rating, a JBI appraisal
  // decision) is never ranked — the first row for the study stands.
  if (!RANKED_ROB_TOOLS.has(instrumentId)) return prev;
  const rank = (r) => ROB_RANK[String((r && r.overall) || '').toLowerCase()] || 0;
  return rank(next) > rank(prev) ? next : prev;
}

/**
 * GET /api/rob/projects/:pid/assessments → the engine's structured shape:
 *   assessments   { [studyId]: { domains:{D1:'Low',…}, overall, tool } }
 *   robByStudyId  { [studyId]: 'Low'|'Some concerns'|… } (study-table column)
 *   byInstrument  [{ instrumentId, studyCount, assessments, robByStudyId }]
 *   instrumentIds / primaryInstrumentId / mixedTools
 *
 * ── ROWS ARE GROUPED BY INSTRUMENT, NEVER POOLED ACROSS TOOLS (115.md dec. 7) ──
 * This used to collapse every assessment of a study to the worst overall across
 * ALL of them via ROB_RANK. In a single-tool review that is the intended
 * conservative rule (several outcome-level RoB 2 rows → the worst one). In a
 * mixed-tool review it is a cross-tool aggregation, which decision 7 forbids
 * everywhere else — and it is not merely untidy: the vocabularies collide, so an
 * AMSTAR 2 row rated "High confidence" (the BEST outcome that tool can give)
 * outranked a RoB 2 "Low risk of bias" and became the study's reported judgement.
 *
 * So the rows are grouped by `instrumentId` exactly the way the server's
 * `groups[]` are, and the worst-overall rule applies only WITHIN one tool, and
 * only where that tool's overall is a severity scale (see RANKED_ROB_TOOLS).
 *
 * The flat `assessments` / `robByStudyId` maps that the RoB table and the study
 * characteristics table read keep their exact shape, because those tables have one
 * column set (from `project.robMethod`) and cannot render two tools at once. A
 * study assessed with several tools takes its entry from the PRIMARY tool (the one
 * covering the most studies) when that tool assessed it, else from the first tool
 * by id — a deterministic choice within one instrument, never a comparison across
 * two. `byInstrument` carries the complete per-tool picture for any consumer that
 * wants it, and `deriveRobUsage` already reports the per-tool counts.
 *
 * Returns null when the list is empty. Pure.
 */
export function mapRobAssessments(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((a) => a && a.studyId);

  // 1) Group by instrument; within a group, one row per study.
  const groups = new Map(); // instrumentId -> Map(studyId -> row)
  for (const a of list) {
    const iid = a.instrumentId || DEFAULT_ROB_TOOL_ID;
    if (!groups.has(iid)) groups.set(iid, new Map());
    const byStudy = groups.get(iid);
    const prev = byStudy.get(a.studyId);
    byStudy.set(a.studyId, prev ? worseOfSameTool(iid, prev, a) : a);
  }
  if (!groups.size) return null;

  const instrumentIds = [...groups.keys()].sort();
  const byInstrument = instrumentIds.map((instrumentId) => {
    const assessments = {};
    const robByStudyId = {};
    for (const [sid, a] of groups.get(instrumentId)) {
      const entry = robEntryFor(a);
      assessments[sid] = entry;
      if (entry.overall) robByStudyId[sid] = entry.overall;
    }
    return {
      instrumentId,
      studyCount: Object.keys(assessments).length,
      assessments,
      robByStudyId,
    };
  });

  // 2) The primary tool: the one covering the most studies (ties → lowest id).
  const primary = byInstrument.reduce((best, g) => (g.studyCount > best.studyCount ? g : best), byInstrument[0]);

  // 3) The flat maps — each study served by ONE tool, never a blend of two.
  const assessments = {};
  const robByStudyId = {};
  for (const g of [primary, ...byInstrument.filter((x) => x !== primary)]) {
    for (const sid of Object.keys(g.assessments)) {
      if (assessments[sid]) continue;
      assessments[sid] = g.assessments[sid];
      if (g.robByStudyId[sid]) robByStudyId[sid] = g.robByStudyId[sid];
    }
  }

  return Object.keys(assessments).length
    ? {
      assessments,
      robByStudyId,
      byInstrument,
      instrumentIds,
      primaryInstrumentId: primary.instrumentId,
      mixedTools: byInstrument.length > 1,
    }
    : null;
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
 * 104.md — the non-database ways studies were identified, read off the PRISMA
 * flow's other-methods arm (citation searching, hand searching, a colleague's
 * suggestion). These are search METHODS, not databases, so they never join the
 * "We searched …" clause; they exist so a Methods section can report them where
 * PRISMA item 6 asks for "other sources".
 */
export function otherMethodsFromFlow(flow) {
  const rows = (flow && flow.sources && Array.isArray(flow.sources.other)) ? flow.sources.other : [];
  const out = [];
  for (const r of rows) {
    const label = String((r && r.label) || '').trim();
    if (!label || /^other methods$/i.test(label)) continue;
    if (!out.includes(label)) out.push(label);
  }
  return out;
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
  // NOTE: `factTokens` is deliberately NOT set here. composeGenOpts is about which
  // live SOURCES are available, and its byte-compat contract is that an absent
  // source can never change the generation path. Emitting live tokens is a product
  // decision, so it is applied at the generation call sites in useManuscript.
  if (gradeByOutcome) out.gradeByOutcome = gradeByOutcome;
  if (src.screening) out.screening = src.screening;
  if (src.searchMethodsText) out.searchMethodsText = src.searchMethodsText;
  if (src.robAssessments) out.robAssessments = src.robAssessments;
  // 101.md §1/§2/§27 — the evidence behind the search and risk-of-bias claims.
  // Only attached when actually present, matching the rule above: an absent
  // source must never change the legacy generation path, and must never be
  // silently substituted by a settings value.
  if (src.searchProvenance) out.searchProvenance = src.searchProvenance;
  if (src.robUsage) out.robUsage = src.robUsage;
  // 103.md §15 — one source of truth: the chart and the manuscript cannot disagree
  // because they read the same derivation.
  if (src.prismaFlow) out.flow = src.prismaFlow;
  // 104.md — derive the canonical Search Methodology ONCE per generation and pass
  // it down, so the Abstract, the Methods narration, the PRISMA-S strategy table
  // and every search fact token read the identical object. `otherMethods` comes
  // from the PRISMA flow's other-methods arm, because the evidence for citation or
  // hand searching lives in record origins, not in search runs.
  if (src.searchProvenance) {
    out.otherSearchMethods = otherMethodsFromFlow(src.prismaFlow);
    out.searchMethodology = deriveSearchMethodology(src.searchProvenance, {
      otherMethods: out.otherSearchMethods,
    });
  }
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
        out.robByInstrument = mapped.byInstrument;
      }
      // 101.md §27 — which instruments were ACTUALLY used, from the raw rows
      // (instrumentId + status + studyId). Derived here rather than from
      // project.robMethod so the Methods paragraph can never claim a tool that
      // was merely selected in a settings panel.
      out.robUsage = deriveRobUsage((d && d.assessments) || []);
      out.dataStatus.rob = 'ok';
    } catch (e) {
      out.dataStatus.rob = (e && e.status === 404) ? 'off' : 'error';
    }
  })());

  // 2c) 103.md §10 — the record-derived PRISMA flow from the linked screening
  //     project. Absent (no link, no records, feature off) leaves prismaFlow null
  //     and the legacy counter path runs, so nothing regresses.
  tasks.push((async () => {
    if (!screenProjectId) return;
    try {
      const d = await j(`/api/screening/projects/${enc(screenProjectId)}/prisma`);
      if (d && d.flow) out.prismaFlow = d.flow;
    } catch { /* the flow is evidence, not enrichment — absent means "unknown" */ }
  })());

  // 3b) 101.md §1/§2 — SEARCH EXECUTION PROVENANCE. The authoritative answer to
  //     "which databases were actually searched, and when was the last valid
  //     search". Deliberately separate from the methods-text fetch above: that
  //     one returns prose, this one returns the evidence. On any failure the
  //     provenance stays null and every search fact resolves MISSING — the
  //     manuscript says "not recorded" rather than falling back to the settings
  //     checkbox list (§17).
  tasks.push((async () => {
    if (flags.searchEngine !== true) return;
    try {
      // NOTE the mount point: routes/searchEngine.js is mounted at
      // /api/search-builder (server/index.js), which is also why the methods-text
      // fetch above uses that prefix. Same router, historical name.
      const d = await j(`/api/search-builder/${enc(projectId)}/provenance`);
      if (d && d.provenance) out.searchProvenance = d.provenance;
    } catch { /* provenance is evidence, not enrichment — absent means "unknown" */ }
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
