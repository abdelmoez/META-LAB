# Global Workflow-Menu Collapse

_Prompt 34, Task 8 — version 3.16.0_

This note documents the unification of the workspace sidebar (workflow-menu) collapse behaviour into a single persisted state that applies to every project page, including Screening. All changes are in the monolith `meta-lab-3-patched.jsx` (the `MetaLab` workspace component and the universal `ProjectHeaderBar`).

## What changed in one sentence

The collapse of the left workflow menu is now **one user choice** — `navCollapsed`, persisted in `localStorage` under `metalab.navCollapsed` — toggled by the universal header's `☰` button on every tab, instead of two separate, inconsistently-behaving states split across the Screening boundary.

## Prior state — two disjoint collapse states

Before this change the workspace tracked the sidebar's visibility with **two independent pieces of state**, and which one was in effect depended on whether the user was on the Screening tab:

- `screeningFocus` — a `useState(true)` flag that defaulted to collapsed (focus mode) and was used **only** while on the Screening tab. It was **not persisted**: it reset to its default every time the workspace component mounted, and it never reflected what the user had chosen on any other tab. This originated in prompt19, where Screening's full-bleed workbench auto-entered a focus layout that slid the sidebar away.
- `navCollapsed` — a `useState` flag that **was** persisted to `localStorage` (`metalab.navCollapsed`) and was used for every **non-Screening** tab. This was introduced in prompt24 with the universal header's `☰` button.

The two were stitched together by an `inScreening`-keyed selector:

```js
const focus = inScreening ? screeningFocus : navCollapsed;
const toggleNav = () => { if (inScreening) setScreeningFocus(f => !f); else setNavCollapsed(c => !c); };
```

### Why that was inconsistent

Because the active collapse state flipped between two variables at the Screening boundary, the menu's behaviour was discontinuous in a way users could feel:

- **Entering Screening discarded the user's choice.** If a researcher had expanded the menu on, say, Analysis (`navCollapsed = false`), opening Screening switched to `screeningFocus`, which defaulted to collapsed — so the menu vanished even though the user had just chosen to keep it open.
- **Leaving Screening discarded the Screening choice.** Toggling the menu while in Screening only mutated `screeningFocus`; that change was lost on the next tab (which read `navCollapsed`) and never survived a reload because `screeningFocus` was never written anywhere.
- **The collapse was not a single, stable preference.** The same `☰` button meant "toggle a persisted preference" on most tabs but "toggle a transient, Screening-only flag" on Screening, with no shared memory between them.

## New state — one unified, persisted collapse

The split is removed. `screeningFocus` no longer exists. There is a single source of truth:

```js
const [navCollapsed, setNavCollapsed] = useState(() => {
  try { return localStorage.getItem("metalab.navCollapsed") === "1"; } catch (_) { return false; }
});
useEffect(() => {
  try { localStorage.setItem("metalab.navCollapsed", navCollapsed ? "1" : "0"); } catch (_) { /* best-effort */ }
}, [navCollapsed]);
```

`focus` and the toggle now collapse to plain aliases of that one state, with no `inScreening` branch:

```js
const focus = navCollapsed;
const toggleNav = () => setNavCollapsed(c => !c);
```

`focus` is the value passed down to the layout; it is `true` when the menu is collapsed. The initial value is read from `localStorage` on mount (defaulting to expanded, `false`, on a fresh browser), and every change is written straight back, so the choice survives reloads and persists identically across all tabs.

### One toggle, on every page

The universal `ProjectHeaderBar` — the single sticky bar rendered on every project page (Overview, PICO, Screening, Extraction, Analysis, PRISMA, Report, Project Control) — owns the `☰` button. `MetaLab` wires it up with `onToggleFocus={toggleNav}` and `focus={focus}`, so the same button toggles the same state regardless of which tab is open. The button reflects state in its label/title (`focus ? "Show menu" : "Hide menu"`) and renders in an accent style while collapsed.

### Sidebar slide and main-content margin

The collapse is animated, not a hard show/hide:

- **Sidebar.** The fixed 256px sidebar slides off-screen via `transform: focus ? "translateX(-100%)" : "none"` with a `transition: transform 0.25s ease`.
- **Main content.** The workspace column reclaims the space with `marginLeft: focus ? 0 : 256` and a matching `transition: margin-left 0.25s ease`, so the workbench expands to the full viewport width when the menu is hidden.

## What stays visible when collapsed

Collapsing only hides the **left workflow menu**. Everything in the universal header's right-hand utility cluster remains on screen, because that cluster lives in `ProjectHeaderBar`, not in the sidebar:

- the **Project / Project overview / Projects** breadcrumb and Back-to-Projects navigation,
- the **presence** indicator (`PresenceIndicator`),
- the **chat** launcher (`MetaLabChatLauncher`),
- **notifications** (`NotificationsBell`), and
- the **account** menu (`UserMenu`).

So a collapsed menu never strands the user: they can still see who is online, open chat, check notifications, and navigate away.

## Deliberate behaviour change — Screening no longer auto-collapses

This unification is an intentional behaviour change worth flagging for support and onboarding: **opening the Screening tab no longer automatically collapses the menu.** Previously Screening forced its own focus layout on entry (the old `screeningFocus` default). Now the menu's collapsed/expanded state on Screening is exactly the user's single persisted choice — the same as on every other tab. A user who keeps the menu expanded will see it stay expanded in Screening; a user who collapses it once will find it collapsed everywhere until they toggle it back.

Note that this affects only the **menu collapse**. Screening's full-bleed content layout — the padding/overflow treatment that lets the embedded META·SIFT workbench escape the standard content clamp — is still driven separately by the `inScreening` flag (`tab === "screening"`) and is unaffected by the menu state.

## Known limitations

- **Persistence is per-browser, not per-user.** The choice is stored in `localStorage` under `metalab.navCollapsed`, so it is scoped to a single browser profile on a single device. A user who collapses the menu on their laptop will not see that choice reflected when they sign in on another machine or in a different browser. Syncing this preference to the server per user (alongside the other cross-device dashboard/screening preferences) is a possible future enhancement.
- **Best-effort storage.** Reads and writes are wrapped in `try/catch`; if `localStorage` is unavailable (e.g. blocked by privacy settings), the menu defaults to expanded and the choice is not remembered for that session. This is a graceful fallback, not an error.
