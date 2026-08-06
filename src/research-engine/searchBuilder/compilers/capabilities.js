/**
 * compilers/capabilities.js — 73.md Part 6. Per-database capability table for the
 * Search-Builder strategy compiler. Booleans + short syntax notes the wave-2 UI shows
 * next to each compiled strategy so a user knows how to paste/run it. Pure data.
 *
 * Fields:
 *   vocabSystem   'mesh'|'emtree'|'cinahl'|'apa'|'decs'|'none' — the thesaurus this
 *                 database is INDEXED with (matches result.vocab.system)
 *   controlledVocab  100.md §3 — true only when Pecan can target that thesaurus with a
 *                 heading it can VERIFY. It is therefore false for Embase (Emtree),
 *                 CINAHL (CINAHL Headings) and PsycInfo (APA Thesaurus): those
 *                 vocabularies are proprietary, no authoritative MeSH crosswalk is
 *                 published, and inventing a heading is exactly what 100.md forbids.
 *                 `vocabSystem` still names the real thesaurus so the compiler can say
 *                 WHICH vocabulary it could not reach; those databases fall back to a
 *                 properly-formatted free-text phrase (see compilers/shared.js).
 *   explosion        supports explode / no-explode CONTROL on subject headings
 *   explosionDefault when explosion is false: 'explode' | 'exact' — which way the
 *                 database's heading field behaves, so the mismatch is reported in the
 *                 right direction instead of a generic "narrower topics were dropped"
 *   fieldTags        supports field-level targeting (title / abstract / …)
 *   phrase           phrase delimiter: 'double' | 'single' | 'none'
 *   truncation       right-truncation wildcard character, or null
 *   truncationMinStem  minimum characters before the wildcard (0 = no documented minimum)
 *   wildcard         single-character wildcard, or null
 *   proximity        { op, syntax } or null
 *   booleans         supported boolean operator forms
 *   filters          { date, language, pubType } — whether the compiler EMBEDS each limit
 *   syntaxLevel      'native' (real, runnable syntax) | 'approximate' (simplified / auto-stemmed)
 *   notes            1–3 short user-facing sentences (how to paste/run)
 */

