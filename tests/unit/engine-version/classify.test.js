/**
 * classify.test.js — turning a change set into proposed bumps (rule vs explicit).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyChanges,
  hasAmbiguity,
} from '../../../src/research-engine/engine-registry/classify.js';

describe('classifyChanges — rule mode', () => {
  it('single engine → one minor change', () => {
    const r = classifyChanges({ paths: ['src/frontend/screening/Foo.jsx'] });
    expect(r.source).toBe('rule');
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      engineId: 'screening',
      type: 'minor',
      source: 'rule',
      confidence: 'medium',
    });
    expect(r.changes[0].summary).toContain('Screening');
    expect(r.changes[0].summary).toContain('1 file');
    expect(r.warnings).toEqual([]);
  });
  it('a UI-only engine file is classified minor', () => {
    const r = classifyChanges({ paths: ['src/frontend/rob/Panel.jsx'] });
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ engineId: 'risk-of-bias', type: 'minor', source: 'rule' });
  });
  it('multi-engine change → multiple changes, sorted by engineId', () => {
    const r = classifyChanges({
      paths: [
        'src/research-engine/statistics/nma/league.js',
        'src/frontend/screening/A.jsx',
        'src/research-engine/statistics/meta-analysis.js',
      ],
    });
    expect(r.source).toBe('rule');
    expect(r.changes.map((c) => c.engineId)).toEqual([
      'meta-analysis',
      'network-meta-analysis',
      'screening',
    ]);
    for (const c of r.changes) expect(c.type).toBe('minor');
  });
  it('docs-only paths → no changes + no-op warning', () => {
    const r = classifyChanges({ paths: ['docs/x.md', 'README.md'] });
    expect(r.changes).toEqual([]);
    expect(r.warnings).toContain('no engine-affecting changes detected');
  });
  it('waitlist-only change → no bump, no changes', () => {
    const r = classifyChanges({
      paths: ['server/waitlist/repo.js', 'src/shared/betaWaitlist.js'],
    });
    expect(r.changes).toEqual([]);
    expect(r.buckets.noBump.length).toBe(2);
    expect(r.warnings).toContain('no engine-affecting changes detected');
  });
  it('shared-only change → no engine bump (no no-op warning either, since infra is intentional)', () => {
    const r = classifyChanges({ paths: ['server/middleware/auth.js'] });
    expect(r.changes).toEqual([]);
    expect(r.buckets.shared).toEqual(['server/middleware/auth.js']);
    // shared infra is recognised (not "nothing detected") — but with no engine
    // changes we still emit the no-op marker for the CLI to report nothing bumped.
    expect(r.warnings).toContain('no engine-affecting changes detected');
  });
  it('unowned file → warning + hasAmbiguity true', () => {
    const r = classifyChanges({ paths: ['random/unknown.js'] });
    expect(r.warnings.some((w) => w.includes('unowned change'))).toBe(true);
    expect(hasAmbiguity(r)).toBe(true);
  });
  it('no ambiguity when everything is owned/shared/no-bump', () => {
    const r = classifyChanges({ paths: ['src/frontend/screening/A.jsx', 'docs/x.md'] });
    expect(hasAmbiguity(r)).toBe(false);
  });
});

describe('classifyChanges — explicit mode', () => {
  it('declarations take precedence over rule inference', () => {
    const r = classifyChanges({
      paths: ['src/frontend/screening/A.jsx'], // would be rule-minor for screening
      declarations: [
        { engine: 'network-meta-analysis', type: 'major', summary: 'Replace ranking model' },
      ],
    });
    expect(r.source).toBe('explicit');
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      engineId: 'network-meta-analysis',
      type: 'major',
      summary: 'Replace ranking model',
      source: 'explicit',
      confidence: 'high',
    });
    // buckets are still computed for reporting
    expect(r.buckets.byEngine.screening).toEqual(['src/frontend/screening/A.jsx']);
  });
  it('accepts either engine or engineId key', () => {
    const r = classifyChanges({
      declarations: [{ engineId: 'screening', type: 'minor', summary: 'x' }],
    });
    expect(r.changes[0].engineId).toBe('screening');
  });
  it('sorts explicit changes by engineId', () => {
    const r = classifyChanges({
      declarations: [
        { engine: 'validation', type: 'minor', summary: 'v' },
        { engine: 'data-extraction', type: 'major', summary: 'd' },
      ],
    });
    expect(r.changes.map((c) => c.engineId)).toEqual(['data-extraction', 'validation']);
  });
  it('still warns about unowned paths in explicit mode', () => {
    const r = classifyChanges({
      paths: ['random/unknown.js'],
      declarations: [{ engine: 'screening', type: 'minor', summary: 'x' }],
    });
    expect(r.source).toBe('explicit');
    expect(r.warnings.some((w) => w.includes('unowned change'))).toBe(true);
  });
});
