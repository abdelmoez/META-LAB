/**
 * uiShared.js — 85.md A2. Tiny pure helpers shared by the redesigned Search Builder
 * leaf components (ConceptCards / ConceptNavigator / TermChipRow / StrategyPreview…).
 *
 * Pure + deterministic, no React/DOM/network — unit-testable directly.
 */
import { CB_SERIES } from '../../../frontend/theme/tokens.js';

/** Concept identity accent — CVD-safe Okabe–Ito series (secondary signal ONLY:
 *  used as a border-left tint, never the sole carrier of meaning). */
export function conceptAccent(index) {
  const i = Number.isInteger(index) && index >= 0 ? index : 0;
  return CB_SERIES[i % CB_SERIES.length];
}

/** Non-color status glyphs for conceptStatus values (chips/pills pair glyph+text). */
export const CONCEPT_STATUS_GLYPH = {
  empty: '○',
  'needs-review': '◐',
  'mesh-suggested': '◍',
  ready: '●',
};

/**
 * What a term chip DISPLAYS — the SEARCHED term, honestly:
 *  - controlled + matched vocab → the descriptor (with a MeSH badge); the user's
 *    original text rides as `secondary` when it differs;
 *  - controlled + NO vocab match → the raw text flagged `unmatched` (an explicit
 *    warning state: the heading doesn't exist, so it would match nothing);
 *  - freetext → the term text.
 * Pure.
 */
export function termDisplay(term) {
  const t = term || {};
  const text = String(t.text || '').trim();
  if (t.type === 'controlled') {
    const mesh = t.vocab && typeof t.vocab === 'object' ? String(t.vocab.mesh || '').trim() : '';
    if (mesh) {
      const secondary = text && text.toLowerCase() !== mesh.toLowerCase() ? text : null;
      return { main: mesh, kind: 'controlled', secondary, unmatched: false };
    }
    return { main: text, kind: 'controlled', secondary: null, unmatched: true };
  }
  return { main: text, kind: 'freetext', secondary: null, unmatched: false };
}

/**
 * The tiny text micro-badges a chip carries (visible in beginner mode too — they
 * change recall and must never be hidden): non-default field scope, truncation,
 * exact phrase, disabled. Pure; ordered.
 */
export function termMicroBadges(term) {
  const t = term || {};
  const out = [];
  if (t.type !== 'controlled') {
    if (t.field === 'ti') out.push({ key: 'field', label: 'title only' });
    else if (t.field === 'all') out.push({ key: 'field', label: 'everywhere' });
    if (t.truncate && !String(t.text || '').includes(' ')) out.push({ key: 'truncate', label: 'endings*' });
    if (t.phrase && String(t.text || '').includes(' ')) out.push({ key: 'phrase', label: 'phrase' });
  }
  if (t.disabled === true) out.push({ key: 'off', label: 'off' });
  return out;
}

/** Human joiner copy for the read-only beginner op indicator. */
export function opExplainer(op) {
  return op === 'OR'
    ? 'Combined with the next concept using OR — records matching EITHER concept are included.'
    : 'Combined with the next concept using AND — records must match BOTH concepts.';
}
