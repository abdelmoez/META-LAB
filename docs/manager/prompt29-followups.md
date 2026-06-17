# prompt29 — delivery notes & follow-ups

_Shipped in v3.12.0 (`6642c09`) + follow-up commit._

## What shipped (14 items)

1. **RoB section nav** — explicit Previous/Next across D1–D5 → Summary in `RobWorkspace` (`SectionNav`); answers autosave; incomplete domains are flagged but passable. Keyboard `[`/`]` still works.
2. **RoB PDF panel** — `RobPdfPanel` reuses the screening `PdfViewer` (upload/preview/find-OA) by resolving the study's screening record via `GET /api/screening/metalab/:mlpid/study-record/:studyId`. No duplicate PDF system; study- + project-specific; read-only users can't upload.
3. **OA failure** — resolver returns the found `sourceUrl` on download failure; `PdfViewer` shows Retry / Open-source-link / Upload-manually. No broken attachment created. Shared by Screening + RoB.
4–5. **Collapsible left/right screening panels** — per-user `localStorage` (`metalab.screeningUI.<userId>`); state preserved (only the column ↔ rail swaps).
6–7. **Tooltips** — status labels + reviewer icons use the new `Tooltip`; reviewer tip shows name + decision + date, hidden under blind review.
8. **`Tooltip`** — portal-based, day/dark, no clipping, hover + focus + ESC.
9. **Screening completion** — pure `isScreeningComplete` + `screeningComplete` on `/metalab/:id/summary`; the stepper turns green only when every substep is done.
10. **Vertical workflow stepper** — pip + connector replacing the dots; status colours + tooltips.
11. **/terms** — original Terms + Privacy page; linked from registration.
12. **Registration required-stars** — accessible (`aria-required`, sr-only "(required)").
13. **Onboarding redirect** — verification OFF → `/onboarding`; ON → `/verify-email`.
14. **Chat 2-minute delete** — server-time window in `deleteMessageCore` (both doors) + UI hides the control after the window; leaders keep moderation; soft-delete preserved.

## Documented follow-ups (deliberately not forced)

1. **Onboarding after email verification.** When verification is ON, a new user goes
   to `/verify-email`; after clicking the email link they land on `/login` → `/app`,
   skipping onboarding. Routing a *verified-but-not-onboarded* user to `/onboarding`
   on first login needs an "onboarding completed" flag — a separate change. The
   default (verification OFF) path correctly reaches onboarding.
2. **Leader moderation in the META·LAB chat door.** `MetaLabChatLauncher` does not
   pass `isLeader`/`me` to `ChatDrawer` (pre-existing), so a leader chatting through
   the META·LAB door sees the same 2-minute limit on their own messages and no
   delete control on others'. The backend (`deleteMessageCore` via the metalab door)
   still resolves `access.isLeader` correctly and *would* allow leader moderation —
   this is a UI-only gap. Passing leader status into that launcher is the fix.
3. **PDFs for manually-added studies.** The RoB PDF panel reuses the screening
   attachment, so studies created from a screening hand-off get full PDF support;
   studies added manually in Data Extraction show a clean empty state. A study-keyed
   attachment table was intentionally NOT added (would duplicate the PDF system).
4. **Summary query cost.** `getMetaLabSummary` now loads decisions/conflicts/dup
   groups to compute completeness; it is called by both the overview card and the
   sidebar. Fine at current scale; a lighter dedicated endpoint could be added if
   projects grow very large.
5. **Chat after-2-min rejection test.** The within-window path and the rule are
   covered (unit + live smoke + code review); a full "after 2 minutes, non-leader"
   integration test needs controllable server time / a second non-leader member.
