/**
 * 119.md §7 — manuscript template expansion, pinned.
 *
 * The three things §7 asks to be true, and the three things this file exists to
 * prove:
 *   1. STRUCTURE, JOURNAL PROFILE and CITATION STYLE are three dimensions. Changing
 *      one never changes another — in particular a citation-style change can never
 *      rewrite the section structure.
 *   2. Switching a template NEVER deletes content. Every path — the normalizer, the
 *      switch, the export, the snapshot — carries unmapped text through.
 *   3. Every structure records its guideline, its version and the date it was
 *      reviewed against an authoritative source; no journal rule is invented.
 *
 * Plus the byte-stability invariant the whole feature is built under: a draft that
 * never chose a structure must serialize exactly as it did before §7.
 */
import { describe, it, expect } from 'vitest';
import {
  SECTION_TYPES, SECTION_IDS, makeManuscriptDraft, normalizeDraft, normalizeStructure,
  draftSectionTypes, draftSectionIds, draftBodySectionIds, draftSectionLabel,
} from '../../../src/research-engine/manuscript/model.js';
import {
  MANUSCRIPT_STRUCTURES, MANUSCRIPT_STRUCTURE_IDS, DEFAULT_STRUCTURE_ID,
  EXTRA_SECTION_TYPES, KNOWN_SECTION_IDS, structureById, draftStructure,
  isCustomizedStructure, planStructureSwitch, applyStructureSwitch,
  renameDraftSection, moveDraftSection, JOURNAL_PROFILE_META, journalProfile,
} from '../../../src/research-engine/manuscript/templates.js';
import { orderedSections, resolveNumbering } from '../../../src/research-engine/manuscript/refTokens.js';
import { draftSectionTexts } from '../../../src/research-engine/manuscript/citations.js';
import { createSnapshot, restoreSnapshot } from '../../../src/research-engine/manuscript/snapshots.js';
import { JOURNAL_TEMPLATES, JOURNAL_TEMPLATE_IDS } from '../../../src/research-engine/manuscript/model.js';
import { readSource } from '../../helpers/readSource.js';

const NOW = '2026-08-16T10:00:00.000Z';

/** A draft with recognisable text in every core section. */
function seeded(extra = {}) {
  const d = makeManuscriptDraft({ nowIso: NOW });
  for (const s of SECTION_TYPES) {
    d.sections[s.id] = {
      ...d.sections[s.id], content: `text of ${s.id}`, userEdited: true, updatedAt: NOW,
    };
  }
  return normalizeDraft({ ...d, ...extra }, NOW);
}

/* ══════════════ the library itself ══════════════ */

