# Search Builder — Accuracy Correction Plan (SB4)

**Status:** implemented (core) + documented deferrals · **Scope:** guided Search Builder only · **Flag:** `searchEngine` (default OFF)

Follows SB3 ([search-builder-guided-ux-plan.md](search-builder-guided-ux-plan.md)). SB4
fixes two accuracy bugs at the root and adds a safe foundation for concept hygiene
(duplicate detection, move-between-concepts, controlled-vocab coverage, a Search
Quality Check). Engine logic stays pure + unit-tested; the heavy stateful component
keeps all its existing hooks.

---

## 1. Current behaviour (before SB4)

- **Step 1 (Select Keywords)** tokenizes each PICO field with `keywordSelection.js`
  → `tokenizeForSelection`. A token is `selectable` when it is **not** a filler word,
  where `FILLER_WORDS = STOPWORDS ∪ {short connector list}`.
- **PICO→concepts** is `syncSearchBuilderFromPico` (`searchState.js`): it extracts
  **each PICO field independently** via `extractFieldTerms` → `extractConcepts`
  (`conceptExtraction.js`), which maps a segment to a `CONCEPT_FAMILIES` entry
  (`medicalSynonyms.js`) and emits that family's term ladder + synonyms.
- **Organize Concepts** shows the five canonical groups; terms inside a concept are
  OR-ed, concepts are AND-ed. MeSH lookup + synonyms + hidden-terms already exist.
- **Hit counts**: PubMed-only, whole-strategy, via `pubmedCount` (debounced, race-guarded).
- **Autosave/sync**: idempotent persisted slice `{concepts, overrides, ignored,
  databases, readyForScreening}` + SSE realtime poke.

## 2. Root cause — noisy keyword suggestions

`STOPWORDS` (screening/keywords.js) is a *grammatical* stop list (a, the, of, with…).
It does **not** contain vague verbs/adverbs/qualifiers ("across", "including",
"grouped", "appropriately", "possibly", "underwent") or population-noise nouns
("patients", "subjects", "individuals", "participants"). Because Step 1 makes every
non-filler word selectable, those leak in as clickable keyword suggestions.

**Fix:** broaden the *selection* filler classification (a Search-Builder-specific set,
distinct from screening STOPWORDS) to also drop connectors, vague verbs/adverbs, and
population-noise nouns — while keeping real content words (adults, children, obesity)
and never breaking multi-word phrases (handled phrase-first).

## 3. Root cause — terms leaking across PICO concepts

`syncSearchBuilderFromPico` extracts each field independently and **never dedupes
across the five groups**. When a concept family (e.g. `eus` → "endoscopic
ultrasound"/"EUS") is mentioned in more than one field's text — common in messy PICO
like *"EUS-guided … versus transluminal … in malignant biliary obstruction"* — the
same generic term is emitted into Population, Intervention, and Comparator. Since
concepts are AND-ed, the repeated term over-narrows the search.

**Fix:** after building the five groups, run a **cross-group dedup of auto
(`pico_auto`) terms only**: a term that appears in >1 group is kept in the single most
appropriate group (by a per-family PICO **role hint** — procedures→Intervention,
outcomes→Outcomes, conditions→Population — else first by PICO order) and removed from
the others. User-added terms are never touched. A residual or user-created duplicate
is **detected and warned** (Part 4), not silently deleted.

## 4. Affected files / services

| File | Change |
|---|---|
| `research-engine/searchBuilder/keywordSelection.js` | Broaden filler/vague classification; more curated clinical phrases; meaningful-only suggestions. |
| `research-engine/searchBuilder/medicalSynonyms.js` | Add concept families + PICO role hints + spelling/acronym variants (biliary/EUS domain, GLP-1, tumour). |
| `research-engine/searchBuilder/searchState.js` | Cross-group auto-term dedup (role-aware) inside `syncSearchBuilderFromPico`; persist `dismissedWarnings`. |
| `research-engine/searchBuilder/crossConcept.js` (new) | Pure: term-equivalence key, cross-concept duplicate detection, Search Quality Check, sensitivity signal. |
| `features/searchBuilder/SearchBuilderTab.jsx` | Organize Concepts: duplicate warning + move-between-concepts + per-concept controlled-vocab coverage; Search Quality Check panel; total hit count + sensitivity. |
| `server/searchEngine/searchEngineController.js` | Whitelist `dismissedWarnings`. |

## 5. Minimal, safe implementation plan (in order)

1. **Noise (Part 2):** expand the Search-Builder filler set + curated phrases; tests.
2. **PICO-aware dedup (Part 3):** role-hinted cross-group dedup of auto terms; tests.
3. **Duplicate detection (Part 4):** pure `detectCrossConceptDuplicates` (synonym-aware) + UI warning with move/keep/hide.
4. **Move between concepts (Part 5.1):** a per-term "Move to…" menu (keeps vocab); strategy preview updates automatically.
5. **Controlled-vocab coverage (Part 6):** per-concept indicator (MeSH found / none yet / needs review) from existing vocab; Emtree honestly stubbed.
6. **Synonyms/variants (Part 7):** vocabulary enrichment with clear labels.
7. **Hit count + sensitivity (Part 8):** total-strategy count + sensitivity badge in Organize Concepts (reuse existing `hitState`).
8. **Search Quality Check (Part 9):** pure warnings foundation + compact panel.

## 6. Risks & mitigations

- **Dropping a term the user wanted (dedup).** Only `pico_auto` terms are deduped
  (re-derivable); user terms are warned, never auto-removed. Hidden/ignored bookkeeping unchanged.
- **Mis-routing by role hint.** Role hints only break ties for an *already-duplicated*
  term; non-duplicated terms keep their field. A wrong call surfaces as a "Needs
  review" duplicate the user can move.
- **Breaking autosave/sync.** Engine changes are pure; the component keeps its hooks.
  New persisted field is additive + whitelisted.
- **Over-aggressive noise filtering.** Filler list is curated (explicit words), not a
  broad morphological rule, so real terms (adults, antegrade) stay selectable.

## 7. Assumptions

1. "Term family" = the existing model where all terms in one concept are OR-ed; combine
   = move variants into the same concept. No new nested data structure (documented).
2. Concept-level hit counts (one PubMed call per concept) are deferred to avoid
   multiplying live calls; the total-strategy count + sensitivity ships now.
3. Emtree has no live backend; the engine already renders Embase syntax from the
   `emtree` field of the offline vocab — treated as a safe stub, documented.
4. Move-between-concepts ships as an accessible menu; true drag-and-drop is deferred.

## 8. Test plan

Extraction: connectors/vague verbs/population-noise not suggested; phrases preserved;
content words retained. PICO mapping: role-aware dedup keeps EUS in Intervention, out
of Population; no cross-group duplicate auto-terms. Duplicates: equivalence (EUS ≡
endoscopic ultrasound, T2DM ≡ type 2 diabetes) detected across AND-ed concepts.
Quality: empty-concept / multi-concept-term / no-controlled-vocab warnings. Sensitivity
buckets. Regression: full unit suite + build; manual concepts/terms/hidden preserved.

Deferred items are tracked in [search-builder-future-enhancements.md](search-builder-future-enhancements.md).
