# P1 Audit — Authorization, Validation, Rate-Limiting, Error-Handling, Audit Logging

Scope: exact helpers + signatures P1 ("Pecan Search Engine") endpoints must reuse for project authorization,
admin-only Ops endpoints, request validation, rate-limiting, typed error responses, and audit logging.
All paths relative to repo root `H:/META-LAB/META-LAB`. Read-only analysis; no code changed.

The single closest precedent for P1 is the **Search Engine** (`server/searchEngine/`, prompt SearchEngine,
flag `searchEngine`). P1 should clone its structure: mount with `requireAuth` + dedicated limiter, gate each
handler on a feature flag (404 when off), authorize per-project via `resolveProjectAccess`, persist via the
shared `WorkflowModuleState` infra, audit via `recordWorkflowAudit`.

---

## 1. Authentication — `requireAuth`

File: `server/middleware/auth.js`
- `export async function requireAuth(req, res, next)` — `auth.js:61`.
  - Reads httpOnly cookie `metalab_session` (name from `sessionCookieName()` in `server/config/cookies.js:29`).
  - Verifies JWT via `verifyToken(token)` (`server/auth/jwt.js`).
  - Live account-state check: `loadAuthState(userId)` (`auth.js:41`) reads `User.suspended` + `User.sessionEpoch`
    with a 15s in-memory cache; suspended → `403 {error, code:'ACCOUNT_SUSPENDED'}`; epoch mismatch →
    `401 {error, code:'SESSION_REVOKED'}`; missing user → clears cookie, `401`.
  - On success sets **`req.user = { id, email, role }`** (`auth.js:91`), role defaulting to `'user'`. Calls
    `touchLastActive` (throttled `lastActive` write + `APP_ACTIVE` usage event).
  - Fail-OPEN on a transient DB error during the state check (proceeds on token identity) — `auth.js:94-102`.
- `export function invalidateAuthState(userId)` — `auth.js:37` — drop the cache entry (called on suspend / password change).
- Failure shape on no/invalid token: `401 { error: 'Authentication required' }` / `401 { error: 'Invalid or expired session' }`.

P1 takeaway: do NOT add `requireAuth` per-route; mount it once at the router mount in `server/index.js` (see §5).
Inside handlers always use `req.user.id`. Never trust `req.user.role` for admin gating — use `requireAdmin` (DB-verified).

---

## 2. Project authorization helpers (the seam P1 must use)

### 2a. `resolveProjectAccess` — THE helper for per-project P1 endpoints
File: `server/services/workflowState.js`
- `export async function resolveProjectAccess(projectId, userId)` — `workflowState.js:58`.
  - Owner path: `getById(projectId, userId)` (`server/store.js:91`) → `{ canView:true, canEdit:true, readOnly:false, isOwner:true, role:'owner', ownerId:userId }`.
  - Member path: `getMetaLabMemberAccess(projectId, userId)` → maps to
    `{ canView, canEdit, readOnly, isOwner:false, role, ownerId }`.
  - Returns `null` when the user has NO view access. **Convention: null → respond `404` (existence-hiding), never 403.**
  - `ownerId` is surfaced so callers can address realtime pokes via `emitToMetaLabProject(projectId, ownerId, …)`.

This is exactly what `searchEngineController.gate` (below) uses. P1 should reuse it verbatim.

### 2b. `getMetaLabMemberAccess` — the underlying linked-workspace resolver
File: `server/screening/metalabAccess.js`
- `export async function getMetaLabMemberAccess(metaLabProjectId, userId)` — `metalabAccess.js:70`.
  Returns `{ role, canView, canEdit, readOnly, canExport, canAssessRiskOfBias, screenProjectId, screenProjectTitle, ownerId }` or `null`.
  Security invariants enforced (defense in depth): linked `ScreenProject` must be `deletedAt:null`; member `status:'active'`;
  the linked `Project` must exist, be live (`deletedAt:null`), and be owned by the workspace owner (`metalabAccess.js:94-98`).
- `export function mlAccessFromMember(m)` — `metalabAccess.js:22` — pure row→flags map (owner/leader = full).
- `export async function getRobMemberAccess(metaLabProjectId, userId)` — `metalabAccess.js:44` — RoB-specific grant
  (gated on `canAssessRiskOfBias`, not on `canViewMetaLab`). The `resolveRobAccess`-style precedent.
- `export async function listSharedMetaLabAccess(userId)` — `metalabAccess.js:108` — list member-shared projects.

