/**
 * shared/writingAssistantDictionary.js — 120.md §6 "Dictionary scopes".
 *
 * The ONE definition of what a dictionary entry is, imported by BOTH the browser
 * (writingAssistant/waState.js, the suggestion card's "Add to dictionary" actions)
 * and the server (server/controllers/dictionaryController.js). The
 * opsSettingsCatalog precedent: a rule that two sides must agree on lives in
 * src/shared and is imported, never hand-copied.
 *
 * §6 asks for normalization that "does not destroy meaningful capitalization": TP53,
 * BRCA1 and mAb are not tp53, brca1 and mab. So `term` keeps EXACTLY what the
 * researcher typed and `termLower` exists only as the uniqueness key.
 *
 * PRIVACY (§6): a dictionary entry is a WORD. Nothing here carries a sentence, a
 * document id or any manuscript context — there is no shape in which it could.
 */

/** §6 — "size caps per entry" and per scope, so one user cannot fill a table. */
export const WA_TERM_MAX = 64;
export const WA_FIELD_MAX = 128;
export const WA_SCOPE_MAX = 2000;

/** §6 "Optional category". Free-form is rejected so the values stay filterable. */
export const WA_CATEGORIES = Object.freeze([
  'drug', 'trial', 'gene', 'tool', 'organisation', 'measure', 'other',
]);

/** §6 "Source" — who or what put the term in the list. */
export const WA_SOURCES = Object.freeze(['user', 'suggestion', 'import']);

/**
 * A term must be a single lexical unit: an accepted "term" that is a whole sentence
 * would silently accept every word in it. Letters, digits, and the punctuation that
 * genuinely occurs inside scientific tokens (hyphen, apostrophe, slash, dot, plus).
 */
const TERM_RE = /^[\p{L}\p{N}][\p{L}\p{N}'’./+-]*$/u;

/**
 * Validate + normalize one submitted entry.
 *
 * @returns {{ok:true, entry:object} | {ok:false, error:string}}
 */
export function normalizeDictionaryInput(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const term = String(src.term ?? '').trim();
  if (!term) return { ok: false, error: 'A term is required' };
  if (term.length > WA_TERM_MAX) {
    return { ok: false, error: `A term may be at most ${WA_TERM_MAX} characters` };
  }
  if (/\s/.test(term)) return { ok: false, error: 'A term may not contain spaces' };
  if (!TERM_RE.test(term)) return { ok: false, error: 'A term must start with a letter or digit' };

  const optional = (value, label) => {
    if (value == null || value === '') return null;
    const s = String(value).trim();
    if (!s) return null;
    if (s.length > WA_FIELD_MAX) throw new Error(`${label} may be at most ${WA_FIELD_MAX} characters`);
    return s;
  };

  try {
    const category = src.category == null || src.category === '' ? null : String(src.category);
    if (category && !WA_CATEGORIES.includes(category)) {
      return { ok: false, error: 'Unknown category' };
    }
    const source = src.source == null || src.source === '' ? 'user' : String(src.source);
    if (!WA_SOURCES.includes(source)) return { ok: false, error: 'Unknown source' };
    return {
      ok: true,
      entry: {
        term,
        // Locale-independent on purpose: the same key must be produced by the
        // browser and by Node, and `toLocaleLowerCase()` under a Turkish locale
        // maps I to ı, which would let "IBD" and "ıbd" be two different rows.
        termLower: term.toLowerCase(),
        caseSensitive: src.caseSensitive === true,
        preferredSpelling: optional(src.preferredSpelling, 'Preferred spelling'),
        expansion: optional(src.expansion, 'Expansion'),
        category,
        source,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * The public shape of an entry — exactly what the API returns and what the worker's
 * `dict` message carries. Nothing else about the row (its owner's id, its row id's
 * provenance) reaches the checker.
 */
export function publicDictionaryEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    term: row.term,
    caseSensitive: !!row.caseSensitive,
    preferredSpelling: row.preferredSpelling || null,
    expansion: row.expansion || null,
    category: row.category || null,
    source: row.source || 'user',
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    ...(row.addedById !== undefined ? { addedById: row.addedById, addedByName: row.addedByName || '' } : {}),
  };
}
