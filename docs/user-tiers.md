# User Tiers & the Three-Axis Access Model (67.md)

PecanRev has **three independent access systems**. They are never mixed — an action is allowed
only when *every* axis that applies to it allows it. Keeping them separate is the whole point of
the design, so read this section before touching any tier code.

| Axis | Where it lives | What it controls | Who sets it |
| --- | --- | --- | --- |
| **System role** | `User.role` = `user` \| `mod` \| `admin` | Staff powers (Ops console, moderation). **admin + mod BYPASS product tiers entirely.** | Seed script / Ops → Users |
| **Project role** | `ScreenProjectMember` = `owner` \| `leader` \| `reviewer` \| `viewer` | What a member may do *inside one project*. Still enforced **after** a tier check passes. | Project owner/leader |
| **Product tier** | `User.tierId` → `ProductTier` (this doc) | Feature access + usage limits for **normal users**. | Ops → Tiers, or `DEFAULT_USER_TIER` env |

A `pro` tier does **not** make you an admin. Being a project `owner` does **not** raise your record
limit. Being an `admin` bypasses tiers but has nothing to do with your project role. The audit trail
for `UPDATE_USER_TIER` deliberately records `targetRole` as a reminder that tier ≠ role.

## The product tier axis

Each `ProductTier` row (`free` / `plus` / `pro`, plus any admin-created custom tiers) carries a
**partial** entitlement JSON. At read time the server resolves it into a full map:

```
free baseline  ←  the tier's code defaults  ←  the row's stored overrides
```

Because the free tier defines a value for **every** registry key, a missing key can never silently
unlock a feature — resolution always fills it from the baseline. New entitlement keys therefore reach
existing DB rows with no migration. See `docs/entitlements.md` for the key registry and value semantics.

### Resolution order (server, per request)

`resolveUserEntitlements(user)` in `server/services/entitlementService.js` decides access in this order:

1. **admin / mod → bypass.** Product tiers govern normal users only. Returns `bypass: true`,
   `bypassReason: 'admin' | 'mod'`, empty entitlement map (nothing is checked).
2. **Enforcement kill-switch off → bypass.** `tierSettings.enforcementEnabled === false` makes
   *everyone* bypass — an emergency/rollout escape hatch. Returns `bypassReason: 'enforcement_disabled'`.
3. **Assigned tier.** `user.tierId`, if it points at a known **active** tier, governs the user.
4. **Site default tier.** A `null`/unknown/inactive `tierId` falls back to the site default, resolved
   at **read time** (see below) — so existing users never need a backfill and flipping the default
   is instant.
5. **Entitlement values** = the tier's code defaults merged **under** the row's stored JSON overrides.

### The site default tier — a safe default

`getDefaultTierId()` picks the first known, active tier from:

```
tierSettings.defaultTierId  →  process.env.DEFAULT_USER_TIER  →  'pro'
```

The final fallback is **`'pro'`** on purpose: before tiers existed, everyone had full access, so an
unassigned user resolving to `pro` means **no existing user loses anything** when the system ships.
An operator tightens the business model later by setting a lower default in Ops → Tiers (or the env),
which takes effect immediately for every unassigned user without a data migration.

### The enforcement kill-switch

`tierSettings.enforcementEnabled` (default `true`). Flip it **off** in Ops → Tiers to make every check
pass for everyone — use it to roll tiers out gradually or to disable enforcement instantly if a check
misfires in production. It does not delete any tier data; it only short-circuits the checks.

## Placeholder tier matrices

The values below are the **code defaults** and are placeholders — the business model is not final.
**Ops edits are authoritative:** an admin's stored overrides win over these, and the live values shown
in Ops → Tiers (and returned by the API) are the source of truth. `-1` means unlimited.

### Features (boolean)

| Feature | Free | Plus | Pro |
| --- | --- | --- | --- |
| Create projects | ✅ | ✅ | ✅ |
| Import records | ✅ | ✅ | ✅ |
| Export records | ✅ | ✅ | ✅ |
| Manual extraction | ✅ | ✅ | ✅ |
| Meta-analysis (basic) | ✅ | ✅ | ✅ |
| Manuscript editor | ✅ | ✅ | ✅ |
| AI screening | — | ✅ | ✅ |
| Screening validation metrics | — | ✅ | ✅ |
| AI extraction assist | — | ✅ | ✅ |
| Dual extraction + adjudication | — | ✅ | ✅ |
| Table parsing | — | ✅ | ✅ |
| Advanced meta-analysis (trim-fill, Egger, influence) | — | ✅ | ✅ |
| Word (.docx) export | — | ✅ | ✅ |
| Living reviews | — | ✅ | ✅ |
| Benchmark tools | — | — | ✅ |
| Network meta-analysis | — | — | ✅ |
| Scheduled living-review re-runs | — | — | ✅ |

### Limits (numeric; `-1` = unlimited)

| Limit | Free | Plus | Pro |
| --- | --- | --- | --- |
| Max active projects | 2 | 10 | Unlimited |
| Max members per project | 2 | 8 | Unlimited |
| Max records per project | 1,000 | 25,000 | 250,000 |
| Max saved searches (living reviews) | 0 | 3 | Unlimited |

## Assigning a user to a tier

Admins assign tiers in **Ops → Tiers** (or `PATCH /api/admin/users/:id/tier`). Assigning a tier writes
`User.tierId`, `tierAssignedAt`, `tierAssignedBy`, and an optional `tierOverrideReason`, and it **never
touches `User.role` or any project membership**. Setting the tier to `null` resets the user to the site
default. See `docs/admin-tier-management.md` for the walkthrough.

## Related docs

- `docs/entitlements.md` — the entitlement key registry, value semantics, the `TIER_LIMIT_EXCEEDED`
  error contract, and how to add a new entitlement.
- `docs/admin-tier-management.md` — the Ops → Tiers admin walkthrough + audit trail + billing notes.
