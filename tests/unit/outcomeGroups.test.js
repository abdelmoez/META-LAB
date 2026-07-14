/**
 * outcomeGroups.test.js — 82.md Part 1 + 83.md §2. Pure multi-outcome grouping over
 * mkStudy rows: citation identity, add/duplicate/rename/role/reorder/archive, and the
 * publication-level PDF linkage (inheritance + carrier resolution). No server/DB.
 */
import { describe, it, expect } from 'vitest';
import { mkStudy } from '../../src/research-engine/project-model/defaults.js';
import {
  citationKey, groupStudiesByCitation, groupForStudy, activeOutcomes,
  addOutcome, duplicateOutcome, renameOutcome, setOutcomeRole,
  archiveOutcome, restoreOutcome, reorderOutcomes, outcomeSummary,
  publicationSourceFor, spreadAvailabilityByCitation,
  OUTCOME_ROLES, PUBLICATION_LINK_FIELDS,
} from '../../src/research-engine/extraction/outcomeGroups.js';

let seq = 0;
const idFn = () => `gen${++seq}`;
const paper = (over = {}) => ({ ...mkStudy(), ...over });

describe('citationKey', () => {
  it('prefers DOI, then PMID, then author|year|title', () => {
    expect(citationKey({ doi: '10.1/X', pmid: '9', title: 'T', author: 'A', year: '2020' })).toBe('doi:10.1/x');
    expect(citationKey({ pmid: '123', title: 'T', author: 'A' })).toBe('pmid:123');
    expect(citationKey({ title: 'Trial of X', author: 'Smith', year: '2021' })).toBe('t:smith|2021|trial of x');
  });
  it('same paper, different outcome → same key', () => {
    const a = { doi: '10.1/x', outcome: 'Mortality' };
    const b = { doi: '10.1/X', outcome: 'Hospitalization' };
    expect(citationKey(a)).toBe(citationKey(b));
  });
});

describe('groupStudiesByCitation', () => {
  it('groups multiple outcome rows of one paper into a single group', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x', author: 'Smith', year: '2020', outcome: 'Mortality', esType: 'OR' }),
      paper({ id: 's2', doi: '10.1/x', author: 'Smith', year: '2020', outcome: 'Hospitalization', esType: 'OR' }),
      paper({ id: 's3', doi: '10.2/y', author: 'Jones', year: '2019', outcome: 'QoL', esType: 'MD' }),
    ];
    const groups = groupStudiesByCitation(studies);
    expect(groups.length).toBe(2);
    const smith = groups.find((g) => g.citation.author === 'Smith');
    expect(smith.outcomes.map((o) => o.name)).toEqual(['Mortality', 'Hospitalization']);
    expect(smith.studyIds).toEqual(['s1', 's2']);
  });
});

describe('addOutcome — clone citation only, no study duplication', () => {
  it('appends a fresh row inheriting citation metadata but blank outcome/values', () => {
    const studies = [paper({ id: 's1', doi: '10.1/x', author: 'Smith', year: '2020', title: 'Trial', outcome: 'Mortality', esType: 'OR', a: '5', b: '10' })];
    const { studies: next, id } = addOutcome(studies, 's1', { mkStudy, idFn, name: 'Hospitalization', role: 'secondary' });
    expect(next.length).toBe(2);
    const added = next.find((x) => x.id === id);
    expect(added.author).toBe('Smith');
    expect(added.doi).toBe('10.1/x');
    expect(added.outcome).toBe('Hospitalization');
    expect(added.a).toBe(''); // values NOT copied
    expect(added.extractionMeta.outcomeRole).toBe('secondary');
    // same paper → grouped together
    expect(groupStudiesByCitation(next).length).toBe(1);
  });
  it('errors without mkStudy or a valid source', () => {
    expect(addOutcome([], 'nope', {}).error).toBeTruthy();
    expect(addOutcome([paper({ id: 's1' })], 'missing', { mkStudy }).error).toBeTruthy();
  });
  it('83.md §2 — inherits the publication PDF linkage (screening ids + document)', () => {
    const doc = { storedName: 'abc.pdf', fileName: 'trial.pdf', fileHash: 'h1' };
    const studies = [paper({ id: 's1', doi: '10.1/x', screeningProjectId: 'sp1', screeningRecordId: 'rec1', document: doc })];
    const { studies: next, id } = addOutcome(studies, 's1', { mkStudy, idFn, name: 'Safety' });
    const added = next.find((x) => x.id === id);
    expect(added.screeningProjectId).toBe('sp1');
    expect(added.screeningRecordId).toBe('rec1');
    expect(added.document).toBe(doc); // same pointer — the server dedups by content hash
    expect(PUBLICATION_LINK_FIELDS).toEqual(['screeningProjectId', 'screeningRecordId', 'document']);
  });
  it('83.md §2 — does not stamp empty linkage fields onto the clone', () => {
    const studies = [paper({ id: 's1', doi: '10.1/x', screeningProjectId: '', screeningRecordId: null })];
    const { studies: next, id } = addOutcome(studies, 's1', { mkStudy, idFn });
    const added = next.find((x) => x.id === id);
    expect(added.screeningProjectId).toBeUndefined();
    expect(added.screeningRecordId).toBeUndefined();
    expect(added.document).toBeUndefined();
  });
});

