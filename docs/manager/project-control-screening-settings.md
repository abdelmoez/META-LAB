# Project Control — Screening & Collaboration Settings

_Version 3.16.0 (prompt34, Tasks 9 & 11)_

This document describes the three screening/collaboration settings that a review owner or leader can edit, where they live in the product, who may change them, and exactly how each one changes the behaviour of the screening workspace. It also explains the single-source-of-truth design that keeps the two places these settings appear permanently in sync.

## The three settings

A META·LAB project that has a linked screening workspace (a `ScreenProject`) exposes three collaboration settings. The labels and descriptions below are the exact strings shown in the product:

- **Blind mode** — _"Hide author / journal info from reviewers during screening."_ Off by default for a given workspace (the screening admin can configure a default for newly created workspaces, but the per-project value shown here is the live truth).
- **Restrict chat** — _"When on, only members with the Chat permission can post."_
- **Required reviewers** — _"Independent title & abstract decisions needed before a record can advance to Final Review. The research standard is 2; only the owner or a leader can change it."_ The default is **2**, which is also the enforced floor (see below).

## Where the settings are edited

The same three settings can be edited from two different screens, and both write the same underlying record:

1. **Project Control (the META·LAB monolith).** The `ControlTab` in `meta-lab-3-patched.jsx` now renders a **"Screening & collaboration"** card whenever the project has a linked screening workspace (`lid` resolved via `linkedSiftId(project)`). This is intended as the primary place to manage these settings — they sit alongside project status and the Members & permissions panel.
2. **Screening → Project Control → "Project status & access".** The screening shell's `src/frontend/screening/tabs/ProjectControlTab.jsx` (the `SettingsSection` component) shows the same three controls.

## Single source of truth (Task 11)

There is **no duplicate store**. Both UIs read and write the **linked `ScreenProject`** — that one row is the single source of truth, so the two screens can never drift apart.

- The monolith `ControlTab` loads the linked workspace via `screeningApi.getProject(lid)` into local state `sp`, and writes every change through `screeningApi.updateProject(lid, patch)` (the `saveSpSetting` helper). Saves are optimistic: the card patches `sp` immediately, shows a transient "✓ saved" flash, and reverts to the previous value if the server rejects the request.
- The screening `ProjectControlTab` `SettingsSection` writes through the same `screeningApi.updateProject(pid, patch)` call and re-reads the project afterwards (`refreshProject`). It similarly applies optimistic updates and reverts on failure.

Because both call the identical API against the identical row, a change made in one screen is reflected in the other the next time it loads. The settings therefore stay synchronized by construction rather than by any explicit copy step.

## Role gating (client and server)

Editing is restricted to the project owner and leaders; reviewers and viewers see the values read-only. This is enforced on **both** the client and the server, so the client gate is a UX affordance, not the security boundary.

**Client side.**

- In the monolith `ControlTab`, the editable controls are shown only when `canManageStatus` is true. That flag is derived from the loaded workspace as `!!(sp && (sp.canManageSettings || sp.isLeader || sp.isOwner))`. When it is false the card shows the read-only notice _"You can view these settings. Only the owner or a leader can change them."_ and renders each value as a static badge instead of an interactive toggle/select.
- In the screening `ProjectControlTab`, the equivalent flag is `canManageSettings = !!(project?.canManageSettings || project?.isLeader || access?.isLeader)`. When false, the section shows a lock notice and renders each value as a read-only `Badge`.

**Server side.** Every write goes through `updateProject` in `server/controllers/screeningController.js`, which resolves the caller's access with `getProjectAccess` and rejects anyone without settings authority before touching the database:

```js
if (!access.canManageSettings) return res.status(403).json({ error: 'You do not have permission to change project settings' });
```

`canManageSettings` resolves to the owner, a leader, or a member explicitly granted that permission. The server also validates the payload: `requiredScreeningReviewers` must be an integer (non-integer/non-finite → `400`) and is clamped to the bounded range whose floor is 2; `blindMode` and `chatRestricted` are coerced to booleans; and `progressStatus` is checked against an allow-list. Blind-mode and required-reviewer changes are written to the project audit log (`BLIND_MODE_ON`/`BLIND_MODE_OFF`, `REQUIRED_REVIEWERS_CHANGED`).

