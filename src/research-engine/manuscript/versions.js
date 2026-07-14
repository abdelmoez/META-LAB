/**
 * manuscript/versions.js — 84.md Part 11. Collects the versions of the pure
 * engines whose formulas actually produce manuscript numbers, so a snapshot (and
 * the Methods "software/engine" statement) records EXACTLY which implementation
 * generated a value. If a formula implementation changes after a software update,
 * the recorded version differs and the affected content can be flagged for
 * recalculation (84.md Part 11 rule 2/3) — without silently altering old numbers.
 *
 * Pure — no DOM/React/network/Date. Deterministic.
 */

import { CONVERSION_ENGINE_VERSION } from '../conversions/catalogue.js';
import { NMA_ENGINE_VERSION } from '../statistics/nma/index.js';
// metaRegression.js exports its version as ENGINE_VERSION (not
// META_REGRESSION_ENGINE_VERSION — no such symbol exists); alias it here so the
// public shape 84.md asked for ({ conversion, nma, metaRegression }) holds.
import { ENGINE_VERSION as META_REGRESSION_ENGINE_VERSION } from '../statistics/metaRegression.js';

/**
 * The engine-version stamp embedded in snapshots + the methods engine.versions
 * dependency. Stable for a given build; changes only when an engine's formula
 * version constant is bumped.
 * @returns {{ conversion:string, nma:string, metaRegression:string }}
 */
export function collectEngineVersions() {
  return {
    conversion: CONVERSION_ENGINE_VERSION,
    nma: NMA_ENGINE_VERSION,
    metaRegression: META_REGRESSION_ENGINE_VERSION,
  };
}

export default { collectEngineVersions };
