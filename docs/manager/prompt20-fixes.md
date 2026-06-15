# Prompt20 — Screening routing, header, chat, forest plot, Ops user editing & world map

[FROM: Lead (Opus)] [TO: Team] [TOPIC: focused repair + polish pass, v3.2.0]

Six targeted fixes after the prompt19 screening/ops work. No redesign — root-cause
repairs, plus two real feature builds (full Ops user editing + a real world map).

## Task 1 — Screening submenu now actually renders (root cause + fix)
**Root cause:** the embedded Screening stage (`SiftProject embedded`) READ its active
sub-tab from local state `embTab`, but `setTab` only wrote `?tab=` to the host URL and
never updated `embTab`. So clicking a sub-tab changed the URL while the page never
re-rendered — and `?tab=duplicates` collided with the META·LAB monolith's own stage
param, which is why a refresh sometimes showed nothing.
**Fix (`SiftProject.jsx`):** the embedded sub-nav now uses a dedicated, collision-free
`?screen=` param and READS the active tab back from it (URL = single source of truth).
Clicking updates both the URL and the page; deep-links, refresh and browser back/forward
all follow the URL. Default (`?screen` absent) = Overview. Standalone `/sift-beta` keeps
`?tab=` unchanged.
**Stage round-trip (`meta-lab-3-patched.jsx` + `AppWorkspace.jsx`):** added a one-way
`tab → ?tab=` sync (new `onTabChange` prop, mirrors the existing `onProjectChange`) so a
refresh reopens the same stage (incl. Screening); leaving Screening clears `?screen=`.
Auto-create/repair of the engine was already handled by `EmbeddedScreening`.

## Task 2 — Header overlap
The full-bleed Screening top bar's right nav (`Project overview` / `Projects`,
`marginLeft:auto`) sat under the fixed top-right cluster (`[chat@96][bell@56][account@16]`,
~16–126px from the right edge). Reserved `marginRight:134` on that group so the buttons
never collide, in either focus state. Breadcrumb keeps `min-width:0` + ellipsis.

## Task 3 — Chat title = project name
`MetaLabChatLauncher` (and the standalone `ChatLauncher`) now receive `projectName` and
pass it as the `ChatDrawer` title (falls back to "Project chat" while loading). The drawer
already truncates + tooltips the title and flex-shrinks the close button, so long names
never overlap controls. Chat stays scoped per project via `key={metaLabProjectId}`.

## Task 4 — Forest plot SMD vs favours labels
The centered effect-measure label (e.g. "SMD") and the `← favours / favours →` labels
shared one y, so they overlapped near the null line. Split onto separate rows
(`yAxisTicks → yFavours → yEsLabel → yHetero`) with clear spacing; fits the existing
height. Live + export render from the same component, so both improve; the separate
"Light (publication)" builder is untouched. Theme + precision preserved.

## Task 5 — Ops user editing (all safe fields, schema-driven)
New shared single-source schema `src/shared/editableUserFields.js` (imported by BOTH the
server and the Ops UI). Admin-editable: name, email, theme, registration country
code/name; mods get name/email/theme only. Role + account status keep their dedicated,
confirmation-gated controls (last-admin / never-suspend-admin protections intact).
- Server `updateUser` is now allowlist-only via `buildUserUpdate` — password, hashes,
  tokens, ids, and the dedicated fields can NEVER reach the Prisma patch. Audited as
  `USER_UPDATED_BY_ADMIN` (changed keys + before/after, no secrets). `getUserById`
  returns the editable fields but never a secret.
- **Password reset flow unchanged** (no manual password editing was added).
- UI: the detail panel renders the form from the schema (text/select inputs), validates
  with the same rules, saves only the diff, toasts, and refreshes the table.

## Task 6 — Real Ops world map
Replaced the centroid-dot SVG with a real country choropleth. `scripts/gen-worldgeo.mjs`
pre-projects Natural Earth 1:110m polygons (public domain) into a fixed equirectangular
1000×500 viewBox → `src/frontend/pages/admin/worldGeo.js` (177 countries, ISO alpha-2
keyed). **No new runtime dependency.** Countries have light-gray borders; fills scale with
each country's user share toward the app accent (`alpha()` color-mix → re-themes live,
day + night); no users → light neutral. Users tab → **Map / Countries Table** sub-tabs;
hover tooltip (name, users, %); click cross-highlights the table. Join is on uppercase
ISO-2 (both sides), so codes never silently mismatch; Unknown/local users stay in the
table, never on the map. The existing admin-only `/api/admin/users/countries` endpoint
already returned the right shape — frontend-only change.

## Tests
- `tests/unit/editableUserFields.test.js` (7) — allowlist enforcement, sensitive-field
  rejection, admin vs mod field sets, validation.
- `tests/unit/worldGeo.test.js` (5) — geometry integrity (count, ISO codes, paths, size).
- `tests/integration/prompt20-user-edit.test.js` (6, live server) — edit round-trip,
  password/role/suspended ignored (original password still works), invalid input rejected,
  audit entry, 401/403, secrets never exposed.
- Regression: full unit suite 665 pass / 6 pre-existing `serverStorage` timing fails;
  prompt7 + prompt4 + prompt19-countries + api-permission-invariants → 34/34 pass against
  the live server. `vite build` green.

## Follow-ups (done in the same release)
- **Header safe-zone (general):** a `@media (max-width:1480px)` rule reserves right padding
  on `.tab-content` so the non-screening project-header action buttons clear the fixed
  cluster at all laptop widths (above ~1480px the centered 960 column already clears it).
- **Stage follows URL:** the monolith now re-syncs its active stage when the host `?tab=`
  changes after mount (functional update, no loop), so browser back/forward + external
  deep-links move between stages. In-app switches stay `replace` → no back-button spam.
- **World map → 50m:** `scripts/gen-worldgeo.mjs` now pulls Natural Earth 1:50m and
  Douglas-Peucker–simplifies the big coastlines (small nations preserved via a fallback) →
  240 countries incl. Singapore/Hong Kong/Malta/Bahrain/Maldives, ~266KB (vs ~1.1MB raw).

## Known limitations
- The monolith stays a fixed-256px-sidebar desktop layout; true phone widths are out of
  scope. Genuinely sub-pixel atolls still appear only in the Countries Table.
