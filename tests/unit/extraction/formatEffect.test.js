import { describe, it, expect } from 'vitest';
import {
  formatEffect,
  formatEffectText,
  backTransform,
  scaleForType,
  isRatioType,
} from '../../../src/research-engine/format/formatEffect.js';

describe('formatEffect — back-transform log-stored ratios (§18)', () => {
  it('THE production bug: ln(RR) values render as RR 1.12 [1.00, 1.26]', () => {
    const r = formatEffect(0.11332868530700327, 0, 0.23111172096338664, 'RR');
    expect(r.text).toBe('RR 1.12 [1.00, 1.26]');
    expect(r.isRatio).toBe(true);
    expect(r.est).toBeCloseTo(1.12, 2);
    expect(r.lo).toBeCloseTo(1.0, 2);
    expect(r.hi).toBeCloseTo(1.26, 2);
  });

  it('OR / HR back-transform from ln', () => {
    // OR 2.24 [1.40, 3.57] stored as ln
    expect(formatEffectText(Math.log(2.24), Math.log(1.40), Math.log(3.57), 'OR'))
      .toBe('OR 2.24 [1.40, 3.57]');
    expect(formatEffectText(Math.log(0.80), Math.log(0.65), Math.log(0.98), 'HR'))
      .toBe('HR 0.80 [0.65, 0.98]');
  });

  it('non-ratio measures pass through unchanged (MD/SMD)', () => {
    expect(formatEffectText(-2.4, -3.1, -1.7, 'MD')).toBe('MD -2.40 [-3.10, -1.70]');
    expect(formatEffectText(0.35, 0.10, 0.60, 'SMD')).toBe('SMD 0.35 [0.10, 0.60]');
  });

  it('PROP uses inverse-logit, COR uses tanh', () => {
    // logit(0.30) ≈ -0.8473; back to 0.30
    expect(backTransform(Math.log(0.3 / 0.7), 'logit')).toBeCloseTo(0.30, 4);
    expect(scaleForType('PROP')).toBe('logit');
    // Fisher z of r=0.5 = atanh(0.5); back to 0.5
    expect(backTransform(Math.atanh(0.5), 'fisherz')).toBeCloseTo(0.5, 4);
    expect(scaleForType('COR')).toBe('fisherz');
  });

  it('null / missing CI bounds degrade gracefully (no double transform)', () => {
    const r = formatEffect(Math.log(1.5), '', '', 'OR');
    expect(r.est).toBeCloseTo(1.5, 4);
    expect(r.ciText).toBe('');
    expect(r.text).toBe('OR 1.50');
  });

  it('negative log value (protective ratio) renders < 1', () => {
    // ln(0.5) = -0.693 → 0.50
    expect(formatEffectText(Math.log(0.5), null, null, 'RR')).toBe('RR 0.50');
  });

  it('no double exponentiation: exp is applied exactly once', () => {
    const stored = Math.log(2.0);
    const once = formatEffect(stored, null, null, 'OR').est;
    expect(once).toBeCloseTo(2.0, 6);
    // feeding the display value back through must NOT be what happens internally
    expect(once).not.toBeCloseTo(Math.exp(Math.exp(stored)), 2);
  });

  it('unknown / empty esType is treated as identity (safe default)', () => {
    expect(scaleForType('')).toBe('identity');
    expect(scaleForType('WHATEVER')).toBe('identity');
    expect(isRatioType('MD')).toBe(false);
    expect(isRatioType('OR')).toBe(true);
  });

  it('empty es → dash, never throws', () => {
    expect(() => formatEffect('', '', '', 'OR')).not.toThrow();
    expect(formatEffect('', '', '', 'OR').text).toBe('—');
    expect(formatEffect(null, null, null, '').text).toBe('—');
  });

  it('respects decimal precision and bracket style options', () => {
    expect(formatEffectText(Math.log(2.2345), Math.log(1.4), Math.log(3.5), 'OR', { decimals: 3 }))
      .toMatch(/^OR 2\.23[45] \[1\.400, 3\.500\]$/);
    expect(formatEffectText(Math.log(2.2), Math.log(1.4), Math.log(3.5), 'OR', { brackets: '()' }))
      .toBe('OR 2.20 (1.40, 3.50)');
  });
});
