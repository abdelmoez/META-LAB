/**
 * searchBuilderBenchmark.js — SB5. Pure benchmark runner: runs each evaluation case
 * through the Search Builder engine and scores seven intelligence dimensions. No
 * network, no fabricated numbers, deterministic. Used by the unit test + the CLI
 * report (npm run test:search-builder-intelligence).
 */
import { syncSearchBuilderFromPico, conceptFieldKey } from './searchState.js';
import { isFillerWord } from './keywordSelection.js';
import { detectCrossConceptDuplicates, termEquivalenceKey } from './crossConcept.js';
import { localMeshSuggestions } from './meshSuggest.js';
import { norm } from './conceptExtraction.js';

const ROLE_BY_FIELD = { population: 'P', intervention: 'I', comparator: 'C', outcomes: 'O' };
const isMultiword = (s) => norm(s).includes(' ');

/** Does a group's term set satisfy an expected term? Matches on (a) concept-family
 *  equivalence, (b) exact normalized text, or (c) phrase-substring either direction —
 *  so a qualifier the engine correctly strips ("early renal replacement therapy" →
 *  "renal replacement therapy", "suspected appendicitis" → "appendicitis") still
 *  counts as the right concept landing in the right place. Wrong-concept placement and
 *  noise are still caught (the phrases don't substring-match across distinct concepts). */
function termMatch(entry, term) {
  if (!entry) return false;
  const tk = termEquivalenceKey(term);
  const tn = norm(term);
  if (!tn) return false;
  if (entry.keys.has(tk) || entry.norms.has(tn)) return true;
  for (const gn of entry.norms) {
    if (gn.length >= 3 && (gn.includes(tn) || tn.includes(gn))) return true;
  }
  return false;
}

/** Build the engine's concept groups for a case (ids assigned by PICO field). */
function engineGroups(pico) {
  return syncSearchBuilderFromPico(pico || {}, [], []).map((c, i) => ({ ...c, id: c.id || `${conceptFieldKey(c) || 'm'}-${i}` }));
}

/** Map: PICO key → { norms:Set, keys:Set } of the group's live term equivalence. */
function groupIndex(groups) {
  const byKey = {};
  for (const g of groups) {
    const k = conceptFieldKey(g);
    if (!k) continue;
    const norms = new Set();
    const keys = new Set();
    for (const t of (g.terms || [])) {
      const text = String(t.text || '').trim();
      if (!text) continue;
      norms.add(norm(text));
      keys.add(termEquivalenceKey(text));
    }
    byKey[k] = { norms, keys };
  }
  return byKey;
}

const DIMENSIONS = ['noiseRejection', 'phrasePreservation', 'picoAssignment', 'leakage', 'vocabSafety', 'synonymExpansion', 'strategySafety'];

