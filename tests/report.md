# META·LAB Test Report

**Generated:** 2026-06-07
**Framework:** Vitest v2.1.9
**Working directory:** `H:/META-LAB/META-LAB`

---

## 1. Test Suite Summary

| Category    | Files | Tests | Pass | Fail | Skip |
|-------------|-------|-------|------|------|------|
| Unit        | 7     | 337   | 337  | 0    | 0    |
| Integration | 7     | 42    | 0    | 0    | 42   |
| **Total**   | **14**| **379**| **337** | **0** | **42** |

All 337 unit tests pass. Integration tests are written but skipped because the server was not running during the test run.

> **Note:** Integration tests require a running server with database access. Start the stack with `docker compose up -d && npx prisma migrate dev`, then run `npm run server` before executing integration tests.

---

## 2. Unit Tests

### math-helpers.test.js — 38 tests, all pass
Z975 constant, normalCDF (symmetry, boundary), invNorm (round-trip, NaN guards), invNormAbs,
lgamma, gammp, chiSquareCDF (standard critical values), tCDF (symmetry, large-df), tCrit
(infinity/0 fallback, monotonicity, round-trip with tCDF).

### meta-analysis.test.js — 59 tests, all pass
runMeta (null guards, k, pES in CI, I2/Q/tau2 bounds, method, HKSJ, predInt, weight sums),
eggersTest (null guard, shape, dof=k-2), leaveOneOut (null guard, length=k, shape, finite pES),
influenceDiagnostics (null guard, length=k, boolean influential),
trimFill (null guard, shape, k0>=0, imputed.length=k0),
subgroupAnalysis (groupKey grouping, Qbetween, pBetween, df, Unspecified fallback).

### effect-sizes.test.js — 58 tests, all pass
calcES for SMD, MD, OR, RR, HR, COR, PROP, DIAG — formula correctness, sign, display strings,
null guards (zero cells, n<2, |r|>=1, events>total), Haldane and continuity corrections,
unknown type returns null.

### conversions.test.js — 52 tests, all pass
Catalogue structure invariants, invNorm re-export, and each of 9 recipes:
median_iqr, median_range, se_sd, ci_sd, pval_se, pct_events, events_pct, ratio_log, unit_scale.
Covers formula values, error conditions (invalid ranges, non-numeric input).

### validation.test.js — 62 tests, all pass
validateStudy: author/year/outcome warns, lo>hi error, es outside CI error, negative SD error,
events>total error, group total mismatch error, missing CI/esType warns, partial table warns,
flag warns, converted-without-record warns.
checkPoolability: 0/1 study blocker, 2+ same type ok, mixed types blocker, mixed designs/timepoints
warns, noconfirm blocker, composition object.
analysisTypeWarnings: PROP+2x2 error, OR+single-arm warn, SMD+2x2 warn, DIAG-cells+non-DIAG warn.

### parsers.test.js — 56 tests, all pass
normTitle, mkRecord (shape, unique ids, DOI URL stripping), parseRIS (title/authors/year/
journal/doi/abstract/source, multi-record, empty input), parseBibTeX (same fields, multi-entry),
parseNBIB (pmid, doi from LID tag), detectAndParse (auto-detect from content and extension,
unknown falls back), dedupeRecords (add new, dup by DOI/PMID/title+year, dupOf set).

### project-model.test.js — 38 tests, all pass
uid (string, length=8, 1000 unique ids, base-36 charset), now (valid ISO, close to current time),
fmtDate (null/undefined/empty returns em-dash, ISO format string),
mkProject (name, unique id, timestamps, empty studies/records, pico/search/prisma shape, robMethod),
mkStudy (unique id, all string fields empty, boolean defaults, empty arrays, RCT/unadjusted/primary defaults).

---

## 3. Integration Tests

Server was not running during the automated run. All 42 tests gracefully skip via
`if (!up) return;` inside each test body (server availability is checked asynchronously in beforeAll).

| File                      | Endpoint(s)                                                         | Tests | Notes                          |
|--------------------------|---------------------------------------------------------------------|-------|--------------------------------|
| api-health.test.js        | GET /api/health                                                     | 4     | Public endpoint                |
| api-auth.test.js          | POST/GET /api/auth/register,login,logout,me                        | 11    | New — auth + guard + isolation |
| api-projects.test.js      | POST/GET/PUT/DELETE /api/projects                                   | 9     | Updated — uses auth cookie     |
| api-studies.test.js       | POST/GET/PUT/DELETE /api/projects/:id/studies                       | 8     |                                |
| api-meta.test.js          | POST /api/meta/run,sensitivity,egger,trimfill,subgroup              | 10    |                                |
| api-validation.test.js    | POST /api/validation/check                                          | 4     |                                |
| api-import.test.js        | POST /api/import/references                                         | 6     |                                |

### api-auth.test.js — test inventory

**Register (4 tests)**
- Success: 201, user object (id/email/name/createdAt), session cookie set, password not returned
- Duplicate email: 409
- Missing email: 400
- Password too short (< 8 chars): 400

**Login (3 tests)**
- Success: 200, user object, session cookie set
- Wrong password: 401
- Unknown email: 401

**GET /api/auth/me (2 tests)**
- Valid cookie: 200, returns user
- No cookie: 401