## Behaviour of each setting

### Blind mode — hides author/journal info from reviewers

When blind mode is on, reviewers do not see authorship/journal-identifying information while screening, and reviewer identities are masked in the record's decision list (decisions are surfaced as "Reviewer 1", "Reviewer 2", … with reviewer IDs withheld).

**Leaders are exempt.** The server computes the effective blind flag per request as:

```js
const blind = p.blindMode && !access.isLeader;
```

So even with blind mode on, a leader (and the owner) continues to see the full author/journal and reviewer-identity information — they need the unmasked view to resolve conflicts and manage the review — while ordinary reviewers see the blinded view.

### Restrict chat — limits who may post

Restrict chat governs **posting**, not reading; all members can still read the chat. When restricted, only members who hold the **Chat** permission (plus leaders and the owner) may send messages.

**Server gate.** `postMessageCore` in `server/controllers/screeningChatController.js` enforces it for both the screening-side and META·LAB-side chat doors (they share the same core handler):

```js
if (access.project.chatRestricted && !access.canChat && !access.isLeader) {
  return res.status(403).json({ error: 'You do not have permission to post in this chat.' });
}
```

**Client behaviour.** `ChatDrawer.jsx` mirrors the same condition as `blocked = chatRestricted && !canChat && !isLeader` (with `canChat`/`chatRestricted` kept authoritative from the server's list responses). When blocked, the composer is replaced by a disabled, read-only input whose placeholder reads _"You do not have permission to post in this chat."_, accompanied by the explanatory line _"You do not have permission to post in this chat. Chat is restricted to members with the Chat permission."_ The send path also short-circuits while blocked, so the disabled input is backed by the same guard rather than relying on styling alone.

### Required reviewers — quorum to advance to Final Review

Required reviewers sets how many **independent title & abstract decisions** a record must collect before it can advance out of title/abstract screening into Final Review. The default and enforced floor is **2** — the research standard.

This gate is enforced server-side in `saveDecision`. The effective requirement is computed as:

```
effectiveRequired = max(project.requiredScreeningReviewers || 2, getEffectiveQuorum())
```

A record advances `title_abstract → full_text` only when **both** conditions hold:

1. it has at least `effectiveRequired` **distinct** reviewer decisions at the title/abstract stage (any decision — include or exclude — counts toward "enough reviewers weighed in"), **and**
2. the include threshold is met: at least the global quorum of distinct reviewers chose **include**.

Because the per-project value is taken as `max(...)` against the global quorum, raising **Required reviewers** raises the bar for advancement but can never drop it below the two-reviewer guarantee. If there are not enough distinct decisions, or too few includes, the record stays pending in title/abstract. Disagreements (include vs. exclude) are surfaced as conflicts for a leader to resolve, unchanged by this setting. The gate runs entirely on the server, so a forged request cannot bypass it.

## Known limitations

- **Card visibility requires a linked workspace.** The "Screening & collaboration" card in the monolith `ControlTab` only appears when the project has a linked `ScreenProject` (`lid` is truthy). A META·LAB project with no screening workspace yet shows no card.
- **No real-time push between the two screens.** The settings are synchronized because both write the same `ScreenProject` row, but a change made in one open screen is reflected in another open screen only on its next load/refresh, not pushed live. (The screening-side "Required reviewers" control does carry a collaborative field-lock so two leaders do not edit it simultaneously; the monolith card does not show that lock.)
- **Required-reviewers floor/clamp is silent.** The value is clamped server-side into its bounded range (floor 2); a request below the floor is silently clamped rather than rejected, while a non-integer value is rejected with `400`.
- **Optimistic save, then revert on error.** Both UIs apply the change locally first and revert if the server rejects it. During the brief window before the server responds, the UI shows the intended value.