describe('publicationSourceFor — 83.md §2 paper-level PDF resolution', () => {
  const doc = { storedName: 'doc1.pdf', fileName: 'trial.pdf' };
  it('prefers the row\'s own linkage, then falls back to a sibling carrier', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x', outcome: 'A', screeningProjectId: 'sp1', screeningRecordId: 'r1' }),
      paper({ id: 's2', doi: '10.1/x', outcome: 'B' }), // legacy row without linkage
    ];
    const own = publicationSourceFor(studies, 's1');
    expect(own.screeningProjectId).toBe('sp1');
    const sib = publicationSourceFor(studies, 's2');
    expect(sib.screeningProjectId).toBe('sp1');
    expect(sib.screeningRecordId).toBe('r1');
    expect(sib.key).toBe(citationKey(studies[0]));
  });
  it('resolves a sibling study-document carrier with its OWN row id (download route key)', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x', outcome: 'A', document: doc }),
      paper({ id: 's2', doi: '10.1/x', outcome: 'B' }),
    ];
    const pub = publicationSourceFor(studies, 's2');
    expect(pub.docStudyId).toBe('s1');
    expect(pub.docStoredName).toBe('doc1.pdf');
    expect(pub.screeningProjectId).toBeNull();
  });
  it('pointer-copied documents resolve through the GROUP-STABLE carrier (no URL flip between outcomes)', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x', outcome: 'A', document: doc }),
      paper({ id: 's2', doi: '10.1/x', outcome: 'B', document: { ...doc } }), // same storedName (inherited copy)
    ];
    expect(publicationSourceFor(studies, 's1').docStudyId).toBe('s1');
    expect(publicationSourceFor(studies, 's2').docStudyId).toBe('s1'); // stable carrier, not own row
  });
  it('a row with a genuinely DIFFERENT file keeps its own document', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x', outcome: 'A', document: doc }),
      paper({ id: 's2', doi: '10.1/x', outcome: 'B', document: { storedName: 'appendix.pdf' } }),
    ];
    expect(publicationSourceFor(studies, 's2').docStudyId).toBe('s2');
    expect(publicationSourceFor(studies, 's2').docStoredName).toBe('appendix.pdf');
  });
  it('anchorId is stable across every outcome of the paper (array-order first member)', () => {
    const studies = [
      paper({ id: 'z9', doi: '10.9/z', outcome: 'other paper' }),
      paper({ id: 's1', doi: '10.1/x', outcome: 'A' }),
      paper({ id: 's2', doi: '10.1/x', outcome: 'B' }),
    ];
    expect(publicationSourceFor(studies, 's1').anchorId).toBe('s1');
    expect(publicationSourceFor(studies, 's2').anchorId).toBe('s1');
    expect(publicationSourceFor(studies, 'z9').anchorId).toBe('z9'); // different paper → different anchor
  });
  it('ARCHIVED siblings still carry the PDF (archiving must never remove it)', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x', outcome: 'A', screeningProjectId: 'sp1', screeningRecordId: 'r1', extractionMeta: { archived: true } }),
      paper({ id: 's2', doi: '10.1/x', outcome: 'B' }),
    ];
    const pub = publicationSourceFor(studies, 's2');
    expect(pub.screeningRecordId).toBe('r1');
  });
  it('lists lookup candidates target-first for the server handoff resolution', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x', outcome: 'A' }),
      paper({ id: 's2', doi: '10.1/x', outcome: 'B' }),
    ];
    expect(publicationSourceFor(studies, 's2').lookupStudyIds).toEqual(['s2', 's1']);
  });
  it('returns null for an unknown study id and singleton data for a lone row', () => {
    expect(publicationSourceFor([], 'nope')).toBeNull();
    const lone = publicationSourceFor([paper({ id: 's1', title: 'T' })], 's1');
    expect(lone.anchorId).toBe('s1');
    expect(lone.screeningProjectId).toBeNull();
    expect(lone.docStudyId).toBeNull();
  });
  it('WEAK identity (author+year only) never borrows an UNLINKED sibling file — collisions must not stream the wrong PDF', () => {
    const studies = [
      paper({ id: 's1', author: 'Smith', year: '2020', outcome: 'A', screeningProjectId: 'sp1', screeningRecordId: 'r1' }),
      paper({ id: 's2', author: 'Smith', year: '2020', outcome: 'B' }), // possibly a DIFFERENT Smith 2020 paper
    ];
    const pub = publicationSourceFor(studies, 's2');
    expect(pub.screeningProjectId).toBeNull(); // no cross-row sharing on a weak text match
    expect(pub.anchorId).toBe('s2');           // per-row identity
    expect(pub.lookupStudyIds).toEqual(['s2']);
  });
  it('WEAK identity still groups rows that share PHYSICAL linkage (inherited pointer/record — provably same paper)', () => {
    const doc2 = { storedName: 'w.pdf' };
    const studies = [
      paper({ id: 's1', author: 'Nasser', year: '2024', outcome: 'A', document: doc2 }),
      paper({ id: 's2', author: 'Nasser', year: '2024', outcome: 'B', document: { ...doc2 } }), // + Add outcome copy
      paper({ id: 's3', author: 'Nasser', year: '2024', outcome: 'C' }),                        // unlinked weak match
    ];
    const fromB = publicationSourceFor(studies, 's2');
    expect(fromB.anchorId).toBe('s1');      // stable anchor across the linked pair
    expect(fromB.docStudyId).toBe('s1');    // group-stable carrier (no URL flip)
    const fromC = publicationSourceFor(studies, 's3');
    expect(fromC.docStudyId).toBeNull();    // the unlinked row still shares nothing
    // Same rule for a shared screening record:
    const rec = [
      paper({ id: 'r1', author: 'Kim', year: '2021', screeningProjectId: 'sp', screeningRecordId: 'rec9' }),
      paper({ id: 'r2', author: 'Kim', year: '2021', screeningProjectId: 'sp', screeningRecordId: 'rec9' }),
    ];
    expect(publicationSourceFor(rec, 'r2').anchorId).toBe('r1');
    expect(publicationSourceFor(rec, 'r2').screeningRecordId).toBe('rec9');
  });
});

