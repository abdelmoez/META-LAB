/**
 * META·LAB Research Engine
 * Central re-export barrel for all pure-logic modules.
 *
 * Import everything from this file for convenience:
 *   import { runMeta, calcES, validateStudy, CONVERSIONS } from './research-engine/index.js';
 *
 * Or import from individual sub-modules when you need tree-shaking.
 */

// ── Math helpers ─────────────────────────────────────────────────────────────
export {
  Z975,
  normalCDF,
  invNorm,
  invNormAbs,
  lgamma,
  betacf,
  ibeta,
  gammp,
  chiSquareCDF,
  tCDF,
  tCrit,
} from './statistics/math-helpers.js';

// ── Meta-analysis engine ─────────────────────────────────────────────────────
export {
  runMeta,
  eggersTest,
  leaveOneOut,
  trimFill,
  influenceDiagnostics,
  subgroupAnalysis,
} from './statistics/meta-analysis.js';

// ── Effect-size calculators ──────────────────────────────────────────────────
export { calcES } from './effect-sizes/calculators.js';

// ── Conversion catalogue ─────────────────────────────────────────────────────
export { CONVERSIONS } from './conversions/catalogue.js';

// ── Validation ───────────────────────────────────────────────────────────────
export {
  validateStudy,
  analysisTypeWarnings,
  checkPoolability,
  findDuplicates,
} from './validation/study-validator.js';

// ── Reference parsers ────────────────────────────────────────────────────────
export {
  mkRecord,
  normTitle,
  parseRIS,
  parseNBIB,
  parseBibTeX,
  parseEndNoteXML,
  parseCSV,
  parseTXT,
  parseCIW,
  detectAndParse,
  dedupeRecords,
} from './import-export/parsers.js';

// ── Screening: explainable deduplication (engine for roadmap 1.1) ────────────
export {
  normalizeTitle,
  titleSimilarity,
  scorePair,
  findDuplicateGroups,
  findDuplicateGroupsScored,
} from './screening/deduplication.js';

// ── Screening: PDF↔record matching (engine for roadmap 1.4) ──────────────────
export {
  extractIdentifiersFromFilename,
  normalizeDoi,
  findDoiInText,
  classifyMatch,
  matchPdfToRecords,
  bestPdfMatch,
  AUTO_ATTACH_THRESHOLD,
  REVIEW_THRESHOLD,
} from './screening/pdfMatching.js';

// ── Screening: inter-rater agreement + reproducible sampling (roadmap 1.3) ───
export {
  cohenKappa,
  fleissKappa,
  toFleissMatrix,
  interpretKappa,
} from './screening/agreement.js';
export {
  mulberry32,
  seededPermutation,
  seededSample,
} from './screening/sampling.js';

// ── Institutions: normalization + fuzzy matching (prompt26) ──────────────────
export {
  normalizeInstitution,
  institutionKey,
  institutionSimilarity,
  classifyInstitutionMatch,
  matchInstitution,
  groupInstitutions,
  INST_AUTO_THRESHOLD,
  INST_REVIEW_THRESHOLD,
} from './institutions/institutionMatch.js';

// ── RoB: Risk-of-Bias engine (RoB 2 instrument + generic engine; rob.md) ──────
// The full instrument is re-exported as ROB2_INSTRUMENT to avoid colliding with
// the legacy ROB2 domain-list constant from project-model/constants.js above.
// Import { ROB2 } directly from './rob/index.js' when you want the instrument.
export {
  ROB2 as ROB2_INSTRUMENT,
  RESPONSES as ROB_RESPONSES,
  RESPONSE_LABELS as ROB_RESPONSE_LABELS,
  JUDGMENTS as ROB_JUDGMENTS,
  JUDGMENT_LABELS as ROB_JUDGMENT_LABELS,
  judgeDomain as robJudgeDomain,
  judgeOverall as robJudgeOverall,
  getInstrument as robGetInstrument,
  isReachable as robIsReachable,
  nextQuestions as robNextQuestions,
  proposeDomain as robProposeDomain,
  proposeAllDomains as robProposeAllDomains,
  proposeOverall as robProposeOverall,
  completeness as robCompleteness,
  summaryMatrix as robSummaryMatrix,
  // P14 — ROBINS-I instrument, guided appraisal, and weighted-κ agreement.
  ROBINSI as ROBINSI_INSTRUMENT,
  robinsJudgeDomain,
  robinsJudgeOverall,
  appraiseFromText as robAppraiseFromText,
  weightedKappa as robWeightedKappa,
  cohenKappaRob as robCohenKappa,
  robDomainAgreement,
} from './rob/index.js';

// ── Project model: factories & utilities ─────────────────────────────────────
export { uid, now, fmtDate, mkProject, mkStudy } from './project-model/defaults.js';

// ── Project model: constants ─────────────────────────────────────────────────
export {
  SOURCE_OPTIONS,
  DATA_NATURE,
  ADJUST_OPTIONS,
  EXTRACT_FLAGS,
  DATA_NATURE_LABEL,
  ADJUST_LABEL,
  FLAG_LABEL,
  SOURCE_LABEL,
  isNonPrimary,
  ES_TYPES,
  ROB2,
  NOS,
} from './project-model/constants.js';
