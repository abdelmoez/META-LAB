/**
 * robProgress.js — 115.md build item 3 (§21): HONEST per-assessment progress.
 *
 * PURE. No React, no network, no Date.now(). Imported by the workspace, the
 * definition-driven renderer and the unit tests.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The workspace used to answer "is this assessment complete?" with the engine's
 * `completeness()`, which counts ANSWERED ITEMS and nothing else. That was true
 * of RoB 2 and ROBINS-I, whose domain and overall judgements are computed from
 * the answers: once every reachable signalling question is answered, every
 * judgement exists. It is NOT true of the 2026 tool set:
 *
 *   · QUADAS-2 / PROBAST additionally require a per-domain APPLICABILITY concern,
 *     which no algorithm proposes — it is the reviewer's, recorded separately.
 *   · QUADAS-2 refuses to propose a domain judgement once a signalling question is
 *     answered "No"; the reviewer must record one.
 *   · QUIPS rates each of its six domains High/Moderate/Low by hand.
 *   · A JBI checklist ends in the reviewer's overall appraisal DECISION.
 *
 * Counting only the item answers would let all four be marked complete with their
 * defining judgements missing. So completion is the DEFINITION's predicate:
 * every answerable item answered, AND every judgement the definition declares
 * recorded. §21's other half — "do not mark an assessment complete merely because
 * it has been opened" — holds by construction: nothing here returns true for an
 * empty assessment.
 *
 * ── PROGRESS COUNTS ARE NOT SCORES (115.md decision 5) ──────────────────────
 * `answered / required` is a measure of how much of the FORM is filled in. It is
 * never a rating, and no consumer may present it as one.
 */

import { completeness as engineCompleteness } from '../../research-engine/rob/index.js';

/** A domain's items. Definitions name the list `questions`; 115's shape allows `items`. */
export function questionsOf(domain) {
  return (domain && (domain.questions || domain.items)) || [];
}

/** The items of a domain a reviewer is actually asked to ANSWER. */
export function answerableQuestionsOf(domain) {
  return questionsOf(domain).filter(q => q && q.answerable !== false);
}

