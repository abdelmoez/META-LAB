# 57.md — Stitch nav + stepper polish (implementation report)

A polish/consistency pass on the 56.md unified workspace: fix purple-menu hover
scoping, replace the legacy horizontal screening submenu with the white vertical
stepper in Stitch, give every workflow category a shared numbered vertical stepper,
keep step numbers always visible, and close remaining theme/typography gaps. Built
audit-first (parallel §7 theme audit → implement → adversarial review → fix). Legacy
theme, routes, permissions, project/engine data, autosave all preserved.

## Summary of changes (by goal)

| § | Change |
|---|--------|
| §1/§2 | Rail hover-expansion is scoped to the **rail element only** (`:has(.stitch-wsnav-rail:hover\|:focus-within)`), so hovering / scrolling / focusing the white submenu never expands the purple rail. Pinned still overrides; keyboard focus into the rail still expands it. |
| §2/§3 | The embedded engine's **horizontal screening submenu is removed in the Stitch theme** (legacy keeps it); navigation flows through the white vertical stepper via the existing `?screen=` param. A slim blind-mode chip remains when relevant; no leftover spacing. |
| §3/§4/§5 | One **shared `StitchWorkflowStepper`** now powers Plan & Protocol, Search, Screen, Extract, Analyze and Report white submenus — numbered stages, continuous connectors, progress state, contextual counts/helper text. |
| §3 | **Continuous connector lines**: each step pins its pip at a fixed vertical center and draws above/below segments (row-top→center, center→row-bottom), so the line never breaks across variable-height rows or step states. |
| §4 | The screening stepper (and all steppers) **always show the step number** — status is secondary (pip color + right-side status icon + connector color + accessible label), never replacing the number. |
| §6/§10 | The **main purple-rail stepper always shows the step number**; status moved to a corner badge (shape) + pip color. |
| §7 | Theme fixes: removed a stray `Georgia,serif` block (analysisTabs), `StitchProfile` monospace fields use `S.mono`. Verified the rest of the audit's flags were standard/intentional (movable white toggle thumbs, dark modal scrims, publication-white exports, identical IBM Plex Mono). |
| §8 | **"Recently updated" article font fixed**: native controls don't inherit `font-family`, so ad-hoc `<button>`s fell back to the UA serif font. A scoped reset (`.stitch-scope button/input/select/textarea { font-family: inherit }`) makes every Stitch native control inherit Manrope unless it sets its own font. |

## Navigation behavior changes (§1/§2)

`stitchTokens.js` `buildStitchCss`: the trigger moved from `.stitch-wsnav:hover` /
`:focus-within` (the group that contains BOTH the rail and the white submenu) to
`.stitch-wsnav:not([data-pinned="true"]):has(.stitch-wsnav-rail:hover)` and
`:has(.stitch-wsnav-rail:focus-within)`. The submenu is a sibling of `.stitch-wsnav-rail`
inside the group, so its hover/focus no longer matches. The label/group reveal +
overlay box-shadow rules track the same rail-scoped selector. State model:
**collapsed** (default) → **hoverExpanded** (rail hover/focus, overlay, no reflow) →
**pinnedExpanded** (persisted, reflows once). `:has()` is universally supported in
the app's modern-browser target (it already uses `color-mix`).

## Stepper architecture (§5)

- `nav/stepperModel.js` (pure) — `submenuSteps(category, ctx, {statusMap, screeningSteps})`
  turns a category's submenu (from the centralized `submenuForCategory`) into ordered,
  normalized step descriptors `{key, label, icon, href, num, status, count, desc, disabled}`.
  Phase categories: every item is a numbered step with status from `stepStatus()`.
  Screen: the import→final-review workflow items are numbered (live counts/status from
  `buildScreeningSteps`), Overview/Settings/Export/PRISMA are un-numbered utility rows.
- `shell/StitchWorkflowStepper.jsx` (new) — the ONE reusable component. Numbered pip
  (always the number), continuous connectors, secondary right-side status icon, count/
  helper text, disabled rows (reason in `aria-label`), `aria-current="step"`, keyboard
  buttons, light/dark tokens, reduced-motion-safe (no animation).
- `shell/StitchProjectSubnav.jsx` (rewritten) — a thin wrapper: build steps → render the
  shared stepper inside the contextual rail. All six categories share it.

## Screening submenu changes (§2/§3)

`SiftProject.jsx` embedded mode: `stitchActive = html[data-ui-design]==='stitch'`. When
active, the horizontal `<nav aria-label="Screening workflow">` (tabs + per-tab
StepIndicator) is not rendered; the white vertical stepper drives navigation (sets
`?screen=`, which the embedded engine already reads as the single source of truth). The
legacy theme renders the horizontal nav unchanged. Deep links, refresh, back/forward all
keep working. No duplicate navigation; no empty band.

## Theme-compliance fixes (§7)

The §7 audit surfaced mostly standard/intentional patterns (verified non-issues): white
toggle thumbs sit on a colored track (visible in both themes), dark modal scrims are
correct in light + dark, publication forest/PRISMA/traffic-light exports are intentionally
white, and `IBM Plex Mono` is byte-identical between the legacy and Stitch mono tokens.
Genuine fixes applied: removed `Georgia,serif` from an analysis narrative block (now
inherits the app sans), and `StitchProfile` email/value fields use `S.mono` (IBM Plex
Mono) instead of the generic UA monospace fallback.

## Files changed

New: `stitch/nav/stepperModel.js`, `stitch/shell/StitchWorkflowStepper.jsx`,
`tests/unit/{stitch57Stepper.test.js, stitch57Components.test.jsx}`, this report.
Modified: `stitch/theme/stitchTokens.js`, `stitch/shell/{StitchProjectSubnav, StitchProjectRail}.jsx`,
`screening/pages/SiftProject.jsx`, `workspace/tabs/analysisTabs.jsx`,
`stitch/pages/StitchProfile.jsx`.

## Accessibility (§9)

- Steppers are `<button>`s with `aria-current="step"`, `Step N: <label> — <status>` labels
  (disabled reason appended), keyboard-navigable, reduced-motion-safe.
- Status never relies on color alone: the number is always present; status is a shape
  glyph (corner badge on the rail; right-side icon in the submenu) + an sr-only label.
- Rail hover-expansion is reachable by keyboard (`:has(.stitch-wsnav-rail:focus-within)`).

## Tests / build / commands

- `npm run build` ✓ · `npx vitest run tests/unit tests/screening/unit` → **2450 pass**
  (+14 new, 0 regressions; baseline 2436).
- New unit tests: `submenuSteps` per category (numbering, screen utility rows, status
  mapping, disabled); shared-stepper SSR (numbers always render incl. done/disabled,
  `aria-current="step"`, disabled reason); rail SSR (six step numbers regardless of
  state); CSS (`:has` hover scoping present + old whole-group trigger gone; native-control
  font reset present).

## Remaining limitations (honest)

- Embedded engine BODY text remains the legacy Inter (vs the shell's Manrope) — both are
  clean geometric sans; a full inline-font override would require touching every engine
  component and risk regressions, so it is documented rather than forced.
- A few database-identity chip colors in the Search Builder are intentional brand colors
  (not Stitch tokens) — left as semantic identity colors.
- Playwright visual-regression of every stepper/hover state is scaffolded but the spec
  suite needs a running app + auth (out of scope here).