/** Score one case → { caseId, results:{dim:{applicable,pass,detail}} }. */
export function scoreCase(testCase) {
  const c = testCase || {};
  const exp = c.expected || {};
  const groups = engineGroups(c.pico);
  const idx = groupIndex(groups);
  const allKeys = new Set();
  const allNorms = new Set();
  for (const k of Object.keys(idx)) { idx[k].keys.forEach((x) => allKeys.add(x)); idx[k].norms.forEach((x) => allNorms.add(x)); }
  const allEntry = { keys: allKeys, norms: allNorms };
  const results = {};

  // 1. Noise rejection — every reject word is filler AND not an emitted concept term.
  {
    const words = c.rejectNoise || [];
    let pass = true; let detail = '';
    for (const w of words) {
      if (!isFillerWord(w)) { pass = false; detail = `"${w}" was selectable`; break; }
      if (allNorms.has(norm(w))) { pass = false; detail = `"${w}" became a concept term`; break; }
    }
    results.noiseRejection = { applicable: words.length > 0, pass, detail };
  }

  // 2. Phrase preservation — each expected multi-word phrase survives as one term.
  {
    const phrases = [].concat(exp.population || [], exp.intervention || [], exp.comparator || [], exp.outcomes || []).filter(isMultiword);
    let pass = true; let detail = '';
    for (const p of phrases) {
      if (!termMatch(allEntry, p)) { pass = false; detail = `"${p}" not preserved`; break; }
    }
    results.phrasePreservation = { applicable: phrases.length > 0, pass, detail };
  }

  // 3. PICO assignment — each expected term lands in its concept (family-equivalence aware).
  {
    let applicable = false; let pass = true; let detail = '';
    for (const [role, key] of Object.entries(ROLE_BY_FIELD)) {
      const want = exp[role] || [];
      if (!want.length) continue;
      applicable = true;
      const g = idx[key] || { keys: new Set(), norms: new Set() };
      for (const term of want) {
        if (!termMatch(g, term)) { pass = false; detail = `"${term}" not in ${key}`; break; }
      }
      if (!pass) break;
    }
    results.picoAssignment = { applicable, pass, detail };
  }

  // 4. Cross-concept leakage — notInPopulation terms absent from P + no auto duplicate.
  {
    const banned = c.notInPopulation || [];
    const pop = idx.P || { keys: new Set() };
    let pass = true; let detail = '';
    for (const b of banned) {
      if (pop.keys.has(termEquivalenceKey(b))) { pass = false; detail = `"${b}" leaked into Population`; break; }
    }
    const dups = detectCrossConceptDuplicates(groups);
    if (pass && dups.length) { pass = false; detail = `auto-duplicate across concepts: ${dups.map((d) => d.equivKey).join(', ')}`; }
    results.leakage = { applicable: true, pass, detail };
  }

  // 5. Controlled-vocabulary safety — offline MeSH suggestion for the intervention is a
  //    known-good heading (in expectedVocab) when expectations are given; never wrong.
  {
    const expVocab = c.expectedVocab || [];
    const applicable = expVocab.length > 0;
    let pass = true; let detail = '';
    if (applicable) {
      const allow = new Set(expVocab.map(norm));
      const terms = [(exp.population || [])[0], (exp.intervention || [])[0]].filter(Boolean);
      for (const term of terms) {
        const sugg = localMeshSuggestions(term).filter((s) => s.type === 'mesh').map((s) => norm(s.label));
        const wrong = sugg.find((s) => !allow.has(s));
        if (wrong) { pass = false; detail = `unexpected MeSH "${wrong}" for "${term}"`; break; }
      }
    }
    results.vocabSafety = { applicable, pass, detail };
  }

  // 6. Synonym / acronym expansion — each expected pair is treated as equivalent
  //    (so the expansion is reachable from the acronym).
  {
    const pairs = c.expectedSynonyms || [];
    let pass = true; let detail = '';
    for (const [a, b] of pairs) {
      if (termEquivalenceKey(a) !== termEquivalenceKey(b)) { pass = false; detail = `"${a}" not linked to "${b}"`; break; }
    }
    results.synonymExpansion = { applicable: pairs.length > 0, pass, detail };
  }

  // 7. Strategy safety — generated strategy repeats no equivalence key across AND-ed
  //    blocks (would over-narrow). Equivalent to "no cross-concept duplicate".
  {
    const dups = detectCrossConceptDuplicates(groups);
    results.strategySafety = { applicable: true, pass: dups.length === 0, detail: dups.length ? `repeats: ${dups.map((d) => d.equivKey).join(', ')}` : '' };
  }

  return { caseId: c.caseId || 'unknown', results };
}

/**
 * runBenchmark(cases, opts) → aggregate report:
 *   { total, dimensions:{dim:{applicable,passed,rate}}, overall:{passed,rate}, failures:[...] }
 * `overall` counts a case as passing when every APPLICABLE dimension passes.
 */
export function runBenchmark(cases, opts = {}) {
  const list = Array.isArray(cases) ? cases : [];
  const maxFailures = opts.maxFailures || 50;
  const dim = {}; for (const d of DIMENSIONS) dim[d] = { applicable: 0, passed: 0 };
  let overallPassed = 0;
  const failures = [];
  for (const tc of list) {
    const { caseId, results } = scoreCase(tc);
    let caseOk = true;
    for (const d of DIMENSIONS) {
      const r = results[d];
      if (!r.applicable) continue;
      dim[d].applicable += 1;
      if (r.pass) dim[d].passed += 1;
      else { caseOk = false; if (failures.length < maxFailures) failures.push({ caseId, dimension: d, detail: r.detail }); }
    }
    if (caseOk) overallPassed += 1;
  }
  const dimensions = {};
  for (const d of DIMENSIONS) dimensions[d] = { ...dim[d], rate: dim[d].applicable ? dim[d].passed / dim[d].applicable : 1 };
  return {
    total: list.length,
    dimensions,
    overall: { passed: overallPassed, rate: list.length ? overallPassed / list.length : 1 },
    failures,
  };
}

export default runBenchmark;
