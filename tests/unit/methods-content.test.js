/**
 * methods-content.test.js
 * Structural contract tests for the "Methods & Equations" reference content
 * (prompt6 Task 13 — src/research-engine/docs/methods-content.js).
 *
 * The whitelists below are HARDCODED on purpose: they are the reviewed
 * contract from docs/manager/team-opinion-and-implementation-plan.md §4 and
 * the research-engine opinion. Only methods actually implemented in the
 * research engine may be documented, and the citation pool may not be
 * "rounded out" with plausible extras. If a test here fails after a content
 * edit, the content is wrong unless the engine itself changed.
 */

import { describe, it, expect } from 'vitest';
import { METHODS_CONTENT, NOT_IMPLEMENTED } from '../../src/research-engine/docs/methods-content.js';

// ── The implemented-methods whitelist (the contract — nothing else may appear) ──
const WHITELIST = [
  // 1. Pooling models
  'fixed-effect-inverse-variance',
  'cochran-q',
  'i-squared',
  'dersimonian-laird-tau2',
  'random-effects-dl',
  'z-statistic-p-value',
  'confidence-interval-95',
  'hksj-adjustment',
  'prediction-interval',
  // 2. Publication bias
  'eggers-test',
  'trim-and-fill',
  // 3. Sensitivity analyses
  'leave-one-out',
  'influence-dffits',
  'subgroup-q-between',
  // 4. Effect-size calculators (calcES types)
  'es-mean-difference',
  'es-smd-cohens-d',
  'es-log-odds-ratio',
  'es-log-risk-ratio',
  'es-risk-difference',
  'es-log-hazard-ratio',
  'es-fisher-z',
  'es-logit-proportion',
  'es-log-dor',
  // 5. The 9 conversion recipes (conversions/catalogue.js)
  'conv-median-iqr',
  'conv-median-range',
  'conv-se-to-sd',
  'conv-ci-to-sd',
  'conv-pvalue-to-se',
  'conv-percent-to-events',
  'conv-events-to-percent',
  'conv-ratio-to-log',
  'conv-unit-scale',
  // 6. Screening + 7. numerical foundations
  'duplicate-similarity-scorepair',
  'numerical-methods',
];

// Entries that are in-house heuristics / unverifiable citations — these (and
// ONLY these) must carry verified:false so the UI shows the badge.
const NEEDS_VERIFICATION = [
  'es-logit-proportion',          // logit-SE: standard delta-method, no formula-specific source
  'conv-median-iqr',              // exact Wan equation variant not re-verified
  'duplicate-similarity-scorepair', // 0.7/0.15/0.15 weights are an in-house heuristic
  'numerical-methods',            // Acklam inverse-normal has no journal citation
];

// Canonical citation pool: every reference string must start with one of these
// (pushback 2 — nobody "rounds out" the reference list with plausible extras).
const ALLOWED_REFERENCE_PREFIXES = [
  'Cochran WG.',
  'DerSimonian R, Laird N.',
  'Higgins JPT, Thompson SG.',                   // Higgins & Thompson 2002
  'Higgins JPT, Thompson SG, Spiegelhalter DJ.', // prediction interval 2009
  'Hartung J, Knapp G.',
  'Sidik K, Jonkman JN.',
  'IntHout J,',
  'Riley RD,',
  'Egger M,',
  'Duval S, Tweedie R.',
  'Viechtbauer W, Cheung MWL.',
  'Borenstein M,',
  'Cohen J.',
  'Hedges LV, Olkin I.',
  'Fisher RA.',
  'Glas AS,',
  'Haldane JBS.',
  'Tierney JF,',
  'Parmar MK,',
  'Cochrane Handbook',
  'Wan X,',
  'Hozo SP,',
  'Levenshtein VI.',
  'Jaccard P.',
  'Abramowitz M, Stegun IA.',
  'Press WH,',
  'Lanczos C.',
];

const nonEmptyString = v => typeof v === 'string' && v.trim().length > 0;

