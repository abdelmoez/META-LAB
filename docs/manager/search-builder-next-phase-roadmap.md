# Search Builder — Next-Phase Roadmap (deferred from SB5)

Advanced, higher-risk capabilities intentionally **not** built in SB5 (per the task's
"document advanced features as next phase"). Listed in recommended order.

## 1. Live controlled-vocabulary disambiguation (MeSH + Emtree)
- **What:** call the NLM/Emtree services to rank candidate headings and reject
  close-but-wrong ones semantically (e.g. suppress "EUS-Guided Fine Needle Aspiration"
  for an EUS *biliary drainage* review). SB5 ships an **offline confidence heuristic**
  (token-overlap + family agreement) and a "review" label; it never auto-adds a heading.
- **Why:** a wrong MeSH term silently narrows or skews the search.
- **Risks/needs:** live API keys, rate limits, caching, a CI mock; must stay offline in tests.

## 2. Concept-level + multi-database live hit counts
- **What:** per-concept and per-database hit counts with debouncing and a per-call
  failure boundary. SB5 shows the **total PubMed count + a sensitivity signal** only.
- **Risks/needs:** multiplies live calls; needs aggressive caching + backpressure.

## 3. Multi-concept extraction from a single messy field
- **What:** split a Population like *"failed ERCP in malignant biliary obstruction"*
  into BOTH "failed ERCP" and "malignant biliary obstruction" (today the engine keeps
  the dominant family). Needs a safe multi-family extractor that won't over-segment
  fixed phrases ("carcinoma in situ", "quality of life").
- **Why:** richer, more complete Population concepts.
- **Risks:** over-extraction / fragmentation — needs the benchmark to gate it.

## 4. Validated search filters / hedges
- **What:** append curated study-design filters (Cochrane RCT filter, McMaster hedges,
  diagnostic-accuracy filters) the user can toggle per database.
- **Risks/needs:** maintaining validated, citeable filter strings per database.

## 5. PRESS-style quality checklist + PRISMA-S report export
- **What:** a full Peer Review of Electronic Search Strategies checklist and a
  reproducible PRISMA-S search report (per-database strategy, dates, hits, dedup).
  SB5 ships a lightweight Search Quality Check foundation only.

## 6. True drag-and-drop term reorganization
- **What:** drag terms between concepts / into term families. SB5 ships an accessible
  "Move to…" menu (keyboard-friendly, testable).

## 7. Institutional database-access logic
- **What:** reflect a user's institutional holdings (which databases they can actually
  open) and tailor export/access notes. SB5 ships conservative static access notes.

## Recommended order
1 (vocab safety) → 3 (multi-concept extraction, gated by the SB5 benchmark) → 2 (hit
counts) → 4 (filters) → 5 (PRESS/PRISMA-S) → 6 (drag-drop) → 7 (institutional access).
