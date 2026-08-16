/**
 * manuscript/placeholders.js — 102.md. Manual-input placeholders: the bracketed
 * fields a draft leaves behind for the researcher to complete.
 *
 * ── THE HARD PART IS §7, NOT §1 ─────────────────────────────────────────────
 * Detecting `[...]` is trivial. Detecting it WITHOUT claiming the square brackets
 * that legitimately saturate scientific prose is the whole problem:
 *
 *     [1]  [1-3]  [12, 15]            numeric citation markers
 *     [0.82, 1.14]  [95% CI 1.05 to 1.47]   interval notation
 *     [sic]  [emphasis added]  [...]  editorial insertions in quotations
 *     [NCT01234567]  [CRD42026123456]  registry identifiers
 *     [Na+]  [H2O]                     chemical notation
 *
 * Turning any of those into an editable "manual field" would be worse than not
 * shipping the feature. So this module is DEFAULT-DENY: a bracketed span is a
 * placeholder only when it positively matches a known generated label or an
 * imperative-instruction shape. Everything else is left alone as ordinary text.
 *
 * §7 also invites "an internal placeholder metadata/type instead of relying
 * exclusively on parsing". That is what `PLACEHOLDER_KINDS` and the
 * `GENERATED_PLACEHOLDERS` registry are: generated placeholders are matched by
 * identity against a declared catalogue, and the heuristic only ever has to cover
 * hand-typed or legacy text.
 *
 * ── TWO KINDS, AND WHY THE DIFFERENCE MATTERS SCIENTIFICALLY ────────────────
 *   'manual'  — prose only the researcher can write ("State the review objective").
 *               These are the fields §5's counter counts and §2 navigates.
 *   'pending' — a fact the PROJECT will supply once the work is done ("No completed
 *               search on record"). The researcher resolves these by running the
 *               search, not by typing. Typing over one would assert methodology that
 *               never happened — exactly the fabrication 101.md §17 forbids — so
 *               they are surfaced separately and never counted as "manual fields
 *               remaining".
 *
 * Pure — no DOM/React/network/Date.
 */

import { draftSectionTypes } from './model.js';

export const PLACEHOLDER_KINDS = Object.freeze(['manual', 'pending']);

/**
 * The imperative openers the draft generator uses. A bracketed span that starts
 * with one of these is an instruction to the author, not notation.
 */
const IMPERATIVE_VERBS = [
  'add', 'state', 'describe', 'specify', 'enter', 'insert', 'provide', 'list',
  'report', 'summarise', 'summarize', 'explain', 'interpret', 'compare', 'confirm',
  'verify', 'update', 'replace', 'choose', 'select', 'define', 'note', 'briefly',
  'outline', 'name', 'indicate', 'record', 'complete', 'write', 'give', 'set',
];

/**
 * Shapes that mean "the project does not have this yet". Kept as patterns rather
 * than a fixed list so a new generator string is classified correctly the day it
 * is written, instead of silently becoming a 'manual' field the user could
 * fabricate an answer into.
 */
const PENDING_PATTERNS = [
  /^no\s+\S/i,                        // "No completed search on record"
  /^number of .+ unavailable$/i,      // "Number of included studies unavailable"
  /\bunavailable\b/i,
  /\bnot yet available\b/i,           // factTokens.js factPlaceholder()
  /\bnot recorded\b/i,                // methodsText.js PLACEHOLDER
  /\bincomplete\b/i,                  // "Risk-of-bias assessment incomplete"
  /\bnot entered\b/i,
];

/**
 * Explicit catalogue of the placeholder labels PecanRev itself generates, with the
 * kind each one carries. Matched by identity, so generated content never depends on
 * the heuristic at all. Anything absent here still gets classified by shape.
 *
 * Only the entries whose kind the heuristic would get WRONG need to be listed; the
 * rest are here for documentation and to make the catalogue greppable when a
 * generator string changes.
 */
