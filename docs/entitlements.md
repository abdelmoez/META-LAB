# Entitlements Reference (67.md)

The entitlement layer is a pure, shared model in `src/shared/entitlements.js` — no network, no DB —
used by the **server** (enforcement) and the **client** (locked-state UX). This doc is the reference
for the key registry, value semantics, the error contract, and how to add a new entitlement.

For the three-axis access model (system role vs project role vs product tier), the resolution order,
and the safe-default rationale, see `docs/user-tiers.md`.

## Value semantics

- **Boolean keys** gate a feature. `hasEntitlement(map, key)` is true only for an exact `true`.
- **Limit keys** are numeric caps. `-1` (exported as `UNLIMITED`) means no cap → `limitOf` returns
  `Infinity`. A **missing** or malformed limit resolves to `0` — **fail-closed**: an absent limit
  locks the feature rather than unlocking it.
- `withinLimit(map, key, value)` is **inclusive** at the boundary (`value <= cap`). Pass the
  *would-be total* (current + incoming), not the delta.

## Key registry

Generated from `ENTITLEMENT_KEYS`. Tier columns are the **code defaults** (placeholders — Ops edits
are authoritative; `-1` = unlimited).

| Group | Key | Kind | Label | Free | Plus | Pro |
| --- | --- | --- | --- | --- | --- | --- |
| Projects | `projects.create` | boolean | Create projects | true | true | true |
| Projects | `projects.maxActiveProjects` | limit | Max active projects | 2 | 10 | -1 |
| Projects | `projects.maxMembersPerProject` | limit | Max members per project | 2 | 8 | -1 |
| Screening | `screening.import` | boolean | Import records | true | true | true |
| Screening | `screening.maxRecordsPerProject` | limit | Max records per project | 1000 | 25000 | 250000 |
| Screening | `screening.export` | boolean | Export records | true | true | true |
| Screening | `screening.aiScoring` | boolean | AI screening | false | true | true |
| Screening | `screening.validationMetrics` | boolean | Validation metrics | false | true | true |
| Screening | `screening.benchmarkTools` | boolean | Benchmark tools | false | false | true |
| Extraction | `extraction.manual` | boolean | Manual extraction | true | true | true |
| Extraction | `extraction.aiAssist` | boolean | AI extraction assist | false | true | true |
| Extraction | `extraction.dualExtraction` | boolean | Dual extraction + adjudication | false | true | true |
| Extraction | `extraction.tableParsing` | boolean | Table parsing | false | true | true |
| Meta-analysis | `metaAnalysis.basic` | boolean | Meta-analysis | true | true | true |
| Meta-analysis | `metaAnalysis.advanced` | boolean | Advanced methods (trim-fill, Egger, influence) | false | true | true |
| Meta-analysis | `metaAnalysis.nma` | boolean | Network meta-analysis | false | false | true |
| Manuscript | `manuscript.editor` | boolean | Manuscript editor | true | true | true |
| Manuscript | `manuscript.wordExport` | boolean | Word (.docx) export | false | true | true |
| Living reviews | `livingReview.enabled` | boolean | Living reviews | false | true | true |
| Living reviews | `livingReview.maxSavedSearches` | limit | Max saved searches | 0 | 3 | -1 |
| Living reviews | `livingReview.scheduler` | boolean | Scheduled re-runs | false | false | true |

## The `TIER_LIMIT_EXCEEDED` error contract

Every blocked action returns the **same** structured body (built by `buildTierLimitError`). HTTP status
is `403` (set by `TierLimitError.status`). The controller helper `sendTierLimit(res, err)` recognises a
`TierLimitError` and emits this body:

```json
{
  "error": "TIER_LIMIT_EXCEEDED",
  "feature": "metaAnalysis.nma",
  "currentTier": "free",
  "requiredTier": "pro",
  "message": "This feature is available on the Pro plan and above."
}
```

- `feature` — the entitlement key that failed (or `null`).
- `currentTier` — the caller's resolved tier id (`null` for a bypass path, though bypass never throws).
- `requiredTier` — the **lowest default tier** that would satisfy the request (`requiredTierFor`), for
  honest upgrade messaging. `null` when no default tier satisfies it (e.g. a value beyond every cap).
- `message` — a human-readable, upgrade-oriented sentence. Callers may override it.

The client detects `error === 'TIER_LIMIT_EXCEEDED'` on any 403 and can render an upgrade prompt using
`requiredTier` + `feature`.

## How to add an entitlement (3 steps)

1. **Register the key.** Add a row to `ENTITLEMENT_KEYS` in `src/shared/entitlements.js`
   (`{ key, kind: 'boolean' | 'limit', group, label }`). The `group`/`label` drive the Ops editor and
   the docs table.
2. **Set per-tier defaults.** Add the key to the `free` baseline in `DEFAULT_TIERS` (the baseline must
   define **every** key), then add overrides on `plus` / `pro` where they differ. Existing DB rows pick
   up the new key through the defaults-merge — no migration.
3. **Enforce it.** In the endpoint call `requireEntitlement(user, key)` (boolean) or
   `requireLimit(user, key, wouldBeTotal)` (limit), wrapped so `sendTierLimit(res, err)` returns the
   403 on a `TierLimitError`. Optionally gate the UI with the client `useEntitlements()` hook
   (`has(key)` / `limit(key)`) to show a locked state before the request is made.

Admin/mod bypass, the enforcement kill-switch, and the default-tier fallback are all handled inside
`resolveUserEntitlements` — an endpoint never writes `if (user.tier === 'free')`.

## Currently-enforced endpoints

These controllers call `requireEntitlement` / `requireLimit` today (all in `server/controllers/`):

| Endpoint / action | Key(s) checked | Notes |
| --- | --- | --- |
| `createProject` | `projects.create`, `projects.maxActiveProjects` | limit counts live (non-deleted) owned projects + 1 |
| `screeningController` import (`importRecords`, `startImport`) | `screening.import`, `screening.maxRecordsPerProject` | the **project owner's** tier governs the record cap (`loadUserForTier(ownerId)`) |
| `screeningController` export (`gateExport`) | `screening.export` | applied **on top of** the project export permission (both must pass) |
| `screeningAiController` (`postAiRun`, run) | `screening.aiScoring` | AI screening runs |
| `screeningAiController` (validation) | `screening.validationMetrics` | held-out validation metrics |
| `screeningMemberController` (`addMember`) | `projects.maxMembersPerProject` | the **project owner's** tier governs the member cap |
| `nmaController` (`nmaRun`) | `metaAnalysis.nma` | network meta-analysis |
| `extractionController` (`postAiSuggest`) | `extraction.aiAssist` | AI extraction suggestions |
| `extractionController` (`postAssign` dual) | `extraction.dualExtraction` | dual-extraction assignment |
| `extractionController` (`postTable`) | `extraction.tableParsing` | table parsing |
| `livingController` (`postSearch`, saved searches, scheduler) | `livingReview.enabled`, `livingReview.maxSavedSearches`, `livingReview.scheduler` | scheduler gate applies when a cadence is requested |

Keys that exist in the registry but are not yet wired to an endpoint (e.g. `metaAnalysis.advanced`,
`manuscript.wordExport`) are enforced in the UI / future endpoints; the registry entry ships ahead of
the enforcement point so the Ops editor and upgrade messaging are already complete.

## Related docs

- `docs/user-tiers.md` — the three-axis model, resolution order, kill-switch, safe default.
- `docs/admin-tier-management.md` — the Ops → Tiers admin walkthrough.
