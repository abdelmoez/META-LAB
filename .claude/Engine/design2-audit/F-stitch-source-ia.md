# TOPIC F — Stitch DESIGN SOURCE: Visual Language + Intended Information Architecture

**Source of visual truth.** Static HTML/CSS mockups under `Design/stitch_pecanrev_research_os/`. These are NOT app code — they are Stitch (Google) generated Tailwind mockups. Below is the concrete spec to implement faithfully, plus a list of where the source CONTRADICTS itself and `design2.md` (so implementers fix, not copy, the source).

Files audited (all 9 in the folder):
- `pecanrev_command_center/code.html` — dashboard (canonical)
- `pecanrev_project_overview/code.html` — project overview (canonical)
- `pecanrev_sift_screening_engine_1/code.html` — screening 3-pane (canonical)
- `pecanrev_pico_question/code.html` — Plan stage (PICO)
- `pecanrev_search_builder/code.html` — Search stage
- `pecanrev_full_text_review/code.html` — RoB 2 full-text review (canonical for steppers)
- `pecanrev_data_extraction/code.html` — Data extraction table
- `pecanrev_sift_screening_engine_2/code.html` — THROWAWAY variant (RTL, chat-app nav) — DO NOT use as IA source
- `pecanrev_sift_screening_engine_3/code.html` — (sibling experimental variant) — DO NOT use
- `vivid_enterprise/DESIGN.md` — the written design-system contract

---

## CRITICAL: the source is internally INCONSISTENT — pin these decisions first

The mockups disagree on the single most important token (the purple) and the rail color. There are **two distinct purples** across files. Pick ONE per `design2.md` Part 9 (one token system, no "multiple competing shades of purple without token definitions"):

| Token | Value A (use this — matches DESIGN.md + project_overview/pico/search/screening_1) | Value B (command_center + full_text_review + data_extraction) |
|---|---|---|
| `primary` | **`#5d509c`** | `#493ee5` (a blue-violet) |
| `primary-container` | **`#7669b6`** | `#635bff` |
| `tertiary` | `#5d509b` (≈ primary) | `#5d509b` |
| Rail background | `bg-primary` = **`#5d509c`** | `bg-tertiary` = `#5d509b` |

**Decision:** Adopt **Value A** (`primary #5d509c`, `primary-container #7669b6`). It is the value in `vivid_enterprise/DESIGN.md` typography/colors front-matter (the contract), and in 5 of 7 real pages. The `#493ee5` electric-indigo in command_center/full_text_review/data_extraction is an off-brand Stitch drift — treat as a bug to normalize. NOTE: `DESIGN.md` prose §Colors quotes yet a THIRD hex `#584B96` ("Deep Purple #584B96") and `#5CB85C` green / `#F4F7FE` bg / `#EDF2F7` input — these prose hexes do NOT match the front-matter tokens. Prefer the front-matter token table (machine-readable) over the prose; flag the prose as approximate.

Also inconsistent: the **rail uses `bg-primary` in some files and `bg-tertiary` in others.** Since `primary≈tertiary≈#5d50xx` in Value A, this is harmless once normalized — standardize on `bg-primary`.

---

## 1) PURPLE RAIL structure (the 72px primary rail)

### Width & shell
- Width token `sidebar_width: 72px` (every file). Class `w-sidebar_width`, fixed `left-0 top-0 h-screen z-40/50`, `bg-primary` (`#5d509c`), `flex flex-col items-center py-stack_lg` (24px vertical pad).
- DESIGN.md §Layout: "Primary Sidebar (Fixed): 72px vertical strip … for top-level navigation icons."
- The canonical dashboard (`command_center`) nests primary 72px rail + 280px secondary rail together inside one `w-[352px]` `<nav class="bg-tertiary">` wrapper. Other pages render them as two separate fixed elements at `left-0` and `left-[72px]`. Net left offset for main content is always **`352px`** (`72+280`).

