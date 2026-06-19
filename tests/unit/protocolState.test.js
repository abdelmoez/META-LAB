/**
 * protocolState.test.js — pure protocol mappers + extracted constants (prompt38).
 */
import { describe, it, expect } from 'vitest';
import {
  pickProtocol, applyProtocol, isBlankProtocol, PROTOCOL_FIELDS,
} from '../../src/features/protocol/protocolState.js';
import { timeframeComplete, TIMEFRAME_OPTIONS, STUDY_DESIGNS } from '../../src/features/protocol/constants.js';

describe('pickProtocol', () => {
  it('extracts known protocol fields from a project blob, ignoring others', () => {
    const project = { id: 'x', pico: { P: 'adults', I: 'drug', extra: 'nope', notes: 'n' }, studies: [1] };
    const out = pickProtocol(project);
    expect(out).toEqual({ P: 'adults', I: 'drug', notes: 'n' });
    expect(out.extra).toBeUndefined();
    expect(out.studies).toBeUndefined();
  });
  it('skips null/undefined fields and handles a missing pico', () => {
    expect(pickProtocol({ pico: { P: null, O: 'death' } })).toEqual({ O: 'death' });
    expect(pickProtocol({})).toEqual({});
    expect(pickProtocol(null)).toEqual({});
  });
  it('only forwards declared PROTOCOL_FIELDS', () => {
    const all = Object.fromEntries(PROTOCOL_FIELDS.map((k) => [k, 'v']));
    const out = pickProtocol({ pico: { ...all, hacker: 'x' } });
    expect(Object.keys(out).sort()).toEqual([...PROTOCOL_FIELDS].sort());
  });
});

describe('applyProtocol (back-compat mirror)', () => {
  it('merges module state onto project.pico without losing other project keys', () => {
    const project = { id: 'x', name: 'P', pico: { P: 'old', legacyKey: 'keep' }, studies: [1] };
    const merged = applyProtocol(project, { P: 'new', O: 'death' });
    expect(merged.id).toBe('x');
    expect(merged.studies).toEqual([1]);
    expect(merged.pico).toEqual({ P: 'new', legacyKey: 'keep', O: 'death' });
  });
});

describe('isBlankProtocol', () => {
  it('treats empty / default-only state as blank', () => {
    expect(isBlankProtocol({})).toBe(true);
    expect(isBlankProtocol({ studyDesign: 'RCT' })).toBe(true); // default doesn't count
    expect(isBlankProtocol({ P: '', I: '   ' })).toBe(true);
  });
  it('treats any real content as non-blank', () => {
    expect(isBlankProtocol({ P: 'adults' })).toBe(false);
    expect(isBlankProtocol({ question: 'q?' })).toBe(false);
    expect(isBlankProtocol({ studyDesign: 'Cohort' })).toBe(false); // non-default design counts
  });
});

describe('timeframeComplete (extracted from monolith, unchanged)', () => {
  it('valid custom range', () => {
    expect(timeframeComplete({ timeframeMode: 'custom', tfStart: '2000', tfEnd: '2020' })).toBe(true);
    expect(timeframeComplete({ timeframeMode: 'custom', tfStart: '2000' })).toBe(true);
  });
  it('invalid custom range', () => {
    expect(timeframeComplete({ timeframeMode: 'custom' })).toBe(false);
    expect(timeframeComplete({ timeframeMode: 'custom', tfStart: '2020', tfEnd: '2000' })).toBe(false);
  });
  it('preset or legacy text', () => {
    expect(timeframeComplete({ timeframeMode: 'last5' })).toBe(true);
    expect(timeframeComplete({ timeframe: 'since 2010' })).toBe(true);
    expect(timeframeComplete({})).toBe(false);
  });
  it('TIMEFRAME_OPTIONS includes the custom + inception presets', () => {
    const vals = TIMEFRAME_OPTIONS.map((o) => o.value);
    expect(vals).toContain('custom');
    expect(vals).toContain('inception');
    expect(TIMEFRAME_OPTIONS.length).toBe(8);
  });
});

describe('STUDY_DESIGNS (extracted; must match the legacy PICOTab option set)', () => {
  it('is the exact legacy list (stored value = option text)', () => {
    expect(STUDY_DESIGNS).toEqual(['RCT', 'Quasi-RCT', 'Cohort Study', 'Case-Control', 'Cross-Sectional', 'Case Series', 'Mixed']);
  });
});
