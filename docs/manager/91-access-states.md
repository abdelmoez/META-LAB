# 91.md — Application-wide access-state system (design + build log)

Branch: `feat/access-states-91` (isolated worktree; a 2nd Claude session works `main`,
actively on permissions — 89/90 Guided-Screening gating). Base: origin/main @ v3.97.0.

## 1. Existing permission system (map)

PecanRev already has THREE authorization axes with DISTINCT denial shapes:

1. **Project role / membership** — `server/screening/access.js` `getProjectAccess(pid,user)`
   → `{project, member, isOwner, isLeader, role, active, perms, canScreen, canChat,
   canResolveConflicts, canManageMembers, canManageSettings}` or **null → 404**
   (existence-hidden). Roles: owner/leader/reviewer/viewer. Per-member flags in
   `src/research-engine/screening/permissionPresets.js` (`PERMISSION_KEYS`, `USER_ROLES`,
   `PERMISSION_PRESETS`). Owner/leader = full access; members governed by stored flags.
2. **Feature flags** — `server/services/featureAccess.js` `featureAccess(flag,user)` →
   `{allowed, reason:'on'|'adminOnly'|'off'}`. OFF for non-admins → **404 existence-hidden**
   (deliberate security posture — DO NOT convert to 403).
3. **Product tiers / entitlements** — `server/services/entitlementService.js`
   `requireEntitlement/requireLimit` throw `TierLimitError` (status 403, `code:
   TIER_LIMIT_EXCEEDED`); `sendTierLimit(res,err)` writes the structured body from
   `src/shared/entitlements.js buildTierLimitError({feature,currentTier,requiredTier,message})`.
   The OWNER's tier governs project capacity. Client: `useEntitlements` + `src/frontend/entitlements/components.jsx`.

Plus **admin** (`requireAdmin`, `user.role==='admin'`) and 89/90 Guided-Screening site-admin gating.

**The gap 91.md targets:** these three are inconsistent (404 vs 403), only the tier path has
a structured body + user-facing message, and the FRONTEND rarely translates a denial into a
clear, specific, accessible explanation — many controls just render disabled or do nothing.
There is no reusable access-state component set and no restricted-route page.

**Constraint:** the 404-existence-hiding for flags/project-access is intentional. The new
system RESPECTS it: hidden features stay hidden (Hidden-Control pattern); ROLE / TIER /
PROJECT-STATE / DATA / PROCESSING restrictions on VISIBLE features get clear messages.

## 2. Design — one authoritative access-state model, reused everywhere

### 2a. Pure engine `src/shared/access/` (client + server + test safe)
- `restrictionTypes.js` — `RESTRICTION_TYPES` registry: permission / admin_only / tier /
  project_state / insufficient_data / processing / temporarily_unavailable / read_only /
  feature_disabled / flag_off / membership. Each: {id, defaultTitle, tone, icon, category}.
  These are the distinct conditions 91.md's "Distinguish Permission Problems" section demands.
- `accessDecision.js` — `allow()` / `deny(type, {...})` factories → an `AccessDecision`
  `{allowed, restrictionType, title, message, requiredRole, currentRole, requiredTier,
  currentTier, capability, nextAction, technical}`. `buildAccessDenied(decision)` →
  structured HTTP body `{error:'ACCESS_RESTRICTED', restrictionType, message,
  requiredPermission, requiredRole, currentRole, requiredTier, currentTier, capability,
  nextAction}` — generalizes the tier body; the tier path keeps `TIER_LIMIT_EXCEEDED` for compat.
- `capabilities.js` — `CAPABILITIES` registry (canManageProject, canEditProtocol, canRunSearch,
  canManageScreening, canRunScoring, canAccessGuidedScreening, canEditExtraction, canRunAnalysis,
  canApproveManuscriptUpdates, canExportProject, canManageUsers, canViewAdminMetrics, …) — each
  maps to {source, requiredRole?, entitlementKey?, flag?, projectStatePredicate?} + a message.
- `resolveAccess.js` — `resolveCapability(capability, ctx)` → AccessDecision (deterministic).
  ctx = {isAdmin, role, isOwner, isLeader, perms, entitlements, tierId, project (archived,
  stage/data counts), flags}. ONE function both client (pre-emptive UI) and server (enforcement) call.
