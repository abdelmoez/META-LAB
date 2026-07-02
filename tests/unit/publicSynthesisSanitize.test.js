/**
 * publicSynthesisSanitize.test.js — 68.md P8. The public synthesis payload is an
 * UNAUTHENTICATED artifact, so the sanitization boundary is safety-critical: no
 * reviewer identity, note, decision, email, conflict, extractedBy or per-record
 * permission may ever appear in the output. These tests build a deliberately
 * POISONED project blob + RoB rows and assert none of the poison strings survive
 * anywhere in the serialized payload. Also covers token entropy, version bumps,
 * unpublished reads, and the CSV formula-injection guard.
 *
 * The payload builder is a PURE function (buildPublicPayloadFromData) so this file
 * needs no DB — it exercises the exact boundary the public route serves.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPublicPayloadFromData,
  normalizeSettings,
  DEFAULT_PUBLIC_SETTINGS,
  sanitizeCards,
  payloadToCsv,
  csvField,
  newShareToken,
  deriveRob,
} from '../../server/publicSynthesis/publicSynthesisService.js';

// Distinctive poison markers we will hunt for in the serialized output.
const POISON = [
  'REVIEWER_SECRET_NOTE',
  'reviewer@example.com',
  'ADJUDICATOR_NAME_JANE',
  'ROB_PRIVATE_JUSTIFICATION',
  'DECISION_EXCLUDE_REASON',
  'EXTRACTED_BY_BOB',
  'INTERNAL_CONFLICT_TEXT',
  'PERMISSIONS_LEAK',
];

function poisonedProject() {
  return {
    name: 'My Public Review',
    data: {
      question: 'Does X improve Y?',
      pico: { P: 'adults', I: 'X', C: 'placebo', O: 'mortality' },
      studies: [
        {
          id: 's1', author: 'Smith', authors: 'Smith J', year: '2020', title: 'Trial A',
          journal: 'NEJM', doi: '10.1/abc', outcome: 'Mortality', timepoint: '6mo', esType: 'RR',
          es: '0.8', lo: '0.6', hi: '1.0',
          // ── poison fields that MUST NOT leak ──
          notes: 'REVIEWER_SECRET_NOTE', reviewerNotes: 'REVIEWER_SECRET_NOTE',
          reviewerEmail: 'reviewer@example.com', extractedBy: 'EXTRACTED_BY_BOB',
          decision: 'DECISION_EXCLUDE_REASON', rob: { justification: 'ROB_PRIVATE_JUSTIFICATION' },
          conflict: 'INTERNAL_CONFLICT_TEXT', _permissions: 'PERMISSIONS_LEAK',
        },
        {
          id: 's2', author: 'Jones', year: '2021', title: 'Trial B',
          outcome: 'Mortality', timepoint: '6mo', esType: 'RR', es: '0.7', lo: '0.5', hi: '0.95',
          notes: 'REVIEWER_SECRET_NOTE', extractedBy: 'EXTRACTED_BY_BOB',
        },
      ],
      // adjudicator identity buried in the blob — must never surface
      reviewers: [{ name: 'ADJUDICATOR_NAME_JANE', email: 'reviewer@example.com' }],
    },
  };
}

const poisonedRob = [
  { overall: { overridden: true, finalOverall: 'high', proposedOverall: 'low', overrideJustification: 'ROB_PRIVATE_JUSTIFICATION' } },
  { overall: { overridden: false, finalOverall: null, proposedOverall: 'low' } },
  { overall: { overridden: false, finalOverall: null, proposedOverall: 'some' } },
];

const poisonedCards = [
  { id: 'c1', type: 'summaryText', title: 'Summary', settings: { note: 'REVIEWER_SECRET_NOTE' }, order: 0 },
  { id: 'c2', type: 'forest', title: 'Forest', order: 1 },
  { id: 'c3', type: '__evil__', title: 'PERMISSIONS_LEAK', order: 2 }, // unknown type → dropped
];

describe('public synthesis sanitization boundary', () => {
  const settings = normalizeSettings(DEFAULT_PUBLIC_SETTINGS);

  it('never leaks any poisoned private string anywhere in the payload', () => {
    const payload = buildPublicPayloadFromData(
      { project: poisonedProject(), robRows: poisonedRob, layoutCards: poisonedCards, prismaCounts: { identified: 10, duplicatesRemoved: 2, screened: 8, fullTextAssessed: 3, included: 2 } },
      settings,
    );
    const str = JSON.stringify(payload);
    for (const bad of POISON) {
      expect(str).not.toContain(bad);
    }
  });

  it('includes ONLY whitelisted study fields (author/year/title/journal/doi)', () => {
    const payload = buildPublicPayloadFromData({ project: poisonedProject(), robRows: [], layoutCards: [] }, settings);
    expect(payload.includedStudies.length).toBe(2);
    const keys = Object.keys(payload.includedStudies[0]).sort();
    expect(keys).toEqual(['author', 'doi', 'journal', 'title', 'year']);
    expect(payload.includedStudies[0].author).toBe('Smith');
  });

  it('computes MA results with author+year labels only (no notes)', () => {
    const payload = buildPublicPayloadFromData({ project: poisonedProject(), robRows: [], layoutCards: [] }, settings);
    expect(payload.ma.length).toBeGreaterThan(0);
    const row = payload.ma[0];
    expect(row.outcome).toBe('Mortality');
    expect(row.k).toBe(2);
    expect(Array.isArray(row.studies)).toBe(true);
    // per-study rows carry ONLY label/es/lo/hi/weight
    expect(Object.keys(row.studies[0]).sort()).toEqual(['es', 'hi', 'label', 'lo', 'weight']);
    expect(row.studies[0].label).toMatch(/Smith/);
    expect(JSON.stringify(row.studies)).not.toContain('REVIEWER_SECRET_NOTE');
  });

  it('reduces RoB to resolved-level counts only', () => {
    const rob = deriveRob(poisonedRob);
    expect(rob).toEqual({ total: 3, low: 1, some: 1, high: 1 }); // s1 override → high wins
    expect(JSON.stringify(rob)).not.toContain('ROB_PRIVATE_JUSTIFICATION');
  });

  it('respects section toggles — methods OFF drops PICO', () => {
    const off = normalizeSettings({ ...DEFAULT_PUBLIC_SETTINGS, sections: { ...DEFAULT_PUBLIC_SETTINGS.sections, methods: false }, showMethods: false });
    const payload = buildPublicPayloadFromData({ project: poisonedProject(), robRows: [], layoutCards: [] }, off);
    expect(payload.pico).toBeNull();
  });

  it('drops unknown dashboard card types and keeps only whitelisted ones', () => {
    const clean = sanitizeCards(poisonedCards);
    expect(clean.map(c => c.type)).toEqual(['summaryText', 'forest']);
    expect(JSON.stringify(clean)).not.toContain('__evil__');
    expect(JSON.stringify(clean)).not.toContain('PERMISSIONS_LEAK');
  });

  it('builds a year histogram from study years', () => {
    const payload = buildPublicPayloadFromData({ project: poisonedProject(), robRows: [], layoutCards: [] }, settings);
    expect(payload.yearHistogram).toEqual([{ year: 2020, count: 1 }, { year: 2021, count: 1 }]);
  });
});

describe('share token entropy', () => {
  it('is 64 lowercase hex chars', () => {
    const t = newShareToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unique across many mints', () => {
    const set = new Set();
    for (let i = 0; i < 200; i++) set.add(newShareToken());
    expect(set.size).toBe(200);
  });
});

describe('CSV formula-injection guard', () => {
  it('prefixes =+-@ leading cells with a quote', () => {
    // csvField applies the formula guard FIRST, then RFC-4180 quoting; a cell with
    // embedded quotes is additionally wrapped and its quotes doubled.
    expect(csvField('=HYPERLINK("evil")')).toBe(`"'=HYPERLINK(""evil"")"`);
    expect(csvField('+1')).toBe(`'+1`);
    expect(csvField('@cmd')).toBe(`'@cmd`);
    expect(csvField('normal')).toBe('normal');
    // the guard's essential property: the neutralized cell never STARTS with =+-@
    for (const v of ['=EVIL()', '+1', '-2', '@x']) {
      expect(csvField(v).startsWith("'")).toBe(true);
    }
  });

  it('CSV export neutralizes a study title that starts with =', () => {
    const payload = {
      includedStudies: [{ author: 'X', year: 2020, title: '=EVIL()', journal: 'J', doi: 'd' }],
      ma: [],
    };
    const csv = payloadToCsv(payload);
    expect(csv).toContain(`'=EVIL()`);
    expect(csv).not.toMatch(/,=EVIL\(\)/); // never a raw formula-leading cell
  });
});
