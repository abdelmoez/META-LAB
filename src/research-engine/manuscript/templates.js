/**
 * manuscript/templates.js — 119.md §7. The manuscript TEMPLATE REGISTRY.
 *
 * §7 opens by asking for three things to stop being one thing:
 *
 *   1. REPORTING STRUCTURE  — which sections the manuscript has, and in what order.
 *                             Owned by a reporting guideline (PRISMA 2020, CONSORT
 *                             2025, CARE, …). Lives in `draft.structure`.
 *   2. JOURNAL PROFILE      — a journal's house formatting: abstract shape, word
 *                             limits, required declarations, default reference
 *                             style. Lives in `draft.templateId` (unchanged: the
 *                             five ids this app has always stored ARE journal
 *                             profiles, they were simply called "templates").
 *   3. CITATION STYLE       — how a citation is rendered. Lives in
 *                             `draft.citationStyle` (already separate since 117).
 *
 * They are three DIMENSIONS, not three names for one dropdown, which is what makes
 * "a citation style change should not unexpectedly rewrite the manuscript's section
 * structure" (§7) structurally true rather than a promise: nothing in this module
 * lets a citation style reach `structure`, and `applyStructureSwitch` is the only
 * function in the codebase that writes it.
 *
 * HONESTY RULES (§7, and the reason this file carries citations at all):
 *   - every structure records its GUIDELINE, that guideline's VERSION, the date the
 *     entry was reviewed against the authoritative source, and that source's URL;
 *   - no journal rule is invented. The journal profiles below carry a `verified`
 *     list (checked against the journal's own current author instructions on
 *     `lastReviewedAt`) and a `needsUserVerification` list for everything that was
 *     NOT confirmed, plus a `reviewNote` when the instructions could not be
 *     retrieved at all. The UI shows both lists;
 *   - nothing here claims submission compliance. Ever.
 *
 * Pure — no DOM/React/network. Imports the core section registry only.
 */

import {
  SECTION_TYPES, SECTION_IDS, CORE_SECTION_ID_SET,
  draftSectionTypes, defaultSectionLabel, JOURNAL_TEMPLATES,
} from './model.js';

/* ════════════ non-core sections the structures introduce ════════════
 *
 * Each id is STABLE and is the storage key (`draft.sections[id]`), so renaming a
 * section in one structure can never move another structure's text. Every entry
 * below exists because a real guideline gives it its own reporting home — none is
 * decoration.
 */
export const EXTRA_SECTION_TYPES = Object.freeze([
  { id: 'other-information', label: 'Other information', group: 'body' },
  { id: 'open-science', label: 'Open science', group: 'body' },
  { id: 'network-geometry', label: 'Network geometry', group: 'body' },
  { id: 'harms', label: 'Harms', group: 'body' },
  { id: 'reflexivity', label: 'Researcher characteristics and reflexivity', group: 'body' },
  { id: 'administrative-information', label: 'Administrative information', group: 'body' },
  { id: 'patient-information', label: 'Patient information', group: 'body' },
  { id: 'clinical-findings', label: 'Clinical findings', group: 'body' },
  { id: 'timeline', label: 'Timeline', group: 'body' },
  { id: 'diagnostic-assessment', label: 'Diagnostic assessment', group: 'body' },
  { id: 'therapeutic-intervention', label: 'Therapeutic intervention', group: 'body' },
  { id: 'follow-up-outcomes', label: 'Follow-up and outcomes', group: 'body' },
  { id: 'patient-perspective', label: 'Patient perspective', group: 'body' },
  { id: 'informed-consent', label: 'Informed consent', group: 'body' },
]);

const EXTRA_BY_ID = new Map(EXTRA_SECTION_TYPES.map((s) => [s.id, s]));

/** Every section id any shipped structure can use (core + extras). */
export const KNOWN_SECTION_IDS = Object.freeze([
  ...SECTION_IDS, ...EXTRA_SECTION_TYPES.map((s) => s.id),
]);

/** The descriptor for a known id, or null. Pure. */
export function knownSectionType(id) {
  return SECTION_TYPES.find((s) => s.id === id) || EXTRA_BY_ID.get(id) || null;
}

/** Build one structure section entry from an id + optional overrides. Pure. */
function sec(id, guidance, overrides) {
  const base = knownSectionType(id);
  const out = {
    id,
    label: (overrides && overrides.label) || (base ? base.label : defaultSectionLabel(id)),
    group: (base && base.group) || 'body',
  };
  if (!CORE_SECTION_ID_SET.has(id)) out.custom = true;
  if (guidance) out.guidance = guidance;
  return out;
}

/* ════════════ 119.md §7 — the reporting-structure library ════════════
 *
 * `reviewedAt` is the date the entry below was checked against `source`. Every
 * guideline fact (name, version, year, journal, checklist shape) was read from the
 * cited source on that date; nothing is recalled or inferred.
 */
const REVIEWED = '2026-08-16';

