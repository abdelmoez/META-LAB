/**
 * ownership-fixes.test.js (54.md review fixes) — regression tests for two
 * ownership-map defects found in adversarial review:
 *   1. Root-level docs (README.md / CLAUDE.md) must be NO_BUMP, not "unowned".
 *   2. Most-specific glob wins: an AI-controller edit must bump ONLY screening-ai,
 *      not also the base screening engine (screening*.js overlaps screeningAi*.js).
 */
import { describe, it, expect } from 'vitest';
import { engineIdsForPath, classifyPaths } from '../../../src/research-engine/engine-registry/ownership.js';
import { classifyChanges } from '../../../src/research-engine/engine-registry/classify.js';

describe('ownership — root-level docs are no-bump', () => {
  it('classifies root README.md / CLAUDE.md / LICENSE as noBump (not unowned)', () => {
    const b = classifyPaths(['README.md', 'CLAUDE.md', 'LICENSE']);
    expect(b.noBump).toEqual(expect.arrayContaining(['README.md', 'CLAUDE.md', 'LICENSE']));
    expect(b.unowned).toEqual([]);
  });
  it('a docs-only diff yields NO engine-affecting changes', () => {
    const r = classifyChanges({ paths: ['README.md', 'docs/x.md'] });
    expect(r.changes).toEqual([]);
  });
});

describe('ownership — most-specific glob wins (no double-bump)', () => {
  it('screeningAi controllers belong ONLY to screening-ai', () => {
    expect(engineIdsForPath('server/controllers/screeningAiController.js')).toEqual(['screening-ai']);
    expect(engineIdsForPath('server/controllers/screeningAiAdminController.js')).toEqual(['screening-ai']);
  });
  it('plain screening controllers still belong to screening', () => {
    expect(engineIdsForPath('server/controllers/screeningController.js')).toEqual(['screening']);
  });
  it('an AI-only edit produces exactly one (screening-ai) bump', () => {
    const r = classifyChanges({ paths: ['server/controllers/screeningAiController.js'] });
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].engineId).toBe('screening-ai');
  });
});
