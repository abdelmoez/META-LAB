# Audit A — How the FRONTEND obtains the application version safely

**Scope:** How a Stitch (or legacy) component renders the marketing version string (e.g. `v3.49.1`) reusing the existing version system, WITHOUT exposing the git commit hash / server / framework versions to ordinary (non-admin) users. Read-only audit; no code changed.

**Bottom line (TL;DR):**
- Canonical API: **`GET /api/version`** (`server/index.js:271`). It is the single, public, intentional source of the product version.
- For a **logged-in non-admin**, it returns the **FULL** object `{ name, version, commit, commitDate, buildDate, full }` — i.e. an authenticated session is enough to receive the commit/build metadata. For an **anonymous/unauthenticated** caller it returns only `{ name, version }` (commit/dates stripped).
- The marketing version field is **`version`** (string, e.g. `"3.49.1"`), sourced from root `package.json` via `server/version.js`.
- There is **NO** `version` field on `GET /api/auth/me` and **NO** `version` on `GET /api/settings/public`. Do not look for it there.
- There is **NO** build-time constant — `vite.config.js` has no `define` / `__APP_VERSION__`, and nothing reads `import.meta.env.VITE_*` for version. Do not invent one; fetch `/api/version`.
- The api-client (`src/frontend/api-client/apiClient.js`) has **NO** version method. Existing consumers all call `fetch('/api/version', { credentials:'include' })` directly. There is a reusable admin helper `fetchVersion()` (`src/frontend/pages/admin/adminApiClient.js:282`).

---

## 1. The exact endpoint + the JSON field

### Endpoint: `GET /api/version`
File `server/index.js`, lines 266–279 (verbatim):

```js
// ── Version metadata ───────────────────────────────────────────────────────────
// The product version is intentionally public (shown in the UI). Build metadata
// (commit hash, commit/build dates) is fingerprinting (prompt 52) — it is only
// returned to an authenticated caller (the UI footer/Ops Console fetch it with
// credentials). A valid, unexpired session token is sufficient gating here.
app.get('/api/version', (req, res) => {
  const full = getVersion();
  let authed = false;
  try {
    const tok = req.cookies && req.cookies[SESSION_COOKIE];
    if (tok) { verifyToken(tok); authed = true; }
  } catch { authed = false; }
  return res.json(authed ? full : publicVersion(full));
});
```

Imports backing this handler (all in `server/index.js`):
- `server/index.js:59` — `import { helmetOptions, apiNoStore, publicVersion } from './security/headers.js';`
- `server/index.js:60` — `import { verifyToken } from './auth/jwt.js';`
- `server/index.js:76` — `const SESSION_COOKIE = sessionCookieName();`
- `server/index.js:54` — `import { getVersion } from './version.js';`

This route is mounted BEFORE `requireAuth`-guarded routers, and is also explicitly exempt from the maintenance gate (`server/index.js:229`, `server/middleware/maintenance.js:48`), so it is reachable by both anonymous and authenticated callers.

### Field that returns the marketing version: `version`
`server/version.js` builds a frozen `META` object (`server/version.js:72–79`):

```js
const META = Object.freeze({
  name: 'PecanRev',
  version,        // ← from root package.json "version"  → e.g. "3.49.1"
  commit,         // short git sha (fingerprinting; authed-only)
  commitDate,     // ISO date | null (fingerprinting; authed-only)
  buildDate,      // ISO date (fingerprinting; authed-only)
  full,           // "vX.Y.Z · <commit> · <YYYY-MM-DD>" convenience string
});
export function getVersion() { return META; }
```

`version` resolves from root `package.json` "version" once at module load (`server/version.js:38–42`). Current value: **`3.49.1`** (confirmed in `server/version.json:2` and is the deployed build).

### What a non-admin authenticated user gets
The gate in the route is **authentication only** (`verifyToken(tok)`), NOT admin role. So:
- **Logged-in NON-admin (ordinary user):** receives the **FULL** object including `commit`, `commitDate`, `buildDate`. (Per the prompt-52 design, the commit hash is withheld only from *anonymous* callers; any valid session is sufficient.)
- **Anonymous caller:** receives only `publicVersion(full)` → `{ name, version }`.

`publicVersion()` (`server/security/headers.js:62–65`, verbatim):

```js
export function publicVersion(meta) {
  const m = meta || {};
  return { name: m.name || 'PecanRev', version: m.version || '0.0.0' };
}
```

**Implication for a Stitch component shown to ordinary users:** if you ONLY ever render `data.version`, you are safe in every case — anonymous gets `{name,version}`, authed gets the full object but you ignore commit/dates. To render JUST the marketing string and never the commit hash, **read `data.version` and nothing else.** No role check needed in the component.

> Note: `GET /api/version` carries `Cache-Control: no-store` because of the global `apiNoStore` middleware (`server/security/headers.js:47–53`) that stamps every `/api/*` response. So the browser will re-hit the endpoint; the module-level JS cache below is what prevents redundant network calls within a session.

