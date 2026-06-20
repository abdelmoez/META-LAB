/**
 * meshSuggest.test.js — prompt42 Task 3. Pure local (offline) MeSH suggestion seed.
 * No network: these are the instant suggestions shown while the user types, before
 * (and when) the backend lookup is unavailable.
 */
import { describe, it, expect } from 'vitest';
import { localMeshSuggestions } from '../../src/research-engine/searchBuilder/meshSuggest.js';

// Helper: the MeSH-typed suggestion labels for a query.
const meshLabels = (q) => localMeshSuggestions(q).filter((s) => s.type === 'mesh').map((s) => s.label);

describe('localMeshSuggestions — required prompt seeds', () => {
  it('T2DM → "Diabetes Mellitus, Type 2" (type mesh)', () => {
    const sugg = localMeshSuggestions('T2DM');
    const mesh = sugg.find((s) => s.type === 'mesh' && s.label === 'Diabetes Mellitus, Type 2');
    expect(mesh).toBeTruthy();
    expect(mesh.mesh).toBe('Diabetes Mellitus, Type 2');
    expect(mesh.source).toBe('seed');
  });
  it('DM2 → "Diabetes Mellitus, Type 2"', () => {
    expect(meshLabels('DM2')).toContain('Diabetes Mellitus, Type 2');
  });
  it('HFrEF → "Heart Failure, Systolic" (with broader "Heart Failure" alt)', () => {
    const labels = meshLabels('HFrEF');
    expect(labels).toContain('Heart Failure, Systolic');
    expect(labels).toContain('Heart Failure');
  });
  it('IBD → "Inflammatory Bowel Diseases"', () => {
    expect(meshLabels('IBD')).toContain('Inflammatory Bowel Diseases');
  });
  it('EUS → "Endosonography"', () => {
    expect(meshLabels('EUS')).toContain('Endosonography');
  });
  it('CKD → "Renal Insufficiency, Chronic"', () => {
    expect(meshLabels('CKD')).toContain('Renal Insufficiency, Chronic');
  });
  it('COPD → "Pulmonary Disease, Chronic Obstructive"', () => {
    expect(meshLabels('COPD')).toContain('Pulmonary Disease, Chronic Obstructive');
  });
});

describe('localMeshSuggestions — shape, dedupe, cap', () => {
  it('returns the documented suggestion shape', () => {
    for (const s of localMeshSuggestions('T2DM')) {
      expect(['mesh', 'keyword', 'synonym']).toContain(s.type);
      expect(typeof s.label).toBe('string');
      expect(s.source).toBe('seed');
      if (s.type === 'mesh') expect(typeof s.mesh).toBe('string');
    }
  });
  it('is deterministic and de-duped (no repeated type:label)', () => {
    const a = localMeshSuggestions('diabetes');
    const b = localMeshSuggestions('diabetes');
    expect(a).toEqual(b);
    const keys = a.map((s) => `${s.type}:${s.label.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('caps the list (<= 6 by default)', () => {
    expect(localMeshSuggestions('diabetes').length).toBeLessThanOrEqual(6);
  });
  it('returns [] for blank or single-character input', () => {
    expect(localMeshSuggestions('')).toEqual([]);
    expect(localMeshSuggestions('a')).toEqual([]);
    expect(localMeshSuggestions(null)).toEqual([]);
  });
  it('offers keyword suggestions for the matched family display terms', () => {
    const kinds = new Set(localMeshSuggestions('T2DM').map((s) => s.type));
    expect(kinds.has('mesh')).toBe(true);
    expect(kinds.has('keyword')).toBe(true); // family display terms (e.g. "T2DM")
  });
  it('expands a standalone abbreviation with no family heading (RCT)', () => {
    const labels = localMeshSuggestions('RCT').map((s) => s.label.toLowerCase());
    expect(labels).toContain('randomized controlled trial');
  });
});
