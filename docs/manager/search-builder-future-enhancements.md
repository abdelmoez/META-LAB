# Search Builder — Future Enhancements (deferred from SB4)

Captured per the SB4 spec (Part 9) so the deferred scope is explicit and honest.
None of these are required for SB4's acceptance; they are the natural next steps.

## Search Quality Check → full peer review
- **PRESS-style checklist** (Peer Review of Electronic Search Strategies): line-by-line
  validation (Boolean logic, field tags, spelling, truncation, limits, translation
  across databases). SB4 ships only the high-value warnings (noisy term removed, term
  in multiple concepts, no controlled vocabulary for a major concept, missing acronym
  expansion, concept has no terms, outcome/comparator may over-narrow).
- **PRISMA-S search report export** — a reproducible, manuscript-ready search report
  (per-database strategy, dates run, hit counts, dedup counts, filters used).
- **Validated filters / hedges** — curated RCT / systematic-review / diagnostic
  study-design filters (e.g. Cochrane RCT filter, McMaster hedges) the user can append.

## Controlled vocabulary
- **Live Emtree** for Embase (currently the Embase string is rendered from the offline
  `emtree` field of the core vocab — a safe stub; there is no live Emtree backend).
- **Per-term explode tree visualization** (narrower-term preview) beyond the existing
  MeSH detail panel.

## Hit counts
- **Concept-level live hit counts** (one PubMed call per concept) + per-database counts,
  with strong debouncing and a per-call failure boundary. Deferred to avoid multiplying
  live external calls; SB4 shows the total-strategy count + a sensitivity signal.

## Organize Concepts
- **True drag-and-drop** of terms between concepts (SB4 ships an accessible "Move to…"
  menu instead, which is testable and keyboard-friendly).
- **Nested term families** as a first-class data structure (SB4 treats a concept as the
  OR family; combining = moving variants into one concept).

## Collaboration / state
- Richer conflict resolution (currently last-write-wins per project, with realtime
  pokes); per-field merge for simultaneous edits.