export const MANUSCRIPT_STRUCTURES = Object.freeze([
  {
    id: 'imrad',
    label: 'Generic biomedical IMRAD',
    guideline: 'IMRAD (ICMJE Recommendations)',
    guidelineVersion: 'Conventional structure — no versioned checklist',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://www.icmje.org/recommendations/',
    note: 'The default structure, and the one every manuscript written in PecanRev before templates existed already has. Introduction · Methods · Results · Discussion, with Limitations and Conclusions split out as their own sections so they are not lost inside Discussion.',
    checklistItems: null,
    sections: [
      sec('title'), sec('abstract'), sec('introduction'), sec('methods'),
      sec('results'), sec('discussion'), sec('limitations'), sec('conclusion'),
    ],
  },
  {
    id: 'prisma-2020',
    label: 'Systematic review / meta-analysis (PRISMA 2020)',
    guideline: 'PRISMA',
    guidelineVersion: '2020 (BMJ 2021;372:n71)',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://www.prisma-statement.org/',
    checklistItems: 27,
    note: 'PRISMA 2020’s own top-level sections. "Other information" is the checklist’s final section (items 24–27: registration and protocol, support, competing interests, availability of data, code and other materials) — the items reviewers most often find missing.',
    sections: [
      sec('title', 'Identify the report as a systematic review (PRISMA 2020 item 1).'),
      sec('abstract', 'A structured abstract following the PRISMA 2020 for Abstracts checklist (item 2).'),
      sec('introduction', 'Rationale (item 3) and Objectives (item 4) — the review question in PICO terms.'),
      sec('methods', 'Items 5–15: eligibility criteria, information sources, search strategy, selection and data-collection processes, data items, risk-of-bias assessment, effect measures, synthesis methods, reporting-bias assessment, certainty assessment.'),
      sec('results', 'Items 16–22: study selection, study characteristics, risk of bias, results of individual studies, results of syntheses, reporting biases, certainty of evidence.'),
      sec('discussion', 'Item 23a–b: interpretation of the results in the context of other evidence, and limitations of the evidence included.'),
      sec('limitations', 'Item 23c–d: limitations of the review PROCESSES used, and implications for practice, policy and future research.'),
      sec('conclusion', 'A general interpretation of the results (part of item 23).'),
      sec('other-information', 'Items 24–27: registration and protocol (and where the protocol can be accessed), sources of financial and non-financial support, competing interests, and availability of data, code and other materials.'),
    ],
  },
  {
    id: 'prisma-nma',
    label: 'Network meta-analysis (PRISMA-NMA)',
    guideline: 'PRISMA extension for network meta-analyses',
    guidelineVersion: '2015 (Ann Intern Med 2015;162:777–84)',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://www.acpjournals.org/doi/10.7326/M14-2385',
    checklistItems: 32,
    note: 'PRISMA 2020’s structure plus the network-specific reporting the NMA extension adds (32 items: 27 core plus 5 NMA-specific). Network geometry gets its own section because it is the item most often reported only inside a figure legend.',
    sections: [
      sec('title', 'Identify the report as a systematic review incorporating a network meta-analysis.'),
      sec('abstract', 'A structured abstract; state that treatments were compared in a network meta-analysis.'),
      sec('introduction', 'Rationale and objectives, including why an indirect/mixed comparison is needed.'),
      sec('methods', 'Core PRISMA methods plus the NMA-specific items: geometry planning, assumptions of transitivity, and the methods used to assess inconsistency between direct and indirect evidence.'),
      sec('results', 'Study selection and characteristics, then the network estimates for every comparison.'),
      sec('network-geometry', 'PRISMA-NMA item S1/S4: describe the geometry of the treatment network — which treatments were compared directly, how often, and with how many participants — and present the network plot.'),
      sec('discussion', 'Interpretation of the network estimates, including ranking metrics and their uncertainty.'),
      sec('limitations', 'Limitations of the evidence and of the review processes, including the plausibility of the transitivity assumption.'),
      sec('conclusion', 'A general interpretation of the network results.'),
      sec('other-information', 'Registration and protocol, support, competing interests, and availability of data and code.'),
    ],
  },
  {
    id: 'prisma-scr',
    label: 'Scoping review (PRISMA-ScR)',
    guideline: 'PRISMA extension for scoping reviews',
    guidelineVersion: '2018 (Ann Intern Med 2018;169:467–73)',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://www.acpjournals.org/doi/10.7326/M18-0850',
    checklistItems: 22,
    note: 'PRISMA-ScR’s top-level sections match PRISMA 2020’s; the differences are in the ITEMS, and this template’s per-section guidance follows them — a scoping review CHARTS data rather than extracting it, and PRISMA-ScR has no critical-appraisal or certainty-of-evidence items (20 essential items plus 2 optional).',
    sections: [
      sec('title', 'Identify the report as a scoping review (PRISMA-ScR item 1).'),
      sec('abstract', 'Structured summary — item 2.'),
      sec('introduction', 'Rationale (item 3) and objectives stated as the review question(s) (item 4).'),
      sec('methods', 'Items 5–12: protocol and registration, eligibility criteria, information sources, search, selection of sources of evidence, DATA CHARTING PROCESS, data items, and (optional) critical appraisal.'),
      sec('results', 'Items 14–18: selection and characteristics of sources of evidence, results of individual sources, and the synthesis of results against the objectives.'),
      sec('discussion', 'Item 20 — summary of evidence: relate the results to the review question and objectives, and to the needs of the intended audience.'),
      sec('limitations', 'Item 21 — limitations of the scoping-review process.'),
      sec('conclusion', 'Item 22 — conclusions, including implications for further research or practice.'),
      sec('other-information', 'Item 22 funding, plus registration and protocol availability where applicable.'),
    ],
  },
  {
    id: 'consort',
    label: 'Randomised trial (CONSORT 2025)',
    guideline: 'CONSORT',
    guidelineVersion: '2025 (published 14 April 2025; 30-item checklist)',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://www.equator-network.org/reporting-guidelines/consort/',
    checklistItems: 30,
    note: 'CONSORT 2025 restructured the checklist and added a section on OPEN SCIENCE (registration, protocol and statistical analysis plan, data and code sharing, funding, conflicts). Harms are a separate section because CONSORT asks for both systematic and non-systematic harms.',
    sections: [
      sec('title', 'Identify the study as a randomised trial in the title.'),
      sec('abstract', 'A structured abstract following the CONSORT for Abstracts items.'),
      sec('introduction', 'Scientific background and rationale, and specific objectives or hypotheses.'),
      sec('methods', 'Trial design, participants, interventions, outcomes, sample size, randomisation (sequence generation, allocation concealment, implementation), blinding, and statistical methods. Describe any patient and public involvement.'),
      sec('results', 'Participant flow (with the CONSORT flow diagram), recruitment dates, baseline data, numbers analysed, outcomes and estimation with precision, and any ancillary analyses.'),
      sec('harms', 'All important harms or unintended effects in each group — both those collected systematically and those reported non-systematically.'),
      sec('discussion', 'Interpretation consistent with results, balancing benefits and harms, and generalisability of the findings.'),
      sec('limitations', 'Trial limitations, addressing sources of potential bias and imprecision, and the risks from multiplicity of analyses.'),
      sec('conclusion', 'The overall interpretation of the trial in the context of other relevant evidence.'),
      sec('open-science', 'CONSORT 2025 open-science section: trial registration (number and registry), where the full protocol and statistical analysis plan can be accessed, data and code availability, sources of funding and the role of funders, and declarations of interest.'),
    ],
  },
  {
    id: 'strobe',
    label: 'Observational study (STROBE)',
    guideline: 'STROBE',
    guidelineVersion: '2007 (22-item checklist; no update issued as of review)',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://www.strobe-statement.org/',
    checklistItems: 22,
    note: 'STROBE covers cohort, case-control and cross-sectional studies with one 22-item checklist; several items are design-specific, so the guidance below names the design where the checklist does. Item 22 (funding) is the checklist’s own "Other information" section.',
    sections: [
      sec('title', 'Indicate the study design with a commonly used term in the title or the abstract.'),
      sec('abstract', 'An informative and balanced summary of what was done and what was found.'),
      sec('introduction', 'Scientific background and rationale, and the pre-specified objectives, including any pre-specified hypotheses.'),
      sec('methods', 'Study design, setting and dates, eligibility criteria and methods of participant selection (with the follow-up/matching rules for cohort and case-control studies), variables and their definitions, data sources and measurement, efforts to address bias, study size, quantitative handling of variables, and the statistical methods — including how missing data and loss to follow-up were addressed.'),
      sec('results', 'Participants at each stage (with a flow diagram), descriptive data, outcome data, and the main results with unadjusted and confounder-adjusted estimates and their precision. Report any other analyses done.'),
      sec('discussion', 'Key results with reference to the study objectives, and their interpretation considering objectives, limitations, multiplicity, and evidence from similar studies.'),
      sec('limitations', 'Limitations of the study, taking into account sources of potential bias or imprecision, and discussing both the direction and the magnitude of any potential bias.'),
      sec('conclusion', 'Generalisability (external validity) of the study results.'),
      sec('other-information', 'Item 22 — the source of funding and the role of the funders for the present study and, if applicable, for the original study on which the article is based.'),
    ],
  },
  {
    id: 'stard',
    label: 'Diagnostic accuracy study (STARD 2015)',
    guideline: 'STARD',
    guidelineVersion: '2015 (BMJ 2015;351:h5527)',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://www.equator-network.org/reporting-guidelines/stard/',
    checklistItems: 30,
    note: 'STARD 2015 is the current version. Its final three items (registration, where the full study protocol can be accessed, and sources of funding) form an "Other information" section.',
    sections: [
      sec('title', 'Identify the article as a study of diagnostic accuracy using at least one measure of accuracy (such as sensitivity, specificity, predictive values or AUC).'),
      sec('abstract', 'A structured summary of design, methods, results and conclusions.'),
      sec('introduction', 'Scientific and clinical background, including the intended use and clinical role of the index test, and the study objectives and hypotheses.'),
      sec('methods', 'Whether data collection was prospective or retrospective; eligibility criteria; where and when potentially eligible participants were identified; whether sampling was consecutive, random or convenience; the index test and reference standard in sufficient detail to permit replication; the rationale for the reference standard; definition and rationale for test positivity cut-offs; blinding of readers; methods for estimating and comparing accuracy; how indeterminate results and missing data were handled; and the intended sample size and how it was determined.'),
      sec('results', 'Baseline demographic and clinical characteristics; a flow of participants using a diagram; the time interval and any clinical interventions between index test and reference standard; the distribution of the target condition by severity; a cross-tabulation of index-test results by the reference standard; estimates of accuracy with their precision; any adverse events from performing either test.'),
      sec('discussion', 'The clinical applicability of the study findings.'),
      sec('limitations', 'Study limitations, including sources of potential bias, statistical uncertainty and generalisability.'),
      sec('conclusion', 'Implications for practice, including the intended use and clinical role of the index test.'),
      sec('other-information', 'Registration number and name of registry, where the full study protocol can be accessed, and sources of funding and other support with the role of the funders.'),
    ],
  },
  {
    id: 'care',
    label: 'Case report (CARE)',
    guideline: 'CARE',
    guidelineVersion: '2013 (13-item checklist; explanation and elaboration 2017)',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://www.care-statement.org/checklist',
    checklistItems: 13,
    note: 'CARE is genuinely NOT an IMRAD structure: a case report has no Methods and no Results, and instead follows the patient. This structure is the CARE checklist’s own item order. Switching to it from IMRAD leaves Methods, Results, Limitations and Conclusions unmapped — that content is preserved, never deleted.',
    sections: [
      sec('title', 'The words "case report" should appear in the title with the phenomenon of greatest interest.'),
      sec('abstract', 'What is unique and what it adds to the medical literature; the main symptoms and important clinical findings; the main diagnoses, interventions and outcomes; and the conclusion.'),
      sec('introduction', 'A brief background summary of this case referencing the relevant medical literature.'),
      sec('patient-information', 'De-identified demographic and other patient information; the main concerns and symptoms of the patient; medical, family and psychosocial history including genetic information; relevant past interventions and their outcomes.'),
      sec('clinical-findings', 'Describe the relevant physical examination and other significant clinical findings.'),
      sec('timeline', 'Historical and current information from this episode of care organised as a timeline.'),
      sec('diagnostic-assessment', 'Diagnostic testing and its results; diagnostic challenges; the diagnostic reasoning including other diagnoses considered; and prognostic characteristics where applicable.'),
      sec('therapeutic-intervention', 'Types of intervention (pharmacologic, surgical, preventive, self-care, other) and their administration — dosage, strength, duration and how they were changed.'),
      sec('follow-up-outcomes', 'Clinician- and patient-assessed outcomes; important follow-up diagnostic and other test results; intervention adherence and tolerability, including how this was assessed; and any adverse or unanticipated events.'),
      sec('discussion', 'A discussion of the strengths and limitations in the management of this case, the relevant medical literature, the rationale for the conclusions, and the main take-away lessons.'),
      sec('patient-perspective', 'The patient should share their perspective on the treatments they received whenever appropriate.'),
      sec('informed-consent', 'The patient should give informed consent. State that consent was obtained; provide the document if requested.'),
    ],
  },
  {
    id: 'srqr',
    label: 'Qualitative research (SRQR)',
    guideline: 'SRQR — Standards for Reporting Qualitative Research',
    guidelineVersion: '2014 (Acad Med 2014;89:1245–51)',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://www.equator-network.org/reporting-guidelines/srqr/',
    checklistItems: 21,
    note: 'SRQR is the general-purpose qualitative standard (COREQ is the narrower interview/focus-group instrument). Researcher characteristics and reflexivity is a Methods ITEM in the checklist; it gets its own section here because it is the item most often omitted entirely.',
    sections: [
      sec('title', 'Concise description of the nature and topic of the study, identifying it as qualitative or naming the qualitative approach.'),
      sec('abstract', 'A summary of the key elements using the abstract format of the intended publication; typically problem, methods, results and conclusions.'),
      sec('introduction', 'Problem formulation — the problem or phenomenon studied and its relevance — and the purpose or research question.'),
      sec('methods', 'The qualitative approach and research paradigm; the context; the sampling strategy and its rationale; ethical issues pertaining to human subjects; data-collection methods and instruments; the units of study; data processing; and the data-analysis approach.'),
      sec('reflexivity', 'SRQR item 6 — researchers’ characteristics that may influence the research: personal attributes, qualifications and experience, relationship with participants, assumptions, and reflexive accounting for how these shaped the work.'),
      sec('results', 'Findings such as themes, with evidence — quotations, field notes, other empirical material — linked to the objectives, and the techniques used to enhance trustworthiness.'),
      sec('discussion', 'Integration with prior work, implications, and transferability — a short summary of the main findings and their relation to theory, practice or policy.'),
      sec('limitations', 'Limitations of the study, including trustworthiness and any constraints on transferability.'),
      sec('conclusion', 'The principal conclusions the findings support.'),
      sec('other-information', 'Conflicts of interest and sources of funding, and the role of funders in the conduct of the study.'),
    ],
  },
  {
    id: 'prisma-p',
    label: 'Systematic review protocol (PRISMA-P)',
    guideline: 'PRISMA-P',
    guidelineVersion: '2015 (Syst Rev 2015;4:1) — 17 items in 3 sections',
    version: 1,
    reviewedAt: REVIEWED,
    source: 'https://link.springer.com/article/10.1186/2046-4053-4-1',
    checklistItems: 17,
    note: 'A PROTOCOL, not a report: PRISMA-P’s 17 items sit in exactly three sections (administrative information, introduction, methods) and there is nothing to report as results yet. Switching to this structure therefore leaves Results, Discussion, Limitations and Conclusions unmapped — that content is preserved, not deleted, and switching back restores its place.',
    sections: [
      sec('title', 'Identify the report as a protocol for a systematic review; if it is an update, identify it as such.'),
      sec('abstract', 'A structured summary including, as applicable: background, objectives, data sources, eligibility criteria, participants and interventions, appraisal and synthesis methods, outcomes, funding, and the registration number.'),
      sec('administrative-information', 'PRISMA-P items 1–5: registration name and registry (and registration number if available), authors with contact details and contributions, any protocol amendments (with date and rationale), and sources of financial and other support with the role of the sponsor or funder.'),
      sec('introduction', 'Items 6–7: the rationale for the review in the context of what is already known, and an explicit statement of the questions the review will address with reference to participants, interventions, comparators and outcomes (PICO).'),
      sec('methods', 'Items 8–17: eligibility criteria, information sources with planned dates of coverage, the draft search strategy for at least one database, study records (data management, selection process, data-collection process), data items, outcomes and prioritisation, risk-of-bias assessment in individual studies, data synthesis, meta-bias(es), and confidence in cumulative evidence.'),
    ],
  },
]);

