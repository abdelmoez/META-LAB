/**
 * robTools.test.js — prompt28 Part 4. The RoB tool catalogue + guards that keep
 * an unsupported tool from ever being selected.
 */
import { describe, it, expect } from 'vitest';
import {
  ROB_TOOLS, DEFAULT_ROB_TOOL, ACTIVE_ROB_TOOLS,
  getRobTool, isRobToolActive, normalizeRobTool,
} from '../../src/research-engine/rob/tools.js';

// NOTE (P14): ROBINS-I is now an IMPLEMENTED, active instrument, so the active
// set is ['RoB2','ROBINS-I']. Only the "which tools are active" assertions below
// changed; the RoB2 guards are unchanged. QUADAS-2 / NOS / custom remain planned.
describe('ROB_TOOLS catalogue', () => {
  it('lists RoB 2 + ROBINS-I as active, with the rest coming-soon', () => {
    expect(ROB_TOOLS.map(t => t.id)).toContain('RoB2');
    expect(ACTIVE_ROB_TOOLS).toEqual(['RoB2', 'ROBINS-I']);
    expect(DEFAULT_ROB_TOOL).toBe('RoB2');
    // the still-planned tools are advertised but disabled
    for (const t of ROB_TOOLS) {
      if (t.id !== 'RoB2' && t.id !== 'ROBINS-I') expect(t.status).toBe('coming-soon');
    }
    // QUADAS-2 / NOS / custom are present for future-proofing
    expect(ROB_TOOLS.map(t => t.id)).toEqual(expect.arrayContaining(['ROBINS-I', 'QUADAS-2', 'NOS', 'custom']));
  });

  it('getRobTool resolves descriptors', () => {
    expect(getRobTool('RoB2').label).toBe('RoB 2');
    expect(getRobTool('nope')).toBeUndefined();
  });
});

describe('isRobToolActive / normalizeRobTool', () => {
  it('RoB 2 and ROBINS-I are active; planned tools are not', () => {
    expect(isRobToolActive('RoB2')).toBe(true);
    expect(isRobToolActive('ROBINS-I')).toBe(true);
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
