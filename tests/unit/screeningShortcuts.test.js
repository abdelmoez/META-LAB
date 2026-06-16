/**
 * screeningShortcuts.test.js (prompt25 Task 7) — per-user Screening hotkey prefs.
 * Pure sanitize/parse logic: a stale/garbage/partial stored value must always
 * degrade to safe, complete defaults so the keydown handler never gets undefined.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCREENING_SHORTCUTS,
  sanitizeScreeningShortcuts,
  parseScreeningShortcuts,
  keyLabel,
} from '../../src/frontend/screening/screeningShortcuts.js';

describe('screeningShortcuts prefs', () => {
  it('returns complete defaults for null / garbage / bad JSON', () => {
    expect(sanitizeScreeningShortcuts(null)).toEqual(DEFAULT_SCREENING_SHORTCUTS);
    expect(sanitizeScreeningShortcuts('nope')).toEqual(DEFAULT_SCREENING_SHORTCUTS);
    expect(parseScreeningShortcuts('{not json')).toEqual(DEFAULT_SCREENING_SHORTCUTS);
    expect(parseScreeningShortcuts(null)).toEqual(DEFAULT_SCREENING_SHORTCUTS);
  });

  it('defaults use Right/Left arrows for next/previous and i/e/m/u', () => {
    expect(DEFAULT_SCREENING_SHORTCUTS.keys.next).toBe('ArrowRight');
    expect(DEFAULT_SCREENING_SHORTCUTS.keys.previous).toBe('ArrowLeft');
    expect(DEFAULT_SCREENING_SHORTCUTS.keys.include).toBe('i');
    expect(DEFAULT_SCREENING_SHORTCUTS.keys.undo).toBe('u');
  });

  it('keeps valid custom keys and backfills missing/empty ones from defaults', () => {
    const p = sanitizeScreeningShortcuts({ enabled: false, keys: { include: 'x', maybe: '' } });
    expect(p.enabled).toBe(false);
    expect(p.keys.include).toBe('x');                                      // custom kept
    expect(p.keys.maybe).toBe(DEFAULT_SCREENING_SHORTCUTS.keys.maybe);     // empty → default
    expect(p.keys.next).toBe('ArrowRight');                               // missing → default
  });

  it('parses a JSON string round-trip', () => {
    const p = parseScreeningShortcuts(JSON.stringify({ enabled: true, keys: { undo: 'z' } }));
    expect(p.keys.undo).toBe('z');
    expect(p.enabled).toBe(true);
  });

  it('keyLabel maps arrows to glyphs and uppercases single letters', () => {
    expect(keyLabel('ArrowRight')).toBe('→');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('i')).toBe('I');
  });
});
