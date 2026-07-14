/** 88.md — smoke: the History panel + entry hook import + JSX-transform cleanly. */
import { describe, it, expect } from 'vitest';
import ProjectHistoryPanel from '../../../src/features/provenance/ProjectHistoryPanel.jsx';
import { useResearchProvenanceEnabled } from '../../../src/features/provenance/useResearchProvenanceEnabled.js';
describe('panel smoke', () => {
  it('exports a component + hook', () => {
    expect(typeof ProjectHistoryPanel).toBe('function');
    expect(typeof useResearchProvenanceEnabled).toBe('function');
  });
});