### Branding glyph (top)
Multiple treatments exist — pick one:
- `project_overview`: `w-10 h-10 rounded-lg bg-surface-container-highest` tile, text **"PR"** (`text-primary font-bold font-title-sm`), `title="PecanRev"`. ← **simplest, most on-brand; recommend this.**
- `screening_1` / `search_builder` / `data_extraction` / `pico`: `w-10 h-10` (or `w-12`) tile `bg-surface`/`bg-primary-container` with a Material Symbol — **`science`** (filled) — plus a tiny `PecanRev` label `font-label-xs` under it.
- `command_center` / `full_text_review`: Material Symbol **`biotech`** (filled) on a white tile.
- Glyph inconsistency: `science` vs `biotech` vs `PR`. **Recommend the "PR" monogram tile** (cleanest, no engine connotation), keeping `science` as the fallback icon.

### Nav items (icons + order) — THE CANONICAL SET
The **canonical, PecanRev-faithful** item set is in `project_overview`, `pico`, `search_builder`, `screening_1` (Material Symbols Outlined; active = `opacity-100 border-l-4 border-secondary-container bg-primary-container[/30]`, inactive = `opacity-60 hover:opacity-100 hover:bg-primary-container`):

Top group (in order):
1. **Dashboard** — icon `dashboard` (active filled)
2. **Screening** — icon `filter_alt`
3. **Analysis** — icon `analytics`
4. **Reporting** — icon `description`
5. **Settings** — icon `settings` (present in project_overview/screening_1/search_builder; in `pico` Settings+Help are in the BOTTOM group instead)

Bottom group (`mt-auto`):
- **Help** — icon `help`
- **Sign Out / Logout** — icon `logout`
- **New Project** — circular FAB, icon `add`, `bg-secondary-container text-on-secondary-container rounded-full` (in screening_1/search_builder/pico the `add` FAB sits in the footer)
- **Profile avatar** — `w-8/w-10 h-… rounded-full` image, bottom-most (command_center, search_builder, full_text_review)

> The `command_center`/`full_text_review`/`data_extraction` rails show a DIFFERENT, off-brand item set: Dashboard, **Library** (`menu_book`), **Experiments** (`biotech`), **Analytics** (`query_stats`). This is generic Stitch boilerplate — **DO NOT use it.** The canonical workflow vocabulary is Dashboard / Screening / Analysis / Reporting.

### Active / hover / states (exact classes)
- **Active:** `text-on-primary opacity-100 border-l-4 border-secondary-container` (a green left-bar, `secondary-container #96f591`) + `bg-primary-container` or `bg-primary-container/30`; icon switches to `font-variation-settings:'FILL' 1`.
- **Inactive:** `text-on-primary opacity-60 hover:opacity-100 hover:bg-primary-container`.
- **Press:** `scale-95 active:scale-90` micro-interaction.
- DESIGN.md §"Primary Sidebar Icons": "white with 60% opacity default, 100% opacity with a small indicator dot/bar when active."

### Profile / version treatment
- Profile avatar = circular image, `rounded-full`, sits at the very bottom of the rail (command_center L221; search_builder L163; full_text_review L148). `border-2 border-tertiary-container` / `border-primary-container`.
- **The Stitch source has NO version label anywhere.** `design2.md` Part 1 REQUIRES adding a subtle `v2.4.1` Manrope label directly beneath the profile icon, from the real version source, with tooltip "PecanRev version 2.4.1". → implementer must ADD this; not in source.

---

## 2) WHITE secondary column (280px rail)

Width token `secondary_nav_width: 280px`; `w-secondary_nav_width`, fixed `left-[72px]`, `bg-surface-container` (`#ebeef5`) or `bg-surface-container-lowest` (`#ffffff`), `border-r border-outline-variant`, `flex flex-col px-gutter py-stack_lg`.

