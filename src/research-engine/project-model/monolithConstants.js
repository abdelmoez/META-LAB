/* ════════════ MONOLITH DOMAIN CONSTANTS (PURE DATA) ════════════ */
/* Extracted VERBATIM from meta-lab-3-patched.jsx (prompt44 phase-1 refactor).
   These are pure data declarations only — no React, no `C`, no Icon, no JSX.
   Derived label maps are kept computed from their source arrays (order matters). */

/* Physical location of an extracted value (WHERE in the paper) */
export const SOURCE_OPTIONS=[
  ["","— where from? —"],["text","Reported in text"],["table","From a table"],
  ["figure","Figure / Kaplan–Meier curve"],["supplement","Supplementary material"],
  ["calculated","Calculated from reported data"],["converted","Converted from another format"],
  ["author","Obtained from authors"],["unclear","Unclear / needs verification"],
];
/* Methodological role of the estimate (WHAT KIND) */
export const DATA_NATURE=[
  ["primary","Primary outcome (directly reported)",false],
  ["secondary","Secondary outcome",true],
  ["subgroup","Subgroup analysis",true],
  ["posthoc","Post-hoc analysis",true],
  ["sensitivity","Sensitivity analysis",true],
];
/* Adjustment status (expanded) */
export const ADJUST_OPTIONS=[
  ["unadjusted","Unadjusted"],["adjusted","Adjusted (covariates)"],
  ["multivariable","Multivariable-adjusted"],["propensity","Propensity-matched"],
  ["iptw","IPTW-adjusted"],
];
/* Reliability flags (multi-select) */
export const EXTRACT_FLAGS=[
  ["calc","Requires calculation"],["conv","Requires conversion"],
  ["figure","Estimated from figure"],["notprimary","Not primary data"],
  ["highrisk","High risk of extraction error"],["noconfirm","Do not pool unless confirmed"],
];
export const DATA_NATURE_LABEL=Object.fromEntries(DATA_NATURE.map(([k,l])=>[k,l]));
export const ADJUST_LABEL=Object.fromEntries(ADJUST_OPTIONS.map(([k,l])=>[k,l]));
export const FLAG_LABEL=Object.fromEntries(EXTRACT_FLAGS.map(([k,l])=>[k,l]));
export const SOURCE_LABEL=Object.fromEntries(SOURCE_OPTIONS.map(([k,l])=>[k,l]));

/* Effect-measure metadata: which measures share a scale, null value, whether log-scale */
export const ES_TYPES={
  SMD:{label:"SMD (standardized mean diff)",family:"continuous",log:false,nullVal:0,scale:"SMD"},
  MD:{label:"Mean Difference (raw units)",family:"continuous-raw",log:false,nullVal:0,scale:"MD"},
  OR:{label:"Odds Ratio (log scale)",family:"ratio",log:true,nullVal:0,scale:"lnOR"},
  RR:{label:"Risk Ratio (log scale)",family:"ratio",log:true,nullVal:0,scale:"lnRR"},
  // RD is a DIFFERENCE, not a ratio (family fixed from the earlier 'ratio' mislabel;
  // log:false already routed it to the correct additive branch).
  RD:{label:"Risk Difference (raw)",family:"difference",log:false,nullVal:0,scale:"RD"},
  // RoadMap/2.md — Peto odds ratio (rare events / balanced arms). Log scale like OR.
  PETO:{label:"Peto Odds Ratio (log scale)",family:"ratio",log:true,nullVal:0,scale:"lnOR"},
  HR:{label:"Hazard Ratio (log scale)",family:"ratio",log:true,nullVal:0,scale:"lnHR"},
  // RoadMap/2.md — incidence rate ratio (events per person-time). Log scale.
  IRR:{label:"Incidence Rate Ratio (log scale)",family:"ratio",log:true,nullVal:0,scale:"lnIRR"},
  COR:{label:"Correlation (Fisher z)",family:"correlation",log:false,nullVal:0,scale:"z"},
  PROP:{label:"Single-arm proportion (logit)",family:"proportion",log:false,nullVal:null,scale:"logit"},
  // RoadMap/2.md — AUC / C-statistic pooled on the RAW 0–1 scale with its SE
  // (null = 0.5, no discrimination). For logit pooling, enter as Generic (log-free).
  AUC:{label:"AUC / C-statistic",family:"diagnostic-auc",log:false,nullVal:0.5,scale:"AUC"},
  // RoadMap/2.md — regression coefficient (β) on its native additive scale.
  BETA:{label:"Regression coefficient (β)",family:"regression",log:false,nullVal:0,scale:"β"},
  // RoadMap/2.md — pre-computed / generic effect + CI, used verbatim on its own scale.
  GENERIC:{label:"Generic effect (pre-computed)",family:"generic",log:false,nullVal:0,scale:"effect"},
  GENERIC_LOG:{label:"Generic ratio (pre-computed, log scale)",family:"generic",log:true,nullVal:0,scale:"ln(ratio)"},
};