export const MANUSCRIPT_STRUCTURE_IDS = Object.freeze(MANUSCRIPT_STRUCTURES.map((s) => s.id));

/** The DEFAULT structure — what a draft with no `structure` key already is. */
export const DEFAULT_STRUCTURE_ID = 'imrad';

/** The structure descriptor for an id (unknown → null). Pure. */
export function structureById(id) {
  return MANUSCRIPT_STRUCTURES.find((s) => s.id === id) || null;
}

/**
 * The structure a draft is CURRENTLY on: its stored `draft.structure` when it has
 * one, otherwise the IMRAD entry (which is what an absent key means). The returned
 * object always has `{id, label, sections}`. Pure.
 */
export function draftStructure(draft) {
  const st = draft && draft.structure;
  if (st && Array.isArray(st.sections) && st.sections.length) return st;
  return structureById(DEFAULT_STRUCTURE_ID);
}

/** Has this draft been customized away from its template's shipped section set? */
export function isCustomizedStructure(draft) {
  const st = draft && draft.structure;
  if (!st) return false;
  const tpl = structureById(st.id);
  if (!tpl) return true;
  const a = st.sections.map((s) => `${s.id}:${s.label}`).join('|');
  const b = tpl.sections.map((s) => `${s.id}:${s.label}`).join('|');
  return a !== b;
}

