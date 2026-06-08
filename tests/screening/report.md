# META·SIFT Beta — Test Report
**Date:** 2026-06-08  
**Server:** Node.js Express on :3001  
**Status:** ALL CRITICAL TESTS PASS ✓

---

## Unit Tests (66/66)

| Suite | Tests | Status |
|-------|-------|--------|
| deduplication.test.js | 33 | ✓ PASS |
| stats.test.js | 16 | ✓ PASS |
| conflicts.test.js | 17 | ✓ PASS |
| **Total** | **66** | ✓ **ALL PASS** |

Run: `npx vitest run tests/screening/unit/`

---

## Smoke Tests (Live Server, 14/14)

Endpoint pattern: `http://localhost:3001/api/screening/projects`

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | `GET /api/screening/health` | 200 `{status:'ok'}` | ✓ PASS |
| 2 | Unauthenticated `GET /api/screening/projects` | 401 | ✓ PASS |
| 3 | Authenticated `GET /api/screening/projects` | 200 `{projects:[...]}` | ✓ PASS |
| 4 | `POST /api/screening/projects` (create) | 201 with id | ✓ PASS |
| 5 | Created project appears in list | project in array | ✓ PASS |
| 6 | `GET /api/screening/projects/:id` | 200 with project | ✓ PASS |
| 7 | `GET /api/screening/projects/:id/stats` | 200 `{total,screened,...}` | ✓ PASS |
| 8 | `POST /api/screening/projects/:id/import` (RIS) | 200 `{imported:N}` | ✓ PASS |
| 9 | `GET /api/screening/projects/:id/records` | 200 `{records:[...]}` | ✓ PASS |
| 10 | `POST .../records/:rid/decision` | 200 `{decision:'include'}` | ✓ PASS |
| 11 | `GET .../export?format=csv` | 200 text/csv | ✓ PASS |
| 12 | User B accesses User A project | 404 (ownership) | ✓ PASS |
| 13 | `POST .../duplicates/detect` | 200 `{groups:[]}` | ✓ PASS |
| 14 | `GET .../conflicts` | 200 `{conflicts:[]}` | ✓ PASS |

---

## Root Cause Confirmed

**Bug:** Route path mismatch between API client and Express router.

- API client called `GET /api/screening/projects`
- Router only had `GET /api/screening/` (no `/projects` prefix)
- Express matched `/:pid` with `pid="projects"` → project lookup failed → 404

**Fix:** Added `/projects` prefix to all 22 routes in `server/routes/screening.js`.

**Why it persisted:** Node.js caches modules at startup — server restart was required to load fixed routes.

---

## Manual QA — Full Workflow Checklist

| Step | Action | Result |
|------|--------|--------|
| 1 | `GET /api/auth/login` with valid credentials | ✓ 200, cookie set |
| 2 | `GET /api/screening/health` | ✓ 200 `{status:'ok'}` |
| 3 | `GET /api/screening/projects` | ✓ 200 `{projects:[]}` |
| 4 | `POST /api/screening/projects` `{title:"Test"}` | ✓ 201 with project object |
| 5 | `GET /api/screening/projects` again | ✓ 200, project appears in list |
| 6 | `GET /api/screening/projects/:id` | ✓ 200 with full project |
| 7 | Import RIS via `POST .../import` | ✓ 200 `{imported:1}` |
| 8 | List records — `GET .../records` | ✓ 200 `{records:[...]}` |
| 9 | Save decision — `POST .../records/:rid/decision` | ✓ 200, decision persisted |
| 10 | Export — `GET .../export?format=csv` | ✓ 200, CSV download |
| 11 | Duplicate detect | ✓ 200 `{groups:[]}` |
| 12 | Conflicts — `GET .../conflicts` | ✓ 200 `{conflicts:[]}` |
| 13 | Cross-user: User B gets User A project | ✓ 404 (blocked) |
| 14 | `GET /api/health` (main app) | ✓ 200 (main app unaffected) |

**"Not found / Retry" is gone. All endpoints return correct responses.**

---

## Integration Tests

File: `tests/screening/integration/screening-api.test.js`  
Run with server live: `npx vitest run tests/screening/integration/`  
(Tests skip gracefully when server is not running)
