/**
 * manuscript/model.js — 64.md (P3). Pure, dependency-free data model for the
 * manuscript authoring system. No I/O, no React, no DOM — safe to import from the
 * server, the client, and unit tests.
 *
 * Persistence: a project owns ZERO-or-more manuscript drafts stored in the
 * canonical `Project.data` blob under the NEW top-level key `manuscripts` (an
 * array). The LEGACY single-blob drafter (`Project.data.manuscript = {drafts:{…}}`,
 * gated by AI_FEATURES_ENABLED) is left untouched so the flag-OFF path keeps
 * working; when the P3 editor first opens it migrates that legacy text into the
 * first structured draft (see migrateLegacyManuscript).
 *
 * Design rules baked into this model:
 *   - Narrative sections are MARKDOWN strings (portable, diff-able, → OOXML).
 *   - Every generated section carries `aiGenerated`/`userEdited` so the UI can show
 *     "AI draft — verify" and never silently overwrite human edits.
 *   - Data-linked blocks store only metadata (hash + last-refresh + enabled); their
 *     CONTENT is always recomputed live from project data so a table can never go
 *     stale-but-look-fresh.
 */

/** Narrative, free-text (markdown) sections, in canonical manuscript order. */
export const SECTION_TYPES = [
  { id: 'title', label: 'Title', group: 'front' },
  { id: 'abstract', label: 'Abstract', group: 'front' },
  { id: 'introduction', label: 'Introduction', group: 'body' },
  { id: 'methods', label: 'Methods', group: 'body' },
  { id: 'results', label: 'Results', group: 'body' },
  { id: 'discussion', label: 'Discussion', group: 'body' },
  { id: 'limitations', label: 'Limitations', group: 'body' },
  { id: 'conclusion', label: 'Conclusions', group: 'body' },
];

export const SECTION_IDS = SECTION_TYPES.map((s) => s.id);

/** Short structured statements (single-line / short prose), separate from sections. */
export const STATEMENT_TYPES = [
  { id: 'funding', label: 'Funding' },
  { id: 'conflicts', label: 'Conflicts of interest' },
  { id: 'dataAvailability', label: 'Data availability' },
  { id: 'acknowledgments', label: 'Acknowledgments' },
  { id: 'ethics', label: 'Ethics approval' },
  { id: 'registration', label: 'Registration' },
];

export const STATEMENT_IDS = STATEMENT_TYPES.map((s) => s.id);

/** Data-linked blocks: refreshable, computed from live project data (never edited as prose). */
export const DATA_BLOCK_TYPES = [
  { id: 'study_characteristics_table', label: 'Study characteristics table' },
  { id: 'summary_of_findings_table', label: 'Summary of findings' },
  { id: 'prisma_counts_table', label: 'PRISMA counts table' },
  { id: 'prisma_flow', label: 'PRISMA 2020 flow diagram' },
  { id: 'risk_of_bias_table', label: 'Risk of bias summary' },
  { id: 'search_strategy_table', label: 'Search strategy' },
  { id: 'forest_plot', label: 'Forest plot' },
  { id: 'references', label: 'Reference list' },
];

export const DATA_BLOCK_IDS = DATA_BLOCK_TYPES.map((b) => b.id);

export const CITATION_STYLES = [
  { id: 'vancouver', label: 'Vancouver' },
  { id: 'jama', label: 'JAMA' },
  { id: 'ama', label: 'AMA' },
  { id: 'apa', label: 'APA' },
];
export const CITATION_STYLE_IDS = CITATION_STYLES.map((s) => s.id);

/**
 * Journal templates. These are formatting AIDS — they steer abstract format,
 * default citation style, and which statements/checklists are emphasised. They do
 * NOT guarantee compliance (the UI shows a warning to that effect).
 */
