# Ops Control Center Redesign — Opinion & Plan (prompt8)

**Author:** Main Claude (manager/integrator)
**Date:** 2026-06-10
**Scope:** `/ops` Overview redesign into a command center; one small backend addition for real
time-series data; admin/mod gating unchanged.

---

## 1. What is weak in the current ops console

1. **It's a report, not a control center.** The Overview is four number cards, four small
   metrics, five login-window cells, and three text lists. Every value is a static integer —
   no trend, no shape, no motion. An admin can't answer "is today normal?" at a glance.
2. **No time dimension.** The backend already stores timestamped `LoginEvent`,
   `ScreenProjectStatusEvent`, `AdminAuditLog`, `SecurityEvent`, `ContactMessage`, and
   `User/Project.createdAt` rows, but the console only shows rolling-window totals. All trend
   information is thrown away.
3. **No live feel.** Health refreshes on a 30s timer; nothing in the console indicates the
   system is alive *right now* (SSE exists in the product but the console doesn't use it).
4. **META·SIFT richness is buried.** `/api/admin/screening/metrics` returns ~25 fields
   (screened/included/excluded/maybe, conflicts, duplicates, second review, handoffs, chat) but
   the SIFT overview renders them as an undifferentiated wall of small cards. The screening
   *pipeline* — the most operationally interesting shape in the product — is never drawn.
5. **Weak hierarchy.** Primary metrics, secondary metrics, alerts, and quick actions all have
   similar visual weight. "Needs Attention" (the only actionable block) doesn't stand out.

## 2. What should become more visual

- **Trends** → 14-day area/sparkline charts (logins, sign-ups, new projects, screening decisions).
- **The screening pipeline** → a horizontal funnel bar: records → screened → included/excluded/
  maybe → second review → sent to extraction, each segment labeled with real counts.
- **Project completion** → donut gauge of `done / in_progress / not_started` with done-today/
  week/month counters around it.
- **System health** → status tiles with a live pulse dot (SSE-connected indicator), uptime,
  DB probe, env, version.
- **Recent activity** → a merged live feed (audit log + security events), newest first,
  auto-refreshing — the "control room ticker."
- **Unique logins** → the five rolling windows become a small bar chart instead of five cards.

## 3. Graphs/infographics recommended (all real data, no fakes)

| Visual | Data source | Why |
|---|---|---|
| 14-day multi-series activity chart (logins, new users, new projects, screening decisions) | **new** `GET /api/admin/metrics/timeseries?days=14` | the one chart every admin scans first |
| Sparklines under each KPI card | same endpoint | trend-at-a-glance without extra space |
| Screening pipeline funnel | existing `/api/admin/screening/metrics` | shows where review work piles up |
| Completion donut + done-today/week/month | existing screening metrics | progress story in one glyph |
| Unique-logins bar row (24h/7d/30d/90d/365d) | existing `/api/admin/metrics` | replaces five flat cards |
| Security mini-bars (failed logins by day) | timeseries endpoint | spot brute-force bursts |
| Live activity feed | existing audit-log + security-events | "what just happened" |
| Health tiles with pulse | existing `/api/admin/health` + SSE | live-system feel, honestly earned |

**Backend addition (the only one needed):** `GET /api/admin/metrics/timeseries?days=N`
(admin-only, N clamped 7–90) returning per-day buckets:
`{ days: [{ date, logins, uniqueLogins, newUsers, newProjects, screeningDecisions, doneTransitions, contactMessages, failedLogins }] }`
— all derivable with `createdAt` group-bys from existing tables. No schema change, no fake data.
If the endpoint is unavailable the charts render an explicit empty state ("No trend data"), never
fabricated values.

## 4. Which metrics matter most (hierarchy)

**Tier 1 (KPI cards, animated counters + sparkline):** total users, total projects (LAB+SIFT),
unread support messages, failed logins 7d (security posture).
**Tier 2 (charts):** 14-day activity, unique-login windows, screening pipeline, completion donut.
**Tier 3 (feed + tiles):** recent admin/security activity, system health, handoff status.
**Tier 4 (everything else):** stays in its dedicated section tab — the Overview must not become
a dumping ground. Power without confusion = strict tiering.

## 5. What admins see

Everything above: full Overview command center (KPIs, charts, funnel, donut, feed, health),
plus all existing sections (users, projects, SIFT, content, settings, flags, messages,
security, health) unchanged in scope.

## 6. What mods see

**Unchanged surface area: `users` + `messages` only.** Mods do not get the Overview, charts, or
the timeseries endpoint (server returns 403; nav never shows it). No new metric, chart, or feed
is exposed to mods anywhere — verified by the existing `requireAdmin` middleware on
`/api/admin/metrics*` and by QA tests. Their messages badge and limited user management keep
working exactly as before.

## 7. How it stays powerful but not confusing

- **One screen, four tiers,** scanned top-to-bottom: "how big → how trending → where's the work
  → what just happened." No tabs inside Overview, no drill-down required for the headline read.
- **Motion budget:** counters animate once on load (600ms, tabular-nums), charts draw once
  (500ms), the only persistent animation is a 2s pulse on the live-status dot. `prefers-reduced-motion`
  disables all of it.
- **Consistent chart kit:** one tiny hand-rolled SVG kit (axis-light, theme-token colors,
  identical 11px mono labels) instead of a heavyweight chart library — keeps the night/day theme
  flawless, the bundle small, and every graph visually identical.
- **Empty states everywhere:** every chart and feed has an explicit "no data yet" state with a
  one-line explanation, so a fresh install looks intentional, not broken.
- **Color discipline:** ink = `C.txt2/muted`, good = `C.grn`, attention = `C.yel`, danger =
  `C.red`, accent = `C.acc` only for interactive/primary. Identical to the app's token system.
