/**
 * manuscript/factTokens.js — 101.md §5/§8/§9. The sentence-level answer to the
 * hardest requirement in the brief: keep the manuscript's FACTS live without ever
 * rewriting the researcher's PROSE.
 *
 * A generated sentence embeds a stable token where a project-derived fact belongs:
 *
 *     "We searched [[fact:search.databases]] from inception to [[fact:search.date]]."
 *
 * The token — not the resolved text — is what gets persisted in the section
 * markdown. Its VALUE is resolved at render time from live project data, exactly
 * like the `[[cite:…]]` and `[[table:…]]` chips that already exist
 * (refTokens.js / citations.js / richEditor/mdDom.js). Three properties fall out
 * of that for free, and they are the whole point:
 *
 *   §4  No refresh button. A fact changes because the project changed; nothing
 *       needs to be regenerated, re-saved, or accepted.
 *   §5  Human prose is untouchable BY CONSTRUCTION. The sync path can only ever
 *       change the inside of a token; a sentence a researcher wrote around it
 *       cannot be clobbered because nothing rewrites section text at all.
 *   §16 Transactional consistency is free. Every token in the manuscript resolves
 *       from ONE project snapshot, so Results, PRISMA and the Abstract can never
 *       disagree about how many studies there are.
 *
 * §17 (never fabricate) is enforced here rather than trusted: a fact that the
 * project cannot answer resolves to `missing`, and renders as a visible bracketed
 * placeholder. There is no path by which an unknown fact becomes a confident
 * sentence.
 *
 * Every fact declares the `depKey` it derives from — the SAME keys the manuscript
 * dependency graph already uses (dependencies.js DEPENDENCY_KEYS) — so an event's
 * dependency keys map to the exact tokens it can change, with no second registry
 * to drift (this is the §40 "extend, don't duplicate" rule).
 *
 * Pure — no DOM/React/network/Date.now(). Deterministic for identical inputs.
 */

import { DEPENDENCY_KEYS } from './dependencies.js';
import { computePrismaCounts } from './prismaCounts.js';
import { resolveAnalysis, describeSynthesisModel } from './analysisDescribe.js';
import { deriveSearchMethodology } from '../search/searchMethodology.js';

/** `[[fact:search.date]]` — keys are dot-separated identifiers only. */
export const FACT_TOKEN_RE = /\[\[fact:([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)\]\]/g;

/** Build the stable token for a fact key. Pure. */
export function factToken(key) {
  return `[[fact:${String(key == null ? '' : key).replace(/[[\]\s]/g, '')}]]`;
}

/**
 * Originating engines (101.md §7). These drive the Show-Changes colour system and
 * the "Updated by:" line on the provenance card, so the ids are a stable API.
 */
export const FACT_ENGINES = Object.freeze({
  search: { label: 'Search Engine', short: 'Search' },
  screening: { label: 'Screening Engine', short: 'Screening' },
  prisma: { label: 'PRISMA flow', short: 'PRISMA' },
  extraction: { label: 'Extraction Engine', short: 'Extraction' },
  rob: { label: 'Risk of Bias', short: 'RoB' },
  analysis: { label: 'Analysis Engine', short: 'Analysis' },
  protocol: { label: 'Protocol', short: 'Protocol' },
});

export const FACT_ENGINE_IDS = Object.keys(FACT_ENGINES);

/* ════════════ deterministic formatting helpers ════════════ */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Format an ISO timestamp as "August 6, 2026" (the style 101.md §2/§8 uses).
 * UTC-based on purpose: a search date must not shift because a co-author opened
 * the manuscript in another timezone. Returns '' for anything unparseable.
 * Pure.
 */
export function formatFactDate(iso) {
  const s = String(iso == null ? '' : iso);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return '';
  return `${MONTHS[mo - 1]} ${d}, ${y}`;
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Small integers as words ("four"), larger ones as numerals. Pure. */
export function numberWord(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) return '';
  return v < NUMBER_WORDS.length ? NUMBER_WORDS[v] : String(v);
}

/** Grammatical list join: [a,b] → "a and b", [a,b,c] → "a, b, and c". Pure. */
export function joinList(items) {
  const xs = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!xs.length) return '';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
}

/**
 * Numeric facts. `null`/`undefined`/'' MUST stay null — `Number(null)` is 0, and
 * rendering an unknown PRISMA count as "0" would be exactly the kind of confident
 * fabrication §17 forbids.
 */
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
};

/* ════════════ the fact registry ════════════ */