export const JOURNAL_TEMPLATES = [
  {
    id: 'generic',
    label: 'Generic biomedical journal',
    abstractFormat: 'structured', // Background/Methods/Results/Conclusions
    citationStyle: 'vancouver',
    requiredStatements: ['funding', 'conflicts', 'dataAvailability', 'registration'],
    note: 'A neutral PRISMA-2020-aligned layout suitable for most biomedical journals.',
  },
  {
    id: 'jama',
    label: 'JAMA-style',
    abstractFormat: 'jama',
    citationStyle: 'jama',
    // abstractWordLimit is a formatting AID (65.md MS-5) — verify against the
    // journal's current author instructions; it is NOT persisted per draft.
    abstractWordLimit: 350,
    requiredStatements: ['funding', 'conflicts', 'dataAvailability', 'acknowledgments', 'registration'],
    note: 'Structured Importance/Objective/Data Sources… abstract and JAMA reference style.',
  },
  {
    id: 'bmj',
    label: 'BMJ-style',
    abstractFormat: 'structured',
    citationStyle: 'vancouver',
    abstractWordLimit: 400,
    requiredStatements: ['funding', 'conflicts', 'dataAvailability', 'ethics', 'registration'],
    note: 'BMJ-aligned structured abstract with explicit "what this study adds".',
  },
  {
    id: 'lancet',
    label: 'Lancet-style',
    abstractFormat: 'lancet',
    citationStyle: 'vancouver',
    abstractWordLimit: 300,
    requiredStatements: ['funding', 'conflicts', 'dataAvailability', 'registration'],
    note: 'Lancet-aligned Background/Methods/Findings/Interpretation/Funding abstract.',
  },
  {
    id: 'cochrane',
    label: 'Cochrane-style review',
    abstractFormat: 'structured',
    citationStyle: 'vancouver',
    abstractWordLimit: 700,
    requiredStatements: ['funding', 'conflicts', 'dataAvailability', 'registration'],
    note: 'Plain-language-summary friendly, certainty-of-evidence (GRADE) forward.',
  },
];
export const JOURNAL_TEMPLATE_IDS = JOURNAL_TEMPLATES.map((t) => t.id);

export const SCHEMA_VERSION = 2;

