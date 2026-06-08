# META·SIFT Beta — Bugfix Report
**Date:** 2026-06-08  
**Version:** 2.2.0  
**Status:** Fixed ✓

---

## Root Cause: Route Path Mismatch

### What was broken

The META·SIFT Beta landing page showed **"Not found · Retry"** on load, and project creation also failed.

### Exact cause

The API client (`src/frontend/screening/api-client/screeningApi.js`) used the path:

```
GET  /api/screening/projects       ← listProjects
POST /api/screening/projects       ← createProject
GET  /api/screening/projects/:pid  ← getProject
```

But the Express router (`server/routes/screening.js`) registered routes at:

```
GET  /api/screening/           ← r.get('/')
POST /api/screening/           ← r.post('/')
GET  /api/screening/:pid       ← r.get('/:pid')
```

So `GET /api/screening/projects` matched `/:pid` with `pid = "projects"`. Prisma's `findFirst({ where: { id: "projects", ownerId: userId } })` returned `null`, which correctly returned HTTP 404 `{ error: "Project not found" }`. The frontend rendered that as "Not found / Retry".

### How it was fixed

All routes in `server/routes/screening.js` were updated to include the `/projects` prefix:

```js
// Before (broken)
r.get('/',         S.listProjects);
r.post('/',        S.createProject);
r.get('/:pid',     S.getProject);

// After (correct)
r.get('/projects',      S.listProjects);
r.post('/projects',     S.createProject);
r.get('/projects/:pid', S.getProject);
// ... and all 22 other routes updated similarly
```

---

## Additional Fixes in This PR

### 1. Health endpoint added
`GET /api/screening/health` always returns `{ status: 'ok' }`. Useful for frontend connectivity checks without triggering feature-flag logic.

### 2. Feature flag / maintenance mode
A `checkEnabled` middleware now reads `metaSiftSettings` from `siteSetting`. If `enabled: false`, all routes after `/health` return HTTP 503 with the admin-configured maintenance message. The frontend renders a maintenance card instead of showing a raw error.

### 3. Error messages improved
The API client now maps HTTP status codes to human-readable messages:
- 401 → "You must be signed in to use META·SIFT."
- 503 → maintenance message from settings
- Others → actual `error` field from response body

### 4. Admin screening panel added
New section **META·SIFT** in `/ops` (AdminConsole) with:
- Toggle controls for each feature (enabled, import, export, dedup, conflicts)
- Metrics dashboard (total projects, records, decisions, conflicts, duplicates)
- Screening projects table with status management (active / archived / disabled)
- Maintenance message editor

### 5. Admin backend endpoints added
Under `GET/PUT /api/admin/screening/*`:
- `/settings` — get/update module settings  
- `/metrics` — aggregate usage counters  
- `/projects` — paginated list of all screening projects  
- `/projects/:id` — single project detail  
- `/projects/:id/status` — change project stage

### 6. META·SIFT card added to "Rayyan & Screening" tab
In `meta-lab-3-patched.jsx` → `RayyanTab`, a teal card with **"Open META·SIFT Beta →"** button was added at the top. The button uses `window.location.href = '/sift-beta'`.

### 7. Integration tests rewritten
`tests/screening/integration/screening-api.test.js` was rewritten to use the correct `/api/screening/projects` paths, correct request/response shapes (`{ title }`, `{ projects: [...] }`, `{ imported }`, etc.), and proper helpers with `AbortSignal.timeout`.

---

## Files Changed

| File | Change |
|------|--------|
| `server/routes/screening.js` | Added `/projects` prefix to all routes; added health endpoint; added `checkEnabled` middleware |
| `server/controllers/screeningAdminController.js` | **New** — admin CRUD for META·SIFT settings, metrics, projects |
| `server/routes/admin.js` | Added import + 6 new admin/screening routes |
| `src/frontend/screening/api-client/screeningApi.js` | Added `/health` endpoint; improved error messages per status code |
| `src/frontend/screening/pages/SiftDashboard.jsx` | Added disabled/maintenance state handling |
| `src/frontend/pages/admin/adminApiClient.js` | Added `adminApi.screening` namespace |
| `src/frontend/pages/admin/AdminConsole.jsx` | Added `SiftAdminSection` component + `META·SIFT` sidebar nav item |
| `meta-lab-3-patched.jsx` | Added META·SIFT Beta launch card to RayyanTab |
| `tests/screening/integration/screening-api.test.js` | Full rewrite with correct paths and shapes |

---

## How to Verify the Fix

1. Start the server: `npm run server`
2. Start the frontend: `npm run dev`
3. Log in → click avatar → **META·SIFT** (or go to **Rayyan & Screening** tab → click "Open META·SIFT Beta →")
4. The dashboard should load with no "Not found" error
5. Create a project → should return 201 and appear in the list
6. Refresh → project persists

To run automated integration tests:
```sh
npm run server &
npx vitest run tests/screening/integration/
```