/**
 * Each entry:
 *   label     human name, shown as "Affected manuscript field" on the hover card (§9)
 *   engine    FACT_ENGINE_IDS — who owns this fact (§7 colour + "Updated by")
 *   depKey    the DEPENDENCY_KEYS slice it derives from (drives invalidation)
 *   hint      what the researcher should do when it is missing (never fabricated)
 *   resolve   (ctx) => string | null   — null means "the project does not know"
 *
 * `ctx` is built once by buildFactContext() so every fact in one render sees the
 * SAME project snapshot (§16).
 */
export const FACTS = Object.freeze({
  /* ── Search (101.md §1/§2) ─────────────────────────────────────────────── */
  'search.databases': {
    label: 'Databases searched',
    engine: 'search',
    depKey: 'search.databases',
    hint: 'Run or import at least one database search.',
    resolve: (c) => (c.search.databases.length ? joinList(c.search.databases) : null),
  },
  'search.databaseCount': {
    label: 'Number of databases searched',
    engine: 'search',
    depKey: 'search.databases',
    hint: 'Run or import at least one database search.',
    resolve: (c) => (c.search.databases.length ? String(c.search.databases.length) : null),
  },
  'search.databaseCountWord': {
    label: 'Number of databases searched (in words)',
    engine: 'search',
    depKey: 'search.databases',
    hint: 'Run or import at least one database search.',
    resolve: (c) => (c.search.databases.length ? numberWord(c.search.databases.length) : null),
  },
  'search.registers': {
    label: 'Trial registers searched',
    engine: 'search',
    depKey: 'search.databases',
    hint: 'Search a trial register (e.g. ClinicalTrials.gov) if your protocol requires one.',
    resolve: (c) => (c.search.registers.length ? joinList(c.search.registers) : null),
  },
  'search.date': {
    label: 'Date of the most recent search',
    engine: 'search',
    depKey: 'search.date',
    hint: 'Execute a search — the date is taken from the search record, not typed in.',
    resolve: (c) => (c.search.latestSearchAt ? formatFactDate(c.search.latestSearchAt) : null),
  },
  'search.dateRange': {
    label: 'Search coverage period',
    engine: 'search',
    depKey: 'search.date',
    hint: 'Execute a search — the date is taken from the search record, not typed in.',
    resolve: (c) => {
      const d = c.search.latestSearchAt ? formatFactDate(c.search.latestSearchAt) : '';
      return d ? `from inception to ${d}` : null;
    },
  },
  /* 104.md — the richer search metadata the Manuscript Editor should have
     STRUCTURED access to. Deliberately available as tokens rather than injected
     everywhere: the abstract stays concise, and a Methods or supplementary section
     can name the update history where it is methodologically relevant. */
  'search.firstDate': {
    label: 'Date of the first search',
    engine: 'search',
    depKey: 'search.date',
    hint: 'Execute a search — the date is taken from the search record, not typed in.',
    resolve: (c) => (c.search.firstSearchAt ? formatFactDate(c.search.firstSearchAt) : null),
  },
  'search.updateCount': {
    label: 'Number of search updates',
    engine: 'search',
    depKey: 'search.date',
    hint: 'Re-run the search to record an update (Living Review searches count).',
    // 0 updates is a real, reportable answer — an unrepeated search — so this
    // resolves whenever ANY search exists, unlike counts where 0 means "unknown".
    resolve: (c) => (c.search.latestSearchAt ? String(c.search.updateCount) : null),
  },
  'search.sources': {
    label: 'All information sources searched',
    engine: 'search',
    depKey: 'search.databases',
    hint: 'Run or import at least one database search.',
    // Databases AND registers together — for sections that report "information
    // sources" as PRISMA item 6 does, rather than splitting the two clauses.
    resolve: (c) => (c.search.all.length ? joinList(c.search.all) : null),
  },
  'search.otherMethods': {
    label: 'Other methods used to identify studies',
    engine: 'search',
    depKey: 'search.databases',
    hint: 'Record citation searching or hand searching in the Search engine.',
    resolve: (c) => (c.search.otherMethods.length ? joinList(c.search.otherMethods) : null),
  },

  /* ── PRISMA flow (§3 downstream propagation) ───────────────────────────── */
  'prisma.identified': {
    label: 'Records identified',
    engine: 'prisma',
    depKey: 'prisma.counts',
    hint: 'Import search results into screening.',
    resolve: (c) => num(c.prisma.identified),
  },
  'prisma.duplicatesRemoved': {
    label: 'Duplicates removed',
    engine: 'prisma',
    depKey: 'prisma.counts',
    hint: 'Run deduplication.',
    resolve: (c) => num(c.prisma.duplicatesRemoved),
  },
  'prisma.screened': {
    label: 'Records screened',
    engine: 'screening',
    depKey: 'prisma.counts',
    hint: 'Screen records on title/abstract.',
    resolve: (c) => num(c.prisma.screened),
  },
  'prisma.excludedTitleAbstract': {
    label: 'Records excluded at title/abstract',
    engine: 'screening',
    depKey: 'prisma.counts',
    hint: 'Record title/abstract screening decisions.',
    resolve: (c) => num(c.prisma.excludedScreen),
  },
  'prisma.reportsAssessed': {
    label: 'Reports assessed for eligibility',
    engine: 'screening',
    depKey: 'prisma.counts',
    hint: 'Assess full texts for eligibility.',
    resolve: (c) => num(c.prisma.reportsAssessed),
  },
  'prisma.reportsExcluded': {
    label: 'Reports excluded at full text',
    engine: 'screening',
    depKey: 'prisma.counts',
    hint: 'Record full-text exclusion decisions.',
    resolve: (c) => num(c.prisma.reportsExcluded),
  },
  'prisma.included': {
    label: 'Studies included in the review',
    engine: 'screening',
    depKey: 'prisma.counts',
    hint: 'Include at least one study.',
    resolve: (c) => num(c.prisma.included),
  },

  /* ── Included studies (§15) ────────────────────────────────────────────── */
  'studies.included': {
    label: 'Number of included studies',
    engine: 'screening',
    depKey: 'studies.roster',
    hint: 'Include at least one study.',
    resolve: (c) => (c.studies.total > 0 ? String(c.studies.total) : null),
  },
  'studies.inAnalysis': {
    label: 'Studies contributing to the synthesis',
    engine: 'extraction',
    depKey: 'studies.values',
    hint: 'Extract an effect estimate for at least one study.',
    resolve: (c) => (c.studies.withEffect > 0 ? String(c.studies.withEffect) : null),
  },

  /* ── Analysis (§15 "model changes from fixed-effect to random-effects") ── */
  'analysis.model': {
    label: 'Synthesis model',
    engine: 'analysis',
    depKey: 'analysis.model',
    hint: 'Choose a synthesis model in the Analysis tab.',
    resolve: (c) => c.analysis.modelText || null,
  },
  'analysis.tau2': {
    label: 'Heterogeneity estimator',
    engine: 'analysis',
    depKey: 'analysis.tau2',
    hint: 'Choose a between-study variance estimator.',
    resolve: (c) => c.analysis.tau2Text || null,
  },
  'analysis.measure': {
    label: 'Effect measure',
    engine: 'analysis',
    depKey: 'analysis.model',
    hint: 'Extract effect estimates so the measure can be determined.',
    resolve: (c) => c.analysis.measureLabel || null,
  },
  'analysis.k': {
    label: 'Studies pooled in the primary analysis',
    engine: 'analysis',
    depKey: 'analysis.model',
    hint: 'At least two studies with effect estimates are needed to pool.',
    resolve: (c) => (c.analysis.k > 0 ? String(c.analysis.k) : null),
  },
  'analysis.pooledEffect': {
    label: 'Pooled effect estimate',
    engine: 'analysis',
    depKey: 'analysis.model',
    hint: 'At least two studies with effect estimates are needed to pool.',
    resolve: (c) => c.analysis.pooledText || null,
  },
  'analysis.heterogeneity': {
    label: 'Heterogeneity (I²)',
    engine: 'analysis',
    depKey: 'analysis.model',
    hint: 'At least two studies with effect estimates are needed to pool.',
    resolve: (c) => c.analysis.heterogeneityText || null,
  },

  /* ── Risk of bias (§27 — names only the tools actually used) ───────────── */
  'rob.tools': {
    label: 'Risk-of-bias / quality-assessment tools used',
    engine: 'rob',
    depKey: 'rob.method',
    hint: 'Complete at least one risk-of-bias assessment.',
    resolve: (c) => c.rob.toolsText || null,
  },
  'rob.assessed': {
    label: 'Studies with a completed risk-of-bias assessment',
    engine: 'rob',
    depKey: 'rob.judgments',
    hint: 'Complete at least one risk-of-bias assessment.',
    resolve: (c) => (c.rob.assessedCount > 0 ? String(c.rob.assessedCount) : null),
  },

  /* ── Protocol ──────────────────────────────────────────────────────────── */
  'protocol.registration': {
    label: 'Protocol registration',
    engine: 'protocol',
    depKey: 'pico.registration',
    hint: 'Add the PROSPERO (or other) registration number in Protocol.',
    resolve: (c) => c.protocol.registration || null,
  },
});

