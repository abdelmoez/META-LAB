/**
 * engine-registry/engines.js — the canonical CATALOG of PecanRev's independently
 * versioned engines + their file OWNERSHIP map. Single source of truth for which
 * engines exist and where their code lives.
 *
 * Dependency-free. Consumed by ownership.js / classify.js, the bump CLI, and the
 * DB seeder.
 *
 * Path classification PRECEDENCE (see ownership.js / classify.js):
 *   1. NO_BUMP_GLOBS   — checked FIRST; matched paths are ignored (never bump).
 *   2. engine OWNERSHIP — matched paths are bump candidates for that engine.
 *   3. SHARED_INFRA_GLOBS — matched paths are "shared" (no engine auto-bump).
 *   4. otherwise        — UNOWNED (ambiguous → warning).
 *
 * NOTE: `src/shared/**` lives in SHARED_INFRA, but `src/shared/betaWaitlist.js`
 * and `src/shared/countries.js` live in NO_BUMP. Because NO_BUMP is checked
 * FIRST, those two correctly resolve to no-bump even though the broader
 * `src/shared/**` would otherwise bucket them as shared.
 */

/** Every engine starts life at v0.1. */
export const INITIAL_VERSION = { major: 0, minor: 1 };

/**
 * The 11 independently-maintained engines. Each entry:
 *   { id, displayName, description, status, ownership }
 * where status ∈ {'active','beta','experimental'} and ownership is an array of
 * repo-relative, forward-slash glob strings.
 */
export const ENGINES = [
  {
    id: 'screening',
    displayName: 'Screening',
    description:
      'Title/abstract & full-text screening workspace: projects, members, record import, decisions, chat, presence.',
    status: 'active',
    ownership: [
      'server/controllers/screening*.js',
      'server/routes/screening.js',
      'server/screening/**',
      'src/frontend/screening/**',
      'src/frontend/workspace/tabs/screeningTabs.jsx',
    ],
  },
  {
    id: 'screening-ai',
    displayName: 'Screening Intelligence',
    description:
      'Deterministic TF-IDF + active-learning relevance scoring that ranks (never decides) screening records.',
    status: 'beta',
    ownership: [
      'server/controllers/screeningAi*.js',
      'server/services/screeningAiService.js',
      'server/services/screeningAiJobs.js',
      'src/frontend/screening/ai/**',
      'src/research-engine/screening/ai/**',
    ],
  },
  {
    id: 'search-builder',
    displayName: 'Search Builder',
    description:
      'PICO→Boolean concept builder with MeSH (NLM) lookup and live database hit counts.',
    status: 'beta',
    ownership: [
      'server/searchEngine/**',
      'server/routes/searchEngine.js',
      'src/features/searchBuilder/**',
    ],
  },
  {
    id: 'pecan-search',
    displayName: 'Pecan Search',
    description:
      'Automated multi-database Boolean literature search with a durable background job runner.',
    status: 'beta',
    ownership: [
      'server/pecanSearch/**',
      'server/routes/pecanSearch.js',
      'src/features/pecanSearch/**',
    ],
  },
  {
    id: 'meta-analysis',
    displayName: 'Meta-Analysis',
    description:
      'Pairwise statistical pooling: fixed/random effects, heterogeneity, sensitivity, publication bias, subgroups.',
    status: 'active',
    ownership: [
      'src/research-engine/statistics/meta-analysis.js',
      'server/controllers/metaController.js',
      'server/routes/meta.js',
    ],
  },
  {
    id: 'network-meta-analysis',
    displayName: 'Network Meta-Analysis',
    description:
      'Frequentist NMA: network geometry, league table, P-scores, node-splitting, contribution matrix.',
    status: 'beta',
    ownership: [
      'src/research-engine/statistics/nma/**',
      'server/controllers/nmaController.js',
      'server/routes/nma.js',
      'src/frontend/workspace/tabs/nmaTab.jsx',
    ],
  },
  {
    id: 'risk-of-bias',
    displayName: 'Risk of Bias',
    description:
      'Instrument-driven RoB 2 assessment, study universe, finalization, and GRADE sync.',
    status: 'active',
    ownership: [
      'src/research-engine/rob/**',
      'server/controllers/robController.js',
      'server/controllers/robAdminController.js',
      'server/rob/**',
      'server/routes/rob.js',
      'src/frontend/rob/**',
      'src/frontend/workspace/tabs/robTabs.jsx',
    ],
  },
  {
    id: 'protocol-pico',
    displayName: 'Protocol & PICO',
    description:
      'PICO framework and Plan & Protocol authoring with server-backed per-module state.',
    status: 'active',
    ownership: [
      'src/features/protocol/**',
      'src/features/planProtocol/**',
      'server/controllers/workflowStateController.js',
      'src/frontend/workspace/tabs/protocolTabs.jsx',
    ],
  },
  {
    id: 'data-extraction',
    displayName: 'Data Extraction',
    description:
      'Tabular capture of study characteristics and effect sizes with custom fields.',
    status: 'active',
    ownership: [
      'server/controllers/recordsController.js',
      'server/controllers/studiesController.js',
      'server/routes/studies.js',
      'server/routes/records.js',
      'src/research-engine/effect-sizes/**',
      'src/frontend/workspace/tabs/extractionTabs.jsx',
    ],
  },
  {
    id: 'import-export',
    displayName: 'Import / Export',
    description:
      'Reference import (RIS/BibTeX/NBIB/EndNote), deduplication, and research-ready exports (PRISMA, journal ZIP).',
    status: 'active',
    ownership: [
      'src/research-engine/import-export/**',
      'server/controllers/importExportController.js',
      'server/routes/importExport.js',
    ],
  },
  {
    id: 'validation',
    displayName: 'Validation & Poolability',
    description:
      'Cross-study QC, poolability gating, analysis-type warnings, and unit conversions.',
    status: 'active',
    ownership: [
      'src/research-engine/validation/**',
      'src/research-engine/conversions/**',
      'server/controllers/validationController.js',
      'server/routes/validation.js',
    ],
  },
  {
    id: 'manuscript',
    displayName: 'Manuscript',
    description:
      'P3 manuscript authoring: structured IMRAD draft generation, data-linked tables (study characteristics / summary-of-findings / PRISMA / RoB / search), citation engine (Vancouver/JAMA/BibTeX/RIS), inline PRISMA 2020 diagram, one-click .docx export, PRISMA & PRISMA-S checklists, and a reproducibility .zip bundle.',
    status: 'beta',
    ownership: [
      'src/research-engine/manuscript/**',
      'src/features/manuscript/**',
    ],
  },
];

