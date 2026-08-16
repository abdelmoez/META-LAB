/**
 * features/manuscript/sectionStatusRule.js — ONE section-status rule, r2 (118.md §32).
 *
 * The rule "Locked > Outdated > content state" and the chip it renders were
 * duplicated: `sectionRowStatus` + `STATUS_CHIP` in manuscriptPanels.jsx and
 * `overviewSectionStatus` + `SECTION_CHIP` in ManuscriptOverview.jsx. The two
 * predicates agreed, but the PALETTES had already drifted (the panels copy tagged
 * Auto-draft yellow and Locked purple; the Overview tags Auto-draft blue and Locked
 * grey), so the same section could be two different colours depending on which
 * surface you were looking at.
 *
 * 118.md §32 settles it deliberately in favour of the OVERVIEW's four-tone palette
 * — "green only for real progress, yellow for 'the project moved on', grey for
 * everything neutral, and blue only for 'generated, not yet read'. Do not turn the
 * page into a rainbow." Purple was a fifth tone that carried no extra meaning.
 *
 * Kept as a tiny module rather than a re-export so neither big component owns the
 * other's rule, and so the tests can pin the rule without importing a panel tree.
 */
import { sectionStatus } from '../../research-engine/manuscript/index.js';

/**
 * Locked > Outdated > content state.
 *
 * @param   {object}  section    a draft section (may be undefined).
 * @param   {boolean} isOutdated whether the freshness engine flags it out of date.
 * @returns {'locked'|'outdated'|'ai-draft'|'edited'|'empty'}  Pure.
 */
export function sectionRowStatus(section, isOutdated) {
  if (section && section.locked) return 'locked';
  if (isOutdated) return 'outdated';
  return sectionStatus(section || {});
}

/** 118.md §32 — the canonical label + tone for each status. Four tones, no rainbow. */
export const SECTION_STATUS_CHIP = {
  empty: { label: 'Empty', tone: 'gray' },
  'ai-draft': { label: 'Auto-draft', tone: 'blue' },
  edited: { label: 'Edited', tone: 'green' },
  locked: { label: 'Locked', tone: 'gray' },
  outdated: { label: 'Outdated', tone: 'yellow' },
};

export default { sectionRowStatus, SECTION_STATUS_CHIP };