export const GENERATED_PLACEHOLDERS = Object.freeze({
  // ── pending: the project supplies these, the user must not type them ──────
  'No completed search on record': 'pending',
  'No database search has been recorded': 'pending',
  'No included studies with extracted data yet': 'pending',
  'Number of included studies unavailable': 'pending',
  'Number of records identified unavailable': 'pending',
  'Risk-of-bias assessment incomplete': 'pending',
  'not recorded — please complete': 'pending',
  // ── manual: genuine authorial input ───────────────────────────────────────
  'State the review objective (PICO)': 'manual',
  'State the importance of the question': 'manual',
  'State the primary outcome': 'manual',
  'State the bottom-line conclusion, cautiously': 'manual',
  'Add the clinical importance': 'manual',
  'Add a descriptive title': 'manual',
  'Add 1–2 sentences of rationale': 'manual',
  'Describe the PICO framing of the question': 'manual',
  'Describe the synthesis approach': 'manual',
  'Interpret the direction and clinical importance': 'manual',
  'state your review question': 'manual',
});

/* ════════════ the deny rules (§7) ════════════ */

/** Editorial insertions that belong to a quotation, not to us. */
const EDITORIAL = /^(sic|\.\.\.|…|emphasis added|emphasis mine|our translation|translated|original emphasis|author'?s? emphasis|citation needed)$/i;

/** Trial/protocol/registry identifiers. */
const IDENTIFIER = /^(NCT\d+|CRD\d+|ISRCTN\d+|PROSPERO\s*\S+|EUCTR\S+|ACTRN\d+|ChiCTR\S+|DOI:\s*\S+|PMID:?\s*\d+)$/i;

/**
 * True when a bracketed span is notation rather than prose: citation markers,
 * intervals, ranges, chemical formulae, page refs — anything with no ordinary
 * lower-case word in it, or built only from numbers and separators.
 */
function isNotation(inner) {
  const s = String(inner).trim();
  if (!s) return true;
  // Purely numeric / ranges / lists: [1] [1-3] [12, 15] [0.82, 1.14] [1–3;5]
  if (/^[\d\s.,;:+\-–—/()%]+$/.test(s)) return true;
  // Confidence intervals and statistics, even when they carry a few letters.
  if (/^\d|\bCI\b|\bIQR\b|\bSD\b|\bSE\b|\brange\b/i.test(s) && /\d/.test(s) && s.length <= 40) return true;
  // Chemical-ish / symbol-ish: no lower-case run of 3+ letters anywhere.
  if (!/[a-z]{3}/.test(s)) return true;
  return false;
}

/** A markdown link's text (`[text](url)`) is never a placeholder. */
function followedByLinkTarget(md, endIndex) {
  return md.charAt(endIndex) === '(';
}

/** Part of a `[[token]]`, which belongs to the cite/asset/fact grammars. */
function insideDoubleBracket(md, startIndex, endIndex) {
  return md.charAt(startIndex - 1) === '[' || md.charAt(endIndex) === ']';
}

/* ════════════ classification ════════════ */

/**
 * classifyPlaceholder(label) → 'manual' | 'pending' | null.
 * `null` means "this is ordinary text, leave it alone" — the default.
 * Pure.
 */
export function classifyPlaceholder(label) {
  const s = String(label == null ? '' : label).trim();
  if (!s || s.length < 3) return null;

  // 1. Declared catalogue wins outright (§7's "internal placeholder type").
  if (Object.prototype.hasOwnProperty.call(GENERATED_PLACEHOLDERS, s)) {
    return GENERATED_PLACEHOLDERS[s];
  }

  // 2. Never claim quotation apparatus or identifiers.
  if (EDITORIAL.test(s) || IDENTIFIER.test(s)) return null;

  // 3. Never claim notation.
  if (isNotation(s)) return null;

  // 4. Project-supplied gaps.
  for (const re of PENDING_PATTERNS) if (re.test(s)) return 'pending';

  // 5. An imperative instruction to the author.
  const first = s.toLowerCase().match(/^([a-z]+)/);
  if (first && IMPERATIVE_VERBS.includes(first[1])) return 'manual';

  // 6. Default deny (§7). An unrecognised bracketed phrase stays ordinary text.
  return null;
}

/* ════════════ scanning ════════════ */

/**
 * Bracketed spans, non-nested. The callback applies the deny rules that need the
 * surrounding characters (links, `[[tokens]]`), which a lookbehind-free regex
 * cannot express on its own.
 */
const BRACKET_RE = /\[([^[\]]+)\]/g;

/** Stable id for a placeholder occurrence — section + ordinal, not the text. */
function placeholderId(sectionId, ordinal) {
  return `ph_${sectionId || 'x'}_${ordinal}`;
}

/**
 * findPlaceholders(md, sectionId) → occurrences in ONE markdown string.
 * @returns {Array<{ id, label, kind, index, length, raw, sectionId, ordinal }>}
 * Pure.
 */
export function findPlaceholders(md, sectionId = '') {
  const s = String(md == null ? '' : md);
  const out = [];
  const re = new RegExp(BRACKET_RE.source, 'g');
  let m;
  let ordinal = 0;
  while ((m = re.exec(s)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (insideDoubleBracket(s, start, end)) continue;
    if (followedByLinkTarget(s, end)) continue;
    const kind = classifyPlaceholder(m[1]);
    if (!kind) continue;
    out.push({
      id: placeholderId(sectionId, ordinal),
      label: m[1].trim(),
      kind,
      index: start,
      length: m[0].length,
      raw: m[0],
      sectionId,
      ordinal,
    });
    ordinal += 1;
  }
  return out;
}

/**
 * collectPlaceholders(draft) → every placeholder across the whole manuscript, in
 * canonical section order (§2 "across the entire manuscript, even if placeholders
 * exist in different sections").
 *
 * Statements (funding, conflicts, ethics…) are scanned too — "[State the funding
 * source, or “None.”]" is exactly the kind of field §81 says must be impossible to
 * overlook.
 *
 * @returns {Array<placeholder & { sectionLabel, group }>}
 * Pure.
 */
export function collectPlaceholders(draft) {
  const d = draft || {};
  const sections = d.sections || {};
  const out = [];
  // 119.md §7 — the draft's own sections (template set + preserved content).
  for (const s of draftSectionTypes(d)) {
    const content = (sections[s.id] && sections[s.id].content) || '';
    for (const p of findPlaceholders(content, s.id)) {
      out.push({ ...p, sectionLabel: s.label, group: 'section' });
    }
  }
  const statements = d.statements || {};
  for (const key of Object.keys(statements)) {
    for (const p of findPlaceholders(statements[key], key)) {
      out.push({ ...p, sectionLabel: statementLabel(key), group: 'statement' });
    }
  }
  return out;
}

const STATEMENT_LABELS = Object.freeze({
  funding: 'Funding', conflicts: 'Conflicts of interest',
  dataAvailability: 'Data availability', acknowledgments: 'Acknowledgments',
  ethics: 'Ethics approval', registration: 'Registration',
});

function statementLabel(key) {
  return STATEMENT_LABELS[key] || key;
}

/**
 * Counts for the §5 indicator. `manual` is the number shown as "N manual fields
 * remaining"; `pending` is reported separately because the researcher cannot type
 * their way out of one.
 * Pure.
 */
export function placeholderCounts(list) {
  const arr = Array.isArray(list) ? list : [];
  let manual = 0;
  let pending = 0;
  for (const p of arr) {
    if (p.kind === 'pending') pending += 1;
    else manual += 1;
  }
  return { manual, pending, total: arr.length };
}

/**
 * Group placeholders by section for the §5 list ("see which manuscript section
 * contains each unresolved field").
 * @returns {Array<{ sectionId, sectionLabel, group, items, manual, pending }>}
 * Pure.
 */
export function groupPlaceholders(list) {
  const arr = Array.isArray(list) ? list : [];
  const order = [];
  const by = new Map();
  for (const p of arr) {
    if (!by.has(p.sectionId)) {
      by.set(p.sectionId, {
        sectionId: p.sectionId, sectionLabel: p.sectionLabel, group: p.group,
        items: [], manual: 0, pending: 0,
      });
      order.push(p.sectionId);
    }
    const g = by.get(p.sectionId);
    g.items.push(p);
    if (p.kind === 'pending') g.pending += 1; else g.manual += 1;
  }
  return order.map((id) => by.get(id));
}

/**
 * The next/previous placeholder relative to a current id, wrapping around (§2).
 * `kind` optionally restricts the walk to one kind — the toolbar walks 'manual'
 * fields, because stepping a researcher into a field they must not type in would
 * be a dead end.
 * Pure.
 */
export function stepPlaceholder(list, currentId, direction = 1, kind = 'manual') {
  const arr = (Array.isArray(list) ? list : []).filter((p) => !kind || p.kind === kind);
  if (!arr.length) return null;
  const at = arr.findIndex((p) => p.id === currentId);
  if (at < 0) return direction >= 0 ? arr[0] : arr[arr.length - 1];
  const next = (at + (direction >= 0 ? 1 : -1) + arr.length) % arr.length;
  return arr[next];
}

/** The tooltip §4 asks for, differentiated by kind so it is never misleading. */
export function placeholderTitle(kind) {
  return kind === 'pending'
    ? 'Awaiting project data — complete this step in the project, not by typing'
    : 'Manual input required';
}

/**
 * Where a 'pending' field actually gets resolved.
 *
 * Telling a researcher a field is "awaiting project data" and stopping there leaves
 * them with nowhere to go — and the likeliest next move is to type over it, which is
 * the one thing that must not happen (101.md §17). So each pending shape names the
 * engine that fills it and the step that does so.
 *
 * Ordered most-specific first; the first match wins.
 */
const PENDING_ROUTES = [
  {
    test: /\bsearch\b/i,
    engine: 'search', engineLabel: 'Search Engine',
    action: 'Run or import a database search — the databases and the date are read from the search record.',
  },
  {
    test: /\brisk[- ]of[- ]bias\b|\bquality assessment\b/i,
    engine: 'rob', engineLabel: 'Risk of Bias',
    action: 'Complete a risk-of-bias assessment for at least one study.',
  },
  {
    test: /\bincluded studies\b|\bextracted data\b|\bextraction\b/i,
    engine: 'extraction', engineLabel: 'Extraction Engine',
    action: 'Extract outcome data for the included studies.',
  },
  {
    test: /\brecords identified\b|\bscreen/i,
    engine: 'screening', engineLabel: 'Screening Engine',
    action: 'Import records and screen them — PRISMA counts come from the screening data.',
  },
  {
    test: /\banalys[ie]s\b|\bsynthesis\b|\bpooled\b/i,
    engine: 'analysis', engineLabel: 'Analysis Engine',
    action: 'Run the meta-analysis once at least two studies have effect estimates.',
  },
];

/**
 * resolutionHint(placeholder) → { engine, engineLabel, action } | null.
 * `null` for a manual field: the researcher IS the resolution.
 * Pure.
 */
export function resolutionHint(placeholder) {
  const p = placeholder || {};
  if (p.kind !== 'pending') return null;
  const label = String(p.label || '');
  for (const r of PENDING_ROUTES) {
    if (r.test.test(label)) return { engine: r.engine, engineLabel: r.engineLabel, action: r.action };
  }
  return {
    engine: '', engineLabel: 'Project data',
    action: 'This fills in automatically once the corresponding project step is complete.',
  };
}

export default {
  PLACEHOLDER_KINDS,
  GENERATED_PLACEHOLDERS,
  classifyPlaceholder,
  findPlaceholders,
  collectPlaceholders,
  placeholderCounts,
  groupPlaceholders,
  stepPlaceholder,
  placeholderTitle,
  resolutionHint,
};