/* ════════════ CONSTANTS ════════════ */
export const ROB2=[{id:"D1",label:"Randomisation process"},{id:"D2",label:"Deviations from intended interventions"},
  {id:"D3",label:"Missing outcome data"},{id:"D4",label:"Measurement of the outcome"},{id:"D5",label:"Selection of the reported result"}];
export const NOS=[{id:"SC1",g:"Selection",label:"Representativeness of exposed cohort"},{id:"SC2",g:"Selection",label:"Selection of non-exposed cohort"},
  {id:"SC3",g:"Selection",label:"Ascertainment of exposure"},{id:"SC4",g:"Selection",label:"Absence of outcome at start"},
  {id:"CO1",g:"Comparability",label:"Comparability (most important factor)"},{id:"CO2",g:"Comparability",label:"Comparability (additional factor)"},
  {id:"OC1",g:"Outcome",label:"Assessment of outcome"},{id:"OC2",g:"Outcome",label:"Adequate follow-up length"},{id:"OC3",g:"Outcome",label:"Adequate follow-up rate"}];
export const PRISMA_CL=[
  {id:"T1",sec:"Title",item:"Title",desc:"Identify the report as a systematic review"},
  {id:"A1",sec:"Abstract",item:"Abstract",desc:"Structured summary: background, objectives, eligibility, sources, methods, results, conclusions"},
  {id:"I1",sec:"Introduction",item:"Rationale",desc:"Describe the rationale in context of existing knowledge"},
  {id:"I2",sec:"Introduction",item:"Objectives",desc:"Explicit statement of objectives with PICO components"},
  {id:"M1",sec:"Methods",item:"Eligibility criteria",desc:"Specify inclusion/exclusion criteria and rationale"},
  {id:"M2",sec:"Methods",item:"Information sources",desc:"All databases, registers, websites, grey literature with dates"},
  {id:"M3",sec:"Methods",item:"Search strategy",desc:"Full search strategies for at least one database including filters"},
  {id:"M4",sec:"Methods",item:"Selection process",desc:"Who screened, how many reviewers, any automation used"},
  {id:"M5",sec:"Methods",item:"Data collection",desc:"Methods for collecting data (forms, dual extraction, reconciliation)"},
  {id:"M6",sec:"Methods",item:"Data items",desc:"List all outcomes and variables sought; assumptions and simplifications"},
  {id:"M7",sec:"Methods",item:"Risk of bias",desc:"Specify methods to assess risk of bias of included studies"},
  {id:"M8",sec:"Methods",item:"Effect measures",desc:"Specify the effect measure used (RR, OR, MD, SMD, HR)"},
  {id:"M9",sec:"Methods",item:"Synthesis methods",desc:"Meta-analysis model, heterogeneity tests (Q, I², τ²), software"},
  {id:"M10",sec:"Methods",item:"Reporting bias",desc:"Methods to assess reporting bias: funnel plot, Egger's/Begg's test"},
  {id:"M11",sec:"Methods",item:"Certainty (GRADE)",desc:"Methods used to assess certainty/confidence in evidence body"},
  {id:"R1",sec:"Results",item:"Study selection",desc:"Describe search results and selection; include PRISMA flow diagram"},
  {id:"R2",sec:"Results",item:"Study characteristics",desc:"Cite included studies with characteristics and interventions"},
  {id:"R3",sec:"Results",item:"Risk of bias",desc:"Present risk of bias assessments for each included study"},
  {id:"R4",sec:"Results",item:"Individual results",desc:"Present all results for each study for all outcomes"},
  {id:"R5",sec:"Results",item:"Synthesis results",desc:"Summarise synthesis results with heterogeneity measures"},
  {id:"R6",sec:"Results",item:"Reporting bias",desc:"Present assessments of risk of bias due to missing results"},
  {id:"R7",sec:"Results",item:"Certainty of evidence",desc:"Present GRADE assessments for each outcome"},
  {id:"D1r",sec:"Discussion",item:"Discussion",desc:"Interpretation in context; discuss limitations and implications"},
  {id:"O1r",sec:"Other",item:"Registration & protocol",desc:"Provide registration information (PROSPERO ID, DOI of protocol)"},
  {id:"O2r",sec:"Other",item:"Funding",desc:"Declare all sources of financial and non-financial support"},
  {id:"O3r",sec:"Other",item:"Competing interests",desc:"Declare competing interests of all review authors"},
];
export const MESH_DBS=[
  {id:"pubmed",label:"PubMed",syntax:"MeSH + [TIAB]",color:"#3b82f6",
    controlled:"MeSH Terms",freeText:"[TIAB] Free-Text",
    guidance:"Use [MeSH Terms] (with subheadings where helpful) and [TIAB] for free text. Use [pt] for publication types (e.g., randomized controlled trial[pt]). Watch ambiguous abbreviations (HAS, MAPS, ARRA). Avoid forcing MeSH on very recent papers (not yet indexed)."},
  {id:"embase",label:"Embase",syntax:"Emtree /exp + .ti,ab.",color:"#8b5cf6",
    controlled:"Emtree Subject Headings",freeText:".ti,ab. Free-Text",
    guidance:"Use exp Emtree/ for explosion or /de for direct term only. Use .ti,ab. for title+abstract. Use .kw. for author keywords. Apply Cochrane RCT filter or Embase-specific filters (e.g., randomized controlled trial/ OR controlled clinical trial/)."},
  {id:"cochrane",label:"Cochrane CENTRAL",syntax:"MeSH + :ti,ab,kw",color:"#ec4899",
    controlled:"MeSH Terms",freeText:":ti,ab,kw Free-Text",
    guidance:"Use [mh \"...\"] for MeSH and :ti,ab,kw for free-text. CENTRAL is already filtered to trials — no need for RCT filter. Use NEAR/n for proximity searching."},
  {id:"wos",label:"Web of Science",syntax:"TS= topic field",color:"#f59e0b",
    controlled:"Topic Phrases",freeText:"TS= Keywords",
    guidance:"WoS has no controlled vocabulary — relies entirely on TS= (title/abstract/keyword) search. Use NEAR/n (default 15) for proximity. Use $ for variable suffix. Apply WC= for category filters and DT= for document types."},
  {id:"scopus",label:"Scopus",syntax:"TITLE-ABS-KEY()",color:"#10b981",
    controlled:"Indexed Keywords",freeText:"TITLE-ABS-KEY",
    guidance:"Use TITLE-ABS-KEY() for the main search. Use INDEXTERMS() for Scopus-indexed thesaurus terms (less reliable than PubMed MeSH). Use W/n and PRE/n for proximity. Apply LIMIT-TO(DOCTYPE,\"ar\") for articles."},
  {id:"cinahl",label:"CINAHL",syntax:"MH + TI/AB",color:"#ef4444",
    controlled:"CINAHL Headings (MH)",freeText:"TI/AB Free-Text",
    guidance:"Use MH \"...\" for major subject headings. Use MH \"...+\" to explode. Use TI/AB for free-text. Apply (MH \"Clinical Trials+\") OR PT clinical trial for trial filter. CINAHL specialises in nursing/allied health."},
  {id:"psycinfo",label:"PsycINFO",syntax:"DE Thesaurus + TI/AB",color:"#6366f1",
    controlled:"APA Thesaurus (DE)",freeText:"TI/AB Free-Text",
    guidance:"Use DE \"...\" for descriptors (APA Thesaurus). Use $exp for explosion. Use TI/AB for free-text. PsycINFO specialises in psychology/behavioral science — use psychology-specific terms."},
  {id:"lilacs",label:"LILACS/BVS",syntax:"DeCS + multilingual free text",color:"#14b8a6",
    controlled:"DeCS Descriptors",freeText:"Multilingual Free-Text",
    guidance:"DeCS is multilingual (English/Spanish/Portuguese). Use mh:\"...\" for descriptors. Always include terms in EN, ES, PT for free text. Use tw: for words anywhere. BVS portal aggregates LILACS + MEDLINE + others."},
];
export const PROSP_FIELDS=[
  {id:"title",sec:"Identification",label:"Review Title",maxLen:300,rows:2,hint:"[Intervention] for [condition] in [population]: a systematic review and meta-analysis"},
  {id:"question",sec:"Identification",label:"Review Question",maxLen:1000,rows:3,hint:"Specific PICO-framed question(s). Number them if multiple."},
  {id:"condition",sec:"Background",label:"Condition or Domain",maxLen:200,rows:2,hint:"The disease or health topic (e.g. Type 2 diabetes mellitus). Keep brief."},
  {id:"population",sec:"Background",label:"Population",maxLen:800,rows:3,hint:"Who will be studied — age, sex, diagnostic criteria, clinical setting. 2–4 sentences."},
  {id:"intervention",sec:"Background",label:"Intervention(s)/Exposure(s)",maxLen:800,rows:3,hint:"The intervention(s) — include dose/frequency/route if relevant. 2–4 sentences."},
  {id:"comparator",sec:"Background",label:"Comparator(s)/Control",maxLen:800,rows:3,hint:"Comparison conditions (placebo, active comparator, usual care). 1–3 sentences."},
  {id:"context",sec:"Background",label:"Context",maxLen:800,rows:3,hint:"Clinical setting, geographic scope, healthcare system. 1–3 sentences."},
  {id:"primary_outcomes",sec:"Outcomes",label:"Primary Outcome(s)",maxLen:1000,rows:4,hint:"List primary outcomes with measurement method and time points. 3–5 outcomes max."},
  {id:"secondary_outcomes",sec:"Outcomes",label:"Secondary Outcome(s)",maxLen:1000,rows:4,hint:"Secondary outcomes with measurement methods and time points. 4–8 outcomes."},
  {id:"study_types",sec:"Methods",label:"Types of Study to be Included",maxLen:800,rows:3,hint:"e.g. RCTs only; include fallback if primary design data insufficient."},
  {id:"searches",sec:"Methods",label:"Searches",maxLen:2000,rows:5,hint:"Databases, date ranges, grey literature, trial registers, language limits."},
  {id:"data_extraction",sec:"Methods",label:"Data Extraction/Selection",maxLen:800,rows:3,hint:"Dual independent extraction, consensus/third reviewer for disagreements. 3–4 sentences."},
  {id:"risk_of_bias",sec:"Methods",label:"Risk of Bias Assessment",maxLen:800,rows:3,hint:"Tool (RoB 2 / ROBINS-I / NOS), who assesses, how disagreements resolved."},
  {id:"synthesis",sec:"Methods",label:"Strategy for Data Synthesis",maxLen:1000,rows:4,hint:"Model, effect measure, heterogeneity tests, software. Narrative plan if MA not feasible."},
  {id:"subgroups",sec:"Methods",label:"Subgroup or Subset Analyses",maxLen:800,rows:3,hint:"Pre-specified only. List 2–4 maximum."},
  {id:"certainty",sec:"Methods",label:"Assessment of Certainty/Confidence",maxLen:400,rows:2,hint:"State whether GRADE will be used. 1–2 sentences."},
  {id:"language",sec:"Scope",label:"Language",maxLen:200,rows:2,hint:"State any language restrictions. 1 sentence."},
  {id:"country",sec:"Scope",label:"Country",maxLen:100,rows:1,hint:"Country where the review team is based."},
  {id:"funding",sec:"Administrative",label:"Funding Sources/Sponsors",maxLen:400,rows:2,hint:"All funding sources. 'No external funding' if self-funded."},
  {id:"conflicts",sec:"Administrative",label:"Conflicts of Interest",maxLen:400,rows:2,hint:"'None declared' if no conflicts."},
];

/* ════════════ GRADE domains ════════════ */
export const GRADE_DOMAINS=[
  {id:"rob",label:"Risk of Bias",hint:"Are most studies at low risk?"},
  {id:"inconsistency",label:"Inconsistency",hint:"Are results consistent (low I²)?"},
  {id:"indirectness",label:"Indirectness",hint:"Do studies match the PICO well?"},
  {id:"imprecision",label:"Imprecision",hint:"Are CIs narrow enough to act on?"},
  {id:"publicationBias",label:"Publication Bias",hint:"Is funnel symmetric / Egger's p>0.05?"},
];
