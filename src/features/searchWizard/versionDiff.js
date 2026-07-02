/**
 * versionDiff.js — 69.md. Pure formatter that turns the server's version-compare `diff`
 * payload into readable, grouped lists (concepts/terms added & removed, database changes,
 * filter changes). The server work owns the exact diff shape; because it may still be
 * landing, this reader is DEFENSIVE — it accepts the documented shape and a couple of
 * near-equivalent spellings, and silently omits any group it can't find. Never throws.
 *
 * Output: [{ title, items:[{ kind:'added'|'removed'|'changed', text }] }] — only
 * non-empty groups, in a stable order. Deterministic + exported for unit tests.
 */

/** Coerce any value into an array of display strings. */
function asStrings(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => {
    if (x == null) return '';
    if (typeof x === 'string') return x;
    // Common term/concept object spellings.
    if (typeof x === 'object') return String(x.text || x.label || x.name || x.id || JSON.stringify(x));
    return String(x);
  }).filter(Boolean);
}

/** Pull an { added, removed } pair from a diff sub-object under any of the given keys. */
function pickAddedRemoved(diff, keys) {
  for (const k of keys) {
    const node = diff && diff[k];
    if (node && typeof node === 'object' && (('added' in node) || ('removed' in node) || ('changed' in node))) {
      return { added: asStrings(node.added), removed: asStrings(node.removed), changed: asStrings(node.changed) };
    }
  }
  return { added: [], removed: [], changed: [] };
}

function group(title, { added = [], removed = [], changed = [] }) {
  const items = [
    ...added.map((text) => ({ kind: 'added', text })),
    ...removed.map((text) => ({ kind: 'removed', text })),
    ...changed.map((text) => ({ kind: 'changed', text })),
  ];
  return items.length ? { title, items } : null;
}

/**
 * formatVersionDiff(diff) → [{ title, items:[{kind,text}] }] (only non-empty groups).
 * Accepts null/undefined (→ []). Pure.
 */
export function formatVersionDiff(diff) {
  if (!diff || typeof diff !== 'object') return [];
  const groups = [
    group('Concepts', pickAddedRemoved(diff, ['concepts', 'concept'])),
    group('Terms', pickAddedRemoved(diff, ['terms', 'term', 'keywords'])),
    group('Databases', pickAddedRemoved(diff, ['databases', 'database', 'sources'])),
    group('Filters & limits', pickAddedRemoved(diff, ['filters', 'filter', 'limits'])),
  ].filter(Boolean);

  // Fallback: some servers emit a flat { added:[], removed:[] } with no sub-grouping.
  if (!groups.length) {
    const flat = group('Changes', { added: asStrings(diff.added), removed: asStrings(diff.removed), changed: asStrings(diff.changed) });
    if (flat) groups.push(flat);
  }
  return groups;
}