/** Ordered list of engine ids. */
export const ENGINE_IDS = ENGINES.map((e) => e.id);

/** id → engine object lookup. */
export const ENGINE_BY_ID = Object.fromEntries(ENGINES.map((e) => [e.id, e]));

/** True iff `id` is a known engine id. */
export function isEngineId(id) {
  return Object.prototype.hasOwnProperty.call(ENGINE_BY_ID, id);
}

/**
 * Paths owned by NO single engine. Changes here are infrastructure shared across
 * engines — they must NOT auto-bump any one engine (bucketed as "shared").
 */
export const SHARED_INFRA_GLOBS = [
  'server/index.js',
  'server/version.js',
  'server/version.json',
  'server/db/**',
  'server/middleware/**',
  'server/auth/**',
  'server/config/**',
  'server/security/**',
  'server/utils/**',
  'server/realtime/**',
  'server/storage/**',
  'server/models/**',
  'server/schemas/**',
  'server/controllers/projectsController.js',
  'server/controllers/settingsController.js',
  'server/controllers/adminController.js',
  'src/frontend/api-client/**',
  'src/frontend/context/**',
  'src/frontend/hooks/**',
  'src/frontend/components/**',
  'src/frontend/design/**',
  'src/frontend/stitch/**',
  'src/frontend/theme/**',
  'src/frontend/pages/**',
  'src/frontend/workspace/ui/**',
  'src/frontend/workspace/charts/**',
  'src/research-engine/statistics/math-helpers.js',
  'src/research-engine/project-model/**',
  'src/shared/**',
  'server/prisma/schema.prisma',
  'server/prisma/postgres/schema.prisma',
  'server/routes/admin.js',
  'server/routes/index.js',
];

/**
 * Paths that should NEVER bump an engine: docs, tests, CI/build config, repo
 * metadata, the waitlist + landing page, and the engine-version system itself.
 * Checked FIRST (highest precedence).
 */
export const NO_BUMP_GLOBS = [
  '*.md',        // root-level docs (README.md, CLAUDE.md) — '**/*.md' alone requires a dir
  '**/*.md',
  'LICENSE',
  'docs/**',
  '.claude/**',
  '.github/**',
  'tests/**',
  'e2e/**',
  '*.config.js',
  '*.config.ts',
  '*.config.mjs',
  'vitest.config.js',
  'playwright.config.ts',
  '.gitignore',
  '.env',
  '.env.example',
  'package.json',
  'package-lock.json',
  'Design/**',
  'template/**',
  '*.xlsx',
  '*.docx',
  '**/*.xlsx',
  '**/*.docx',
  'scripts/engine-version.mjs',
  'src/research-engine/engine-registry/**',
  'server/engineVersion/**',
  'server/controllers/engineVersionController.js',
  'server/scripts/seed-engine-registry.js',
  'server/waitlist/**',
  'server/controllers/waitlist*.js',
  'server/routes/waitlist.js',
  'server/prisma/waitlist/**',
  'server/prisma/postgres/waitlist-schema.prisma',
  'src/frontend/pages/waitlist/**',
  'src/frontend/components/BetaWaitlistGate.jsx',
  'src/shared/betaWaitlist.js',
  'src/shared/countries.js',
];