### On the DASHBOARD (`command_center`) — its white column:
- Header block (`p-6 border-b`): `<h1>` **"Research OS"** (`font-headline-md`) + subtitle **"Vinci Lab"** (`font-label-sm`).
- A **"New Project"** primary button (`bg-tertiary text-on-tertiary`, `add` icon).
- **"Team Members"** section (`font-label-xs uppercase tracking-wider`) + a count badge `12`, then a list of member rows (avatar + name + presence dot + status line like "Reviewing abstracts"/"Offline").
- Footer (`p-4 border-t`): **"Invite Member"** button (`group_add` icon).

  → CONFLICTS WITH design2.md (see §6). design2.md wants: brand **"PecanRev"** (not "Research OS"), a prominent **"Welcome, [user]"**, and a workspace MENU (Workspace Overview / My Work / Recent Activity / Invitations / Archived / Resources) — NOT a team-members list, NOT a sidebar New-Project button. The data_extraction file's white column even shows a literal **project list** ("Recent Projects": Cherry / Oakwood Trial / Project Willow) with a "New Project" button + "Research OS / Vinci Lab" header — exactly the duplicated project list design2.md Part 1 says to REMOVE.

### On PROJECT pages (`project_overview`, `pico`, `search_builder`, `screening_1`) — its white column:
- Header: `<h2/h1>` **"PecanRev Sift"** (`font-title-sm text-primary`) + subtitle **"Systematic Review"** (`font-label-sm text-on-surface-variant`). In `project_overview` the header is a clickable project switcher with an `expand_more` chevron.
- A **"Workflow"** group label (`text-label-xs uppercase tracking-wider`) in project_overview.
- The contextual workflow list (see §3).
- `project_overview` also pins a **"New Project"** button at `mt-auto`; `screening_1` pins a **"Screening Progress" mini-card** at `mt-auto` (label + `bg-tertiary` progress bar + `1,245 / 2,800` + `45%`).

  → "PecanRev Sift" and "Research OS" both CONFLICT with design2.md's "use **PecanRev**, never Research OS, and don't say 'Sift'/engine names." The white column on project pages should become the **contextual workflow sub-nav** (design2.md Part 6), not a duplicate primary nav.

---

## 3) PROJECT WORKSPACE nav as DESIGNED in Stitch (workflow stages / sub-nav / steppers)

### Top-level workflow list shown in the white column (project pages)
`project_overview` / `pico` / `screening_1` white column items (active = `text-primary font-bold bg-surface-container-highest rounded-lg`; inactive = `text-on-surface-variant hover:bg-surface-container-highest`):
1. **Phase Overview** — icon `visibility` (project_overview uses `map`) — active in overview/screening
2. **Full Text Review** — icon `menu_book`
3. **Data Extraction** — icon `dataset`
4. **Synthesis** — icon `summarize`

`search_builder` inserts **Search Builder** (`manage_search`) between Phase Overview and Full Text Review, so the union list is:
**Phase Overview → Search Builder → Full Text Review → Data Extraction → Synthesis.**

> This is a SPARSE, Stitch-invented stage list. It does NOT match the legacy/canonical PecanRev workflow (design2.md Part 5 lists Project Overview, Project Control, Plan & Protocol, Search, Screening, Data Extraction, Risk of Bias, Meta-analysis, PRISMA, Reporting). The Stitch source is missing Project Control, Plan & Protocol, Risk of Bias (shown as "Full Text Review"), PRISMA, Meta-analysis. **Derive real stages from legacy; use Stitch only for VISUAL treatment of each row.**