### 2c. Project-controller access/error pattern (the established convention to copy)
File: `server/controllers/projectsController.js`
- `getProject` (`projectsController.js:300`): owner via `getById`; else `getMetaLabMemberAccess` → `null` → `404 {error:'Project not found'}`.
- `updateProject` (`projectsController.js:341`): member `!acc.canEdit` → **`403 {error:'Read-only access — you do not have permission to edit this project'}`**.
  Special: thrown `err.code === 'FOREIGN_PROJECT'` → `403`.
- Standard catch: `console.error('[projects] <fn> error:', err.message); res.status(500).json({error:'Internal server error'})`.

### 2d. Screening-side access (only if P1 touches ScreenProject directly)
File: `server/screening/access.js`
- `export async function getProjectAccess(pid, user)` — `access.js:32`. Returns `null` when project missing/soft-deleted/no access
  (→ 404). Shape includes `{ project, member, isOwner, isLeader, role, active, perms, canScreen, canChat, canResolveConflicts, canManageMembers, canManageSettings }`.
- `export async function writeAudit(projectId, actor, action, { entityType, entityId, details })` — `access.js:124` — screening-scoped
  audit into `ScreenAuditLog` (never throws; details JSON-stringified + `.slice(0,4000)`).
- `export async function findUserByEmail(email)` — `access.js:118`.

---

## 3. Admin / role authorization (for P1's Ops-only endpoints)

File: `server/middleware/requireRole.js`
- `export function requireRole(allowedRoles)` — `requireRole.js:13` — factory returning `roleGuard(req,res,next)`.
  - ALWAYS re-verifies role from DB (`prisma.user.findUnique select:{role,suspended}`); JWT role is never trusted.
  - On deny writes a `SecurityEvent` `type:'ADMIN_ACCESS_DENIED'` (best-effort) and returns **`403 {error:'Forbidden'}`**.
  - On allow sets authoritative `req.user.role` from DB.
  - `requireAuth` MUST run before it.
- `export const requireAdminOrMod = requireRole(['admin','mod'])` — `requireRole.js:55`.
- `export async function requireTargetEditable(req, res, next)` — `requireRole.js:70` — mods may only mutate role-`'user'` targets;
  attaches `req.targetUser`; writes `SecurityEvent type:'MOD_TARGET_DENIED'` on deny.

File: `server/middleware/requireAdmin.js`
- `export const requireAdmin = requireRole(['admin'])` — `requireAdmin.js:11`. **Use this for P1 Ops-only endpoints.**
- `export function requirePermission(permission)` — `requireAdmin.js:27` — finer-grained admin-or-granted-mod gate
  (`MOD_PERMISSIONS` set = manage_users/view_users/reply_messages/manage_messages). Probably not needed by P1.

Admin route conventions (`server/routes/admin.js`):
- `requireAuth` is applied at the MOUNT (`app.use('/api/admin', requireAuth, adminRouter)` — index.js:248); authorization is
  applied PER ROUTE inside the router (`requireAdmin` / `requireAdminOrMod` / `requireTargetEditable`).
- A router-level `adminLimiter` (300/15min prod) is applied via `router.use(adminLimiter)` (`admin.js:116-127`), with cheap polling
  GETs exempt (`POLL_EXEMPT_GETS`).
- Place STATIC paths (`/projects/overview`) BEFORE `/:id/*` routes so they are not shadowed (admin.js:178-184).

P1 Ops endpoints: add them inside `adminRouter` as `router.<verb>('/pecan-search/...', requireAdmin, <handler>)`,
OR mount a P1-specific admin sub-router. Either way the handler runs after `requireAuth` (mount) + `requireAdmin` (route).

---

## 4. Request validation (Zod)

`zod` IS a dependency (`server/package.json:26`). Validation is applied as middleware at the route boundary in TWO places only today.

File: `server/middleware/validateBody.js`
- `export function validateBody(schema)` — `validateBody.js:30` — returns middleware that:
  - rejects prototype-pollution keys anywhere via `hasDangerousKeys` (`validateBody.js:17`) → `400 {error, code:'INVALID_BODY'}`.
  - `schema.safeParse(req.body)`; on failure → **`400 { error:'Validation failed.', code:'VALIDATION_ERROR', fieldErrors:[{path,message}] }`** (first 50 issues).
  - on success replaces `req.body` with `result.data`. Authorization is intentionally NOT done here.
- `export function hasDangerousKeys(value, depth=0)` — `validateBody.js:17`.

