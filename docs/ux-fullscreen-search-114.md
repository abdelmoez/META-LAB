# 114 — True Fullscreen, Search Step Truth, Concepts Hierarchy (v4.19.0)

Round report for `.claude/Prompts/114.md` (three focused UX changes).

## 1. True workspace fullscreen (Focus Mode + Fullscreen API)

Focus Mode's layout behaviour is unchanged (rails unmounted, header swapped for the
focus bar, prev/next navigation intact). New: entering focus now also requests real
browser fullscreen, exiting releases it, and external exits sync back.

- `createFullscreenBridge(doc)` in `src/frontend/focus/FocusModeContext.jsx` — the
  single owner. Best-effort `documentElement.requestFullscreen()` (webkit-prefixed
  fallback; every rejection swallowed → graceful fallback to the existing
  viewport-only mode). `documentElement` is the target so route changes inside
  fullscreen never eject it.
- Ownership-tracked `fullscreenchange`: only OUR fullscreen ending flips focus off
  (a fullscreen video elsewhere is ignored); Escape may fire both our keydown and
  `fullscreenchange` — exits are idempotent.
- Reload with persisted focus: layout restores; fullscreen cannot be re-requested
  without a user gesture (documented, no hacks).
- Toggle copy mentions full screen honestly; testids/`aria-pressed` byte-stable.
- New `e2e/focus/fullscreen.spec.ts` (chromium-guarded): enter → fullscreenElement
  set + focus bar visible; Esc → both cleared; toggle-exit → both cleared.

## 2. "Build your search" — advisory ≠ failure (root cause)

The red state was `stageStatus.js` demoting a valid strategy to `'attention'`
(rendered danger-red by the stepper) whenever ≥1 vocabulary suggestion was pending —
true for nearly every real strategy — or any warning-severity QC finding existed.

- `computeStageModel(opts) → { statuses, advisories }`; `computeStageStatuses` keeps
  its exact legacy shape. `terms`: `empty` (no live term) → `attention` (CRITICAL
  finding only) → `done` otherwise. Pending suggestions + warning findings are now
  `advisories.terms = { suggestions, warnings, total }` — surfaced as a quiet count
  pill in the in-body stage rail (with aria text), never as step failure.
- The stepper needed no change: a valid strategy now reads `done` (green check,
  muted desc) in the existing design language; it returns to `empty`/`attention`
  live as the strategy changes, and persistence (rejectedSuggestions,
  dismissedWarnings) recomputes identically on reload.
- Legacy cleanup: dead `question`/`filters`/`hitState` args removed from the
  `computeStageStatuses` call site (retired-stage leftovers).
- New e2e guard pins: valid strategy + pending suggestion = Complete, never red.

## 3. Concepts workspace prominence (within the 110 constraints)

No colour changed — the 110 plane/card channel-delta e2e guards keep their margins.
Hierarchy comes from: breathing room (canvas margin 2/4 → 18/20px), a firmer frame
edge (`--t-brd` → `--t-brd2`), a 32px accent hairline under the workspace head
(not colour-only: spacing + border + type carry it), title 14.5 → 15.5px, and
padding polish. All byte-stable selectors (`sb-concept-board` opening tag, the
click-outside exemption selector, frame testids) untouched; expand/collapse,
click-outside, beginner mode, MeSH/Boolean behaviour, live query updates unchanged.

## Validation

test:ci 493 files / 9058 tests · lint clean · build 34/34 prerenders (CSP + one-h1
guards) · e2e focus + search workspace + responsive suites 101/101 vs live stack ·
both themes screenshot-verified.

## Known limitations

- Browser fullscreen cannot be restored after a reload (no user gesture) — focus
  layout restores, fullscreen requires one more click.
- The fullscreen e2e runs chromium-only (headless firefox/webkit fullscreen flake).
- iOS Safari has no element fullscreen — falls back to workspace-only mode.