- `messages.js` — specific, actionable templates (no "Access denied"/"403").

### 2b. Server `server/services/accessResponse.js`
- `AccessError` (typed, carries an AccessDecision) + `sendAccessDenied(res, decision|error)`
  (mirrors sendTierLimit; sets 403). `requireProjectCapability(access, capability, ctx)` →
  throws AccessError when the resolved decision is denied. Additive; existing 404 paths for
  hidden features/flags stay as-is. Wire into a representative set of protected actions.

### 2c. Frontend `src/frontend/components/access/`
- `AccessDeniedState.jsx` (inline + full-page variants — the Restricted-Route page),
  `RestrictedAction.jsx` (accessible wrapper: aria-disabled + lock + tooltip + click-to-explain
  toast/popover — NOT a native disabled button that eats focus), `PermissionGate.jsx`
  (hide | disable | explain modes), `LockedFeatureCard.jsx`, `PermissionTooltip.jsx`,
  `useAccessError.js` (translate an API error body → AccessDecision for a toast/inline message).
  Built on Stitch primitives (S tokens, StitchBadge, Tooltip, toast in overlay.jsx).

### 2d. Wire representative high-value surfaces (per 91.md examples)
Analysis-restricted route card → AccessDeniedState; project-delete owner-only → RestrictedAction;
chat-disabled-by-owner → clear inline; a tier-gated export → LockedFeatureCard; Guided-Screening
admin-only (89/90) → align. The rest adopt the components incrementally (documented).

## 3. Phases
P1 pure engine + tests · P2 server accessResponse + tests · P3 frontend components + tests ·
P4 wire representative surfaces · P5 report + limitations.

## Build log — v3.98.0 (branch `feat/access-states-91`)

### Map confirmed (2/3 agents; frontend agent hit schema cap) — FIVE authz axes
1. Auth/role (`middleware/auth.js`, `requireRole`/`requireAdmin`) → 401/403 + codes.
2. Project membership + per-member caps (`screening/access.js getProjectAccess`, and the
   META·LAB side `screening/metalabAccess.js` `mlAccessFromMember`) → capability bundle or
   null→**404 existence-hidden**. Bundle echoed to the client at screeningController ~L330 +
   projectsController `_permissions` (annotateShared/annotateOwned) — the client's truth.
3. Feature flags (`featureAccess`) → **404 existence-hidden** (non-admin OFF).
4. Product tiers (`entitlementService`) → **403 TIER_LIMIT_EXCEEDED** (`buildTierLimitError`).
5. Chat write (`research-engine/screening/chatPolicy.js canPostProjectChat`) → SHARED
   client+server rule with typed block-reason + human strings. **This is the anti-drift
   template 91.md wants; the new `src/shared/access` engine generalizes it app-wide.**
NOTE: `metalabAccess.canRunAnalysis` is enforced **UI-only** by design (analysis is client-side
computation over already-viewable studies — no server endpoint exposes new data; the existing
comment states the UI gate is the correct enforcement point). This is NOT a security gap.

