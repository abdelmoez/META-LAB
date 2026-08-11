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
// NOTE (101.md §18-§22): the two official Newcastle-Ottawa forms are separate
// active instruments — 'NOS' (cohort) and 'NOS-CC' (case-control) — because their
// third domain genuinely differs (Outcome vs Exposure).
// NOTE (115.md W1-A): the catalogue now carries all thirteen implemented
// instruments. Only the custom-template authoring surface remains planned.
const ACTIVE = [
  'RoB2', 'ROBINS-I', 'NOS', 'NOS-CC', 'QUADAS-2', 'AMSTAR-2',
  'JBI-CaseSeries', 'JBI-CaseReport', 'JBI-Prevalence', 'JBI-CrossSectional', 'JBI-Qualitative',
  'QUIPS', 'PROBAST',
];

describe('ROB_TOOLS catalogue', () => {
  it('lists all thirteen implemented instruments as active, with the rest coming-soon', () => {
    expect(ROB_TOOLS.map(t => t.id)).toContain('RoB2');
    expect(ACTIVE_ROB_TOOLS).toEqual(ACTIVE);
    expect(DEFAULT_ROB_TOOL).toBe('RoB2');
    // the still-planned tools are advertised but disabled
    for (const t of ROB_TOOLS) {
      if (!ACTIVE.includes(t.id)) expect(t.status).toBe('coming-soon');
    }
    // QUADAS-2 is now implemented; the custom template is still future-proofing.
    expect(ROB_TOOLS.map(t => t.id)).toEqual(expect.arrayContaining(['ROBINS-I', 'QUADAS-2', 'NOS', 'NOS-CC', 'custom']));
    expect(getRobTool('custom').status).toBe('coming-soon');
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

  it('treats a non-randomised trial as non-randomised, not as a trial', () => {
    // "non-randomised" contains "randomised"; the specific test must win.
    expect(toolsForStudyDesign('non-randomised trial')).toEqual(['ROBINS-I']);
    expect(toolsForStudyDesign('quasi-experimental study')).toEqual(['ROBINS-I']);
  });

  it('routes the 115.md designs to their instruments', () => {
    expect(toolsForStudyDesign('diagnostic test accuracy study')).toEqual(['QUADAS-2']);
    expect(toolsForStudyDesign('systematic review and meta-analysis')).toEqual(['AMSTAR-2']);
    expect(toolsForStudyDesign('case report')).toEqual(['JBI-CaseReport']);
    expect(toolsForStudyDesign('retrospective case series')).toEqual(['JBI-CaseSeries']);
    expect(toolsForStudyDesign('prevalence survey')).toEqual(['JBI-Prevalence']);
    expect(toolsForStudyDesign('analytical cross-sectional study')).toEqual(['JBI-CrossSectional']);
    expect(toolsForStudyDesign('qualitative interview study')).toEqual(['JBI-Qualitative']);
    expect(toolsForStudyDesign('prognostic factor study')).toEqual(['QUIPS']);
    expect(toolsForStudyDesign('clinical prediction model development study')).toEqual(['PROBAST']);
  });

  // A trial is routinely described by its sampling frame as well as its design.
  // With the cohort words tested first, every one of these strings routed to the
  // Newcastle–Ottawa COHORT form — a star scale for observational studies — instead
  // of RoB 2. Randomisation is the design; prospective/longitudinal/retrospective
  // are not.
  it('lets randomisation win over the cohort words that describe a trial', () => {
    expect(toolsForStudyDesign('prospective randomized controlled trial')).toEqual(['RoB2']);
    expect(toolsForStudyDesign('multicentre prospective RCT')).toEqual(['RoB2']);
    expect(toolsForStudyDesign('longitudinal randomised trial')).toEqual(['RoB2']);
    expect(toolsForStudyDesign('retrospective analysis of a randomised trial')).toEqual(['RoB2']);
    expect(nosVariantForDesign('prospective randomized controlled trial')).toBe('');
  });

  it('…without stealing the designs that really are cohorts', () => {
    expect(toolsForStudyDesign('prospective cohort study')).toEqual(['NOS']);
    expect(toolsForStudyDesign('retrospective longitudinal cohort')).toEqual(['NOS']);
    expect(toolsForStudyDesign('registry-based prospective cohort')).toEqual(['NOS']);
    // The non-randomised guard still runs FIRST, so it beats both.
    expect(toolsForStudyDesign('prospective non-randomised trial')).toEqual(['ROBINS-I']);
    expect(toolsForStudyDesign('prospective quasi-experimental study')).toEqual(['ROBINS-I']);
    // And a nested case-control inside a randomised trial is still case-control.
    expect(toolsForStudyDesign('nested case-control within a randomised trial')).toEqual(['NOS-CC']);
  });

  it('prefers the more specific instrument when a design string names several', () => {
    // A prevalence study is usually described as cross-sectional.
    expect(toolsForStudyDesign('cross-sectional prevalence study')).toEqual(['JBI-Prevalence']);
    // A systematic review of trials is a review, not a trial.
    expect(toolsForStudyDesign('systematic review of randomised trials')).toEqual(['AMSTAR-2']);
    // A DTA study run in a cohort is a DTA study.
    expect(toolsForStudyDesign('prospective cohort diagnostic accuracy study')).toEqual(['QUADAS-2']);
  });

  it('returns nothing rather than a misleading fallback for an unknown design', () => {
    expect(toolsForStudyDesign('')).toEqual([]);
    expect(toolsForStudyDesign('an n-of-1 design nobody routes')).toEqual([]);
    expect(nosVariantForDesign('qualitative interview study')).toBe('');
    expect(nosVariantForDesign('an n-of-1 design nobody routes')).toBe('');
  });
});

describe('isRobToolActive / normalizeRobTool', () => {
  it('all thirteen implemented instruments are active; planned tools are not', () => {
    for (const id of ACTIVE) expect(isRobToolActive(id), id).toBe(true);
    expect(isRobToolActive('custom')).toBe(false);
    expect(isRobToolActive('ROBINS-E')).toBe(false);
    expect(isRobToolActive('')).toBe(false);
    expect(isRobToolActive(undefined)).toBe(false);
  });

  it('coerces any non-active selection back to the default', () => {
    expect(normalizeRobTool('RoB2')).toBe('RoB2');
    expect(normalizeRobTool('ROBINS-I')).toBe('ROBINS-I');
    expect(normalizeRobTool('QUADAS-2')).toBe('QUADAS-2');
    expect(normalizeRobTool('PROBAST')).toBe('PROBAST');
    expect(normalizeRobTool('custom')).toBe('RoB2');
    expect(normalizeRobTool('garbage')).toBe('RoB2');
    expect(normalizeRobTool(undefined)).toBe('RoB2');
    expect(normalizeRobTool(null)).toBe('RoB2');
  });
});