describe('spreadAvailabilityByCitation — 83.md §2 group-aware pdfAvailable', () => {
  it('marks every row of a paper available when any row is', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x' }),
      paper({ id: 's2', doi: '10.1/x' }),
      paper({ id: 'z1', doi: '10.9/z' }),
    ];
    const out = spreadAvailabilityByCitation(studies, new Map([['s1', true]]));
    expect(out.get('s1')).toBe(true);
    expect(out.get('s2')).toBe(true);
    expect(out.get('z1')).toBeUndefined(); // other paper untouched
  });
  it('does not mutate the input map', () => {
    const input = new Map([['s1', true]]);
    spreadAvailabilityByCitation([paper({ id: 's1', doi: '10.1/x' }), paper({ id: 's2', doi: '10.1/x' })], input);
    expect(input.has('s2')).toBe(false);
  });
  it('does not spread across WEAK (author+year-only) identities', () => {
    const studies = [
      paper({ id: 's1', author: 'Smith', year: '2020' }),
      paper({ id: 's2', author: 'Smith', year: '2020' }),
    ];
    const out = spreadAvailabilityByCitation(studies, new Map([['s1', true]]));
    expect(out.get('s1')).toBe(true);
    expect(out.get('s2')).toBeUndefined();
  });
});

describe('duplicateOutcome — full copy incl values, fresh id, after source', () => {
  it('copies all values and appends right after the source', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x', outcome: 'Mortality', esType: 'OR', a: '5', b: '10', extractionMeta: { completedAt: 'x', locked: true } }),
      paper({ id: 's9', doi: '10.9/z', outcome: 'Other' }),
    ];
    const { studies: next, id } = duplicateOutcome(studies, 's1', { idFn });
    expect(next.length).toBe(3);
    expect(next[1].id).toBe(id); // inserted after s1
    expect(next[1].a).toBe('5'); // values copied
    expect(next[1].outcome).toBe('Mortality (copy)');
    // completion/lock cleared on the copy (fresh capture)
    expect(next[1].extractionMeta.completedAt).toBeUndefined();
    expect(next[1].extractionMeta.locked).toBeUndefined();
  });
});