### Contextual stepper / breadcrumb patterns observed
- **Plan/PICO header breadcrumb** (`pico` L231): `Plan Stage › Protocol Definition` rendered as `font-label-sm uppercase tracking-wider text-tertiary` + `chevron_right` (14px) + step name. Then `<h1 font-display-lg>` page title. Right side: **Save Draft** (ghost) + **Proceed to Search** (`bg-primary`, `arrow_forward`). This is the canonical "stage › substep + primary forward CTA" pattern.
- **Data-extraction header chip** (`data_extraction` L291): a stage pill `bg-tertiary-fixed text-on-tertiary-fixed uppercase` "Data Extraction" + `•` + "Last synced 2h ago".
- **RoB 2 domain stepper** (`full_text_review`, the richest stepper) — a vertical stepper in the 280px rail:
  - Header: back-link `arrow_back` + "Project 44" (`uppercase`), `<h2>` "RoB 2 Assessment", a **Progress** row `2/6` + a `bg-tertiary` progress bar at `w-[33%]`.
  - Domain rows, each a `<button>` with a status icon + title + status text:
    - **Completed:** icon `check_circle` (filled, `text-secondary`), e.g. "D1: Randomization / Low risk of bias".
    - **Active:** icon `radio_button_checked` (`text-tertiary`), row `bg-tertiary-fixed-dim/20 border border-tertiary-fixed-dim shadow-sm`, e.g. "D2: Deviations / In progress".
    - **Pending:** icon `radio_button_unchecked` (`text-outline`), label "Pending" (`text-outline`).
  - This is the **definitive stepper spec**: status icon (check_circle / radio_button_checked / radio_button_unchecked) + green-for-done / purple-for-active / muted-for-pending, with a count `n/total` + linear progress bar in the header. Reuse for ALL workflow steppers.
- **Project overview progress hero** (`project_overview` L278–315): a full-width glass card — `<h3>` "Project Progress" + big `font-display-lg text-primary` **"24%"** + a `bg-surface-container-highest` track with `bg-primary` fill at `width:24%`, and a **stage legend row**: `Plan · Search · Screen · Extract · Analyze · Report` (`font-label-sm`). Plus a 3-up stat cluster: **342 Found / 128 Screened (text-tertiary) / 14 Included (text-secondary)**, each `font-headline-md source-serif` + `uppercase tracking-wider` caption. This 6-stage legend (Plan/Search/Screen/Extract/Analyze/Report) is the cleanest expression of the integrated workflow and should drive the rail order.

### Screening 3-pane (canonical screening engine — `screening_1`)
Main area = three rounded cards in a row:
- **Left "Screening Queue"** (`w-1/3 max-w-sm`): header "Screening Queue / 1,555 remaining" + `sort` icon; list rows with `PMID:` chip, a `% Match` indicator (`psychiatry` icon + e.g. "92% Match", green when high), 2-line title; active row = `bg-tertiary-fixed border-l-4 border-tertiary`.
- **Center "Active Abstract"**: metadata chips (journal / date / `Review Article`), `font-display-lg` title, authors + "View Source `open_in_new`", then Background/Methods/Results/Conclusions sections (`<h3> text-tertiary uppercase tracking-wide`), with `<mark class="bg-secondary-fixed">` highlight.
  - **Bottom action bar** (fixed): three `w-24 h-20` buttons — **Exclude** (`close`, hover `bg-error-container`, "Shortcut: 1"), **Maybe** (`help`, "Shortcut: 2"), **Include** (`check`, hover `bg-secondary-container`, "Shortcut: 3").
- **Right "Screening Criteria"** (`w-64`): "Must Include" (`check_circle` green) / "Must Exclude" (`cancel` red) lists with `radio_button_unchecked`/`check_circle` + `line-through` for met items; **"Auto-Highlights"** toggles (PICO Elements off / Keywords on) as pill switches.

---

## 4) CORE VISUAL TOKENS (exact values)

