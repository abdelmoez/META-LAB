/**
 * searchRegenerate.test.js — 97.md Phase 4 (plan §9, Decision R1). The explicit
 * Regenerate engine: question-text → NEUTRAL-label groups (never picoField-
 * labeled), deterministic, drift-anchored via sourcePhrase, meta stamped with
 * generation provenance only. The snapshot-first flow around it is client wiring
 * (versions API reuse) covered by integration/e2e; the state transition is here.
 */
import { describe, it, expect } from 'vitest';
import {
  regenerateConceptsFromQuestion, buildRegenerateState, REGENERATED_SOURCE,
  REGENERATE_CONFIRM_COPY, REGENERATE_DONE_MESSAGE, PRE_REGENERATE_SNAPSHOT_NAME,
} from '../../src/research-engine/searchBuilder/regenerate.js';
import { norm } from '../../src/research-engine/searchBuilder/conceptExtraction.js';
import { conceptDrift, serializeSearchState } from '../../src/research-engine/searchBuilder/searchState.js';

const QUESTION = 'Does metformin reduce mortality in adults with type 2 diabetes?';

describe('regenerateConceptsFromQuestion — neutral groups from the question', () => {
  it('labels every group "Concept N" (98.md §8) and NEVER stamps picoField (97 Phase 8)', () => {
    const out = regenerateConceptsFromQuestion(QUESTION);
    expect(out.length).toBeGreaterThanOrEqual(2);
    out.forEach((c, i) => {
      expect(c.label).toBe(`Concept ${i + 1}`);
      expect(c.picoField).toBeUndefined();
      expect(c.source).toBe(REGENERATED_SOURCE);
      expect(c.op).toBe('AND');
      expect(c.id).toBeUndefined(); // module contract — the caller assigns ids
      expect(c.terms.length).toBeGreaterThan(0);
      for (const t of c.terms) {
        expect(t.source).toBe(REGENERATED_SOURCE); // NOT 'pico_auto' — no legacy exemptions
        expect(t.id).toBeUndefined();
        expect(t.type).toBe('freetext');
        expect(t.field).toBe('tiab');
      }
    });
  });

  it('extracts the clinical ideas (family ladders ride along)', () => {
    // Connector-separated ideas each become one OR group (the extraction engine
    // maps ONE family per segment — the documented 96 extraction behavior the
    // plan's Decision R1 reuses).
    const out = regenerateConceptsFromQuestion('metformin versus placebo in adults with heart failure');
    const allTexts = out.flatMap((c) => c.terms.map((t) => norm(t.text)));
    expect(allTexts).toContain('metformin');
    expect(allTexts).toContain('heart failure');
    // …and the QUESTION fixture keeps its two segment ideas.
    const q = regenerateConceptsFromQuestion(QUESTION);
    const qTexts = q.flatMap((c) => c.terms.map((t) => norm(t.text)));
    expect(qTexts).toContain('type 2 diabetes mellitus'); // the diabetes family ladder
    expect(qTexts).toContain('mortality');
  });

  it('anchors drift: every sourcePhrase appears in the question, so a fresh regeneration NEVER drifts', () => {
    const out = regenerateConceptsFromQuestion(QUESTION).map((c, i) => ({ ...c, id: `g${i}` }));
    const q = norm(QUESTION);
    for (const c of out) expect(q.includes(norm(c.sourcePhrase))).toBe(true);
    expect(conceptDrift(QUESTION, out)).toEqual([]);
  });

  it('is deterministic and dedupes concepts across segments by primary term', () => {
    const a = regenerateConceptsFromQuestion(QUESTION);
    const b = regenerateConceptsFromQuestion(QUESTION);
    expect(serializeSearchState({ concepts: a })).toBe(serializeSearchState({ concepts: b }));
    const twice = regenerateConceptsFromQuestion('heart failure, heart failure');
    expect(twice).toHaveLength(1);
  });

  // (QA M5 note — the UI does NOT gate the Regenerate button on a blank question;
  //  a confirm on one replaces the workspace with zero groups, protected by the
  //  flush-first snapshot + whole-state undo. The engine simply stays calm.)
  it('returns [] for a blank question (the engine stays calm)', () => {
    expect(regenerateConceptsFromQuestion('')).toEqual([]);
    expect(regenerateConceptsFromQuestion('   ')).toEqual([]);
    expect(regenerateConceptsFromQuestion(null)).toEqual([]);
  });
});

describe('buildRegenerateState — the complete regenerated slice', () => {
  const user = { id: 'u1', name: 'Ada' };
  const at = '2026-08-02T10:00:00.000Z';

  it('returns { concepts, questionSnapshot, meta } with generation provenance ONLY', () => {
    const out = buildRegenerateState({ question: `  ${QUESTION}  `, user, at });
    expect(out.questionSnapshot).toBe(QUESTION); // trimmed (cap 2000 — the seed normalization)
    expect(out.concepts.length).toBeGreaterThan(0);
    expect(out.meta).toEqual({
      generatedAt: at,
      generatedBy: { id: 'u1', name: 'Ada' },
      sourceQuestion: QUESTION,
    });
    // manuallyModified* is RESET — "modified since generation" derives from its absence.
    expect(out.meta.manuallyModifiedAt).toBeUndefined();
    expect(out.meta.manuallyModifiedBy).toBeUndefined();
  });

  it('caps the snapshot at 2000 chars and degrades to meta undefined only when EVERYTHING is empty', () => {
    const long = 'x'.repeat(2500);
    expect(buildRegenerateState({ question: long, user, at }).questionSnapshot.length).toBe(2000);
    const empty = buildRegenerateState({});
    expect(empty.concepts).toEqual([]);
    expect(empty.questionSnapshot).toBe('');
    expect(empty.meta).toBeUndefined();
  });
});

describe('97 Phase 4 pinned copy (98.md §8 — concept groups, PICO mention removed)', () => {
  it('confirmation dialog copy matches the spec verbatim', () => {
    expect(REGENERATE_CONFIRM_COPY.title).toBe('Regenerate search strategy?');
    expect(REGENERATE_CONFIRM_COPY.body).toBe(
      'This will rebuild the automatically generated keywords and concept groups from the current research question. Your current manual organization may change.',
    );
    expect(REGENERATE_CONFIRM_COPY.cancel).toBe('Cancel');
    expect(REGENERATE_CONFIRM_COPY.confirm).toBe('Regenerate');
  });
  it('post-action + snapshot names are pinned', () => {
    expect(REGENERATE_DONE_MESSAGE).toBe('Search strategy regenerated.');
    expect(PRE_REGENERATE_SNAPSHOT_NAME).toBe('Before regeneration');
  });
});
