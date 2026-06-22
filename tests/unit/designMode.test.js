/**
 * designMode.test.js — the pure core of the parallel design-mode system.
 *
 * Covers the security/safety contract: non-admins always resolve to legacy,
 * invalid values fail safe to legacy, `?ui=` overrides win, and persistence
 * round-trips only valid values. No jsdom needed — localStorage/document are
 * stubbed on globalThis where a test exercises them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DESIGN_MODES, DEFAULT_MODE, STORAGE_KEY,
  isValidMode, normalizeMode, isDesignAdmin, readQueryOverride, resolveDesignMode,
  getSavedDesignMode, saveDesignMode, clearSavedDesignMode, applyDesignAttr,
} from '../../src/frontend/design/designMode.js';

const ADMIN = { role: 'admin' };
const MOD = { role: 'mod' };
const USER = { role: 'user' };

describe('design-mode constants', () => {
  it('exposes exactly legacy + stitch, defaulting to legacy', () => {
    expect(DESIGN_MODES).toEqual(['legacy', 'stitch']);
    expect(DEFAULT_MODE).toBe('legacy');
  });
});

describe('isValidMode / normalizeMode', () => {
  it('accepts only the two known modes', () => {
    expect(isValidMode('legacy')).toBe(true);
    expect(isValidMode('stitch')).toBe(true);
    expect(isValidMode('vivid')).toBe(false);
    expect(isValidMode('')).toBe(false);
    expect(isValidMode(null)).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
    expect(isValidMode(42)).toBe(false);
  });
  it('fails unknown values safely to legacy', () => {
    expect(normalizeMode('stitch')).toBe('stitch');
    expect(normalizeMode('nonsense')).toBe('legacy');
    expect(normalizeMode(null)).toBe('legacy');
    expect(normalizeMode(undefined)).toBe('legacy');
  });
});

describe('isDesignAdmin', () => {
  it('is true only for an admin role', () => {
    expect(isDesignAdmin(ADMIN)).toBe(true);
    expect(isDesignAdmin(MOD)).toBe(false);   // mods are staff but NOT design admins
    expect(isDesignAdmin(USER)).toBe(false);
    expect(isDesignAdmin(null)).toBe(false);
    expect(isDesignAdmin(undefined)).toBe(false);
    expect(isDesignAdmin({})).toBe(false);
  });
});

describe('readQueryOverride', () => {
  it('parses a valid ?ui= override (case-insensitive, extra params ok)', () => {
    expect(readQueryOverride('?ui=stitch')).toBe('stitch');
    expect(readQueryOverride('?ui=legacy')).toBe('legacy');
    expect(readQueryOverride('?foo=1&ui=STITCH&bar=2')).toBe('stitch');
    expect(readQueryOverride('ui=legacy')).toBe('legacy'); // no leading ?
  });
  it('returns null for missing/invalid overrides', () => {
    expect(readQueryOverride('?ui=vivid')).toBe(null);
    expect(readQueryOverride('?other=1')).toBe(null);
    expect(readQueryOverride('')).toBe(null);
    expect(readQueryOverride(null)).toBe(null);
    expect(readQueryOverride(undefined)).toBe(null);
  });
});

describe('resolveDesignMode — the authoritative gate', () => {
  it('forces legacy for non-admins regardless of saved/override', () => {
    expect(resolveDesignMode({ user: USER, savedMode: 'stitch', queryOverride: 'stitch' })).toBe('legacy');
    expect(resolveDesignMode({ user: MOD, savedMode: 'stitch', queryOverride: 'stitch' })).toBe('legacy');
    expect(resolveDesignMode({ user: null, savedMode: 'stitch', queryOverride: 'stitch' })).toBe('legacy');
  });
  it('lets an admin override to stitch via ?ui= (deep-link preview)', () => {
    expect(resolveDesignMode({ user: ADMIN, savedMode: null, queryOverride: 'stitch' })).toBe('stitch');
  });
  it('honors ?ui=legacy as the emergency escape (wins over a saved stitch)', () => {
    expect(resolveDesignMode({ user: ADMIN, savedMode: 'stitch', queryOverride: 'legacy' })).toBe('legacy');
  });
  it('uses the saved preference when there is no override', () => {
    expect(resolveDesignMode({ user: ADMIN, savedMode: 'stitch', queryOverride: null })).toBe('stitch');
    expect(resolveDesignMode({ user: ADMIN, savedMode: 'legacy', queryOverride: null })).toBe('legacy');
  });
  it('fails safe to legacy for an admin with an invalid/absent saved value', () => {
    expect(resolveDesignMode({ user: ADMIN, savedMode: 'garbage', queryOverride: null })).toBe('legacy');
    expect(resolveDesignMode({ user: ADMIN, savedMode: null, queryOverride: null })).toBe('legacy');
    expect(resolveDesignMode({})).toBe('legacy');
  });
});

describe('localStorage persistence', () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('round-trips a valid mode', () => {
    saveDesignMode('stitch');
    expect(store[STORAGE_KEY]).toBe('stitch');
    expect(getSavedDesignMode()).toBe('stitch');
  });
  it('never persists an invalid value', () => {
    saveDesignMode('bogus');
    expect(STORAGE_KEY in store).toBe(false);
    expect(getSavedDesignMode()).toBe(null);
  });
  it('reads back null for a corrupted stored value', () => {
    store[STORAGE_KEY] = 'corrupt';
    expect(getSavedDesignMode()).toBe(null);
  });
  it('clears the saved value', () => {
    saveDesignMode('stitch');
    clearSavedDesignMode();
    expect(getSavedDesignMode()).toBe(null);
  });
  it('does not throw when storage is unavailable', () => {
    delete globalThis.localStorage;
    expect(() => saveDesignMode('stitch')).not.toThrow();
    expect(getSavedDesignMode()).toBe(null);
    expect(() => clearSavedDesignMode()).not.toThrow();
  });
});

describe('applyDesignAttr', () => {
  let el;
  beforeEach(() => {
    el = { dataset: {} };
    globalThis.document = { documentElement: el };
  });
  afterEach(() => { delete globalThis.document; });

  it('sets a normalized data-ui-design attribute', () => {
    applyDesignAttr('stitch');
    expect(el.dataset.uiDesign).toBe('stitch');
    applyDesignAttr('garbage');
    expect(el.dataset.uiDesign).toBe('legacy');
  });
  it('does not throw without a document', () => {
    delete globalThis.document;
    expect(() => applyDesignAttr('stitch')).not.toThrow();
  });
});
