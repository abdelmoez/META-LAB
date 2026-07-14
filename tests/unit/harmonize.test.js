/**
 * harmonize.test.js — 82.md Part 3/5/6/7/8. Pure reported→analysis harmonization:
 * reported-format registry, per-arm auto-conversion, provenance, stale detection,
 * and format-specific validation. No server/DB.
 */
import { describe, it, expect } from 'vitest';
import {
  familyOf, REPORTED_FORMATS, REPORTED_FORMAT_IDS, reportedFormatsFor, defaultReportedFormat,
  reportedFormatSpec, effectiveReportedFormat, reportedFieldName, reportedFieldsForStudy,
  harmonizeArm, harmonizeStudy, conversionStatusOf, validateReported,
} from '../../src/research-engine/extraction/harmonize.js';
import { CONVERSIONS, CONVERSION_ENGINE_VERSION } from '../../src/research-engine/conversions/catalogue.js';

describe('familyOf', () => {
  it('maps esType to outcome family', () => {
    expect(familyOf('MD')).toBe('continuous');
    expect(familyOf('SMD')).toBe('continuous');
    expect(familyOf('OR')).toBe('dichotomous');
    expect(familyOf('RR')).toBe('dichotomous');
    expect(familyOf('PROP')).toBe('dichotomous');
    expect(familyOf('HR')).toBe('precomputed');
    expect(familyOf('')).toBe('precomputed');
  });
});

describe('REPORTED_FORMATS registry', () => {
  it('every format id is unique and listed in REPORTED_FORMAT_IDS', () => {
    const ids = Object.values(REPORTED_FORMATS).flat().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(REPORTED_FORMAT_IDS).toEqual(expect.arrayContaining(ids));
  });
  it('every continuous conversion format references a real catalogue recipe', () => {
    for (const f of REPORTED_FORMATS.continuous) {
      if (f.conversionId) expect(CONVERSIONS.some((c) => c.id === f.conversionId)).toBe(true);
    }
  });
  it('continuous offers mean_sd, median_iqr, median_range, mean_se, mean_ci', () => {
    const ids = REPORTED_FORMATS.continuous.map((f) => f.id);
    expect(ids).toEqual(['mean_sd', 'median_iqr', 'median_range', 'mean_se', 'mean_ci']);
  });
});

describe('format selection helpers', () => {
  it('reportedFormatsFor + defaultReportedFormat', () => {
    expect(reportedFormatsFor('MD').map((f) => f.id)).toContain('median_iqr');
    expect(defaultReportedFormat('MD')).toBe('mean_sd');
    expect(defaultReportedFormat('OR')).toBe('events_total');
    expect(defaultReportedFormat('HR')).toBe('effect_ci');
  });
  it('effectiveReportedFormat falls back to family default when unset or mismatched', () => {
    expect(effectiveReportedFormat({ esType: 'MD' })).toBe('mean_sd');
    expect(effectiveReportedFormat({ esType: 'MD', reportedFormat: 'median_iqr' })).toBe('median_iqr');
    // format from a different family → fall back to default
    expect(effectiveReportedFormat({ esType: 'MD', reportedFormat: 'events_total' })).toBe('mean_sd');
  });
  it('reportedFieldName appends the arm suffix', () => {
    expect(reportedFieldName('median', 'exp')).toBe('medianExp');
    expect(reportedFieldName('q1', 'ctrl')).toBe('q1Ctrl');
  });
});

describe('reportedFieldsForStudy', () => {
  it('mean_sd continuous → n/mean/sd per arm', () => {
    const f = reportedFieldsForStudy({ esType: 'MD', reportedFormat: 'mean_sd' });
    expect(f).toEqual(['nExp', 'meanExp', 'sdExp', 'nCtrl', 'meanCtrl', 'sdCtrl']);
  });
  it('median_iqr → n/median/q1/q3 per arm', () => {
    const f = reportedFieldsForStudy({ esType: 'MD', reportedFormat: 'median_iqr' });
    expect(f).toEqual(['nExp', 'medianExp', 'q1Exp', 'q3Exp', 'nCtrl', 'medianCtrl', 'q1Ctrl', 'q3Ctrl']);
  });
  it('non-continuous families return [] (handled by esType field sets)', () => {
    expect(reportedFieldsForStudy({ esType: 'OR' })).toEqual([]);
    expect(reportedFieldsForStudy({ esType: 'HR' })).toEqual([]);
  });
});

