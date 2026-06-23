# P1 Audit — Feature Flags & Ops/Admin Console

Scope: how feature flags and the Ops/Admin Console work, so P1 ("Pecan Search Engine")
can add (a) a new global flag + per-provider flags, and (b) a new Ops "Search Providers" tab.

All paths relative to repo root `H:/META-LAB/META-LAB`.

---

## 1. The SiteSetting model (single store for all flags + settings)

`server/prisma/schema.prisma:353-358`
```prisma
model SiteSetting {
  key       String   @id          // e.g. "featureFlags", "appSettings", "themeSettings"
  value     String   // JSON-serialised value
  updatedAt DateTime @updatedAt
  updatedBy String?  // admin userId who last changed this
}
```
- **One row per settings KEY**, value is a JSON string. Feature flags are a SINGLE row `key='featureFlags'` whose value is a flat object of `{ flagName: boolean }`.
- Mirrored generated copies exist at `server/prisma/generated/{postgres-client,...}/schema.prisma` and `server/prisma/postgres/schema.prisma` — keep in sync if you add a model, but **P1 needs NO schema change for flags** (it reuses the existing `featureFlags` row + can add a new key for provider config, exactly like `aiScreeningSettings`/`robSettings`/`themeSettings`).

Audit model: `server/prisma/schema.prisma:360-371` `AdminAuditLog { id, adminId, action, entityType, entityId, details(JSON str), ip, userAgent, createdAt }`.

---

## 2. Server-side flag defaults + merge (the source of truth)

### `server/controllers/settingsController.js`
- `DEFAULTS` const (L6-98): default JSON for every SiteSetting key. **`DEFAULTS.featureFlags`** is at **L44-82** — the flat flag object. Current flags: `autosave, contactForm, projectDuplication, advancedMetaAnalysis, exportTools, relationalProjectStore, rob_engine_v2, serverBackedWorkflowState, searchEngine, aiScreening, betaWaitlist` (all default `false` except the first five).
- `DEFAULTS.aiScreeningSettings` (L85-97) — **the precedent for a per-engine config block** (its own SiteSetting key, flat object, merged server-side with a defaults const). Copy this shape for per-provider P1 config.
- **`export function defaultFeatureFlags()`** (L108-110): `JSON.parse(DEFAULTS.featureFlags)`. Exported so admin + public endpoints MERGE defaults under the stored row (newly-added flags surface even though `initDefaultSettings` never overwrites an existing row).
- **`export async function initDefaultSettings()`** (L117-126): startup upsert; `update:{}` so it NEVER overwrites existing rows. Called from `server/index.js` (non-blocking). Adding a flag to `DEFAULTS.featureFlags` does NOT rewrite the existing row — the merge in the GET endpoints is what makes a new flag visible.
- **`export async function getPublicSettings(req,res)`** (L132-192): `GET /api/settings/public`, **no auth**. Returns `appSettings, landingContent, featureFlags, onboardingSettings, robSettings, themeSettings`. Key line **L179**: `result.featureFlags = { ...defaultFeatureFlags(), ...(result.featureFlags||{}) }` — stored wins, defaults backfill. **This is the public read seam every frontend flag-gate uses.**

### `server/controllers/adminController.js`
- `SETTING_KEYS = ['appSettings','landingContent','featureFlags']` (L1387) — used by the generic `getAdminSettings`/`updateAdminSettings`. Flags ALSO have dedicated endpoints (below).
- `upsertSetting(key, value, adminId)` (L1402-1408): the canonical write — `prisma.siteSetting.upsert` setting `value: JSON.stringify(value), updatedBy: adminId`.
- **`getFeatureFlags(req,res)`** (L1488-1503): `GET /api/admin/feature-flags`. Reads row, merges `{ ...defaultFeatureFlags(), ...stored }` (L1498). Admin-only.
- **`updateFeatureFlags(req,res)`** (L1507-1518): `PUT /api/admin/feature-flags`. `upsertSetting('featureFlags', body, req.user.id)` then **`logAdminAction(req,'UPDATE_SETTING','SiteSetting','featureFlags',{updatedKeys:['featureFlags']})`** (L1511), returns the stored row. NOTE: body REPLACES the whole flag object (client sends the full merged object back).
- Theme is the model for "validated + audited PATCH of a settings key": `getAdminThemeSettings` (L1524), `updateThemeSettings` (L1538-1564) — validates via `validateThemePatch`, reads `before` for audit, audits `'APP_THEME_UPDATED'`, busts a cache. Copy this if P1 provider config needs validation + its own audit action.

### Audit utility
`server/utils/audit.js:13` — `export async function logAdminAction(req, action, entityType, entityId, details)`. Never throws. `details` is `JSON.stringify`-ed. This is the ONLY audit call you need.

---

## 3. Routes — `server/routes/admin.js`