File: `server/schemas/requestSchemas.js` — canonical Zod schema location.
- `export const autosaveProjectSchema` — `requestSchemas.js:21` — `.passthrough()` envelope (name + array bounds).
- `export const importReferencesSchema` — `requestSchemas.js:29` — strict `{ text, projectId }` (strips unknown keys).

Wiring example (`server/routes/projects.js:38`): `router.put('/:id/autosave', validateBody(autosaveProjectSchema), autosaveProject)`.

P1 takeaway: define new Zod schemas in `server/schemas/requestSchemas.js` and wire them with `validateBody(...)` on each
mutating route. NOTE: most existing controllers (admin, searchEngine) still hand-validate inline with manual type checks
(e.g. `searchEngineController.putSearch` coerces `concepts`/`overrides`/`ignored` with `Array.isArray`/typeof + `.slice` caps
— `searchEngineController.js:139-160`). Either pattern is accepted in this codebase; `validateBody` + Zod is the newer/preferred boundary.

---

## 5. Rate-limiting

`express-rate-limit` (`server/package.json:20`), imported in `server/index.js:11` as `rateLimit`.
Limiters are defined in `server/index.js` and applied AT THE MOUNT:
- `authLimiter` (20/15min prod) — `index.js:96`, mounted `index.js:215`.
- `contactLimiter` (8) — `index.js:105`.
- `inviteLimiter` (30) — `index.js:114`.
- `institutionLimiter` (120) — `index.js:124`.
- **`searchEngineLimiter` (600 prod / 2000 dev) — `index.js:134`, mounted `index.js:281`** — the P1 precedent.
- `waitlistLimiter` (20) — `index.js:146`.
- `adminLimiter` (router-level, 300) — `server/routes/admin.js:116`.

Standard limiter shape:
```js
rateLimit({ windowMs: 15*60*1000, max: process.env.NODE_ENV === 'production' ? <N> : 1000,
  message: { error: 'Too many requests, please try again later' }, standardHeaders: true, legacyHeaders: false });
```

Mount pattern for the Search Engine (THE pattern P1 should copy), `index.js:281`:
```js
app.use('/api/search-builder', requireAuth, searchEngineLimiter, searchEngineRouter);
```

P1 takeaway: add a `pecanSearchLimiter` in index.js and mount
`app.use('/api/pecan-search', requireAuth, pecanSearchLimiter, pecanSearchRouter)`. If P1 proxies external DB APIs with
server-side keys (PubMed/Crossref/etc.), bound it like `searchEngineLimiter`. SSE endpoints must NOT sit under a tight limiter
(see `/api/events` and `/api/notifications` which have their own bare mounts — index.js:231,269).

---

## 6. Error-response conventions

- Global handler `server/middleware/errorHandler.js` — `export function errorHandler(err, req, res, next)` (`errorHandler.js:8`),
  mounted LAST. `status = err.status || err.statusCode || 500`. **≥500 → logs full error, returns `{error:'Internal server error'}`
  (never a stack trace). 4xx → returns `{ error: err.message || 'Bad request' }`.**
- Per-controller convention (the dominant style): wrap body in try/catch, `console.error('[<area>] <fn> error:', err.message)`,
  `return res.status(500).json({ error: 'Internal server error' })`.
- Standard status/shape vocabulary observed:
  - `401 { error: 'Authentication required' }` (no/invalid auth).
  - `403 { error: 'Forbidden' }` (admin/role deny) OR `403 { error: 'Read-only access …' }` (project edit deny).
  - `404 { error: 'Project not found' }` / `404 { error: 'Not found' }` (feature-flag OFF, or null access — existence-hiding).
  - `400 { error, code:'VALIDATION_ERROR', fieldErrors:[…] }` (validateBody) and `400 { error, code:'INVALID_BODY' }` (proto-pollution).
  - `422 { error }` for semantic-validation rejections (e.g. theme patch — `adminController.updateThemeSettings` `:1541`).
  - `409 { error, code:'STATE_CONFLICT' }`-style for optimistic-concurrency conflicts (workflow-state PATCH).
  - Auth-specific codes on `req.user`: `ACCOUNT_SUSPENDED`, `SESSION_REVOKED`.

P1 takeaway: use the same vocabulary. Feature-flag OFF → `404 {error:'Not found'}`. No project view access → `404 {error:'Project not found'}`.
Read-only member on a write → `403`. Validation failure → `400` via `validateBody`. Never leak internals on 500.

