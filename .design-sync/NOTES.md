# design-sync NOTES — PecanRev

Repo-specific gotchas for `/design-sync`. Read this before any re-sync.

## This repo is OFF-ENVELOPE (app, not a packaged component library)
- It is a **Vite application**, not a publishable component library: `package.json` has no `main`/`module`/`exports`/`types`, `dist/` is a bundled SPA (`assets/index-*.js`), and there are **no `.d.ts`** files (JSX, not TS).
- Therefore the package-shape converter runs in effect as a **scoped synth-entry build**: `.design-sync/entry.jsx` re-exports only pure, presentational components, and the converter is pointed at it with `--entry ./.design-sync/entry.jsx`. This avoids synth-scanning the whole app (which would pull in react-router / contexts / api-client and break the bundle).
- **Styling is runtime-injected**, not a static stylesheet: `src/frontend/theme/tokens.js` `buildThemeCss()` emits the `--t-*` CSS variables (day default + night) and the `C` token object is `var(--t-*)` strings. There is no CSS file to scrape. We GENERATE `.design-sync/tokens.css` from `buildThemeCss()` and point `cfg.cssEntry` at it. Regenerate it whenever tokens.js changes (command below).
- Fonts (Inter / IBM Plex Sans+Mono) load from **Google Fonts** (remote `@import` at the top of `.design-sync/tokens.css`) — expect `[FONT_REMOTE]` (informational), not a shipped `@font-face`.

## Scoped component set (first pass)
`Button` (components/Button.jsx, default), `Icon` (components/icons.jsx, named `Icon`), `Tooltip` (components/Tooltip.jsx, default). All depend only on react / react-dom / theme/tokens.js. Expand `componentSrcMap` + `.design-sync/entry.jsx` together as more pure components are scoped in. Candidates to add next: `src/frontend/workspace/ui/primitives.jsx`, more of `components/` — but vet each for router/context/api imports first (those need `cfg.provider` or exclusion).

## Regenerate the tokens stylesheet
```
node --input-type=module -e "import('./src/frontend/theme/tokens.js').then(m=>{const f=\"@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');\n\";require('fs').writeFileSync('.design-sync/tokens.css', f+'\n'+m.buildThemeCss()+'\n');})"
```

## Resume / build commands (from repo root)
```
mkdir -p .ds-sync && cp -r "<skill-base-dir>"/package-build.mjs "<skill-base-dir>"/package-validate.mjs "<skill-base-dir>"/package-capture.mjs "<skill-base-dir>"/resync.mjs "<skill-base-dir>"/lib "<skill-base-dir>"/storybook .ds-sync/
echo '{"name":"ds-sync-deps","private":true}' > .ds-sync/package.json
(cd .ds-sync && npm i esbuild ts-morph @types/react)
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./.design-sync/entry.jsx --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
```
`--node-modules ./node_modules` = repo root (has react/react-dom). `--entry` is the scoped synth entry (NOT a dist file).

## DONE so far / DEFERRED
- DONE: Claude Design project created + pinned in config (`projectId` eb851df9-37ab-4972-bf5f-408dd2f08a03 — https://claude.ai/design/p/eb851df9-37ab-4972-bf5f-408dd2f08a03); tokens.css generated; scoped entry + config written.
- DONE: **converter build succeeds** — `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./.design-sync/entry.jsx --out ./ds-bundle` → exit 0, 3 components (Button/Icon/Tooltip) on window.PecanRev, 30 KB bundle, tokens.css copied, styles.css closure + _ds_sync.json written. (`--entry` to a SOURCE `.jsx` works — esbuild jsx handled it.)
  - Note: `[DTS_REACT]` warns @types/react not in the repo root `./node_modules` (it's a JSX app with no TS) → `<Name>.d.ts` prop bodies are empty/weak. Expected. To improve later: `npm i -D @types/react` at repo root (or add real prop types), then rebuild.
- DEFERRED (context budget — pick up here next session):
  1. **Render-check verification** — `node .ds-sync/package-validate.mjs ./ds-bundle`. Needs playwright + chromium (~200MB) — ASK the user before installing (skill §4.1); or `--no-render-check` with their sign-off.
  2. **Author + grade previews** for the 3 components → `.design-sync/previews/{Button,Icon,Tooltip}.tsx` (skill §4.2/4.3), rebuild, capture, grade `good`.
  3. **Conventions header** — author `.design-sync/conventions.md`, set `cfg.readmeHeader`, rebuild (base SKILL "Author the conventions header"). Content is well-known: PecanRev styles via the `C` token object (`var(--t-*)`), `FONT`/`MONO`, `alpha()`; day/night via `data-theme`; components take inline-style props, no utility classes.
  4. **Upload** — incremental path (project is empty): `finalize_plan` (localDir `./ds-bundle`) → push verified batch → close-out (sentinel → writes → reconcile deletes → `_ds_sync.json` last). Skill §3 / §5.
  - The project is currently EMPTY → un-anchored → safe; re-run resumes the incremental upload path with NO duplication (config is pinned).

## Re-sync risks
- `.design-sync/tokens.css` is GENERATED — if it's stale vs tokens.js, previews render with old colors. Regenerate (command above) on any tokens.js change.
- `--entry ./.design-sync/entry.jsx` is a non-standard (source, not dist) entry. If the converter rejects a source `--entry`, fall back to synth-entry mode (drop `--entry`) + tighten `componentSrcMap`, OR pre-bundle the entry with esbuild to a temp `.js` and point `--entry` at that.
- esbuild JSX: Button uses classic `import React`; Tooltip/icons rely on hooks/JSX without a React import — needs esbuild jsx=automatic. If a build error mentions `React is not defined`, that's the cause.
- Components import `../theme/tokens.js`; tokens.js is pure (no DOM at module top) so it bundles fine. `applyTheme`/`adoptServerTheme` touch `document`/`localStorage` but only inside functions — not executed at import.
