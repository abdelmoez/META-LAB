/**
 * prisma/reasonFormat.js — 116.md §16/§17. Exclusion-reason display formatting and
 * grouping for the PRISMA flow.
 *
 * Two jobs, deliberately separated:
 *
 *   groupKey(reason)      — the key reasons are AGGREGATED under. Trim, collapse
 *                           internal whitespace, casefold. "Wrong population",
 *                           "wrong population" and "Wrong  population " are one
 *                           row, not three (§17). Grouping only — never displayed.
 *
 *   displayReason(reason) — CONSERVATIVE sentence-case for display. The first
 *                           letter is uppercased ONLY when the first word is
 *                           entirely lowercase; nothing is EVER lowercased, so
 *                           acronyms, drug names, gene names and deliberate
 *                           capitalization survive untouched (§16):
 *                             "wrong population"  → "Wrong population"
 *                             "no MRI outcome"    → "No MRI outcome"   (never "No mri outcome")
 *                             "mRNA vaccine only" → "mRNA vaccine only" (first word not all-lowercase)
 *
 * Neither function ever rewrites the stored string — the researcher's own text
 * stays exactly as entered (§16 "a display formatter is preferable"). Formatting
 * happens where reasons are AGGREGATED (derive.js), which is what the SVG reason
 * lines, the inspector and the manuscript adapter all read, so every surface shows
 * the same label without a second formatter.
 *
 * Pure — no DOM/React/network/Date/Prisma.
 */

const collapse = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

/**
 * The key a reason is grouped under: trimmed, internal whitespace collapsed,
 * casefolded. '' for a blank/unrecorded reason. GROUPING ONLY — never display
 * this (it destroys capitalization by design).
 * Pure.
 */
export function groupKey(reason) {
  return collapse(reason).toLowerCase();
}

/**
 * Conservative sentence-case for display (116.md §16). Whitespace is collapsed
 * (a display concern — the stored string keeps its spaces), then the FIRST
 * character is uppercased only when the first word contains no uppercase letter
 * already. No character is ever lowercased.
 * Pure.
 */
export function displayReason(reason) {
  const s = collapse(reason);
  if (!s) return '';
  const firstWord = (s.match(/^\S+/) || [''])[0];
  // Only touch char 0, and only when the first word is all-lowercase — an
  // existing capital anywhere in it ("mRNA", "pH") means the casing is deliberate.
  if (/^[a-z]/.test(s) && !/[A-Z]/.test(firstWord)) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s;
}

/**
 * The display label for a GROUP of raw reason strings that share one groupKey:
 * the most frequent original casing wins (ties → first seen), then the
 * conservative sentence-case is applied to it. Blank-only input returns ''.
 * Pure.
 */
export function preferredDisplay(rawValues) {
  const counts = new Map();
  for (const v of Array.isArray(rawValues) ? rawValues : []) {
    const s = collapse(v);
    if (!s) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [variant, n] of counts) {
    if (n > bestN) { best = variant; bestN = n; }
  }
  return displayReason(best);
}

export default { groupKey, displayReason, preferredDisplay };
