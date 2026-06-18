# Global workspace content padding (prompt32 Task 5)

## Current state (before)
The project workspace shell lives in `meta-lab-3-patched.jsx`. The scrolling body wrapper applied a fixed horizontal gutter `padding: inScreening ? 0 : "28px 36px 56px"`. The per-tab clamp below it centres "reading" tabs at `maxWidth:1100` and lets data tabs (Data Extraction, Risk of Bias, Analysis, Forest, …) fill the column. Screening opts out to full-bleed (`padding:0`).

## Issue
The 36px horizontal gutter was fixed: too tight on ultra-wide screens (content nearly glued to the borders) and not responsive on small screens.

## Decision
Replace the fixed horizontal gutter with a single responsive `clamp()` at the one shared body wrapper — every non-screening tab flows through it, so this is one change, not per-page margins. Keep the vertical padding and the screening `0` escape hatch; keep the per-tab `maxWidth` logic.

## Implementation (`meta-lab-3-patched.jsx`)
- Body wrapper padding → `inScreening ? 0 : "28px clamp(20px, 5vw, 88px) 56px"`. The gutter scales 20px (phones) → 5vw → 88px (ultra-wide), ≈5–10% on wide screens, without changing the reading-tab centering or the data-tab fill.

## Pages affected (auto opt-in via the shared wrapper)
Project Overview, PICO, PROSPERO, Search, Data Extraction, Risk of Bias, Meta-Analysis, Forest Plot, Sensitivity, Subgroup, GRADE, PRISMA, Manuscript, Methods, Project Control. **Screening stays full-bleed** (its own `padding:0` branch, untouched). The standalone RoB study workspace adds its own responsive `padding-inline: clamp(24px, 6vw, 96px)` (Task 4) for the same effect on that page.

## Test results
- No test asserted the old `36px` value; build green. Forest/robvis SVGs self-cap at `maxWidth:100%`, so they get slightly more breathing room rather than breaking.

## Risks / limitations
- Pure CSS/style change, additive, no schema impact.
- The cap (88px) is deliberately below the prompt's 96px example so dense data tables on mid-wide screens keep enough usable width.
