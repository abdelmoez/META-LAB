/**
 * strategyCritic.js — P11 Task 2 (pure engine half of the Guided search strategy
 * generator ↔ critic loop). Deterministic RULE-based critique of a single generated
 * strategy (one database + profile), plus a re-testable `revised` strategy the loop
 * can run again. No network, no randomness, no "AI" wording.
 *
 * critiqueStrategy({ strategy, hitCount, hitKind, seedRecall, siblingCounts, config }) →
 *   { issues:[{ type, severity:'info'|'warn'|'error', message, suggestion }],
 *     score:0..1, suggestedEdits:[...], revised: strategyObject | null }
 *
 * `strategy` is one element of generateStrategies(...).strategies. Its blocks carry the
 * source term objects (block.terms), so the critic reconstructs a concept model and
 * regenerates a genuinely re-testable `revised` strategy via strategyGenerator.
 */
import { generateStrategyFor, databaseSupportsControlled } from './strategyGenerator.js';
import { detectCrossConceptDuplicates, termEquivalenceKey } from './crossConcept.js';
import { matchFamily, norm } from './conceptExtraction.js';
import { isLiveTerm } from './termLiveness.js';

const s = (v) => String(v == null ? '' : v);

/**
 * DEFAULT critic thresholds. Every bound is overridable via the `config` argument.
 *  - minHits / maxHits     : per-database hit-count window (a balanced single-DB search)
 *  - lowSensitivityRecall  : seed-set recall below this → LOW_SENSITIVITY
 *  - imbalanceRatio        : max/min live-term count across concepts above this → IMBALANCED_BLOCKS
 *  - restrictiveHitCeiling : language/pubtype limits only escalate to a warning below this
 *  - narrowYears           : a date window shorter than this (years) counts as restrictive
 *  - sensitivityDeltaFrac  : a sibling term change moving counts by < this fraction is "not meaningful"
 */
export const DEFAULT_CRITIC_CONFIG = Object.freeze({
  minHits: 50,
  maxHits: 20000,
  lowSensitivityRecall: 0.8,
  imbalanceRatio: 4,
  restrictiveHitCeiling: 500,
  narrowYears: 3,
  sensitivityDeltaFrac: 0.1,
});

const SEVERITY_PENALTY = { error: 0.3, warn: 0.12, info: 0.03 };
const round3 = (n) => Math.round(n * 1000) / 1000;

/** Reconstruct the concept model from a strategy's blocks (lossless — blocks carry
 *  the source term objects). Used for duplicate detection + regenerating a revision.
 *  Applies the shared liveness rule (termLiveness.js): the critic must judge — and
 *  its `revised` strategy must re-render — only terms the search actually executes,
 *  even when a caller hands it raw blocks carrying `disabled: true` terms. */
function reconstructConcepts(strategy) {
  const blocks = (strategy && Array.isArray(strategy.blocks)) ? strategy.blocks : [];
  return blocks.map((b, i) => ({
    id: s(b.id) || `c${i + 1}`,
    label: s(b.concept) || `Concept ${i + 1}`,
    picoField: b.picoField || null,
    op: 'AND',
    terms: (Array.isArray(b.terms) ? b.terms : []).filter(isLiveTerm).map((t) => ({ ...t })),
  }));
}

/** Structural (provider-neutral) syntax problems in a rendered query string. */
export function syntaxProblems(searchString) {
  const str = s(searchString);
  const probs = [];
  if (!str.trim()) { probs.push('empty query'); return probs; }
  let depth = 0; let unbalanced = false;
  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth < 0) { unbalanced = true; break; } }
  }
  if (unbalanced || depth !== 0) probs.push('unbalanced parentheses');
  if (/\(\s*\)/.test(str)) probs.push('empty group ()');
  if (/^\s*(AND|OR|NOT)\b/.test(str)) probs.push('leading Boolean operator');
  if (/\b(AND|OR|NOT)\s*$/.test(str)) probs.push('trailing Boolean operator');
  if (/\b(AND|OR|NOT)\s+(AND|OR|NOT)\b/.test(str)) probs.push('consecutive Boolean operators');
  return probs;
}