### Shipped
- **Pure engine** `src/shared/access/` (client+server+test): `restrictionTypes.js` (11 distinct
  conditions — permission/admin_only/owner_only/leader_only/tier/project_state/insufficient_data/
  processing/archived/read_only/feature_disabled/temporarily_unavailable/… with tone+icon+badge+
  default next-action), `accessDecision.js` (`allow`/`deny`/`buildAccessDenied` structured body
  generalizing the tier shape + `parseAccessError` client parse-back, legacy TIER_LIMIT_EXCEEDED
  kept), `capabilities.js` (18 named capabilities → gate spec + specific message), `resolveAccess.js`
  (`resolveCapability(key,ctx)` — the ONE resolver both layers call; `ctxFromProjectAccess` maps
  the app's access bundle). REUSES `permissionPresets` + `entitlements` (real entitlement keys).
- **Server** `server/services/accessResponse.js`: `AccessError` + `requireProjectCapability`
  (throws structured) + `checkCapability` (non-throwing branch) + `sendAccessDenied`/`sendRestriction`
  (mirror `sendTierLimit`). Additive — the deliberate 404 existence-hiding for flags/non-members is untouched.
- **Frontend** `src/frontend/components/access/`: `AccessDeniedState` (inline + full restricted-route
  page), `RestrictedAction` (aria-disabled + lock + tooltip + click→toast; NOT a native disabled
  button — keyboard/SR can discover WHY), `PermissionGate` (hide|inline|restrict + loading skeleton,
  resolves client-side from capability+ctx), `LockedFeatureCard` (tier upsell), `useAccessToast`/
  `parseResponseError` (translate an API 403/404 body → visible toast). All theme-aware (S tokens),
  SR-friendly (no icon-only signal), touch-friendly (click-to-explain, not hover-only).
- **Wired (representative, end-to-end):** the analysis-restricted route in `StitchProjectWorkspace`
  now renders `AccessDeniedState variant="page"` from `resolveCapability('runAnalysis', ctx)` with an
  "Open Project Control" action — replacing the bespoke inline card, unifying the message with the registry.

### Tests — 39 new, all green (full unit suite unaffected)
`tests/unit/access/{engine,server,components}` — restriction taxonomy integrity, decision + structured
body + client parse-back (incl. legacy tier compat + bare statuses), resolver across roles/tier/admin/
archived, server enforcement (throws structured, sends body, tier code preserved), and SSR component
markup (specific message, accessible reason not icon-only, current/required role, real next action,
hide/inline/restrict, loading never flashes protected child).

### Adoption plan (incremental — 91.md accepts phased rollout)
The foundation is app-wide; surfaces adopt it in follow-ups by replacing ad-hoc checks with
`resolveCapability` + the components, and controllers with `requireProjectCapability`+`sendAccessDenied`:
project delete/settings (ControlTab, owner/leader) · chat composer (align with `chatPolicy` block-reason)
· tier features (Word export / NMA / living review → `LockedFeatureCard`, aligning `entitlements/components.jsx`)
· admin/Ops routes (restricted-route page) · every controller `catch` → `sendAccessDenied`.

### Adversarial review round (12 agents, find→verify) — 7 fixed + 1 self-caught
Self-caught before review: 10 restriction icons referenced names absent from the Icon set (Icon
returns null → empty cue); remapped to real names + added a guard test.
Review-confirmed + fixed:
1. [HIGH] `resolveCapability` failed OPEN on an unknown/misspelled capability → `requireProjectCapability`
   would silently authorize. Now FAILS CLOSED (unknown → deny).
2. [HIGH] `ctxFromProjectAccess` perms fallback omitted 5 edit flags → the META·LAB `mlAccessFromMember`
   shape (no perms bundle) wrongly denied legit members. Now reconstructs all flags.
3. [MED] `ctx.active` computed but never enforced → inactive/removed member evaluated as active. Now
   inactive blocks EDIT capabilities (defence-in-depth over the 404 gate).
4. [MED] `PermissionGate` failed OPEN when neither decision nor capability was supplied (leaked children).
   Now fails closed.
5. [LOW] an explicitly-suppressed `nextAction: null` didn't survive the body round-trip (default action
   reappeared). `parseAccessError` now preserves an explicit null.
6. [LOW] `AccessDeniedState` rendered the icon twice (standalone + badge). Removed the standalone.
7. "Click-to-explain no-ops without a ToastProvider" — verified NOT-a-bug (provider mounted at the shell
   root + `onExplain` escape hatch).
+6 regression tests (45 total).

### Known limitations
- Wiring is ONE representative surface + the reusable foundation; the rest is a documented adoption
  plan (kept the footprint on hot shared permission files minimal because a 2nd session is actively
  editing them — 89/90). Not every control is converted yet.
- `canRunAnalysis` stays UI-enforced by design (see NOTE above) — not converted to a server 403.
- No Playwright e2e yet (unit + SSR component tests cover the logic + markup).
- The `chat` capability is a thin wrapper; the authoritative chat rule remains `chatPolicy.js`
  (the access engine defers to it rather than duplicating the muted/restricted nuance).
