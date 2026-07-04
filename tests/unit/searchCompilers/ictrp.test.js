/**
 * ictrp.test.js — WHO ICTRP compiler golden + unsupported-feature warnings.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('ictrp compiler', () => {
  it('compiles the fixture to plain AND/OR with quoted phrases only', () => {
    const r = compileStrategy(FIXTURE, 'ictrp');
    expect(r.query).toBe('("Heart Failure" OR "cardiac failure" OR chf) AND sglt2 OR placebo');
    expect(r.filtersApplied).toBe(false);
  });

  it('records controlled vocab AND the title-only field as unsupported', () => {
    const r = compileStrategy(FIXTURE, 'ictrp');
    const feats = r.unsupported.map((u) => u.feature);
    expect(feats).toContain('controlled-vocabulary');
    expect(feats).toContain('field-tags'); // chf was title-only; ICTRP cannot scope it
    expect(r.warnings.map((w) => w.code)).toContain('TRUNCATION_UNSUPPORTED');
  });
});
