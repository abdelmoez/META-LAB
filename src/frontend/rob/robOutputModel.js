/**
 * robOutputModel.js — the PURE model behind RobSummaryOutputs (115.md decisions
 * 5, 7 and 11; dossier §§9, 22-24, 27).
 *
 * PURE: no React, no fetch, no DOM. It turns the project-assessment payload
 * (`GET /api/rob/projects/:id/assessments` → `{ assessments, groups }`) into the
 * per-instrument tables the summary renders.
 *
 * ── THE THREE RULES THIS FILE ENFORCES ──────────────────────────────────────
 *
 * 1. MIXED-TOOL PROJECTS GROUP, NEVER MERGE (decision 7). One section per
 *    instrument, each with its own columns; there is no cross-tool aggregate,
 *    no "average risk of bias", no shared row order.
 *
 * 2. TRAFFIC LIGHTS ONLY WHERE THE CATEGORIES MEAN LOW/CONCERNS/HIGH RISK
 *    (decision 11). This is deliberately NOT inferred from the level vocabulary
 *    alone, because the vocabularies collide on polarity:
 *
 *      AMSTAR 2 overall = High | Moderate | Low | Critically low, where HIGH is
 *      the BEST rating (high confidence in the review). Colouring "High" red —
 *      which a vocabulary-only rule would do, since 'high' is also RoB 2's worst
 *      level — would invert the meaning of every AMSTAR row in the review.
 *
 *    So eligibility is the INTERSECTION of an explicit instrument allowlist
 *    (exactly the tools decision 11 names) and a check that every level is in the
 *    risk vocabulary. An unknown instrument therefore renders as plain labelled
 *    text, which is safe, instead of a confidently wrong colour.
 *
 *    NOTE FOR MOUNTERS: the server sets `groups[].matrix` whenever the
 *    instrument has ANY domain-judgement vocabulary — including AMSTAR 2, whose
 *    vocabulary is the confidence scale. Feeding `group.matrix` straight into
 *    RobTrafficLight would reproduce exactly the inversion above. Route it
 *    through `supportsTrafficLight(group)` first.
 *
 * 3. A COUNT IS NOT A SCORE (decision 5). The JBI checklists, AMSTAR 2, QUADAS-2
 *    and QUIPS define no summed score. Item tallies are reported as COUNTS with
 *    their denominator and never as "8/10" styled like a rating, never as a
 *    percentage, and never ranked. Only the two Newcastle-Ottawa forms are
 *    star-scored (`scoringAllowed`), and they keep stars — never a traffic light.
 *
 * 4. THE REVIEWER BLIND REACHES THE OUTPUTS, NOT ONLY THE COMPARISON PANEL
 *    (r2 review finding 1). ReviewerComparisonPanel refuses to fetch the other
 *    reviewer's answers while a (study, instrument) pair is mid-blind — but the
 *    project-level summary tables, the distributions and the traffic-light plot
 *    were built straight from `GET /projects/:id/assessments`, which returns
 *    EVERY row regardless of status. So a reviewer with an unfinished assessment
 *    could read their colleague's in-progress domain judgements and overall two
 *    inches above the panel that says the comparison is hidden, which defeats the
 *    blind entirely.
 *
 *    `blindVisibility()` is the single pure rule, applied here and by the article
 *    list. It withholds rows the current reviewer did not author while their pair
 *    is blinded, and reports how many were withheld so the surface can say so out
 *    loud instead of silently under-reporting the project.
 */

import { reviewerBlindState, isConsensusRow } from './robConsensusModel.js';

/**
 * Decision 11's allowlist: the instruments whose domain categories genuinely map
 * onto low / some-concerns / high RISK OF BIAS semantics. QUADAS-2 and PROBAST
 * qualify on their risk-of-bias axis; their applicability axis is a separate
 * CONCERN scale, rendered in its own columns and never merged into the risk one.
 */
export const TRAFFIC_LIGHT_INSTRUMENT_IDS = Object.freeze([
  'RoB2', 'ROBINS-I', 'QUADAS-2', 'QUIPS', 'PROBAST',
]);

