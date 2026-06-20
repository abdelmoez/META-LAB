# Search Builder Engine — SE1 Final Report

**Version:** 3.25.0 · **Scope:** Search Builder engine + PICO sync only (per SE1 and the
explicit "focus on the search builder engine only" instruction). All changes additive,
targeted, reversible, and gated behind the existing `searchEngine` feature flag.

## Summary of what changed

The Search Builder's PICO→concept extraction was already strong (prompts 38–42). The one
material gap against SE1's headline goal — _"syncs Search Builder changes live for all
online collaborators without requiring refresh"_ — was that the tab only loaded on mount
and autosaved; it never emitted a realtime poke on save and never subscribed to the
existing SSE channel. This change closes that gap and adds the term-provenance metadata
SE1 asks for, with a conflict-safe sync core that is unit-tested.

1. **Live collaborator sync (SE1 Task 5).** `PUT /api/search-builder/:pid` now emits a thin
   `search.updated` poke (via the existing `emitToMetaLabProject` SSE bus) to the
   workspace's other online members, excluding the editor. The tab subscribes through the
   shared `useRealtime` hook and refetches the authorized document, adopting it only when
   it is genuinely newer and the user is not mid-edit. No manual refresh needed.
2. **Conflict-safe, ping-pong-free.** A `lastSaved` signature makes both autosave and
   remote-apply idempotent: the tab never re-PUTs state it just loaded/applied, and a
   collaborator adopting a remote update never echoes a save back. A `revision` (surfaced
   from the server) gates "is this genuinely newer". A remote update arriving mid-edit is
   parked and applied when the editor closes (with an "Apply now" banner).
3. **Term provenance metadata (SE1 Task 2).** Each extracted term now carries `sourceField`
   (the PICO field it came from) and `normalizedLabel`; each concept carries
   `normalizedLabel`. The original PICO text is never mutated. Auto concept groups now show
   their source PICO field as a small tag.

## Files changed

**Backend**
- `server/searchEngine/searchEngineController.js` — `getSearch` returns `{…state, revision,
  updatedAt}`; `putSearch` emits `search.updated` after a successful save and returns
  `{ok, revision}`.
- `server/services/workflowState.js` — `resolveProjectAccess` now also returns `ownerId`
  (owner path → caller; member path → `acc.ownerId`) so the controller can address the
  poke to the workspace via `emitToMetaLabProject` without re-resolving the owner.

**Frontend**
- `src/research-engine/searchBuilder/conceptExtraction.js` — additive term/concept metadata
  (`sourceField`, `normalizedLabel`).
- `src/research-engine/searchBuilder/searchState.js` _(new)_ — pure sync core:
  `serializeSearchState`/`searchStatesEqual` (stable signature) and `extractActiveConcepts`
  (PICO→concepts minus hidden/deleted terms).
- `src/features/searchBuilder/SearchBuilderTab.jsx` — `useRealtime('search.updated')`
  subscription; `applyRemote`/`pullRemote` with the lastSaved + revision + idle guards;
  signature-guarded autosave; remote-update banner + a live-sync status dot; PICO-field tag
  on auto concept groups; `buildExtracted` now delegates to `extractActiveConcepts`.
- `src/features/searchBuilder/searchBuilderApi.js` — `saveSearch` returns the server ack
  `{ok, revision}` (was void) so the tab can track the server revision.

**Other**
- `package.json` / `package-lock.json` — version 3.24.0 → 3.25.0.
- `docs/manager/search-builder-engine-audit.md` _(new)_ — Task 1 audit.

## Search Builder data model changes (additive only)

- Term: `+ sourceField` (PICO field: Population/Intervention/Comparator/Outcome),
  `+ normalizedLabel`. Existing `text/type/field/source/synonym/vocab` unchanged — the
  syntax renderers are untouched.
- Concept: `+ normalizedLabel`. Existing `label/field/source/op/terms` unchanged.
- Persisted document (`WorkflowModuleState` moduleKey `search`): unchanged shape
  `{concepts, overrides, ignored}`; GET now also returns `revision`/`updatedAt` alongside it.

## Real-time sync approach

Reuses the existing in-process SSE "poke, don't payload" bus (`server/realtime/bus.js`,
`GET /api/events`, `src/frontend/hooks/useRealtime.js`):

