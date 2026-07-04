/**
 * 73.md Parts 8/9 — manuscript STATE tests: sectionMeta provenance stamping,
 * per-section LOCK (always skipped by generation, persisted through
 * normalizeDraft), statement seeding into EMPTY statements only, and the
 * OUTDATED (inputsHash mismatch) computation.
 */
import { describe, it, expect } from 'vitest';
import {
  applyGeneratedSections, setSectionLocked, computeOutdatedSections, setSection,
} from '../../../src/features/manuscript/manuscriptState.js';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { generateDraft } from '../../../src/research-engine/manuscript/draft.js';
import { computeSectionInputsHashes } from '../../../src/research-engine/manuscript/sources.js';

function project() {
  return {
    id: 'p1',
    name: 'Statins for primary prevention',
    pico: { question: 'Do statins reduce CV events?', P: 'Adults', I: 'Statins', C: 'Placebo', O: 'MACE', prosperoId: 'CRD42024000001' },
    search: { dbs: { pubmed: true }, date: '2026-01-15', string: '(statin*)' },
    prisma: {},
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12' },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06' },
    ],
  };
}

const freshDraft = () => normalizeDraft(makeManuscriptDraft({ title: 'T' }));

describe('applyGeneratedSections — sectionMeta provenance stamping', () => {
  it('stamps sources/missing/inputsHash from generated.sectionMeta onto every written section', () => {
    const p = project();
    const gen = generateDraft(p, {});
    const { draft } = applyGeneratedSections(freshDraft(), gen, {});
    const ms = draft.sections.methods;
    expect(ms.content).toBe(gen.methods);
    expect(ms.inputsHash).toBe(gen.sectionMeta.methods.inputsHash);
    expect(ms.sources).toEqual(gen.sectionMeta.methods.sources);
    expect(ms.missing).toEqual(gen.sectionMeta.methods.missing);
    // survives normalization (additive optional fields)
    const norm = normalizeDraft(draft);
    expect(norm.sections.methods.inputsHash).toBe(gen.sectionMeta.methods.inputsHash);
    expect(Array.isArray(norm.sections.methods.sources)).toBe(true);
  });

  it('skipped-userEdited contract unchanged (and no meta stamped on skipped sections)', () => {
    const p = project();
    const gen = generateDraft(p, {});
    let d = setSection(freshDraft(), 'methods', 'MY OWN METHODS');
    const res = applyGeneratedSections(d, gen, {});
    expect(res.skipped).toContain('methods');
    expect(res.draft.sections.methods.content).toBe('MY OWN METHODS');
    expect(res.draft.sections.methods.inputsHash).toBeUndefined();
    // results (not edited) was written + stamped
    expect(res.draft.sections.results.inputsHash).toBe(gen.sectionMeta.results.inputsHash);
  });
});

describe('applyGeneratedSections — LOCK always wins', () => {
  it('locked sections are skipped and reported in skippedLocked', () => {
    const p = project();
    const gen = generateDraft(p, {});
    let d = setSection(freshDraft(), 'results', 'LOCKED RESULTS TEXT');
    d = setSectionLocked(d, 'results', true);
    const res = applyGeneratedSections(d, gen, {});
    expect(res.skippedLocked).toEqual(['results']);
    expect(res.draft.sections.results.content).toBe('LOCKED RESULTS TEXT');
  });

  it('locked survives even overwriteEdited:true', () => {
    const p = project();
    const gen = generateDraft(p, {});
    let d = setSection(freshDraft(), 'results', 'LOCKED RESULTS TEXT');
    d = setSectionLocked(d, 'results', true);
    const res = applyGeneratedSections(d, gen, { overwriteEdited: true });
    expect(res.skippedLocked).toEqual(['results']);
    expect(res.draft.sections.results.content).toBe('LOCKED RESULTS TEXT');
  });

  it('lock round-trips through normalizeDraft; unlock is dropped (additive persistence)', () => {
    let d = setSectionLocked(freshDraft(), 'methods', true);
    expect(normalizeDraft(d).sections.methods.locked).toBe(true);
    d = setSectionLocked(d, 'methods', false);
    expect(normalizeDraft(d).sections.methods.locked).toBeUndefined();
  });
});

describe('applyGeneratedSections — statement seeding (EMPTY only, full generate only)', () => {
  it('fills an empty registration statement from the engine suggestion', () => {
    const p = project();
    const gen = generateDraft(p, {});
    expect(gen.statements.registration).toMatch(/CRD42024000001/);
    const { draft } = applyGeneratedSections(freshDraft(), gen, {});
    expect(draft.statements.registration).toBe(gen.statements.registration);
  });

  it('NEVER overwrites researcher-entered statement text', () => {
    const p = project();
    const gen = generateDraft(p, {});
    const base = freshDraft();
    base.statements.registration = 'My own registration wording.';
    const { draft } = applyGeneratedSections(base, gen, {});
    expect(draft.statements.registration).toBe('My own registration wording.');
  });

  it('does not seed statements on a single-section regenerate (opts.only)', () => {
    const p = project();
    const gen = generateDraft(p, {});
    const { draft } = applyGeneratedSections(freshDraft(), gen, { only: ['methods'] });
    expect(draft.statements.registration).toBe('');
  });
});

describe('computeOutdatedSections — inputsHash mismatch', () => {
  it('nothing outdated right after generation (stored hash === fresh hash)', () => {
    const p = project();
    const gen = generateDraft(p, {});
    const { draft } = applyGeneratedSections(freshDraft(), gen, {});
    const fresh = computeSectionInputsHashes(p, {});
    expect(computeOutdatedSections(draft, fresh)).toEqual({});
  });

  it('flags sections whose inputs changed since generation', () => {
    const p = project();
    const gen = generateDraft(p, {});
    const { draft } = applyGeneratedSections(freshDraft(), gen, {});
    const p2 = project();
    p2.studies.push({ id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05' });
    const fresh2 = computeSectionInputsHashes(p2, {});
    const out = computeOutdatedSections(draft, fresh2);
    expect(out.results).toBe(true);
    expect(out.abstract).toBe(true);
  });

  it('never flags empty sections or sections without a stored hash (old drafts)', () => {
    const p = project();
    const fresh = computeSectionInputsHashes(p, {});
    // old draft: content but no inputsHash (generated before 73.md)
    const legacy = setSection(freshDraft(), 'methods', 'old generated text');
    expect(computeOutdatedSections(legacy, fresh)).toEqual({});
    // empty draft: hashes exist but no content
    expect(computeOutdatedSections(freshDraft(), fresh)).toEqual({});
    // defensive nulls
    expect(computeOutdatedSections(null, fresh)).toEqual({});
    expect(computeOutdatedSections(freshDraft(), null)).toEqual({});
  });
});
