/**
 * tests/unit/searchCompilers/fixture.js — shared golden fixture for the database
 * strategy-compiler tests (73.md Part 6). NOT a test file (no *.test suffix) — just
 * an importable strategy the per-database golden files compile and assert against.
 *
 * Shape covers the features the compilers must handle:
 *   - a controlled term with both vocab.mesh AND vocab.emtree (Heart Failure)
 *   - a multi-word phrase (cardiac failure)
 *   - a title-only free-text term (chf, field 'ti')
 *   - a truncated single word (sglt2, truncate:true)
 *   - a concept whose op is 'OR' (Intervention → OR-joins to Comparator)
 *   - filters: publication-year range + English + a Randomized Controlled Trial type
 */
export const FIXTURE = {
  concepts: [
    {
      id: 'c1', label: 'Condition', picoField: 'P', op: 'AND',
      terms: [
        { text: 'Heart Failure', type: 'controlled', field: 'tiab',
          vocab: { mesh: 'Heart Failure', emtree: 'heart failure' }, noExplode: false, truncate: false, phrase: false },
        { text: 'cardiac failure', type: 'freetext', field: 'tiab', truncate: false, phrase: true },
        { text: 'chf', type: 'freetext', field: 'ti', truncate: false, phrase: false },
      ],
    },
    {
      id: 'c2', label: 'Intervention', picoField: 'I', op: 'OR',
      terms: [
        { text: 'sglt2', type: 'freetext', field: 'tiab', truncate: true, phrase: false },
      ],
    },
    {
      id: 'c3', label: 'Comparator', picoField: 'C', op: 'AND',
      terms: [
        { text: 'placebo', type: 'freetext', field: 'tiab', truncate: false, phrase: false },
      ],
    },
  ],
  filters: { dateFrom: '2010', dateTo: '2025', languages: ['en'], pubTypes: ['Randomized Controlled Trial'] },
};

/** A strategy with a single simple concept and no filters (helpers for edge tests). */
export const SIMPLE = {
  concepts: [
    { id: 's1', label: 'Solo', op: 'AND', terms: [{ text: 'aspirin', type: 'freetext', field: 'tiab' }] },
  ],
  filters: {},
};
