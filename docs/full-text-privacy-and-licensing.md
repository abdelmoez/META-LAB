# Full-Text Privacy & Licensing (68.md P9)

This document states the legal and privacy posture of automated full-text
retrieval. The behavior it describes is enforced in
`server/fullText/providers.js`, `server/fullText/fullTextService.js`, and
`server/controllers/screeningOaController.js`.

## Legal stance

**Only API-provided OA URLs are fetched.** A provider returns a `pdfUrl` **only**
when the OA API itself supplies one:

- Unpaywall `best_oa_location.url_for_pdf`
- Europe PMC `fullTextUrlList.fullTextUrl[]` with `documentStyle: 'pdf'`
- OpenAlex `best_oa_location.pdf_url`
- ClinicalTrials.gov — a registry **landing page only** (`version: 'registry'`,
  no `pdfUrl`)

The code **never constructs, guesses, or pattern-derives** a PDF URL, and never
follows a publisher paywall. This is asserted in the `providers.js` header as a
non-negotiable rule and is structural: the only URLs that reach the downloader are
the ones the OA APIs returned.

**No paywall bypass.** The downloader (`downloadAndAttach`) validates the response
is a genuine PDF by **both** content-type and `%PDF` magic bytes. A publisher
paywall page (which returns `text/html`) or any non-PDF error body is rejected and
**nothing is stored**. There is no attempt to authenticate to, or circumvent, any
publisher access control.

**No institutional scraping.** There is no crawler, no library-proxy integration,
no Sci-Hub-style mirror, and no HTML scraping of publisher sites. Retrieval is
strictly: identifier → OA metadata API → the OA-hosted PDF URL that API published.

**License metadata is stored.** When an OA API reports a `license` (and `version`,
e.g. `publishedVersion`), it is captured on the `FullTextCandidate` row and carried
through so the provenance of each attached PDF (its OA status and license) is
recorded alongside it.

## PDFs are project-scoped

- Retrieved PDFs land in the **existing** `ScreenPdfAttachment` store via the
  shared `savePdf` path — this feature does not invent a parallel store — scoped to
  the `projectId` + `recordId`.
- Access to attachments is governed by the project's existing screening access
  model (`getProjectAccess`); the retrieval endpoints require project membership,
  and triggering retrieval / bulk upload requires `isLeader || canImportRecords`.
- A human-attached PDF is **never overwritten** by automated retrieval: records
  that already have an attachment are skipped without a network call, and the
  legacy OA path (`screeningOaController.oaRetrieve`) explicitly skips records with
  a `manual_upload` attachment.

## What leaves the server (identifiers only)

Outbound requests to OA providers carry **only** the minimum needed to resolve a
document:

- **Identifiers** — a DOI, a PMID, or an NCT id (whichever the provider needs).
- **A polite-pool contact email** — resolved from the env fallback chain
  (`UNPAYWALL_EMAIL` → `PECAN_SEARCH_CONTACT_EMAIL` → `NCBI_EMAIL`) for the
  automated worker. In the legacy interactive path (`oaRetrieve`) the requesting
  **user's account email** is sent as the polite-pool identifier (Unpaywall
  requires an email; the code returns a 400 asking the user to add one if their
  account has none). This email is an API-etiquette identifier, not review content.

**No review data ever leaves the server** — no reviewer identities, decisions,
notes, titles-as-payload, project names, or record content are sent to OA
providers. The requests are bare identifier lookups.

## Feature gating

- Automated retrieval is behind the `fullTextRetrieval` flag (default **OFF**);
  every full-text endpoint 404s when off (no existence leak). There is an
  additional admin master switch `fullTextSettings.enabled` (a `403` when
  disabled) separate from the feature flag.
- The legacy OA path is behind its own `autoPdfRetrieval` flag (default **OFF**),
  inert in production until an admin enables it.