let _seq = 0;
/** Deterministic-enough id (no Date/Math.random dependency for reproducibility of tests when seeded). */
export function manuscriptUid(prefix = 'ms') {
  _seq += 1;
  // Combine a monotonically increasing counter with a cheap string hash of it so
  // ids look opaque but are stable within a process run. Callers that need global
  // uniqueness across reloads should pass their own id.
  return `${prefix}_${(_seq).toString(36)}${Math.abs(hashCode(String(_seq))).toString(36)}`;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * Create an empty structured manuscript draft.
 * @param {object} opts { id?, title?, templateId?, citationStyle?, nowIso? }
 */
export function makeManuscriptDraft(opts = {}) {
  const o = opts || {};
  const nowIso = o.nowIso || null;
  const templateId = JOURNAL_TEMPLATE_IDS.includes(o.templateId) ? o.templateId : 'generic';
  const tpl = JOURNAL_TEMPLATES.find((t) => t.id === templateId) || JOURNAL_TEMPLATES[0];
  const citationStyle = CITATION_STYLE_IDS.includes(o.citationStyle) ? o.citationStyle : tpl.citationStyle;

  // Optional per-section provenance fields (73.md Part 8) — {sources:[{key,label}],
  // missing:[{field,hint}], inputsHash:string, locked:boolean} — are ADDITIVE and
  // intentionally NOT initialized here (absent ≠ empty; normalizeDraft preserves
  // them when present, and old blobs stay byte-identical).
  const sections = {};
  for (const s of SECTION_TYPES) {
    sections[s.id] = {
      content: '',
      aiGenerated: false,
      userEdited: false,
      lastGeneratedAt: null,
      updatedAt: nowIso,
    };
  }
  const statements = {};
  for (const st of STATEMENT_TYPES) statements[st.id] = '';

  const dataBlocks = {};
  for (const b of DATA_BLOCK_TYPES) {
    dataBlocks[b.id] = { enabled: true, sourceHash: null, lastRefreshedAt: null, stale: true };
  }

  return {
    id: o.id || manuscriptUid('draft'),
    schemaVersion: SCHEMA_VERSION,
    title: o.title || '',
    runningTitle: '',
    keywords: [],
    templateId,
    citationStyle,
    status: 'draft', // draft | reviewing | ready
    authorship: { authors: [], affiliations: [], correspondingNote: '' },
    sections,
    statements,
    references: [],
    dataBlocks,
    prismaOverrides: {}, // { dbs, reg, other, dedupe, screened, excTA, ftRet, excFull, included, quant }
    prismaOverrideNote: '',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Normalize an arbitrary stored draft into the current shape (fills missing keys,
 * never drops unknown ones). Pure.
 */
export function normalizeDraft(raw, nowIso = null) {
  const base = makeManuscriptDraft({ nowIso });
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base, ...raw };
  out.schemaVersion = SCHEMA_VERSION;
  out.templateId = JOURNAL_TEMPLATE_IDS.includes(raw.templateId) ? raw.templateId : base.templateId;
  out.citationStyle = CITATION_STYLE_IDS.includes(raw.citationStyle) ? raw.citationStyle : base.citationStyle;
  out.status = ['draft', 'reviewing', 'ready'].includes(raw.status) ? raw.status : 'draft';
  // sections — the base shape stays schemaVersion 2; the 73.md Part 8 provenance
  // fields ({sources, missing, inputsHash, locked}) are OPTIONAL and additive:
  // they are preserved when a stored blob has them and simply absent otherwise,
  // so old blobs normalize byte-identically and never need a migration.
  out.sections = {};
  for (const s of SECTION_TYPES) {
    const r = (raw.sections && raw.sections[s.id]) || {};
    out.sections[s.id] = {
      content: typeof r.content === 'string' ? r.content : '',
      aiGenerated: !!r.aiGenerated,
      userEdited: !!r.userEdited,
      lastGeneratedAt: r.lastGeneratedAt || null,
      updatedAt: r.updatedAt || null,
    };
    if (Array.isArray(r.sources)) out.sections[s.id].sources = r.sources;
    if (Array.isArray(r.missing)) out.sections[s.id].missing = r.missing;
    if (typeof r.inputsHash === 'string' && r.inputsHash) out.sections[s.id].inputsHash = r.inputsHash;
    if (r.locked === true) out.sections[s.id].locked = true;
  }
  // statements
  out.statements = {};
  for (const st of STATEMENT_TYPES) {
    out.statements[st.id] = (raw.statements && typeof raw.statements[st.id] === 'string')
      ? raw.statements[st.id] : '';
  }
  // dataBlocks
  out.dataBlocks = {};
  for (const b of DATA_BLOCK_TYPES) {
    const r = (raw.dataBlocks && raw.dataBlocks[b.id]) || {};
    out.dataBlocks[b.id] = {
      enabled: r.enabled !== false,
      sourceHash: r.sourceHash || null,
      lastRefreshedAt: r.lastRefreshedAt || null,
      stale: r.stale !== false,
    };
  }
  out.references = Array.isArray(raw.references) ? raw.references : [];
  out.keywords = Array.isArray(raw.keywords) ? raw.keywords : [];
  out.prismaOverrides = (raw.prismaOverrides && typeof raw.prismaOverrides === 'object') ? raw.prismaOverrides : {};
  out.authorship = {
    authors: Array.isArray(raw.authorship?.authors) ? raw.authorship.authors : [],
    affiliations: Array.isArray(raw.authorship?.affiliations) ? raw.authorship.affiliations : [],
    correspondingNote: raw.authorship?.correspondingNote || '',
  };
  return out;
}

/**
 * Read the manuscripts array off a project blob, normalizing each draft.
 * Returns [] when none. Pure.
 */
export function readManuscripts(project) {
  const arr = project && Array.isArray(project.manuscripts) ? project.manuscripts : [];
  return arr.map((d) => normalizeDraft(d));
}

/**
 * Migrate the LEGACY single-blob drafter content into a fresh structured draft.
 * Legacy shape: project.manuscript = { drafts:{methods,results,discussion,abstract}, generatedAt }.
 * Returns a new draft seeded with any legacy text (each seeded section flagged
 * aiGenerated:false, userEdited:true so it is treated as human content and never
 * auto-clobbered). Pure.
 */
export function migrateLegacyManuscript(project, opts = {}) {
  const draft = makeManuscriptDraft({ nowIso: opts.nowIso, title: project?.name || '' });
  const legacy = project && project.manuscript && project.manuscript.drafts;
  if (legacy && typeof legacy === 'object') {
    for (const key of ['abstract', 'methods', 'results', 'discussion']) {
      const txt = legacy[key];
      if (typeof txt === 'string' && txt.trim()) {
        draft.sections[key] = {
          content: txt,
          aiGenerated: false,
          userEdited: true,
          lastGeneratedAt: null,
          updatedAt: opts.nowIso || null,
        };
      }
    }
  }
  return draft;
}

/** Section status for the outline/readiness UI. Pure. */
export function sectionStatus(section) {
  if (!section || !String(section.content || '').trim()) return 'empty';
  if (section.userEdited) return 'edited';
  if (section.aiGenerated) return 'ai-draft';
  return 'edited';
}

export default {
  SECTION_TYPES,
  SECTION_IDS,
  STATEMENT_TYPES,
  DATA_BLOCK_TYPES,
  CITATION_STYLES,
  JOURNAL_TEMPLATES,
  SCHEMA_VERSION,
  makeManuscriptDraft,
  normalizeDraft,
  readManuscripts,
  migrateLegacyManuscript,
  sectionStatus,
};
