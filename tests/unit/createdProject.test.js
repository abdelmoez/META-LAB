/**
 * createdProject.test.js — 83.md §1. POST /api/projects answers with two shapes
 * (bare project vs { project, linkedScreenProject }); every create entry point must
 * navigate with the definitive backend id regardless of shape.
 */
import { describe, it, expect } from 'vitest';
import { createdProjectOf, createdProjectId } from '../../src/frontend/api-client/createdProject.js';

describe('createdProjectOf / createdProjectId', () => {
  it('reads the bare-project shape (createLinkedSift:false)', () => {
    const res = { id: 'p1', name: 'Review' };
    expect(createdProjectOf(res)).toBe(res);
    expect(createdProjectId(res)).toBe('p1');
  });
  it('reads the nested shape (createLinkedSift:true)', () => {
    const res = { project: { id: 'p2', name: 'Review' }, linkedScreenProject: { id: 'sp' } };
    expect(createdProjectOf(res)).toEqual({ id: 'p2', name: 'Review' });
    expect(createdProjectId(res)).toBe('p2');
  });
  it('reads the nested shape even when the SIFT pair failed (warning present)', () => {
    const res = { project: { id: 'p3' }, linkedScreenProject: null, warning: 'sift failed' };
    expect(createdProjectId(res)).toBe('p3');
  });
  it('returns null/empty for shapeless responses — callers must NOT navigate', () => {
    expect(createdProjectOf(null)).toBeNull();
    expect(createdProjectOf({})).toBeNull();
    expect(createdProjectOf({ project: {} })).toBeNull();
    expect(createdProjectOf('p1')).toBeNull();
    expect(createdProjectId(undefined)).toBe('');
  });
});
