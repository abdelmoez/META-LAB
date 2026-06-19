# Ops Console — Appearance Tab (prompt37, Phase 4)

New admin-only Ops section **Appearance** (`NAV_SECTIONS` id `style`, icon `eye`).
Server `getConsole` lists `style` only for `role === 'admin'`; mods/users never
see or reach it (server `requireAdmin` enforces the PATCH regardless of UI).

Component: `StyleSection` in `src/frontend/pages/admin/AdminConsole.jsx`. Uses the
shared `useTheme()` (preview/commit) + `themeEngine` (generate/diagnose/presets).

## Layout

1. **Header + explainer** — what the brand color drives and what stays semantic.
2. **Live-preview banner** — appears when the draft differs from the saved brand
   ("Live preview active — not yet saved") with a **Revert preview** button.
3. **Live preview card** — two scoped panels (`ThemePreviewCard`), one light + one
   dark, each setting the four brand vars locally (they inherit to the samples) so
   the admin sees real **tabs, primary button, badge, link, card, focus ring** in
   both modes without flipping the app theme.
4. **Preset colors** — a responsive grid of `SwatchButton`s; clicking previews.
5. **Custom color** — native `<input type="color">` + a hex text field; invalid
   input shows "Invalid hex — use #RRGGBB"; a preset-matching hex re-labels.
6. **Accessibility diagnostics** — the five `diagnosePalette` checks with measured
   ratios + a good/warn/fail dot, header badge (`WCAG AA OK` / `WARNINGS` /
   `POOR CONTRAST`), and a `NoticeBox` summarizing warnings.
7. **Actions** — `Reset to default` (PATCH `{reset:true}`), last-changed date,
   and `Save theme` / `Save anyway` (disabled unless valid **and** dirty).

## Preview / save lifecycle

- Selecting a preset or typing a valid hex → `previewBrand(palette)` re-themes the
  **whole console live** (and the scoped preview panels show light+dark).
- **Save** → `PATCH /api/admin/settings/theme {brandColor,preset,palette}` →
  `commitBrand` (applies + caches) → all clients pick it up on next settings load.
- **Revert preview** or leaving the tab (the section unmounts) → `clearBrandPreview`
  restores the saved theme. The app is never left in an accidental preview state.
- **Reset** → server stores the default (palette `null`); the app returns to the
  built-in indigo.

## Permissions

Admin: full edit. Mod: no access (not in `MOD_SECTIONS`; server 403s the PATCH).
Normal users: no `/ops` access at all (`AdminRoute` + `requireAdmin`).
