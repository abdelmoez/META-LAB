# Architecture Rescue — Safety Baseline (prompt38, Phase 0)

Recorded before any code change, so a regression is attributable and reversible.

| Item | Value |
|------|-------|
| Branch | `main` (changes are additive + feature-flagged → safe; see rollback) |
| Version at start | 3.19.2 (`52f0164`) |
| Monolith size at start | `meta-lab-3-patched.jsx` = 9095 lines / ~572 KB |
| Uncommitted changes | none tracked (only untracked `.claude/Prompts/*`, `template/` — never staged) |
| Build baseline | `npm run build` → green |
| Test baseline | unit + screening-unit gate green (1357 before this work) |
| DB (dev) | SQLite `server/dev.db`; prod = Postgres via VPS `prisma db push` |

## Risky files (touch with care)
- `meta-lab-3-patched.jsx` — the 9k-line monolith (single biggest risk).
- `server/store.js` — project blob save (content-diff + resurrection guards).
- `src/frontend/storage/serverStorage.js` — the `window.storage` autosave bridge.
- `server/prisma/schema.prisma` — schema (only additive changes; `db push` strict).

## This change's safety posture
- **Feature flag `serverBackedWorkflowState` (default OFF).** With it off, every
  new endpoint 404s and the monolith renders the legacy PICO editor unchanged →
  **zero behavior change** in production.
- **Additive DB only.** One new table `WorkflowModuleState` (+ a back-relation on
  `Project`). No column drops, no resets, `prisma db push`-safe.
- **Strangler-fig.** The new Protocol module lives *beside* the legacy `PICOTab`;
  a flag swaps them. Nothing is deleted.

## Rollback plan
1. **Instant disable (no deploy):** Ops › Feature Flags → turn
   `serverBackedWorkflowState` OFF. The app immediately reverts to the legacy
   blob-backed protocol path; new module-state writes stop.
2. **Code revert:** `git revert <commit>` — all changes are in new files + small,
   localized, flag-gated edits to the monolith/index.js/settings.
3. **DB:** the `WorkflowModuleState` table is additive and inert when the flag is
   OFF; it can be left in place (no data loss) or dropped later if desired. The
   legacy `Project.data` blob remains the source of truth for the protocol while
   the flag is OFF, and a back-compat mirror while ON, so no project data is lost
   on rollback.