export const FACT_KEYS = Object.keys(FACTS);

/** Registry metadata for a key (or null for an unknown/legacy token). Pure. */
export function factMeta(key) {
  return Object.prototype.hasOwnProperty.call(FACTS, key) ? FACTS[key] : null;
}

/** Every fact key that a dependency key can change. Pure. */
export function factsForDependencyKey(depKey) {
  return FACT_KEYS.filter((k) => FACTS[k].depKey === depKey);
}

/** Every fact key owned by an engine (drives the §7 colour legend). Pure. */
export function factsForEngine(engine) {
  return FACT_KEYS.filter((k) => FACTS[k].engine === engine);
}

/* ════════════ context assembly ════════════ */

const clean = (s) => String(s == null ? '' : s).trim();

/**
 * buildFactContext(project, opts) — resolve every project slice ONCE so all facts
 * in a render share one snapshot (§16). Reuses the engine's existing derivations
 * (computePrismaCounts / resolveAnalysis) rather than recomputing them differently.
 *
 * @param {object} project Project.data blob
 * @param {object} [opts]  the generateDraft opts bundle, plus:
 *   searchProvenance  deriveSearchProvenance() output (101.md §1/§2). When absent,
 *                     every search fact resolves MISSING — deliberately: without
 *                     execution provenance we must not name databases (§17).
 *   robUsage          { tools:[{id,label,count}], assessedCount } actual RoB usage (§27)
 *   primary           precomputed primaryAnalysis() result (perf seam)
 * @returns {object} the ctx consumed by FACTS[*].resolve
 */