**POST /api/auth/logout (2 tests)**
- Valid cookie: 200, `{ ok: true }`
- No cookie: 401

**Protected route guards (3 tests)**
- GET /api/projects without cookie: 401
- POST /api/projects without cookie: 401
- GET /api/health without cookie: 200 (still public)

**User isolation (2 tests)**
- User B's project list does not contain user A's project
- Fetching user A's project id as user B returns 404

### api-projects.test.js — changes

All 9 existing tests are unchanged in assertion logic. A `registerAndLogin` helper was added;
`beforeAll` now obtains a session cookie for `qa-projects@example.com` and every `fetch` call
passes `Cookie: cookie` in its headers. The `afterAll` cleanup likewise passes the cookie when
deleting the test project.

---

## 4. Known Issues / Failures

None. All 337 unit tests pass on first run without any modifications to source code.

Notes:
- parseEndNoteXML is not unit-tested: it depends on DOMParser (browser API), not available in Node without jsdom.
- findDuplicates (study-validator.js) not directly tested; focus was on the three exported validation functions.
- ibeta and betacf are covered indirectly through tCDF/tCrit.

---

## 5. Coverage Notes

Covered: all math primitives, all 8 effect measures, all 9 conversion recipes, full meta-analysis
engine (fixed/random/HKSJ/predInt/LOO/influence/trimFill/Egger/subgroup), all per-study
validation rules, poolability gate, RIS/BibTeX/NBIB parsers, project and study model factories.

Not covered: parseEndNoteXML (needs DOM), front-end React components, export endpoints,
records management endpoints, api-studies/api-meta/api-validation/api-import auth migration
(still send unauthenticated requests — to be updated in a follow-up).

---

## 6. Phase B Tests (2026-06-07)

### New test files added

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/unit/serverStorage.test.js` | 12 | Unit tests for the `window.storage` bridge |
| `tests/integration/api-phase-b.test.js` | 13 | Integration tests for Phase B backend endpoints |
| `tests/integration/api-route-protection.test.js` | 6 | 401 guard tests for Phase B protected routes |
| **Total new** | **31** | |

### Unit tests — serverStorage (12 tests, all pass)

`window.storage.get`:
- Returns `{ value: "[]" }` when the server project list is empty
- Fetches full project data (with studies) for each entry in the list
- Returns `null` for any key that is not `"meta:projects"`
- Returns `null` when `fetch` throws a network error
- Returns `null` when the server responds with a non-OK status

`window.storage.set`:
- Calls `PUT /api/projects/:id/autosave` for every project in the array
- Calls `DELETE /api/projects/:id` for projects removed from the local array
- Emits `'failed'` status when the JSON value is syntactically invalid
- Emits `'failed'` status when the parsed JSON value is not an array
- Emits `'saving'` then `'saved'` on a successful save
- Does nothing (no fetch) when the key is not `"meta:projects"`

`subscribeToSaveStatus`:
- Unsubscribe function stops further callbacks from being delivered

### Integration tests — api-phase-b (13 tests, skip when server is down)

`PUT /api/projects/:id/autosave` (3):
- Saves a full project payload including studies array
- Creates a new project when the id does not yet exist (upsert)
- Returns 400 when name is missing from the payload

`GET /api/projects?full=true` (2):
- Returns projects with studies and records included
- Strips studies and records when the `full` param is absent

`POST /api/projects/:id/duplicate` (2):
- Returns a new project with `(copy)` appended to the name
- Returns 404 when duplicating a non-existent project

`GET /api/profile` (2): Returns user without password; 401 without cookie

`PUT /api/profile` (2): Updates display name; 400 for non-string name

`PUT /api/profile/password` (3):
- Changes password so old password no longer works
- Returns 401 when currentPassword is wrong
- Returns 400 when newPassword is shorter than 8 characters

User isolation (1): Project autosaved by user A returns 404 for user B

### Integration tests — api-route-protection (6 tests, skip when server is down)

- `PUT /api/projects/:id/autosave` — 401 without cookie
- `POST /api/projects/:id/duplicate` — 401 without cookie
- `GET /api/profile` — 401 without cookie
- `PUT /api/profile/password` — 401 without cookie
- `PUT /api/profile` — 401 without cookie
- `GET /api/health` — still public (200)

### Updated totals

| Category | Files | Tests | Pass | Fail | Skip |
|----------|-------|-------|------|------|------|
| Unit | 8 | 349 | 349 | 0 | 0 |
| Integration | 9 | 61 | 0 | 0 | 61 |
| **Total** | **17** | **410** | **349** | **0** | **61** |

(Integration skip-count assumes server is not running during CI.)

### How to run integration tests

```sh
# Start the API server first (in a separate terminal)
npm run server          # or: npm run dev:server

# Then run integration tests
npm run test:integration

# Run only Phase B tests
npx vitest run tests/integration/api-phase-b.test.js tests/integration/api-route-protection.test.js
```

---

## 7. How to Run

Unit tests only:
  npm run test:unit

Integration tests (requires running server with database access):
  docker compose up -d
  npx prisma migrate dev
  npm run server          # in a separate terminal
  npm run test:integration

All tests:
  npm test

Last recorded unit-test result (2026-06-07 — Phase B):
  Test Files  8 passed (8)
  Tests       349 passed (349)
  Duration    ~1.3s