/** Coerce a level list (strings or `{value}`) to a string[]. */
export function levelValues(src) {
  if (!Array.isArray(src)) return [];
  const out = [];
  for (const l of src) {
    const v = (l && typeof l === 'object') ? l.value : l;
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The RISK-OF-BIAS judgement levels a domain accepts ([] when it makes none).
 *
 * The instrument-level fallback is deliberately restricted to PRE-115 definitions
 * (those with no `overall` contract: RoB 2, ROBINS-I), where `judgmentLevels` IS
 * the per-domain vocabulary. On a 115-shape definition the domain axis is declared
 * explicitly as `domain.judgment`, and `instrument.judgmentLevels` means something
 * else entirely — on AMSTAR 2 it is the OVERALL confidence scale, so inheriting it
 * would invent a per-domain judgement the tool does not make (and then refuse to
 * let the reviewer finalise until they recorded it).
 */
export function domainJudgmentLevels(instrument, domain) {
  const d = levelValues(domain && (domain.judgmentLevels || (domain.judgment && domain.judgment.levels)));
  if (d.length) return d;
  if (instrument && 'overall' in instrument) return [];
  return levelValues(instrument && instrument.judgmentLevels);
}

/** True when this domain's judgement is proposed by an algorithm. */
export function domainJudgmentIsComputed(instrument, domain) {
  if (domain && domain.judgment) return domain.judgment.computed !== false;
  // Pre-115 definitions (RoB 2, ROBINS-I) carry no axis object; their domain
  // judgements have always been algorithm-proposed.
  return !(domain && domain.judgment === null);
}

/** The APPLICABILITY-concern levels a domain accepts, or [] when it has no axis. */
export function applicabilityLevels(instrument, domain) {
  if (!domain || !domain.applicability) return [];
  const own = levelValues(domain.applicability.levels || domain.applicabilityLevels);
  if (own.length) return own;
  return levelValues(instrument && instrument.applicabilityLevels);
}

/** The domains of an instrument that carry an applicability axis, in order. */
export function applicabilityDomainsOf(instrument) {
  return ((instrument && instrument.domains) || []).filter(d => applicabilityLevels(instrument, d).length > 0);
}

/**
 * The instrument's OVERALL contract:
 *   { defined, computed, required, levels, scale, official, guidance }
 *
 * `defined:false` means the instrument PRESCRIBES NO OVERALL (QUADAS-2's
 * `overall: null`) — never a gap to fill in.
 * `required:false` with `defined:true` means the value is legitimate but optional
 * because it is not the instrument's own output (QUIPS marks its summary rating
 * `official: false`: the review team's pre-agreed rule, not a QUIPS judgement).
 */
export function overallContract(instrument) {
  if (!instrument) return { defined: false, computed: false, required: false, levels: [], scale: null, official: true, guidance: '' };
  if ('overall' in instrument && instrument.overall == null) {
    return { defined: false, computed: false, required: false, levels: [], scale: null, official: true, guidance: instrument.overallGuidance || '' };
  }
  const o = instrument.overall;
  if (!o) {
    // Pre-115 definitions (RoB 2, ROBINS-I, NOS) declare no `overall` block; their
    // overall has always been computed from the domains.
    return {
      defined: true, computed: true, required: true, official: true,
      levels: levelValues(instrument.judgmentLevels), scale: 'rob',
      guidance: instrument.overallGuidance || '',
    };
  }
  const official = o.official !== false;
  const computed = o.computed === true;
  const scale = o.axis === 'confidence' ? 'confidence' : o.axis === 'appraisal-decision' ? 'decision' : 'rob';
  return {
    defined: true,
    computed,
    // An unofficial overall (QUIPS) is the review team's own summary rule, so the
    // assessment is complete without it.
    required: official,
    official,
    levels: levelValues(o.levels || instrument.judgmentLevels),
    scale,
    guidance: o.guidance || instrument.overallGuidance || '',
  };
}

/**
 * Resolve one domain's recorded RISK-OF-BIAS judgement from the server view:
 * a reviewer's final wins over the algorithm's proposal (which is '' whenever the
 * instrument refused to propose one).
 */
function resolvedDomainJudgment(view, domainId) {
  const row = ((view && view.domains) || []).find(d => d.domainId === domainId);
  if (!row) return '';
  if (row.overridden && row.finalJudgment) return row.finalJudgment;
  return row.resolvedJudgment || row.proposedJudgment || '';
}

/** Resolve one domain's recorded APPLICABILITY concern from the server view. */
function resolvedApplicability(view, domainId) {
  const row = ((view && view.applicability) || []).find(a => a.domainId === domainId);
  return (row && row.judgment) || '';
}

/** Resolve the recorded OVERALL judgement from the server view. */
function resolvedOverall(view) {
  const ov = (view && view.overall) || {};
  if (ov.overridden && ov.finalOverall) return ov.finalOverall;
  return ov.resolvedOverall || ov.proposedOverall || '';
}

/**
 * The full progress picture for ONE assessment.
 *
 * @param {object} instrument the definition (the single source of truth)
 * @param {object} opts
 * @param {object} opts.answers   { domainId: { questionId: response } } — the live
 *                                (optimistic) client answers, so progress moves
 *                                the instant a reviewer answers, not on save.
 * @param {object} opts.view      the server assessment view (judgements live here)
 * @param {object} [opts.liveProposals] per-domain proposals from the pure engine,
 *                                so a computed judgement counts the moment the last
 *                                item of its domain is answered.
 * @returns {{
 *   perDomain: Record<string, object>, items: {answered:number,required:number},
 *   judgments: {recorded:number,required:number},
 *   applicability: {recorded:number,required:number},
 *   overall: {defined:boolean,required:boolean,recorded:boolean,value:string},
 *   complete: boolean, answeredAll: boolean, label: string,
 * }}
 * Pure.
 */
export function assessmentProgress(instrument, { answers = {}, view = null, liveProposals = null, liveOverall = null } = {}) {
  const domains = (instrument && instrument.domains) || [];
  const comp = engineCompleteness(instrument, { answersByDomain: answers });
  const overall = overallContract(instrument);

  const perDomain = {};
  let judgmentsRequired = 0;
  let judgmentsRecorded = 0;
  let applicabilityRequired = 0;
  let applicabilityRecorded = 0;

  for (const d of domains) {
    const c = comp.perDomain[d.id] || { answered: 0, required: 0, missing: [] };
    const jLevels = domainJudgmentLevels(instrument, d);
    const aLevels = applicabilityLevels(instrument, d);
    const computed = domainJudgmentIsComputed(instrument, d);

    // A live proposal counts as "recorded" only for a COMPUTED axis: an instrument
    // that refuses to propose (QUADAS-2 with a "No", QUIPS always) returns '' here,
    // which is exactly the point — the reviewer still has to decide.
    const live = liveProposals && liveProposals[d.id] ? (liveProposals[d.id].judgment || '') : '';
    const stored = resolvedDomainJudgment(view, d.id);
    const judgment = stored || (computed ? live : '');
    const applicability = resolvedApplicability(view, d.id);

    if (jLevels.length) { judgmentsRequired += 1; if (judgment) judgmentsRecorded += 1; }
    if (aLevels.length) { applicabilityRequired += 1; if (applicability) applicabilityRecorded += 1; }

    perDomain[d.id] = {
      domainId: d.id,
      answered: c.answered,
      required: c.required,
      missing: c.missing || [],
      itemsComplete: (c.missing || []).length === 0,
      judgmentLevels: jLevels,
      judgmentComputed: computed,
      judgment,
      judgmentRecorded: !jLevels.length || !!judgment,
      applicabilityLevels: aLevels,
      applicability,
      applicabilityRecorded: !aLevels.length || !!applicability,
      // "D2 · 3/6 answered" — the sticky progress line (§30).
      label: `${d.shortLabel || d.name || d.id} · ${c.answered}/${c.required} answered`,
    };
    perDomain[d.id].complete = perDomain[d.id].itemsComplete
      && perDomain[d.id].judgmentRecorded
      && perDomain[d.id].applicabilityRecorded;
  }

  const answeredAll = comp.overall.complete;
  const judgmentsDone = judgmentsRecorded === judgmentsRequired;

  const overallValue = overall.defined
    ? (resolvedOverall(view) || (overall.computed && liveOverall ? (liveOverall.judgment || '') : ''))
    : '';
  // A COMPUTED overall (RoB 2's Table 1 roll-up, AMSTAR 2's confidence rule,
  // PROBAST's Step 4) exists by construction once its inputs do — so it counts as
  // recorded when every item is answered and every domain judgement is in, even
  // before the server view has caught up. A REVIEWER-judged overall (a JBI
  // appraisal decision) is recorded only when the reviewer has actually recorded it.
  const overallRecorded = !overall.defined
    ? false
    : overall.computed
      ? !!(overallValue || (answeredAll && judgmentsDone))
      : !!overallValue;

  const complete = answeredAll
    && judgmentsRecorded === judgmentsRequired
    && applicabilityRecorded === applicabilityRequired
    && (!overall.required || overallRecorded);

  return {
    perDomain,
    items: { answered: comp.overall.answered, required: comp.overall.required },
    judgments: { recorded: judgmentsRecorded, required: judgmentsRequired },
    applicability: { recorded: applicabilityRecorded, required: applicabilityRequired },
    overall: { ...overall, recorded: overallRecorded, value: overallValue },
    answeredAll,
    complete,
    label: `${comp.overall.answered}/${comp.overall.required} answered`,
  };
}

/**
 * The single sentence that explains what is still missing, for the Finalise
 * button's title and the summary hint. '' once the assessment is complete.
 * Pure.
 */
export function incompleteReason(progress) {
  if (!progress || progress.complete) return '';
  const bits = [];
  if (!progress.answeredAll) {
    bits.push(`answer all items (${progress.items.answered}/${progress.items.required})`);
  }
  if (progress.judgments.recorded < progress.judgments.required) {
    const n = progress.judgments.required - progress.judgments.recorded;
    bits.push(`record ${n} domain judgement${n === 1 ? '' : 's'}`);
  }
  if (progress.applicability.recorded < progress.applicability.required) {
    const n = progress.applicability.required - progress.applicability.recorded;
    bits.push(`record ${n} applicability concern${n === 1 ? '' : 's'}`);
  }
  if (progress.overall.required && !progress.overall.recorded) {
    bits.push(progress.overall.scale === 'decision' ? 'record the overall appraisal decision' : 'record the overall judgement');
  }
  return bits.length ? `Still to do: ${bits.join('; ')}.` : '';
}

/**
 * Which renderer an instrument needs, derived from the DEFINITION rather than
 * from a list of instrument ids (115.md decision 3/4 — "the renderer consumes
 * ONLY the definition"):
 *
 *   'stars'       an additive star scale (the two Newcastle-Ottawa forms) →
 *                 NosAssessmentPanel, unchanged since 101.md.
 *   'definition'  the definition declares a JUDGEMENT AXIS of its own — a
 *                 per-domain `judgment` / `applicability` block, an explicit
 *                 `overall` contract, or an empty domain vocabulary (a flat
 *                 checklist). These need the axis-aware renderer.
 *   'domain-walk' everything else: a branching signalling-question instrument
 *                 whose domain judgements are algorithm-proposed and whose
 *                 overall rolls up from them (RoB 2, ROBINS-I). Byte-identical
 *                 behaviour to before 115.
 * Pure.
 */
export function robRenderMode(instrument) {
  if (!instrument) return 'domain-walk';
  if (instrument.scoring === 'stars') return 'stars';
  const domains = instrument.domains || [];
  if (domains.some(d => d && (d.judgment || d.applicability))) return 'definition';
  if ('overall' in instrument) return 'definition';
  if (!levelValues(instrument.judgmentLevels).length) return 'definition';
  return 'domain-walk';
}

export default {
  assessmentProgress,
  incompleteReason,
  robRenderMode,
  overallContract,
  domainJudgmentLevels,
  domainJudgmentIsComputed,
  applicabilityLevels,
  applicabilityDomainsOf,
  answerableQuestionsOf,
  questionsOf,
  levelValues,
};
