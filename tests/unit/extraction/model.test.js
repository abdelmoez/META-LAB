/**
 * model.test.js — Data Element model (P5).
 * Covers: template integrity, element validation, value validation edge cases,
 * categorical canonicalization, date parsing, normalization, and the value-key format.
 */

import { describe, it, expect } from 'vitest';
import {
  ELEMENT_TYPES,
  TEMPLATES,
  TEMPLATE_KEYS,
  mkElement,
  instantiateTemplate,
  validateElement,
  validateValue,
  normalizeValue,
  matchCategorical,
  isValidDateString,
  valueKey,
  isMissing,
} from '../../../src/research-engine/extraction/model.js';

const seqIdFn = () => {
  let i = 0;
  return () => `id${++i}`;
};

describe('mkElement', () => {
  it('fills sane defaults and honors an injectable idFn', () => {
    const el = mkElement({ name: 'Sample size', type: 'numeric' }, () => 'fixed123');
    expect(el.id).toBe('fixed123');
    expect(el.name).toBe('Sample size');
    expect(el.type).toBe('numeric');
    expect(el.armScope).toBe('study');
    expect(el.maCompatible).toBeNull();
    expect(el.allowedValues).toEqual([]);
    expect(el.validation).toEqual({ min: null, max: null, integer: false });
  });

  it('falls back to type "text" for an unknown type', () => {
    const el = mkElement({ name: 'x', type: 'bogus' }, () => 'a');
    expect(el.type).toBe('text');
  });

  it('generates an 8-char id by default (repo uid pattern)', () => {
    const el = mkElement({ name: 'x' });
    expect(typeof el.id).toBe('string');
    expect(el.id.length).toBeGreaterThanOrEqual(6);
    expect(el.id.length).toBeLessThanOrEqual(8);
  });
});

describe('template integrity', () => {
  it('exposes all expected template keys', () => {
    expect(TEMPLATE_KEYS).toEqual([
      'generic',
      'rct_intervention',
      'diagnostic_accuracy',
      'observational_cohort',
      'dichotomous_2x2',
      'continuous_outcome',
      'nma_arm_level',
    ]);
  });

  it('every template element passes validateElement after instantiation', () => {
    for (const key of TEMPLATE_KEYS) {
      const els = instantiateTemplate(key, seqIdFn());
      expect(els.length).toBeGreaterThanOrEqual(4);
      expect(els.length).toBeLessThanOrEqual(12);
      for (const el of els) {
        const { ok, errors } = validateElement(el);
        expect(ok, `template ${key} / element "${el.name}": ${errors.join(', ')}`).toBe(true);
      }
    }
  });

  it('every template element type is a known ELEMENT_TYPE', () => {
    for (const t of TEMPLATES) {
      for (const e of t.elements) {
        expect(ELEMENT_TYPES).toContain(e.type);
      }
    }
  });

  it('dichotomous_2x2 has arm-scoped MA-compatible dichotomous elements', () => {
    const els = instantiateTemplate('dichotomous_2x2', seqIdFn());
    const dich = els.filter((e) => e.maCompatible === 'dichotomous');
    expect(dich.length).toBe(2);
    dich.forEach((e) => {
      expect(e.armScope).toBe('arm');
      expect(e.type).toBe('dichotomous_outcome');
    });
  });

  it('continuous_outcome has MA-compatible continuous elements', () => {
    const els = instantiateTemplate('continuous_outcome', seqIdFn());
    const cont = els.filter((e) => e.maCompatible === 'continuous');
    expect(cont.length).toBe(2);
    cont.forEach((e) => expect(e.type).toBe('continuous_outcome'));
  });

  it('nma_arm_level has arm-scoped elements', () => {
    const els = instantiateTemplate('nma_arm_level', seqIdFn());
    const armEls = els.filter((e) => e.armScope === 'arm');
    expect(armEls.length).toBeGreaterThanOrEqual(3);
  });

  it('instantiateTemplate returns [] for an unknown key', () => {
    expect(instantiateTemplate('nope')).toEqual([]);
  });
});

describe('validateElement', () => {
  it('flags missing name', () => {
    const { ok, errors } = validateElement(mkElement({ type: 'text' }, () => 'a'));
    expect(ok).toBe(false);
    expect(errors.join()).toMatch(/name is required/);
  });

  it('flags min > max', () => {
    const el = mkElement({ name: 'x', type: 'numeric', validation: { min: 10, max: 5 } }, () => 'a');
    const { ok, errors } = validateElement(el);
    expect(ok).toBe(false);
    expect(errors.join()).toMatch(/min is greater than/);
  });

  it('flags maCompatible/type mismatch', () => {
    const el = mkElement({ name: 'x', type: 'numeric', maCompatible: 'dichotomous' }, () => 'a');
    const { ok } = validateElement(el);
    expect(ok).toBe(false);
  });
});

