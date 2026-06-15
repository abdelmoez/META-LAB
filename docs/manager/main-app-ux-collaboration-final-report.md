# prompt23 — Final Report (v3.5.0)

A workflow/UX/collaboration update across 15 tasks. Shipped in coherent slices;
build green and unit suite green throughout (6 pre-existing `serverStorage` timing
failures are unrelated/baseline).

1. **Left-panel Projects removal** — the redundant "Projects" switcher block was
   removed from the in-project sidebar (`meta-lab-3-patched.jsx`).
2. **Return to landing** — the "Back to Projects" button (→ `/app` via
   `onBackToProjects`) is the single clean path back; routing/deep-links unchanged.
3. **Sort persistence** — per-user, validated localStorage
   (`metalab.dashboardPrefs.<userId>`) for sort/filter/view/show-archived; helpers
   in `projectLanding.helpers.js`, hydrate/persist effects in `ProjectLanding.jsx`.
4. **Stepper line + counts** — connecting line behind the pips + a real per-step
   count line (`screeningSteps.js` `count`, `StepIndicator` connector); still
   non-clickable.
5. **Conflict → T&A sync** — `ScreeningTab` subscribes to `decision.saved`;
   `ConflictsTab` calls `refreshProject` after resolve; `SiftProject` refreshes the
   stepper summary. No manual refresh needed.
6. **Field locking** — see `project-presence-and-field-locking.md`. TTL-expiring,
   fail-open, demonstrated on the shared *Required reviewers* setting.
7. **Lock timeout/heartbeat** — heartbeat 30s, active window 75s, lock TTL 75s
   (refreshed by heartbeat); acquire on focus, release on blur/save; hard closes
   covered by TTL.
8. **Presence** — in-memory manager over SSE; `GET/POST` presence + lock endpoints,
   member-gated; `useProjectPresence`/`useFieldLock`.
9. **Active-users indicator** — `active / total` chip + hover popover (name,
   location, "editing <field>") in the project utility area.
10. **Members-tab location** — green "Active now · <location>" / "editing <field>"
    per member; owner→leaders→members→viewers grouping preserved.
11. **Day theme default** — `ThemeContext` fallback now `'day'`; saved prefs win.
12. **Create-project copy** — "Screening is built in …" block removed.
13. **PICO Time Frame** — controlled dropdown + validated custom year range; legacy
    text honoured.
14. **Comparator mandatory** — required across indicator, grid, readiness,
    stepStatus, audit.
15. **Inclusion/exclusion criteria** — structured add/removable rows
    (`CriteriaList`) serialising to the same bullet string (backward compatible).
16. **Import → Duplicates** — detect-then-navigate with "Preparing duplicate
    review…"; lands on Step 2; no race/empty error.
17. **Duplicate "keep all"** — `keepAll` resolution keeps both records, resolves the
    group, audits + emits.
18. **Show-more abstract** — per duplicate record, 3-line clamp + toggle.
19. **Reviewer quorum** — all displayed quorum labels follow
    `requiredScreeningReviewers` (Overview/Final Review); promotion already enforced.
20. **Backend changes** — `presence.js` (manager), `presenceController.js`,
    screening routes (+5), `screeningController.resolveDuplicateGroup` (keepAll +
    audit + emit), `screeningOverviewController` (effective quorum).
21. **Frontend changes** — monolith (sidebar, PICO, create copy), `ProjectLanding`,
    `projectLanding.helpers`, `ThemeContext`, `SiftProject`, `SiftImport`,
    `DuplicatesTab`, `ScreeningTab`, `ConflictsTab`, `SecondReviewTab`,
    `ProjectControlTab`, `MembersTab`, `OverviewTab`, `Stepper`, `screeningSteps`,
    `screeningApi`, new `usePresence` hook + `PresenceIndicator`.
22. **DB / migration** — **none**. Presence/locks are in-memory; PICO/criteria are
    JSON; sort prefs are localStorage. (A `User.dashboardPreferences` column is a
    documented future option for cross-device sync.)
23. **Security/privacy** — presence/lock endpoints are `requireAuth` +
    `getProjectAccess`; only owners/active members participate; pokes carry no
    payload; no cross-project activity leaks.
24. **Tests added** — `dashboardPrefs` (5), `screeningSteps` counts (+1),
    `stepIndicator` count (+1), `presence` (8); plus prompt22 follow-ups. Unit
    suite green aside from the 6 pre-existing `serverStorage` fails.
25. **Manual QA** — not run in this environment (no local server/DB); verified via
    build + unit logic tests + code review. Recommended manual QA per the prompt's
    checklist before release.
26. **Build/test results** — `vite build` green (v3.5.0); `vitest run tests/unit`
    green except baseline.
27. **Version** — **3.5.0** (minor; presence, locking, PICO, screening workflow).
28. **Commits** — shipped in parts: pt1 UX/sort/stepper/quorum/conflict, pt2
    import→duplicates, pt3 PICO, pt4 presence+locking, plus this docs+version commit.
29. **Push** — to `main` (see commit log).
30. **Known limitations** — most resolved in the v3.5.1 follow-up:
    - ✅ **RESOLVED** — presence now spans **all monolith stages** (PICO, Data
      Extraction, Analysis, …) scoped to the linked screening project, and **PICO
      fields (P/I/C/O) are field-locked**; monolith + screening users share one
      presence room. (Screening Settings field lock already shipped.)
    - ✅ **RESOLVED** — dashboard prefs are now **cross-device**: server-backed via
      `User.dashboardPreferences` (PUT/GET `/api/profile`), localStorage as the
      instant/offline fallback.
    - ✅ **RESOLVED** — backend presence/locking/prefs are now **runtime-tested**
      via two-session integration tests against a live server (DB stood up locally).
    - ⚠️ **Remaining (architectural):** single-process SSE bus (no Redis) → presence
      lives per-instance. This is **inherent to the current single-Node + SQLite
      deployment and shared by ALL realtime features** (chat, pokes), not new to
      presence; the polling fallback preserves correctness. Multi-instance would
      need a Redis pub/sub broker (out of scope — would change the deployment model).
31. **Recommended next steps**
    - Extend presence + field locks to monolith PICO/extraction fields (infra ready).
    - Add `User.dashboardPreferences` for cross-device dashboard prefs.
    - Per-criterion category/required-flag on top of `CriteriaList`.
    - Redis pub/sub for multi-instance presence.
    - Run the full manual QA checklist with two browser sessions.
