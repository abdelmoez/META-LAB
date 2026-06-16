I want to add better new-user analytics to the Ops/Admin console.

Goal:
Add a section in both:
1. Ops Overview
2. Ops Users

to track and understand new user registrations over time.

This should help admins understand how the site is growing, where users are coming from, which institutions are joining, and what types of researchers are registering.

Important:
This is an Ops/Admin analytics feature. Do not break authentication, registration, user management, projects, permissions, META·LAB/META·SIFT linking, saved data, or existing analytics. Do not expose private secrets, password hashes, tokens, verification tokens, reset tokens, or SMTP information.

Before coding:
1. Inspect the current user model/schema.
2. Inspect registration timestamps, such as createdAt.
3. Inspect whether lastActiveAt, country/region, institution, role, research field, and onboarding fields already exist.
4. Inspect the existing Ops/Admin Overview page.
5. Inspect the existing Ops/Admin Users page.
6. Inspect existing chart/table components.
7. Reuse existing components and APIs where possible.
8. Make a short plan before editing.

Main requirement:
Add new user registration analytics for these time windows:
- Today
- This week
- This month
- This quarter
- This year

Use the app/server timezone consistently. If the app already has a timezone convention, follow it. If not, document what timezone is used.

Part 1 — Ops Overview

Add a clean section to the Ops Overview called something like:

“New User Growth”

It should show high-level summary cards:

- New users today
- New users this week
- New users this month
- New users this quarter
- New users this year

Also add one simple chart:
- New users over time

Recommended chart behavior:
- Default to last 30 days
- Allow switching between:
  - 7 days
  - 30 days
  - 90 days
  - 12 months
  - yearly

Keep it simple and readable. Do not make the Overview page crowded.

Also include helpful mini-insights if data is available:
- Top country/region this month
- Top institution this month
- Most common research field this month
- Most common user role this month

If some profile fields are missing, show a clean empty or “Not enough profile data yet” state instead of crashing.

Part 2 — Ops Users

In the Ops Users area, add a more detailed new-user analytics section.

This should include:

A. Time-window summary
Show:
- New users today
- New users this week
- New users this month
- New users this quarter
- New users this year
- Total users all time

B. Historical totals
Add past-year totals:
- New users by year
- Year-over-year growth if possible
- Monthly registrations for the selected year
- Quarterly registrations for the selected year

Example:
- 2024 total new users
- 2025 total new users
- 2026 total new users
- Current year-to-date total

C. Trend charts
Add useful charts/tables such as:
1. New users by day — last 30 days
2. New users by month — current year
3. New users by quarter — current and previous years
4. New users by year — all years available

Use whichever chart type is cleanest:
- line chart for trends over time
- bar chart for monthly/quarterly/yearly totals
- cards for key counts
- tables for detailed breakdowns

Do not overbuild a confusing BI dashboard. Make it useful and simple.

D. New-user demographics/profile insights
If the data exists from onboarding/profile fields, show:

- New users by country/region
- New users by institution
- New users by research field
- New users by primary role
- New users by main use case
- New users by onboarding completed/not completed
- New users by email verified/unverified if email verification fields exist

These should be filterable by time window:
- Today
- Week
- Month
- Quarter
- Year
- All time
- Custom date range if easy and safe

E. Institution insights
Show:
- Top institutions by new registrations
- New institutions added this month
- Possible duplicate institutions needing review, if institution normalization/matching exists
- Number of users linked to each institution
- Original submitted institution names if available, but keep this in a details drawer/table, not the main chart

If institution matching/normalization already exists, use it.
If it does not exist, do not invent a huge system in this task unless it was already requested elsewhere. Instead, structure the analytics so it can support normalized institutions later.

F. Users table improvements
In the Users table, make sure admins can filter or sort users by:
- Created date
- Country/region
- Institution
- Research field
- Primary role
- Main use case
- Email verification status
- Onboarding completed
- Last active if available

