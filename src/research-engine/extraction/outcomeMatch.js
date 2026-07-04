/**
 * extraction/outcomeMatch.js — P (protocol-outcomes). Pure, dependency-free
 * normalization + matching helpers used to reconcile the outcome NAMES a paper
 * reports against the review's PRE-SPECIFIED outcome list (see protocolOutcomes.js).
 * No I/O, no React, no DOM, no Date — safe to import from the server, the client,
 * and unit tests.
 *
 * WHAT THIS DOES
 *   - normalizeOutcome(s): fold an outcome label into a stable comparison key
 *     (lowercase, unicode dashes → hyphen, punctuation stripped except hyphen/%,
 *     stopwords removed, conservative singularization). Never returns empty for a
 *     string that carried content.
 *   - OUTCOME_SYNONYMS: a curated table of clinical outcome synonym groups, each an
 *     array of *normalized* variants. Two labels that fall into the same group are
 *     treated as the same outcome (e.g. "all-cause mortality" ≡ "death").
 *   - matchOutcome(text, outcomes): match a free-text outcome name found in a paper
 *     against the protocol's outcome list, returning the best hit with a graded
 *     confidence and the rule that produced it, or null.
 *
 * DETERMINISM
 *   Pure functions of their inputs. Same input → byte-identical output. No random,
 *   no clock. Malformed input is coerced/validated (never throws): a non-string
 *   normalizes to '', matchOutcome with no outcomes returns null.
 */

/** Stopwords removed during normalization (short function words only). */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'at', 'to', 'for', 'with', 'and', 'or', 'by', 'on',
]);

/** Unicode dash variants folded to an ASCII hyphen. */
const DASH_RE = /[‐‑‒–—―⁃−－]/g;

/**
 * normalizeOutcome(s) — fold an outcome label into a stable comparison key.
 *
 * Steps: lowercase → unicode dashes to hyphen → strip punctuation except hyphen
 * and % (to spaces) → collapse whitespace → drop stopwords → conservative
 * singularization (strip a trailing "s" ONLY when the token is >4 chars and does
 * NOT end in ss/us/is/es — so "diabetes" stays "diabetes", "events" → "event").
 *
 * If every token was a stopword (or nothing survived tokenization), the collapsed,
 * lowercased, punctuation-normalized original is returned instead so a label that
 * carried content never normalizes to ''.
 *
 * @param {*} s
 * @returns {string}
 */
export function normalizeOutcome(s) {
  let str;
  if (typeof s === 'string') str = s;
  else if (s == null) return '';
  else str = String(s);

  str = str.toLowerCase().replace(DASH_RE, '-');
  // Keep letters, digits, %, hyphen and whitespace; everything else → space.
  str = str.replace(/[^a-z0-9%\-\s]/g, ' ');
  str = str.replace(/\s+/g, ' ').trim();

  const collapsed = str; // fallback: content-preserving, whitespace-normalized
  if (!collapsed) return '';

  const kept = [];
  for (const tok of collapsed.split(' ')) {
    if (!tok) continue;
    if (!/[a-z0-9]/.test(tok)) continue; // drop lone "-" / "%" tokens
    if (STOPWORDS.has(tok)) continue;
    kept.push(tok);
  }
  if (kept.length === 0) return collapsed; // all-stopword input → preserve content

  return kept.map(singularizeToken).join(' ');
}

/** Conservative singularizer for one token; see normalizeOutcome for the rule. */
function singularizeToken(tok) {
  if (
    tok.length > 4 &&
    tok.endsWith('s') &&
    !tok.endsWith('ss') &&
    !tok.endsWith('us') &&
    !tok.endsWith('is') &&
    !tok.endsWith('es')
  ) {
    return tok.slice(0, -1);
  }
  return tok;
}

/**
 * OUTCOME_SYNONYMS — curated clinical outcome synonym groups. Each group is an
 * array of NORMALIZED variants; membership of two labels in the same group means
 * they denote the same clinical outcome. Extend conservatively — a wrong grouping
 * silently merges distinct outcomes.
 */