describe('harmonizeArm — median_iqr', () => {
  const study = { esType: 'MD', reportedFormat: 'median_iqr',
    medianExp: 15, q1Exp: 10, q3Exp: 20, nExp: 50,
    medianCtrl: 12, q1Ctrl: 8, q3Ctrl: 17, nCtrl: 48 };
  it('derives meanExp/sdExp from the reported quartiles', () => {
    const r = harmonizeArm(study, 'exp');
    expect(r.status).toBe('ok');
    expect(r.writes.meanExp).toBeCloseTo((10 + 15 + 20) / 3, 3);
    expect(r.writes.sdExp).toBeGreaterThan(0);
  });
  it('produces a provenance record with method/version/engineVersion/inputsHash', () => {
    const r = harmonizeArm(study, 'exp');
    expect(r.conversion.method).toBe('median_iqr');
    expect(r.conversion.methodVersion).toBeTruthy();
    expect(r.conversion.engineVersion).toBe(CONVERSION_ENGINE_VERSION);
    expect(typeof r.conversion.inputsHash).toBe('string');
    expect(r.conversion.inputs).toMatchObject({ medianExp: 15, q1Exp: 10, q3Exp: 20, nExp: 50 });
    expect(r.conversion.assumptions.length).toBeGreaterThan(0);
  });
  it('reports missing when a required reported input is blank', () => {
    const r = harmonizeArm({ ...study, q3Exp: '' }, 'exp');
    expect(r.status).toBe('missing');
    expect(r.writes).toEqual({});
  });
  it('reports unable when the conversion math is invalid (q3 < q1)', () => {
    const r = harmonizeArm({ ...study, q1Exp: 30, q3Exp: 10 }, 'exp');
    expect(r.status).toBe('unable');
    expect(r.error).toBeTruthy();
  });
});

describe('harmonizeArm — pass-through + spread-only', () => {
  it('mean_sd is not_required and passes mean/sd through', () => {
    const r = harmonizeArm({ esType: 'MD', reportedFormat: 'mean_sd', meanExp: 5, sdExp: 2, nExp: 40 }, 'exp');
    expect(r.status).toBe('not_required');
    expect(r.writes.meanExp).toBe(5);
    expect(r.writes.sdExp).toBe(2);
  });
  it('mean_se derives sd and passes the mean through', () => {
    const r = harmonizeArm({ esType: 'MD', reportedFormat: 'mean_se', meanExp: 5, seExp: 0.5, nExp: 100 }, 'exp');
    expect(r.status).toBe('ok');
    expect(r.writes.sdExp).toBeCloseTo(0.5 * Math.sqrt(100), 4);
    expect(r.writes.meanExp).toBe(5);
  });
  it('mean_ci derives sd from the CI width', () => {
    const r = harmonizeArm({ esType: 'MD', reportedFormat: 'mean_ci', meanExp: 15, ciLoExp: 10, ciHiExp: 20, nExp: 36 }, 'exp');
    expect(r.status).toBe('ok');
    expect(r.writes.sdExp).toBeCloseTo(Math.sqrt(36) * (20 - 10) / (2 * 1.96), 3);
  });
});

describe('harmonizeStudy', () => {
  const study = { esType: 'MD', reportedFormat: 'median_iqr',
    medianExp: 15, q1Exp: 10, q3Exp: 20, nExp: 50,
    medianCtrl: 12, q1Ctrl: 8, q3Ctrl: 17, nCtrl: 48 };
  it('harmonizes both arms and merges the analysis writes', () => {
    const plan = harmonizeStudy(study);
    expect(plan.required).toBe(true);
    expect(plan.status).toBe('ok');
    expect(plan.writes).toHaveProperty('meanExp');
    expect(plan.writes).toHaveProperty('sdExp');
    expect(plan.writes).toHaveProperty('meanCtrl');
    expect(plan.writes).toHaveProperty('sdCtrl');
    expect(plan.conversions.length).toBe(2);
  });
  it('is not_required for mean_sd / dichotomous / precomputed', () => {
    expect(harmonizeStudy({ esType: 'MD', reportedFormat: 'mean_sd' }).required).toBe(false);
    expect(harmonizeStudy({ esType: 'OR' }).required).toBe(false);
    expect(harmonizeStudy({ esType: 'HR' }).required).toBe(false);
  });
  it('never writes to a reported field (original values immutable)', () => {
    const plan = harmonizeStudy(study);
    for (const k of Object.keys(plan.writes)) {
      expect(['meanExp', 'sdExp', 'meanCtrl', 'sdCtrl']).toContain(k);
    }
  });
  it('partial when only one arm has data', () => {
    const plan = harmonizeStudy({ ...study, medianCtrl: '', q1Ctrl: '', q3Ctrl: '', nCtrl: '' });
    expect(plan.status).toBe('partial');
  });
});