export function buildFactContext(project, opts = {}) {
  const p = project || {};
  const pico = p.pico || {};
  const studies = Array.isArray(p.studies) ? p.studies : [];
  const pc = opts.prismaCounts || computePrismaCounts(p, opts);
  const counts = (pc && pc.counts) || {};
  const analysisCfg = resolveAnalysis(p, opts);

  // ── search: execution provenance ONLY (never project.search.dbs) ──────────
  // 104.md — the database/register split and the date rules now come from the ONE
  // canonical Search Methodology derivation, so the Abstract, the Methods narration
  // and the PRISMA-S strategy table cannot word the same fact differently. The
  // caller may pass a pre-derived methodology (the hook derives it once per render);
  // otherwise it is derived here from the same provenance input.
  const search = opts.searchMethodology
    || deriveSearchMethodology(opts.searchProvenance || null, {
      otherMethods: opts.otherSearchMethods || [],
    });

  // ── analysis ──────────────────────────────────────────────────────────────
  // describeSynthesisModel returns the canonical DESCRIPTOR object (short / label /
  // methodsPhrase / estimatorLabel) — the same one the Methods narration uses, so a
  // fact token and the surrounding prose can never name the model differently.
  const primary = opts.primary || null;
  const result = primary && primary.result;
  const desc = describeSynthesisModel(analysisCfg);
  const a = {
    modelText: clean(desc.short),
    tau2Text: clean(desc.estimatorLabel),
    measureLabel: clean(opts.measureLabel || (primary && primary.measureLabel)),
    k: result && Number.isFinite(Number(result.k)) ? Number(result.k) : 0,
    pooledText: clean(opts.pooledText),
    heterogeneityText: clean(opts.heterogeneityText),
  };

  const robUsage = opts.robUsage || null;
  const toolLabels = robUsage && Array.isArray(robUsage.tools)
    ? robUsage.tools.filter((t) => t && t.count > 0).map((t) => clean(t.label)).filter(Boolean)
    : [];

  return {
    search,
    prisma: {
      identified: counts.identified,
      // `duplicatesRemoved` is the reportable figure; `dedupe` is its arithmetic
      // twin used for derivation. Prefer the former, fall back to the latter.
      duplicatesRemoved: counts.duplicatesRemoved != null ? counts.duplicatesRemoved : counts.dedupe,
      screened: counts.screened,
      excludedScreen: counts.excludedScreen,
      reportsAssessed: counts.reportsAssessed,
      reportsExcluded: counts.reportsExcluded,
      included: counts.included,
    },
    studies: {
      total: studies.length,
      withEffect: studies.filter((s) => s && Number.isFinite(Number(s.es))).length,
    },
    analysis: a,
    rob: {
      toolsText: toolLabels.length ? joinList(toolLabels) : '',
      assessedCount: robUsage && Number.isFinite(Number(robUsage.assessedCount))
        ? Number(robUsage.assessedCount) : 0,
    },
    protocol: { registration: clean(pico.prosperoId) },
  };
}

