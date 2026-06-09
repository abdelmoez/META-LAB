# META·SIFT — Separation & Modularity Plan

## Module Boundaries

META·SIFT Beta is architected as a fully removable module. The main META·LAB app has zero runtime dependencies on META·SIFT.

### Frontend

```
src/frontend/screening/           ← entire META·SIFT frontend
  pages/
    SiftDashboard.jsx             ← /sift-beta
    SiftWorkbench.jsx             ← /sift-beta/projects/:pid
    SiftImport.jsx
    SiftDuplicates.jsx
    SiftConflicts.jsx
    SiftExport.jsx
  api-client/
    screeningApi.js               ← all /api/screening/* calls
  README.md
```

Integration points (minimal, explicit):
- `src/App.jsx` — 6 route entries + 6 imports under `<!-- META·SIFT Beta -->`
- `src/frontend/pages/AppWorkspace.jsx` — `<SiftMenuItem>` in the user dropdown
- `meta-lab-3-patched.jsx` → `RayyanTab` — one launch card (`window.location.href`)
- `src/frontend/pages/admin/AdminConsole.jsx` — `SiftAdminSection` component + nav item

### Backend

```
server/routes/screening.js              ← mounted at /api/screening
server/controllers/screeningController.js
server/controllers/screeningAdminController.js
server/services/screeningDuplicateService.js
server/services/screeningConflictService.js
```

Integration points (minimal):
- `server/index.js` — 2 lines: import + `app.use('/api/screening', screeningRouter)`
- `server/routes/admin.js` — 8 lines: import + 6 route registrations

### Database

All META·SIFT tables use the `Screen*` prefix:
- `ScreenProject`, `ScreenRecord`, `ScreenDecision`, `ScreenLabel`
- `ScreenExclusionReason`, `ScreenDuplicateGroup`, `ScreenConflict`, `ScreenImportBatch`

The only cross-table FK is `ScreenProject.ownerId → User.id` (cascade delete). No main META·LAB tables reference any `Screen*` table.

### Research Engine

```
src/research-engine/screening/
  deduplication.js    ← pure functions, no imports from main app
  conflicts.js
  stats.js
  README.md
```

---

## How to Disable META·SIFT

### Method 1: Admin panel (no code change required)
1. Go to `/ops` → **META·SIFT** section
2. Toggle **META·SIFT Enabled** to OFF
3. Set a maintenance message
4. Click **Save Changes**

Result: all `/api/screening/projects/*` routes return HTTP 503; frontend shows maintenance card; `/api/screening/health` still returns 200; main META·LAB unaffected.

### Method 2: Route-level disable (1-line change)
In `server/index.js`, comment out:
```js
// app.use('/api/screening', screeningRouter);
```
Result: all `/api/screening/*` routes return 404. The frontend META·SIFT pages will show "server error" messages. Main META·LAB continues normally.

### Method 3: Frontend disable (hide the entry points)
In `src/App.jsx`, remove or comment the 6 `<Route path="/sift-beta*">` entries. Direct URL access redirects to `/`. The `RayyanTab` card and user-menu item are still visible but lead to 404; remove them in `meta-lab-3-patched.jsx` and `AppWorkspace.jsx` for a clean UI.

---

## How to Remove META·SIFT Entirely

1. Delete `src/frontend/screening/`
2. Delete `server/routes/screening.js`
3. Delete `server/controllers/screeningController.js`
4. Delete `server/controllers/screeningAdminController.js`
5. Delete `server/services/screeningDuplicateService.js`
6. Delete `server/services/screeningConflictService.js`
7. Delete `src/research-engine/screening/`
8. Delete `tests/screening/`
9. In `src/App.jsx`: remove 6 Sift imports + 6 Sift routes
10. In `server/index.js`: remove 2 lines (import + app.use)
11. In `server/routes/admin.js`: remove Sift admin import + 6 route lines
12. In `AppWorkspace.jsx`: remove `<SiftMenuItem>` and the `SiftMenuItem` function
13. In `AdminConsole.jsx`: remove `SiftAdminSection` + nav entry + `adminApi.screening`
14. In `meta-lab-3-patched.jsx`: remove the META·SIFT launch card block in `RayyanTab`
15. Run `npx prisma migrate` with a migration that drops the `Screen*` tables (optional; SQLite tables are inert)

**Main META·LAB will work normally after steps 1–14.**

---

## Failure Isolation

- The screening router has its own `PrismaClient` instance. If screening DB queries fail, they throw inside the screening handler and return 500 — never propagating to other routes.
- The `checkEnabled` middleware wraps its DB read in try/catch and calls `next()` on failure (fail-open).
- Frontend Sift pages are separate React components — if they throw, React's error boundary in the parent doesn't affect the rest of the app.
- The `SiftMenuItem` in `AppWorkspace` is just a navigation button; if the Sift server is down, clicking it leads to an error page in Sift, not in the main workspace.

---

## v2 additions (collaboration upgrade) — still fully removable

The upgrade added files but kept the module self-contained. To remove META·SIFT, also delete (in addition to the list above):

**Backend** — `server/screening/` (access.js, settings.js), `server/controllers/screeningMemberController.js`, `screeningReviewController.js`, `screeningChatController.js`, `screeningOverviewController.js`, `screeningPdfController.js`, `server/storage/screening-pdfs/`. The new routes live inside `server/routes/screening.js` (already removed with the module). `server/load-env.js` + `server/auth/seedAdmins.js` are generic (keep them).

**Frontend** — `src/frontend/screening/ui/`, `src/frontend/screening/tabs/`, `src/frontend/screening/components/`, `src/frontend/screening/pages/SiftProject.jsx`. Revert the two new `Screen*`-prefixed model blocks + added columns in `schema.prisma` (a drop migration is optional; SQLite tables are inert).

**Monolith** — remove the `MetaSiftPrismaSync` block in `meta-lab-3-patched.jsx` and restore the `ScreeningModule` render in `PRISMATab` (the component was preserved, not deleted), and drop the `s.siftOrigin` badge line.

Main META·LAB continues to work after removal. The single cross-module touch point is the handoff write into a linked META·LAB project's `studies[]`, which simply stops happening.
