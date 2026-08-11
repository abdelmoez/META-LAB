/**
 * tools.js — the catalogue of critical-appraisal instruments a project can
 * choose. Pure data + helpers; no UI, no engine logic, and deliberately NO
 * import of the instrument definitions themselves (this file is pulled into the
 * main workspace bundle by `normalizeRobTool`; the ~4 000 lines of instrument
 * data must not ride along with it).
 *
 * The catalogue is the METADATA view of the registry in
 * `instruments/registry.js`. The two are kept in lockstep by
 * tests/unit/robInstrumentRegistry.test.js, which imports both and fails on any
 * divergence in id set, version, designs, citation, guidance URL, licence or
 * scoring stance. Duplication with a pinned invariant, rather than a fat import.
 *
 * ── STATUS IS NOT A FEATURE FLAG ────────────────────────────────────────────
 * 115.md decision 3: instrument availability is REGISTRY-driven. `status:
 * 'active'` means "implemented and selectable"; it is not gated on
 * `guidedRobAppraisal` or on any other flag. `normalizeRobTool` still collapses
 * an unknown or not-yet-implemented id to the default so a stored value can
 * never select something that does not exist.
 *
 * ── SCORING ─────────────────────────────────────────────────────────────────
 * `scoringAllowed` is true for exactly the two Newcastle-Ottawa forms, which are
 * additive star scales. Every other instrument in the set explicitly defines no
 * summed score: AMSTAR 2 says so in print, the JBI checklists are deliberately
 * non-prescriptive, QUADAS-2 and QUIPS report per domain, and RoB 2 / ROBINS-I /
 * PROBAST are judgement tools. Counting answered items is PROGRESS, not a score
 * (115.md decision 5).
 */

/* ════════════ the design vocabulary ════════════ */

/**
 * The canonical study-design vocabulary the catalogue routes over. Free-text
 * designs arrive from extraction fields and the legacy project blob, so
 * `toolsForStudyDesign` matches loosely; `toolsForDesignId` is the exact lookup
 * over this list. Every design here maps to at least one active tool — pinned by
 * the registry-integrity test, so adding a design without a tool fails the build.
 */
export const ROB_DESIGNS = Object.freeze([
  { id: 'randomised-trial', label: 'Randomised trial' },
  { id: 'non-randomised-intervention', label: 'Non-randomised study of an intervention' },
  { id: 'cohort', label: 'Cohort study' },
  { id: 'case-control', label: 'Case-control study' },
  { id: 'cross-sectional', label: 'Analytical cross-sectional study' },
  { id: 'prevalence', label: 'Prevalence / cumulative incidence study' },
  { id: 'case-series', label: 'Case series' },
  { id: 'case-report', label: 'Case report' },
  { id: 'qualitative', label: 'Qualitative study' },
  { id: 'diagnostic-accuracy', label: 'Diagnostic test accuracy study' },
  { id: 'prognostic', label: 'Prognostic factor study' },
  { id: 'prediction-model', label: 'Prediction model study' },
  { id: 'systematic-review', label: 'Systematic review (umbrella review)' },
]);

export const ROB_DESIGN_IDS = Object.freeze(ROB_DESIGNS.map(d => d.id));

/** The label for a design id, or '' when it is not in the vocabulary. */
export function robDesignLabel(id) {
  const d = ROB_DESIGNS.find(x => x.id === id);
  return d ? d.label : '';
}

/* ════════════ the catalogue ════════════ */