### Colors (use the `vivid_enterprise/DESIGN.md` front-matter; Value A purple)
```
surface:                 #f7f9ff   (app background / canvas)
surface-dim:             #d7dae1
surface-bright:          #f7f9ff
surface-container-lowest:#ffffff   (cards / modals)
surface-container-low:   #f1f4fb
surface-container:       #ebeef5
surface-container-high:  #e5e8ef
surface-container-highest:#dfe2e9  (active white-column row bg)
on-surface:              #181c21
on-surface-variant:      #464555   (muted text)
outline:                 #777587
outline-variant:         #c7c4d8   (borders)
primary:                 #5d509c   ← THE purple (rail, primary buttons)
on-primary:              #ffffff
primary-container:       #7669b6   (hover on rail, active fill)
on-primary-container:    #fffaff
inverse-primary:         #cabeff
primary-fixed:           #e6deff
primary-fixed-dim:       #cabeff   (dark-mode rail bg)
on-primary-fixed:        #1c0858
on-primary-fixed-variant:#483b85
secondary:               #016e1c   (SUCCESS / Include / done — green)
on-secondary:            #ffffff
secondary-container:     #96f591   (active left-bar on rail; success bg)
on-secondary-container:  #0b7320
secondary-fixed:         #99f894   (highlight <mark>, success accents)
secondary-fixed-dim:     #7edb7b
on-secondary-fixed:      #002204
on-secondary-fixed-variant:#005312
tertiary:                #5d509b   (≈ primary; accents, chart bars, % match)
tertiary-container:      #7669b6
tertiary-fixed:          #e6deff   (chips, active screening row bg)
tertiary-fixed-dim:      #cabeff   (active stepper row bg)
on-tertiary-fixed:       #1c0858
on-tertiary-fixed-variant:#483b85
error:                   #ba1a1a   (Exclude, destructive)
on-error:                #ffffff
error-container:         #ffdad6   (Exclude hover bg)
on-error-container:      #93000a
inverse-surface:         #2d3136   (code-block bg in search builder)
inverse-on-surface:      #eef1f8
```
Semantic mapping: **purple = primary/brand/active**, **green (secondary) = success / Include / completed**, **red (error) = destructive / Exclude**, **tertiary-fixed = chips & active context rows**.

### Radii (`borderRadius` token + DESIGN.md §Shapes)
- Tailwind config: `DEFAULT 0.25rem (4px)`, `lg 0.5rem (8px)`, `xl 0.75rem (12px)`, `full 9999px`.
- DESIGN.md `rounded` front-matter (richer scale): `sm 0.25rem`, `DEFAULT 0.5rem`, `md 0.75rem`, `lg 1rem`, `xl 1.5rem`, `full 9999px`.
- In practice: **standard components (buttons, inputs, small cards) = 8px (`rounded-lg`)**; **large containers (dashboard cards, modals) = 12–16px (`rounded-xl`/1rem)**; avatars/dots/pills = `rounded-full`. DESIGN.md §Cards: "16px border-radius, 20px padding."

### Shadows / elevation
- **Level 1 (cards):** `box-shadow: 0px 4px 20px rgba(0,0,0,0.04)` — class `.shadow-level-1` / inlined `shadow-[0px_4px_20px_rgba(0,0,0,0.04)]`. Cards "appear flush but distinct."
- **Level 2 (modals/popovers/CTA):** `box-shadow: 0px 15px 35px rgba(0,0,0,0.1)` — `.shadow-level-2`, plus a semi-transparent backdrop blur (12px).
- Glass card (project_overview): `background: rgba(255,255,255,0.85); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.4)`. (Use SPARINGLY — design2.md Part 9 warns against "excessive glassmorphism.")
- Top bars sometimes `bg-surface/80 backdrop-blur-md`.

### Spacing (8px system — `spacing` token)
```
sidebar_width:       72px
secondary_nav_width: 280px   (design2.md Part 6 allows 240–300px for the contextual column)
gutter:              24px    (between major cards)
card_padding:        20px    (internal card padding)
stack_sm:             8px
stack_md:            16px
stack_lg:            24px
```
DESIGN.md §Spacing: "strict 8px-based system. Gutters 24px, internal card padding 20px — dense but breathable."

