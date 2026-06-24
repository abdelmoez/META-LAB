# Injection Hardening — Regex/ReDoS, Template Injection, Query Injection (prompt 53)

Three coordinated workstreams: **WS3** bound/validate user-controlled regex (ReDoS),
**WS4** block server-side template injection (SSTI), **WS5** prevent NoSQL/query
injection. This was an audit-first task: trace every user-controlled input to the
dangerous sink and harden the real path — **without inventing findings**.

> **Headline result:** all three bug classes were audited end-to-end. The codebase
> was already hardened against every reachable case (escaping, no template engine,
> Prisma type-safety + allowlists). **One genuine, adjacent gap** was found and
> fixed (CSV formula-injection in the screening export). The rest of this work
> **pins the existing invariants with regression tests** so they cannot silently
> regress, and documents the evidence.

## 1. Architecture & scope

| Aspect | Finding |
| --- | --- |
| Server | Express (`server/`), Node 20. Frontend: React 18 + Vite SPA. |
| **Database** | **Prisma** over **SQLite** (default; optional PostgreSQL via `DATABASE_PROVIDER`). `server/prisma/schema.prisma` `provider="sqlite"`. **No NoSQL / document store** — `package.json` has no mongoose/mongodb/nedb/nano/firebase/dynamo/elasticsearch. |
| Raw SQL | App code uses only the parameterless `prisma.$queryRaw\`SELECT 1\`` health check (`index.js`, `adminController.js`). **No `$queryRawUnsafe`/`$executeRawUnsafe` in app code** (the only hits are in the vendored `server/prisma/generated/postgres-client/runtime/` engine). |
| Template engine | **None.** No handlebars/ejs/pug/nunjucks/mustache/eta/liquid. Emails + HTML/CSV reports are built from **static backtick templates** with values inserted as data. No `eval`/`new Function`/`renderString`/`vm.run*`/dynamic `require(req.*)` in app code. |
| Validation | Zod on import + autosave bodies (prompt49); per-field type guards in auth; allowlists in admin search/sort. |

## 2. WS3 — Regex / ReDoS

**Conclusion: SAFE-AS-WRITTEN. No new regex hardening required.**

User-controlled search/highlight terms are **escaped to literals** before any
`RegExp` construction, so attacker metacharacters are inert and a
catastrophic-backtracking string typed as a search term becomes a literal match
(linear time). Verified controls (cite, do not re-implement):