export const ROB_TOOLS = Object.freeze([
  {
    id: 'RoB2',
    label: 'RoB 2',
    abbreviation: 'RoB 2',
    sublabel: 'Randomised trials',
    status: 'active',
    designs: ['randomised-trial'],
    version: '2019-08-22',
    organization: 'Cochrane / RoB 2 development group',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Cochrane Risk of Bias 2 — effect of assignment (ITT). Five domains, signalling questions, algorithm-proposed judgements.',
    citation: 'Sterne JAC, Savović J, Page MJ, et al. RoB 2: a revised tool for assessing risk of bias in randomised trials. BMJ 2019;366:l4898.',
    guidanceUrl: 'https://www.riskofbias.info/welcome/rob-2-0-tool',
    license: 'CC BY-NC-ND 4.0 (riskofbias.info). Attribution required; no derivatives; non-commercial. Item text may not be modified.',
    note: 'Individually randomised, parallel-group trials. The official cluster-randomised and crossover variants are out of scope for this release.',
  },
  {
    id: 'ROBINS-I',
    label: 'ROBINS-I',
    abbreviation: 'ROBINS-I',
    sublabel: 'Non-randomised studies of interventions',
    status: 'active',
    designs: ['non-randomised-intervention'],
    version: '2016',
    organization: 'Cochrane Bias Methods Group / ROBINS-I development group',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Risk Of Bias In Non-randomised Studies of Interventions (Sterne 2016). Seven domains, signalling questions, algorithm-proposed five-level judgements (Low / Moderate / Serious / Critical / No information).',
    citation: 'Sterne JAC, Hernán MA, Reeves BC, et al. ROBINS-I: a tool for assessing risk of bias in non-randomised studies of interventions. BMJ 2016;355:i4919.',
    guidanceUrl: 'https://www.riskofbias.info/welcome/home',
    license: 'CC BY-NC-ND 4.0 (riskofbias.info). Attribution required; no derivatives; non-commercial. Item text may not be modified.',
    note: 'ROBINS-I V2 (first released Nov 2024, revised Nov 2025) is still labelled draft on riskofbias.info and is tracked, not shipped.',
  },
  // 101.md §18–§22 — the two OFFICIAL Newcastle–Ottawa forms are separate
  // instruments, because their domains genuinely differ (Outcome vs Exposure) and
  // §19/§20 require the workflow to be designed per study type. `scoring: 'stars'`
  // tells the UI to render a star profile rather than a traffic light (§26).
  {
    id: 'NOS',
    label: 'Newcastle–Ottawa (cohort)',
    abbreviation: 'NOS (cohort)',
    sublabel: 'Observational cohort studies',
    status: 'active',
    scoring: 'stars',
    design: 'cohort',
    designs: ['cohort'],
    version: 'ohri-nosgen',
    organization: 'Ottawa Hospital Research Institute (Wells et al.)',
    scoringAllowed: true,
    consensusSupported: true,
    description: 'Newcastle–Ottawa Scale, official OHRI cohort form. Selection (4) + Comparability (2) + Outcome (3) = 9 stars. The scale defines no quality threshold; any cut-off is a project decision.',
    citation: 'Wells GA, Shea B, O\'Connell D, et al. The Newcastle-Ottawa Scale (NOS) for assessing the quality of nonrandomised studies in meta-analyses. Ottawa Hospital Research Institute.',
    guidanceUrl: 'https://www.ohri.ca/en/who-we-are/core-facilities-and-platforms/ottawa-methods-centre/newcastle-ottawa-scale',
    license: 'No licence text is published on the OHRI documents or page; the scale is free to download and citation of Wells et al. is expected. Terms beyond free download are not stated.',
  },
  {
    id: 'NOS-CC',
    label: 'Newcastle–Ottawa (case-control)',
    abbreviation: 'NOS (case-control)',
    sublabel: 'Observational case-control studies',
    status: 'active',
    scoring: 'stars',
    design: 'case-control',
    designs: ['case-control'],
    version: 'ohri-nosgen',
    organization: 'Ottawa Hospital Research Institute (Wells et al.)',
    scoringAllowed: true,
    consensusSupported: true,
    description: 'Newcastle–Ottawa Scale, official OHRI case-control form. Selection (4) + Comparability (2) + Exposure (3) = 9 stars. The scale defines no quality threshold; any cut-off is a project decision.',
    citation: 'Wells GA, Shea B, O\'Connell D, et al. The Newcastle-Ottawa Scale (NOS) for assessing the quality of nonrandomised studies in meta-analyses. Ottawa Hospital Research Institute.',
    guidanceUrl: 'https://www.ohri.ca/en/who-we-are/core-facilities-and-platforms/ottawa-methods-centre/newcastle-ottawa-scale',
    license: 'No licence text is published on the OHRI documents or page; the scale is free to download and citation of Wells et al. is expected. Terms beyond free download are not stated.',
  },
  {
    id: 'QUADAS-2',
    label: 'QUADAS-2',
    abbreviation: 'QUADAS-2',
    sublabel: 'Diagnostic accuracy studies',
    status: 'active',
    designs: ['diagnostic-accuracy'],
    version: '2011',
    organization: 'University of Bristol (QUADAS group)',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Quality Assessment of Diagnostic Accuracy Studies, v2. Four domains, eleven signalling questions; risk of bias in all four domains and a separate applicability concern in the first three. No overall judgement and no score.',
    citation: 'Whiting PF, Rutjes AWS, Westwood ME, et al. QUADAS-2: a revised tool for the quality assessment of diagnostic accuracy studies. Ann Intern Med 2011;155(8):529-536.',
    guidanceUrl: 'https://www.bristol.ac.uk/population-health-sciences/projects/quadas/',
    license: 'Free to use with citation; the developers explicitly encourage review-specific tailoring. No formal licence text is published on the Bristol site, so this is a free-with-citation posture rather than a named licence.',
    note: 'QUADAS-C (2021) is an extension for comparative accuracy studies used alongside QUADAS-2. QUADAS-3 (Feb 2026) is the developers\' revision and is tracked, not shipped.',
  },
  {
    id: 'AMSTAR-2',
    label: 'AMSTAR 2',
    abbreviation: 'AMSTAR 2',
    sublabel: 'Systematic reviews (umbrella reviews)',
    status: 'active',
    designs: ['systematic-review'],
    version: '2017',
    organization: 'AMSTAR (Shea, Reeves, Wells et al.); amstar.ca',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Sixteen items, seven of them critical domains, producing an overall CONFIDENCE rating in the review\'s results (High / Moderate / Low / Critically low). The tool is explicit that no overall score may be derived.',
    citation: 'Shea BJ, Reeves BC, Wells G, et al. AMSTAR 2: a critical appraisal tool for systematic reviews that include randomised or non-randomised studies of healthcare interventions, or both. BMJ 2017;358:j4008.',
    guidanceUrl: 'https://amstar.ca/Amstar-2.php',
    license: 'Free to use from amstar.ca; the defining BMJ paper is open access under a Creative Commons attribution licence, which is the basis for reproducing item text with citation. Commercial embedding terms are not separately stated by amstar.ca.',
  },
  {
    id: 'JBI-CaseSeries',
    label: 'JBI Case Series',
    abbreviation: 'JBI Case Series',
    sublabel: 'Case series',
    status: 'active',
    designs: ['case-series'],
    version: '2020',
    organization: 'JBI (Joanna Briggs Institute), University of Adelaide',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Ten-item JBI checklist for case series. Yes / No / Unclear / Not applicable per item, then the reviewer\'s overall appraisal decision. No score.',
    citation: 'Munn Z, Barker TH, Moola S, et al. Methodological quality of case series studies: an introduction to the JBI critical appraisal tool. JBI Evid Synth 2020;18(10):2127-2133.',
    guidanceUrl: 'https://jbi.global/critical-appraisal-tools',
    license: 'Free to download and use from jbi.global with citation of the checklist and its companion paper. No formal licence text is published; terms for embedding item text in commercial software should be confirmed with JBI. Reproduced here with citation, unmodified.',
  },
  {
    id: 'JBI-CaseReport',
    label: 'JBI Case Report',
    abbreviation: 'JBI Case Report',
    sublabel: 'Case reports',
    status: 'active',
    designs: ['case-report'],
    version: '2020',
    organization: 'JBI (Joanna Briggs Institute), University of Adelaide',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Eight-item JBI checklist for case reports. Yes / No / Unclear / Not applicable per item, then the reviewer\'s overall appraisal decision. No score.',
    citation: 'Moola S, Munn Z, Tufanaru C, et al. Chapter 7: Systematic reviews of etiology and risk. In: Aromataris E, Munn Z (eds). JBI Manual for Evidence Synthesis. JBI, 2020.',
    guidanceUrl: 'https://jbi.global/critical-appraisal-tools',
    license: 'Free to download and use from jbi.global with citation of the checklist and its companion paper. No formal licence text is published; terms for embedding item text in commercial software should be confirmed with JBI. Reproduced here with citation, unmodified.',
  },
  {
    id: 'JBI-Prevalence',
    label: 'JBI Prevalence',
    abbreviation: 'JBI Prevalence',
    sublabel: 'Prevalence and proportion studies',
    status: 'active',
    designs: ['prevalence'],
    version: '2020',
    organization: 'JBI (Joanna Briggs Institute), University of Adelaide',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Nine-item JBI checklist for studies reporting prevalence data. Yes / No / Unclear / Not applicable per item, then the reviewer\'s overall appraisal decision. No score.',
    citation: 'Munn Z, Moola S, Lisy K, Riitano D, Tufanaru C. Methodological guidance for systematic reviews of observational epidemiological studies reporting prevalence and cumulative incidence data. Int J Evid Based Healthc 2015;13(3):147-153.',
    guidanceUrl: 'https://jbi.global/critical-appraisal-tools',
    license: 'Free to download and use from jbi.global with citation of the checklist and its companion paper. No formal licence text is published; terms for embedding item text in commercial software should be confirmed with JBI. Reproduced here with citation, unmodified.',
  },
  {
    id: 'JBI-CrossSectional',
    label: 'JBI Analytical Cross-Sectional',
    abbreviation: 'JBI Analytical Cross-Sectional',
    sublabel: 'Analytical cross-sectional studies',
    status: 'active',
    designs: ['cross-sectional'],
    version: '2020',
    organization: 'JBI (Joanna Briggs Institute), University of Adelaide',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Eight-item JBI checklist for analytical cross-sectional studies. Yes / No / Unclear / Not applicable per item, then the reviewer\'s overall appraisal decision. No score.',
    citation: 'Moola S, Munn Z, Tufanaru C, et al. Chapter 7: Systematic reviews of etiology and risk. In: Aromataris E, Munn Z (eds). JBI Manual for Evidence Synthesis. JBI, 2020.',
    guidanceUrl: 'https://jbi.global/critical-appraisal-tools',
    license: 'Free to download and use from jbi.global with citation of the checklist and its companion paper. No formal licence text is published; terms for embedding item text in commercial software should be confirmed with JBI. Reproduced here with citation, unmodified.',
  },
  {
    id: 'JBI-Qualitative',
    label: 'JBI Qualitative',
    abbreviation: 'JBI Qualitative',
    sublabel: 'Qualitative research',
    status: 'active',
    designs: ['qualitative'],
    version: '2020',
    organization: 'JBI (Joanna Briggs Institute), University of Adelaide',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Ten-item JBI checklist for qualitative research. Yes / No / Unclear / Not applicable per item, then the reviewer\'s overall appraisal decision. No score. Preferred over CASP, whose CC BY-NC-SA licence blocks commercial embedding.',
    citation: 'Lockwood C, Munn Z, Porritt K. Qualitative research synthesis: methodological guidance for systematic reviewers utilizing meta-aggregation. Int J Evid Based Healthc 2015;13(3):179-187.',
    guidanceUrl: 'https://jbi.global/critical-appraisal-tools',
    license: 'Free to download and use from jbi.global with citation of the checklist and its companion paper. No formal licence text is published; terms for embedding item text in commercial software should be confirmed with JBI. Reproduced here with citation, unmodified.',
  },
  {
    id: 'QUIPS',
    label: 'QUIPS',
    abbreviation: 'QUIPS',
    sublabel: 'Prognostic factor studies',
    status: 'active',
    designs: ['prognostic'],
    version: '2013',
    organization: 'Hayden et al.; hosted by the Cochrane Prognosis Methods Group',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Quality In Prognosis Studies. Six domains of prompting items rated for adequacy of reporting, then a per-domain risk-of-bias rating (High / Moderate / Low). No overall algorithm and no score.',
    citation: 'Hayden JA, van der Windt DA, Cartwright JL, Côté P, Bombardier C. Assessing bias in studies of prognostic factors. Ann Intern Med 2013;158(4):280-286.',
    guidanceUrl: 'https://methods.cochrane.org/prognosis/tools',
    license: 'Published in Annals of Internal Medicine (copyrighted); the full tool is distributed by the Cochrane Prognosis Methods Group. No standalone licence for the tool text is published, so terms for embedding item text in commercial software should be confirmed with the developers.',
  },
  {
    id: 'PROBAST',
    label: 'PROBAST',
    abbreviation: 'PROBAST',
    sublabel: 'Prediction model studies',
    status: 'active',
    designs: ['prediction-model'],
    version: '2019-05-15',
    organization: 'PROBAST group (Wolff, Moons, Riley et al.); probast.org',
    scoringAllowed: false,
    consensusSupported: true,
    description: 'Prediction model Risk Of Bias ASsessment Tool. Four domains, twenty signalling questions; risk of bias in all four domains and a separate applicability concern in the first three, each with official overall rules. No score.',
    citation: 'Wolff RF, Moons KGM, Riley RD, et al. PROBAST: a tool to assess the risk of bias and applicability of prediction model studies. Ann Intern Med 2019;170(1):51-58. Explanation and elaboration: Moons KGM, Wolff RF, Riley RD, et al. Ann Intern Med 2019;170(1):W1-W33.',
    guidanceUrl: 'https://www.probast.org/',
    license: 'Tool downloads are free from probast.org; the defining papers are copyrighted by Annals of Internal Medicine. No explicit software-embedding licence is published, so this is a free-with-citation posture rather than a named licence.',
    note: 'PROBAST+AI (BMJ 2025;388:e082505) extends the tool to AI/ML prediction models and is the developers\' recommendation for those reviews; tracked, not shipped.',
  },
  {
    id: 'custom',
    label: 'Custom template',
    sublabel: 'Define your own domains',
    status: 'coming-soon',
    designs: [],
    description: 'Build a bespoke risk-of-bias instrument. The definition contract in src/research-engine/rob/instruments/shared.js already supports it; the authoring UI is not built.',
  },
]);

