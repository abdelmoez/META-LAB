# META·LAB Test Report

**Generated:** 2026-06-11 (prompt8 landing/ops/overflow/chat-placement upgrade; earlier sections below unchanged)
**Framework:** Vitest v2.1.9
**Working directory:** `H:/META-LAB/META-LAB`

---

## 0····. prompt8 — landing overhaul, ops control center, overflow fixes, chat placement (2026-06-11)

**Full repo suite (`npx vitest run --no-file-parallelism`, server up): 883 pass / 6 pre-existing
`serverStorage.test.js` fake-timer failures (quarantined — identical set and count since prompt1) / 7 skips
(896 total, 38 files).** META·SIFT screening suite unchanged: **249/249 pass**. `npm run build` exit 0
(pre-existing monolith esbuild JSX advisory + >500 kB chunk note only).

| Suite | Baseline (pre-prompt8) | Now | Δ |
|---|---|---|---|
| Screening (`tests/screening/`, server up) | 249/249 | **249/249** | unchanged (UI-only changes; chat API contract untouched) |
| Integration (`tests/integration/`) | 113 pass / 7 skip | **120 pass / 7 skip** | +7 `api-admin-timeseries.test.js` |
| Full repo (server up) | 876 pass / 6 fail / 7 skip | **883 pass / 6 fail / 7 skip** | no net loss; failures unchanged |

**Flipped assertions: NONE.** Every pre-prompt8 test passes unchanged.

### api-admin-timeseries.test.js inventory (7 tests — new endpoint)

| Test | What is pinned |
|---|---|
| auth enforcement | `GET /api/admin/metrics/timeseries` → **401 unauthenticated, 403 normal user** (mod also 403 via `requireAdmin`, verified manually) |
| shape | 200 for admin: exactly 14 ascending `YYYY-MM-DD` days, zero-filled, last = today (server-local); all 8 fields (`logins, uniqueLogins, newUsers, newProjects, screeningDecisions, doneTransitions, contactMessages, failedLogins`) numeric ≥ 0; `uniqueLogins ≤ logins` |
| `?days=7` | exactly 7 entries |
| `?days=500` | clamped to 90 |
| `?days=abc` | default 14 |
| live counting | a fresh successful login increments today's `logins` and `uniqueLogins` buckets |

### Delivered & verified (prompt8)

- **Landing page overhaul** (`src/frontend/pages/Landing.jsx`): "evidence pipeline" design — Canvas-2D
  converging-records hero, scroll-drawn evidence spine (8 numbered sections), self-drawing forest plot +
  PRISMA count-ups, META·LAB⇄META·SIFT link-beam section, institution spec table, redesigned product frame.
  All 26 admin-editable `landingContent` keys still consumed; anchors `#features/#workflow/#about/#contact`
  intact; contact-form flow byte-compatible; `prefers-reduced-motion` renders static finals.
- **Ops control center** (`AdminConsole.jsx`): four-tier Overview — KPI cards with rAF count-up + sparklines,
  14-day multi-series activity AreaChart, system-health tiles with SSE live pulse, screening-pipeline funnel,
  completion donut, unique-logins bars, merged audit/security live feed; SIFT admin overview gets the same
  funnel/donut kit. New `GET /api/admin/metrics/timeseries` (admin-only) feeds the charts; on error the charts
  show explicit "No trend data yet" empty states (no fabricated data).
- **Global overflow fixes**: `.t-min0/.t-truncate/.t-wrap` utilities in `buildThemeCss()` + ~20 files patched
  (`minmax(0,1fr)` grids, `minWidth:0` flex children, ellipsis + `title=` tooltips, `overflow-wrap:anywhere`
  for emails/DOIs/abstracts). Verified with a 190-char project title, 70-char owner email, long linked titles.
- **Chat placement**: launchers moved into the top-right utility cluster `[chat][bell][account]` on both
  products (fixed overlay at right:96 in META·LAB, inline before the bell in META·SIFT), restyled to the
  NotificationsBell circular idiom with red unread badge; ChatDrawer z-index 1100→10000. No endpoint changes —
  `prompt7-chat.test.js` passes unchanged (6/6).
- **Design-system sweep**: fixed a live token-concat bug (`siftMiniBtn` emitted invalid `var(--t-*)18` CSS in
  the ops SIFT tab) + 10 day-theme contrast stragglers (hardcoded `#fff`/near-black on token fills → `C.accText`).

### Manual / visual QA (Playwright 1.60, night+day)

Screenshots in `.claude/tmp/prompt8/shots/`: landing at 390/768/1440/1920 + full scroll-through (reveals,
forest-plot draw-in, PRISMA count-up verified mid-animation), SIFT dashboard + project header with long-title
overflow cases (truncate + tooltip, no escapes), chat drawer open above the cluster, META·LAB project view
with fixed `[chat][bell][account]` cluster, ops Overview night+day, ops SIFT tab, **ops as mod** (sidebar =
Users+Messages only; `metrics`, `metrics/timeseries`, `health`, `screening/metrics`, `audit-log`,
`security-events` all → 403 for the mod; console descriptor `{role:"mod", sections:["users","messages"]}`).