describe('119.md §7 — the reporting-structure library', () => {
  it('ships every structure §7 names, by id', () => {
    expect(MANUSCRIPT_STRUCTURE_IDS).toEqual([
      'imrad', 'prisma-2020', 'prisma-nma', 'prisma-scr', 'consort',
      'strobe', 'stard', 'care', 'srqr', 'prisma-p',
    ]);
  });

  it('records guideline, version, reviewed date and an authoritative source for each', () => {
    for (const s of MANUSCRIPT_STRUCTURES) {
      expect(typeof s.guideline, s.id).toBe('string');
      expect(s.guideline.length, s.id).toBeGreaterThan(1);
      expect(typeof s.guidelineVersion, s.id).toBe('string');
      expect(s.guidelineVersion.length, s.id).toBeGreaterThan(3);
      // An ISO day — §7: "the date on which the template was reviewed".
      expect(s.reviewedAt, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(s.version), s.id).toBe(true);
      expect(String(s.source || ''), s.id).toMatch(/^https:\/\//);
    }
  });

  it('carries the VERIFIED guideline versions, not recalled ones', () => {
    // Each of these was read from the cited source during implementation.
    expect(structureById('prisma-2020').guidelineVersion).toContain('2020');
    expect(structureById('prisma-nma').guidelineVersion).toContain('2015');
    expect(structureById('prisma-scr').guidelineVersion).toContain('2018');
    expect(structureById('consort').guidelineVersion).toContain('2025');
    expect(structureById('strobe').guidelineVersion).toContain('2007');
    expect(structureById('stard').guidelineVersion).toContain('2015');
    expect(structureById('care').guidelineVersion).toContain('2013');
    expect(structureById('srqr').guidelineVersion).toContain('2014');
    expect(structureById('prisma-p').guidelineVersion).toContain('2015');
  });

  it('is not a set of cosmetic themes — the section SETS genuinely differ', () => {
    const sets = MANUSCRIPT_STRUCTURES.map((s) => s.sections.map((x) => x.id).join('>'));
    // CARE has no Methods and no Results at all; a protocol has no Results either.
    expect(structureById('care').sections.map((s) => s.id)).not.toContain('methods');
    expect(structureById('care').sections.map((s) => s.id)).not.toContain('results');
    expect(structureById('prisma-p').sections.map((s) => s.id)).not.toContain('results');
    expect(structureById('prisma-p').sections.map((s) => s.id)).not.toContain('discussion');
    // CONSORT 2025's own restructuring: an Open science section, and Harms apart.
    expect(structureById('consort').sections.map((s) => s.id)).toContain('open-science');
    expect(structureById('consort').sections.map((s) => s.id)).toContain('harms');
    expect(structureById('prisma-nma').sections.map((s) => s.id)).toContain('network-geometry');
    // …and at least seven distinct shapes across ten templates.
    expect(new Set(sets).size).toBeGreaterThanOrEqual(7);
  });

  it('gives every section per-guideline GUIDANCE, which is what makes it not a theme', () => {
    for (const s of MANUSCRIPT_STRUCTURES) {
      if (s.id === 'imrad') continue; // the neutral default carries no checklist
      for (const sec of s.sections) {
        expect(typeof sec.guidance, `${s.id}/${sec.id}`).toBe('string');
        expect(sec.guidance.length, `${s.id}/${sec.id}`).toBeGreaterThan(20);
      }
    }
  });

  it('uses only known, stable section ids', () => {
    for (const s of MANUSCRIPT_STRUCTURES) {
      for (const sec of s.sections) expect(KNOWN_SECTION_IDS, `${s.id}/${sec.id}`).toContain(sec.id);
    }
    // The extras never collide with a core id (ids ARE the storage keys).
    for (const e of EXTRA_SECTION_TYPES) expect(SECTION_IDS).not.toContain(e.id);
  });

  it('the DEFAULT structure is exactly the core eight (so an absent key means IMRAD)', () => {
    const imrad = structureById(DEFAULT_STRUCTURE_ID);
    expect(imrad.sections.map((s) => s.id)).toEqual(SECTION_IDS);
    expect(draftStructure(makeManuscriptDraft()).id).toBe('imrad');
  });
});

/* ══════════════ journal profiles — the SEPARATE dimension ══════════════ */

describe('119.md §7 — journal profiles carry provenance and never invent rules', () => {
  it('covers every stored templateId (an id that stopped resolving would mutate drafts)', () => {
    for (const id of JOURNAL_TEMPLATE_IDS) expect(JOURNAL_PROFILE_META[id], id).toBeTruthy();
    expect(Object.keys(JOURNAL_PROFILE_META).sort()).toEqual([...JOURNAL_TEMPLATE_IDS].sort());
  });

  it('labels each profile with a source, a last-reviewed date and a version', () => {
    for (const id of Object.keys(JOURNAL_PROFILE_META)) {
      const m = JOURNAL_PROFILE_META[id];
      expect(String(m.source), id).toMatch(/^https:\/\//);
      expect(m.lastReviewedAt, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(m.version), id).toBe(true);
    }
  });

  it('names, per FIELD, what still requires the user to verify it', () => {
    for (const id of Object.keys(JOURNAL_PROFILE_META)) {
      const m = JOURNAL_PROFILE_META[id];
      expect(Array.isArray(m.needsUserVerification), id).toBe(true);
      expect(m.needsUserVerification.length, id).toBeGreaterThan(0);
    }
  });

  it('says plainly where the instructions could NOT be read, instead of implying they were', () => {
    // The two profiles whose author instructions returned 403 / were unreachable
    // claim nothing as verified and say so.
    expect(JOURNAL_PROFILE_META.lancet.verified).toEqual([]);
    expect(JOURNAL_PROFILE_META.lancet.reviewNote).toMatch(/403|could not/i);
    expect(JOURNAL_PROFILE_META.bmj.verified).toEqual([]);
    expect(JOURNAL_PROFILE_META.bmj.reviewNote).toMatch(/could not be retrieved/i);
    // The one that WAS read lists the facts it took, verbatim.
    expect(JOURNAL_PROFILE_META.jama.verified).toContain('abstractWordLimit');
    expect(JOURNAL_PROFILE_META.jama.facts.join(' ')).toContain('350 words');
  });

  it('merges the shipped formatting aid with its provenance under one call', () => {
    const p = journalProfile('jama');
    expect(p.id).toBe('jama');
    expect(p.abstractWordLimit).toBe(350);
    expect(p.meta.publisher).toContain('American Medical Association');
    // Unknown ids fall back to the generic profile rather than returning null.
    expect(journalProfile('not-a-journal').id).toBe('generic');
  });

  it('the shipped profile list is UNCHANGED (ids are stored on real drafts)', () => {
    expect(JOURNAL_TEMPLATE_IDS).toEqual(['generic', 'jama', 'bmj', 'lancet', 'cochrane']);
  });
});

/* ══════════════ byte-stability ══════════════ */

describe('119.md §7 + ARCH-117 — legacy drafts normalize identically', () => {
  it('a draft that never chose a structure carries NO structure key', () => {
    const d = normalizeDraft(makeManuscriptDraft({ nowIso: NOW }), NOW);
    expect('structure' in d).toBe(false);
    expect(draftSectionIds(d)).toEqual(SECTION_IDS);
  });

  it('normalization is idempotent and byte-identical for a legacy blob', () => {
    const legacy = {
      id: 'd1', title: 'T', templateId: 'jama', citationStyle: 'jama',
      sections: { methods: { content: 'M', userEdited: true }, results: { content: 'R' } },
      statements: { funding: 'None' },
    };
    const once = JSON.stringify(normalizeDraft(legacy));
    expect(once).toBe(JSON.stringify(normalizeDraft(legacy)));
    expect(once).toBe(JSON.stringify(normalizeDraft(normalizeDraft(legacy))));
    expect(once).not.toContain('"structure"');
  });

  it('an INVALID structure is dropped rather than half-applied', () => {
    for (const bad of [null, 5, 'imrad', {}, { sections: [] }, { sections: [{}] }, { sections: [{ id: 'Bad Id' }] }]) {
      expect(normalizeStructure(bad)).toBeNull();
    }
    const d = normalizeDraft({ structure: { sections: [] }, sections: {} });
    expect('structure' in d).toBe(false);
  });

  it('a chosen structure round-trips byte-identically', () => {
    const applied = applyStructureSwitch(seeded(), 'consort', { nowIso: NOW }).draft;
    const a = JSON.stringify(normalizeDraft(applied, NOW));
    expect(a).toBe(JSON.stringify(normalizeDraft(JSON.parse(a), NOW)));
  });
});

/* ══════════════ the never-delete rule ══════════════ */

describe('119.md §7 (PINNED) — content is never deleted for a missing section', () => {
  it('normalizeDraft keeps a section with text that the structure does not list', () => {
    const d = normalizeDraft({
      structure: { id: 'prisma-p', sections: [{ id: 'title' }, { id: 'methods' }] },
      sections: {
        title: { content: 'T' },
        methods: { content: 'M' },
        results: { content: 'the results paragraph nobody may delete' },
      },
    });
    expect(d.sections.results.content).toBe('the results paragraph nobody may delete');
    // …and it gets a visible place, not merely a surviving key.
    expect(draftSectionIds(d)).toContain('results');
    expect(draftSectionTypes(d).find((s) => s.id === 'results').retained).toBe(true);
  });

  it('drops an unlisted section only when it is EMPTY (no phantom keys)', () => {
    const d = normalizeDraft({
      structure: { id: 'x', sections: [{ id: 'title' }] },
      sections: { title: { content: 'T' }, results: { content: '   ' } },
    });
    expect(Object.keys(d.sections)).toEqual(['title']);
  });

  it('switching IMRAD → CARE preserves every unmapped section, verbatim', () => {
    const before = seeded();
    const res = applyStructureSwitch(before, 'care', { nowIso: NOW });
    expect(res.applied).toBe(true);
    // CARE has no methods/results/limitations/conclusion.
    for (const id of ['methods', 'results', 'limitations', 'conclusion']) {
      expect(res.draft.sections[id].content, id).toBe(`text of ${id}`);
      expect(res.preserved, id).toContain(id);
    }
    // …and every one of them is a labelled, retained section of the document.
    const types = draftSectionTypes(res.draft);
    for (const id of ['methods', 'results', 'limitations', 'conclusion']) {
      expect(types.find((s) => s.id === id).retained, id).toBe(true);
    }
    // The CARE sections all exist and are empty, ready to write into.
    expect(res.draft.sections['patient-information'].content).toBe('');
    expect(res.draft.sections.timeline.content).toBe('');
  });

  it('switching IMRAD → protocol leaves the report-only sections preserved', () => {
    const res = applyStructureSwitch(seeded(), 'prisma-p', { nowIso: NOW });
    expect(res.preserved.sort()).toEqual(['conclusion', 'discussion', 'limitations', 'results']);
    expect(res.draft.sections.discussion.content).toBe('text of discussion');
  });

  it('a MAPPED section moves its text into the target under a labelled heading', () => {
    const res = applyStructureSwitch(seeded(), 'care', {
      nowIso: NOW, mapping: { conclusion: 'discussion' },
    });
    expect(res.merged).toEqual([{ from: 'conclusion', to: 'discussion' }]);
    expect(res.draft.sections.discussion.content).toBe('text of discussion\n\n## Conclusions\n\ntext of conclusion');
    // The moved text is HUMAN text now — a regeneration must never clobber it.
    expect(res.draft.sections.discussion.userEdited).toBe(true);
    // …and the source section is gone from the structure, its text having moved.
    expect(draftSectionIds(res.draft)).not.toContain('conclusion');
  });

  it('round-trips: switching away and BACK restores the original section set', () => {
    const before = seeded();
    const care = applyStructureSwitch(before, 'care', { nowIso: NOW }).draft;
    const back = applyStructureSwitch(care, 'imrad', { nowIso: NOW }).draft;
    expect(draftSectionIds(back).slice(0, 8)).toEqual(SECTION_IDS);
    for (const s of SECTION_TYPES) expect(back.sections[s.id].content).toBe(`text of ${s.id}`);
    // The CARE-only sections were empty, so nothing lingers.
    expect(draftSectionIds(back)).toEqual(SECTION_IDS);
  });

  it('keeps CARE text when switching back after writing into a CARE-only section', () => {
    const care = applyStructureSwitch(seeded(), 'care', { nowIso: NOW }).draft;
    care.sections.timeline = { ...care.sections.timeline, content: 'day 1: admitted', userEdited: true };
    const back = applyStructureSwitch(care, 'imrad', { nowIso: NOW });
    expect(back.draft.sections.timeline.content).toBe('day 1: admitted');
    expect(back.preserved).toContain('timeline');
  });
});

/* ══════════════ preview / diff ══════════════ */

describe('119.md §7 — preview a template before applying it', () => {
  it('says exactly what will be added, renamed, reordered and preserved', () => {
    const plan = planStructureSwitch(seeded(), 'consort');
    expect(plan.ok).toBe(true);
    expect(plan.from.id).toBe('imrad');
    expect(plan.to.id).toBe('consort');
    expect(plan.added).toEqual(['harms', 'open-science']);
    expect(plan.counts.unmapped).toBe(0);
    // 'discussion' moved down past the new 'harms' section.
    expect(plan.moved.map((m) => m.id)).toContain('discussion');
    // Every resulting row states which of the four things it is.
    for (const row of plan.sections) expect(['added', 'kept', 'renamed', 'moved']).toContain(row.state);
  });

  it('reports the word count at stake for each unmapped section', () => {
    const plan = planStructureSwitch(seeded(), 'prisma-p');
    expect(plan.unmapped.map((u) => u.id).sort()).toEqual(['conclusion', 'discussion', 'limitations', 'results']);
    for (const u of plan.unmapped) expect(u.words).toBe(3); // "text of <id>"
    expect(plan.counts.preserved).toBe(4);
    expect(plan.counts.merged).toBe(0);
  });

  it('re-plans as the researcher maps a section, without writing anything', () => {
    const before = seeded();
    const snap = JSON.stringify(before);
    const plan = planStructureSwitch(before, 'prisma-p', { mapping: { results: 'methods' } });
    expect(plan.counts.merged).toBe(1);
    expect(plan.counts.preserved).toBe(3);
    // §7 "Cancel safely" — previewing is pure.
    expect(JSON.stringify(before)).toBe(snap);
  });

  it('refuses an unknown structure instead of guessing one', () => {
    const before = seeded();
    expect(planStructureSwitch(before, 'nope').ok).toBe(false);
    const res = applyStructureSwitch(before, 'nope');
    expect(res.applied).toBe(false);
    expect(res.draft).toBe(before);   // the SAME object — nothing was written
  });

  it('an EMPTY unmatched section is dropped, and reported as such', () => {
    const d = normalizeDraft(makeManuscriptDraft({ nowIso: NOW }), NOW); // all empty
    const plan = planStructureSwitch(d, 'prisma-p');
    expect(plan.unmapped).toEqual([]);
    expect(plan.droppedEmpty.map((x) => x.id).sort()).toEqual(['conclusion', 'discussion', 'limitations', 'results']);
  });
});

/* ══════════════ the three dimensions ══════════════ */

describe('119.md §7 — structure, journal profile and citation style are separate', () => {
  it('applying a structure NEVER touches templateId or citationStyle', () => {
    const before = seeded({ templateId: 'jama', citationStyle: 'harvard' });
    const after = applyStructureSwitch(before, 'strobe', { nowIso: NOW }).draft;
    expect(after.templateId).toBe('jama');
    expect(after.citationStyle).toBe('harvard');
  });

  it('a citation-style change cannot rewrite the structure (nothing writes it)', () => {
    const src = readSource('src/research-engine/manuscript/templates.js');
    // Exactly ONE function assembles a `structure` for the draft from a template.
    const writers = [
      'applyStructureSwitch', 'renameDraftSection', 'moveDraftSection',
    ];
    for (const w of writers) expect(src).toContain(`export function ${w}(`);
    // …and none of them accepts or reads a citation style.
    const body = src.slice(src.indexOf('export function applyStructureSwitch('));
    expect(body).not.toContain('citationStyle');
    // The whole engine has no other assignment of `draft.structure`.
    const state = readSource('src/features/manuscript/manuscriptState.js');
    expect(state).not.toContain('structure:');
  });

  it('setMeta({citationStyle}) leaves the section set alone end-to-end', () => {
    const d = applyStructureSwitch(seeded(), 'care', { nowIso: NOW }).draft;
    const ids = draftSectionIds(d);
    const after = normalizeDraft({ ...d, citationStyle: 'apa' }, NOW);
    expect(draftSectionIds(after)).toEqual(ids);
  });
});

/* ══════════════ every consumer moved in lockstep ══════════════ */

describe('119.md §7 — the section set reaches every consumer', () => {
  const care = applyStructureSwitch(seeded(), 'care', { nowIso: NOW }).draft;

  it('asset numbering reads the draft order, and custom body sections number', () => {
    const secs = orderedSections(care);
    expect(secs.map((s) => s.id).slice(0, 4)).toEqual(['title', 'abstract', 'introduction', 'patient-information']);
    expect(secs.every((s) => typeof s.group === 'string')).toBe(true);
    // A cross-reference typed into a template-introduced BODY section anchors there.
    const d = { ...care, sections: { ...care.sections, timeline: { content: 'see [[table:study]]' } } };
    const num = resolveNumbering({
      sections: d,
      assets: [{ id: 'table:study', kind: 'table', available: true, included: true }],
    });
    expect(num.byId['table:study']).toBe(1);
  });

  it('citation numbering walks the draft order', () => {
    const texts = draftSectionTexts(care);
    expect(texts.length).toBe(draftSectionIds(care).length);
  });

  it('body sections include the template-introduced ones', () => {
    expect(draftBodySectionIds(care)).toContain('timeline');
    expect(draftBodySectionIds(care)).toContain('patient-perspective');
    expect(draftBodySectionIds(care)).not.toContain('title');
  });

  it('the label a section carries is the DRAFT\'S label', () => {
    expect(draftSectionLabel(care, 'timeline')).toBe('Timeline');
    const renamed = renameDraftSection(care, 'timeline', 'Course of illness').draft;
    expect(draftSectionLabel(renamed, 'timeline')).toBe('Course of illness');
    // …and the id (the storage key) never moved, so the text is still there.
    expect(renamed.sections.timeline).toBe(care.sections.timeline);
  });

  it('the .docx body order comes from the draft, not a second literal', () => {
    const src = readSource('src/features/manuscript/export/manuscriptDocx.js');
    expect(src).not.toContain("const bodyOrder = ['introduction', 'methods'");
    expect(src).toContain('const bodySections = draftSectionTypes(draft).filter((s) => s.group !== \'front\');');
    // A preserved section still prints — with an honest line saying why.
    expect(src).toContain('Kept from a previous manuscript structure');
  });

  it('Continuous View renders the draft\'s own sections', () => {
    const src = readSource('src/features/manuscript/ContinuousView.jsx');
    expect(src).toContain('const bodySections = useMemo(() => bodySectionsOf(draft), [draft]);');
    expect(src).toContain('{bodySections.map((s) => {');
    expect(src).toContain('stitch-manuscript-retained-');
  });

  it('readiness / freshness / placeholders / consistency all iterate the draft', () => {
    for (const [file, needle] of [
      ['src/research-engine/manuscript/freshness.js', 'for (const id of draftSectionIds(draft || {}))'],
      ['src/research-engine/manuscript/readiness.js', 'draftSectionIds(draft).filter'],
      ['src/research-engine/manuscript/placeholders.js', 'for (const s of draftSectionTypes(d))'],
      ['src/research-engine/manuscript/consistency.js', 'for (const s of draftSectionTypes(draft || {}))'],
    ]) {
      expect(readSource(file), file).toContain(needle);
    }
  });
});

/* ══════════════ customization ══════════════ */

describe('119.md §7 — customize the resulting structure', () => {
  it('renames a section without moving its text', () => {
    const d = seeded();
    const res = renameDraftSection(d, 'methods', 'Materials and methods');
    expect(res.applied).toBe(true);
    expect(res.draft.sections.methods.content).toBe('text of methods');
    expect(draftSectionLabel(res.draft, 'methods')).toBe('Materials and methods');
    expect(isCustomizedStructure(res.draft)).toBe(true);
  });

  it('refuses an empty label and an unknown section', () => {
    const d = seeded();
    expect(renameDraftSection(d, 'methods', '   ').applied).toBe(false);
    expect(renameDraftSection(d, 'nope', 'X').applied).toBe(false);
  });

  it('reorders body sections and never the title block', () => {
    const d = seeded();
    const moved = moveDraftSection(d, 'limitations', -1);
    expect(moved.applied).toBe(true);
    expect(draftSectionIds(moved.draft)).toEqual([
      'title', 'abstract', 'introduction', 'methods', 'results', 'limitations', 'discussion', 'conclusion',
    ]);
    expect(moveDraftSection(d, 'title', 1).applied).toBe(false);
    expect(moveDraftSection(d, 'abstract', 1).applied).toBe(false);
    expect(moveDraftSection(d, 'introduction', -1).applied).toBe(false); // would pass the front
    expect(moveDraftSection(d, 'conclusion', 1).applied).toBe(false);    // already last
  });

  it('a reorder changes reading order, and therefore citation order', () => {
    const d = normalizeDraft({
      sections: {
        results: { content: 'cites [[cite:b]]' },
        discussion: { content: 'cites [[cite:a]]' },
      },
    });
    expect(draftSectionTexts(d).filter(Boolean)).toEqual(['cites [[cite:b]]', 'cites [[cite:a]]']);
    const moved = moveDraftSection(d, 'discussion', -1).draft;
    expect(draftSectionTexts(moved).filter(Boolean)).toEqual(['cites [[cite:a]]', 'cites [[cite:b]]']);
  });
});

/* ══════════════ snapshot-backed undo ══════════════ */

describe('119.md §7 — undo a template change / restore a prior snapshot', () => {
  const project = { studies: [], pico: {} };

  it('a snapshot records the structure and the two format dimensions', () => {
    const d = applyStructureSwitch(seeded({ templateId: 'jama', citationStyle: 'jama' }), 'care', { nowIso: NOW }).draft;
    const { snapshot } = createSnapshot(d, project, { nowIso: NOW });
    expect(snapshot.structure.id).toBe('care');
    expect(snapshot.templateId).toBe('jama');
    expect(snapshot.citationStyle).toBe('jama');
    // Every CARE section is captured, not only the core eight.
    expect(Object.keys(snapshot.sections)).toContain('timeline');
  });

  it('a structureless draft snapshots `structure: null` (absent means pre-119)', () => {
    const { snapshot } = createSnapshot(seeded(), project, { nowIso: NOW });
    expect(snapshot.structure).toBeNull();
    expect('structure' in snapshot).toBe(true);
  });

  it('restoring the pre-switch snapshot undoes the whole template change', () => {
    const before = seeded();
    const { draft: withSnap, snapshot } = createSnapshot(before, project, { label: 'Before structure change', nowIso: NOW });
    const after = applyStructureSwitch(withSnap, 'care', { nowIso: NOW }).draft;
    expect(draftStructure(after).id).toBe('care');

    const restored = restoreSnapshot(after, snapshot.id, { nowIso: NOW });
    expect(restored.restored).toBe(true);
    expect('structure' in restored.draft).toBe(false);   // back to the core eight
    expect(draftSectionIds(restored.draft)).toEqual(SECTION_IDS);
    for (const s of SECTION_TYPES) expect(restored.draft.sections[s.id].content).toBe(`text of ${s.id}`);
  });

  it('restoring takes a safety backup first, so the undo is itself undoable', () => {
    const before = seeded();
    const { draft: withSnap, snapshot } = createSnapshot(before, project, { nowIso: NOW });
    const after = applyStructureSwitch(withSnap, 'care', { nowIso: NOW }).draft;
    const restored = restoreSnapshot(after, snapshot.id, { nowIso: NOW }).draft;
    const safety = restored.snapshots.find((s) => s.label === 'Before restore');
    expect(safety).toBeTruthy();
    expect(safety.structure.id).toBe('care');
    const redo = restoreSnapshot(restored, safety.id, { nowIso: NOW }).draft;
    expect(draftStructure(redo).id).toBe('care');
  });

  it('a PRE-119 snapshot (no structure key) leaves the current structure alone', () => {
    const care = applyStructureSwitch(seeded(), 'care', { nowIso: NOW }).draft;
    const legacySnap = {
      id: 'snap_1_x', label: 'old', frozen: false, createdAt: NOW,
      title: 'T', sections: { introduction: { content: 'old intro' } }, statements: {}, references: [],
    };
    const res = restoreSnapshot({ ...care, snapshots: [legacySnap] }, 'snap_1_x', { nowIso: NOW });
    expect(res.restored).toBe(true);
    expect(draftStructure(res.draft).id).toBe('care');
    expect(res.draft.sections.introduction.content).toBe('old intro');
  });

  it('a locked section is never overwritten by a structure-change undo', () => {
    const before = seeded();
    before.sections.methods = { ...before.sections.methods, locked: true };
    const { draft: withSnap, snapshot } = createSnapshot(before, project, { nowIso: NOW });
    const after = applyStructureSwitch(withSnap, 'care', { nowIso: NOW }).draft;
    const restored = restoreSnapshot(after, snapshot.id, { nowIso: NOW });
    expect(restored.skippedLocked).toContain('methods');
    expect(restored.draft.sections.methods.content).toBe('text of methods');
  });
});
