# Project role simplification (prompt32 Task 11)

## Current state (before)
The shared `MembersTab.jsx` (used by both Screening Settings and the monolith Project Control via `ProjectMembersPanel`) exposed ~7+ permission presets in the role dropdown plus a separate "Participates in" MODULE dropdown with the confusing copy: *"Participates in Whole project (incl. Screening) — Limits which app(s) the member can open; combined with the preset's permissions."* `permissionPresets.js` defines all presets (leader, reviewer, data_extractor, readonly_both, readonly_metalab, readonly_metasift, viewer) + `resolvePreset` (used by both client and server; unknown values fall back to reviewer).

## Decision
Collapse the USER-FACING role choices to exactly **Owner, Leader, Reviewer, Viewer** while keeping ALL underlying presets + the per-permission matrix as the advanced layer. Pure UI + a documented mapping — no schema change, no backend change (server enforcement via `resolvePreset` already validates and is unchanged). Remove the confusing copy.

## Implementation
- `src/research-engine/screening/permissionPresets.js` (additive — existing exports `PERMISSION_PRESETS`/`ASSIGNABLE_PRESETS` preserved so the monolith import keeps working): added `USER_ROLES` (Leader/Reviewer/Viewer; Owner implicit) and `ROLE_TO_PRESET` mapping to existing preset keys, plus a documented OLD→NEW mapping (data_extractor→Reviewer + enable extraction/RoB in the matrix; readonly_*→Viewer; leader→Leader; reviewer→Reviewer).
- `src/frontend/screening/tabs/MembersTab.jsx`: the invite + per-row role dropdowns now offer only the 4 roles (Owner shown/locked, never assignable); selecting a role sends the mapped preset key (unchanged network payload). A member whose stored preset isn't one of the 4 renders as **"Custom"**. The confusing "Participates in…" copy is removed/relabeled. The full permission matrix is preserved behind a collapsible **"Advanced permissions"** with the simple helper "Customize what this member can view or edit." `canAssessRiskOfBias` + extraction/analysis perms remain settable there. Owner protection and Owner▸Leaders▸Reviewers▸Viewers grouping preserved.

## Permissions / migration
Existing member rows are untouched (their `permissionPreset`/flags persist); only the dropdown's offered choices shrink. Unmapped legacy presets surface as "Custom" and keep their exact permissions. Server enforcement (leader/global escalation gated to owner) is unchanged.

## Test results
- Build green (the monolith's `PERMISSION_PRESETS`/`ASSIGNABLE_PRESETS` imports still resolve → exports intact).
- Existing member/preset integration + `memberOrder`/`robPermission` unit tests pass (1263 unit green).

## Risks / limitations
- All 8 internal presets are retained; do not remove preset keys (rows would silently fall back to reviewer and lose perms).
- "Custom" is the catch-all for any non-4 stored preset — owners can re-pick a simple role or fine-tune via the matrix.
