/**
 * compilers/index.js — 73.md Part 6. Public API of the Search-Builder database
 * strategy compiler: the single home for per-database MANUAL syntax compilation.
 *
 * A saved strategy (see normalize.js for the shape) is compiled into a database-native
 * Boolean query plus structured diagnostics. Every renderer produces REAL syntax for
 * its database and never silently drops or fakes a feature — anything untranslatable
 * is surfaced as a warning {code,message}, an unsupported {feature,detail}, or a note.
 *
 * Result contract (compileStrategy / entries of compileAll):
 *   {
 *     dbId, label,
 *     query,                    // the compiled, paste-ready string ('' when empty)
 *     warnings:  [{ code, message }],
 *     notes:     [string],
 *     unsupported:[{ feature, detail }],
 *     vocab: { system:'mesh'|'emtree'|'cinahl'|'apa'|'decs'|'none', mapped, unmapped, approximate },
 *     syntaxLevel: 'native' | 'approximate',
 *     filtersApplied: boolean,  // did the date/language/pubtype limits get embedded in `query`?
 *     overridden?: true         // present only when a saved manual override replaced `query`
 *   }
 *
 * Extension: register a new database with registerRenderer({ id, renderControlled,
 * renderFree, buildFilters, ... }); see shared.runRenderer for the hook contract.
 */
import { runRenderer } from './shared.js';
import { normalizeStrategy } from './normalize.js';
import { capabilitiesFor, capabilityDatabases } from './capabilities.js';

import { pubmed } from './renderers/pubmed.js';
import { embase } from './renderers/embase.js';
import { cochrane } from './renderers/cochrane.js';
import { clinicaltrials } from './renderers/clinicaltrials.js';
import { ictrp } from './renderers/ictrp.js';
import { scopus } from './renderers/scopus.js';
import { wos } from './renderers/wos.js';
import { gscholar } from './renderers/gscholar.js';
import { cinahl } from './renderers/cinahl.js';
import { psycinfo } from './renderers/psycinfo.js';
import { proquest } from './renderers/proquest.js';
import { opengrey } from './renderers/opengrey.js';
import { europepmc } from './renderers/europepmc.js';
import { pmc } from './renderers/pmc.js';
import { ieee } from './renderers/ieee.js';
import { acm } from './renderers/acm.js';

/* ── renderer registry ───────────────────────────────────────────────────────── */
const RENDERERS = new Map();
export function registerRenderer(renderer) {
  if (renderer && renderer.id) RENDERERS.set(renderer.id, renderer);
}
[pubmed, embase, cochrane, clinicaltrials, ictrp, scopus, wos, gscholar,
  cinahl, psycinfo, proquest, opengrey, europepmc, pmc, ieee, acm].forEach(registerRenderer);

/* ── public API ──────────────────────────────────────────────────────────────── */

/** All database ids that have a registered compiler (covers the full catalogue). */
export function listCompilerDatabases() {
  return [...RENDERERS.keys()];
}

/** Capability metadata for a database id (or null). Re-exported for the UI. */
export { capabilitiesFor };

const EMPTY_VOCAB = () => ({ system: 'none', mapped: 0, unmapped: 0, approximate: false });

/**
 * compileStrategy(strategy, dbId, opts?) → result contract (see file header).
 * opts.applyOverride (default true): honor a saved overrides[dbId] string, replacing
 * the composed query. Pass false to always get the freshly composed query.
 */
export function compileStrategy(strategy, dbId, opts = {}) {
  const id = String(dbId == null ? '' : dbId);
  const cap = capabilitiesFor(id);
  const renderer = RENDERERS.get(id);
  const ir = normalizeStrategy(strategy);

  if (!cap || !renderer) {
    return {
      dbId: id, label: id, query: '',
      warnings: [{ code: 'UNSUPPORTED_DATABASE', message: `No compiler is registered for "${id}".` }],
      notes: [], unsupported: [{ feature: 'database', detail: `Unknown database "${id}".` }],
      vocab: EMPTY_VOCAB(), syntaxLevel: 'approximate', filtersApplied: false,
    };
  }

  const r = runRenderer(ir, cap, renderer);
  const result = {
    dbId: id, label: cap.label, query: r.query,
    warnings: r.warnings, notes: r.notes, unsupported: r.unsupported,
    vocab: r.vocab, syntaxLevel: r.syntaxLevel, filtersApplied: r.filtersApplied,
  };

  const override = ir.overrides[id];
  if (typeof override === 'string' && override.trim() && opts.applyOverride !== false) {
    result.query = override.trim();
    result.notes = [...result.notes, `A manual override is saved for ${cap.label}; the composed query was replaced by your edited string.`];
    result.overridden = true;
  }
  return result;
}

/**
 * compileAll(strategy, dbIds?) → result[]. When dbIds is omitted/empty every
 * registered compiler is used, in registration order.
 */
export function compileAll(strategy, dbIds, opts = {}) {
  const ids = Array.isArray(dbIds) && dbIds.length ? dbIds : listCompilerDatabases();
  return ids.map((id) => compileStrategy(strategy, id, opts));
}

export { normalizeStrategy, capabilityDatabases };
export default compileStrategy;
