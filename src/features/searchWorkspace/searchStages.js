/**
 * searchStages.js — the ONE pure, React-free source of truth for the Search
 * workflow's stage list (73.md P5 + 74.md + 75.md).
 *
 * This table used to live inside SearchWorkspace.jsx; 75.md moves the numbered
 * Search workflow into the WHITE project side-menu (navConfig → the shared
 * StitchWorkflowStepper) as well as the in-body workspace. Both surfaces now derive
 * their stage list from THIS module via `stagesFor(searchMode)`, so the side-menu
 * stepper and the workspace body can never drift apart. Because it is pure data +
 * pure functions (no React, no DOM), the nav layer (navConfig.js) can import it
 * without pulling in the heavy Search Builder / Pecan engine dependency graph.
 *
 * `num` drives the always-numbered pip; `builder`/`phase` mark the stages that render
 * the (persistent) Search Builder; `needsConcepts` marks stages that are only
 * meaningful once a strategy exists (disabled-with-reason until then); `manualOnly`
 * marks stages that belong to the manual workflow and are REMOVED from the rail in
 * automated mode (74.md — the run surface owns sources/overrides there).
 */
export const STAGES = [
  { id: 'question',      num: 1, label: 'Research Question',   desc: 'Frame the question' },
  { id: 'concepts',      num: 2, label: 'Concepts',            desc: 'Core concepts',         builder: true, phase: 'concepts' },
  { id: 'terms',         num: 3, label: 'Terms & Vocabulary',  desc: 'Synonyms & MeSH',       builder: true, phase: 'terms' },
  { id: 'mode',          num: 4, label: 'Search Mode',         desc: 'Manual or automated' },
  { id: 'strategy',      num: 5, label: 'Database Strategies', desc: 'Per-database syntax',   builder: true, phase: 'build', manualOnly: true },
  { id: 'refine',        num: 6, label: 'Test & Refine',       desc: 'Counts & quality' },
  { id: 'results',       num: 7, label: 'Run Externally',      desc: 'Your database accounts', needsConcepts: true },
  { id: 'documentation', num: 8, label: 'Documentation',       desc: 'Methods & PRISMA-S' },
  { id: 'screening',     num: 9, label: 'Send to Screening',   desc: 'Prepare the import',    needsConcepts: true },
];

/* 73.md P5 + 74.md — THE single source of truth for the visible workflow. Automated
   mode removes the manual-only stages entirely (never a mixed rail) and renumbers the
   pips; the Results stage is mode-aware: automated runs inside PecanRev, manual (or
   not-yet-chosen) runs in the user's own database accounts. Pure + exported. */
export function stagesFor(searchMode) {
  const automated = searchMode === 'automated';
  return STAGES
    .filter((s) => !(automated && s.manualOnly))
    .map((s, i) => {
      const out = { ...s, num: i + 1 };
      if (s.id === 'results' && automated) {
        out.label = 'Automated Search';
        out.desc = 'Run & deduplicate';
      }
      return out;
    });
}

/* 75.md recs (Finding 3) — reconcile the URL `?stage=` against the body's current
   stage + the active mode. Returns TWO independent instructions:
     · `apply`   — the stage to adopt locally (null when the body is already there);
     · `syncUrl` — the stage to push back into the URL (null when the URL already
                   matches the resolved target).
   Splitting them lets the reconcile effect BOTH land the body on the nearest surviving
   stage for a non-surviving deep link (e.g. `?stage=strategy` on an automated project →
   'refine') AND normalize the URL to that same stage — so the white side-menu highlight,
   deep links and browser back/forward all resolve consistently. `syncUrl` is gated to
   the case the URL genuinely differs from the target, which is what makes this
   loop-safe: once the URL equals a surviving stage, `stageAfterModeChange` is the
   identity, so nothing is pushed again. Pure + exported for unit tests. */
export function reconcileStageUrl(urlStage, searchMode, currentStage) {
  if (!urlStage) return { apply: null, syncUrl: null };
  const target = stageAfterModeChange(urlStage, searchMode);
  return {
    apply: target !== currentStage ? target : null,
    syncUrl: target !== urlStage ? target : null,
  };
}

/* 74.md — where to land when a mode switch removes the active stage. Stays put when
   the stage survives; otherwise walks FORWARD through the master order to the nearest
   surviving stage (Database Strategies → Test & Refine), then backward, then home.
   Pure + exported. */
export function stageAfterModeChange(currentStageId, searchMode) {
  const next = stagesFor(searchMode);
  if (next.some((s) => s.id === currentStageId)) return currentStageId;
  const order = STAGES.map((s) => s.id);
  const idx = order.indexOf(currentStageId);
  if (idx === -1) return 'question';
  for (let i = idx + 1; i < order.length; i++) {
    if (next.some((s) => s.id === order[i])) return order[i];
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (next.some((s) => s.id === order[i])) return order[i];
  }
  return 'question';
}