| Path | Control |
| --- | --- |
| Screening highlight | `src/research-engine/screening/highlight.js` `escapeRegExp`; the hot match path uses `indexOf` string search (no regex). |
| In-PDF search | `src/frontend/components/pdfSearch.js` `escapeRegExp(needle)` + a ≤5000-match/page cap; **browser-only** (a hang would affect only the user's own tab). |
| PICO concept extraction | `src/research-engine/searchBuilder/conceptExtraction.js` `escRe`; connectors are a fixed list. |
| Screening concept keywords | `src/research-engine/screening/conceptKeywords.js` `escapeRe`. |
| Import parsers | `parsers.js` / `referenceParsers.js` build `new RegExp(field+…)` / `delim` from **fixed literals** (RIS/BibTeX field names, a 3-value delimiter sniffer); `screeningController.js` RIS `tag` is a hardcoded literal; `pubmedXml.js` re-wraps a constant `.source`. The untrusted file is always the *haystack*, never the *pattern*. Parsers are linear O(n) single passes and run in the **one-at-a-time durable import worker** (prompt50), so a large file is bounded latency, not catastrophic backtracking. |

No nested/overlapping/ambiguous quantifier is reachable with attacker input.
PecanRev does **not** expose a user-supplied-regex feature, so no RE2/worker
isolation is needed.

**Regression tests:** `tests/unit/security/regexSafety.test.js` — every metachar
escaped; a `(a+)+$` payload typed as a term runs against a 100k-char hostile
string in <2s (linear, because it is literal).

## 3. WS4 — Server-side template injection

**Conclusion: N/A as a sink class — no template engine, no user-controlled
compilation. Output escaping verified.**

Every server-side rendering path uses a **trusted static template + escaped data**:

| Path | Control |
| --- | --- |
| Email (`server/services/emailService.js`) | Static backtick templates; `escapeHtml()` on **every** interpolated user/DB value (toName, bodyText, projectName, inviterName, roleLabel, link, originalSubject, firstName, supportEmail, …); plain-text variants are not HTML-rendered. No engine, no compilation. |
| Email headers | `subject`/`to` go through nodemailer, which MIME-word-encodes header values and rejects CR/LF (header-injection safe); `from` is the fixed `EMAIL_FROM` env; reply/compose routes are admin/mod-gated. |
| pecanSearch HTML report (`report.js` `reportToHtml`) | `escapeHtml` wraps every dynamic value before `res.send(... text/html)`; owner-scoped; flag OFF by default. |
| SPA theme inline `<script>` (`spaTheme.js`) | HEX-validated brand color, whitelisted preset/mode, `<`→`<` escape, CSP nonce — cannot break out (see CSP doc, prompt 51). |
| Export filenames (`Content-Disposition`) | `importExportController.js` replaces non-alphanumerics with `_`; `screeningPdfController.js` strips `["\\\r\n]`; pecanSearch/screening/waitlist filenames are fixed-prefix + id. No header injection / path traversal. |

**Regression tests:** `tests/unit/security/emailTemplateInjection.test.js` —
`{{7*7}}` / `${7*7}` / `<%= 7*7 %>` / `<script>` / `<img onerror>` / CRLF injected
into every email template render **inert** (template syntax survives as literal
text; no raw `<script>`/`<img>` tag; escaped form present).

## 4. WS5 — NoSQL / query injection + mass-assignment

**Conclusion: NoSQL operator injection is N/A (no document store). SQL injection is
not expressible (Prisma parameterization). Object-injection / mass-assignment
paths are guarded.** Verified controls:

| Path | Control |
| --- | --- |
| All app DB access | Prisma parameterized query builder. Prisma rejects non-scalar `where` values, so Mongo-style `{$ne:null}` operator objects cannot change query logic. |
| Auth (login / forgot / resend / reset / verify) | `typeof email/token !== 'string'` rejection + scalar-coerce before `findUnique`/consume (`authController.js:151,233,356,419,457`). An object/array credential is rejected, never reaches the DB, never leaks an error. |
| Sort / projection | `PROJECT_SORT_COLUMNS` allowlist + `'asc'`/`'desc'` ternaries (`adminController.js:490,1052,2113`); no field name or direction taken raw from the request. |
| Autosave mass-assignment (`projectsController.js` `{...req.body,id}`) | `store.save()` takes `userId` from the **`req.user.id` function param**, never the body; `FOREIGN_PROJECT` 403 cross-user guard; soft-delete resurrection guard; only `{id,name}` + an opaque JSON `data` blob are written. A body `userId`/`id` cannot reassign ownership. |
| Admin onboarding update (`onboardingController.js` `{...existing,...req.body}`) | `coerceQuestionInput()` is a **strict allowlist** — it builds a fresh object with only `{prompt,description,type,options,isActive,isRequired,allowSkip,displayOrder}`, type-coerced; behind an admin-only route. Protected/unknown keys (`id`,`key`,`createdAt`,`__proto__`,…) are dropped. |

**Regression tests:**
- `tests/unit/security/massAssignment.test.js` — `coerceQuestionInput` returns
  *only* the 8 whitelisted fields; drops `id`/`key`/`createdAt`/`isAdmin`/`userId`/
  `__proto__`/arbitrary keys; no prototype pollution.
- `tests/integration/injection-hardening.test.js` (live server) — login/reset with
  an object/array email/token → 400/401 (never 200, never 500, no `prisma|sql|stack`
  in the response); autosave with a body `userId`/`id` does not reassign ownership.

## 5. The one genuine fix — CSV formula injection (CWE-1236)

The screening CSV export (`screeningController.js`) quoted cells (RFC-4180) but did
**not** guard spreadsheet formula injection, unlike pecanSearch's `report.js` which
already did. A study `title`/`authors`/`notes` value (from an untrusted import) such
as `=HYPERLINK("http://evil")` or `=cmd|…` would execute when a reviewer opens the
export in Excel/Sheets/LibreOffice.

**Fix:** centralized one safe cell encoder `server/utils/csv.js` (`csvField`/`csvRow`)
that prefixes a `'` to any cell beginning with `= + - @` (or a leading tab/CR) and
RFC-4180-quotes specials. The screening export now uses it; pecanSearch's `report.js`
`csvCell` now delegates to it (removes the duplicate implementation — one owner).

**Regression test:** `tests/unit/security/csvInjection.test.js`.

## 6. Shared validation architecture

`server/utils/csv.js` is the single CSV-cell encoder. Regex escaping lives in the
per-feature `escapeRegExp`/`escRe`/`escapeRe` helpers (search/highlight). Auth type
guards + admin sort allowlists + `coerceQuestionInput` stay route-local (small,
composable — no giant permissive schema). Validation errors return stable
user-facing messages; controllers log `err.message` server-side only (no stack /
SQL / template / schema details in HTTP responses).

## 7. Tests & verification

- New unit tests (CI): `tests/unit/security/{csvInjection,emailTemplateInjection,regexSafety,massAssignment}.test.js` — 18 tests.
- New live-server integration test: `tests/integration/injection-hardening.test.js` (WS5 auth/object-injection + autosave ownership; skips when the server is down).
- Full CI suite green; production build green. (See the commit for exact counts.)

## 8. How to add new code safely

- **Regex:** never put unescaped user text into `new RegExp` — wrap with the
  feature's `escapeRegExp`. Build dynamic patterns from fixed literals only. Bound
  the input length first. No user-supplied-regex feature without RE2/worker isolation.
- **Templates/emails:** keep templates static; pass user values as data and run them
  through `escapeHtml`. Never compile a string built from user/DB content. Use
  `csvField`/`csvRow` for CSV; sanitize `Content-Disposition` filenames.
- **Queries:** build Prisma `where`/`data`/`orderBy` objects **explicitly** — never
  spread `req.body`/`req.query` into them. Take ownership/tenant fields from the
  authenticated session, not the body. Validate scalars as scalars (Zod / `typeof`)
  and use an allowlist for sort/filter field names.

## 9. Remaining risks & deferred items

1. **Email subject CRLF (defense-in-depth, deferred):** admin/mod reply/compose
   subjects are already CRLF-safe via nodemailer; an extra `subject.replace(/[\r\n]+/g,' ')`
   would be belt-and-suspenders but is not exploitable as written (low value).
2. **Import body size (deferred, DoS-adjacent):** the durable import worker accepts up
   to ~64MB (`jsonLargeImport`). Linear parsers + a one-at-a-time worker bound impact;
   a configurable few-MB `Buffer.byteLength` cap would tighten it (low value here).
3. **Invariant drift:** mass-assignment safety relies on `store.save`'s param-sourced
   `userId` and `coerceQuestionInput`'s allowlist staying in place. The new regression
   tests pin both — keep them green when editing those paths.
4. CSP is defense-in-depth for the HTML/email output (prompt 51), not a substitute for
   the escaping above.
