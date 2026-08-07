# 102.md — Manual-input placeholders in the Manuscript Editor (v4.9.0)

The goal (§81): **make manual manuscript completion almost impossible to overlook.**
Open the editor, immediately know whether anything still needs you, and step through
every required field without hunting for square brackets.

---

## 1. The hard part is §7, not §1

Finding `[...]` is a one-line regex. Finding it **without claiming the square brackets
that saturate scientific prose** is the entire engineering problem:

```
[1]  [1-3]  [12, 15]                citation markers
[0.82, 1.14]  [95% CI 1.05 to 1.47] interval notation
[sic]  [emphasis added]  [...]      editorial insertion in a quotation
[NCT01234567]  [CRD42026123456]     registry identifiers
[Na+]  [H2O]                        chemical notation
```

Turning any of those into an editable "manual field" would be worse than not shipping
the feature — a reader would be invited to type over a confidence interval.

So `placeholders.js` is **default-deny**. A bracketed span becomes a placeholder only
when it *positively* matches one of:

1. the **declared catalogue** (`GENERATED_PLACEHOLDERS`) — this is §64's "internal
   placeholder metadata/type instead of relying exclusively on parsing", so anything
   PecanRev generates is matched by identity, never by guesswork;
2. a **pending-data shape** (`^No `, `… unavailable`, `not yet available`, `not
   recorded`, `incomplete`);
3. an **imperative opener** (`Add`, `State`, `Enter`, `Specify`, `Describe`, `Insert`,
   `Interpret`, …) — which is exactly how instructions to an author read.

Everything else stays ordinary text. Three deny rules run first regardless: editorial
apparatus, registry identifiers, and *notation* (no lower-case word of 3+ letters, or
built only from digits and separators). `[[cite:]]`/`[[table:]]`/`[[fact:]]` tokens
and markdown link text are excluded structurally.

A test feeds a paragraph containing a CI, two citation ranges, a `[sic]`, an NCT
number and a markdown link, and asserts **zero** detections.

---

## 2. Two kinds, and why the distinction is scientific

| kind | meaning | counted as "manual fields remaining"? |
| --- | --- | --- |
| `manual` | prose only the researcher can write — *"State the review objective"* | **yes** |
| `pending` | a fact the **project** will supply — *"No completed search on record"* | no |

This is not cosmetic. A researcher resolves a `pending` field by **running the search**,
not by typing. Inviting them to type over it would produce exactly the fabricated
methodology 101.md §17 exists to prevent — someone typing "PubMed, Embase" over
`[No database search has been recorded]` has just asserted a search that never ran.

So the two are counted separately (`3 manual fields remaining` · `8 awaiting project
data`), styled differently, and **prev/next skips `pending` fields entirely** — stepping
a researcher into a field they must not fill would be a dead end.

On an empty project a freshly generated draft reports 14 manual and 12 pending. Methods
is `0 manual / 8 pending`, which is the right answer: Methods is entirely project-derived.

---

## 3. Rendering — reusing the chip mechanism, not inventing one

The editor already renders three atomic `contenteditable=false` chip types
(`[[cite:]]`, `[[table:]]`, `[[fact:]]`). A placeholder becomes a fourth:

```html
<span class="ms-input" data-input="Enter institution name" data-input-kind="manual"
      title="Manual input required" role="button" tabindex="0"
      contenteditable="false">[Enter institution name]</span>
```

Being atomic is what delivers **§3** — clicking anywhere selects the *entire*
placeholder including both brackets, so the researcher types straight over it. And
because it is the same mechanism the existing chips use, **§9 comes for free**: undo/redo
stay on the native `execCommand` stack, copy/paste carries the literal `[label]`,
autosave is untouched, and `htmlToMd(mdToHtml(md)) === md` byte-for-byte (pinned).

**Ordering matters.** The placeholder pass runs *first* in `inlineHtml`, while the text
is still literal markdown. After the chip passes, the HTML contains a citation chip's own
`[1]` label — scanning for brackets then would decorate it. The classifier's deny rules
are the second line of defence, and a test asserts a cite chip is never decorated.

---

## 4. Navigation across the whole manuscript (§2)

The editor shows one section at a time, so "next field" usually means *switch section,
wait for that editor to mount, then reveal the field*. `manuscriptPanels.jsx` carries the
target across the remount and retries across a few frames rather than assuming one
timeout is enough.

Placeholders are addressed by **ordinal within a section**, not by a stamped DOM id,
because chips are re-rendered from markdown on every mount and any id would not survive.

`focusPlaceholder(ordinal)` on the editor scrolls the chip into view (`block: 'center'`),
focuses the surface, and selects the whole node.