/* ════════════ 119.md §7 — journal / publisher profiles ════════════
 *
 * These enrich the FIVE profile ids the app has always stored (`draft.templateId`)
 * — the ids are never renamed or removed, because a stored id that stopped
 * resolving would silently mutate a draft (model.js falls back to 'generic').
 *
 * §7: "Do not claim guaranteed submission compliance. Show: source guideline,
 * last-reviewed date, template version, any rules that still require user
 * verification." That is exactly the shape below, and the split between `verified`
 * and `needsUserVerification` is honest per-FIELD rather than per-profile: a
 * profile is not "verified" as a whole just because one number was checked.
 */
export const JOURNAL_PROFILE_META = Object.freeze({
  generic: {
    version: 1,
    lastReviewedAt: REVIEWED,
    publisher: null,
    source: 'https://www.icmje.org/recommendations/',
    sourceLabel: 'ICMJE Recommendations',
    verified: [],
    needsUserVerification: ['abstractFormat', 'requiredStatements', 'citationStyle'],
    reviewNote: 'A neutral default, not a journal. It follows no single journal’s house style — check every formatting rule against your target journal before submission.',
  },
  jama: {
    version: 1,
    lastReviewedAt: REVIEWED,
    publisher: 'American Medical Association (JAMA Network)',
    source: 'https://jamanetwork.com/journals/jama/pages/instructions-for-authors',
    sourceLabel: 'JAMA Instructions for Authors',
    verified: ['abstractWordLimit', 'mainTextWordLimit', 'keyPoints', 'dataSharingStatement', 'styleManual'],
    needsUserVerification: ['abstractFormat', 'requiredStatements', 'referenceLimit', 'tableFigureLimit'],
    facts: [
      'Systematic review abstracts: no more than 350 words.',
      'Original Investigations: maximum 3000 words of text, and no more than 5 tables and/or figures in total.',
      'A list of 3 Key Points is required.',
      'A Data Sharing Statement is required.',
      'House style follows the AMA Manual of Style; authors are directed to the EQUATOR reporting guidelines.',
    ],
    reviewNote: 'The abstract word limit above is the one JAMA states for SYSTEMATIC REVIEWS, which is the article type PecanRev produces. Article-type limits differ — confirm the limit for the type you are submitting.',
  },
  bmj: {
    version: 1,
    lastReviewedAt: REVIEWED,
    publisher: 'BMJ Publishing Group',
    source: 'https://www.bmj.com/about-bmj/resources-authors',
    sourceLabel: 'The BMJ — Resources for authors',
    verified: [],
    needsUserVerification: ['abstractWordLimit', 'abstractFormat', 'mainTextWordLimit', 'requiredStatements', 'citationStyle'],
    reviewNote: 'The BMJ’s author instructions could not be retrieved at review time, so every value in this profile is an unverified formatting aid carried over from earlier releases. Verify all of them against the journal’s current instructions.',
  },
  lancet: {
    version: 1,
    lastReviewedAt: REVIEWED,
    publisher: 'Elsevier (The Lancet family)',
    source: 'https://www.thelancet.com/lancet/information-for-authors',
    sourceLabel: 'The Lancet — Information for Authors',
    verified: [],
    needsUserVerification: ['abstractWordLimit', 'abstractFormat', 'mainTextWordLimit', 'requiredStatements', 'citationStyle'],
    reviewNote: 'The Lancet’s information-for-authors PDF returned HTTP 403 at review time and could not be read. Public secondary sources disagree with the stored abstract limit (they quote 250 words for Articles against the 300 stored here), so treat every value in this profile as unverified and check the journal’s own PDF.',
  },
  cochrane: {
    version: 1,
    lastReviewedAt: REVIEWED,
    publisher: 'Cochrane',
    source: 'https://community.cochrane.org/mecir-manual',
    sourceLabel: 'Cochrane MECIR standards',
    verified: [],
    needsUserVerification: ['abstractWordLimit', 'abstractFormat', 'requiredStatements', 'citationStyle'],
    reviewNote: 'A Cochrane REVIEW is written in RevMan against the MECIR conduct and reporting standards, not as a journal manuscript. This profile is a formatting aid for a Cochrane-STYLE manuscript only; it does not implement MECIR.',
  },
});

