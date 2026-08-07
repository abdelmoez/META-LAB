/**
 * vocabulary/canonical.js — 100.md §4. The CANONICAL SEMANTIC CONCEPT: the
 * database-independent meaning a controlled-vocabulary selection stands for.
 *
 * Before this module the compilers were coupled to MeSH: every renderer reached into
 * `term.vocab.mesh` and pasted that PubMed string into its own subject-heading syntax
 * (`(MH "Diabetes Mellitus, Type 2+")`, `DE "Diabetes Mellitus, Type 2"`,
 * `INDEXTERMS("…")`, `MAINSUBJECT.EXACT("…")`). That is the exact failure 100.md §3
 * names — PubMed syntax copied blindly into databases that index a DIFFERENT
 * thesaurus, producing subject headings that may not exist.
 *
 * The pipeline is now:
 *
 *     user concept
 *          ↓   toCanonicalConcept()          ← this module
 *     canonical semantic concept
 *          ↓   translateConcept()            ← mappings.js
 *     controlled-vocabulary mapping (or an honest "no equivalent")
 *          ↓   runRenderer()                 ← compilers/shared.js
 *     database adapter → PubMed / Embase / CINAHL / … representation
 *
 * NOTHING here is MeSH-specific except the default `sourceSystem`; a term sourced from
 * another thesaurus only has to arrive with a different `vocab.system` value.
 *
 * PURE + deterministic (no app / DOM / I/O / network) so it is unit-testable directly.
 */

const S = (v) => String(v == null ? '' : v);

/** Longest inverted MeSH heading we will de-inspect (guards pathological input). */
const MAX_LABEL = 300;

/**
 * naturalOrderLabel — turn a comma-INVERTED thesaurus heading into the natural word
 * order a paper actually uses, which is what a free-text fallback has to search:
 *
 *   "Diabetes Mellitus, Type 2"      → "Type 2 Diabetes Mellitus"
 *   "Heart Failure, Systolic"        → "Systolic Heart Failure"
 *   "Arthritis, Rheumatoid"          → "Rheumatoid Arthritis"
 *   "Myocardial Infarction"          → "Myocardial Infarction"   (already natural)
 *
 * Inverted headings are a cataloguing convention (the significant word leads so the
 * printed index sorts usefully); no author writes "diabetes mellitus, type 2" in an
 * abstract, so searching the raw heading as a phrase silently loses nearly every hit.
 * De-inversion moves every trailing comma-segment in front of the lead segment, in
 * reverse order, which is the documented inversion rule.
 *
 * Casing is preserved (databases match free text case-insensitively, and the natural
 * form is shown to the user in the plain-language explanation).
 *
 * This is a presentation transform of a term we already hold — NOT a claim that some
 * other database indexes this string. Mapping claims live in mappings.js.
 */
