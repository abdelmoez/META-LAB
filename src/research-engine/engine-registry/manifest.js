/**
 * engine-registry/manifest.js — parse + validate explicit engine-change
 * declarations from a JSON manifest file or from git commit-message footers.
 *
 * Pure: depends only on the catalog (isEngineId) and version math
 * (isValidChangeType). No IO. The CLI feeds raw declarations through here before
 * handing the validated set to classify.classifyChanges.
 *
 * A declaration is the developer's authoritative statement of intent:
 *   { engine: <id>, type: 'minor'|'major', summary: <text> }
 * (the key may be `engine` or `engineId`).
 */

import { isEngineId } from './engines.js';
import { isValidChangeType } from './version.js';

/** Maximum summary length; longer summaries are truncated, not rejected. */
export const MAX_SUMMARY = 280;

/**
 * Validate a single declaration object.
 * @returns {{ ok:boolean, error?:string, value?:{engineId,type,summary} }}
 */
export function validateDeclaration(d) {
  if (!d || typeof d !== 'object') {
    return { ok: false, error: 'declaration must be an object' };
  }
  const engineId = d.engineId != null ? d.engineId : d.engine;
  if (engineId == null || engineId === '') {
    return { ok: false, error: 'a declaration requires an engine id' };
  }
  if (!isEngineId(engineId)) {
    return { ok: false, error: 'unknown engine id: ' + engineId };
  }
  if (!isValidChangeType(d.type)) {
    return {
      ok: false,
      error: 'invalid change type: ' + String(d.type) + ' (use minor|major)',
    };
  }
  if (typeof d.summary !== 'string' || d.summary.trim() === '') {
    return { ok: false, error: 'a non-empty summary is required' };
  }
  const summary = d.summary.trim().slice(0, MAX_SUMMARY);
  return { ok: true, value: { engineId, type: d.type, summary } };
}

/**
 * Validate a list of declarations. Collects per-item errors AND flags any engine
 * declared more than once (an inconsistent / ambiguous bump).
 * @returns {{ ok:boolean, errors:string[], declarations:{engineId,type,summary}[] }}
 */
export function validateDeclarations(list) {
  const errors = [];
  const declarations = [];
  const seen = new Set();

  const arr = Array.isArray(list) ? list : [];
  for (const d of arr) {
    const res = validateDeclaration(d);
    if (!res.ok) {
      errors.push(res.error);
      continue;
    }
    if (seen.has(res.value.engineId)) {
      errors.push('duplicate declaration for engine: ' + res.value.engineId);
      continue;
    }
    seen.add(res.value.engineId);
    declarations.push(res.value);
  }

  return { ok: errors.length === 0, errors, declarations };
}

/**
 * Parse + validate a JSON manifest.
 * Accepts `{ engineChanges: [...] }` or a bare array. An empty / missing
 * engineChanges is a valid no-op.
 * @returns {{ ok:boolean, errors:string[], declarations:{engineId,type,summary}[] }}
 */
export function parseManifest(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, errors: ['manifest is not valid JSON'], declarations: [] };
  }

  let list;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (parsed.engineChanges == null) {
      // Valid no-op: object without an engineChanges key.
      return { ok: true, errors: [], declarations: [] };
    }
    if (!Array.isArray(parsed.engineChanges)) {
      return {
        ok: false,
        errors: ['manifest engineChanges must be an array'],
        declarations: [],
      };
    }
    list = parsed.engineChanges;
  } else {
    return {
      ok: false,
      errors: ['manifest must be an object or array'],
      declarations: [],
    };
  }

  return validateDeclarations(list);
}

// Footer keys (case-insensitive, trailing colon). Captures the value after the colon.
const FOOTER_ENGINE = /^engine:\s*(.+?)\s*$/i;
const FOOTER_CHANGE = /^engine-change:\s*(.+?)\s*$/i;
const FOOTER_SUMMARY = /^engine-summary:\s*(.+?)\s*$/i;

/**
 * Parse engine-change footers out of one or more commit messages.
 *
 * @param {string|string[]} input one commit message, many concatenated, or an
 *        array of commit-message strings.
 * @returns {{engine:string,type:string,summary:string}[]} RAW declarations
 *          (NOT validated — run validateDeclarations downstream).
 *
 * Grouping: a new `Engine:` line opens a new declaration; subsequent
 * `Engine-Change:` / `Engine-Summary:` lines attach to the currently-open one.
 * `Engine-Change`/`Engine-Summary` before any `Engine:` are ignored.
 */
export function parseCommitFooters(input) {
  const messages = Array.isArray(input) ? input : [String(input == null ? '' : input)];
  const declarations = [];

  for (const message of messages) {
    let current = null;
    const lines = String(message).split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const engineMatch = line.match(FOOTER_ENGINE);
      if (engineMatch) {
        current = { engine: engineMatch[1].trim(), type: undefined, summary: undefined };
        declarations.push(current);
        continue;
      }

      const changeMatch = line.match(FOOTER_CHANGE);
      if (changeMatch && current) {
        current.type = changeMatch[1].trim().toLowerCase();
        continue;
      }

      const summaryMatch = line.match(FOOTER_SUMMARY);
      if (summaryMatch && current) {
        current.summary = summaryMatch[1].trim();
        continue;
      }
    }
  }

  return declarations;
}
