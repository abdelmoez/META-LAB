# ADR: Canonical query representation — a structured AST, not a string

**Status:** Accepted · **Scope:** Pecan Search Engine (P1)

## Context

The same Boolean strategy must be executed against several databases with incompatible
grammars. Translating from a flat query string via per-provider string replacement is
fragile and silently lossy.

## Decision

Represent the strategy as a **canonical Abstract Syntax Tree** (`query/ast.js`):

```
{ raw, version,
  concepts: [{ id, label, op:'AND'|'OR', terms: [{ text, type, field, vocab,
                                                    noExplode, truncate, phrase }] }],
  filters: { dateFrom, dateTo, languages[], pubTypes[] } }
```

- **Concepts combine with AND; a concept's terms combine with its own `op` (default OR)**
  — the standard PICO shape.
- `field` is a provider-neutral semantic kind (`title`, `abstract`, `tiab`, `author`,
  `journal`, `doi`, `pmid`, `mesh`, `keyword`, `all`, `year`); each connector maps it to
  its own field tags.
- `normalizeCanonical()` is **total and defensive** — it coerces arbitrary input into the
  canonical shape with caps applied (`QUERY_LIMITS`) and never throws; malformed
  terms/concepts are dropped.
- `validateCanonical()` does provider-independent structural validation.
- `renderPlain()` produces a database-neutral human rendering for display + the report.
- `hashQuery()` gives a stable short hash of each executed query string.
- Translators walk the normalized AST and emit a provider string **plus** a structured
  `TranslatedQuery` (`makeTranslated`: `supported[]` / `unsupported[]` / `warnings[]` /
  `assumptions[]`), so the engine never silently weakens a query.

The search builder already stores a structured concept/term model, so P1 consumes that
structure directly rather than re-parsing a string.

## Why not translate from a flat string per provider

- String replacement can't reliably preserve operator precedence, phrase quoting, field
  scoping, or truncation across grammars.
- It can't tell the user *what was lost* per source — the structured `TranslatedQuery` +
  warnings is the whole point (reproducibility + reviewer defensibility).

## Consequences

- The exact executed provider string is still stored per source (`finalQuery` +
  `queryHash`) — the AST is the source, the rendered string is the audit record.
- A provider that can't express a clause emits a warning instead of a wrong query.
- Caps (`MAX_CONCEPTS`, `MAX_TERMS_PER_CONCEPT`, `MAX_TERM_LEN`, `MAX_QUERY_LEN`) bound
  worst-case query size.

## References
`query/ast.js`, `connectors/pubmed.js` (`translatePubmed`), `report.js`,
`ARCHITECTURE.md` §2–§3, `USER_GUIDE.md` §1–§2.