### NOT on /me, NOT on /settings/public (verified)
- `GET /api/auth/me` → `getMe()` (`server/controllers/authController.js:314–342`) selects only user columns (`id, userNumber, email, name, role, …, country`) plus `requireEmailVerification`. **No `version` field.**
- `GET /api/settings/public` → `getPublicSettings()` (`server/controllers/settingsController.js:163`) returns `appSettings, landingContent, featureFlags, onboardingSettings, robSettings, themeSettings` + `defaultTheme`, `maintenanceMessage`. **No `version` field.**

---

## 2. Frontend: how the SPA currently surfaces version

There is **no `api.version()` method** in `src/frontend/api-client/apiClient.js` (full file read; methods cover health/projects/studies/records/meta/validation/import-export/profile/contact/institutions/auth — none for version). Every existing consumer calls `/api/version` with a raw `fetch`. Four live consumers:

1. **`src/frontend/components/UserMenu.jsx`** (avatar dropdown, used in both metalab + screening shells) — the cleanest reference. Module cache holds the **FULL object**:
   - `UserMenu.jsx:24` — `let _versionCache = null;`
   - `UserMenu.jsx:31` — `const [version, setVersion] = useState(_versionCache);`
   - `UserMenu.jsx:34–40`:
     ```js
     useEffect(() => {
       if (_versionCache) return;
       fetch('/api/version', { credentials: 'include' })
         .then(r => (r.ok ? r.json() : null))
         .then(v => { if (v) { _versionCache = v; setVersion(v); } })
         .catch(() => {});
     }, []);
     ```
   - Render string `UserMenu.jsx:66–68`:
     ```js
     const versionStr = version
       ? `v${version.version}${version.commit && version.commit !== 'dev' ? ' · ' + version.commit : ''}`
       : null;
     ```
     (This deliberately appends the commit — only do that in admin/staff surfaces. For an ordinary-user Stitch footer, render `v${version.version}` only.)

2. **`src/frontend/workspace/Workspace.jsx`** (legacy sidebar footer) — caches only the **STRING**:
   - `Workspace.jsx:229` — `let _versionCache=null;`
   - `Workspace.jsx:267` — `const[appVersion,setAppVersion]=useState(_versionCache);`
   - `Workspace.jsx:300–306`:
     ```js
     useEffect(()=>{
       if(_versionCache)return;
       fetch("/api/version",{credentials:"include"})
         .then(r=>r.ok?r.json():null)
         .then(v=>{if(v?.version){_versionCache=v.version;setAppVersion(v.version);}})
         .catch(()=>{});
     },[]);
     ```
   - Footer render `Workspace.jsx:1347`: `{appVersion?`v${appVersion} · `:""}PRISMA 2020`
   - **CAVEAT (do not cross the streams):** these are two DIFFERENT module-scoped `_versionCache` variables in two different files. `UserMenu` caches the whole object; `Workspace` caches the string. They are independent. A Stitch component must declare its OWN module-level cache; do not import either.

3. **`src/frontend/stitch/pages/StitchOpsConsole.jsx`** (admin "System Health" tab) — uses the admin helper:
   - `StitchOpsConsole.jsx:272` — `fetchVersion(), // never throws; null on 404`
   - `StitchOpsConsole.jsx:293–295` — `const ver = version?.version || h.version;` (falls back to `/api/admin/health`)
   - Renders `v{ver}` + commit slice (admin context, so commit is fine here).

4. **Admin helper `fetchVersion()`** — `src/frontend/pages/admin/adminApiClient.js:282–290` (verbatim):
   ```js
   export const fetchVersion = async () => {
     try {
       const res = await fetch('/api/version', { credentials: 'include' });
       if (!res.ok) return null;
       return await res.json();
     } catch {
       return null;
     }
   };
   ```
   Importable as `import { fetchVersion } from '../../pages/admin/adminApiClient.js'` (adjust relative path). Returns the parsed object or `null`. Reuse this rather than re-writing the fetch.

`AdminConsole.jsx` (legacy admin) also renders version at `:7825/:7857/:7969` and at `:1059/:5596` from health data — admin-only, not relevant for ordinary-user Stitch surfaces.

---

## 3. Build-time constant? **No.**
- `vite.config.js` (full file, 22 lines) has `defineConfig({ plugins:[react()], root:'.', server:{…proxy /api→127.0.0.1:3001}, build:{outDir:'dist'} })`. **No `define` block, no `__APP_VERSION__`.**
- No frontend code reads `import.meta.env.VITE_*` for a version.
- Conclusion: **do NOT hardcode** and do NOT rely on a Vite define. The runtime `GET /api/version` is the only correct, non-hardcoded source (it tracks `package.json` automatically, and `server/version.json` is regenerated at build via `npm run version:gen` / `scripts/generate-version.js`).

---

## 4. EXACT code for a Stitch component (copy-paste ready)

Renders `v3.49.1` reusing the existing version system, never showing the commit hash, with a tooltip `PecanRev version 3.49.1`, a module-level cache so it does not refetch per mount, and a safe fallback if the call fails.