/** Journal-profile metadata for a templateId (unknown → null). Pure. */
export function journalProfileMeta(templateId) {
  return JOURNAL_PROFILE_META[templateId] || null;
}

/**
 * A journal profile as ONE object: the shipped formatting aid (model.js) merged
 * with its provenance. Never returns null for a known id. Pure.
 */
export function journalProfile(templateId) {
  const tpl = JOURNAL_TEMPLATES.find((t) => t.id === templateId) || JOURNAL_TEMPLATES[0];
  return { ...tpl, meta: journalProfileMeta(tpl.id) };
}

/* ════════════ 119.md §7 — switching: preview, diff, mapping, apply ════════════ */

const clean = (s) => String(s == null ? '' : s).trim();

/** Words in a markdown blob — for "how much content is at stake" in the preview. */
function wordCount(md) {
  const t = clean(md).replace(/\[\[[^\]]*\]\]/g, ' ');
  if (!t) return 0;
  return (t.match(/\S+/g) || []).length;
}

/**
 * PREVIEW a structure switch WITHOUT touching the draft (§7: "Preview a template
 * before applying it" / "See what will be added, renamed, reordered, or hidden").
 *
 * Everything here is derived from two ordered id lists plus the draft's own text,
 * so the dialog cannot show one thing and the apply do another — `applyStructureSwitch`
 * consumes this exact plan.
 *
 * @param {object} draft        normalized draft
 * @param {string} structureId  target structure id
 * @param {object} opts         { mapping?: {sectionId: targetSectionId|''} }
 * @returns {{
 *   ok: boolean, reason?: string,
 *   from: {id,label}, to: object,
 *   sections: Array<{id,label,group,custom?,state:'added'|'kept'|'renamed'|'moved',
 *                    fromLabel?:string, fromIndex?:number, toIndex:number, words:number, guidance?:string}>,
 *   added: string[], renamed: Array<{id,from,to}>, moved: Array<{id,label,fromIndex,toIndex}>,
 *   droppedEmpty: Array<{id,label}>,
 *   unmapped: Array<{id,label,words,mappedTo:string}>,
 *   targets: Array<{id,label}>,
 *   counts: {added,renamed,moved,droppedEmpty,unmapped,preserved,merged},
 * }}  Pure.
 */
