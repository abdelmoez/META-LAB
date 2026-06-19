# Ops — Onboarding analytics (prompt36 Task 6)

*META·LAB internal — v3.17.0 → 3.18.0. Date: 2026-06-18.*

Files:
`server/controllers/onboardingController.js`,
`server/routes/admin.js`,
`src/frontend/pages/admin/adminApiClient.js`,
`src/frontend/pages/admin/AdminConsole.jsx`.

---

## Purpose

The Ops console could manage onboarding questions (create / edit / activate /
order) but gave admins **no visibility into how users were actually responding**.
This task adds an **Analytics** view to the Ops → Onboarding tab: aggregate
completion / skip / pending rates, a per-question breakdown, a per-user table,
drill-downs into who answered/skipped/is-pending, a CSV export, and a strict
denominator contract so the numbers are unambiguous. All endpoints are
**admin-only**.

---

## Endpoints (all `requireAdmin`)

Registered in `server/routes/admin.js` **before** the generic
`/onboarding-questions/:id` mutation routes so the analytics paths are never
shadowed by the `:id` wildcard.

### 1. `GET /api/admin/onboarding-analytics` → `adminOnboardingAnalytics`

The dashboard payload.

```jsonc
{
  "overview": {
    "totalQuestions", "activeQuestions", "totalUsers",
    "totalAssignedResponses",          // activeQuestions × totalUsers
    "answered", "skipped", "pending",  // summed over ACTIVE questions
    "completionRate", "skipRate", "pendingRate",  // % of the assigned universe
    "completedUsers", "completedUserRate"
  },
  "questions": [ /* one questionAnalyticsRow per question (active + inactive) */ ],
  "users":     [ /* per-user rows, capped 500, sorted most-pending first */ ],
  "usersTruncated":   false,
  "usersWithActivity": <int>,          // users with ≥1 response row
  "denominatorNote":  "Active question: answered + skipped + pending = total users …"
}
```

A per-question row (`questionAnalyticsRow`) is:

```jsonc
{
  "id","key","prompt","type","isActive","isRequired","allowSkip",
  "answered","skipped","pending",
  "answeredPct","skippedPct","pendingPct",
  "lastAnsweredAt","lastSkippedAt",
  "denomBasis": "all_users" | "responders"
}
```

A per-user row (`userAnalyticsRow`, counts over active questions only):

```jsonc
{ "id","name","email","answered","skipped","pending","completionPct","lastActivity","complete" }
```

### 2. `GET /api/admin/onboarding-questions/:id/analytics` → `adminOnboardingQuestionAnalytics`

Per-question drill-down.

```jsonc
{
  "question": <questionAnalyticsRow>,
  "answeredUsers": [ { userId, name, email, answeredAt, answer } ],  // answer via safeAnswerDisplay
  "skippedUsers":  [ { userId, name, email, skippedAt } ],
  "pendingUsers":  [ { userId, name, email } ],  // only while active; capped 200
  "pendingCount", "pendingTruncated", "totalUsers"
}
```

### 3. `GET /api/admin/onboarding-users/:id/status` → `adminOnboardingUserStatus`

Per-user drill-down — every question and this user's status on it.

```jsonc
{
  "user": { id, name, email, onboardingCompletedAt, lastActive },
  "counts": { answered, skipped, pending, activeQuestions, completionPct },
  "items": [ { id, key, prompt, type, isActive, isRequired,
               status: "answered"|"skipped"|"pending"|"not_assigned",
               answeredAt, skippedAt, answer } ]
}
```

`not_assigned` = an **inactive** question this user never responded to (it is no
longer assigned, so it is neither pending nor counted against them).

---

## The denominator contract

This is the heart of the feature. Every registered user is treated as **assigned
every ACTIVE question**. The rules:

**Active question** — `answered + skipped + pending = totalUsers`.
- `pending` = users with **no response row yet** for that question
  (`totalUsers − (answered + skipped)`).
- The percentage **denominator is `totalUsers`**, so the three per-question
  percentages sum to ~100 %. (`denomBasis: "all_users"`.)

**Inactive question** — no longer assigned, so `pending = 0`, but it **keeps its
historical** `answered` / `skipped`. Its percentage **denominator is the number of
users who actually responded** (`answered + skipped`). (`denomBasis:
"responders"`.) This avoids a misleadingly tiny percentage for a retired question
against the whole user base.

**Overview** spans **active questions only**, over the assignment universe
`assigned = activeQuestions × totalUsers`:
- `answered` / `skipped` are summed across active questions; `pending = assigned −
  answered − skipped`.
- `completionRate + skipRate + pendingRate ≈ 100 %` (rounding aside) because they
  share the `assigned` denominator.
- `completedUsers` = users who have **responded (answered or skipped) to every
  active question**; `completedUserRate = completedUsers / totalUsers`.

### Worked examples

Assume **10 registered users** and **3 active questions** (Q1, Q2, Q3) plus **1
inactive** question (Q0, retired).

- **Q1 (active)**: 7 answered, 1 skipped → 2 pending. Percentages over 10:
  answered 70 %, skipped 10 %, pending 20 % → sums to 100 %.