**Shortcuts:** `Ctrl/Cmd+Enter` → next field, `Ctrl/Cmd+Shift+Enter` → previous. Both are
free inside a contentEditable and are not intercepted by the editor (which only takes
B/I), so ordinary typing, undo and selection are unaffected.

Statements (Funding, Ethics, …) are scanned too — `[State the funding source, or "None."]`
is precisely the field that gets forgotten.

---

## 5. Counter and list (§5, §6)

`ManualFieldsPanel` sits directly above the toolbar and **renders nothing at all when the
manuscript is complete** — the absence is itself the signal §83 wants, and a permanent
"0 remaining" would be noise.

The expandable list groups by section, so §53 ("see which manuscript section contains each
unresolved field") is answered directly, and every row navigates to its field.

§6 asks for the count to update "immediately without requiring refresh". The stored draft
only catches up after the 600 ms autosave debounce plus the project round trip, so
`useManuscript` keeps a **live overlay** of the section being typed and counts against it.
Re-rendering per keystroke is safe here precisely because the editor is *uncontrolled*:
`RichSectionEditor` renders its HTML once per mount key and React sees an identical string
afterwards, so a parent re-render never touches the DOM or the caret.

---

## 6. Styling (§4)

Prose font kept — this is draft manuscript text, not a widget. The decoration is a soft
tint plus a **dotted underline**, and the underline is what carries the meaning when
colour is unavailable (print, high-contrast, colour-blind readers). Pending fields use a
cool tint and a **dashed** rule, so the two kinds stay distinguishable without hue.
The list markers differ in **shape** as well as colour. Hover gives "Manual input
required"; a pending field says "Awaiting project data — complete this step in the
project, not by typing".

---

## 7. §8 — never ask for what the project already knows

Audited all 37 generated placeholders. Most are genuinely authorial (interpretation,
limitations, implications, funding) and correctly unconditional. The generator already
used `pico.question` and `pico.O` when present.

One real violation was found and fixed: the Lancet abstract asked the author to
`[State eligibility and registration]` **even when the project held both**. It now
narrows to whichever half is missing and disappears entirely when both are known:

| project state | rendered |
| --- | --- |
| neither | `[State eligibility and registration]` |
| registration only | `Registered as CRD42026123456. [State the eligibility criteria]` |
| eligibility only | `Eligibility followed the pre-specified criteria. [State the protocol registration…]` |
| both | `Eligibility followed the pre-specified criteria; registered as CRD42026123456.` |

With `factTokens` on (101.md), the registration id is emitted as a **live token**, so a
PROSPERO number added later fills itself in with no regeneration.

A test asserts that **every** bracketed span a generated draft emits is classifiable —
so a new generator string can never silently leak as undetected prose.

---

## 8. Testing

`npm run test:ci` — **410 files, 6481 tests, all passing** (was 408 / 6415).

| File | Covers |
| --- | --- |
| `tests/unit/manuscript/placeholders.test.js` (53) | §7 precision (24 notation cases + a full prose paragraph), detection, the two kinds, grouping, wrap-around navigation, chip round trip, §8 |
| `tests/unit/manuscript/manualFieldsUi.test.jsx` (13) | counter wording and singular/plural, separate pending count, hidden-when-complete, shortcuts discoverable, section names in the list, `aria-current`, no colour-only signalling |

---

## 9. Deliberate limitations

1. **A placeholder cannot be partially edited.** The chip is atomic, so clicking selects
   the whole field and typing replaces it. That is §3's explicit intent ("immediately type
   and replace… without manually highlighting it"), but it does mean a researcher who
   wants to keep the brackets and edit inside them must retype the whole span.
2. **Hand-typed brackets are classified by shape, not by declaration.** Someone who types
   `[check this later]` gets a manual field (imperative opener); someone who types
   `[my note to self]` does not. There is no UI to mark an arbitrary span as a manual
   field. Given §7's cost asymmetry, defaulting to *not* claiming text is the right bias,
   but it is a real limit.
3. **Statement fields navigate to the Statements page, not to the exact field.** The
   statements editor is a separate surface without the ordinal-addressing the section
   editor has; the list still names the field and the page.
4. **The live-overlay count tracks section edits only.** Editing a *statement* updates the
   count on the normal autosave cycle rather than per keystroke.
5. **`pending` fields are informational.** Clicking one in the list selects it but does not
   deep-link into the Search/Screening/Analysis engine that would resolve it. Routing a
   placeholder to the engine that fills it is the natural follow-up.
6. **No per-placeholder resolution history.** A resolved field simply stops being detected;
   there is no record that it was once outstanding. The 101.md `factLog` covers
   project-derived values, not authorial prose.
