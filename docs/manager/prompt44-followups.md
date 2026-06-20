# prompt44 — suggestions/bugs table follow-ups

Status of the items from the internal Suggestions / Bugs tracking table (prompt44).

## Done (v3.27.0)

1. **Overview cleanup (Suggestion · Omar · Medium).** The Overview tab already
   showed neither Keywords nor Additional Notes. Per the clarified scope, removed the
   **"Additional Protocol Notes"** field from the PICO/Protocol editor UI (both the
   legacy `PICOTab` and the server-backed `ProtocolModulePanel`). The `notes` data
   field is **kept** in the model for back-compat; **"Key Terms & Synonyms" is kept**
   because the Search Builder consumes it.
2. **R validation engine (Suggestion · Abdulmoiz · Critical).** New pure module
   `src/research-engine/r-validation/rValidation.js` generates a self-contained
   `metafor` R script that independently reproduces every outcome's pooled estimate,
   CI, I²/τ²/Q and prediction interval, with META·LAB's own values printed alongside
   for comparison. No in-app execution (`buildExecutionRequest` is an inert service
   boundary for a future sandboxed runner). Surfaced on the Overview "Export &
   validation" card as a one-click `.R` download.
3. **Fixed left workflow menu by default (UI Limitation · Abdulmoiz · Medium).** The
   workflow menu is now **pinned by default**; only an explicit "auto" choice opts
   into auto-collapse. The existing pin/unpin control persists the preference.
4. **ZIP package in Overview (UI Limitation · Abdulmoiz · Medium).** The existing
   one-click journal-submission ZIP is now reachable from the Overview "Export &
   validation" card (reuses the existing export engine — no duplicate logic).
5. **Server-backed collaborative editing locks/presence (Bug · Abdulmoiz · Critical).**
   New `useFieldEditing` lifecycle on top of the existing presence/lock infra: claim a
   field on focus (teammates instantly see "<name> is editing…"), hold the lock WHILE
   typing (kept alive by the 30s presence heartbeat — no per-keystroke server hits),
   and auto-release on blur / 5s idle / unmount; the server lock TTL (75s) covers a
   hard disconnect so a field is never permanently trapped. Wired into the
   server-backed Protocol editor's question / P / I / C / O / keywords fields.
7. **PDF zoom (Bug · Abdulmoiz · High).** Reworked the zoom model into explicit
   **fit-width vs custom-scale**: the toolbar shows **"Fit width"** in fit mode and the
   **real %** in custom mode (so "100%" never lies), pages are centred and no longer
   clip to the left when zoomed (column is `fit-content`/`minWidth:100%`/auto-margins),
   a fixed ladder gives predictable steps with sane bounds (25%–500%), scroll position
   is anchored across zoom, and the "Fit width" button resets.
8. **RoB compact layout (UI Limitation/Bug · Abdulmoiz · Medium-High).** Already
   delivered in prompt43 (responsive domain rail, breathing room, side-by-side notes,
   sticky header). This pass polished the sticky header (opaque background + border +
   soft shadow + z-index) so it stays put and reads as a real bar while scrolling.

## Tracked TODO (not implemented — needs a spec)

- **Marketing naming item (priority #7).** The table's priority list reserves a slot
  for a "marketing naming item" but the table body does not describe it. **TODO:** get
  the concrete naming change (which surface/string, old → new) from the reporter, then
  implement as a copy-only change. No code written yet — awaiting the actual naming.