export function planStructureSwitch(draft, structureId, opts = {}) {
  const target = structureById(structureId);
  const fromStruct = draftStructure(draft);
  if (!target) {
    return { ok: false, reason: 'unknown-structure', from: { id: fromStruct.id || '', label: fromStruct.label || '' }, to: null, sections: [], added: [], renamed: [], moved: [], droppedEmpty: [], unmapped: [], targets: [], counts: { added: 0, renamed: 0, moved: 0, droppedEmpty: 0, unmapped: 0, preserved: 0, merged: 0 } };
  }
  const current = draftSectionTypes(draft);
  const currentIndex = new Map(current.map((s, i) => [s.id, i]));
  const currentById = new Map(current.map((s) => [s.id, s]));
  const secs = (draft && draft.sections) || {};
  const textOf = (id) => ((secs[id] && typeof secs[id].content === 'string') ? secs[id].content : '');

  const targetIds = new Set(target.sections.map((s) => s.id));
  const mapping = (opts.mapping && typeof opts.mapping === 'object') ? opts.mapping : {};

  const sections = [];
  const added = [];
  const renamed = [];
  const moved = [];
  target.sections.forEach((s, toIndex) => {
    const was = currentById.get(s.id);
    const row = { ...s, toIndex, words: wordCount(textOf(s.id)) };
    if (!was) { row.state = 'added'; added.push(s.id); } else {
      const fromIndex = currentIndex.get(s.id);
      row.fromIndex = fromIndex;
      row.fromLabel = was.label;
      if (was.label !== s.label) { row.state = 'renamed'; renamed.push({ id: s.id, from: was.label, to: s.label }); } else if (fromIndex !== toIndex) { row.state = 'moved'; moved.push({ id: s.id, label: s.label, fromIndex, toIndex }); } else row.state = 'kept';
    }
    sections.push(row);
  });

  // Sections the target does not contain: EMPTY ones simply go (nothing is lost);
  // ones that hold text are the §7 "unmapped content" case and are never deleted.
  const droppedEmpty = [];
  const unmapped = [];
  for (const s of current) {
    if (targetIds.has(s.id)) continue;
    const words = wordCount(textOf(s.id));
    if (!words) { droppedEmpty.push({ id: s.id, label: s.label }); continue; }
    const to = typeof mapping[s.id] === 'string' && targetIds.has(mapping[s.id]) ? mapping[s.id] : '';
    unmapped.push({ id: s.id, label: s.label, words, mappedTo: to });
  }

  const merged = unmapped.filter((u) => u.mappedTo).length;
  return {
    ok: true,
    from: { id: fromStruct.id || DEFAULT_STRUCTURE_ID, label: fromStruct.label || 'Generic biomedical IMRAD' },
    to: {
      id: target.id, label: target.label, guideline: target.guideline,
      guidelineVersion: target.guidelineVersion, reviewedAt: target.reviewedAt,
      version: target.version, source: target.source, note: target.note,
      checklistItems: target.checklistItems,
    },
    sections,
    added,
    renamed,
    moved,
    droppedEmpty,
    unmapped,
    targets: target.sections.map((s) => ({ id: s.id, label: s.label })),
    counts: {
      added: added.length,
      renamed: renamed.length,
      moved: moved.length,
      droppedEmpty: droppedEmpty.length,
      unmapped: unmapped.length,
      preserved: unmapped.length - merged,
      merged,
    },
  };
}