/* ════════════ resolution ════════════ */

/**
 * The visible stand-in for a fact the project cannot answer. Deliberately looks
 * like the bracketed placeholders draft.js already emits, so an unfinished
 * manuscript reads as unfinished rather than as confidently wrong (§17).
 * Pure.
 */
export function factPlaceholder(key) {
  const meta = factMeta(key);
  return `[${meta ? meta.label : key} — not yet available]`;
}

/**
 * resolveFacts(project, opts) → { [key]: resolvedFact }.
 *
 * resolvedFact = {
 *   key, label, engine, engineLabel, depKey, depLabel,
 *   value:   string   the text that renders in the manuscript
 *   raw:     string|null  the resolved value, or null when unknown
 *   missing: boolean  true when the project cannot answer this fact
 *   hint:    string   what to do about it
 * }
 * Pure.
 */
export function resolveFacts(project, opts = {}) {
  const ctx = opts.factContext || buildFactContext(project, opts);
  const out = {};
  for (const key of FACT_KEYS) {
    const meta = FACTS[key];
    let raw = null;
    try {
      const v = meta.resolve(ctx);
      raw = (v == null || v === '') ? null : String(v);
    } catch {
      // A resolver must never break the editor — an unresolvable fact is MISSING,
      // which is the honest outcome anyway (§17).
      raw = null;
    }
    const dep = DEPENDENCY_KEYS[meta.depKey] || null;
    out[key] = {
      key,
      label: meta.label,
      engine: meta.engine,
      engineLabel: (FACT_ENGINES[meta.engine] && FACT_ENGINES[meta.engine].label) || meta.engine,
      depKey: meta.depKey,
      depLabel: (dep && dep.label) || meta.depKey,
      raw,
      missing: raw == null,
      value: raw == null ? factPlaceholder(key) : raw,
      hint: meta.hint || '',
    };
  }
  return out;
}

/* ════════════ scanning + rendering ════════════ */

/** Scan markdown for fact tokens → [{ key, index, token, known }]. Pure. */
export function findFactTokens(md) {
  const out = [];
  const re = new RegExp(FACT_TOKEN_RE.source, 'g');
  const s = String(md == null ? '' : md);
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push({ key: m[1], index: m.index, token: m[0], known: !!factMeta(m[1]) });
  }
  return out;
}

/**
 * Replace every fact token in markdown with its resolved text.
 *
 * This is the CLEAN render (101.md §6 "Show Changes OFF" and §36 "normal export"):
 * the output carries no provenance markers whatsoever. The overlay is a separate
 * rendering of the SAME tokens, so both modes are guaranteed to show identical
 * words — which is exactly what §6 requires.
 *
 * An UNKNOWN token (a fact key removed in a later version, or a hand-typed one)
 * degrades to its own placeholder rather than leaking raw `[[fact:…]]` syntax
 * into an exported manuscript.
 *
 * @param {string} md
 * @param {object} resolved resolveFacts() output
 * @param {object} [opts] { overrides: { [key]: string } } — §10 pinned wording
 * Pure.
 */
export function renderFacts(md, resolved, opts = {}) {
  const map = resolved || {};
  const overrides = (opts && opts.overrides) || {};
  return String(md == null ? '' : md).replace(new RegExp(FACT_TOKEN_RE.source, 'g'), (token, key) => {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      const ov = overrides[key];
      if (ov != null && String(ov) !== '') return String(ov);
    }
    const f = map[key];
    if (f) return f.value;
    return factPlaceholder(key);
  });
}

/**
 * Which fact keys a set of dependency keys can change — the bridge from a
 * ProjectEvent (which carries dependencyKeys) to the exact manuscript spans it
 * may touch. This is what makes §15 targeted instead of "regenerate everything".
 * Pure.
 */
export function factsForDependencyKeys(depKeys) {
  const keys = new Set();
  for (const d of (Array.isArray(depKeys) ? depKeys : [])) {
    for (const k of factsForDependencyKey(d)) keys.add(k);
  }
  return Array.from(keys);
}

export default {
  FACT_TOKEN_RE,
  FACTS,
  FACT_KEYS,
  FACT_ENGINES,
  FACT_ENGINE_IDS,
  factToken,
  factMeta,
  factsForDependencyKey,
  factsForDependencyKeys,
  factsForEngine,
  buildFactContext,
  resolveFacts,
  renderFacts,
  findFactTokens,
  factPlaceholder,
  formatFactDate,
  numberWord,
  joinList,
};
