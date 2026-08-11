/**
 * instrumentCatalog.js — the PURE half of the Assess tool selector (115.md §6-§8,
 * §37-§39). No React, no network, no Date.now().
 *
 * ── WHAT REPLACED WHAT ──────────────────────────────────────────────────────
 * The Assess flow used to read a two-entry constant in ProjectRobPanel.jsx
 * (`INSTRUMENT_CHOICES = [RoB2, ROBINS-I]`), rendered only when the
 * `guidedRobAppraisal` flag was ON, and dropped the chosen instrument entirely
 * when it was OFF. Which instruments exist is a REGISTRY question, so the
 * selector is now fed by the server catalogue that travels with
 * `GET /projects/:id/studies` (`instruments`) plus that endpoint's per-study
 * `recommendation` block. Nothing here hardcodes an instrument id.
 *
 * ── RECOMMENDATIONS ARE GUIDANCE, NEVER GATES (§37) ─────────────────────────
 * `splitByRecommendation` puts the recommended tools first; EVERY tool stays in
 * the returned list. `mismatchWarningFor` produces the §38 sentence for a tool
 * the study's recorded design does not point to — an inline caution the reviewer
 * can knowingly continue past, never a block. When the design is unknown there is
 * no recommendation section and no warning: a guess dressed as guidance would be
 * worse than silence.
 */

import { ROB_DESIGNS, robDesignLabel } from '../../research-engine/rob/tools.js';

/** The canonical study-design vocabulary the filter offers (13 designs). */
export { ROB_DESIGNS, robDesignLabel };

/*
 * ── ONE SOURCE OF TRUTH FOR PROVENANCE ──────────────────────────────────────
 * There used to be an `enrichInstrument` / `enrichCatalogue` pair here that
 * merged `organization` / `citation` / `guidanceUrl` / `license` back in from the
 * pure tools catalogue, because the four pre-115 definitions (RoB 2, ROBINS-I and
 * the two Newcastle-Ottawa forms) did not carry those fields and the server
 * derives its catalogue rows from the DEFINITIONS. All thirteen definitions now
 * carry their own provenance (pinned by tests/unit/robInstrumentRegistry.test.js,
 * which asserts it for every instrument and checks it against tools.js), so the
 * server's rows are already complete and a client-side merge would only be a
 * second place for the attribution to drift. The selector consumes the catalogue
 * exactly as it arrives.
 */

