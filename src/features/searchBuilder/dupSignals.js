/**
 * dupSignals.js — 97.md Phase 12 (plan §13). The U-side PRESENTATION model for
 * duplicate term chips: a per-term view over workstream B's pure duplicate engine
 * (research-engine/searchBuilder/exactDuplicate.js).
 *
 * The engine classifies (classifyCrossGroupDuplicates):
 *  - EXACT cross-AND-group duplicates (conservative exactDuplicateKey) → the
 *    strong dark-red chip state; every affected chip is marked;
 *  - family "possible variant" (the old broad equivalence, DEMOTED) → a soft,
 *    non-blocking hint, never the dark-red exact styling;
 * and this module folds those entries — plus same-group exact duplicates (legacy
 * data only; insertion is prevented at every entry path) — into ONE
 * `byTermId` map the chip row renders from:
 *
 *   byTermId[termId] = {
 *     kind: 'exact-cross' | 'exact-in-group' | 'variant',
 *     id,                      // the warning id ('exactdup:<key>' / 'multi:<fam>')
 *     key,                     // exact key (exact kinds) or family key (variant)
 *     groupIds,                // sorted concept ids involved
 *     others: [{ conceptId, conceptLabel, termId, termText }],
 *     intentional: boolean,    // active "Keep both intentionally" override
 *     dismissed: boolean,      // persisted dismissal of this warning id
 *   }
 *
 * Precedence per term: exact-cross > exact-in-group > variant (one signal per
 * chip). Pure, deterministic, network-free.
 */
import {
  termDuplicateKey, classifyCrossGroupDuplicates, dupOverrideActive,
} from '../../research-engine/searchBuilder/exactDuplicate.js';
import { termEquivalenceKey } from '../../research-engine/searchBuilder/crossConcept.js';
import { liveTermsOf } from '../../research-engine/searchBuilder/termLiveness.js';

const asList = (v) => (Array.isArray(v) ? v : []);

/** The persisted dismissal id for an exact cross-group duplicate (engine format). */
export const exactDupDismissalId = (key) => `exactdup:${key}`;

export function buildDupModel({ concepts, dismissed } = {}) {
  const list = asList(concepts);
  const dismissedList = asList(dismissed).filter((s) => typeof s === 'string');
  const dismissedSet = new Set(dismissedList);
  const byTermId = {};

  // 1. EXACT cross-group duplicates (engine entries, suppressed ones included so
  //    the chip menu can still offer "no longer intentional" / context).
  const { exact, variants } = classifyCrossGroupDuplicates(list, { dismissed: dismissedList, includeSuppressed: true });
  for (const e of exact) {
    const intentional = dupOverrideActive(list, e.key, e.conceptIds);
    const wasDismissed = dismissedSet.has(e.id);
    for (const o of e.occurrences) {
      byTermId[o.termId] = {
        kind: 'exact-cross', id: e.id, key: e.key, groupIds: e.conceptIds,
        others: e.occurrences.filter((x) => x.termId !== o.termId),
        intentional, dismissed: wasDismissed,
      };
    }
  }

  // 2. Same-group EXACT duplicates (legacy data — insertion is prevented today).
  //    QA M18 — keys are type-aware: a MeSH heading + the same-label free-text
  //    term inside ONE group is the standard Phase-13 pattern, never dark-red.
  for (const c of list) {
    if (!c) continue;
    const byKey = new Map();
    for (const t of liveTermsOf(c)) {
      const key = termDuplicateKey(t);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(t);
    }
    for (const [key, terms] of byKey) {
      if (terms.length < 2) continue;
      for (const t of terms) {
        if (byTermId[t.id] && byTermId[t.id].kind === 'exact-cross') continue; // cross wins
        byTermId[t.id] = {
          kind: 'exact-in-group', id: `exactdupin:${c.id}:${key}`, key, groupIds: [c.id],
          others: terms.filter((x) => x.id !== t.id)
            .map((x) => ({ conceptId: c.id, conceptLabel: c.label || 'this group', termId: x.id, termText: x.text })),
          intentional: false, dismissed: false,
        };
      }
    }
  }

  // 3. Soft family variants — only for terms without an exact signal. The engine's
  //    variant occurrences come from crossConcept (no termId), so map per term by
  //    the family key directly.
  for (const v of variants) {
    const occ = [];
    for (const c of list) {
      if (!c) continue;
      for (const t of liveTermsOf(c)) {
        if (termEquivalenceKey(t.text) === v.equivKey) {
          occ.push({ conceptId: c.id, conceptLabel: c.label || 'another group', termId: t.id, termText: t.text });
        }
      }
    }
    const groupIds = [...new Set(occ.map((o) => o.conceptId))].sort();
    if (groupIds.length < 2) continue;
    for (const o of occ) {
      if (byTermId[o.termId]) continue; // exact signal wins
      byTermId[o.termId] = {
        kind: 'variant', id: v.id, key: v.equivKey, groupIds,
        others: occ.filter((x) => x.termId !== o.termId),
        intentional: false, dismissed: false,
      };
    }
  }

  return { byTermId };
}