- **Q2 (active)**: 4 answered, 0 skipped → 6 pending → 40 % / 0 % / 60 %.
- **Q3 (active)**: 10 answered, 0 skipped → 0 pending → 100 % / 0 % / 0 %.
- **Q0 (inactive)**: historically 5 answered, 1 skipped, `pending = 0`.
  Denominator = responders = 6 → answered 83.3 %, skipped 16.7 %. (Not /10.)

**Overview** (active only): `assigned = 3 × 10 = 30`.
- `answered = 7+4+10 = 21`, `skipped = 1+0+0 = 1`, `pending = 30−22 = 8`.
- `completionRate = 21/30 = 70 %`, `skipRate = 1/30 ≈ 3.3 %`,
  `pendingRate = 8/30 ≈ 26.7 %` → ~100 %.
- A user who responded to **all of Q1, Q2, Q3** counts toward `completedUsers`;
  if 4 users did, `completedUserRate = 4/10 = 40 %`.

`onbPct(n, d)` is the shared one-decimal percentage helper
(`d > 0 ? round(n/d*1000)/10 : 0`), used everywhere so rounding is consistent.

---

## Privacy handling

- **Aggregate counts** (answered/skipped/pending, percentages, last-response
  timestamps) are returned freely by the dashboard endpoint.
- **Individual answer VALUES** are only returned by the two **drill-down**
  endpoints, and on the frontend they stay hidden behind an explicit **"Show
  answers"** button.
- `safeAnswerDisplay(question, rawJson)` decodes the stored JSON answer for
  display and, for the **`institution`** answer type, surfaces **only the
  human-readable name** (`canonicalName` / `name`) — never the raw institution
  object (ROR id, codes, etc.). Arrays are joined; other objects are stringified;
  null/empty answers return `null`.

---

## Data model + bounds

- Per-question counts come from `groupBy` aggregations on
  `UserOnboardingResponse` (by `questionId` and by `status`), plus `_max` on the
  answered/skipped timestamps — no per-row scan for the overview.
- Per-user aggregates `groupBy` `[userId, status]` over the active questions.
- **User table cap**: 500 rows (`usersTruncated` flag set when exceeded). Only
  users with **at least one response row** are resolved to identities and listed;
  all-pending users are omitted (their count is implied by `totalUsers`). Rows are
  sorted **most-pending first**, then incomplete-before-complete, then by name.
- **Pending list cap** (per-question drill-down): 200 (`pendingTruncated` set when
  the true pending count exceeds the returned list).
- No schema change — these are read-only aggregations over existing
  `OnboardingQuestion` / `UserOnboardingResponse` / `User` tables.

---

## Frontend (Ops Console → Onboarding tab)

`adminApiClient.js` exposes the three calls under `adminApi.onboarding`:
`analytics()`, `questionAnalytics(id)`, `userStatus(id)`.

In `AdminConsole.jsx` the Onboarding section gained a **"Manage | Analytics"**
segmented toggle at the top. The **Analytics** view (`OnboardingAnalytics`):

- **Overview** card: stat tiles (Questions, Users, Assigned, Answered, Skipped,
  Pending, Completed users) + three `PercentCard`s (completion / skip / pending
  rate) + the `denominatorNote` printed verbatim.
- **Per-question** list: each row shows a stacked answered/skipped/pending bar
  (`OnbStackBar`), counts + percentages, last answered / last skipped, Required /
  Inactive / Skippable badges, and a **"Details"** drill-down button. A legend +
  **"Export CSV"** button sit in the card header.
- **User-level** table: name/email, answered / skipped / pending, completion %
  (with a ✓ when complete), and a **"View"** drill-down. A note appears when the
  500-row cap truncates the list.
- **Drill-down modal** (`OnboardingDrillModal`) handles both question and user
  drill-downs. Answer **values are hidden** until the admin clicks **"Show
  answers"** (privacy); the question modal has answered / skipped / pending tabs.

### CSV export

The per-question rows are exported client-side as a CSV Blob
(`onboarding-analytics.csv`) — `key, prompt, active, required, answered, skipped,
pending, *_pct, last_answered, last_skipped` — with proper quote-escaping. **No
new dependency**; it builds the CSV string and triggers a download via an object
URL.

### Permissions

The entire Ops console is admin/mod gated, and these three endpoints are
**admin-only** (`requireAdmin`). The Analytics view is therefore admin-only in
practice.

---

## Tests

`tests/unit/onboarding-analytics.test.js` covers the pure exported helpers:
`onbPct`, `questionAnalyticsRow` (active vs inactive denominator), 
`onboardingOverview` (rates summing to ~100 %, completedUserRate),
`userAnalyticsRow`, and `safeAnswerDisplay` (institution name extraction, arrays,
null handling).

---

## Future enhancements

- **Per-user preference sync** — surface a user's onboarding answers in the user
  detail panel and allow editing / re-prompting from Ops.
- **Date-range filters** — restrict the overview/per-question metrics to a
  registration or response window (today everything is all-time).
- **Pagination beyond the caps** — the user table caps at 500 and the per-question
  pending list at 200; a paged / searchable endpoint would let very large
  deployments page through the full set rather than relying on the
  most-pending-first slice.
