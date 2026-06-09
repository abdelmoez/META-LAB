# META·SIFT — QA Report (collaboration upgrade)

**Date:** 2026-06-08
**Scope:** META·SIFT collaborative screening upgrade (prompt1.md, Parts 1–16)
**Result:** ✅ **149/149 screening tests pass** · backend verified end-to-end against the live API

---

## 1. Automated test summary

Run: server up (`npm run server`), then `npx vitest run tests/screening/ --no-file-parallelism`.

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| Deduplication + similarity | `unit/deduplication.test.js` | 50 | ✅ |
| PICO keyword extraction | `unit/keywords.test.js` | 18 | ✅ |
| Inclusion/exclusion highlighting | `unit/highlight.test.js` | 21 | ✅ |
| Decision stats | `unit/stats.test.js` | 16 | ✅ |
| Conflict detection | `unit/conflicts.test.js` | 17 | ✅ |
| Screening API (baseline) | `integration/screening-api.test.js` | 20 | ✅ |
| **Collaboration (new)** | `integration/collaboration.test.js` | 7 | ✅ |
| **Total** | | **149** | ✅ |

Integration tests self-skip when the server is down (`beforeAll` health probe), matching the project convention.

---

## 2. Part 16 "Required tests" coverage

| Required test | Where verified | Status |
|---------------|----------------|--------|
| admin seed works / `ops@metalab.local` works | `collaboration.test.js` (admin login) + startup `seedAdmins()` | ✅ |
| project leader creation (creator → leader) | `collaboration.test.js` | ✅ |
| member add / remove | `collaboration.test.js` (+ smoke-membership) | ✅ |
| role / status changes | `collaboration.test.js` | ✅ |
| one decision per reviewer per record **per stage** | `collaboration.test.js` | ✅ |
| quorum include rule (2 distinct includes → promote) | `collaboration.test.js` | ✅ |
| second review handoff | `collaboration.test.js` | ✅ |
| data-extraction handoff (→ META·LAB `studies[]`, dedupe) | `collaboration.test.js` | ✅ |
| PRISMA auto-update (metalab summary) | `collaboration.test.js` | ✅ |
| PICO keyword extraction | `unit/keywords.test.js` | ✅ |
| inclusion/exclusion highlighting | `unit/highlight.test.js` | ✅ |
| duplicate similarity % (explainable) | `unit/deduplication.test.js` + `collaboration.test.js` | ✅ |
| vertical duplicate view renders | DuplicatesTab (build-verified; see §4) | ⚠ UI |
| per-member opened state | `collaboration.test.js` | ✅ |
| project chat access control | `collaboration.test.js` (members-only + sanitize) | ✅ |
| PDF upload validation | `collaboration.test.js` (mime + magic-byte + replace + delete) | ✅ |
| user ownership / membership security | `collaboration.test.js` (non-member 404, viewer/inactive 403) | ✅ |
| META·SIFT disable does NOT break META·LAB | `collaboration.test.js` | ✅ |

---

## 3. End-to-end flow (API-level, automated)

The 54-step manual QA flow from Part 16 is covered at the API/data layer by the integration tests, which drive a real project through the full lifecycle:

create project → creator is leader → add 2nd reviewer (by email) → import/create records → run duplicate detection (similarity % surfaced) → reviewer 1 + reviewer 2 decisions → one-decision-per-reviewer-per-stage enforced → quorum (2 includes) auto-promotes to Second Review → reviewer cannot finalize / leader accepts → study appended to linked META·LAB `studies[]` (dedupe, `siftOrigin`, `needsReview`) → `metalab/:id/summary` reports PRISMA numbers → reject keeps record with reason → chat (members-only, sanitized, polling) → per-member open-state → PDF upload (valid accepted, fake/non-PDF rejected) → blind mode / viewer / inactive / non-member access controls → admin disable → META·SIFT 503 while META·LAB stays 200 → re-enable.

All of the above is green.

---

## 4. Known limitations / honesty notes

- **Browser UI click-through not performed.** This session has no browser/headless tool, so the React UI was verified by a clean production build (`vite build` ✅, 72 modules) and by exercising every endpoint the UI calls — but a human-style click-through of the 3-column workbench, vertical duplicates, chat panel, etc. was not run. **Recommended next step:** `npm run dev` and walk the 54 steps in a browser (or re-run in a session with a browser tool).
- **Pre-existing unrelated failures:** `tests/unit/serverStorage.test.js` has **6 failing assertions** (autosave "saving/saved" status pub-sub timing). These files are **unmodified by this work** (`git status` clean) and the failures **reproduce in isolation on the original code** — they are pre-existing and unrelated to META·SIFT, which does not import `serverStorage`. Reported here per the "do not hide failures" rule; not fixed because touching the META·LAB autosave core is out of scope and risk-bearing.
- **PRISMA mapping:** while screening is in progress, `excludedTitleAbstract` is computed as `screened − fullTextAssessed`, which lumps still-undecided records with excluded ones until screening completes (documented in `docs/manager/`).

---

## 5. How to reproduce

```bash
# 1. start the API (loads server/.env, seeds admins)
npm run server
# 2. in another shell, run the screening suite
npx vitest run tests/screening/ --no-file-parallelism
# unit-only (no server needed):
npx vitest run tests/screening/unit/
```

The smoke scripts under `scripts/smoke-*.mjs` and `server/scripts/smoke-secondreview.mjs` are standalone equivalents kept for manual debugging.
