/**
 * manuscript/freshness.js — 84.md Part 9. Rolls the outdated-section map,
 * contradictions, missing-info prompts and stale data-block list into one overall
 * freshness status (with a precedence: critical > updates > missing-info >
 * warnings > synced; unknown when source availability could not be determined) plus
 * a per-section status for the outline badges. Freshness is derived from dependency
 * state, never from "text was generated recently" (Part 9).
 *
 * Pure — no DOM/React/network.
 */

import { SECTION_IDS } from './model.js';

/**
 * @param {object} args { outdated:{[id]:true}, contradictions:[{severity,section}],
 *                        missing:[…], staleBlocks:[…], availabilityKnown:boolean }
 * @returns {{ status:string, label:string, counts:object }}
 */
export function computeFreshness(args = {}) {
  const outdated = args.outdated || {};
  const contradictions = Array.isArray(args.contradictions) ? args.contradictions : [];
  const missing = Array.isArray(args.missing) ? args.missing : [];
  const staleBlocks = Array.isArray(args.staleBlocks) ? args.staleBlocks : [];
  const availabilityKnown = args.availabilityKnown !== false;

  const outdatedCount = Object.keys(outdated).length;
  const criticalCount = contradictions.filter((c) => c && c.severity === 'critical').length;
  const counts = {
    outdated: outdatedCount,
    contradictions: contradictions.length,
    critical: criticalCount,
    missing: missing.length,
    staleBlocks: staleBlocks.length,
  };

  let status;
  if (!availabilityKnown) status = 'unknown';
  else if (criticalCount) status = 'critical';
  else if (outdatedCount || staleBlocks.length) status = 'updates';
  else if (missing.length) status = 'missing-info';
  else if (contradictions.length) status = 'warnings';
  else status = 'synced';

  const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;
  let label;
  switch (status) {
    case 'unknown': label = 'Freshness unknown — source availability could not be determined'; break;
    case 'critical': label = `${plural(criticalCount, 'critical issue')} need review`; break;
    case 'updates': label = `${plural(outdatedCount + staleBlocks.length, 'update')} available`; break;
    case 'missing-info': label = `${plural(missing.length, 'item')} of project information missing`; break;
    case 'warnings': label = `${plural(contradictions.length, 'warning')} to review`; break;
    default: label = 'Fully synchronized';
  }

  return { status, label, counts };
}

/**
 * Per-section badge status. conflict = outdated AND the section was user-edited.
 * @returns {{ [sectionId]: 'outdated'|'conflict'|'issue'|'current'|'empty'|'locked'|'detached' }}
 */
export function perSectionStatus(draft, outdated = {}, contradictions = []) {
  const sections = (draft && draft.sections) || {};
  const withIssue = new Set((Array.isArray(contradictions) ? contradictions : []).map((c) => c && c.section).filter(Boolean));
  const out = {};
  for (const id of SECTION_IDS) {
    const s = sections[id] || {};
    if (!String(s.content || '').trim()) { out[id] = 'empty'; continue; }
    if (s.locked) { out[id] = 'locked'; continue; }
    if (s.detached) { out[id] = 'detached'; continue; }
    if (outdated[id] && s.userEdited) { out[id] = 'conflict'; continue; }
    if (outdated[id]) { out[id] = 'outdated'; continue; }
    if (withIssue.has(id)) { out[id] = 'issue'; continue; }
    out[id] = 'current';
  }
  return out;
}

export default { computeFreshness, perSectionStatus };