---

## 7. Feature-flag gating (P1 must register a flag)

P1 should be flag-gated exactly like `searchEngine`. Two pieces:

1. Register the default in `server/controllers/settingsController.js`:
   - `DEFAULTS.featureFlags` JSON (`settingsController.js:44-82`) — add `pecanSearch: false` (or chosen key) alongside
     `searchEngine: false` (`:68`). `export function defaultFeatureFlags()` (`settingsController.js:108`) parses it; admin +
     public settings endpoints MERGE defaults under the stored row so a newly-added flag auto-surfaces in Ops (the merge at
     `adminController.js:1498` and `settingsController.js:179`). Without registering here the flag is invisible in Ops.
2. Gate each handler. Precedent: `searchEngineEnabled()` (`searchEngineController.js:57`) reads the `featureFlags` SiteSetting and
   returns `JSON.parse(row.value).searchEngine === true`. `workflowState.workflowStateEnabled()` (`workflowState.js:43`) is the same
   pattern. When off → `404 {error:'Not found'}`.

Admin flag write path: `PUT /api/admin/feature-flags` → `updateFeatureFlags` (`adminController.js:1507`), which
`upsertSetting('featureFlags', body, req.user.id)` then `logAdminAction(req,'UPDATE_SETTING','SiteSetting','featureFlags',…)`.

---

## 8. Audit logging

### 8a. Admin/Ops audit — `logAdminAction`
File: `server/utils/audit.js`
- `export async function logAdminAction(req, action, entityType, entityId, details)` — `audit.js:13`.
  Writes `AdminAuditLog { adminId:req.user.id, action, entityType, entityId(String), details(JSON.stringify), ip, userAgent }`.
  **Never throws** (catches + console.error). Use this for P1 Ops-only mutations.
- Usage precedent: `updateFeatureFlags` `:1511`; `updateThemeSettings` `:1554`.

### 8b. Project/workflow audit — `recordWorkflowAudit` (use this for P1 per-project saves)
File: `server/services/workflowState.js`
- `export async function recordWorkflowAudit({ projectId, moduleKey, action, revision, user, details })` — `workflowState.js:181`.
  Writes `WorkflowStateAudit { projectId, moduleKey, action, revision, userId, userName, details(JSON) }`. Best-effort; never blocks.
- `export async function getWorkflowAudit(projectId, { limit=50 })` — `workflowState.js:200` (cap 200).
- Precedent: `searchEngineController.putSearch` calls it with `action:'SEARCH_UPDATED'` (`searchEngineController.js:167`).
  P1 should pick a stable action name (e.g. `'PECAN_SEARCH_RUN'`).

### 8c. Audit formatting / severity catalogue — `src/shared/auditFormat.js`
Pure, dependency-free, imported by BOTH the Ops UI (`AdminConsole.jsx`) and the server (`adminController.js`).
- `export const SEVERITY` (`auditFormat.js:17`), `SEVERITY_ORDER` (`:18`).
- `export const AUDIT_ACTIONS` (`:43`) — map `ACTION → { severity, category, label, describe(d,log) }`. **Add a P1 entry here**
  (e.g. a `PECAN_SEARCH_*` action) so it renders with a human description + correct severity in Ops; otherwise it falls back to a
  humanised label at INFO severity (`describeAuditEvent` `:126`). Note: the `AUDIT_ACTIONS` catalogue covers `AdminAuditLog.action`
  values (logAdminAction). `WorkflowStateAudit.action` values (recordWorkflowAudit) are NOT surfaced through this catalogue today.
- `export const SECURITY_TYPES` (`:93`) — `ADMIN_ACCESS_DENIED`/`MOD_TARGET_DENIED`/`FAILED_LOGIN`/`RATE_LIMITED`/… catalogue.
- Helpers: `describeAuditEvent(log)` `:126`, `describeSecurityEvent(ev)` `:140`, `auditActionWhereForSeverity(severity)` `:157`,
  `securityTypeWhereForSeverity(severity)` `:168` (severity → Prisma WHERE), `parseDetails` `:21`, `extractChanges` `:116`, `humanizeAction` `:109`.

### 8d. SecurityEvent (auth/abuse anomalies)
Written directly via `prisma.securityEvent.create({ data:{ type, userId, email, ip, userAgent, details } })` — see
`requireRole.js:28` (`ADMIN_ACCESS_DENIED`) and `:82` (`MOD_TARGET_DENIED`). Best-effort (`.catch(()=>{})`).
P1 generally won't write these directly unless it needs an abuse/anomaly signal.

