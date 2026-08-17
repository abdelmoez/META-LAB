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
const TERM_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}'’./+-]*$/u;

/**
 * 120.md r2 — UNICODE NORMALIZATION, before anything looks at the characters.
 *
 * Text extracted from a PDF or copied from macOS arrives DECOMPOSED (NFD): `naïve`
 * is `n a i` + U+0308 COMBINING DIAERESIS. Combining marks are `\p{M}`, not `\p{L}`,
 * so the raw form failed TERM_RE and the researcher was told "A term must start with
 * a letter or digit" about a word that plainly starts with one — and the word could
 * never be added in the form the manuscript actually contains. Normalizing to NFC
 * first makes the composed and decomposed spellings ONE term, which is also what the
 * `(scope, termLower)` uniqueness key needs: two encodings of one word are one entry.
 * `\p{M}` stays allowed in the continuation class for the scripts whose marks have no
 * composed form at all.
 */
const nfc = (s) => (typeof s.normalize === 'function' ? s.normalize('NFC') : s);

/**
 * Validate + normalize one submitted entry.
 *
 * @returns {{ok:true, entry:object} | {ok:false, error:string}}
 */
export function normalizeDictionaryInput(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const term = nfc(String(src.term ?? '').trim());
  if (!term) return { ok: false, error: 'A term is required' };
  if (term.length > WA_TERM_MAX) {
    return { ok: false, error: `A term may be at most ${WA_TERM_MAX} characters` };
  }
  if (/\s/.test(term)) return { ok: false, error: 'A term may not contain spaces' };
  if (!TERM_RE.test(term)) return { ok: false, error: 'A term must start with a letter or digit' };

  /**
   * 120.md r2 — the optional fields carry the same CHARACTER contract as the term.
   *
   * `term` is locked to a strict charset, but preferredSpelling/expansion were only
   * trimmed and length-capped, so any code point at all was accepted: a U+0000 makes
   * Postgres reject the INSERT (a 400 turning into a 500 on the Postgres deployment),
   * and a bidi override or a raw newline is stored and fanned out to every project
   * member's browser and worker on each dictionary sync. Control and format
   * characters are refused here, once, for both callers — and the value is NFC
   * normalized for the same reason the term is.
   */
  const optional = (value, label) => {
    if (value == null || value === '') return null;
    const s = nfc(String(value).trim());
    if (!s) return null;
    if (s.length > WA_FIELD_MAX) throw new Error(`${label} may be at most ${WA_FIELD_MAX} characters`);
    if (/[\p{Cc}\p{Cf}]/u.test(s)) throw new Error(`${label} contains unsupported characters`);
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
        // 120.md r2 — re-normalized AFTER lowercasing: case mapping can decompose
        // (U+1E9E ẞ → ß, U+0130 İ → i + U+0307), so the key would otherwise depend
        // on which spelling of a word the researcher happened to submit.
        termLower: nfc(term.toLowerCase()),
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