### Typography (Manrope is the system font — design2.md Part 2 makes this mandatory everywhere)
Family: **Manrope** (weights 400/500/600/700, command_center also loads 800). Loaded via Google Fonts. `command_center` and `project_overview` ALSO load **Source Serif 4** (used for display numerals / serif headlines — `font-[Source_Serif_4]`, `.source-serif`); other pages set everything to Manrope.
Type scale (`fontSize` token):
```
display-lg:  32px / lh1.2  / weight 700 / letter-spacing -0.02em   (page titles, big numerals)
headline-md: 20px / lh1.4  / weight 600                            (card / section headers, project title)
title-sm:    16px / lh1.5  / weight 600                            (sub-headers, nav item labels)
body-md:     14px / lh1.6  / weight 400                            (body text, default)
label-sm:    12px / lh1.4  / weight 500 / ls 0.01em                (captions, subtitles)
label-xs:    11px / lh1.2  / weight 700                            (UPPERCASE eyebrows, badges, rail labels)
```
DESIGN.md §Typography: prefer **weight changes over size changes** for hierarchy; Semi-Bold 600 for section headers, Bold 700 for buttons & display numbers, Regular 400 for body. (Manrope chosen for RTL/Arabic balance.) **Recommendation:** standardize on Manrope-only per design2.md Part 2; if keeping Source Serif 4 for display numerals, scope it as an explicit token, not ad-hoc.

### Iconography
- **Material Symbols Outlined** (Google), single library across all files. Fill axis toggled via `font-variation-settings:'FILL' 1`. Sizes: rail 24px, inline 16–20px, decorative up to 32–150px.
- Active nav icons are FILLED; inactive are outline. Keep ONE library (design2.md Part 1: "avoid mixing unrelated icon libraries").
- Key icon vocabulary: `dashboard`, `filter_alt` (Screening), `analytics` (Analysis), `description` (Reporting), `settings`, `help`, `logout`, `add`, `visibility`/`map` (Overview), `manage_search` (Search), `menu_book` (Full Text Review), `dataset` (Data Extraction), `summarize` (Synthesis), `notifications`, `history`, `science`/`biotech` (brand glyph), `check_circle`/`radio_button_checked`/`radio_button_unchecked` (stepper), `auto_awesome` (AI suggestion), `arrow_forward`/`chevron_right`/`expand_more`/`keyboard_arrow_down` (nav/forward).

### Inputs (DESIGN.md §Input Fields)
"Very light gray fill (`#EDF2F7` per prose; tokens use `surface-container-low #f1f4fb`/`surface-container`) with NO border until focused. On focus, a 2px purple border." Mockups: `focus:ring-2 focus:ring-primary` and the `pico` `.input-focus-ring:focus-within { box-shadow: 0 0 0 2px #5d509c; border-color:transparent; }`. Search inputs are `rounded-full`.

### Buttons (DESIGN.md §Buttons + mockups)
- **Primary:** solid `bg-primary text-on-primary` (purple), `font-title-sm`/`font-label-sm`, `rounded-lg`/`rounded-md`, `shadow-sm`, often an icon. Hover shifts to `bg-tertiary`/`bg-primary-container`/`bg-surface-tint`.
- **Success:** solid green (`bg-secondary`/`secondary-container`) for Accept/Include/Complete.
- **Secondary / ghost:** `bg-surface-container-lowest border border-outline-variant text-on-surface` OR transparent with thin border (`border-primary text-primary` for the outlined Export variant).
- **FAB (New Project):** circular `bg-secondary-container text-on-secondary-container rounded-full` with `add`.

### Motion
- `transition-colors duration-200`, hover `scale` micro-interactions (`scale-95 active:scale-90`), bar grow keyframes (`growUp 1s ease-out`), progress-ring `stroke-dashoffset .5s`, progress bar `transition-all duration-1000`. design2.md Parts 5/10/11: must respect `prefers-reduced-motion`; rail expand should be "smooth but restrained."

