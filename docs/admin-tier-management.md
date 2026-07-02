# Admin Tier Management (Ops → Tiers, 67.md)

Admin-only (`requireAdmin`; mods never see this section). Product tiers are a **separate axis** from
system roles (`admin`/`mod`/`user`) and from project roles (Owner/Leader/Reviewer/Viewer) — editing a
tier never changes anyone's role or project membership. Every mutation is written to the admin audit
log. For the model itself see `docs/user-tiers.md`; for the key registry see `docs/entitlements.md`.

## The Ops → Tiers section

The section (`GET /api/admin/tiers`) shows every tier — the three defaults (`free`/`plus`/`pro`) plus
any custom tiers — with its resolved entitlements, its raw stored overrides, the assigned-user count,
the current site-default tier, the enforcement kill-switch, and the full key registry that drives the
editor. It also surfaces a note reminding that **tiers govern normal users only** and are **separate
from project roles**.

### Edit a tier's entitlements

`PUT /api/admin/tiers/:id` with `{ entitlements: { <key>: <value>, ... } }`. Values are whitelist-coerced
by `coerceEntitlementOverrides`:

- keys not in the registry are dropped;
- a boolean key rejects a number; a limit key rejects a boolean or a non-finite number;
- negative limits clamp to `0`, **except** `-1` (`UNLIMITED`), which is preserved;
- fractional limits are rounded to an integer.

Only the keys you send become **stored overrides**; every other key still resolves from the code
defaults, so a partial edit is safe. You can also update `displayName`, `description`, `isActive`, and
`sortOrder`. Deactivating (`isActive: false`) the **current site-default tier** is refused with a 400 —
change the default first.

Editing a default tier that has no DB row yet **creates** its row on first save (the seed also creates
the three defaults at boot; existing rows are never clobbered by the seed). Custom tiers are created by
`PUT`-ing an id that is not one of the three defaults.

### Change the default tier

`PUT /api/admin/tier-settings` with `{ defaultTierId: '<id>' | null }`. The default governs every user
whose `tierId` is unset/unknown/inactive, resolved at read time. `null` falls back to the
`DEFAULT_USER_TIER` env, then to `'pro'`. The target must be an **active** tier (else 400). Changing the
default takes effect immediately for all unassigned users — no migration, no backfill.

### Toggle enforcement (kill-switch)

`PUT /api/admin/tier-settings` with `{ enforcementEnabled: true | false }`. When **off**, *every* tier
check passes for *everyone* — an emergency/rollout escape hatch. It changes no tier data; it only
short-circuits the checks. Turn it back on to resume enforcement.

### Assign a user to a tier

`PATCH /api/admin/users/:id/tier` with `{ tierId: '<id>' | null, reason?: '<note>' }`. Writes
`User.tierId`, `tierAssignedAt`, `tierAssignedBy` (the acting admin), and `tierOverrideReason`. It does
**not** touch `User.role` or any project membership. `tierId: null` resets the user to the site default.
The target tier must be active (else 400).

## Audit trail

Every mutation writes an `AdminAuditLog` row via `logAdminAction`:

| Action | Target | Recorded details |
| --- | --- | --- |
| `UPDATE_PRODUCT_TIER` | `ProductTier:<id>` | which display fields changed + the coerced entitlement overrides |
| `UPDATE_TIER_SETTINGS` | `SiteSetting:tierSettings` | the next settings object (default tier + enforcement flag) |
| `UPDATE_USER_TIER` | `User:<id>` | `from`/`to` tier, `reason`, and `targetRole` (a deliberate reminder that tier ≠ role — admins/mods bypass tiers anyway) |

Review these in **Ops → Security** (audit log) to see who changed what and when.

## Billing integration (deferred by design)

The tier system is **entitlement-first, billing-later**. There is intentionally **no billing coupling
yet**: `ProductTier` and `User` carry no `billingCustomerId`, subscription id, price, or provider fields.
Tiers are assigned manually by an admin.

When billing lands, the **JSON entitlement layer is the plug-in point**: a payment webhook maps a
purchased plan to a tier id and calls the same `PATCH /api/admin/users/:id/tier` path (or a service
equivalent) to assign it — no changes to enforcement, resolution, or the entitlement registry are
needed. Adding a `billingCustomerId`/subscription column to `User` (or a side table) at that point is
additive and does not disturb the three-axis model: **billing decides which tier; the tier decides
which entitlements; roles stay orthogonal.**

## Related docs

- `docs/user-tiers.md` — the three-axis access model, resolution order, safe default.
- `docs/entitlements.md` — the entitlement key registry, value semantics, error contract, add-a-key steps.
- `docs/admin-settings.md` — the rest of the Ops console (flags, settings, appearance, etc.).