export const OUTCOME_SYNONYMS = [
  ['all-cause mortality', 'mortality', 'death', 'deaths', 'overall mortality'],
  ['hba1c', 'glycated hemoglobin', 'glycated haemoglobin', 'a1c', 'hemoglobin a1c', 'haemoglobin a1c'],
  ['myocardial infarction', 'mi', 'heart attack'],
  ['stroke', 'cerebrovascular accident', 'cva'],
  ['blood pressure', 'bp', 'systolic blood pressure', 'sbp', 'diastolic blood pressure', 'dbp'],
  ['body mass index', 'bmi'],
  ['quality of life', 'quality life', 'qol', 'hrqol', 'health-related quality of life', 'health-related quality life'],
  ['overall survival', 'os'],
  ['progression-free survival', 'progression free survival', 'pfs'],
  ['adverse event', 'adverse events', 'side effect', 'side effects', 'safety'],
  ['hospitalization', 'hospitalisation', 'hospital admission', 'hospitalizations'],
  ['pain', 'pain score', 'pain intensity'],
  ['depression', 'depressive symptoms', 'depressive symptom'],
  ['anxiety'],
  ['weight', 'body weight', 'weight loss'],
  ['ldl', 'ldl cholesterol', 'low density lipoprotein', 'low-density lipoprotein'],
  ['hdl', 'hdl cholesterol', 'high density lipoprotein', 'high-density lipoprotein'],
  ['total cholesterol'],
  ['triglycerides', 'triglyceride', 'tg'],
  ['fasting glucose', 'fasting blood glucose', 'fpg'],
  ['insulin resistance', 'homa-ir', 'homa ir'],
  ['egfr', 'estimated glomerular filtration rate', 'kidney function'],
  ['creatinine', 'serum creatinine'],
  ['crp', 'c-reactive protein'],
  ['6mwt', '6-minute walk', '6mwd', 'six-minute walk'],
  ['fev1', 'forced expiratory volume'],
  ['exacerbation', 'exacerbations'],
  ['readmission', 'rehospitalization', 'rehospitalisation', 'readmissions'],
  ['length of stay', 'length stay', 'length hospital stay', 'length of hospital stay', 'los'],
  ['fracture', 'fractures'],
  ['falls', 'fall', 'fall rate'],
  ['remission', 'clinical remission'],
  ['response', 'response rate', 'response rates', 'orr', 'objective response rate'],
];

/**
 * SYN_LOOKUP — normalized-variant → group index. Built once; first writer of a
 * given normalized key wins (there are no intended cross-group collisions).
 */