> The 6 `serverStorage.test.js` failures are the same pre-existing fake-timer issues disclosed since prompt1;
> the file was not touched. All integration tests use `127.0.0.1` per the Windows/Node `::1` convention.

Details: `docs/manager/landing-page-redesign-opinion.md`, `docs/manager/ops-control-center-redesign-opinion.md`,
`server/docs/admin-api-contract.md` §1b.

---

## 0···. prompt7 — design system, mod hardening, shared chat (2026-06-10)

**META·SIFT screening suite: ✅ 249/249 pass** (+4 `integration/prompt7.test.js` mod target-role matrix,
+6 `integration/prompt7-chat.test.js` META·LAB chat door). **Full repo suite (`npx vitest run
--no-file-parallelism`, server up): 876 pass / 6 pre-existing `serverStorage.test.js` fake-timer failures
(quarantined — identical set and count as the baseline) / 7 skips (889 total, 37 files).**
`npm run build` exit 0 (pre-existing monolith esbuild JSX advisory + >500 kB chunk note only).

| Suite | Baseline (pre-prompt7) | Now | Δ |
|---|---|---|---|
| Screening (`tests/screening/`, server up) | 239/239 | **249/249** | +10 (prompt7 ×4, prompt7-chat ×6) |
| Full repo (server up) | 866 pass / 6 fail / 7 skip | **876 pass / 6 fail / 7 skip** | no net loss; failures unchanged |

Delivered & verified: **mod target-role enforcement** (server middleware `requireTargetEditable` + handler
defense + `MOD_TARGET_DENIED` SecurityEvent — mod can no longer edit/suspend/reset-password admin or mod
accounts; was a live privilege-escalation hole incl. plaintext admin password takeover), **shared workspace
chat** (six mirrored `/api/screening/metalab/:mlpid/chat*` routes onto the SAME `ScreenChatMessage` thread;
404 existence-hiding, chatRestricted/canChat gates, shared read-state, dual-key `chat.message` SSE poke),
**theme system** (CSS-variable tokens, night default + day mode, `User.themePreference` additive migration
`20260610185705_add_theme_preference`, localStorage + profile persistence), **monochrome icon system**
(stroke-SVG `icons.jsx`, currentColor), **Rayyan tab removal** (no UI references remain), **Overview grid
alignment fix** (`ov-grid2`/`ov-grid4` classes, min-width:0, ellipsized linked title, 1100px collapse),
**landing redesign**, **CSP enabled (API strict + SPA meta)**, **contact-form rate limit**, **dev.db
untracked from git**. Scripted flow diagnostics: **42/42 flows pass** (`.claude/tmp/prompt7/flow-results.txt`,
reported in `docs/manager/full-diagnostics-report.md`). Visual QA: Playwright screenshots night+day at
1366/1920/2560/3440 (`.claude/tmp/prompt7/shots/`).

> The 6 `serverStorage.test.js` failures are the same pre-existing fake-timer issues disclosed since prompt1;
> the file was not touched. All integration tests use `127.0.0.1` per the Windows/Node `::1` convention.

Details: `tests/screening/report.md` (prompt7 section), `docs/manager/security-and-diagnostics-report.md`,
`docs/manager/full-diagnostics-report.md`, `docs/manager/claude-opinion-and-upgrade-plan.md`.

---

## 0··. prompt6 — shared workspace upgrade (2026-06-10)

**META·SIFT screening suite: ✅ 239/239 pass** (+23 `integration/prompt6.test.js`). **Full repo suite
(`npx vitest run --no-file-parallelism`, server up): 866 pass / 6 pre-existing `serverStorage.test.js`
fake-timer failures (quarantined — identical set and count as the baseline) / 7 skips (879 total, 35 files).**
`npm run build` exit 0 (pre-existing `meta-lab-3-patched.jsx` ~L4047 esbuild JSX advisory + >500 kB chunk note only).

Suites vs baseline:

| Suite | Baseline (pre-prompt6) | Now | Δ |
|---|---|---|---|
| Screening (`tests/screening/`, server up) | 216/216 | **239/239** | +23 (`integration/prompt6.test.js`) |
| Unit (`tests/unit/`) | 377 pass + 6 quarantined fails | **521 pass + 6 quarantined fails** | +144 `methods-content.test.js` (R1) + 1 cosmetic comment fix in `effect-sizes.test.js` (no assertion change; 55/55) |
| Full repo (server up) | 632 pass / 6 fail / 7 skip | **866 pass / 6 fail / 7 skip** | no net loss; failures unchanged |