/**
 * The STORED form of a structure section: identity, label, group and the two
 * additive flags — never the guidance prose.
 *
 * Guidance is registry data, not draft data. Freezing ~2 kB of checklist text into
 * every blob would bloat the project AND pin the wording of the guideline note to
 * whatever this build said on the day the template was applied; reading it back
 * from `MANUSCRIPT_STRUCTURES` at render time keeps one source of truth and lets a
 * reviewed template update its own guidance. (`normalizeStructure` still tolerates
 * a stored `guidance` so a hand-written blob is not mangled.)
 */
function storedEntry(s) {
  const out = { id: s.id, label: s.label, group: s.group === 'front' ? 'front' : 'body' };
  if (s.custom || !CORE_SECTION_ID_SET.has(s.id)) out.custom = true;
  if (s.retained) out.retained = true;
  return out;
}

/** The structure entry a PRESERVED (unmapped) section becomes. */
function retainedEntry(sectionType) {
  return storedEntry({ ...sectionType, retained: true });
}

/**
 * APPLY a structure switch. The ONE writer of `draft.structure`.
 *
 * Contract (119.md §7):
 *   - content is NEVER deleted. A section the new structure lacks is either MERGED
 *     into a section the researcher explicitly mapped it to, or kept as a RETAINED
 *     section at the end of the structure — visible in the outline, the document,
 *     the numbering and the export, under a clearly labelled "Not part of this
 *     template" group;
 *   - merged text is appended under a `## <original label>` heading so the reader
 *     can always see where it came from, and the receiving section is marked
 *     userEdited so a later regeneration cannot silently clobber it;
 *   - the target's guideline / version / reviewed date are recorded on the draft;
 *   - `templateId` (journal profile) and `citationStyle` are NOT touched. A
 *     structure is not a journal and is not a citation style.
 *
 * @param {object} draft
 * @param {string} structureId
 * @param {object} opts { mapping?: {from:to}, nowIso?:string }
 * @returns {{ draft:object, applied:boolean, reason?:string, plan?:object,
 *             merged:Array<{from,to}>, preserved:string[] }}  Pure.
 */