- Router-level: `adminLimiter` rate-limit (L116) applied to all; `requireAuth` applied at the mount in `server/index.js`; **authorization is PER ROUTE** via `requireAdmin` / `requireAdminOrMod` (imported L3-4).
- Flag routes (L199-200):
  ```js
  router.get('/feature-flags', requireAdmin, getFeatureFlags);
  router.put('/feature-flags', requireAdmin, updateFeatureFlags);
  ```
- **Pattern for a new admin settings sub-resource** (e.g. AI Screening, L234-237; RoB, L256-258):
  ```js
  router.get('/ai-screening/settings', requireAdmin, getAiScreeningSettings);
  router.put('/ai-screening/settings', requireAdmin, updateAiScreeningSettings);
  router.get('/ai-screening/runs',     requireAdmin, getAiRunLogs);
  ```
  Controllers imported at top of `admin.js` from their own controller file (`server/controllers/screeningAiAdminController.js`). **For P1: add `server/controllers/searchProvidersAdminController.js` exporting `getSearchProviderSettings`/`updateSearchProviderSettings` (+ optional metrics), import them, and register `router.get/put('/search-providers/settings', requireAdmin, ...)`.** Declare any STATIC sub-paths BEFORE `:id` routes (comments throughout warn about route shadowing).

### `getConsole` (section gating) — `server/controllers/adminController.js:2429`
```js
export async function getConsole(req,res){
  const role = req.user?.role || 'user';
  const sections = role === 'admin'
    ? ['overview','users','projects','sift','rob','waitlist','onboarding','content','settings','style','flags','messages','security','health']
    : role === 'mod' ? ['users','messages'] : [];
  return res.json({ role, sections, emailConfigured, email });
}
```
**This hardcoded array is the server source of truth for which Ops nav sections a role sees.** To add a new top-level Ops tab `'searchProviders'` you MUST add its id to the admin array here (otherwise the frontend hides it even for admins, because the frontend filters nav by this descriptor).

---

## 4. Frontend Admin Console — `src/frontend/pages/admin/AdminConsole.jsx` (~7660 lines)

### Tab registry + gating
- **`NAV_SECTIONS`** (L7467-7482): array of `{ id, icon, label }` driving the sidebar. (Has a `style`/`flags`/etc. entry; note `flags` id maps to `<FlagsSection/>`.)
- `MOD_SECTIONS = ['users','messages']` (L7488); `roleSections = r => r==='admin' ? NAV_SECTIONS.map(s=>s.id) : MOD_SECTIONS` (L7489) — **bootstrap/fallback ONLY; server `getConsole` is authoritative**.
- `AdminConsole()` (L7491): fetches `adminApi.console()` → `setAllowed(new Set(d.sections))` (L7508-7526). The `sections` object map (L7538-7555) wires each id → component, e.g. `flags: <FlagsSection/>`, `sift: <SiftAdminSection/>`. `visibleNav = NAV_SECTIONS.filter(s => allowed.has(s.id))` (L7568). `renderActive()` (L7562) shows `<AccessDenied/>` if not allowed.

**To add an Ops "Search Providers" tab (frontend side):**
1. Add `{ id:'searchProviders', icon:'<iconName>', label:'Search Providers' }` to `NAV_SECTIONS` (L7467).
2. Add `searchProviders: <SearchProvidersSection/>` to the `sections` object (L7538).
3. Add the new section component (model it on `SiftAdminSection`/`AiScreeningSection`).
4. Server: add `'searchProviders'` to the admin array in `getConsole` (§3). (Server gating + UI nav both required.)

### Feature-flag UI
- **`FLAG_META`** (L4767-4778): array of `{ key, label, desc }` — the catalogue of toggles shown. **Adding a flag REQUIRES a new entry here** or it won't render in Ops (the GET merge surfaces it to the API but the UI iterates FLAG_META).
- **`FlagsSection()`** (L4780-4812): `adminApi.featureFlags.get()` → local `flags` state → renders a `<Toggle>` per `FLAG_META` entry (L4799-4807) → `adminApi.featureFlags.save(flags)` on save (sends the WHOLE object back). Uses shared `Toggle`, `SectionCard`, `SaveButton`, `Spinner`.

### Sub-tabbed section precedent (for "Search Providers" with its own sub-tabs)
- **`SIFT_TABS`** (L5317-5325): `[{id,label}...]` (overview/projects/members/settings/aiPolicy/handoff/audit). `SiftAdminSection()` (L6043) renders a sub-tab bar (L6070, `SIFT_TABS.map`) and switches body by active sub-tab. `AiScreeningSection()` (L4841) is the "AI Policy" sub-tab — loads `adminApi.aiScreening.getSettings()`, edits a settings object, saves, and shows recent audit via `adminApi.auditLog({action:'UPDATE_AI_SCREENING', limit:15})`. **This is the closest template for a provider-config section that lists providers, toggles per-provider flags, and shows audit history.**
- Other tab-bar precedents: `CONTENT_TABS` (L3969) + `ContentSection` (L3980); `PROJECT_SUBTABS` (L3479).

