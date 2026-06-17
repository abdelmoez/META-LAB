# prompt31 — delivery notes & follow-ups

_Shipped in v3.14.0 (`ec61b32`) + follow-up commit._

## What shipped
1. **Onboarding for both verification modes** — OFF → register → onboarding; ON →
   register → verify-email → (sign in) → onboarding. Skip marks it done
   (`{skipped:true}`); login response exposes `onboardingCompleted`; central
   redirect in `LoginRoute`.
2. **`npm run review:legal`** — flags Terms/Privacy-affecting changes → `docs/legal-review-report.md`.
3. **`npm run review:ops-impact`** — flags Ops/Admin-affecting changes → `docs/ops-impact-report.md`.
4. **`canAssessRiskOfBias`** project permission — additive `ScreenProjectMember`
   column + preset key + Members & Permissions UI.
5. RoB removed from project-landing cards.
6. RoB PDF panel made the larger pane (~60/40).
7. Ultra-wide judgement — `READING_TABS` keep a centred 1100px width; data tabs full width.
8. Workflow stepper is one continuous vertical line (gutter line through phase headers + global index).
9. Terms updated (per-member action permissions); Ops addressed via member UI.

## Follow-ups (documented, not forced)
1. **RoB permission backend enforcement.** The `/api/rob` service is owner-scoped
   (`getOwnedProject`) — the strongest enforcement, and the reason only the project
   owner can currently edit RoB. The new `canAssessRiskOfBias` flag lives in the
   per-member permission model + UI and is granted to owner/leader/data-extractor.
   Letting a **non-owner member** actually call the RoB API requires extending the
   RoB controller to resolve linked-workspace membership + this flag (and the
   broader META·LAB project-sharing model). That is a larger, separate change;
   until then the flag governs the member model + UI and the owner retains
   authority. **Deploy note:** the additive `canAssessRiskOfBias` column is applied
   by the standard db-push on deploy (already pushed to the local dev DB).
2. **Onboarding prompt for never-onboarded existing users.** A user whose
   `onboardingCompletedAt` is null is sent to the (skippable) onboarding page on
   their next sign-in — intended per the spec ("the app intentionally prompts
   them"); one click of "Skip for now" marks it done and they are never prompted
   again.
3. **Dead RoB handlers in ProjectLanding.** `robEnabled` / `openRob` are now unused
   (the card entries were removed); harmless, can be pruned in a later cleanup.
4. **Review scripts in CI.** They are warning-only by default (`--strict` to fail).
   Wire into CI as a non-blocking step when ready.
