/**
 * databases.js — SB3 Tab 3 ("Choose Databases"). Pure, network-free catalogue of
 * the databases a systematic-review searcher may want, each with a conservative
 * access note so beginners know whether they likely need institutional access.
 *
 * `nativeSyntax: true` marks the databases for which the Search Builder generates a
 * verified database-specific query string (PubMed, Embase, Cochrane). For all other
 * databases the builder supplies a generic keyword strategy and an honest note that
 * native syntax for that database is not generated yet — we never fabricate syntax.
 *
 * Access wording is deliberately non-absolute ("usually requires institutional
 * subscription"); availability depends on the user's institution.
 *
 * Deterministic + exported for unit tests. The render-time tier→label/colour
 * mapping lives in the UI; this module is data only.
 */

/** Access tiers (conservative). */
export const ACCESS_TIERS = {
  free: 'Free',
  freeFulltext: 'Free full-text archive',
  freeRegistry: 'Free trials registry',
  freeLimited: 'Free to search (limited export/reproducibility)',
  subscription: 'Usually requires institutional subscription',
  mixed: 'Mixed access; subscription may be needed for full access',
};

/**
 * The catalogue. `id` is stable (persisted in the search state). `group` drives the
 * Tab-3 section headings. `defaultOn` pre-selects the three core databases that have
 * native syntax, so existing projects behave exactly as before.
 */
export const DATABASE_CATALOG = [
  // ── Core biomedical / systematic-review ──────────────────────────────────
  { id: 'pubmed',        label: 'PubMed / MEDLINE',            group: 'Core biomedical', tier: 'free',          nativeSyntax: true,  defaultOn: true },
  { id: 'embase',        label: 'Embase',                      group: 'Core biomedical', tier: 'subscription',  nativeSyntax: true,  defaultOn: true },
  { id: 'cochrane',      label: 'Cochrane Library (CENTRAL)',  group: 'Core biomedical', tier: 'mixed',         nativeSyntax: true,  defaultOn: true },
  { id: 'clinicaltrials',label: 'ClinicalTrials.gov',          group: 'Core biomedical', tier: 'freeRegistry',  nativeSyntax: false, defaultOn: false },
  { id: 'ictrp',         label: 'WHO ICTRP',                   group: 'Core biomedical', tier: 'freeRegistry',  nativeSyntax: false, defaultOn: false },

  // ── Multidisciplinary ────────────────────────────────────────────────────
  { id: 'scopus',        label: 'Scopus',                      group: 'Multidisciplinary', tier: 'subscription', nativeSyntax: false, defaultOn: false },
  { id: 'wos',           label: 'Web of Science',              group: 'Multidisciplinary', tier: 'subscription', nativeSyntax: false, defaultOn: false },
  { id: 'gscholar',      label: 'Google Scholar',              group: 'Multidisciplinary', tier: 'freeLimited',  nativeSyntax: false, defaultOn: false },

  // ── Health / allied health / nursing / psychology ────────────────────────
  { id: 'cinahl',        label: 'CINAHL',                      group: 'Allied health & psychology', tier: 'subscription', nativeSyntax: false, defaultOn: false },
  { id: 'psycinfo',      label: 'PsycINFO',                    group: 'Allied health & psychology', tier: 'subscription', nativeSyntax: false, defaultOn: false },

  // ── Grey literature / theses ──────────────────────────────────────────────
  { id: 'proquest',      label: 'ProQuest Dissertations & Theses', group: 'Grey literature', tier: 'subscription', nativeSyntax: false, defaultOn: false },
  { id: 'opengrey',      label: 'OpenGrey / grey literature',      group: 'Grey literature', tier: 'free',         nativeSyntax: false, defaultOn: false },

  // ── Open / free biomedical ────────────────────────────────────────────────
  { id: 'europepmc',     label: 'Europe PMC',                  group: 'Open / free biomedical', tier: 'free',         nativeSyntax: false, defaultOn: false },
  { id: 'pmc',           label: 'PubMed Central',              group: 'Open / free biomedical', tier: 'freeFulltext', nativeSyntax: false, defaultOn: false },

  // ── Optional / specialty ──────────────────────────────────────────────────
  { id: 'ieee',          label: 'IEEE Xplore',                 group: 'Optional / specialty', tier: 'mixed', nativeSyntax: false, defaultOn: false },
  { id: 'acm',           label: 'ACM Digital Library',         group: 'Optional / specialty', tier: 'mixed', nativeSyntax: false, defaultOn: false },
];

/** Catalogue grouped into the Tab-3 sections, preserving catalogue order. */
export function databaseGroups() {
  const order = [];
  const byGroup = new Map();
  for (const db of DATABASE_CATALOG) {
    if (!byGroup.has(db.group)) { byGroup.set(db.group, []); order.push(db.group); }
    byGroup.get(db.group).push(db);
  }
  return order.map((group) => ({ group, databases: byGroup.get(group) }));
}

/** Stable list of default-selected database ids (the three native-syntax ones). */
export function defaultSelectedDatabases() {
  return DATABASE_CATALOG.filter((d) => d.defaultOn).map((d) => d.id);
}

/** Human access note for a database id (conservative wording), or '' if unknown. */
export function accessNote(id) {
  const db = DATABASE_CATALOG.find((d) => d.id === id);
  return db ? (ACCESS_TIERS[db.tier] || '') : '';
}

/** Look up a catalogue entry by id, or null. */
export function getDatabase(id) {
  return DATABASE_CATALOG.find((d) => d.id === id) || null;
}

/** The ids whose query strings the builder can actually generate (native syntax). */
export function nativeSyntaxDatabases() {
  return DATABASE_CATALOG.filter((d) => d.nativeSyntax).map((d) => d.id);
}

/** Tooltip shown next to the database list (institutional-access caveat). */
export const ACCESS_TOOLTIP =
  'Access depends on your institution. PecanRev helps prepare the search strategy, ' +
  'but your institution may control which databases you can open.';