/** Whether the strategy carries recall-reducing filters (language / pubtype / narrow date). */
function restrictiveFilterInfo(filters, cfg) {
  const f = filters || {};
  const langs = Array.isArray(f.languages) ? f.languages : [];
  const pubTypes = Array.isArray(f.pubTypes) ? f.pubTypes : [];
  let narrowDate = false;
  if (f.dateFrom && f.dateTo) {
    const y0 = Number(s(f.dateFrom).slice(0, 4));
    const y1 = Number(s(f.dateTo).slice(0, 4));
    if (Number.isFinite(y0) && Number.isFinite(y1) && y1 - y0 < cfg.narrowYears) narrowDate = true;
  }
  const reasons = [];
  if (langs.length) reasons.push(`language limit (${langs.join(', ')})`);
  if (pubTypes.length) reasons.push(`publication-type limit (${pubTypes.join(', ')})`);
  if (narrowDate) reasons.push(`a narrow ${s(f.dateFrom).slice(0, 4)}–${s(f.dateTo).slice(0, 4)} date window`);
  return { restrictive: reasons.length > 0, reasons, hasLangOrType: langs.length > 0 || pubTypes.length > 0 };
}

/**
 * sensitivityDelta — was a term change meaningful? Given a baseline count and a
 * variant count, decide if the difference clears the configured fraction. Pure.
 */
export function sensitivityDelta({ base, count, frac = DEFAULT_CRITIC_CONFIG.sensitivityDeltaFrac } = {}) {
  const b = Number(base);
  const c = Number(count);
  if (!Number.isFinite(b) || !Number.isFinite(c) || b <= 0) return { deltaFrac: null, meaningful: false, direction: 'unknown' };
  const deltaFrac = round3(Math.abs(c - b) / b);
  return { deltaFrac, meaningful: deltaFrac >= frac, direction: c > b ? 'increase' : (c < b ? 'decrease' : 'none') };
}

/**
 * analyzeSensitivity(siblingCounts, cfg) — evaluate add/remove-term variants against a
 * baseline hit count. `siblingCounts` = { base, variants:[{ term, change:'add'|'remove', count }] }.
 * Returns [{ term, change, count, base, deltaFrac, meaningful, direction }]. Pure.
 */
export function analyzeSensitivity(siblingCounts, cfg = DEFAULT_CRITIC_CONFIG) {
  if (!siblingCounts || typeof siblingCounts !== 'object') return [];
  const base = Number(siblingCounts.base);
  const variants = Array.isArray(siblingCounts.variants) ? siblingCounts.variants : [];
  return variants
    .filter((v) => v && typeof v === 'object')
    .map((v) => {
      const d = sensitivityDelta({ base, count: v.count, frac: cfg.sensitivityDeltaFrac });
      return { term: s(v.term), change: v.change === 'remove' ? 'remove' : 'add', count: Number(v.count), base, ...d };
    });
}

/** Add known synonyms (from the concept-family vocabulary) to any single-term concept. */
function withSynonymsAdded(concepts) {
  return concepts.map((c) => {
    if ((c.terms || []).length !== 1) return c;
    const only = c.terms[0];
    const fam = matchFamily(norm(only.text));
    if (!fam) return c;
    const have = new Set(c.terms.map((t) => norm(t.text)));
    const added = (fam.terms || [])
      .filter((t) => norm(t) && !have.has(norm(t)))
      .map((t) => ({ text: t, type: 'freetext', field: only.field || 'tiab', vocab: null, noExplode: false, truncate: false, phrase: /\s/.test(t) }));
    return added.length ? { ...c, terms: [...c.terms, ...added] } : c;
  });
}

