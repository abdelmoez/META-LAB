/**
 * screeningShortcuts.js — pure, framework-free helpers for per-user keyboard shortcut prefs.
 *
 * Exports:
 *   DEFAULT_SCREENING_SHORTCUTS  — canonical defaults object
 *   sanitizeScreeningShortcuts   — coerce any stored value → valid prefs (falls back to defaults)
 */

export const DEFAULT_SCREENING_SHORTCUTS = {
  enabled: true,
  keys: {
    next:     'ArrowRight',
    previous: 'ArrowLeft',
    include:  'i',
    exclude:  'e',
    maybe:    'm',
    undo:     'u',
  },
};

const VALID_ACTIONS = Object.keys(DEFAULT_SCREENING_SHORTCUTS.keys);

/**
 * Coerce any raw value (parsed JSON, null, undefined, malformed object) into a
 * valid { enabled, keys: { next, previous, include, exclude, maybe, undo } }.
 * Missing or non-string keys fall back to the matching default.
 */
export function sanitizeScreeningShortcuts(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SCREENING_SHORTCUTS, keys: { ...DEFAULT_SCREENING_SHORTCUTS.keys } };

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SCREENING_SHORTCUTS.enabled;

  const rawKeys = raw.keys && typeof raw.keys === 'object' ? raw.keys : {};
  const keys = {};
  for (const action of VALID_ACTIONS) {
    const val = rawKeys[action];
    keys[action] = typeof val === 'string' && val.trim().length > 0
      ? val.trim()
      : DEFAULT_SCREENING_SHORTCUTS.keys[action];
  }

  return { enabled, keys };
}

/**
 * Parse a JSON string (as stored in user.screeningShortcuts) → sanitized prefs.
 * Returns defaults on any error.
 */
export function parseScreeningShortcuts(jsonStr) {
  if (!jsonStr) return sanitizeScreeningShortcuts(null);
  try {
    return sanitizeScreeningShortcuts(JSON.parse(jsonStr));
  } catch {
    return sanitizeScreeningShortcuts(null);
  }
}

/**
 * Return a human-readable label for a key value, e.g. "ArrowRight" → "→".
 */
export function keyLabel(key) {
  const MAP = {
    ArrowRight: '→',
    ArrowLeft:  '←',
    ArrowUp:    '↑',
    ArrowDown:  '↓',
    Enter:      '↵',
    Escape:     'Esc',
    Backspace:  '⌫',
    ' ':        'Space',
  };
  return MAP[key] ?? key.toUpperCase();
}
