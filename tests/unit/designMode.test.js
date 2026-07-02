/**
 * designMode.test.js — the pure core of the design-mode system (65.md contract).
 *
 * Covers the governance contract: Stitch is the fail-safe product default; a
 * non-admin ALWAYS renders settings.defaultMode unless Ops enables
 * allowLegacyFallback (which re-enables the override→saved→default chain);
 * admins always keep the personal chain; invalid values fail safe to stitch;
 * persistence round-trips only valid values. No jsdom needed —
 * localStorage/document are stubbed on globalThis where a test exercises them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DESIGN_MODES, DEFAULT_MODE, STORAGE_KEY, SETTINGS_CACHE_KEY,
  isValidMode, normalizeMode, isDesignAdmin, readQueryOverride, resolveDesignMode,
  getSavedDesignMode, saveDesignMode, clearSavedDesignMode, applyDesignAttr,
  getCachedDesignSettings, cacheDesignSettings,
} from '../../src/frontend/design/designMode.js';

const ADMIN = { role: 'admin' };
const MOD = { role: 'mod' };
const USER = { role: 'user' };

const FALLBACK_OFF = { defaultMode: 'stitch', allowLegacyFallback: false };
const FALLBACK_ON  = { defaultMode: 'stitch', allowLegacyFallback: true };

describe('design-mode constants', () => {
  it('exposes exactly legacy + stitch, defaulting to stitch (the product UI)', () => {
    expect(DESIGN_MODES).toEqual(['legacy', 'stitch']);
    expect(DEFAULT_MODE).toBe('stitch');
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
  it('fails unknown values safely to stitch', () => {
    expect(normalizeMode('legacy')).toBe('legacy');
    expect(normalizeMode('stitch')).toBe('stitch');
    expect(normalizeMode('nonsense')).toBe('stitch');
    expect(normalizeMode(null)).toBe('stitch');
    expect(normalizeMode(undefined)).toBe('stitch');
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

describe('resolveDesignMode — the authoritative gate (65.md)', () => {
  describe('non-admin, fallback OFF (the normal state)', () => {
    it('ALWAYS returns settings.defaultMode — override and saved are ignored', () => {
      for (const user of [USER, MOD, null]) {
        expect(resolveDesignMode({ user, savedMode: 'legacy', queryOverride: 'legacy', settings: FALLBACK_OFF })).toBe('stitch');
        expect(resolveDesignMode({ user, savedMode: 'legacy', queryOverride: null, settings: FALLBACK_OFF })).toBe('stitch');
        expect(resolveDesignMode({ user, savedMode: null, queryOverride: 'legacy', settings: FALLBACK_OFF })).toBe('stitch');
      }
    });
    it('follows defaultMode when Ops flips it to legacy (still ignoring saved/override)', () => {
      const s = { defaultMode: 'legacy', allowLegacyFallback: false };
      expect(resolveDesignMode({ user: USER, savedMode: 'stitch', queryOverride: 'stitch', settings: s })).toBe('legacy');
      expect(resolveDesignMode({ user: null, savedMode: null, queryOverride: null, settings: s })).toBe('legacy');
    });
  });

  describe('non-admin, fallback ON (Ops-enabled emergency escape)', () => {
    it('lets a valid ?ui= override win', () => {
      expect(resolveDesignMode({ user: USER, savedMode: 'stitch', queryOverride: 'legacy', settings: FALLBACK_ON })).toBe('legacy');
      expect(resolveDesignMode({ user: null, savedMode: null, queryOverride: 'legacy', settings: FALLBACK_ON })).toBe('legacy');
    });
    it('uses the saved preference when there is no override', () => {
      expect(resolveDesignMode({ user: USER, savedMode: 'legacy', queryOverride: null, settings: FALLBACK_ON })).toBe('legacy');
      expect(resolveDesignMode({ user: MOD, savedMode: 'stitch', queryOverride: null, settings: FALLBACK_ON })).toBe('stitch');
    });
    it('falls through to defaultMode when nothing valid is set', () => {
      expect(resolveDesignMode({ user: USER, savedMode: 'garbage', queryOverride: null, settings: FALLBACK_ON })).toBe('stitch');
      expect(resolveDesignMode({ user: USER, settings: { defaultMode: 'legacy', allowLegacyFallback: true } })).toBe('legacy');
    });
  });

  describe('admin — personal chain regardless of fallback', () => {
    it('lets a valid ?ui= override win (both directions, fallback on or off)', () => {
      expect(resolveDesignMode({ user: ADMIN, savedMode: 'stitch', queryOverride: 'legacy', settings: FALLBACK_OFF })).toBe('legacy');
      expect(resolveDesignMode({ user: ADMIN, savedMode: 'legacy', queryOverride: 'stitch', settings: FALLBACK_OFF })).toBe('stitch');
      expect(resolveDesignMode({ user: ADMIN, savedMode: 'stitch', queryOverride: 'legacy', settings: FALLBACK_ON })).toBe('legacy');
    });
    it('uses the saved preference when there is no override', () => {
      expect(resolveDesignMode({ user: ADMIN, savedMode: 'legacy', queryOverride: null, settings: FALLBACK_OFF })).toBe('legacy');
      expect(resolveDesignMode({ user: ADMIN, savedMode: 'stitch', queryOverride: null, settings: FALLBACK_OFF })).toBe('stitch');
    });
    it('falls through to settings.defaultMode for an invalid/absent saved value', () => {
      expect(resolveDesignMode({ user: ADMIN, savedMode: 'garbage', queryOverride: null, settings: FALLBACK_OFF })).toBe('stitch');
      expect(resolveDesignMode({ user: ADMIN, settings: { defaultMode: 'legacy', allowLegacyFallback: false } })).toBe('legacy');
    });
  });

  describe('fail-safe + legacy call shape', () => {
    it('resolves to stitch with no inputs at all', () => {
      expect(resolveDesignMode({})).toBe('stitch');
      expect(resolveDesignMode()).toBe('stitch');
    });
    it('coerces an invalid settings.defaultMode to stitch', () => {
      expect(resolveDesignMode({ user: USER, settings: { defaultMode: 'vivid', allowLegacyFallback: false } })).toBe('stitch');
    });
    it('accepts the pre-61 top-level defaultMode call shape gracefully', () => {
      expect(resolveDesignMode({ user: USER, defaultMode: 'legacy' })).toBe('legacy');
      expect(resolveDesignMode({ user: ADMIN, savedMode: null, queryOverride: null, defaultMode: 'legacy' })).toBe('legacy');
    });
    it('treats a non-boolean allowLegacyFallback as OFF (strict === true)', () => {
      expect(resolveDesignMode({ user: USER, savedMode: 'legacy', settings: { defaultMode: 'stitch', allowLegacyFallback: 'yes' } })).toBe('stitch');
    });
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
    saveDesignMode('legacy');
    expect(store[STORAGE_KEY]).toBe('legacy');
    expect(getSavedDesignMode()).toBe('legacy');
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

describe('designSettings cache (pre-paint seed)', () => {
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

  it('round-trips a normalized record', () => {
    cacheDesignSettings({ allowAllUsers: true, defaultMode: 'legacy', allowLegacyFallback: true });
    expect(JSON.parse(store[SETTINGS_CACHE_KEY]).defaultMode).toBe('legacy');
    expect(getCachedDesignSettings()).toEqual({ allowAllUsers: true, defaultMode: 'legacy', allowLegacyFallback: true });
  });
  it('normalizes bad fields on write (invalid mode → stitch, loose fallback → false)', () => {
    cacheDesignSettings({ defaultMode: 'vivid', allowLegacyFallback: 'yes' });
    expect(getCachedDesignSettings()).toEqual({ allowAllUsers: false, defaultMode: 'stitch', allowLegacyFallback: false });
  });
  it('returns null for absent or corrupt cache', () => {
    expect(getCachedDesignSettings()).toBe(null);
    store[SETTINGS_CACHE_KEY] = '{not json';
    expect(getCachedDesignSettings()).toBe(null);
  });
  it('does not throw when storage is unavailable', () => {
    delete globalThis.localStorage;
    expect(() => cacheDesignSettings({ defaultMode: 'stitch' })).not.toThrow();
    expect(getCachedDesignSettings()).toBe(null);
  });
});

describe('applyDesignAttr', () => {
  let el;
  beforeEach(() => {
    el = { dataset: {} };
    globalThis.document = { documentElement: el };
  });
  afterEach(() => { delete globalThis.document; });

  it('sets a normalized data-ui-design attribute (bad values paint the product UI)', () => {
    applyDesignAttr('legacy');
    expect(el.dataset.uiDesign).toBe('legacy');
    applyDesignAttr('garbage');
    expect(el.dataset.uiDesign).toBe('stitch');
  });
  it('does not throw without a document', () => {
    delete globalThis.document;
    expect(() => applyDesignAttr('stitch')).not.toThrow();
  });
});