/** Every level value that carries risk-of-bias polarity (best → worst). */
export const RISK_SEMANTIC_LEVELS = Object.freeze([
  'low', 'some', 'moderate', 'unclear', 'ni', 'high', 'serious', 'critical',
]);

/** The AMSTAR 2 overall-confidence vocabulary (NOT a risk scale — see rule 2). */
export const CONFIDENCE_LEVELS = Object.freeze(['high', 'moderate', 'low', 'critically-low']);
/** The JBI overall appraisal decision (a reviewer decision, not a rating). */
export const DECISION_LEVELS = Object.freeze(['include', 'exclude', 'seek-further-info']);

const sameSet = (a, b) => {
  const x = new Set((a || []).filter(Boolean));
  const y = new Set((b || []).filter(Boolean));
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
};

/** True when a group's domain judgements may be drawn as a traffic light. */
export function supportsTrafficLight(group) {
  if (!group) return false;
  if (group.scoring === 'stars') return false;
  if (!TRAFFIC_LIGHT_INSTRUMENT_IDS.includes(group.instrumentId)) return false;
  const levels = group.domainJudgmentLevels || [];
  if (!levels.length) return false;
  return levels.every(l => RISK_SEMANTIC_LEVELS.includes(l));
}

/**
 * How one instrument group should be rendered:
 *   'stars'      — the Newcastle-Ottawa star profile (the only scored form)
 *   'checklist'  — JBI: item counts + the reviewer's appraisal decision
 *   'confidence' — AMSTAR 2: its four confidence levels, neutral styling
 *   'traffic'    — risk-of-bias judgements (decision 11 allowlist)
 *   'plain'      — anything else: labelled text, no colour semantics claimed
 */
export function groupRenderMode(group) {
  if (!group) return 'plain';
  if (group.scoring === 'stars') return 'stars';
  const overall = group.overallLevels || [];
  if (sameSet(overall, DECISION_LEVELS)) return 'checklist';
  if (sameSet(overall, CONFIDENCE_LEVELS)) return 'confidence';
  if (supportsTrafficLight(group)) return 'traffic';
  return 'plain';
}

/** A short label for a domain, preferring the definition's own shortLabel. */
function domainLabel(def, domainId) {
  if (!def) return domainId;
  return def.shortLabel || def.name || domainId;
}

/**
 * The DOMAIN columns of a group's table.
 * Prefers the instrument definition (real short labels), falls back to the
 * server's matrix domains, then to whatever the rows actually carry — so a group
 * whose instrument the client does not know still renders its data.
 */
export function domainColumns(group, instrument = null, rows = []) {
  if (instrument && Array.isArray(instrument.domains) && instrument.domains.length) {
    return instrument.domains.map(d => ({ id: d.id, label: domainLabel(d, d.id), name: d.name || d.id }));
  }
  const fromMatrix = (group && group.matrix && group.matrix.domains) || [];
  if (fromMatrix.length) return fromMatrix.map(d => ({ id: d.id, label: d.shortLabel || d.id, name: d.shortLabel || d.id }));
  const ids = [];
  for (const r of (rows || [])) {
    for (const k of Object.keys((r && r.domainJudgments) || {})) if (!ids.includes(k)) ids.push(k);
  }
  return ids.map(id => ({ id, label: id, name: id }));
}

/**
 * The APPLICABILITY columns (QUADAS-2 / PROBAST only). Empty for every other
 * tool, so their tables are unchanged. These are a SEPARATE axis: a domain can
 * be low risk of bias and high applicability concern at once, and the two are
 * never combined into one cell.
 */
export function applicabilityColumns(group, instrument = null) {
  const ids = (group && group.applicabilityDomainIds) || [];
  if (!ids.length) return [];
  const defs = (instrument && instrument.domains) || [];
  return ids.map((id) => {
    const def = defs.find(d => d.id === id);
    return { id, label: domainLabel(def, id), name: def ? (def.name || id) : id };
  });
}

/**
 * The OVERALL column descriptor, or null when the instrument PRESCRIBES NO
 * OVERALL JUDGEMENT. `overallLevels: null` from the server means exactly that
 * (QUADAS-2), and nothing downstream may invent one.
 *
 * `note` carries an instrument's own caveat when its definition declares one:
 * QUIPS marks its overall `official: false` because Hayden 2013 defines no
 * overall rule — any value there is the review team's own summary rule.
 */