describe('rename / role / archive / restore', () => {
  const base = () => [paper({ id: 's1', doi: '10.1/x', outcome: 'Mortality' })];
  it('renameOutcome sets study.outcome', () => {
    const { studies } = renameOutcome(base(), 's1', '  All-cause mortality ');
    expect(studies[0].outcome).toBe('All-cause mortality');
  });
  it('setOutcomeRole stores/clears the role in extractionMeta', () => {
    let r = setOutcomeRole(base(), 's1', 'primary');
    expect(r.studies[0].extractionMeta.outcomeRole).toBe('primary');
    r = setOutcomeRole(r.studies, 's1', '');
    expect(r.studies[0].extractionMeta.outcomeRole).toBeUndefined();
    expect(setOutcomeRole(base(), 's1', 'bogus').error).toBeTruthy();
  });
  it('archive/restore toggles extractionMeta.archived and preserves the row', () => {
    let r = archiveOutcome(base(), 's1');
    expect(r.studies[0].extractionMeta.archived).toBe(true);
    expect(r.studies.length).toBe(1); // preserved, not deleted
    r = restoreOutcome(r.studies, 's1');
    expect(r.studies[0].extractionMeta.archived).toBeUndefined();
  });
  it('activeOutcomes excludes archived rows', () => {
    const studies = [
      paper({ id: 's1', doi: '10.1/x', outcome: 'A' }),
      paper({ id: 's2', doi: '10.1/x', outcome: 'B', extractionMeta: { archived: true } }),
    ];
    const g = groupForStudy(studies, 's1');
    expect(activeOutcomes(g).map((o) => o.name)).toEqual(['A']);
  });
});

describe('reorderOutcomes — reorders one paper, leaves others untouched', () => {
  it('reorders within a citation group by ordered ids', () => {
    const studies = [
      paper({ id: 'a1', doi: '10.1/x', outcome: 'A1' }),
      paper({ id: 'z1', doi: '10.9/z', outcome: 'Z1' }),
      paper({ id: 'a2', doi: '10.1/x', outcome: 'A2' }),
      paper({ id: 'a3', doi: '10.1/x', outcome: 'A3' }),
    ];
    const key = citationKey(studies[0]);
    const { studies: next } = reorderOutcomes(studies, key, ['a3', 'a1', 'a2']);
    // paper X rows re-placed into their original slots (0,2,3) in the new order
    expect(next[0].id).toBe('a3');
    expect(next[1].id).toBe('z1'); // untouched
    expect(next[2].id).toBe('a1');
    expect(next[3].id).toBe('a2');
  });
  it('is a no-op for a single-outcome paper', () => {
    const studies = [paper({ id: 's1', doi: '10.1/x' })];
    expect(reorderOutcomes(studies, citationKey(studies[0]), ['s1']).studies).toEqual(studies);
  });
});

describe('outcomeSummary', () => {
  it('surfaces name/role/esType/reportedFormat/conversionStatus/pct', () => {
    const st = paper({ id: 's1', outcome: 'Mortality', esType: 'MD', reportedFormat: 'median_iqr',
      medianExp: 15, q1Exp: 10, q3Exp: 20, nExp: 50, medianCtrl: 12, q1Ctrl: 8, q3Ctrl: 17, nCtrl: 48,
      extractionMeta: { outcomeRole: 'primary' } });
    const sum = outcomeSummary(st);
    expect(sum.name).toBe('Mortality');
    expect(sum.role).toBe('primary');
    expect(sum.reportedFormat).toBe('median_iqr');
    expect(sum.conversionStatus).toBe('eligible'); // reported entered, not yet applied
    expect(OUTCOME_ROLES).toContain(sum.role);
  });
});