---

## 9. Concrete P1 endpoint recipes

### Per-project P1 endpoint (run/search/import for a META·LAB project)
```js
// route: app.use('/api/pecan-search', requireAuth, pecanSearchLimiter, pecanSearchRouter)  // index.js
async function gate(req, res) {                                  // copy of searchEngineController.gate
  if (!(await pecanSearchEnabled())) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await resolveProjectAccess(req.params.projectId, req.user.id);   // workflowState.js:58
  if (!access || !access.canView) { res.status(404).json({ error: 'Project not found' }); return null; }
  return access;
}
// mutating handler:
const access = await gate(req, res); if (!access) return;
if (!access.canEdit) return res.status(403).json({ error: 'Read-only access' });
// ... do work; persist via patchModuleState(...) if it belongs in WorkflowModuleState ...
await recordWorkflowAudit({ projectId, moduleKey:'pecanSearch', action:'PECAN_SEARCH_RUN', revision, user:req.user, details });
emitToMetaLabProject(projectId, access.ownerId, { type:'pecanSearch.updated' }, { exclude: req.user.id });
```
NOTE: if P1 persists state in `WorkflowModuleState`, add its key to `MODULE_KEYS` (`workflowState.js:26`) — that array is a
strict whitelist; an unlisted moduleKey cannot be written.

### Ops-only P1 endpoint
```js
router.get('/pecan-search/...', requireAdmin, handler);   // inside adminRouter; requireAuth already at mount
// in handler, on mutation:
await logAdminAction(req, 'UPDATE_SETTING'|'PECAN_SEARCH_*', 'SiteSetting'|<entityType>, <entityId>, { ...details });
```
Add the action to `AUDIT_ACTIONS` in `src/shared/auditFormat.js` for clean Ops rendering.

---

## 10. Top risks / gotchas for the implementer

1. **404-not-403 for no-access.** The codebase hides existence: `resolveProjectAccess` → null → respond `404`, NOT 403.
   Only respond `403` when the user CAN view but lacks edit (read-only member) or fails an admin/role gate.
2. **Feature-flag default MUST be registered** in `settingsController.DEFAULTS.featureFlags` (`:44`) or it is invisible in Ops
   (the merge-defaults logic at `adminController.js:1498` / `settingsController.js:179` only fills keys that exist in DEFAULTS).
3. **`MODULE_KEYS` whitelist** (`workflowState.js:26`) blocks arbitrary `moduleKey` writes — add P1's key if reusing WorkflowModuleState.
4. **`requireAuth` fails OPEN on transient DB errors** (`auth.js:94`) — do NOT assume the account-state check ran; never rely on it
   as your only suspension gate for privileged P1 actions (admin routes re-verify via `requireRole`'s own DB read).
5. **`req.user.role` from JWT is NOT authoritative** until a `requireRole`/`requireAdmin` runs (which overwrites it from DB).
   Never branch on `req.user.role` for privilege without going through those guards.
6. **Audit must never throw / never block.** `logAdminAction`, `recordWorkflowAudit`, `writeAudit` are all best-effort by design —
   keep that contract; do not `await`-then-fail the main op on an audit error.
7. **Two validation styles coexist.** Prefer `validateBody(zodSchema)` at the route (newer), but inline `Array.isArray`/typeof + `.slice`
   caps (searchEngineController) is the accepted fallback. Whatever you pick, BOUND array/string sizes — there are no implicit caps.
8. **Body-size limits:** global JSON limit is 10MB, except `/import` and `/import/start` paths get 64MB (`index.js:167-170`). If P1
   auto-import payloads are large, name the endpoint to match that suffix regex or add an explicit larger `express.json` for it.
9. **Mount ordering matters.** Public/pre-auth mounts must precede the bare `app.use('/api', importExportRouter)` (`index.js:245`)
   which applies `requireAuth` and would 401 anything after it. Static admin paths must precede `:id` routes.
10. **SSE not under tight limiter.** If P1 streams progress, mount its SSE separately (pattern: `/api/events`, `/api/notifications`)
    rather than behind the search limiter.
11. **External-API keys stay server-side.** The Search Engine proxies NLM with a server-side NCBI key and degrades to null/[] on
    error rather than 500 (`searchEngineController.postMesh/postCount`). P1's DB-API integrations should follow the same
    proxy-and-degrade pattern; never expose provider keys to the client.