### Admin API client — `src/frontend/pages/admin/adminApiClient.js`
- `req(url,opts)` (L14-24): fetch w/ `credentials:'include'`, throws Error w/ `.status` on !ok. `json(body)` helper (L26-29). `qs(params)` (L32-39).
- `export const adminApi` (L41): namespaced methods. Relevant:
  - `console: () => req('/api/admin/console')` (L54)
  - `featureFlags: { get: ()=>req(`${BASE}/feature-flags`), save:(body)=>req(`${BASE}/feature-flags`,{method:'PUT',...json(body)}) }` (L116-118)
  - `aiScreening: { getSettings, saveSettings(PUT), ...runs }` (L151-) — **copy this block** to add `searchProviders: { getSettings, saveSettings }`.
  - `auditLog: (p)=>req(`${BASE}/audit-log?...`)` (L212) — for showing provider-config change history.
  - `BASE='/api/admin'`, `PUB='/api/settings'` (L11-12).

---

## 5. Frontend READ seam — how flags gate UI (CRITICAL for P1)

Two consumption patterns; P1 will use both:

1. **Public settings fetch** (`GET /api/settings/public`) → `data.featureFlags.<flag>`. Concrete example: `src/features/searchBuilder/searchBuilderApi.js:59` `searchEngineFlagEnabled()` fetches `/api/settings/public` and returns `!!d.featureFlags.searchEngine`. The monolith dispatcher `SearchDispatcher()` (`src/frontend/workspace/tabs/protocolTabs.jsx:252`) uses this to swap legacy vs new tab.
2. **Server-side gate** inside the feature's own controller: `server/searchEngine/searchEngineController.js:57` `async function searchEngineEnabled()` reads `prisma.siteSetting.findUnique({where:{key:'featureFlags'}})` and checks `JSON.parse(value).searchEngine===true`; every endpoint 404s when off (L70, L82, L94, and project gate L107). **P1 endpoints MUST do the same: 404/no-op when the global P1 flag is off, and additionally check the relevant per-provider flag before calling that provider.**

There is no central `useFeatureFlag` hook — flags are read ad hoc via `/api/settings/public`. A general public-settings context exists in `AuthContext.jsx`/`ThemeContext.jsx` (graphify community 390/471) but flag gating is done per-feature as above.

---

## 6. Stitch (parallel Ops UI) — MUST be kept in sync

`src/frontend/stitch/pages/StitchOpsConsole.jsx` is a **parallel presentation of the legacy AdminConsole** (admin-only Stitch design layer, v3.48.0). It has its **OWN `FLAG_META`** (L38-52) that "mirrors AdminConsole.jsx FLAG_META verbatim", and its own Feature Flags tab calling the same `adminApi.featureFlags.get/save`. Out-of-scope sections deep-link to `/ops?ui=legacy`.
- **If P1 adds a flag to `FLAG_META`, also add it to `StitchOpsConsole.jsx` FLAG_META (L38-52)** or the Stitch flags tab will silently omit it.
- A full "Search Providers" tab in Stitch is OPTIONAL — Stitch can deep-link to the legacy console for deep tools (precedent: PICO/search/screening tools fall back to legacy in the Stitch design layer). Minimum viable parity = sync FLAG_META.

---

## 7. EXACT recipe — (a) add P1 global flag + per-provider flags

1. `settingsController.js` `DEFAULTS.featureFlags` (L44-82): add `pecanSearch: false,` (global P1) and per-provider booleans e.g. `pecanSearchPubmed: false, pecanSearchEuropePmc: false, pecanSearchCrossref: false`. (Or put per-provider toggles in a separate `searchProviderSettings` SiteSetting — see step 5 below — recommended if providers carry config beyond a boolean.)
2. `AdminConsole.jsx` `FLAG_META` (L4767): add `{ key:'pecanSearch', label:'Pecan Search Engine', desc:'…' }` (+ per-provider entries if kept as flags).
3. `StitchOpsConsole.jsx` `FLAG_META` (L38-52): add the same entries.
4. (Nothing else for the flag to persist/audit — `updateFeatureFlags` + `logAdminAction('UPDATE_SETTING','SiteSetting','featureFlags')` already handle write + audit. The GET-merge surfaces the new keys automatically.)
5. **Recommended for per-provider config beyond on/off** (API keys=ENV only, never in SiteSetting; but rate caps, enabled-set, priority order belong in a settings block): add a new SiteSetting key like `DEFAULTS.searchProviderSettings = JSON.stringify({...})` (model on `aiScreeningSettings` L85), add a defaults const + merge, and a controller pair `getSearchProviderSettings`/`updateSearchProviderSettings` that validate + `upsertSetting` + `logAdminAction(req,'UPDATE_SEARCH_PROVIDERS','SiteSetting','searchProviderSettings',{...})`.
6. Feature gating: P1 server endpoints read the `pecanSearch` flag exactly like `searchEngineEnabled()` (`searchEngineController.js:57`) and 404 when off; check the per-provider flag/enabled-set before each provider call. Frontend gates the P1 tab/UI via `/api/settings/public` → `featureFlags.pecanSearch` (mirror `searchEngineFlagEnabled` `searchBuilderApi.js:59`).