Add quick filters:
- Registered today
- Registered this week
- Registered this month
- Registered this quarter
- Registered this year
- Unverified users
- Onboarding incomplete
- No institution provided

Make sure the table is not overcrowded.
Main columns should stay useful:
- Name
- Email
- Global role
- Institution
- Research field
- Country/region
- Created date
- Last active
- Email verified

Put less important information in a user detail drawer/modal.

G. Helpful site-growth statistics
Add any additional non-confusing statistics that would help understand site growth, such as:
- Registration conversion trend if signup-start data exists
- Percentage of users who completed onboarding
- Percentage of users who created at least one project, if project ownership data is easy to access safely
- Percentage of new users active after registration, if lastActiveAt exists
- New users with institution provided vs missing
- New users by role/use case
- Top growing institutions
- Countries/regions represented
- Average new users per day this month
- Best registration day this month
- New users compared with previous period

For “compared with previous period,” calculate:
- today vs yesterday
- this week vs previous week
- this month vs previous month
- this quarter vs previous quarter
- this year vs previous year

If previous-period data is not available or denominator is zero, handle gracefully.

Backend/API requirements:
- Create or extend safe admin-only endpoints for new-user analytics.
- Enforce admin/mod permissions according to the existing app rules.
- Normal users must never access Ops analytics endpoints.
- Do not expose secrets or sensitive auth fields.
- Use efficient queries.
- Avoid loading all users into memory if the dataset can grow.
- Prefer grouped database queries if supported.
- Add pagination for detailed user tables if not already present.

Data definitions:
- “New user” means user account createdAt within the selected time range.
- “Today” means from start of current day to now.
- “This week” means current calendar week, using the app’s existing convention if one exists.
- “This month” means current calendar month.
- “This quarter” means current calendar quarter.
- “This year” means current calendar year.
- “Past years” should use user createdAt grouped by year.

UI/UX requirements:
- Keep the style consistent with the existing Ops/Admin console.
- Use clean cards, simple charts, and readable tables.
- Use loading states.
- Use empty states.
- Use error states.
- Use tooltips for definitions if helpful.
- Make date filters obvious.
- Do not make the page visually overwhelming.
- Make it responsive.

Security/privacy requirements:
- Do not show passwords.
- Do not show password hashes.
- Do not show verification tokens.
- Do not show reset tokens.
- Do not show invite tokens.
- Do not show SMTP secrets.
- Do not show private environment variables.
- Only show user profile and analytics data appropriate for admins/mods.
- Respect existing mod restrictions if mods should see less than admins.

Testing:
If tests exist, add tests for:
- Analytics endpoint permission protection
- Time-window calculations
- Grouping by day/month/quarter/year
- Empty data handling
- Users table filtering if feasible
- UI component rendering if frontend tests exist

Acceptance criteria:
- Ops Overview shows new users today, week, month, quarter, and year.
- Ops Overview includes a simple new-user trend chart.
- Ops Users includes detailed new-user analytics.
- Ops Users shows past-year total new users.
- Ops Users shows monthly, quarterly, and yearly registration trends.
- Ops Users shows useful breakdowns by country/region, institution, research field, role, and main use case when data exists.
- Users table can filter/sort by registration time windows.
- Analytics are admin-only or follow existing Ops permission rules.
- No secrets or tokens are exposed.
- Missing profile fields do not crash the UI.
- Existing user management still works.
- Existing registration/login still works.
- Existing projects and app workflows are not affected.
- Build/lint/tests pass if available.

Final report:
After implementation, report:
- What you inspected
- What backend/admin endpoints were added or changed
- What frontend Ops Overview changes were made
- What frontend Ops Users changes were made
- What charts/tables/cards were added
- What filters were added
- What time-window definitions were used
- How missing data is handled
- Permission/security checks
- Build/lint/test results
- Any recommended follow-up improvements

Most important principle:
Make this useful for understanding site growth without turning the Ops console into a confusing analytics dashboard. Overview should be high-level. Users should be detailed.