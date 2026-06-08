# META·SIFT Beta — Root Cause Analysis

## Bug: "Not found / Retry" on /sift-beta

### Symptom
- `/sift-beta` dashboard loads but shows "Not found · Retry" error  
- Creating a new META·SIFT project shows the same error  
- All META·SIFT API calls fail

---

## Root Cause: Route Path Mismatch

### What was failing

Every `GET /api/screening/projects`, `POST /api/screening/projects`, and all sub-routes returned:

```json
HTTP 404
{ "error": "Not found" }
```

### Why

The API client (`src/frontend/screening/api-client/screeningApi.js`) used:

```js
const BASE = '/api/screening';

listProjects:  () => req('GET',  '/projects'),        // → GET /api/screening/projects
createProject: (b) => req('POST', '/projects', b),    // → POST /api/screening/projects
getProject:    (id) => req('GET', `/projects/${id}`), // → GET /api/screening/projects/:id
```

But the Express router (`server/routes/screening.js`) was registered as:

```js
r.get('/',     S.listProjects);   // only matches GET /api/screening/
r.post('/',    S.createProject);  // only matches POST /api/screening/
r.get('/:pid', S.getProject);     // matches GET /api/screening/:pid
```

So `GET /api/screening/projects` matched `r.get('/:pid')` with `params.pid = "projects"`.  
`getProject` then called `prisma.screenProject.findFirst({ where: { id: "projects" } })` → returned `null` → `404 { error: 'Project not found' }`.

The SiftDashboard caught this error and displayed:

```
Not found
[Retry]
```

### Why it persisted even after the code fix was written

The fix (adding `/projects` prefix to all routes) was written to disk during the previous context window. But the **Node.js server process was still running old code** — Express loads all routes at startup; changes to files on disk don't take effect until the process restarts.

The server had to be killed (`taskkill /F /IM node.exe`) and restarted (`node server/index.js`) to load the corrected routing.

---

## Exact Failing Request

| Field | Value |
|-------|-------|
| URL | `GET http://localhost:3001/api/screening/projects` |
| Method | GET |
| Auth | Cookie `metalab_session` (present, valid) |
| Response status | 404 |
| Response body | `{ "error": "Not found" }` (global 404 handler) |
| Frontend file | `src/frontend/screening/api-client/screeningApi.js:19` |
| Backend handler that ran | `screeningController.getProject("projects", userId)` |
| Backend handler that should have run | `screeningController.listProjects(userId)` |

---

## Fix Applied

**`server/routes/screening.js`** — all routes now use `/projects` prefix:

```js
// Before (broken)
r.get('/',     S.listProjects);
r.post('/',    S.createProject);
r.get('/:pid', S.getProject);

// After (correct)
r.get('/projects',      S.listProjects);
r.post('/projects',     S.createProject);
r.get('/projects/:pid', S.getProject);
// ... all 22 routes updated similarly
```

---

## Verified Results (live server test, 2026-06-08)

```
[PASS] GET /api/screening/health → 200 { status: 'ok' }
[PASS] Unauthenticated GET → 401
[PASS] GET /api/screening/projects (auth) → 200 { projects: [...] }
[PASS] POST /api/screening/projects → 201 { id: "...", title: "..." }
[PASS] Created project appears in list
[PASS] GET /api/screening/projects/:id → 200
[PASS] GET /api/screening/projects/:id/stats → 200 { total: 0, ... }
[PASS] POST import RIS → 200 { imported: 1 }
[PASS] GET records after import → 200 { records: [...] }
[PASS] POST decision → 200 { decision: 'include' }
[PASS] GET export CSV → 200 text/csv
[PASS] User B blocked from User A project → 404
[PASS] POST duplicate detect → 200 { groups: [] }
[PASS] GET conflicts → 200 { conflicts: [] }

14 / 14 PASS
```
