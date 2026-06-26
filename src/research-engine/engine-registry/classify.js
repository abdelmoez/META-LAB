/**
 * engine-registry/classify.js — turn a set of changed paths (and/or explicit
 * developer declarations) into a list of proposed engine version bumps.
 *
 * Pure: no DB / IO. Used by the bump CLI to decide what to bump.
 *
 * Two modes:
 *   - explicit: when the developer declares engine changes (manifest / commit
 *     footers). Authoritative — declarations drive the bumps; paths only inform
 *     the reporting buckets.
 *   - rule: otherwise, infer one MINOR bump per engine whose owned files
 *     changed. Major vs minor cannot be inferred from paths alone, so we always
 *     default to 'minor' and say so in the reason (declare explicitly to
 *     override).
 */

import { ENGINE_BY_ID } from './engines.js';
import { classifyPaths } from './ownership.js';

/**
 * Classify a change set.
 *
 * @param {Object} input
 * @param {string[]} [input.paths]        changed repo-relative file paths
 * @param {Object[]} [input.declarations] explicit declarations; each accepts
 *        either an `engine` or `engineId` key plus `type` and `summary`. Assumed
 *        already validated (use manifest.validateDeclarations upstream).
 * @returns {{ source:'explicit'|'rule', changes:Object[], warnings:string[], buckets:Object }}
 */
export function classifyChanges({ paths = [], declarations = [] } = {}) {
  const buckets = classifyPaths(paths);
  const warnings = [];

  // Warn about every unowned (ambiguous) path regardless of mode.
  for (const p of buckets.unowned) {
    warnings.push('unowned change (no engine + not shared infra): ' + p);
  }

  const hasDeclarations = Array.isArray(declarations) && declarations.length > 0;

  let source;
  let changes;

  if (hasDeclarations) {
    source = 'explicit';
    changes = declarations.map((d) => {
      const engineId = d.engineId != null ? d.engineId : d.engine;
      return {
        engineId,
        type: d.type,
        summary: d.summary,
        source: 'explicit',
        confidence: 'high',
        reason: 'explicit developer declaration',
      };
    });
  } else {
    source = 'rule';
    changes = [];
    for (const engineId of Object.keys(buckets.byEngine)) {
      const files = buckets.byEngine[engineId];
      if (!files || files.length === 0) continue;
      const engine = ENGINE_BY_ID[engineId];
      const displayName = engine ? engine.displayName : engineId;
      const fileCount = files.length;
      changes.push({
        engineId,
        type: 'minor',
        summary:
          'Updated ' + displayName + ' (' + fileCount + ' file(s) changed)',
        source: 'rule',
        confidence: 'medium',
        reason:
          'changed files map to ' +
          engineId +
          ' ownership; major vs minor could not be auto-determined → defaulting to minor (declare explicitly to override)',
      });
    }

    // No-op case: nothing maps to an engine and nothing was declared.
    if (changes.length === 0) {
      warnings.push('no engine-affecting changes detected');
    }
  }

  // Deterministic ordering by engineId.
  changes.sort((a, b) => String(a.engineId).localeCompare(String(b.engineId)));

  return { source, changes, warnings, buckets };
}

/** True iff the classification surfaced any ambiguous (unowned) paths. */
export function hasAmbiguity(result) {
  return !!(result && result.buckets && result.buckets.unowned.length > 0);
}