const SYN_LOOKUP = new Map();
OUTCOME_SYNONYMS.forEach((group, gi) => {
  for (const variant of group) {
    const nv = normalizeOutcome(variant);
    if (nv && !SYN_LOOKUP.has(nv)) SYN_LOOKUP.set(nv, gi);
  }
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * containsPhrase(hay, needle) — does the normalized phrase `needle` occur in the
 * normalized string `hay` at token boundaries? Token-boundary matching prevents
 * "os" from matching inside "dose".
 */
function containsPhrase(hay, needle) {
  if (!hay || !needle) return false;
  if (hay === needle) return true;
  const re = new RegExp('(?:^|\\s)' + escapeRe(needle) + '(?:\\s|$)');
  return re.test(hay);
}

/**
 * groupOfDetailed(norm) — resolve a normalized label to a synonym group.
 * Returns { group, exact }: `exact` is true when the whole label IS a listed
 * variant, false when a variant merely appears inside it as a bounded phrase.
 */
function groupOfDetailed(norm) {
  if (!norm) return { group: null, exact: false };
  if (SYN_LOOKUP.has(norm)) return { group: SYN_LOOKUP.get(norm), exact: true };
  for (const [variant, gi] of SYN_LOOKUP) {
    if (containsPhrase(norm, variant)) return { group: gi, exact: false };
  }
  return { group: null, exact: false };
}

/** Resolve an outcome's synonym group, preferring an exact variant on canonical/aliases. */
function outcomeGroup(outcome) {
  const canonical = outcome && typeof outcome.canonical === 'string' ? normalizeOutcome(outcome.canonical) : '';
  const aliases = Array.isArray(outcome && outcome.aliases) ? outcome.aliases : [];
  const cg = groupOfDetailed(canonical);
  if (cg.group != null && cg.exact) return cg;
  for (const a of aliases) {
    const ag = groupOfDetailed(normalizeOutcome(a));
    if (ag.group != null && ag.exact) return ag;
  }
  if (cg.group != null) return cg;
  for (const a of aliases) {
    const ag = groupOfDetailed(normalizeOutcome(a));
    if (ag.group != null) return ag;
  }
  return { group: null, exact: false };
}

/**
 * ruleFor(outcome, nt, ntSet, tg) — evaluate the ordered match rules for one
 * outcome against the already-normalized paper label. Returns the FIRST rule that
 * fires as { rule, via, conf } (lower rule number = stronger), or null.
 */
function ruleFor(outcome, nt, ntSet, tg) {
  const canonical = outcome && typeof outcome.canonical === 'string' ? normalizeOutcome(outcome.canonical) : '';
  const aliasesRaw = Array.isArray(outcome && outcome.aliases) ? outcome.aliases : [];
  const aliases = aliasesRaw.map(normalizeOutcome).filter(Boolean);
  if (!canonical && !aliases.length) return null;

  // 1. exact equality with canonical or an alias → exact / high
  if (nt && (nt === canonical || aliases.includes(nt))) {
    return { rule: 1, via: 'exact', conf: 'high' };
  }

  const cTokens = canonical ? canonical.split(' ').filter(Boolean) : [];

  // 2. multi-token canonical is a bounded substring of the text → exact / high
  if (cTokens.length >= 2 && containsPhrase(nt, canonical)) {
    return { rule: 2, via: 'exact', conf: 'high' };
  }

  // 3. single-token canonical present as a token in the text → exact / medium
  if (cTokens.length === 1 && containsPhrase(nt, canonical)) {
    return { rule: 3, via: 'exact', conf: 'medium' };
  }

  // 4. both sides map into the same synonym group → synonym (high if the paper
  //    label is an exact variant, else medium)
  const og = outcomeGroup(outcome);
  if (og.group != null && tg.group != null && og.group === tg.group) {
    return { rule: 4, via: 'synonym', conf: tg.exact ? 'high' : 'medium' };
  }

  // 5 / 6. token overlap. NEVER match on zero overlap.
  if (cTokens.length >= 1) {
    const present = cTokens.filter((t) => ntSet.has(t));
    if (present.length >= 1 && present.length === cTokens.length) {
      return { rule: 5, via: 'tokens', conf: 'medium' };
    }
    if (cTokens.length >= 2 && present.length >= 2 && present.length / cTokens.length >= 0.6) {
      return { rule: 6, via: 'tokens', conf: 'low' };
    }
  }

  return null;
}

/**
 * matchOutcome(text, outcomes) — match a paper's free-text outcome name against
 * the protocol outcome list produced by protocolOutcomes().
 *
 * @param {string} text  outcome name as reported by a paper
 * @param {Array<{id,level,canonical,aliases}>} outcomes  protocolOutcomes() output
 * @returns {{ outcomeId:string, level:string, confidence:'high'|'medium'|'low',
 *            matchedVia:'exact'|'synonym'|'tokens' } | null}
 *
 * The strongest rule across all outcomes wins; on an exact tie the FIRST outcome
 * in list order (primary before secondary) is chosen.
 */
export function matchOutcome(text, outcomes) {
  const nt = normalizeOutcome(text);
  if (!nt || !Array.isArray(outcomes) || outcomes.length === 0) return null;

  const ntSet = new Set(nt.split(' ').filter(Boolean));
  const tg = groupOfDetailed(nt);

  let best = null; // { rule, via, conf, outcome }
  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== 'object') continue;
    const cand = ruleFor(outcome, nt, ntSet, tg);
    if (!cand) continue;
    if (best === null || cand.rule < best.rule) {
      best = { ...cand, outcome };
    }
    // Equal rule number: keep the earlier outcome (list order wins).
  }
  if (!best) return null;

  return {
    outcomeId: best.outcome.id,
    level: best.outcome.level,
    confidence: best.conf,
    matchedVia: best.via,
  };
}