/** Everything about a tool that a free-text search should look inside. */
function haystack(tool) {
  return [
    tool.label, tool.name, tool.abbreviation, tool.sublabel, tool.description,
    tool.organization, tool.instrumentVersion,
    ...(tool.designs || []).map(robDesignLabel),
    ...(tool.designs || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Filter a catalogue by a free-text query and/or a canonical design id.
 * Both are optional; an empty filter returns the catalogue unchanged (same order).
 * Pure.
 */
export function filterInstruments(catalogue, { query = '', designId = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const d = String(designId || '').trim();
  return (catalogue || []).filter((t) => {
    if (d && !(t.designs || []).includes(d)) return false;
    if (!q) return true;
    return haystack(t).includes(q);
  });
}

/**
 * Split a catalogue into the tools RECOMMENDED for this study and the rest.
 * `recommendation` is the server's per-study block
 * `{ design, recommendedToolIds, compatibleToolIds, mismatchToolIds, warning }`.
 * A missing/empty recommendation yields `recommended: []` — the selector then
 * renders no "Recommended for this study" section at all (§37: an undetectable
 * design produces no recommendation).
 * Pure.
 */
export function splitByRecommendation(catalogue, recommendation) {
  const ids = (recommendation && recommendation.recommendedToolIds) || [];
  const list = catalogue || [];
  const recommended = ids.map(id => list.find(t => t.id === id)).filter(Boolean);
  const recommendedIds = new Set(recommended.map(t => t.id));
  return { recommended, others: list.filter(t => !recommendedIds.has(t.id)) };
}

/** Human design labels for a tool ("Diagnostic test accuracy study"). Pure. */
export function designLabelsFor(tool) {
  return ((tool && tool.designs) || []).map(robDesignLabel).filter(Boolean);
}

/**
 * A design label as a plural noun phrase, for the "designed for …" sentence.
 * The vocabulary's labels are singular ("Diagnostic test accuracy study",
 * "Non-randomised study of an intervention"), and naive `+ 's'` mangles the ones
 * whose head noun is not last. Pure.
 */
export function pluralizeDesign(label) {
  const s = String(label || '').trim();
  if (!s) return s;
  if (/\bstudy\b/i.test(s)) return s.replace(/\bstudy\b/i, 'studies');
  // "Systematic review (umbrella review)" and anything already plural is left be.
  if (/[)\]]$/.test(s) || /s$/i.test(s)) return s;
  return `${s}s`;
}

/**
 * The §38 inline warning for choosing `toolId` on a study whose recorded design
 * points elsewhere, or '' when there is nothing honest to say — which is the case
 * when the design is unknown, when the design routes to no tool at all, when the
 * chosen tool IS recommended, or when the tool declares the study's design among
 * its own.
 *
 * The sentence names the tool's intended design, the study's recorded design and
 * the recommended alternative, e.g.
 *   "QUADAS-2 is designed for diagnostic test accuracy studies; this study's
 *    recorded design is "randomised controlled trial" — RoB 2 may be more
 *    appropriate. You can continue with QUADAS-2 if that is deliberate."
 * Pure.
 */
export function mismatchWarningFor(toolId, catalogue, recommendation) {
  if (!toolId || !recommendation) return '';
  const design = String(recommendation.design || '').trim();
  const recommendedIds = recommendation.recommendedToolIds || [];
  if (!design || !recommendedIds.length) return '';
  if (recommendedIds.includes(toolId)) return '';
  // The server already decided which tools are a mismatch for this design; a tool
  // it did NOT flag covers the design some other way, so stay quiet.
  const flagged = recommendation.mismatchToolIds;
  if (Array.isArray(flagged) && flagged.length && !flagged.includes(toolId)) return '';

  const list = catalogue || [];
  const tool = list.find(t => t.id === toolId);
  if (!tool) return '';
  const intended = designLabelsFor(tool).map(l => pluralizeDesign(l).toLowerCase());
  const better = recommendedIds
    .map(id => (list.find(t => t.id === id) || {}).label || id);

  const intendedBit = intended.length
    ? `${tool.label || tool.id} is designed for ${intended.join(' and ')}`
    : `${tool.label || tool.id} is not the instrument for this design`;
  const betterBit = better.length ? ` — ${better.join(' or ')} may be more appropriate.` : '.';
  return `${intendedBit}; this study's recorded design is "${design}"${betterBit} You can continue with ${tool.label || tool.id} if that is deliberate.`;
}

/**
 * §39 — the tool-change safety line for a study that already has assessments
 * under OTHER instruments, e.g. "A ROBINS-I draft already exists for this study."
 * Never destructive on its own: starting a different instrument creates a new row
 * and leaves the earlier assessment untouched.
 * Pure.
 */
export function existingToolNotice(existingAssessments, toolId) {
  const rows = (existingAssessments || []).filter(a => a && a.instrumentId !== toolId);
  if (!rows.length) return '';
  const byTool = new Map();
  for (const r of rows) {
    const key = r.instrumentLabel || r.instrumentId;
    const state = r.isConsensus ? 'consensus record' : r.status === 'complete' ? 'finalised assessment' : 'draft';
    const k = `${key}||${state}`;
    byTool.set(k, (byTool.get(k) || 0) + 1);
  }
  const parts = [...byTool.entries()].map(([k, n]) => {
    const [label, state] = k.split('||');
    return `${n === 1 ? 'A' : n} ${label} ${state}${n === 1 ? '' : 's'}`;
  });
  return `${parts.join(', ')} already exist${parts.length === 1 && !/^\d/.test(parts[0]) ? 's' : ''} for this study. Starting a different instrument leaves it untouched — open it instead if you meant to continue that work.`;
}

/** Assessments for this study already recorded under `toolId`. Pure. */
export function assessmentsForTool(existingAssessments, toolId) {
  return (existingAssessments || []).filter(a => a && a.instrumentId === toolId);
}

/**
 * The design ids actually represented in a catalogue, in ROB_DESIGNS order, so
 * the filter never offers a design with nothing behind it. Pure.
 */
export function designsInCatalogue(catalogue) {
  const present = new Set();
  for (const t of catalogue || []) for (const d of t.designs || []) present.add(d);
  return ROB_DESIGNS.filter(d => present.has(d.id));
}

export default {
  filterInstruments,
  splitByRecommendation,
  designLabelsFor,
  pluralizeDesign,
  mismatchWarningFor,
  existingToolNotice,
  assessmentsForTool,
  designsInCatalogue,
  ROB_DESIGNS,
  robDesignLabel,
};