/** Drop an equivalence-key duplicate from every concept after the first it appears in. */
function withDuplicatesRemoved(concepts, dups) {
  const removeAfter = new Map(); // equivKey -> first concept index that keeps it
  const list = concepts.map((c) => ({ ...c, terms: (c.terms || []).slice() }));
  for (const d of dups) {
    const keepId = d.occurrences[0] && d.occurrences[0].conceptId;
    removeAfter.set(d.equivKey, keepId);
  }
  // Rebuild: keep the term only in its first concept (by detectCrossConceptDuplicates order).
  return list.map((c) => {
    const filtered = c.terms.filter((t) => {
      const key = termEquivalenceKey(t.text);
      if (!removeAfter.has(key)) return true;
      return removeAfter.get(key) === c.id;
    });
    return filtered.length === c.terms.length ? c : { ...c, terms: filtered };
  });
}

/**
 * critiqueStrategy — deterministic rule checks + a re-testable revised strategy.
 */
export function critiqueStrategy({ strategy, hitCount, hitKind, seedRecall, siblingCounts, config } = {}) {
  const cfg = { ...DEFAULT_CRITIC_CONFIG, ...(config && typeof config === 'object' ? config : {}) };
  const issues = [];
  const suggestedEdits = [];

  if (!strategy || typeof strategy !== 'object') {
    return { issues: [{ type: 'BROKEN_SYNTAX', severity: 'error', message: 'No strategy was provided.', suggestion: 'Generate a strategy before running the critic.' }], score: 0, suggestedEdits: [], revised: null };
  }

  const concepts = reconstructConcepts(strategy);
  const filters = strategy.filters || { dateFrom: '', dateTo: '', languages: [], pubTypes: [] };
  const haveHits = Number.isFinite(Number(hitCount)) && hitKind !== 'unavailable';
  const hits = haveHits ? Number(hitCount) : null;
  const capped = hitKind === 'capped';

  // Track the dominant remediation so `revised` reflects the highest-priority fix.
  let dominant = null; // 'fixSyntax' | 'broaden' | 'tighten' | 'addSynonyms' | 'dedup' | 'relaxFilters'

  /* 1. BROKEN_SYNTAX */
  const probs = syntaxProblems(strategy.searchString);
  if (probs.length) {
    issues.push({ type: 'BROKEN_SYNTAX', severity: 'error', message: `The query has structural problems: ${probs.join('; ')}.`, suggestion: 'Regenerate the strategy from the concept model to restore valid Boolean syntax.' });
    if (concepts.length) { dominant = dominant || 'fixSyntax'; suggestedEdits.push({ action: 'regenerate' }); }
  }

  /* 2. UNSUPPORTED_FIELD_TAG — surface generator warnings + independently derive. */
  const genUnsupported = (Array.isArray(strategy.warnings) ? strategy.warnings : []).filter((w) => w && w.type === 'UNSUPPORTED_FIELD_TAG');
  const dbLacksControlled = !databaseSupportsControlled(strategy.database);
  const controlledPresent = concepts.some((c) => (c.terms || []).some((t) => t.type === 'controlled'));
  if (genUnsupported.length || (dbLacksControlled && controlledPresent)) {
    const terms = [...new Set(genUnsupported.map((w) => w.term).filter(Boolean))];
    issues.push({ type: 'UNSUPPORTED_FIELD_TAG', severity: 'warn', message: terms.length ? `This database has no subject-heading field; ${terms.map((t) => `"${t}"`).join(', ')} were searched as free text.` : 'This database has no subject-heading field; controlled-vocabulary terms were searched as free text.', suggestion: 'Add free-text synonyms for those headings, or run the controlled-vocabulary search in a database that supports it (e.g. PubMed).' });
  }

  /* 3. DUPLICATE_CONCEPTS (cross-concept term reuse over-narrows an AND-ed search). */
  const dups = detectCrossConceptDuplicates(concepts);
  if (dups.length) {
    const label = dups.map((d) => `"${d.label}"`).join(', ');
    issues.push({ type: 'DUPLICATE_CONCEPTS', severity: 'warn', message: `The same term appears in more than one concept (${label}). Because concepts are joined with AND, this can make the search too narrow.`, suggestion: 'Keep each term in a single concept.' });
    dominant = dominant || 'dedup';
    for (const d of dups) suggestedEdits.push({ action: 'removeDuplicate', term: d.label, keepIn: d.occurrences[0] && d.occurrences[0].conceptLabel });
  }

  /* 4. IMBALANCED_BLOCKS */
  if (concepts.length >= 2) {
    const counts = concepts.map((c) => (c.terms || []).length);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (min >= 1 && max / min > cfg.imbalanceRatio) {
      const thin = concepts[counts.indexOf(min)];
      issues.push({ type: 'IMBALANCED_BLOCKS', severity: 'warn', message: `Concepts are unbalanced (largest has ${max} terms, smallest "${thin.label}" has ${min}). The thin concept dominates the intersection.`, suggestion: `Add synonyms to "${thin.label}".` });
      suggestedEdits.push({ action: 'addTerms', concept: thin.label });
    }
  }

  /* 5. MISSING_SYNONYMS — a concept with a single free-text term and no subject heading. */
  const thinConcepts = concepts.filter((c) => {
    const terms = c.terms || [];
    const hasMesh = terms.some((t) => t.type === 'controlled');
    const free = terms.filter((t) => t.type !== 'controlled');
    return !hasMesh && free.length === 1;
  });
  if (thinConcepts.length) {
    const named = thinConcepts.map((c) => `"${c.label}"`).join(', ');
    issues.push({ type: 'MISSING_SYNONYMS', severity: 'warn', message: `${thinConcepts.length === 1 ? 'Concept' : 'Concepts'} ${named} rely on a single term with no synonyms, which reduces sensitivity.`, suggestion: 'Add synonyms / abbreviations, or a subject heading, for each single-term concept.' });
    dominant = dominant || 'addSynonyms';
    for (const c of thinConcepts) suggestedEdits.push({ action: 'addSynonyms', concept: c.label, terms: synonymSuggestions(c) });
  }

  /* 6. RESTRICTIVE_FILTERS */
  const rf = restrictiveFilterInfo(filters, cfg);
  const lowRecall = Number.isFinite(Number(seedRecall)) && Number(seedRecall) < cfg.lowSensitivityRecall;
  const tooFew = haveHits && hits < cfg.minHits;
  if (rf.restrictive) {
    const escalate = tooFew || lowRecall || (haveHits && hits < cfg.restrictiveHitCeiling);
    issues.push({ type: 'RESTRICTIVE_FILTERS', severity: escalate ? 'warn' : 'info', message: `The search applies ${rf.reasons.join(' and ')}, which can reduce sensitivity.`, suggestion: 'Consider removing the language / publication-type limits and applying them at screening instead.' });
    if (escalate && rf.hasLangOrType) { dominant = dominant || 'relaxFilters'; suggestedEdits.push({ action: 'relaxFilters', drop: ['languages', 'pubTypes'] }); }
  }

  /* 7. TOO_FEW_HITS / 8. TOO_MANY_HITS (only with real counts). */
  if (haveHits) {
    if (hits < cfg.minHits) {
      issues.push({ type: 'TOO_FEW_HITS', severity: hits === 0 ? 'error' : 'warn', message: `The search returned only ${hits} record${hits === 1 ? '' : 's'} (below ${cfg.minHits}); it is likely too narrow.`, suggestion: 'Add synonyms, use the broad profile, or relax filters.' });
      dominant = dominant || 'broaden';
      suggestedEdits.push({ action: 'broaden' });
    } else if (hits > cfg.maxHits || capped) {
      issues.push({ type: 'TOO_MANY_HITS', severity: 'warn', message: capped ? `The search hit the result cap (${hits}+ records); it is likely too broad.` : `The search returned ${hits} records (above ${cfg.maxHits}); it may be too broad to screen.`, suggestion: 'Add a concept, use subject headings (major topic) or the precise profile, or narrow filters.' });
      dominant = dominant || 'tighten';
      suggestedEdits.push({ action: 'increaseSpecificity' });
    }
  }

  /* 9. LOW_SENSITIVITY — estimated seed-set recall is below the floor. */
  if (Number.isFinite(Number(seedRecall))) {
    const r = Number(seedRecall);
    if (r < cfg.lowSensitivityRecall) {
      issues.push({ type: 'LOW_SENSITIVITY', severity: r < 0.5 ? 'error' : 'warn', message: `Estimated recall against the seed set is ${round3(r)} (below ${cfg.lowSensitivityRecall}); the search is missing known-relevant records.`, suggestion: 'Add synonyms from the missing seeds and broaden field tags; re-run recall estimation.' });
      dominant = dominant || 'broaden';
      if (!suggestedEdits.some((e) => e.action === 'broaden')) suggestedEdits.push({ action: 'broaden' });
    }
  }

  /* Sensitivity of add/remove-term variants (optional). */
  const sensitivity = analyzeSensitivity(siblingCounts, cfg);
  for (const v of sensitivity) {
    suggestedEdits.push({ action: v.meaningful ? (v.change === 'add' ? 'addTermMovesCount' : 'keepTerm') : 'termHasLittleEffect', term: v.term, change: v.change, deltaFrac: v.deltaFrac, meaningful: v.meaningful, direction: v.direction });
  }

  /* Score: start perfect, subtract per-issue severity penalties. */
  let score = 1;
  for (const it of issues) score -= (SEVERITY_PENALTY[it.severity] || 0);
  score = round3(Math.max(0, Math.min(1, score)));

  const revised = buildRevised(strategy, concepts, filters, dominant, dups);

  return { issues, score, suggestedEdits, revised };
}