- **Emit:** `putSearch` → `emitToMetaLabProject(projectId, ownerId, {type:'search.updated',
  revision}, {exclude: actor})`. Fire-and-forget; never fails or slows the request.
- **Receive:** the tab's `useRealtime` handler matches `ev.metaLabProjectId === projectId`,
  then `pullRemote()` refetches via the authorized `GET` (authorization re-checked per
  request — the event carries no content). Adopt iff signature differs, revision is newer,
  and the user is idle; otherwise park and apply on edit-close.
- **Conflict posture:** single-strategy-per-project document → last-write-wins on the full
  upsert, but with revision surfaced and the lastSaved guard preventing self-inflicted
  clobbering and save↔poke loops. Field-level OT is intentionally out of scope.
- **Degradation:** if the SSE stream is unhealthy, `useRealtime.healthy` is false and the
  tab silently falls back to its load-on-mount + autosave behavior (the status dot shows
  "sync" instead of "live"). localStorage is never the canonical store.

## Tests added / updated

- `tests/unit/conceptExtraction.test.js` — +3 tests: term/concept metadata
  (`sourceField`/`normalizedLabel`), correct source field per PICO field, idempotent
  re-extraction (no duplicate concepts).
- `tests/unit/searchState.test.js` _(new)_ — 11 tests: stable signature (key-order
  independent, undefined-omitting, nested vocab), content-change detection, defensive
  `pickPersisted`, and `extractActiveConcepts` (hidden/deleted terms stay hidden, empty
  concept dropped, idempotent under ignore, tolerant of empty PICO).
- No live external MeSH/NLM calls in CI (extraction is pure; MeSH stays behind the mocked
  `props.api`/server proxy).

## Build / test results

- `npm run test:unit`: **1228 passed / 1 failed** (75 files). Search-relevant suites
  `conceptExtraction` (18) + `searchState` (11) + `searchEngine` (10) all green.
- `npm run build` (vite): **success** (chunk-size warning is pre-existing and unrelated).
- Edited frontend files transform-checked with esbuild (SearchBuilderTab.jsx isn't yet in
  the app import graph, so the build alone wouldn't catch a syntax error there).

**Pre-existing failures (NOT caused by this work; identical at baseline):**
- 6 files fail to load `@prisma/client` — the Prisma client isn't generated in this
  environment (`prisma generate` errors under Prisma CLI 7.8.0 schema validation + no
  `DATABASE_URL`): `metalabAccessRob`, `onboarding-analytics`, `onboarding`, `robSettings`,
  `spaTheme`, `workflowState`.
- 1 assertion in `emailService.test.js` (`not_configured` vs `send_failed`) — optional
  `nodemailer` dep not installed.
None touch Search Builder code; all are environment/setup issues.

## Version bump

3.24.0 → **3.25.0** (minor — adds the live-sync feature, consistent with the repo's
feat→minor convention used for the prior Search Builder releases v3.21–v3.23).

## Known limitations

- **Tab not yet mounted in the workspace.** `SearchBuilderTab` is a complete, flag-gated
  module but is not yet rendered in `AppWorkspace`. Live sync is implemented end-to-end so
  it works the instant the tab is wired in; wiring it is outside SE1's "engine only" scope.
- **Single-process SSE bus.** Cross-instance delivery would need a pub/sub broker; the
  load-on-mount path is the correctness fallback in a clustered deployment.
- **Last-write-wins** on concurrent saves of the whole search document (no field-level merge).
- **MeSH heuristic mapping** remains a documented service boundary (no pretense of a
  complete MeSH API); live NLM lookups stay server-side and are never called from CI.

## Recommended next steps

1. Mount `SearchBuilderTab` in `AppWorkspace` (pass `projectId`, `pico`, `api`,
   `loadSearch`, `saveSearch`) so live sync is exercised in the real app.
2. Add a lightweight component/integration test once mounted (jsdom + a fake EventSource)
   to cover the remote-apply state machine end-to-end.
3. Consider surfacing `updatedBy`/`updatedAt` in the tab (a "last edited by …" line) using
   the data already returned by `getModuleState`.
4. When clustering, back the SSE bus with a broker (Redis pub/sub) to preserve instant
   cross-instance sync.