export function applyStructureSwitch(draft, structureId, opts = {}) {
  const plan = planStructureSwitch(draft, structureId, opts);
  if (!plan.ok) return { draft, applied: false, reason: plan.reason || 'unknown-structure', merged: [], preserved: [] };
  const target = structureById(structureId);
  const nowIso = opts.nowIso || null;
  const current = draftSectionTypes(draft);
  const currentById = new Map(current.map((s) => [s.id, s]));
  const prev = (draft && draft.sections) || {};

  // 1) every section the target names, carrying its existing text forward.
  const sections = {};
  for (const s of target.sections) {
    const was = prev[s.id];
    sections[s.id] = was ? { ...was } : {
      content: '', aiGenerated: false, userEdited: false, lastGeneratedAt: null, updatedAt: nowIso,
    };
  }

  // 2) the unmapped ones — merged where asked, preserved otherwise.
  const merged = [];
  const preserved = [];
  const retained = [];
  for (const u of plan.unmapped) {
    const src = prev[u.id] || {};
    const text = clean(src.content);
    if (u.mappedTo && sections[u.mappedTo]) {
      const dest = sections[u.mappedTo];
      const label = (currentById.get(u.id) || {}).label || defaultSectionLabel(u.id);
      const head = `## ${label}`;
      const body = clean(dest.content) ? `${dest.content.replace(/\s+$/, '')}\n\n${head}\n\n${text}` : `${head}\n\n${text}`;
      sections[u.mappedTo] = {
        ...dest,
        content: body,
        // Human text moved in by an explicit choice — never let a regeneration
        // quietly overwrite it (the applyGeneratedSections user-edit rule).
        userEdited: true,
        updatedAt: nowIso,
      };
      merged.push({ from: u.id, to: u.mappedTo });
      continue;
    }
    sections[u.id] = { ...src };
    retained.push(retainedEntry(currentById.get(u.id) || { id: u.id, label: u.label, group: 'body' }));
    preserved.push(u.id);
  }

  const structure = {
    id: target.id,
    label: target.label,
    guideline: target.guideline,
    guidelineVersion: target.guidelineVersion,
    version: target.version,
    reviewedAt: target.reviewedAt,
    source: target.source,
    ...(nowIso ? { appliedAt: nowIso } : {}),
    sections: [...target.sections.map(storedEntry), ...retained],
  };

  return {
    draft: { ...draft, structure, sections, updatedAt: nowIso || draft.updatedAt },
    applied: true,
    plan,
    merged,
    preserved,
  };
}

/**
 * §7 "Customize the resulting structure" — rename ONE section. The id (and so the
 * text) never moves; only the label changes, and only inside this draft. A draft
 * still on the implicit core structure materializes one first, which is the only
 * moment a `structure` key appears without a template switch. Pure.
 */
export function renameDraftSection(draft, sectionId, label, opts = {}) {
  const name = clean(label);
  if (!name) return { draft, applied: false, reason: 'empty-label' };
  const current = draftSectionTypes(draft);
  if (!current.some((s) => s.id === sectionId)) return { draft, applied: false, reason: 'unknown-section' };
  const base = draftStructure(draft);
  const structure = {
    ...(draft.structure ? draft.structure : {
      id: base.id, label: base.label, guideline: base.guideline,
      guidelineVersion: base.guidelineVersion, version: base.version,
      reviewedAt: base.reviewedAt, source: base.source,
    }),
    sections: current.map((s) => storedEntry(s.id === sectionId ? { ...s, label: name } : s)),
  };
  return { draft: { ...draft, structure, updatedAt: opts.nowIso || draft.updatedAt }, applied: true };
}

/**
 * §7 "Customize the resulting structure" — move ONE section up or down. Front
 * sections (title/abstract) are not reorderable: the title block leads the
 * document in both views and in the .docx. Pure.
 */
export function moveDraftSection(draft, sectionId, delta, opts = {}) {
  const current = draftSectionTypes(draft);
  const i = current.findIndex((s) => s.id === sectionId);
  if (i < 0) return { draft, applied: false, reason: 'unknown-section' };
  if (current[i].group === 'front') return { draft, applied: false, reason: 'front-section' };
  const j = i + (delta < 0 ? -1 : 1);
  if (j < 0 || j >= current.length) return { draft, applied: false, reason: 'out-of-range' };
  if (current[j].group === 'front') return { draft, applied: false, reason: 'front-section' };
  const next = current.map(storedEntry);
  const [row] = next.splice(i, 1);
  next.splice(j, 0, row);
  const base = draftStructure(draft);
  const structure = {
    ...(draft.structure ? draft.structure : {
      id: base.id, label: base.label, guideline: base.guideline,
      guidelineVersion: base.guidelineVersion, version: base.version,
      reviewedAt: base.reviewedAt, source: base.source,
    }),
    sections: next,
  };
  return { draft: { ...draft, structure, updatedAt: opts.nowIso || draft.updatedAt }, applied: true };
}

export default {
  EXTRA_SECTION_TYPES,
  KNOWN_SECTION_IDS,
  knownSectionType,
  MANUSCRIPT_STRUCTURES,
  MANUSCRIPT_STRUCTURE_IDS,
  DEFAULT_STRUCTURE_ID,
  structureById,
  draftStructure,
  isCustomizedStructure,
  JOURNAL_PROFILE_META,
  journalProfileMeta,
  journalProfile,
  planStructureSwitch,
  applyStructureSwitch,
  renameDraftSection,
  moveDraftSection,
};