/** Family-derived synonym suggestions for a single-term concept (display texts). */
function synonymSuggestions(concept) {
  const only = (concept.terms || [])[0];
  if (!only) return [];
  const fam = matchFamily(norm(only.text));
  if (!fam) return [];
  const have = new Set((concept.terms || []).map((t) => norm(t.text)));
  return (fam.terms || []).filter((t) => norm(t) && !have.has(norm(t)));
}

/** Build a single re-testable revised strategy applying the dominant remediation. */
function buildRevised(strategy, concepts, filters, dominant, dups) {
  if (!dominant || !concepts.length) return null;
  const db = strategy.database;
  let profile = strategy.profile;
  let nextConcepts = concepts;
  let nextFilters = { ...filters };

  switch (dominant) {
    case 'fixSyntax':
      // Regenerate as-is: rebuilding from the concept model restores valid syntax.
      break;
    case 'broaden':
      profile = 'broad';
      nextConcepts = withSynonymsAdded(concepts);
      nextFilters = { ...filters, languages: [], pubTypes: [] };
      break;
    case 'tighten':
      profile = 'precise';
      break;
    case 'addSynonyms':
      nextConcepts = withSynonymsAdded(concepts);
      break;
    case 'dedup':
      nextConcepts = withDuplicatesRemoved(concepts, dups);
      break;
    case 'relaxFilters':
      nextFilters = { ...filters, languages: [], pubTypes: [] };
      break;
    default:
      return null;
  }
  const norm2 = (f) => ({ dateFrom: s(f.dateFrom), dateTo: s(f.dateTo), languages: f.languages || [], pubTypes: f.pubTypes || [] });
  return generateStrategyFor(nextConcepts, db, norm2(nextFilters), profile);
}

export default critiqueStrategy;
