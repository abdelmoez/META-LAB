/**
 * defaults.js
 * Factory functions and primitive utilities for the project data model.
 * All logic copied verbatim from meta-lab-3-patched.jsx.
 */

/**
 * uid()
 * Generate a random 8-character alphanumeric identifier.
 * @returns {string}
 */
export const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * now()
 * Current time as an ISO-8601 string.
 * @returns {string}
 */
export const now = () => new Date().toISOString();

/**
 * fmtDate(iso)
 * Format an ISO date string as "Mon DD, YYYY" (e.g. "Jan 5, 2024").
 * Returns "—" for falsy input.
 * @param {string} iso
 * @returns {string}
 */
export const fmtDate = iso =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

/**
 * mkProject(name)
 * Create a new project object with default empty state.
 *
 * Shape:
 *   { id, name, created, modified,
 *     pico, search, prisma,
 *     records: [],   // imported citations for screening
 *     studies: [],
 *     robMethod: "RoB2",
 *     reportChecked: {} }
 *
 * @param {string} name  Project display name
 * @returns {object}
 */
export const mkProject = name => ({
  id:       uid(),
  name,
  created:  now(),
  modified: now(),
  pico: {
    question: "", P: "", I: "", C: "", O: "",
    studyDesign: "RCT", timeframe: "", prosperoId: "",
    keywords: "", incl: "", excl: "", notes: "",
  },
  search: {
    dbs: {
      PubMed: false, Embase: false, "Cochrane CENTRAL": false,
      "Web of Science": false, Scopus: false, CINAHL: false,
      PsycINFO: false, LILACS: false, "Google Scholar": false,
      "ClinicalTrials.gov": false, "WHO ICTRP": false, OpenAlex: false,
    },
    date: "", string: "", notes: "",
  },
  prisma: {
    dbs: "", reg: "", other: "", dedupe: "", screened: "",
    excTA: "", excFull: "",
    reasons: [{ id: uid(), r: "", n: "" }],
    included: "", qual: "", quant: "",
  },
  records:       [],   // imported citations for screening
  studies:       [],
  robMethod:     "RoB2",
  reportChecked: {},
});

/**
 * mkStudy()
 * Create a new empty study object with all fields initialised.
 *
 * Key field groups:
 *   - Citation metadata  (title, authors, journal, doi, pmid, abstract)
 *   - Descriptive metadata (country, design, dataSource, enrollPeriod, …)
 *   - Effect-size data   (esType, timepoint, adjusted, dataNature, flags)
 *   - Raw continuous     (nExp, nCtrl, meanExp, sdExp, meanCtrl, sdCtrl)
 *   - Raw dichotomous    (a, b, c, d — 2×2 table)
 *   - Raw single-arm     (events, total)
 *   - Raw diagnostic     (tp, fp, fn, tn)
 *   - Final ES + CI      (es, lo, hi — log scale for OR/RR/HR, Fisher z for COR)
 *   - Provenance         (source, converted, conversions, needsReview, …)
 *
 * @returns {object}
 */
export const mkStudy = () => ({
  id:     uid(),
  author: "", year: "", country: "", design: "RCT", n: "", outcome: "",

  // citation metadata (auto-fillable from PMID/DOI)
  title: "", authors: "", journal: "", doi: "", pmid: "", abstract: "",

  // study-level descriptive metadata
  dataSource:       "",   // e.g. registry, RCT, claims database
  enrollPeriod:     "",   // enrollment / recruitment dates
  populationDef:    "", interventionDef: "", comparatorDef: "",
  primaryOutcome:   "", secondaryOutcomes: "", funding: "",

  esType:    "",           // SMD | MD | OR | RR | HR | COR | PROP | ""
  timepoint: "",           // e.g. "12 weeks"
  followup:  "",
  adjusted:  "unadjusted", // adjustment status
  dataNature: "primary",   // methodological role of the estimate
  flags:     [],           // reliability flags

  // raw continuous
  nExp: "", nCtrl: "", meanExp: "", sdExp: "", meanCtrl: "", sdCtrl: "",

  // raw dichotomous 2×2 (a=event/exp  b=noevent/exp  c=event/ctrl  d=noevent/ctrl)
  a: "", b: "", c: "", d: "",

  // raw single-arm proportion
  events: "", total: "",

  // raw diagnostic accuracy
  tp: "", fp: "", fn: "", tn: "",

  // final effect-size + CI on analysis scale
  es: "", lo: "", hi: "",

  source:    "",           // physical location: text | table | figure | supplement | …
  converted:  false,       // true if any value was derived via a conversion
  conversions: [],         // [{id,target,type,method,reason,original,result,at}]
  needsReview: false,
  extractedBy: "", extractedAt: "",
  rob: {}, notes: "",
});