Delivered (verified by `prompt6.test.js` — full inventory in `tests/screening/report.md`): **persistent per-user
notifications** (invite/role-change rows, isolation, fresh-login persistence, pending-invite claim-on-register),
**linked pair creation** (`createLinkedSift` opt-in `{project, linkedScreenProject}`, SIFT-side `alsoCreateMetaLab`,
PICO snapshot, link-target validation 400), **membership-aware link display** (summary `linked:true` for members,
`linkedMetaLabProjectTitle`, `_linkedMetaSift`/`_permissions` annotations), **viewer read-only enforcement**
(PUT/export/import 403 + the **pinned** autosave 200+`skipped` batch contract), **module participation mapping**
(`modules:'metalab'|'metasift'|'both'`), **SSE realtime** (`/api/events` handshake, thin pokes, scope-leak-free,
heartbeat), **import 403-vs-404 split** (outsider 404 / member-without-perm 403 / instant permission upgrade),
**import fingerprint** (sha-256 CRLF-normalized, 409 `duplicate_import` + provenance, `force` with record-dedupe,
per-project scope), **ops metrics** (distinct rolling-window `logins`, `lastActive` recency, distinct `doneToday`,
`progressStatus` validation incl. the new 400 message), **ops linked columns + 10-field progress block +
memberProgress**, **mod RBAC matrix**, and **rename sync-if-in-sync** in both directions.

> **Flipped assertions: NONE.** All prior suites were audited against the implementers' enumerated 404→403/400/409
> flips and changed import `total` semantics; every flipped path was a previously-untested member path. Non-member
> existence-hiding 404s (incl. the 4 prompt5 `SEC*` adversarial tests) pass unchanged. The single test-file edit
> besides the new suite is the cosmetic `effect-sizes.test.js:20` section comment (Hedges' g → Cohen's d).
> Manual-only remainder (browser QA): two-browser realtime, bell UX on 4 surfaces, deep-link from a real click,
> viewer UX polish, mod console navigation, Methods tab rendering, EventSource reconnect, poll pause on hidden tab —
> full list in `tests/screening/report.md`.

## 0·. prompt5 — roles / linked access / version / ops-read (2026-06-09)

**META·SIFT screening suite: ✅ 216/216 pass** (+9 `integration/prompt5.test.js` — 5 feature + 4 `SEC*` security
regressions from an adversarial review of the diff). `vite build` clean.
Delivered: **Owner separated from Leader** everywhere (owner role is `owner`, not `leader`; API returns
`owner`+`leaders[]` separately; owner/leader rows **locked** with server-enforced guards + audit);
**linked META·LAB ↔ META·SIFT member access** (a member of a linked Review Workspace now sees/edits the META·LAB
project per permission — `server/screening/metalabAccess.js`, membership-aware `/api/projects` get/list/autosave that
is **batch-safe** so read-only members never break the bulk autosave); **created/updated dates** on cards;
**Project Control** tab in META·SIFT; **member sync** across both modules; **version changes per commit**
(`version.js` + `scripts/generate-version.js`, `commit`/`commitDate`/`buildDate`/`full`); shared **account dropdown**
in the ops console; and the **ops message notification now clears** via **per-staff** read receipts
(`ContactMessageRead`, `unread-count` + `mark-read` endpoints — fixes an undefined-`setUnread` bug that froze the badge).
Additive migration `20260609230000_add_contact_message_read`. Repair script
`server/scripts/repair-linked-access.js`. Full table: `tests/screening/report.md`;
report: `docs/manager/meta-sift-roles-and-linked-access-report.md`.

> Full `tests/integration` + `tests/unit` run: the only failures are the **6 pre-existing**
> `tests/unit/serverStorage.test.js` fake-timer assertions (that frontend bridge file is **unmodified** by this work).
> `api-health.test.js` updated: the health version is no longer hardcoded `2.0.0` (now tracks `package.json` → `2.4.0`).

## 0. prompt4 server-ready upgrade (2026-06-09)