describe('conversionStatusOf — lifecycle + stale detection', () => {
  const base = { esType: 'MD', reportedFormat: 'median_iqr',
    medianExp: 15, q1Exp: 10, q3Exp: 20, nExp: 50, medianCtrl: 12, q1Ctrl: 8, q3Ctrl: 17, nCtrl: 48 };
  it('eligible before a conversion is applied', () => {
    expect(conversionStatusOf(base)).toBe('eligible');
  });
  it('generated once the applied conversions match the current inputs', () => {
    const plan = harmonizeStudy(base);
    const applied = { ...base, conversions: plan.conversions.map((c) => ({ ...c })) };
    expect(conversionStatusOf(applied)).toBe('generated');
  });
  it('stale after a reported input changes (Scenario 6)', () => {
    const plan = harmonizeStudy(base);
    const applied = { ...base, conversions: plan.conversions.map((c) => ({ ...c })) };
    const changed = { ...applied, q3Exp: 25 }; // Q3 changed after approval
    expect(conversionStatusOf(changed)).toBe('stale');
  });
  it('stale when a converted arm’s reported input is CLEARED (orphaned derived value)', () => {
    const plan = harmonizeStudy(base);
    // Apply both arms, then clear one arm's reported input (leaving the derived value orphaned).
    const applied = { ...base, conversions: plan.conversions.map((c) => ({ ...c })), meanCtrl: 12, sdCtrl: 6.2, q1Ctrl: '' };
    expect(conversionStatusOf(applied)).toBe('stale');
  });
  it('stale when the engine version moves', () => {
    const plan = harmonizeStudy(base);
    const applied = { ...base, conversions: plan.conversions.map((c) => ({ ...c, engineVersion: 'OLD-VERSION' })) };
    expect(conversionStatusOf(applied)).toBe('stale');
  });
  it('not_required / missing / unable propagate', () => {
    expect(conversionStatusOf({ esType: 'OR' })).toBe('not_required');
    expect(conversionStatusOf({ esType: 'MD', reportedFormat: 'median_iqr' })).toBe('missing');
    expect(conversionStatusOf({ ...base, q1Exp: 30, q3Exp: 10, q1Ctrl: 30, q3Ctrl: 10 })).toBe('unable');
  });
});

describe('validateReported — specific, actionable messages (Part 8)', () => {
  it('flags Q1 > median for median_iqr', () => {
    const { errors } = validateReported({ esType: 'MD', reportedFormat: 'median_iqr', medianExp: 5, q1Exp: 10, q3Exp: 20, nExp: 30 });
    expect(errors.join(' ')).toMatch(/Q1 must be ≤ the median/);
  });
  it('flags median above Q3', () => {
    const { errors } = validateReported({ esType: 'MD', reportedFormat: 'median_iqr', medianExp: 25, q1Exp: 10, q3Exp: 20, nExp: 30 });
    expect(errors.join(' ')).toMatch(/median must be ≤ Q3/);
  });
  it('flags min > max for median_range', () => {
    const { errors } = validateReported({ esType: 'MD', reportedFormat: 'median_range', medianExp: 15, minExp: 30, maxExp: 5, nExp: 30 });
    expect(errors.join(' ')).toMatch(/minimum must be ≤ maximum/);
  });
  it('flags CI lower > upper for mean_ci', () => {
    const { errors } = validateReported({ esType: 'MD', reportedFormat: 'mean_ci', meanExp: 5, ciLoExp: 20, ciHiExp: 10, nExp: 30 });
    expect(errors.join(' ')).toMatch(/lower limit must be ≤ the upper/);
  });
  it('valid data → no errors', () => {
    const { errors } = validateReported({ esType: 'MD', reportedFormat: 'median_iqr', medianExp: 15, q1Exp: 10, q3Exp: 20, nExp: 30 });
    expect(errors).toEqual([]);
  });
});

describe('median_iqr soft warnings', () => {
  it('warns on small n without failing', () => {
    const c = CONVERSIONS.find((x) => x.id === 'median_iqr');
    expect(c.warn({ q1: 10, med: 15, q3: 20, n: 10 }).join(' ')).toMatch(/Small sample/);
  });
  it('warns when the median lies outside the IQR', () => {
    const c = CONVERSIONS.find((x) => x.id === 'median_iqr');
    expect(c.warn({ q1: 10, med: 5, q3: 20, n: 100 }).join(' ')).toMatch(/below Q1/);
  });
});