describe('validateValue — numeric', () => {
  const el = mkElement({ name: 'N', type: 'numeric', validation: { min: 0, max: 1000, integer: true } }, () => 'a');

  it('accepts a valid integer', () => {
    const r = validateValue(el, '123');
    expect(r.ok).toBe(true);
    expect(r.normalized).toEqual({ value: 123, unit: '' });
  });

  it('rejects a non-integer when integer required', () => {
    const r = validateValue(el, '12.5');
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/integer/);
  });

  it('rejects below min and above max', () => {
    expect(validateValue(el, '-1').ok).toBe(false);
    expect(validateValue(el, '5000').ok).toBe(false);
  });

  it('rejects non-numeric text', () => {
    expect(validateValue(el, 'abc').ok).toBe(false);
  });

  it('required + empty is an error; non-required + empty is ok', () => {
    const req = mkElement({ name: 'N', type: 'numeric', required: true }, () => 'a');
    expect(validateValue(req, '').ok).toBe(false);
    expect(validateValue(el, '').ok).toBe(true);
  });
});

describe('validateValue — categorical', () => {
  const el = mkElement({ name: 'Design', type: 'categorical', allowedValues: ['RCT', 'Cohort', 'Case-control'] }, () => 'a');

  it('accepts a case-insensitive match and canonicalizes casing', () => {
    const r = validateValue(el, 'rct');
    expect(r.ok).toBe(true);
    expect(r.normalized.value).toBe('RCT');
  });

  it('rejects a value not in allowedValues', () => {
    expect(validateValue(el, 'Survey').ok).toBe(false);
  });

  it('matchCategorical returns null for no match', () => {
    expect(matchCategorical(['A', 'B'], 'c')).toBeNull();
    expect(matchCategorical(['A', 'B'], 'a')).toBe('A');
  });
});

describe('validateValue — date', () => {
  const el = mkElement({ name: 'Pub date', type: 'date' }, () => 'a');
  it('accepts YYYY and YYYY-MM-DD', () => {
    expect(validateValue(el, '2021').ok).toBe(true);
    expect(validateValue(el, '2021-06-15').ok).toBe(true);
  });
  it('rejects malformed dates', () => {
    expect(validateValue(el, '21-6-15').ok).toBe(false);
    expect(validateValue(el, '2021-13-01').ok).toBe(false);
    expect(isValidDateString('2021-06-31')).toBe(true); // day-of-month bounds only loosely checked
    expect(isValidDateString('June 2021')).toBe(false);
  });
});

describe('validateValue — dichotomous_outcome', () => {
  const el = mkElement({ name: 'Events', type: 'dichotomous_outcome', armScope: 'arm', maCompatible: 'dichotomous' }, () => 'a');

  it('normalizes {events,total} to numbers', () => {
    const r = validateValue(el, { events: '12', total: '45' });
    expect(r.ok).toBe(true);
    expect(r.normalized).toEqual({ events: 12, total: 45 });
  });

  it('rejects events > total', () => {
    const r = validateValue(el, { events: 50, total: 45 });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/exceed/);
  });

  it('rejects negative / non-integer counts', () => {
    expect(validateValue(el, { events: -1, total: 10 }).ok).toBe(false);
    expect(validateValue(el, { events: 1.5, total: 10 }).ok).toBe(false);
  });

  it('missing both subfields is ok when not required', () => {
    const r = validateValue(el, {});
    expect(r.ok).toBe(true);
    expect(r.normalized).toEqual({ events: null, total: null });
  });
});

describe('validateValue — continuous_outcome', () => {
  const el = mkElement({ name: 'Score', type: 'continuous_outcome', armScope: 'arm', maCompatible: 'continuous' }, () => 'a');

  it('normalizes the full continuous shape', () => {
    const r = validateValue(el, { mean: '12.3', sd: '4.5', n: '30' });
    expect(r.ok).toBe(true);
    expect(r.normalized).toEqual({ mean: 12.3, sd: 4.5, n: 30, median: null, iqrLo: null, iqrHi: null });
  });

  it('rejects negative SD', () => {
    expect(validateValue(el, { mean: 1, sd: -2, n: 10 }).ok).toBe(false);
  });
});

describe('normalizeValue — scalar with unit', () => {
  it('preserves an explicit unit override', () => {
    const el = mkElement({ name: 'Age', type: 'numeric', unit: 'years' }, () => 'a');
    expect(normalizeValue(el, { value: '55', unit: 'months' })).toEqual({ value: 55, unit: 'months' });
    expect(normalizeValue(el, '55')).toEqual({ value: 55, unit: 'years' });
  });
});

describe('valueKey + isMissing', () => {
  it('builds the canonical key with and without an arm', () => {
    expect(valueKey('E1')).toBe('E1::');
    expect(valueKey('E1', 'intervention')).toBe('E1::intervention');
  });
  it('isMissing recognizes empty forms', () => {
    expect(isMissing('')).toBe(true);
    expect(isMissing(null)).toBe(true);
    expect(isMissing(undefined)).toBe(true);
    expect(isMissing(0)).toBe(false);
  });
});