export const DEFAULT_ROB_TOOL = 'RoB2';

/** The set of tool ids that are actually implemented/selectable right now. */
export const ACTIVE_ROB_TOOLS = Object.freeze(
  ROB_TOOLS.filter(t => t.status === 'active').map(t => t.id),
);

/** Look up a tool descriptor by id (or undefined). */
export function getRobTool(id) {
  return ROB_TOOLS.find(t => t.id === id);
}

/** True only for an implemented/selectable tool. */
export function isRobToolActive(id) {
  return ACTIVE_ROB_TOOLS.includes(id);
}

/**
 * Coerce any stored/selected value to a SAFE, selectable tool id. Unknown, empty,
 * or coming-soon tools collapse to the default so an unsupported instrument can
 * never be used by accident.
 * @param {string} id
 * @returns {string}
 */
export function normalizeRobTool(id) {
  return isRobToolActive(id) ? id : DEFAULT_ROB_TOOL;
}

/** True when the tool is star-scored (NOS) rather than judgement-based. */
export function isStarScoredTool(id) {
  const t = getRobTool(id);
  return !!(t && t.scoring === 'stars');
}

/** True when the tool may present a numeric score at all (the NOS forms only). */
export function isScoringAllowedTool(id) {
  const t = getRobTool(id);
  return !!(t && t.scoringAllowed === true);
}

