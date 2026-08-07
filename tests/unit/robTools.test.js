/**
 * robTools.test.js — prompt28 Part 4. The RoB tool catalogue + guards that keep
 * an unsupported tool from ever being selected.
 */
import { describe, it, expect } from 'vitest';
import {
  ROB_TOOLS, DEFAULT_ROB_TOOL, ACTIVE_ROB_TOOLS,
  getRobTool, isRobToolActive, normalizeRobTool,
  isStarScoredTool, toolsForStudyDesign, nosVariantForDesign,
} from '../../src/research-engine/rob/tools.js';

// NOTE (P14): ROBINS-I is an IMPLEMENTED, active instrument.
// NOTE (101.md §18-§22): the two official Newcastle-Ottawa forms are now
// implemented as separate active instruments — 'NOS' (cohort) and 'NOS-CC'
// (case-control) — because their third domain genuinely differs (Outcome vs
// Exposure). QUADAS-2 / custom remain planned.
const ACTIVE = ['RoB2', 'ROBINS-I', 'NOS', 'NOS-CC'];

describe('ROB_TOOLS catalogue', () => {
  it('lists RoB 2, ROBINS-I and both NOS forms as active, with the rest coming-soon', () => {
    expect(ROB_TOOLS.map(t => t.id)).toContain('RoB2');
    expect(ACTIVE_ROB_TOOLS).toEqual(ACTIVE);
    expect(DEFAULT_ROB_TOOL).toBe('RoB2');
    // the still-planned tools are advertised but disabled
    for (const t of ROB_TOOLS) {
      if (!ACTIVE.includes(t.id)) expect(t.status).toBe('coming-soon');
    }
    // QUADAS-2 / custom are present for future-proofing
    expect(ROB_TOOLS.map(t => t.id)).toEqual(expect.arrayContaining(['ROBINS-I', 'QUADAS-2', 'NOS', 'NOS-CC', 'custom']));
  });

  it('getRobTool resolves descriptors', () => {
    expect(getRobTool('RoB2').label).toBe('RoB 2');
    expect(getRobTool('nope')).toBeUndefined();
  });

  it('marks only the NOS forms as star-scored', () => {
    expect(isStarScoredTool('NOS')).toBe(true);
    expect(isStarScoredTool('NOS-CC')).toBe(true);
    expect(isStarScoredTool('RoB2')).toBe(false);
    expect(isStarScoredTool('ROBINS-I')).toBe(false);
  });
});

describe('study-design routing (101.md §18)', () => {
  it('routes cohort and case-control designs to the right NOS form', () => {
    expect(toolsForStudyDesign('prospective cohort study')).toEqual(['NOS']);
    expect(toolsForStudyDesign('retrospective cohort')).toEqual(['NOS']);
    expect(toolsForStudyDesign('case-control study')).toEqual(['NOS-CC']);
    expect(nosVariantForDesign('cohort')).toBe('cohort');
    expect(nosVariantForDesign('case control')).toBe('case-control');
  });

  it('treats a nested case-control as case-control, not cohort', () => {
    // "nested case-control study within a cohort" contains BOTH words; the
    // case-control test must win or the wrong form is offered.
    expect(toolsForStudyDesign('nested case-control study within a cohort')).toEqual(['NOS-CC']);
  });

  it('routes trials to RoB 2 and non-randomised interventions to ROBINS-I', () => {
    expect(toolsForStudyDesign('randomised controlled trial')).toEqual(['RoB2']);
    expect(toolsForStudyDesign('RCT')).toEqual(['RoB2']);
    expect(toolsForStudyDesign('interrupted time series')).toEqual(['ROBINS-I']);
  });

  it('returns nothing rather than a misleading fallback for an unknown design', () => {
    expect(toolsForStudyDesign('')).toEqual([]);
    expect(toolsForStudyDesign('qualitative interview study')).toEqual([]);
    expect(nosVariantForDesign('qualitative interview study')).toBe('');
  });
});

describe('isRobToolActive / normalizeRobTool', () => {
  it('RoB 2, ROBINS-I and the NOS forms are active; planned tools are not', () => {
    expect(isRobToolActive('RoB2')).toBe(true);
    expect(isRobToolActive('ROBINS-I')).toBe(true);
    expect(isRobToolActive('NOS')).toBe(true);
    expect(isRobToolActive('NOS-CC')).toBe(true);
    expect(isRobToolActive('QUADAS-2')).toBe(false);
    expect(isRobToolActive('')).toBe(false);
    expect(isRobToolActive(undefined)).toBe(false);
  });

  it('coerces any non-active selection back to the default', () => {
    expect(normalizeRobTool('RoB2')).toBe('RoB2');
    expect(normalizeRobTool('ROBINS-I')).toBe('ROBINS-I');
    expect(normalizeRobTool('QUADAS-2')).toBe('RoB2');
    expect(normalizeRobTool('garbage')).toBe('RoB2');
    expect(normalizeRobTool(undefined)).toBe('RoB2');
    expect(normalizeRobTool(null)).toBe('RoB2');
  });
});