// ── Top-level shape ───────────────────────────────────────────────────────────
describe('METHODS_CONTENT — top-level shape', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(METHODS_CONTENT)).toBe(true);
    expect(METHODS_CONTENT.length).toBeGreaterThan(0);
  });

  it('ids are unique', () => {
    const ids = METHODS_CONTENT.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ids are kebab-case', () => {
    for (const e of METHODS_CONTENT) {
      expect(e.id, `id "${e.id}" is not kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

// ── Per-entry structural contract ─────────────────────────────────────────────
describe('METHODS_CONTENT — per-entry contract', () => {
  for (const entry of METHODS_CONTENT) {
    describe(`entry "${entry.id}"`, () => {
      it('has non-empty id, title, plainEnglish, usedIn, implementedIn, limitations', () => {
        expect(nonEmptyString(entry.id)).toBe(true);
        expect(nonEmptyString(entry.title)).toBe(true);
        expect(nonEmptyString(entry.plainEnglish)).toBe(true);
        expect(nonEmptyString(entry.usedIn)).toBe(true);
        expect(nonEmptyString(entry.implementedIn)).toBe(true);
        expect(nonEmptyString(entry.limitations)).toBe(true);
      });

      it('has a non-empty equations array of {label, text}', () => {
        expect(Array.isArray(entry.equations)).toBe(true);
        expect(entry.equations.length).toBeGreaterThan(0);
        for (const eq of entry.equations) {
          expect(nonEmptyString(eq.label)).toBe(true);
          expect(nonEmptyString(eq.text)).toBe(true);
        }
      });

      it('has a non-empty references array of non-empty strings', () => {
        expect(Array.isArray(entry.references)).toBe(true);
        expect(entry.references.length).toBeGreaterThan(0);
        for (const ref of entry.references) {
          expect(nonEmptyString(ref)).toBe(true);
        }
      });

      it('has a boolean verified flag', () => {
        expect(typeof entry.verified).toBe('boolean');
      });
    });
  }
});

// ── Implemented-methods whitelist (the contract) ──────────────────────────────
describe('METHODS_CONTENT — implemented-methods whitelist', () => {
  it('contains no entry outside the whitelist', () => {
    for (const e of METHODS_CONTENT) {
      expect(WHITELIST, `unexpected entry "${e.id}" — not in the implemented whitelist`).toContain(e.id);
    }
  });

  it('documents every whitelisted method (no silent drops)', () => {
    const ids = new Set(METHODS_CONTENT.map(e => e.id));
    for (const id of WHITELIST) {
      expect(ids.has(id), `whitelisted method "${id}" is missing`).toBe(true);
    }
  });
});

// ── verified flags ────────────────────────────────────────────────────────────
describe('METHODS_CONTENT — verified flags', () => {
  it('the verified:false set is exactly the known needs-verification entries', () => {
    const unverified = METHODS_CONTENT.filter(e => e.verified === false).map(e => e.id).sort();
    expect(unverified).toEqual([...NEEDS_VERIFICATION].sort());
  });

  it('every verified:false entry explains why in its limitations', () => {
    for (const e of METHODS_CONTENT.filter(x => x.verified === false)) {
      expect(e.limitations, `"${e.id}" lacks a needs-verification/heuristic note`)
        .toMatch(/needs verification|heuristic/i);
    }
  });
});

// ── Citation pool ─────────────────────────────────────────────────────────────
describe('METHODS_CONTENT — citation pool', () => {
  it('every reference starts with a canonical whitelisted citation', () => {
    for (const e of METHODS_CONTENT) {
      for (const ref of e.references) {
        const ok = ALLOWED_REFERENCE_PREFIXES.some(p => ref.startsWith(p));
        expect(ok, `entry "${e.id}" cites a non-whitelisted reference: "${ref}"`).toBe(true);
      }
    }
  });

  it('truth-fix: the SMD entry is documented as Cohen\'s d without a Hedges g claim', () => {
    const smd = METHODS_CONTENT.find(e => e.id === 'es-smd-cohens-d');
    expect(smd).toBeDefined();
    expect(smd.title).toMatch(/Cohen's d/);
    // The g correction is explicitly documented as NOT applied
    expect(smd.plainEnglish + ' ' + smd.limitations).toMatch(/NOT used|No Hedges'? small-sample correction/i);
  });
});

// ── NOT_IMPLEMENTED ───────────────────────────────────────────────────────────
describe('NOT_IMPLEMENTED', () => {
  it('is a non-empty array of non-empty strings', () => {
    expect(Array.isArray(NOT_IMPLEMENTED)).toBe(true);
    expect(NOT_IMPLEMENTED.length).toBeGreaterThan(0);
    for (const item of NOT_IMPLEMENTED) {
      expect(nonEmptyString(item)).toBe(true);
    }
  });

  it('names the commonly expected missing methods', () => {
    const joined = NOT_IMPLEMENTED.join(' · ');
    expect(joined).toMatch(/REML/);
    expect(joined).toMatch(/Paule[-–]?Mandel/i);
    expect(joined).toMatch(/Peters/);
    expect(joined).toMatch(/Begg/);
    expect(joined).toMatch(/meta-regression/i);
    expect(joined).toMatch(/network meta-analysis/i);
  });

  it('does not contradict the documented whitelist', () => {
    // sanity: nothing listed as not-implemented may also be documented as implemented
    const titles = METHODS_CONTENT.map(e => e.title.toLowerCase()).join(' ');
    for (const missing of ['peters', 'begg', 'meta-regression', 'network meta-analysis']) {
      expect(titles).not.toContain(missing);
    }
  });
});