export function naturalOrderLabel(label) {
  const s = S(label).trim().slice(0, MAX_LABEL);
  if (!s) return '';
  // Parenthetical qualifiers MeSH appends for disambiguation ("Cranial Nerves
  // (Anatomy)") are left alone; only a comma matters here.
  const parts = s.split(/\s*,\s+/).map((p) => p.trim()).filter(Boolean);

  // ── When NOT to de-invert ──────────────────────────────────────────────────
  // A comma in a MeSH heading is not always an inversion. Reversing the segments of
  // an ENUMERATION or a check-tag produces a phrase that exists nowhere:
  //   "Health Knowledge, Attitudes, Practice" → "Practice Attitudes Health Knowledge"
  //   "Infant, Newborn, Diseases"             → "Diseases Newborn Infant"
  //   "Aged, 80 and over"                     → "80 and over Aged"
  // Those clauses return zero in every database — the exact recall loss this layer
  // exists to prevent, in the opposite direction. So de-invert ONLY the classic
  // two-segment "significant term, modifier" form, and only when the trailing segment
  // reads as a modifier: it starts with a letter (not a digit or a range) and carries
  // no conjunction.
  if (parts.length !== 2) return s;
  const [lead, qualifier] = parts;
  if (!/^[A-Za-z(]/.test(qualifier)) return s;
  if (/\b(and|or)\b/i.test(qualifier)) return s;
  return `${qualifier} ${lead}`;
}

/** Unique, order-preserving, case-insensitive. */
function uniqCI(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const v = S(raw).trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * freeTextFormsFor — the ordered phrase list a database WITHOUT a verified equivalent
 * heading searches instead (100.md §3: "use the underlying concept as a properly
 * formatted plain-text/free-text search term … rather than generating fake database
 * syntax").
 *
 * Deliberately ONE deterministic phrase: the natural-order label — what papers
 * actually write, and exactly the shape 100.md §3 asks for
 * ("type 2 diabetes mellitus"). The comma-inverted indexed form is NOT added: no
 * abstract contains it, so it would only cost an OR clause, query characters (Google
 * Scholar caps at ~256) and a confusing line in the plain-language explanation.
 *
 * Entry terms / synonyms are NOT auto-expanded either: a MeSH descriptor can carry 40
 * of them, which would bury the user's own synonym choices. The user's free-text
 * synonyms stay their own terms (100.md §5) and the suggestion panel already offers
 * entry terms one at a time.
 *
 * Returns an ARRAY so a future vocabulary (or a user preference for entry-term
 * expansion) can widen the fallback without touching a single renderer.
 */
export function freeTextFormsFor({ preferredLabel, naturalLabel, rawText }) {
  const chosen = uniqCI([S(naturalLabel).trim(), S(preferredLabel).trim(), S(rawText).trim()])[0] || '';
  if (!chosen) return [];
  // A heading naturalOrderLabel declined to de-invert (an enumeration such as "Health
  // Knowledge, Attitudes, Practice", or a check-tag such as "Aged, 80 and over") still
  // carries its comma, and no paper contains that string as a phrase. Search its LEAD
  // segment instead: by the cataloguing convention that IS the significant term, so the
  // clause is broader than intended but never nonsense and never zero.
  const form = chosen.includes(',') ? chosen.split(/\s*,\s*/)[0].trim() : chosen;
  return form ? [form] : [];
}

/**
 * toCanonicalConcept(term) — one saved/normalized term → the canonical concept it
 * represents. Accepts junk safely and never throws.
 *
 * Shape:
 *   {
 *     sourceSystem : 'mesh' | 'none' | <whatever vocab.system says>
 *     sourceId     : thesaurus identifier ('D003924') or ''
 *     preferredLabel: the thesaurus's preferred/indexed term
 *     naturalLabel : de-inverted, lower-cased reading of preferredLabel
 *     entryTerms   : the thesaurus's entry terms / synonyms (informational)
 *     narrower     : direct narrower descriptors (informational; drives the
 *                    "explosion cannot be reproduced in free text" note)
 *     explode      : true when the user wants narrower topics included
 *     rawText      : what the user originally typed
 *     freeTextForms: the fallback phrase list (see freeTextFormsFor)
 *   }
 */
export function toCanonicalConcept(term) {
  const t = term && typeof term === 'object' ? term : {};
  const vocab = t.vocab && typeof t.vocab === 'object' ? t.vocab : null;
  const rawText = S(t.text).trim();

  // `vocab.system` is the forward-compatible seam: a term sourced from a thesaurus
  // other than MeSH only has to say so. Everything the product writes today is MeSH,
  // and a controlled term with NO vocab record is a heading the user asserted by hand.
  const declared = vocab && S(vocab.system).trim().toLowerCase();
  const preferredLabel = S(vocab && (vocab.mesh || vocab.heading || vocab.label)).trim() || rawText;
  const sourceSystem = declared || (vocab && (vocab.mesh || vocab.heading) ? 'mesh' : (rawText ? 'mesh' : 'none'));

  const naturalLabel = naturalOrderLabel(preferredLabel);
  const entryTerms = uniqCI(Array.isArray(vocab && vocab.synonyms) ? vocab.synonyms : []);
  const narrower = uniqCI(Array.isArray(vocab && vocab.children) ? vocab.children : []);

  return {
    sourceSystem: preferredLabel ? sourceSystem : 'none',
    sourceId: S(vocab && (vocab.meshUI || vocab.id)).trim(),
    preferredLabel,
    naturalLabel,
    entryTerms,
    narrower,
    explode: !t.noExplode,
    rawText,
    freeTextForms: freeTextFormsFor({ preferredLabel, naturalLabel, rawText }),
  };
}

export default toCanonicalConcept;