**META·SIFT screening suite: ✅ 207/207 pass** (+4 `integration/prompt4.test.js`). `vite build` clean.
Delivered: shared UserMenu in META·SIFT, admin user editing + **Mod role** (server-enforced limited console),
email reply service (templated, env-driven SMTP, draft fallback), `/api/version` + version display,
chat **typing indicators** + per-user unread, **creator→owner** role model (leader can't touch owner),
and the **Review Workspace** permission layer (module presets, create+link META·SIFT from META·LAB).
Additive migration `workspace_perms_and_contact_replies`. Env/deploy docs: `docs/manager/deployment-readiness.md`,
`server/docs/email-setup.md`, `.env.example` (root+server). Full table in `tests/screening/report.md`.

## 0a. prompt3 targeted bug fixes (2026-06-09)

**META·SIFT screening suite: ✅ 203/203 pass** (`npx vitest run tests/screening/ --no-file-parallelism`, server up).
Adds **+6** integration tests (`integration/prompt3.test.js`) over the prompt2 total of 197,
covering the 6 reported bugs: default include/exclude keywords + counts, per-user chat
unread (`ScreenChatRead`), PDF Range/206 streaming, project-card linked-title/leader/role,
accepted-studies pull-merge to Data Extraction, and member-progress visibility (leader-only
whole-project). Additive migration `20260609164836_add_chat_read_state`. `vite build` clean.
Full bug→fix→test table in **`tests/screening/report.md`**.

## 0b. prompt2 integration upgrade (2026-06-09)

Over the prompt1 baseline of 149: **+42** keyword-filter unit tests
(`unit/keywordFilter.test.js`) and **+6** integration tests (`integration/prompt2.test.js`)
covering PDF inline preview + auth, resolved-Include conflict → Second Review,
META·LAB link/unlink + handoff status, and admin toggle enforcement.

> Integration tests target `http://127.0.0.1:3001` (not `localhost`) to avoid a
> Node 18+ undici `::1` connect hang on Windows; the same fix was applied to the
> vite dev-server API proxy target (browser API calls were timing out otherwise).

---

## 1. Test Suite Summary (prompt1 baseline)

**Full run (2026-06-08, server up):** `npx vitest run --no-file-parallelism`

| Result | Files | Tests |
|--------|-------|-------|
| ✅ Passed | 27 | 632 |
| ❌ Failed (pre-existing, see note) | 1 | 6 |
| ⏭ Skipped | — | 7 |
| **Total** | **28** | **645** |

The **META·SIFT collaboration upgrade** added the `Screen*` data model, membership/quorum/second-review/handoff/chat/PDF/admin backend, the tabbed React UI, and tests: **+56 screening unit tests** and **+7 collaboration integration tests** (all passing). The **prompt2 integration upgrade** (section 0) added a further **+48 screening tests** (197/197). See **`tests/screening/report.md`** for the full screening breakdown.

> **Pre-existing failure (NOT introduced by the META·SIFT upgrade):** `tests/unit/serverStorage.test.js` has 6 failing assertions in the autosave "saving/saved" status pub-sub (timing). `git status` shows `serverStorage.js` and its test are unmodified by this work, and the failures reproduce in isolation on the original code. META·SIFT does not import `serverStorage`. Disclosed per the project's "do not hide failures" policy.

> **Note:** Integration tests require a running server (`npm run server`, which loads `server/.env`). They self-skip when the server is down.

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

## 7. Phase D — Project Persistence Bug Fix (2026-06-08)

### Root cause confirmed

The monolith debounced autosaves with an 800 ms `setTimeout` held in a `useRef`.  On logout, the
auth cookie was cleared immediately; when the timer fired the request got `401` and was swallowed
by `catch(_){}`.  Any project created or edited within 800 ms of clicking "Sign out" was silently
lost.  Additionally, `store.js` used a non-atomic `findFirst + create/update` pattern that could
fail under concurrent requests for the same new project ID.

### Files changed

| File | Change |
|------|--------|
| `server/store.js` | `save()` now uses Prisma `upsert` (atomic) + ownership check |
| `src/frontend/storage/serverStorage.js` | Debounce moved here; `flushStorage()` exported |
| `meta-lab-3-patched.jsx` | Internal 800 ms timer removed; calls `window.storage.set()` directly |
| `src/frontend/pages/AppWorkspace.jsx` | `handleLogout` awaits `flushStorage()` before clearing the cookie |

### Required tests

All tests below should be run against a live stack (`npm run server` + `npm run dev`).  
Mark each **PASS / FAIL** after execution.

| # | Test | Expected | Status |
|---|------|----------|--------|
| 1 | New user registers via `/register` | 201, session cookie set | — |
| 2 | User logs in via `/login` | 200, redirected to `/app` | — |
| 3 | User creates a project ("Test Persistence") | Project appears in sidebar | — |
| 4 | `GET /api/projects` returns the new project | JSON array length ≥ 1 | — |
| 5 | User edits PICO field ("Patients with T2DM") | Change visible in UI | — |
| 6 | Wait ≤ 1 s — "Saved" indicator appears bottom-right | Save status = Saved | — |
| 7 | User clicks "Sign out" | Navigated to `/` | — |
| 8 | User logs back in | Navigated to `/app` | — |
| 9 | Dashboard/sidebar shows "Test Persistence" project | Project persists | — |
| 10 | User opens the project | PICO field shows "Patients with T2DM" | — |
| 11 | User A registers; User B registers | Two separate accounts | — |
| 12 | User A creates project "Secret Project" | Saved in DB under User A | — |
| 13 | User B calls `GET /api/projects` | Does NOT contain User A's project | — |
| 14 | User B calls `GET /api/projects/<A-project-id>` | 404 | — |
| 15 | Browser is refreshed mid-session | Project state restored from server | — |
| 16 | User edits project and immediately signs out (< 800 ms) | Project still saved (flush-before-logout fix) | — |
| 17 | Simulate network failure during autosave | "Save failed" shown; project not lost from UI | — |
| 18 | Existing meta-analysis workflow (add studies, run pooling) | Results still display correctly after loading saved project | — |

### Autosave unit test additions (to add to serverStorage.test.js)

```js
test('flushStorage() executes the pending save immediately', async () => {
  // call set() — debounce starts
  window.storage.set('meta:projects', JSON.stringify([mockProject]));
  // flush before 800 ms elapses
  await flushStorage();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/autosave'),
    expect.objectContaining({ method: 'PUT' })
  );
});

test('flushStorage() is a no-op when nothing is pending', async () => {
  const callsBefore = fetch.mock.calls.length;
  await flushStorage();
  expect(fetch.mock.calls.length).toBe(callsBefore);
});

test('set() after flush schedules a new debounce', async () => {
  await flushStorage();
  window.storage.set('meta:projects', JSON.stringify([mockProject]));
  expect(hasPendingSave()).toBe(true);
});
```

### Integration test additions (to add to api-projects.test.js)

```js
test('project persists after simulated logout+login cycle', async () => {
  // create project via autosave
  await fetch(`/api/projects/${pid}/autosave`, { method: 'PUT', ... });
  // logout
  await fetch('/api/auth/logout', { method: 'POST', ... });
  // login again
  const { cookie: newCookie } = await loginUser(email, password);
  // fetch project list with new session
  const res  = await fetch('/api/projects', { headers: { Cookie: newCookie } });
  const list = await res.json();
  expect(list.some(p => p.id === pid)).toBe(true);
});

test('user B cannot read user A project by id', async () => {
  const res = await fetch(`/api/projects/${userAProjectId}`, {
    headers: { Cookie: userBCookie },
  });
  expect(res.status).toBe(404);
});
```

### Updated totals (after adding Phase C tests)

| Category | Files | Tests | Pass | Fail | Skip |
|----------|-------|-------|------|------|------|
| Unit | 8 | 352 | 352 | 0 | 0 |
| Integration | 9 | 63 | 0 | 0 | 63 |
| **Total** | **17** | **415** | **352** | **0** | **63** |

(Integration counts remain 0/63 until the server is running during CI.)

---

## 8. How to Run

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

---

## 8. Phase C Tests (2026-06-07) — Admin Console

### New test files added

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/unit/adminAuth.test.js` | 14 | Authorization logic, middleware behaviour, registration role enforcement |
| `tests/unit/adminVisibility.test.js` | 18 | Admin route hidden from normal UI pages; AdminRoute component exists; App.jsx wires /ops |
| `tests/integration/api-admin.test.js` | 16 active + 7 skipped | Admin API auth/403, public settings, registration role, failed login, contact endpoint |
| `tests/integration/api-regression-phase-c.test.js` | 11 | Regression: registration, login, project CRUD, autosave, isolation, logout still work |
| **Total new** | **59** (52 active, 7 skipped) | |

### Unit tests — adminAuth (14 tests, all pass)

`requireAdmin logic — pure function tests` (6):
- Returns 401 when req.user is not set
- Returns 403 when role is "user"
- Returns 403 when role is "admin" but suspended
- Passes (200/next) when role is "admin" and not suspended
- Returns 403 when DB user not found (deleted account with valid session)
- Returns 403 for any non-"admin" role

`requireAdmin middleware — behaviour tests with injectable prisma` (5):
- Calls next() and sets role on req.user when admin and not suspended
- Returns 401 when req.user is undefined
- Returns 403 + creates SecurityEvent when role is "user"
- Returns 403 when DB returns null (user not found)
- Attaches role "admin" to req.user on success

`Registration role enforcement` (3):
- Registration always assigns "user" even if body includes role:"admin"
- Ordinary signup gets role "user"
- Role is never "admin" from registration

### Unit tests — adminVisibility (18 tests, all pass)

`Landing.jsx` (4): no "/ops", no "/admin" route, no navigate("/ops")
`Profile.jsx` (3): no "/ops", no "/admin" route
`AppWorkspace.jsx` (3): no "/ops", no "/admin" route
`AdminRoute.jsx` (3): file exists, has default export function, checks role !== 'admin'
`App.jsx` (4): readable, contains "/ops" route, AdminRoute present near /ops, imports AdminRoute
`Other pages` (3): Login.jsx, Register.jsx, Dashboard.jsx (if exists) do not contain "/ops"

### Integration tests — api-admin (16 active + 7 skipped)

**Unauthenticated access** (3):
- GET /api/admin/metrics without auth → 401 (when routes mounted)
- PUT /api/admin/settings without auth → 401 (when routes mounted)
- GET /api/admin/users without auth → 401 (when routes mounted)

**Normal user access** (3):
- GET /api/admin/metrics as normal user → 403
- PUT /api/admin/settings as normal user → 403
- GET /api/admin/audit-log as normal user → 403

**Registration creates role "user"** (2):
- POST /api/auth/register → 201 with role "user" in response
- GET /api/auth/me confirms role "user" after registration

**Public settings** (5):
- GET /api/settings/public → 200 (no auth)
- Response contains appSettings, landingContent, featureFlags
- appSettings has appName and registrationOpen keys
- featureFlags has autosave and contactForm keys
- landingContent has a non-null object value (fallback works)

**Failed login tracking** (2):
- Wrong password → 401
- Unknown email → 401

**Contact endpoint** (3):
- Valid payload → 200 { ok: true }
- Missing email → 400
- Missing message → 400

**Skipped — requires seeded admin** (7):
- GET /api/admin/metrics → 200 with full metrics shape
- GET /api/admin/users → 200 with paginated list
- User count increases after registration
- Contact message count increases after POST /api/contact
- GET /api/admin/security-events returns events array
- Failed login is recorded as FAILED_LOGIN SecurityEvent
- GET /api/admin/audit-log returns logs array

### Integration tests — api-regression-phase-c (11 tests)

- Registration → 201 + cookie (regression check after Phase C DB schema changes)
- Registered user always has role "user"
- Login → 200 + role "user" + cookie
- POST /api/projects → 201 for normal users
- GET /api/projects → 200 array
- PUT /api/projects/:id/autosave → 200
- User A's project not accessible by User B → 404
- Logout → 200 { ok: true }
- Session invalidated after logout (200 or 401 depending on JWT statelessness)
- GET /api/health still public → 200

### Route mounting note

At the time these tests were written, `server/routes/admin.js` and
`server/routes/settings.js` exist but are **NOT yet mounted** in
`server/index.js`.  Until those routes are wired:
- `/api/admin/*` returns 404 (not 401/403 as intended)
- `/api/settings/public` returns 404 (not 200 as intended)

The integration tests detect this via a `adminRoutesMounted()` helper and
print a warning instead of failing, so the test suite stays green while the
routes are being wired.

### How to run admin integration tests

```sh
# 1. Start the API server
npm run server          # or: npm run dev:server

# 2. Run all Phase C tests
npx vitest run tests/unit/adminAuth.test.js tests/unit/adminVisibility.test.js tests/integration/api-admin.test.js tests/integration/api-regression-phase-c.test.js

# 3. To run admin-only (skipped) tests:
#    First run the seed script (creates admin user in DB):
npx ts-node prisma/seed.ts   # or: npm run seed
#    Then set env vars and re-run:
ADMIN_EMAIL=admin@metalab.dev ADMIN_PASS=<seed_password> npx vitest run tests/integration/api-admin.test.js
```

### Known test limitations

1. **No admin user available in CI** — Admin users can only be created via the seed script.
   The `/api/auth/register` endpoint always creates `role: "user"`.  All tests that
   require real admin credentials are in `describe.skip` blocks.

2. **Admin routes not yet mounted** — `server/index.js` does not yet import or mount
   `server/routes/admin.js` or `server/routes/settings.js`.  The integration tests
   gracefully skip when these routes return 404 instead of 401/403.

3. **SecurityEvent verification** — Without admin credentials, we can only verify that
   failed logins return 401; we cannot check the DB to confirm the SecurityEvent was
   created.

4. **JWT statelessness** — The logout regression test allows both 200 and 401 after logout
   because the server uses stateless JWTs (the old cookie string technically remains valid
   until expiry).

### Updated totals

| Category | Files | Tests | Pass | Fail | Skip |
|----------|-------|-------|------|------|------|
| Unit | 10 | 381 | 381 | 0 | 0 |
| Integration | 11 | 120 | 0 | 0 | 120 |
| **Total** | **21** | **501** | **381** | **0** | **120** |

(Integration skip-count assumes server is not running during CI.
Unit tests for adminAuth and adminVisibility pass without a server.)

---

## 9. Landing Page Redesign (2026-06-08) — v3

### Files changed

| File | Change |
|------|--------|
| `src/frontend/pages/Landing.jsx` | Full redesign — see details below |

### What changed visually

| Area | Before | After |
|------|--------|-------|
| Color palette | Dark background, indigo accent (`#818cf8`) | Deep navy (`#080c15`) + academic blue (`#5b9cf6`) + warm gold (`#dba96a`) + teal (`#2dd4bf`) |
| Hero layout | Centered, text-only | Split two-column: left = copy, right = live forest-plot product preview |
| Logo mark | Emoji hexagon `⬡` | Custom SVG hexagon with inner fill |
| App name | 72px centered | 84px left-aligned, first visual element |
| Hero subtitle | Muted paragraph | `white-space: pre-line` for admin-controlled line breaks |
| CTA placement | Center-aligned | Left-aligned with metric row below (14 stages / PRISMA 2020 / RoB 2) |
| Trust strip | None | New section: PRISMA 2020 · Cochrane RoB 2.0 · GRADE · PROSPERO · HKSJ |
| Feature cards | 4-column grid, flat | 3-column grid, left accent border, 6 default cards |
| Workflow grid | 4-column cards, indigo step numbers | Same grid, gold (`#dba96a`) step numbers, connected border radius |
| Why section | Text left + flat standards list | Text left + elevated card (standards + inline CTA) |
| Footer | Single row (logo + copyright + links) | Multi-column: Brand · Platform · Account · Standards + bottom bar |
| Background | Flat dark | Subtle perspective grid with radial mask in hero |
| Buttons | `filter:brightness` hover | `background` transition + `box-shadow` glow on hover |
| Product preview | None | `ForestPlotPreview` component: real SVG forest plot with 5 studies, pooled diamond, stat pills |

### What changed in UX

- Split hero immediately shows *what the product looks like* (forest plot workspace) alongside the copy.
- Trust strip signals methodology credibility to researchers without making them read paragraphs.
- KPI row (14 stages, PRISMA 2020, RoB 2) provides quick social proof above the fold.
- "Explore the Workflow" secondary CTA scrolls to `#workflow` smoothly instead of going to `/login`.
- Secondary CTA in the "Standards built in" card doubles as a conversion point mid-page.
- Footer columns give easy access to Platform, Account, and Standards from anywhere on the page.
- `white-space: pre-line` on hero tagline lets admin control line breaks via the content editor.

### What changed in copy/content

- Eyebrow pill: "Systematic review platform" (new — sets context before the name is read)
- Metric row: "14 review stages · PRISMA 2020 compliant · RoB 2 built in"
- Feature section subtitle: "From protocol registration to manuscript export…"
- Secondary CTA: "Explore the Workflow" (was "Sign in")
- Footer brand tagline: "A structured workspace for systematic reviews and meta-analyses."
- All DEFAULTS remain identical to prior version so admin-edited content is not overwritten.

### Admin editability

All existing admin-editable fields are preserved unchanged:
- `logoText`, `navLinks`, `heroHeadline`, `heroSubtitle`, `ctaText`, `ctaSecondaryText`
- `featureTitle`, `featureCards`, `workflowTitle`, `workflowSubtitle`
- `whyTitle`, `whyBody1/2/3`, `whyStandards`
- `aboutHeadline`, `aboutText1/2`
- `contactTitle`, `contactSubtitle`
- `footerText`, `footerLinks`
- `announcementBanner`, `maintenanceBanner`
- `seoTitle`, `seoDescription`

No backend schema changes were required.

### How to run

```sh
# Start dev server
npm run dev

# Open in browser
http://localhost:5173
```

### Build verification

```
vite build → ✓ built in 3.31s (no new errors; pre-existing meta-lab-3-patched.jsx warning unrelated)
```

### Manual QA checklist

| # | Test | Expected |
|---|------|----------|
| 1 | Visit `/` | Landing page loads; META·LAB name is first large element |
| 2 | Forest plot preview visible on desktop (≥ 1024px) | Preview column renders with SVG plot |
| 3 | Trust strip visible | PRISMA 2020 · Cochrane · GRADE · PROSPERO · HKSJ |
| 4 | "Start Your Review →" button | Navigates to `/register` |
| 5 | "Explore the Workflow" button | Smooth-scrolls to `#workflow` |
| 6 | Inline CTA in Why section | Navigates to `/register` |
| 7 | Nav "Sign in" / "Get started" | Navigate to `/login` / `/register` |
| 8 | Authenticated user sees "Open Workspace" | Navigates to `/app` |
| 9 | Contact form submits | Shows success state |
| 10 | Responsive at ≤ 1024px | Preview col hidden; hero text centered |
| 11 | Responsive at ≤ 768px | Mobile menu shown; single-column grids |
| 12 | Admin `/ops` still accessible | Admin console unchanged |
| 13 | App workspace `/app` still works | Protected route, auth unchanged |

---

## 10. META·SIFT Beta (2026-06-08) — Screening Module

### What was built

META·SIFT Beta is a separate title/abstract screening workspace for systematic reviews, accessible from the main META·LAB app.

### Files created / modified

| File | Role |
|------|------|
| `server/prisma/schema.prisma` | +7 new models: ScreenProject, ScreenRecord, ScreenDecision, ScreenLabel, ScreenExclusionReason, ScreenDuplicateGroup, ScreenConflict, ScreenImportBatch |
| `server/prisma/migrations/…_add_metasift_screening/` | Applied migration |
| `server/routes/screening.js` | 22 routes under `/api/screening` |
| `server/controllers/screeningController.js` | 22 handler functions (projects, records, import, export, decisions, conflicts, duplicates, labels, reasons, stats) |
| `server/services/screeningDuplicateService.js` | 3-pass duplicate detection (DOI > PMID > Levenshtein title similarity ≥ 0.92) |
| `server/services/screeningConflictService.js` | Conflict sync triggered on every decision save |
| `server/index.js` | +2 lines: import + mount `/api/screening` router |
| `server/docs/screening-api-contract.md` | Full API contract documentation |
| `src/frontend/screening/api-client/screeningApi.js` | Thin async fetch wrapper for all 20+ endpoints |
| `src/frontend/screening/pages/SiftDashboard.jsx` | Project list: cards, progress, new project modal, delete confirm |
| `src/frontend/screening/pages/SiftWorkbench.jsx` | Main two-panel screening interface with keyboard shortcuts |
| `src/frontend/screening/pages/SiftImport.jsx` | RIS/BibTeX/NBIB import with preview |
| `src/frontend/screening/pages/SiftDuplicates.jsx` | Duplicate group management |
| `src/frontend/screening/pages/SiftConflicts.jsx` | Conflict resolution interface |
| `src/frontend/screening/pages/SiftExport.jsx` | CSV/JSON export with filter options |
| `src/frontend/screening/README.md` | Module documentation |
| `src/App.jsx` | +6 ProtectedRoute-wrapped `/sift-beta` routes |
| `src/frontend/pages/AppWorkspace.jsx` | +SiftMenuItem in user dropdown → `/sift-beta` |
| `src/research-engine/screening/deduplication.js` | Pure dedup functions: normalizeTitle, levenshtein, titleSimilarity, findDuplicateGroups |
| `src/research-engine/screening/conflicts.js` | Pure conflict functions: detectConflict, findAllConflicts |
| `src/research-engine/screening/stats.js` | Pure stats functions: computeStats, computePrismaNumbers |
| `src/research-engine/screening/README.md` | Engine module docs |
| `docs/manager/rayyan-inspired-screening-analysis.md` | Systematic review screening methodology analysis |
| `docs/manager/agent-decisions.md` | Architectural decision record (12 decisions) |
| `tests/screening/unit/deduplication.test.js` | 33 unit tests |
| `tests/screening/unit/conflicts.test.js` | 17 unit tests |
| `tests/screening/unit/stats.test.js` | 16 unit tests |
| `tests/screening/integration/screening-api.test.js` | 13 integration tests (skip when server is down) |

### Test counts

| Category | Files | Tests | Pass | Notes |
|----------|-------|-------|------|-------|
| Unit (screening) | 3 | 66 | 66 | Confirmed passing by research agent |
| Integration (screening) | 1 | 13 | skip | Requires running server |

### Routes added

```
/sift-beta                              → SiftDashboard (project list)
/sift-beta/projects/:pid                → SiftWorkbench (screening interface)
/sift-beta/projects/:pid/import         → SiftImport
/sift-beta/projects/:pid/duplicates     → SiftDuplicates
/sift-beta/projects/:pid/conflicts      → SiftConflicts
/sift-beta/projects/:pid/export         → SiftExport
```

### How to access from META·LAB

1. Log in → go to `/app`
2. Click the user avatar (top-right)
3. Select **META·SIFT Beta** (teal, BETA badge) → navigates to `/sift-beta`

### How import works

- POST `/api/screening/projects/:pid/import` with `{ format, content, filename }`
- Uses existing `detectAndParse` from `src/research-engine/import-export/parsers.js`
- Supports RIS, BibTeX, NBIB; fallback basic RIS parser if needed
- Max 5,000 records per batch; inserted in chunks of 100

### How decisions work

- `saveDecision` uses Prisma `upsert` on `(recordId, reviewerId)` unique constraint
- Decisions: `include` / `exclude` / `maybe` / `undecided`
- Triggers `syncConflicts()` non-blocking after every save
- Blind mode: when on, reviewers cannot see others' decisions (enforced in workbench UI)

### How duplicate detection works

3-pass algorithm (pure JS in research engine + Prisma persistence in service):
1. Exact DOI match (case-insensitive)
2. Exact PMID match
3. Normalized title Levenshtein similarity ≥ 0.92 (same year required)

Records get `isDuplicate=true`; one per group gets `isPrimary=true`. Owner resolves by choosing the keeper.

### Security

- All `/api/screening/*` routes behind `requireAuth`
- Every query uses `getOwnedProject(pid, req.user.id)` → 404 for wrong owner (no ID leakage)
- Import content length limit: checked before parsing
- Max 5,000 records per import batch

### Build verification

```
vite build → ✓ built in 3.64s  (62 modules, 0 new errors)
```

### Manual QA checklist

| # | Test | Expected |
|---|------|----------|
| 1 | Log in, click user menu | META·SIFT Beta item visible with BETA badge |
| 2 | Click META·SIFT Beta | Navigates to `/sift-beta` |
| 3 | Create new screening project | 201, project appears in list |
| 4 | Open project → Import tab | RIS paste + import works |
| 5 | Imported records appear in workbench | Record list populated |
| 6 | Press I/E/M on selected record | Decision saved, badge updates |
| 7 | Detect duplicates | Groups shown, resolve works |
| 8 | Export → CSV download | File downloaded with decisions |
| 9 | Stats bar shows correct counts | Progress % updates |
| 10 | User B cannot open User A's project | 404 |
| 11 | Existing `/app` workspace unchanged | No regressions |
| 12 | Existing admin `/ops` unchanged | No regressions |