## 8. EXACT recipe — (b) add Ops "Search Providers" tab

1. **Server gate**: add `'searchProviders'` to the `role==='admin'` sections array in `getConsole` (`adminController.js:2429`).
2. **Routes**: `admin.js` — import controllers from a new `searchProvidersAdminController.js`; register `router.get/put('/search-providers/settings', requireAdmin, ...)` (+ optional `/search-providers/metrics` or `/search-providers/runs`). Static paths before any `:id`.
3. **API client**: `adminApiClient.js` — add `searchProviders: { getSettings:()=>req(`${BASE}/search-providers/settings`), saveSettings:(b)=>req(`${BASE}/search-providers/settings`,{method:'PUT',...json(b)}) }` (copy `aiScreening` block ~L151).
4. **Nav + render**: `AdminConsole.jsx` — add `{ id:'searchProviders', icon:'<icon>', label:'Search Providers' }` to `NAV_SECTIONS` (L7467); add `searchProviders: <SearchProvidersSection/>` to the `sections` map (L7538).
5. **Section component**: build `SearchProvidersSection()` modeling `SiftAdminSection` (sub-tabs via a `SEARCH_PROVIDER_TABS` const) or the simpler single-pane `AiScreeningSection` (load settings → per-provider toggles + config → save → audit list via `adminApi.auditLog({action:'UPDATE_SEARCH_PROVIDERS'})`). Reuse shared `SectionCard`, `Toggle`, `SaveButton`, `Spinner`, `C` (token palette), `fmtAgo`/`fmtDate` (L40-42).
6. **Stitch (optional)**: either deep-link `/ops?ui=legacy` (precedent for deep tools) or add a parallel Stitch section.

---

## 9. Risks / gotchas

- **THREE places define the flag catalogue and must stay in sync**: server `DEFAULTS.featureFlags` (persistence + merge), `AdminConsole.jsx FLAG_META` (legacy UI), `StitchOpsConsole.jsx FLAG_META` (Stitch UI). Miss one → flag persists but is invisible in that surface (the exact bug v3.21.1 fixed for `searchEngine`).
- **`getConsole` section array is hardcoded** (server) — a new top-level tab id MUST be added there or admins won't see it even though the frontend has the component. Frontend `NAV_SECTIONS` + `roleSections` are only the fallback.
- **`updateFeatureFlags` replaces the whole flag object** — the client always sends the full merged object back. A partial PUT would drop flags. (The merge-on-GET protects reads, not writes.)
- **`initDefaultSettings` never overwrites existing rows** (`update:{}`) — so a new default flag only appears via the GET-time merge; relying on the DB row alone (e.g. raw `JSON.parse(row.value).newFlag`) returns `undefined` until someone saves. P1's own server gate (`searchEngineEnabled` pattern) reads the raw row and treats missing as `false` — correct, but means a brand-new flag is effectively OFF until first save regardless of its `DEFAULTS` value. Fine for default-OFF flags (all P1 flags should default OFF).
- **API keys / secrets belong in ENV, not SiteSetting** — SiteSetting values are readable by any admin and surface in `getAdminSettings`; never store provider API keys there. Store only non-secret config (enabled set, rate caps, priority). Mirror the `aiScreening` `hosted` provider note (server-configured base URL via env).
- **Audit**: `logAdminAction` swallows errors (never throws). Provider changes won't fail if audit fails; verify the audit row separately when testing.
- **Generated Prisma clients**: if P1 adds a NEW model (e.g. a provider-run log table), regenerate all generated client dirs under `server/prisma/generated/*` and update `server/prisma/postgres/schema.prisma`. Flags/settings alone need NO migration.
- **Rate limiter**: all `/api/admin/*` share one budget (300/15min prod, L116-124 `admin.js`); a polling provider-metrics endpoint should be added to `POLL_EXEMPT_GETS` (L115) only if it must poll frequently.
- **`getPublicSettings` is unauthenticated** — never put sensitive provider config in the `featureFlags`/public keys; it's world-readable. Per-provider *enabled* booleans are fine; quotas/keys are not.
