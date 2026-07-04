/**
 * opengrey.test.js — grey-literature compiler golden + heavy limitation note.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('opengrey compiler', () => {
  it('compiles the fixture to simple boolean + quoted phrases', () => {
    const r = compileStrategy(FIXTURE, 'opengrey');
    expect(r.query).toBe('("Heart Failure" OR "cardiac failure" OR chf) AND sglt2 OR placebo');
    expect(r.syntaxLevel).toBe('approximate');
    expect(r.filtersApplied).toBe(false);
  });

  it('records the field + truncation limitations and a manual-screening note', () => {
    const r = compileStrategy(FIXTURE, 'opengrey');
    expect(r.unsupported.map((u) => u.feature)).toContain('field-tags');
    expect(r.warnings.map((w) => w.code)).toContain('TRUNCATION_UNSUPPORTED');
    expect(r.notes.some((n) => /screen the results manually/.test(n))).toBe(true);
  });
});