export const CAPABILITIES = {
  pubmed: {
    id: 'pubmed', label: 'PubMed / MEDLINE',
    vocabSystem: 'mesh', controlledVocab: true, explosion: true, fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: null,
    proximity: { op: 'proximity', syntax: '"a b"[tiab:~N]' },
    booleans: ['AND', 'OR', 'NOT'], filters: { date: true, language: true, pubType: true },
    syntaxLevel: 'native',
    notes: [
      'Paste the whole string into the PubMed search box and press Search — every tag ([Mesh], [tiab], [ti]) is native.',
      'Filters ride inside the query, so you do not need to touch the sidebar limits.',
    ],
  },
  embase: {
    id: 'embase', label: 'Embase',
    // 100.md §3 — Embase is indexed with Emtree, but Emtree is Elsevier-proprietary and
    // no authoritative MeSH↔Emtree crosswalk exists, so Pecan cannot name the equivalent
    // heading. Subject terms compile to verified Embase free text instead of an invented
    // '…'/exp clause.
    vocabSystem: 'emtree', controlledVocab: false, explosion: true, fieldTags: true,
    phrase: 'single', truncation: '*', truncationMinStem: 4, wildcard: '?',
    proximity: { op: 'NEAR/n', syntax: "'a' NEAR/3 'b'" },
    booleans: ['AND', 'OR', 'NOT'], filters: { date: true, language: true, pubType: false },
    syntaxLevel: 'native',
    notes: [
      'Use Embase.com → Search → Quick search (Advanced) and paste the string.',
      'Emtree headings are not generated: no public MeSH↔Emtree crosswalk exists, so your subject terms ride as Embase free text. Add the real Emtree term with /exp through the Edit button if you need heading-level recall.',
      'Apply the publication-type limit from the Embase results-page filters — it is not embedded in the string.',
    ],
  },
  cochrane: {
    id: 'cochrane', label: 'Cochrane Library (CENTRAL)',
    vocabSystem: 'mesh', controlledVocab: true, explosion: true, fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: '?',
    proximity: { op: 'NEAR/n', syntax: '"a" NEAR/3 "b"; NEXT for adjacency' },
    booleans: ['AND', 'OR', 'NOT'], filters: { date: false, language: false, pubType: false },
    syntaxLevel: 'native',
    notes: [
      'Open Cochrane Library → Advanced search → Search manager and paste the string ([mh] = MeSH, :ti,ab,kw = fields).',
      'Set the publication-date limit with the Cochrane date picker after running — CENTRAL does not take a date limit inside the string.',
    ],
  },
  clinicaltrials: {
    id: 'clinicaltrials', label: 'ClinicalTrials.gov',
    vocabSystem: 'none', controlledVocab: false, explosion: false, fieldTags: false,
    phrase: 'double', truncation: null, truncationMinStem: 0, wildcard: null,
    proximity: null,
    booleans: ['AND', 'OR', 'NOT'], filters: { date: false, language: false, pubType: false },
    syntaxLevel: 'native',
    notes: [
      'Paste into the ClinicalTrials.gov search box; it uses an Essie expression with AND/OR/NOT and quoted phrases.',
      'Field targeting is limited — use the AREA[...] operators or the site filters to scope by condition, intervention, or status.',
    ],
  },
  ictrp: {
    id: 'ictrp', label: 'WHO ICTRP',
    vocabSystem: 'none', controlledVocab: false, explosion: false, fieldTags: false,
    phrase: 'double', truncation: null, truncationMinStem: 0, wildcard: null,
    proximity: null,
    booleans: ['AND', 'OR'], filters: { date: false, language: false, pubType: false },
    syntaxLevel: 'native',
    notes: [
      'Use the ICTRP Advanced search and paste the string — only AND/OR and quoted phrases are supported.',
      'Controlled vocabulary (MeSH), field tags, and truncation are not available; run several simpler searches if needed.',
    ],
  },
  scopus: {
    id: 'scopus', label: 'Scopus',
    vocabSystem: 'none', controlledVocab: false, explosion: false, fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: '?',
    proximity: { op: 'W/n', syntax: '"a" W/3 "b" (PRE/n for order)' },
    booleans: ['AND', 'OR', 'AND NOT'], filters: { date: true, language: true, pubType: false },
    syntaxLevel: 'native',
    notes: [
      'Paste into Scopus → Advanced document search; TITLE-ABS-KEY() covers title, abstract, and keywords.',
      'Scopus indexes no medical subject-heading thesaurus, so your subject terms ride as TITLE-ABS-KEY free text — which already reaches Scopus\'s own author and index keywords.',
    ],
  },
  wos: {
    id: 'wos', label: 'Web of Science',
    vocabSystem: 'none', controlledVocab: false, explosion: false, fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: '$',
    proximity: { op: 'NEAR/n', syntax: '"a" NEAR/3 "b"' },
    booleans: ['AND', 'OR', 'NOT'], filters: { date: true, language: true, pubType: false },
    syntaxLevel: 'native',
    notes: [
      'Paste into the Web of Science Advanced Search; TS= is Topic (title, abstract, keywords), TI= is title only.',
      'Web of Science has no subject-heading thesaurus, so your subject terms ride as Topic text in natural word order ($ is its single-character wildcard).',
    ],
  },
  gscholar: {
    id: 'gscholar', label: 'Google Scholar',
    vocabSystem: 'none', controlledVocab: false, explosion: false, fieldTags: false,
    phrase: 'double', truncation: null, truncationMinStem: 0, wildcard: null,
    proximity: null,
    booleans: ['AND', 'OR'], filters: { date: false, language: false, pubType: false },
    syntaxLevel: 'approximate',
    notes: [
      'Google Scholar is a simplified search: quoted phrases and OR only, and it auto-stems (no truncation wildcard).',
      'Keep it under ~256 characters and set year / language in the Advanced search (the left-hand ▾ menu).',
    ],
  },
  cinahl: {
    id: 'cinahl', label: 'CINAHL',
    // 100.md §3 — CINAHL Headings are an EBSCO thesaurus with no published MeSH
    // crosswalk; pasting a MeSH string into (MH "…") silently returns zero whenever the
    // two vocabularies word a concept differently. Free text is the honest translation.
    vocabSystem: 'cinahl', controlledVocab: false, explosion: true, fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: '#',
    proximity: { op: 'N/n', syntax: 'a N3 b (W/n for order)' },
    booleans: ['AND', 'OR', 'NOT'], filters: { date: true, language: true, pubType: true },
    syntaxLevel: 'native',
    notes: [
      'Paste into CINAHL (EBSCOhost) Advanced Search; TI/AB are its field codes and the limits ride inside the string.',
      'CINAHL Headings are not generated: EBSCO publishes no MeSH crosswalk, so your subject terms ride as CINAHL free text. Look the heading up in the CINAHL Headings browser and add (MH "Heading+") through the Edit button when you need it.',
    ],
  },
  psycinfo: {
    id: 'psycinfo', label: 'PsycINFO',
    // 100.md §3 — the APA Thesaurus of Psychological Index Terms is proprietary and
    // worded quite differently from MeSH; DE "<MeSH heading>" matched almost nothing.
    vocabSystem: 'apa', controlledVocab: false, explosion: true, fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: '#',
    proximity: { op: 'N/n', syntax: 'a N3 b (W/n for order)' },
    booleans: ['AND', 'OR', 'NOT'], filters: { date: true, language: true, pubType: true },
    syntaxLevel: 'native',
    notes: [
      'Paste into APA PsycInfo (EBSCOhost) Advanced Search; TI/AB are its field codes and the limits ride inside the string.',
      'APA descriptors are not generated: the APA Thesaurus has no public MeSH crosswalk, so your subject terms ride as PsycInfo free text. Add DE "descriptor" through the Edit button once you have looked the term up.',
    ],
  },
  proquest: {
    id: 'proquest', label: 'ProQuest Dissertations & Theses',
    vocabSystem: 'none', controlledVocab: false, explosion: false, fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: '?',
    proximity: { op: 'NEAR/n', syntax: 'a NEAR/3 b (PRE/n for order)' },
    booleans: ['AND', 'OR', 'NOT'], filters: { date: false, language: false, pubType: false },
    syntaxLevel: 'native',
    notes: [
      'Paste into ProQuest Advanced Search; TI,AB(...) scopes to title + abstract.',
      'ProQuest carries no medical subject-heading thesaurus, so your subject terms ride as TI,AB free text.',
      'Set the publication-date and language limits with the ProQuest limiters below the search box.',
    ],
  },
  opengrey: {
    id: 'opengrey', label: 'OpenGrey / grey literature',
    vocabSystem: 'none', controlledVocab: false, explosion: false, fieldTags: false,
    phrase: 'double', truncation: null, truncationMinStem: 0, wildcard: null,
    proximity: null,
    booleans: ['AND', 'OR'], filters: { date: false, language: false, pubType: false },
    syntaxLevel: 'approximate',
    notes: [
      'OpenGrey itself was discontinued in 2020 (its records are archived at DANS) — the Open button targets BASE, a free index that covers grey literature.',
      'Grey-literature portals accept only simple AND/OR and quoted phrases — paste the string and expect a coarse match.',
      'There is no controlled vocabulary, and no field tags, truncation, or limits; screen the results manually.',
    ],
  },
  europepmc: {
    id: 'europepmc', label: 'Europe PMC',
    // Indexes MEDLINE's own MeSH annotations → the identity mapping applies. `MESH:`
    // matches the heading exactly; there is no explosion form (explosionDefault:'exact').
    vocabSystem: 'mesh', controlledVocab: true, explosion: false, explosionDefault: 'exact', fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: '?',
    proximity: null,
    booleans: ['AND', 'OR', 'NOT'], filters: { date: true, language: true, pubType: true },
    syntaxLevel: 'native',
    notes: [
      'Paste into the Europe PMC search box; TITLE:/ABSTRACT: are native fields and PUB_YEAR/LANG carry your limits.',
      'MESH: uses the same MeSH descriptor PubMed does, but matches it exactly (no explosion) and only on records MEDLINE has already indexed.',
    ],
  },
  pmc: {
    id: 'pmc', label: 'PubMed Central',
    // Indexes MeSH → identity mapping. `[MeSH Terms]` ALWAYS explodes and PMC exposes
    // no NoExp form (explosionDefault:'explode').
    vocabSystem: 'mesh', controlledVocab: true, explosion: false, explosionDefault: 'explode', fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: null,
    proximity: null,
    booleans: ['AND', 'OR', 'NOT'], filters: { date: true, language: true, pubType: true },
    syntaxLevel: 'native',
    notes: [
      'Paste into the PMC search box; it uses [Title], [Abstract], [All Fields], and "X"[MeSH Terms].',
      'PMC indexes full text, so field behaviour differs from PubMed — expect broader hits than the same tags in PubMed.',
    ],
  },
  ieee: {
    id: 'ieee', label: 'IEEE Xplore',
    vocabSystem: 'none', controlledVocab: false, explosion: false, fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: '?',
    proximity: { op: 'NEAR/n', syntax: '"a" NEAR/3 "b" (ONEAR/n for order)' },
    booleans: ['AND', 'OR', 'NOT'], filters: { date: false, language: false, pubType: false },
    syntaxLevel: 'native',
    notes: [
      'Use IEEE Xplore → Advanced Search → Command Search and paste the string ("Document Title":, "Abstract": are its fields).',
      'IEEE has no subject-heading thesaurus, so your subject terms ride as Document Title / Abstract text.',
    ],
  },
  acm: {
    id: 'acm', label: 'ACM Digital Library',
    vocabSystem: 'none', controlledVocab: false, explosion: false, fieldTags: true,
    phrase: 'double', truncation: '*', truncationMinStem: 0, wildcard: '?',
    proximity: null,
    booleans: ['AND', 'OR', 'NOT'], filters: { date: false, language: false, pubType: false },
    syntaxLevel: 'native',
    notes: [
      'Use the ACM DL Advanced Search; Title:(...) and Abstract:(...) are its field-scoped groups.',
      'ACM has no subject-heading thesaurus (subject terms ride as Title / Abstract text) and applies date limits from the results-page filters, not the query string.',
    ],
  },
};

/** capabilitiesFor(dbId) → the capability object (shared reference), or null. */
export function capabilitiesFor(dbId) {
  return CAPABILITIES[String(dbId || '')] || null;
}

/** All database ids that have a capability entry (and therefore a compiler). */
export function capabilityDatabases() {
  return Object.keys(CAPABILITIES);
}