### Charts / data-viz style
- Bar chart: thin `w-8` bars, `bg-tertiary` (active) / `bg-surface-dim` (inactive/weekend), `rounded-t-md`, opacity 80→100 on hover, dashed gridlines.
- **Progress ring** (Task Completion): SVG `r=40`, `stroke-width 10/12`, track `#ebeef5`, fill `#5d509c` (`stroke-linecap:round`, rotated -90°), centered `display-lg` percent + caption + a 2-item legend (green "Done" / gray "Pending"). DESIGN.md §Progress Rings: "thick stroke, light gray track, vibrant green or purple fill, percentage centered in Bold Manrope."
- Search-builder query blocks render compiled strings in `font-mono` on `bg-inverse-surface text-inverse-on-surface` code panels.

---

## 5) Deletion / confirm patterns & dropdown / menu patterns IN SOURCE

- **There is NO project-deletion modal anywhere in the Stitch source.** design2.md Part 1 ("Project deletion experience") must be built from scratch in the Stitch visual language (immutable plain-text project name + separate empty `Type "[Project Name]" to confirm` input + disabled-until-match Delete). Nothing to copy — only the token/button/modal styles above apply.
- **No real profile/account dropdown menu exists in the source.** The avatar is a static image; `pico` shows the closest thing — an avatar button `p-1 pr-3` + name "Dr. E. Hayes" + `arrow_drop_down` — but it opens nothing. design2.md Part 3 (add **Ops Console** item, admin-gated, with divider + control-panel icon) must be designed fresh; use Stitch dropdown styling = `bg-surface-container-lowest`, `rounded-lg`, `shadow-level-2`, Manrope, hover `bg-surface-container`.
- **Inline destructive affordance pattern (reuse for delete buttons):** search_builder concept blocks show `edit` + `delete` icon buttons revealed on `group-hover` (`opacity-0 group-hover:opacity-100`), `delete` button `hover:text-error`. full_text_review evidence chip has a `close` button `hover:text-error`. These are the source's destructive micro-patterns.
- **Confirm/accept pattern:** full_text_review AI-suggestion card uses paired buttons — ghost **Dismiss** (`text-on-surface-variant hover:bg-surface-variant`) + filled **Accept as Evidence** (`bg-tertiary-container text-on-tertiary-container hover:bg-tertiary`). Use this Dismiss/Confirm pairing as the modal-action template.
- **Selects / dropdowns (form):** native `<select>` styled `appearance-none` with a positioned `expand_more`/`arrow_drop_down` Material icon (pico Study Designs, full_text_review judgment select). 
- **Tabs:** search_builder strategy tabs = `border-b-2 border-primary text-primary font-bold` (active) over a scrollable tab strip, with a count badge `bg-primary-container text-on-primary-container`.
- **Top-bar context switcher:** project_overview/screening header titles paired with `expand_more`/`keyboard_arrow_down` imply a project/menu dropdown — but none is wired. Stitch `data_extraction` top bar has a `keyboard_arrow_down` next to "Research Workspace" (also non-functional).

---

## 6) CONFLICTS with design2.md — implementer MUST change these (do NOT copy source)