```jsx
// At module scope (top of the file, once) — its OWN cache, do not import
// UserMenu's or Workspace's _versionCache. Cache the marketing STRING only.
let _appVersionCache = null;

// Inside the component:
const [appVersion, setAppVersion] = useState(_appVersionCache);

useEffect(() => {
  if (_appVersionCache) return;            // already fetched this session
  let alive = true;
  fetch('/api/version', { credentials: 'include' })   // credentials → authed gets full obj; we use only .version
    .then(r => (r.ok ? r.json() : null))
    .then(v => {
      if (alive && v && v.version) {
        _appVersionCache = v.version;       // e.g. "3.49.1"
        setAppVersion(v.version);
      }
    })
    .catch(() => {});                       // silent fallback (see §5)
  return () => { alive = false; };
}, []);

// Render — ONLY data.version, so the commit hash is never shown to ordinary users:
{appVersion ? (
  <span
    title={`PecanRev version ${appVersion}`}
    style={{ fontFamily: MONO, fontSize: 11, color: S.textMuted }}
  >
    v{appVersion}
  </span>
) : null}
```

**Alternative (reuse the admin helper instead of a raw fetch)** — identical result, less code:
```jsx
import { fetchVersion } from '../../pages/admin/adminApiClient.js'; // fix relative path for your file
// …
useEffect(() => {
  if (_appVersionCache) return;
  fetchVersion().then(v => {               // returns the full object or null; never throws
    if (v && v.version) { _appVersionCache = v.version; setAppVersion(v.version); }
  });
}, []);
```

**Where to mount it (Stitch shell):** `StitchContextRail` (`src/frontend/stitch/shell/shellParts.jsx:99`) accepts a `footer` prop rendered inside a top-bordered footer slot (`shellParts.jsx:113`) — the natural home for a small version label, mirroring the legacy `Workspace.jsx:1347` sidebar footer.

---

## 5. Caching / loading concerns and the safest default

- **Network cache:** `/api/version` is served `Cache-Control: no-store` (global `apiNoStore`, `server/security/headers.js:47–53`). The browser will not cache it; the **module-level JS cache (`_appVersionCache`) is what avoids refetching** on every remount. Use it (every existing consumer does).
- **`credentials: 'include'` is required** so the session cookie is sent. With it, a logged-in user gets the full object (you ignore the extra fields); without a session the server returns `{ name, version }` — still has `version`, so the component still works for anonymous/landing surfaces.
- **Safest default on failure / null:** render **nothing** (`appVersion ? (...) : null`) — exactly what `UserMenu.jsx:68` and `Workspace.jsx:1347` do (silent fallback). Do NOT hardcode `"3.49.1"` as a fallback: a stale hardcoded number is worse than an absent label, and `package.json` is the single source of truth. If you must show something while loading, show a neutral placeholder (e.g. the product name `PecanRev` with no number), never a fake version.
- **Loading flicker:** because of the module cache, the value is `null` only on the very first mount of the session; subsequent mounts read the cache synchronously via `useState(_appVersionCache)` and show `v3.49.1` immediately.
- **Never show commit to ordinary users:** the route WILL return `commit`/`buildDate` to any authenticated user. The component-level safeguard is simply to **read only `.version`**. If you ever want commit shown, gate it on `user.role === 'admin'` (see `UserMenu.jsx:54` `isStaff` pattern) — but for the general Stitch footer, omit it.

---

## Evidence index (file:line)
- `server/index.js:271` — `app.get('/api/version', …)` route definition (266–279 with comment).
- `server/index.js:59` — import of `publicVersion` from `./security/headers.js`.
- `server/index.js:54,60,76` — `getVersion`, `verifyToken`, `SESSION_COOKIE`.
- `server/index.js:229`, `server/middleware/maintenance.js:48` — `/api/version` exempt from maintenance gate.
- `server/version.js:72–86` — frozen `META` + `getVersion()`; `:38–42` version from package.json; `:48–66` commit/commitDate/buildDate resolution.
- `server/version.json:1–6` — generated fallback (`"version":"3.49.1"`, `"commit":"d076811"`).
- `scripts/generate-version.js:30–36` — writes `server/version.json` at build (`npm run version:gen`).
- `server/security/headers.js:62–65` — `publicVersion()` strips to `{name,version}`.
- `server/security/headers.js:47–53` — `apiNoStore` (every `/api/*` → `Cache-Control: no-store`).
- `server/controllers/authController.js:314–337` — `getMe()` payload (NO version).
- `server/controllers/settingsController.js:163,214–217` — `getPublicSettings()` payload (NO version).
- `src/frontend/api-client/apiClient.js` (whole file) — NO version method.
- `src/frontend/pages/admin/adminApiClient.js:282–290` — reusable `fetchVersion()`.
- `src/frontend/components/UserMenu.jsx:24,31,34–40,66–68` — reference consumer (caches full object).
- `src/frontend/workspace/Workspace.jsx:229,267,300–306,1347` — reference consumer (caches string).
- `src/frontend/stitch/pages/StitchOpsConsole.jsx:272,293–295,320–331` — Stitch admin consumer + fallback to health.
- `src/frontend/stitch/shell/shellParts.jsx:99,113` — `StitchContextRail` `footer` slot (mount point).
- `vite.config.js:1–22` — NO `define`/`__APP_VERSION__`/`VITE_` version.
