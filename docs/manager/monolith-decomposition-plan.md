# Monolith Decomposition Plan (prompt38, Phase 7)

## Strategy: strangler-fig (never a big-bang rewrite)
Keep `meta-lab-3-patched.jsx` as the entry shell; extract one concern at a time
into `src/features/*`, import it back, verify behavior, repeat. The monolith
shrinks progressively and eventually becomes a thin shell (or is retired).

## Extraction rules
1. One feature per folder with a public `index.js`; no deep cross-feature imports.
2. Move **pure** code first (constants, mappers, stats) — zero behavior risk.
3. Components that depend on monolith internals (`C`, `inp`, `updNested`, locks)
   get a clean port that uses **shared** primitives (`frontend/theme`,
   `components/`) instead of monolith-private ones.
4. Gate UI swaps behind a flag during transition (legacy + new coexist).
5. Keep the research engine React-free.
6. Test after each extraction (build + unit + the relevant integration).

## What this phase extracted (the first cut)
- `TIMEFRAME_OPTIONS` + `timeframeComplete` → `features/protocol/constants.js`
  (literal move, re-imported into the monolith; identical behavior).
- The **Protocol concern** now has a real home: `features/protocol/`
  (panel + hook + pure state mappers + constants). The monolith **delegates** the
  PICO tab to it behind the `serverBackedWorkflowState` flag (`PICODispatcher`).

## Suggested extraction order (sequencing, no timelines)
| Step | Target | Risk | Notes |
|---|---|---|---|
| 1 | Pure utilities/constants (`ES_TYPES`, label maps, `PHASE_ICON`) | low | literal moves into `lib`/feature constants |
| 2 | Shared UI primitives (`SwitchToggle`, `SectionHeader`, `InfoBox`, `AIButton`, `ProgressBar`) | low–med | port to shared `components/` using shared tokens; re-import |
| 3 | Project shell (header, workflow menu, tab registry, nav/stepper) | med | the App-shell wiring; careful with state ownership |
| 4 | Protocol/PICO (finish: port AI + field-locks into the module) | med | builds on this phase |
| 5 | Search / MeSH builders | med | self-contained-ish |
| 6 | Data Extraction (`StudyCard`, `ExtractionTab`, calculators) | med–high | large; pair with `ReviewStudy` structured store |
| 7 | Analysis (`AnalysisTab`, sensitivity, subgroup, plots) | high | guard the stats engine parity |
| 8 | RoB (already native; remove `LegacyRoBTab`) | low–med | flag-gated already |
| 9 | GRADE / PRISMA / Reports | med | |
| 10 | Project Control | med | members/settings |
| 11 | Legacy localStorage/blob adapter | med | once readers migrated |

## Target end-state
`meta-lab-3-patched.jsx` → a thin `ProjectShell` that composes feature modules, or
removed entirely (Wave 5). Each feature independently testable and ownable.