export function overallColumn(group, instrument = null) {
  if (!group) return null;
  const levels = group.overallLevels;
  if (levels == null || !levels.length) return null;
  const ov = instrument && instrument.overall;
  const axis = (ov && ov.axis) || 'rob';
  const label = axis === 'confidence' ? 'Overall confidence'
    : axis === 'appraisal-decision' ? 'Appraisal decision'
      : 'Overall';
  const note = (ov && ov.official === false)
    ? 'This instrument defines no overall rule — any value here is the review team’s own pre-agreed summary, not a tool output.'
    : '';
  return { label, axis, levels, note };
}

/** Coerce a level list (strings or `{value}`) to a string[]. */
function levelValues(src) {
  if (!Array.isArray(src)) return [];
  const out = [];
  for (const l of src) {
    const v = (l && typeof l === 'object') ? l.value : l;
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The OVERALL APPLICABILITY column descriptor, or null when the instrument
 * defines no such axis (every tool here except PROBAST, whose Step 4 produces two
 * overall judgements per model evaluation).
 *
 * It is a SEPARATE axis from overall risk of bias and from the per-domain
 * applicability concerns, so it gets its own column and its own concern scale —
 * never merged into the risk cell. The value is read off `row.applicability.overall`,
 * which is what the server's `overall-APP` judgement row deserialises to.
 */
export function overallApplicabilityColumn(group, instrument = null) {
  const ap = instrument && instrument.overall && instrument.overall.applicability;
  if (!ap) return null;
  const levels = levelValues(ap.levels || ap.values || instrument.applicabilityLevels);
  if (!levels.length) return null;
  return { label: 'Overall applicability', axis: 'applicability', levels };
}

/**
 * The per-instrument note that keeps an absent column honest. Returned for the
 * two cases the 2026 tool set actually produces:
 *   · an instrument with no overall judgement at all (QUADAS-2);
 *   · PROBAST, whose SECOND overall judgement (concerns regarding applicability)
 *     is a different question from overall risk of bias and is reported in its
 *     own column rather than folded into one.
 */
export function groupNotes(group, instrument = null) {
  const notes = [];
  if (!group) return notes;
  if (group.overallLevels == null) {
    notes.push(`${group.instrumentLabel || group.instrumentId} defines no overall judgement — per-domain judgements are the complete result.`);
  }
  const ovApplic = instrument && instrument.overall && instrument.overall.applicability;
  if (ovApplic && (group.applicabilityDomainIds || []).length) {
    notes.push('This tool reports two overall judgements: overall risk of bias and overall concerns regarding applicability. Both are shown, in separate columns, alongside the per-domain applicability concerns — they answer different questions and are never combined.');
  }
  if (group.scoring === 'stars') {
    notes.push('The Newcastle–Ottawa Scale is a star profile, not a risk-of-bias traffic light, and defines no quality threshold of its own.');
  }
  if (groupRenderMode(group) === 'checklist') {
    notes.push('JBI defines no score and no cut-off: item counts below are progress counts, and the appraisal decision is the reviewer’s.');
  }
  if (groupRenderMode(group) === 'confidence') {
    notes.push('AMSTAR 2 yields an overall confidence rating in the review’s results — never a score. Higher confidence is better, which is the opposite polarity to a risk-of-bias scale, so it is shown on its own confidence scale and never as a risk traffic light.');
  }
  return notes;
}

/* ── the reviewer blind, applied to the OUTPUTS (rule 4) ────────────────────── */

/** The (study, instrument) key a blind is scoped to. */
const pairKey = (row) => `${row && row.studyId} ${(row && row.instrumentId) || 'RoB2'}`;

/**
 * Is this pair mid-blind — i.e. are two or more people assessing it independently
 * and at least one of them has not finished?
 *
 * Deliberately NARROWER than `!reviewerBlindState().unlocked`. A pair with a
 * SINGLE assessment is also "locked" (there is nothing to compare), but nothing
 * is being kept from anybody there, and masking it would blank the summary of
 * every ordinary single-reviewer project. Only `awaiting-completion` — ≥2
 * independent rows, not all complete — is a blind with something to protect.
 */
export function isBlindedPair(rows = []) {
  const state = reviewerBlindState(rows);
  return !state.unlocked && state.reason === 'awaiting-completion';
}

/**
 * Which of a project's assessment rows may THIS reviewer see?
 *
 * While a pair is blinded, a row is visible when it is
 *   · the reviewer's own work (`reviewerId === currentUserId`), or
 *   · the reconciled consensus record (which by definition postdates the blind).
 * Everything else in that pair is withheld until every independent assessment is
 * complete. Rows outside a blinded pair are never touched.
 *
 * FAIL-CLOSED on an unknown viewer: without a `currentUserId` we cannot tell
 * whose work a row is, so a blinded pair hides ALL of its independent rows rather
 * than guessing. That degrades to "N assessments hidden" for the reviewer's own
 * study — visibly wrong-looking but honest — instead of quietly leaking a
 * colleague's draft judgements to whoever the session belongs to.
 *
 * @param {Array} assessments the project-wide list
 * @param {{ currentUserId?: string|null, enforced?: boolean }} [opts]
 * @returns {{ visible: Array, hiddenIds: Set<string>, hiddenCount: number,
 *             blindedPairs: Array<{studyId, instrumentId, hidden, pending}> }}
 */
export function blindVisibility(assessments = [], { currentUserId = null, enforced = true } = {}) {
  const list = (Array.isArray(assessments) ? assessments : []).filter(Boolean);
  const hiddenIds = new Set();
  const blindedPairs = [];
  if (!enforced) return { visible: list, hiddenIds, hiddenCount: 0, blindedPairs };

  const pairs = new Map();
  for (const a of list) {
    const key = pairKey(a);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(a);
  }
  for (const rows of pairs.values()) {
    const state = reviewerBlindState(rows);
    if (state.unlocked || state.reason !== 'awaiting-completion') continue;
    let hidden = 0;
    for (const r of rows) {
      if (isConsensusRow(r)) continue;
      if (currentUserId && r.reviewerId && r.reviewerId === currentUserId) continue;
      hiddenIds.add(r.id);
      hidden += 1;
    }
    if (hidden) {
      blindedPairs.push({
        studyId: rows[0].studyId,
        instrumentId: rows[0].instrumentId || 'RoB2',
        hidden,
        pending: state.pending.length,
      });
    }
  }
  return {
    visible: list.filter(a => !hiddenIds.has(a.id)),
    hiddenIds,
    hiddenCount: hiddenIds.size,
    blindedPairs,
  };
}

/**
 * The one sentence a surface prints when the blind withheld rows. Never implies
 * the assessments do not exist — it says they are hidden, and why.
 */
export function blindNote(hiddenCount) {
  const n = Number(hiddenCount) || 0;
  if (n <= 0) return '';
  return `${n} assessment${n === 1 ? '' : 's'} hidden until both reviewers complete — independent review in progress.`;
}

/**
 * A traffic-light matrix with the withheld rows removed. The server builds
 * `groups[].matrix` from every row it holds, so plotting it unfiltered would draw
 * the blinded reviewer's judgements as coloured cells. Returns the SAME object
 * when nothing is hidden, so nothing re-renders needlessly.
 */
export function filterMatrixRows(matrix, hiddenIds) {
  if (!matrix || !hiddenIds || !hiddenIds.size) return matrix;
  const rows = (matrix.rows || []).filter(r => !hiddenIds.has(r && r.id));
  if (rows.length === (matrix.rows || []).length) return matrix;
  return { ...matrix, rows };
}

/**
 * The assessments belonging to one group, in a stable order.
 * `hiddenIds` (from `blindVisibility`) drops the rows the blind withholds, so a
 * caller that hands `groupRows` the raw project list still cannot render them.
 */
export function groupRows(group, assessments = [], { hiddenIds = null } = {}) {
  const list = (Array.isArray(assessments) ? assessments : []).filter(Boolean)
    .filter(a => !(hiddenIds && hiddenIds.has(a.id)));
  const ids = new Set((group && group.assessmentIds) || []);
  const rows = ids.size
    ? list.filter(a => ids.has(a.id))
    : list.filter(a => (a.instrumentId || 'RoB2') === (group && group.instrumentId));
  return rows.slice().sort((a, b) => {
    const s = String(a.studyId || '').localeCompare(String(b.studyId || ''));
    if (s !== 0) return s;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

/**
 * The DISTRIBUTION of a judgement column across the rows of a group (§24).
 * Returns one entry per level IN THE INSTRUMENT'S OWN ORDER plus the count of
 * rows with nothing recorded, so a mini-bar can never imply a study was judged
 * when it was not.
 */
export function distribution(rows = [], levels = [], read = () => '') {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const counts = {};
  let recorded = 0;
  for (const r of list) {
    const v = read(r) || '';
    if (!v) continue;
    recorded += 1;
    counts[v] = (counts[v] || 0) + 1;
  }
  const known = (levels || []).map(level => ({
    level,
    count: counts[level] || 0,
    pct: recorded ? (counts[level] || 0) / recorded : 0,
  }));
  // A stored value the definition no longer lists still shows up, rather than
  // vanishing from a plot that claims to summarise every assessment.
  for (const level of Object.keys(counts)) {
    if (!known.some(k => k.level === level)) {
      known.push({ level, count: counts[level], pct: recorded ? counts[level] / recorded : 0 });
    }
  }
  return { levels: known, recorded, missing: list.length - recorded, total: list.length };
}

/**
 * Tally one checklist domain's item responses from a full assessment view
 * (`GET /api/rob/assessments/:id` → `answersByDomain`).
 *
 * This is a PROGRESS COUNT (decision 5). It is returned as explicit per-response
 * counts plus a denominator — never as a ratio, a percentage or a score.
 */
export function checklistCounts(view, domainId, responses = ['Y', 'N', 'U', 'NA']) {
  const answers = (view && view.answersByDomain && view.answersByDomain[domainId]) || {};
  const byResponse = {};
  for (const code of responses) byResponse[code] = 0;
  let answered = 0;
  for (const qid of Object.keys(answers)) {
    const raw = answers[qid];
    const v = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw.response : raw;
    if (v == null || v === '') continue;
    answered += 1;
    byResponse[v] = (byResponse[v] || 0) + 1;
  }
  const total = totalItemsFor(view, domainId);
  return { byResponse, answered, total, hasDetail: true };
}

/** The number of items a domain declares, read from the view's completeness block. */
function totalItemsFor(view, domainId) {
  const per = view && view.completeness && view.completeness.perDomain;
  const d = per && per[domainId];
  if (d && Number.isFinite(Number(d.required))) return Number(d.required);
  const answers = (view && view.answersByDomain && view.answersByDomain[domainId]) || {};
  return Object.keys(answers).length;
}

/**
 * The whole summary model: one section per instrument, nothing merged across
 * tools. `detailsById` is optional — when a full assessment view is supplied for
 * a checklist row, its item counts are included; when it is absent the row still
 * renders its decision, with the counts marked as not loaded.
 */
export function buildSummaryModel({
  groups = [], assessments = [], instrumentFor = null, detailsById = null,
  // rule 4 — who is looking, and should the blind be applied at all? `enforceBlind`
  // exists for the tests and for surfaces that legitimately see everything (there
  // are none today); leaving it ON is the safe default.
  currentUserId = null, enforceBlind = true,
} = {}) {
  const blind = blindVisibility(assessments, { currentUserId, enforced: enforceBlind });
  const sections = (Array.isArray(groups) ? groups : []).filter(Boolean).map((group) => {
    const instrument = typeof instrumentFor === 'function' ? (instrumentFor(group.instrumentId) || null) : null;
    const rows = groupRows(group, assessments, { hiddenIds: blind.hiddenIds });
    // How many of THIS group's rows the blind withheld, so the note lands in the
    // section whose count it explains rather than floating above the whole page.
    const declared = (group.assessmentIds || []);
    const hiddenHere = declared.length
      ? declared.filter(id => blind.hiddenIds.has(id)).length
      : (assessments || []).filter(a => a && blind.hiddenIds.has(a.id)
        && (a.instrumentId || 'RoB2') === group.instrumentId).length;
    const domains = domainColumns(group, instrument, rows);
    const applicability = applicabilityColumns(group, instrument);
    const overall = overallColumn(group, instrument);
    const overallApplicability = overallApplicabilityColumn(group, instrument);
    const mode = groupRenderMode(group);
    const checklistDomainId = mode === 'checklist' ? (domains[0] && domains[0].id) : null;
    return {
      instrumentId: group.instrumentId,
      instrumentLabel: group.instrumentLabel || group.instrumentId,
      instrumentVersion: group.instrumentVersion || '',
      mode,
      trafficLight: supportsTrafficLight(group),
      domains,
      applicability,
      overall,
      overallApplicability,
      notes: groupNotes(group, instrument),
      count: rows.length,
      studyCount: new Set(rows.map(r => r.studyId)).size,
      // rule 4 — the withheld rows are COUNTED and NAMED, never silently dropped.
      hiddenByBlind: hiddenHere,
      blindNote: blindNote(hiddenHere),
      rows: rows.map((r) => {
        const view = detailsById ? detailsById[r.id] : null;
        return {
          id: r.id,
          studyId: r.studyId,
          label: r.label || r.studyId,
          reviewerName: r.reviewerName || '',
          status: r.status || 'draft',
          isConsensus: r.status === 'consensus' || r.isConsensus === true,
          domainJudgments: r.domainJudgments || {},
          applicability: r.applicability || {},
          overall: r.overall || '',
          stars: r.stars != null ? Number(r.stars) : null,
          maxStars: r.maxStars != null ? Number(r.maxStars) : null,
          starsByDomain: r.starsByDomain || null,
          maxStarsByDomain: r.maxStarsByDomain || null,
          profile: r.profile || '',
          counts: (mode === 'checklist' && view && checklistDomainId) ? checklistCounts(view, checklistDomainId) : null,
        };
      }),
      // §24 — per-DOMAIN distributions only where the instrument actually rates
      // its domains. A checklist (JBI) and a confidence rating (AMSTAR 2) record
      // nothing per domain, so a bar there would plot an empty column and imply
      // the tool judges something it does not.
      distributions: (mode === 'traffic' || mode === 'plain')
        ? domains.map(d => ({
          domainId: d.id,
          label: d.label,
          axis: 'rob',
          ...distribution(rows, group.domainJudgmentLevels || [], r => (r.domainJudgments || {})[d.id]),
        }))
        : [],
      // The OVERALL distribution is meaningful for every tool that HAS an overall
      // — including the ones with no per-domain rating (AMSTAR 2's confidence,
      // JBI's appraisal decision).
      overallDistribution: overall
        ? { label: overall.label, axis: overall.axis, ...distribution(rows, overall.levels || [], r => r.overall) }
        : null,
      // PROBAST's second overall axis gets its own distribution — plotted on the
      // CONCERN scale, never pooled with the risk-of-bias one above.
      overallApplicabilityDistribution: overallApplicability
        ? {
          label: overallApplicability.label,
          axis: overallApplicability.axis,
          ...distribution(rows, overallApplicability.levels || [], r => (r.applicability || {}).overall),
        }
        : null,
    };
  });
  return {
    sections,
    mixedTools: sections.length > 1,
    totalAssessments: sections.reduce((n, s) => n + s.count, 0),
    // rule 4 — the project-wide blind accounting, so the header can be honest
    // about a total that is smaller than the project really holds.
    hiddenByBlind: blind.hiddenCount,
    blindNote: blindNote(blind.hiddenCount),
    hiddenIds: blind.hiddenIds,
    blindedPairs: blind.blindedPairs,
  };
}

export default {
  TRAFFIC_LIGHT_INSTRUMENT_IDS,
  RISK_SEMANTIC_LEVELS,
  CONFIDENCE_LEVELS,
  DECISION_LEVELS,
  supportsTrafficLight,
  groupRenderMode,
  domainColumns,
  applicabilityColumns,
  overallColumn,
  overallApplicabilityColumn,
  groupNotes,
  groupRows,
  isBlindedPair,
  blindVisibility,
  blindNote,
  filterMatrixRows,
  distribution,
  checklistCounts,
  buildSummaryModel,
};
