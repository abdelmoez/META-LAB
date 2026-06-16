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
