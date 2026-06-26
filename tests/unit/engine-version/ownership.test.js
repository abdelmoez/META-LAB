/**
 * ownership.test.js — glob matching + path bucketing precedence.
 */
import { describe, it, expect } from 'vitest';
import {
  globToRegExp,
  matchesAnyGlob,
  engineIdsForPath,
  classifyPaths,
} from '../../../src/research-engine/engine-registry/ownership.js';

describe('globToRegExp / matchesAnyGlob', () => {
  it('** matches across path separators', () => {
    expect(globToRegExp('src/frontend/screening/**').test('src/frontend/screening/x/y.js')).toBe(true);
    expect(globToRegExp('src/frontend/screening/**').test('src/frontend/screening/a.js')).toBe(true);
    // ** at the end should also match the empty remainder's parent? Not required;
    // assert nested depth works which is the contract.
    expect(globToRegExp('a/**').test('a/b/c/d.js')).toBe(true);
  });
  it('single * does NOT cross /', () => {
    expect(globToRegExp('a/*.js').test('a/b.js')).toBe(true);
    expect(globToRegExp('a/*.js').test('a/b/c.js')).toBe(false);
  });
  it('* matches within a single segment', () => {
    expect(globToRegExp('server/controllers/screening*.js').test('server/controllers/screeningController.js')).toBe(true);
    // glob semantics are literal: screening*.js DOES also match screeningAi.js
    expect(globToRegExp('server/controllers/screening*.js').test('server/controllers/screeningAi.js')).toBe(true);
    expect(globToRegExp('server/controllers/screening*.js').test('server/controllers/metaController.js')).toBe(false);
  });
  it('? matches exactly one non-/ char', () => {
    expect(globToRegExp('a/?.js').test('a/b.js')).toBe(true);
    expect(globToRegExp('a/?.js').test('a/bc.js')).toBe(false);
    expect(globToRegExp('a/?.js').test('a//.js')).toBe(false);
  });
  it('escapes regex metacharacters in literal segments', () => {
    expect(globToRegExp('server/version.json').test('server/version.json')).toBe(true);
    // the '.' must be literal, not "any char"
    expect(globToRegExp('server/version.json').test('server/versionXjson')).toBe(false);
  });
  it('matchesAnyGlob ORs the list', () => {
    expect(matchesAnyGlob('a/b.js', ['x/**', 'a/*.js'])).toBe(true);
    expect(matchesAnyGlob('a/b/c.js', ['x/**', 'a/*.js'])).toBe(false);
  });
});

describe('engineIdsForPath', () => {
  it('maps a screening frontend file to screening', () => {
    expect(engineIdsForPath('src/frontend/screening/Foo.jsx')).toEqual(['screening']);
  });
  it('maps an nma engine file to network-meta-analysis', () => {
    expect(engineIdsForPath('src/research-engine/statistics/nma/league.js')).toEqual(['network-meta-analysis']);
  });
  it('returns [] for a path no engine owns', () => {
    expect(engineIdsForPath('random/unknown.js')).toEqual([]);
  });
});

describe('classifyPaths — precedence', () => {
  it('NO_BUMP wins (docs, tests, waitlist, countries)', () => {
    const r = classifyPaths([
      'docs/foo.md',
      'tests/unit/x.test.js',
      'src/shared/betaWaitlist.js',
      'src/frontend/pages/waitlist/Page.jsx',
      'src/shared/countries.js',
    ]);
    expect(r.noBump).toEqual([
      'docs/foo.md',
      'tests/unit/x.test.js',
      'src/shared/betaWaitlist.js',
      'src/frontend/pages/waitlist/Page.jsx',
      'src/shared/countries.js',
    ]);
    expect(r.shared).toEqual([]);
    expect(Object.keys(r.byEngine)).toEqual([]);
    expect(r.unowned).toEqual([]);
  });
  it('engine ownership buckets a screening file', () => {
    const r = classifyPaths(['src/frontend/screening/x/y.js']);
    expect(r.byEngine.screening).toEqual(['src/frontend/screening/x/y.js']);
  });
  it('shared infra buckets middleware', () => {
    const r = classifyPaths(['server/middleware/auth.js']);
    expect(r.shared).toEqual(['server/middleware/auth.js']);
    expect(Object.keys(r.byEngine)).toEqual([]);
  });
  it('a src/shared/** file (not waitlist/countries) is shared', () => {
    const r = classifyPaths(['src/shared/helpers.js']);
    expect(r.shared).toEqual(['src/shared/helpers.js']);
  });
  it('unknown file is unowned', () => {
    const r = classifyPaths(['random/unknown.js']);
    expect(r.unowned).toEqual(['random/unknown.js']);
    expect(r.shared).toEqual([]);
    expect(Object.keys(r.byEngine)).toEqual([]);
  });
  it('a change touching two engines populates both buckets', () => {
    const r = classifyPaths([
      'src/frontend/screening/A.jsx',
      'src/research-engine/statistics/nma/B.js',
    ]);
    expect(Object.keys(r.byEngine).sort()).toEqual(['network-meta-analysis', 'screening']);
    expect(r.byEngine.screening).toEqual(['src/frontend/screening/A.jsx']);
    expect(r.byEngine['network-meta-analysis']).toEqual(['src/research-engine/statistics/nma/B.js']);
  });
  it('normalizes backslashes and ./ prefixes', () => {
    const r = classifyPaths(['.\\src\\frontend\\screening\\A.jsx', './server/middleware/auth.js']);
    expect(r.byEngine.screening).toEqual(['src/frontend/screening/A.jsx']);
    expect(r.shared).toEqual(['server/middleware/auth.js']);
  });
  it('the engine-registry system itself is no-bump', () => {
    const r = classifyPaths([
      'src/research-engine/engine-registry/version.js',
      'scripts/engine-version.mjs',
    ]);
    expect(r.noBump.sort()).toEqual([
      'scripts/engine-version.mjs',
      'src/research-engine/engine-registry/version.js',
    ]);
    expect(Object.keys(r.byEngine)).toEqual([]);
  });
});
