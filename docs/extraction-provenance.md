# Extraction Provenance

PecanRev's structured extraction is **provenance-first**: every datapoint records where it came from,
who entered it, and whether AI assisted.

## Provenance record shape

Stored as JSON on every `ExtractionValue` and `ExtractionConsensus` row:

```json
{
  "type": "sentence | paragraph | page | table | table_cell | figure | manual | ai",
  "excerpt": "verbatim source text (≤500 chars)",
  "location": { "field": "abstract | title | fullText | text", "start": 123, "end": 156 },
  "page": 4,
  "table": "Table 2",
  "row": 3,
  "col": 2
}
```

Row-level columns add the rest of the audit trail:

- `userId` / `userName` — the extractor (values) or adjudicator (consensus)
- `origin` — `manual` | `ai_accepted` | `ai_edited`
- `suggestionId` — the `AiExtractionSuggestion` the value came from, when AI-assisted
- `createdAt` / `updatedAt` — timestamps
- Consensus: `source` (`agreement` | `accept_a` | `accept_b` | `adjudicated`), `aiAssisted`, `note`,
  `resolvedById/Name`

## AI provenance rules

- Heuristic suggestions carry sentence-level `location` offsets into the exact text they were derived from.
- External-LLM suggestions are **grounding-checked server-side**: the excerpt must literally occur in the
  submitted text or the suggestion is dropped before it is ever shown.
- The provider + model of every suggestion set is persisted on the `AiExtractionSuggestion` row
  (`provider`, `model`) for the audit trail.

## Downstream provenance

`send-to-ma` marks the blob study `source: "calculated"`, sets `converted: true` and appends a
`conversions[]` audit entry (`method: "structured-extraction-consensus"`), so the meta-analysis input's
lineage back to adjudicated consensus values is inspectable in the classic extraction QC panel.