1. **"Research OS" branding** — `command_center` white-column header `<h1>Research OS</h1>` (L229) and `data_extraction` secondary header `<h2>Research OS</h2>` (L216). design2.md Part 1 §Branding: replace ALL "Research OS" → **"PecanRev"**; never "PecanRev Research OS".
2. **"PecanRev Sift" / engine naming** — project pages label the white column `PecanRev Sift` (project_overview L217, screening_1 L198, pico L176, search_builder L176). design2.md core principle: do NOT label areas as separate engines; use integrated workflow names. Drop "Sift".
3. **Standalone-engine rail items** — command_center/full_text_review/data_extraction rails show Library / Experiments / Analytics / "Tasks/Files/Messages" (screening_2). design2.md Part 1: REMOVE standalone-engine launch buttons; rail = global destinations only (Dashboard / Activity / Invitations & Collaboration / Help & Feedback) + profile + version.
4. **Duplicated project list in white sidebar** — `data_extraction` white column = a literal "Recent Projects" list (Cherry / Oakwood Trial / Project Willow) + sidebar "New Project" button (L220–250); `command_center` white column = Team Members list + "New Project" + "Invite Member". design2.md Part 1: REMOVE the `YOUR PROJECTS`/project list, REMOVE the sidebar-level New-Project button; replace with the workspace menu (Workspace Overview / My Work / Recent Activity / Invitations / Archived (or Starred/Recently-Viewed/Shared) / Resources).
5. **No "Welcome, [user]"** — source has no welcome treatment (shows "Research OS / Vinci Lab"). design2.md Part 1: add a prominent `Welcome, [first name]` with graceful fallback (never "Welcome, undefined" or an email).
6. **Sparse / wrong workflow stages** — Stitch's Phase Overview / Search Builder / Full Text Review / Data Extraction / Synthesis is NOT the canonical PecanRev workflow. design2.md Part 5 requires Project Overview + Project Control + the full legacy set (Plan & Protocol, Search, Screening, Data Extraction, Risk of Bias, Meta-analysis, PRISMA, Reporting) derived from legacy — Stitch supplies only the row styling, not the stage list. ("Full Text Review" in source = RoB 2; rename to the canonical stage names.)
7. **No version label** — must ADD subtle `v2.4.1` beneath the profile from the real version source (design2.md Part 1).
8. **No Ops Console dropdown, no deletion modal** — must be built fresh (design2.md Parts 1 & 3); nothing in source.
9. **Two purples + electric-indigo drift** — normalize to one tokenized purple (`#5d509c`); kill `#493ee5` (design2.md Part 9: no "multiple competing shades of purple without token definitions"). Likewise `bg-primary` vs `bg-tertiary` for the rail must be unified.
10. **Rail has NO collapse/expand interaction in source** — it's always icon-only-or-icon+label statically. design2.md Part 5 requires collapsed (icon-only + tooltips) ↔ expanded-on-hover/focus (full labels) with reduced-motion + keyboard + touch-drawer behavior. Build this; source gives only the static end-states.
11. **`screening_engine_2` / `_3` are throwaway** — RTL, "Pi / Research" branding, "Tasks/Dashboard/Files/Messages/Analytics" chat-app nav, "Team Members" drawer, "Research Workspace" title. Off-brand and off-IA. IGNORE for IA; they are NOT a source of truth.
12. **Glyph inconsistency** — `science` vs `biotech` vs `PR` monogram. Pick one (recommend "PR" tile or `science`); don't ship three.

---

## 7) One-paragraph implementation summary

Build the Stitch experience on **Manrope** + **Material Symbols Outlined**, an **8px spacing system** (rail 72px, contextual column 280px / 240–300 allowed, gutter 24, card padding 20), radii **8px small / 12–16px large / full for pills**, shadows **L1 `0 4px 20px rgba(0,0,0,.04)` / L2 `0 15px 35px rgba(0,0,0,.1)`**, and ONE purple token **`#5d509c`** (primary/active) with **green `#016e1c`/`#96f591` = success/Include/done** and **red `#ba1a1a` = destructive/Exclude**. The 72px purple rail holds GLOBAL destinations only (active = green `border-l-4 border-secondary-container` + `bg-primary-container` + filled icon; inactive = `opacity-60 hover:bg-primary-container`), profile avatar bottom, and a NEW subtle version label. The 280px white column is a CONTEXTUAL workflow sub-nav (not a project list, not "Research OS", not "Sift") whose rows + vertical stepper follow the full_text_review pattern (`check_circle`/`radio_button_checked`/`radio_button_unchecked` + `n/total` + linear bar). Pull the actual stage list from legacy, not from Stitch's sparse 4-stage invention. Deletion modal, Ops-Console dropdown, version label, and rail collapse/expand do not exist in the source and must be built fresh in this visual language.

---
**Output file:** `H:/META-LAB/META-LAB/.claude/Engine/design2-audit/F-stitch-source-ia.md`