/**
 * The active tools declared for a canonical design id. Exact lookup over
 * ROB_DESIGNS — complete by construction, and pinned by the registry-integrity
 * test so no design in the vocabulary can end up with nothing to offer.
 */
export function toolsForDesignId(designId) {
  const d = String(designId || '');
  if (!d) return [];
  return ROB_TOOLS
    .filter(t => t.status === 'active' && Array.isArray(t.designs) && t.designs.includes(d))
    .map(t => t.id);
}

/**
 * 101.md §18–§20 + 115.md decision 6 — which instrument suits a study design.
 * Returns the ACTIVE tool ids appropriate for a design, most-appropriate first,
 * or [] when we have nothing suitable (never a misleading fallback).
 *
 * Design strings are matched loosely because they arrive from extraction free
 * text ("prospective cohort study", "nested case-control"). ORDER IS
 * LOAD-BEARING: the most specific patterns are tested first, because real design
 * strings routinely contain several of these words at once ("nested case-control
 * study within a cohort", "prospective cohort diagnostic accuracy study",
 * "non-randomised trial").
 */
export function toolsForStudyDesign(design) {
  const d = String(design || '').toLowerCase();
  if (!d) return [];

  // Reviews of reviews first — "systematic review of randomised trials" is a
  // systematic review, not a trial.
  if (/systematic review|meta[\s-]?analys|umbrella review|overview of reviews|scoping review/.test(d)) return ['AMSTAR-2'];
  // Design words that name a study TYPE regardless of the sampling frame.
  if (/diagnostic (test )?accuracy|\bdta\b|index test|sensitivity and specificity/.test(d)) return ['QUADAS-2'];
  if (/prediction model|prognostic model|risk score|risk prediction|clinical prediction/.test(d)) return ['PROBAST'];
  if (/case[\s-]?report/.test(d)) return ['JBI-CaseReport'];
  if (/case[\s-]?series/.test(d)) return ['JBI-CaseSeries'];
  // Case-control must be tested BEFORE cohort: "nested case-control study within
  // a cohort" is a case-control design, and a cohort-first test would misroute it.
  if (/case[\s-]?control/.test(d)) return ['NOS-CC'];
  if (/qualitative|phenomenolog|grounded theory|ethnograph|focus group|semi[\s-]?structured interview/.test(d)) return ['JBI-Qualitative'];
  // Prevalence before cross-sectional: prevalence studies are usually described
  // as cross-sectional, and the prevalence checklist is the more specific fit.
  if (/prevalence|cumulative incidence|proportion study/.test(d)) return ['JBI-Prevalence'];
  if (/cross[\s-]?sectional/.test(d)) return ['JBI-CrossSectional'];
  if (/prognostic factor|prognosis study|prognostic study/.test(d)) return ['QUIPS'];
  // Non-randomised must be tested BEFORE randomised: "non-randomised trial"
  // contains "randomised" and would otherwise be routed to RoB 2.
  if (/non[\s-]?randomi[sz]ed|quasi[\s-]?experimental|before[\s-]?after|interrupted time/.test(d)) return ['ROBINS-I'];
  if (/cohort|longitudinal|prospective|retrospective/.test(d)) return ['NOS'];
  if (/randomi[sz]ed|\brct\b|\btrial\b/.test(d)) return ['RoB2'];
  return [];
}

/** The NOS form (cohort vs case-control) implied by a study design, or ''. */
export function nosVariantForDesign(design) {
  const t = toolsForStudyDesign(design)[0];
  if (t === 'NOS') return 'cohort';
  if (t === 'NOS-CC') return 'case-control';
  return '';
}
