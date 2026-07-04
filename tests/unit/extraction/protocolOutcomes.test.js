/**
 * protocolOutcomes.test.js — reading pre-specified outcomes from the project blob.
 * Covers: numbered / semicolon / newline / bullet / inline-marker splitting, the
 * PICO fallback, the none case, alias extraction (parenthetical + measurement
 * phrase), timepoint hints, trailing-period stripping, the <3-char drop, and the
 * 20-item-per-level cap.
 */

import { describe, it, expect } from 'vitest';
import {
  protocolOutcomes,
  splitItems,
} from '../../../src/research-engine/extraction/protocolOutcomes.js';

const prospero = (primary, secondary = '') => ({
  prospero: { fields: { primary_outcomes: primary, secondary_outcomes: secondary } },
});

describe('splitItems', () => {
  it('splits on newlines and strips numbered markers (1. / 1) / (1))', () => {
    expect(splitItems('1. Alpha\n2) Beta\n(3) Gamma')).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('splits on semicolons', () => {
    expect(splitItems('Alpha; Beta; Gamma')).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('splits an inline numbered list on one line', () => {
    expect(splitItems('(1) Death (2) Stroke (3) Myocardial infarction')).toEqual([
      'Death', 'Stroke', 'Myocardial infarction',
    ]);
  });

  it('strips bullet markers (- / * / •)', () => {
    expect(splitItems('- Alpha\n* Beta\n• Gamma')).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('does not split decimals inside item text', () => {
    expect(splitItems('Reduce HbA1c by 0.5% at 12 weeks')).toEqual(['Reduce HbA1c by 0.5% at 12 weeks']);
  });

  it('returns [] for empty / non-string input', () => {
    expect(splitItems('')).toEqual([]);
    expect(splitItems('   ')).toEqual([]);
    expect(splitItems(null)).toEqual([]);
    expect(splitItems(42)).toEqual([]);
  });
});

describe('protocolOutcomes — prospero source', () => {
  it('reads numbered primary + semicolon secondary outcomes with correct ids/levels', () => {
    const res = protocolOutcomes(
      prospero(
        '1. All-cause mortality at 12 months\n2. Myocardial infarction',
        'Quality of life (measured by SF-36); Hospitalization',
      ),
    );
    expect(res.source).toBe('prospero');
    expect(res.outcomes.map((o) => o.id)).toEqual(['p1', 'p2', 's1', 's2']);
    expect(res.outcomes.map((o) => o.level)).toEqual(['primary', 'primary', 'secondary', 'secondary']);

    const p1 = res.outcomes[0];
    expect(p1.name).toBe('All-cause mortality at 12 months');
    expect(p1.canonical).toBe('all-cause mortality 12 month');
    expect(p1.timepointHint).toBe('12 months');
    expect(p1.index).toBe(1);

    const s1 = res.outcomes[2];
    expect(s1.name).toBe('Quality of life (measured by SF-36)');
    expect(s1.aliases).toContain('sf-36');
    expect(s1.index).toBe(1);
  });

  it('ignores PICO when prospero has any content', () => {
    const project = {
      ...prospero('Overall survival', ''),
      pico: { O: 'Some other outcome' },
    };
    const res = protocolOutcomes(project);
    expect(res.source).toBe('prospero');
    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0].canonical).toBe('overall survival');
  });

  it('extracts a plain parenthetical abbreviation as an alias', () => {
    const res = protocolOutcomes(prospero('Hemoglobin A1c (HbA1c)'));
    expect(res.outcomes[0].aliases).toContain('hba1c');
  });

  it('extracts a measurement phrase alias + timepoint hint together', () => {
    const res = protocolOutcomes(prospero('Glycemic control (measured by HbA1c) at 12 weeks'));
    const o = res.outcomes[0];
    expect(o.aliases).toContain('hba1c');
    expect(o.timepointHint).toBe('12 weeks');
  });

  it('treats a pure-timepoint parenthetical as a timepoint, not an alias', () => {
    const res = protocolOutcomes(prospero('Blood pressure (at 12 weeks)'));
    const o = res.outcomes[0];
    expect(o.timepointHint).toBe('12 weeks');
    expect(o.aliases).toEqual([]);
  });

  it('strips trailing periods and drops items shorter than 3 chars after normalization', () => {
    const res = protocolOutcomes(prospero('ab\nPain intensity.\nMortality.'));
    expect(res.outcomes.map((o) => o.name)).toEqual(['Pain intensity', 'Mortality']);
    expect(res.outcomes.map((o) => o.id)).toEqual(['p1', 'p2']);
  });

  it('caps each level at 20 items', () => {
    const many = Array.from({ length: 25 }, (_, i) => `Outcome number ${i + 1}`).join('\n');
    const res = protocolOutcomes(prospero(many));
    expect(res.outcomes).toHaveLength(20);
    expect(res.outcomes[19].id).toBe('p20');
    expect(res.outcomes.every((o) => o.level === 'primary')).toBe(true);
  });
});

describe('protocolOutcomes — bullet splitting', () => {
  it('splits bulleted primary outcomes and normalizes each', () => {
    const res = protocolOutcomes(prospero('- Reduction in HbA1c\n- Change in body weight\n* Fasting glucose'));
    expect(res.source).toBe('prospero');
    expect(res.outcomes.map((o) => o.canonical)).toEqual([
      'reduction hba1c',
      'change body weight',
      'fasting glucose',
    ]);
  });
});

describe('protocolOutcomes — PICO fallback', () => {
  it('falls back to pico.O when both prospero fields are empty; every item is primary', () => {
    const res = protocolOutcomes({ pico: { O: 'Overall survival; Progression-free survival' } });
    expect(res.source).toBe('pico');
    expect(res.outcomes.map((o) => o.id)).toEqual(['p1', 'p2']);
    expect(res.outcomes.every((o) => o.level === 'primary')).toBe(true);
    expect(res.outcomes.map((o) => o.canonical)).toEqual(['overall survival', 'progression-free survival']);
  });

  it('falls back to pico when prospero fields hold only whitespace', () => {
    const project = { ...prospero('   ', '  '), pico: { O: 'Mortality' } };
    const res = protocolOutcomes(project);
    expect(res.source).toBe('pico');
    expect(res.outcomes[0].canonical).toBe('mortality');
  });
});

describe('protocolOutcomes — none case', () => {
  it('returns none for an empty / missing / malformed project', () => {
    expect(protocolOutcomes({})).toEqual({ source: 'none', outcomes: [] });
    expect(protocolOutcomes(null)).toEqual({ source: 'none', outcomes: [] });
    expect(protocolOutcomes(undefined)).toEqual({ source: 'none', outcomes: [] });
    expect(protocolOutcomes({ prospero: { fields: {} }, pico: {} })).toEqual({ source: 'none', outcomes: [] });
  });

  it('returns none when all items normalize below the 3-char threshold', () => {
    expect(protocolOutcomes(prospero('ab; a; x'))).toEqual({ source: 'none', outcomes: [] });
  });
});
