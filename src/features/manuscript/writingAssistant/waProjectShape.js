/**
 * features/manuscript/writingAssistant/waProjectShape.js — 120.md §6
 * "Dynamic project-aware dictionary".
 *
 * engine/projectLexicon.js is deliberately pure and says so: "Wave 4b's hook
 * assembles the shape from data it already has in memory." This is that assembly,
 * and it is a separate PURE module so the mapping (which project field feeds which
 * trust tier) is unit-testable without React, a project store or a network call.
 *
 * TRUST TIERS, and why each field sits where it does:
 *   TRUSTED (one appearance is enough) — reference and study metadata, and registered
 *     identifiers. These were imported from PubMed/Crossref or typed as a registry id
 *     that was validated; they are not free prose.
 *   FREE TEXT (needs a second, independent field) — the project title, the research
 *     question, the four PICO elements, keywords, search concepts, table and figure
 *     titles. A typo in the research question must not whitelist itself, which is the
 *     exact failure §6 names.
 *
 * PRIVACY: reads only objects already in memory in this tab. Emits no manuscript
 * prose — section CONTENT is never a lexicon source (that would let a misspelling in
 * the Discussion teach the checker to accept itself).
 */

const str = (v) => (v == null ? '' : String(v));
const push = (out, key, value) => {
  const s = str(value).trim();
  if (s) out[key].push(s);
};

const EMPTY = () => ({
  studyTitles: [], studyAuthors: [], studyJournals: [],
  referenceTitles: [], referenceAuthors: [], referenceJournals: [],
  controlledVocabulary: [], extractionLabels: [], registeredIds: [],
  title: [], question: [], populationP: [], interventionI: [], comparatorC: [], outcomeO: [],
  keywords: [], searchConcepts: [], tableTitles: [], figureTitles: [], analysisLabels: [], notes: [],
});

/**
 * @param {object} project  the raw META·LAB project blob
 * @param {object} man      { references, tables, figures, keywords } — the manuscript
 *   pieces, passed EXPLICITLY rather than as the whole useManuscript surface. That
 *   surface is a fresh object on every render (it changes on every keystroke), and a
 *   lexicon that is rebuilt per keystroke would re-teach the worker its dictionary
 *   sixty times a second. Naming the four stable inputs keeps the memo honest.
 * @returns {object} the shape engine/projectLexicon.buildProjectLexicon() consumes
 */
export function buildWaProjectShape(project, manuscript) {
  const out = EMPTY();
  const p = project || {};
  const man = manuscript || {};

  /* ── trusted: study + reference metadata ────────────────────────────────── */
  for (const s of Array.isArray(p.studies) ? p.studies : []) {
    push(out, 'studyTitles', s && s.title);
    push(out, 'studyAuthors', s && s.authors);
    push(out, 'studyJournals', s && s.journal);
    // A registered identifier is a validated token, not prose (NCT…, CRD…, a DOI).
    push(out, 'registeredIds', s && s.registryId);
    push(out, 'registeredIds', s && s.doi);
  }
  for (const r of Array.isArray(man.references) ? man.references : []) {
    push(out, 'referenceTitles', r && r.title);
    push(out, 'referenceAuthors', r && r.authors);
    push(out, 'referenceJournals', r && r.journal);
  }
  push(out, 'registeredIds', (p.pico && p.pico.prosperoId) || p.prosperoId);

  /* ── free text: the project's own words ─────────────────────────────────── */
  push(out, 'title', p.name);
  const pico = p.pico || {};
  push(out, 'question', pico.question);
  push(out, 'populationP', pico.P);
  push(out, 'interventionI', pico.I);
  push(out, 'comparatorC', pico.C);
  push(out, 'outcomeO', pico.O);
  push(out, 'question', pico.studyDesign);
  for (const k of Array.isArray(pico.keywords) ? pico.keywords : []) push(out, 'keywords', k);

  // The manuscript's OWN structured labels: table and figure titles are authored
  // headings, not body prose, and they are exactly where a study drug's name lives.
  for (const t of Array.isArray(man.tables) ? man.tables : []) {
    push(out, 'tableTitles', (t && (t.title || t.label)) || '');
  }
  for (const f of Array.isArray(man.figures) ? man.figures : []) {
    push(out, 'figureTitles', (f && (f.title || f.label)) || '');
  }
  for (const k of Array.isArray(man.keywords) ? man.keywords : []) push(out, 'keywords', k);

  return out;
}

export default buildWaProjectShape;
