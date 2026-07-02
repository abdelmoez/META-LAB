# Admin Settings Reference (Ops Console)

Admin-only (`requireAdmin`; mods never see these). All settings live in `SiteSetting` rows and merge
defaults under the stored value, so new keys take effect without migrations.

## Flags (Ops → Flags)

Master feature flags (`featureFlags` SiteSetting). 66.md additions:

- `extractionAssist` — structured extraction + dual extraction + AI assist (P5). Default OFF.
- `livingReview` — living reviews (P6). Default OFF; automated re-runs also need `pecanSearch`
  (which needs `searchEngine`) — the Flags UI shows the dependency warning.

## AI Screening (Ops → Screening → AI Policy)

`aiScreeningSettings`: enabled, killSwitch, embeddingProvider (lexical | hashing | hosted),
maxRecordsPerRun, allowReviewersToRun, thresholds, liveUpdateEnabled, retrainDebounceMs,
engineConfigVersion. Hosted embeddings are configured via env (`AI_EMBEDDING_ENDPOINT/_API_KEY/_MODEL`);
citation enrichment uses OpenAlex with the polite-pool mailto from `PECAN_SEARCH_CONTACT_EMAIL`.

## Extraction AI (Ops → Extraction AI)

`extractionAiSettings`:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | true | master switch within the `extractionAssist` flag |
| `provider` | `heuristic` | `heuristic` (self-hosted, deterministic) or `external` (env-configured LLM: `EXTRACTION_LLM_ENDPOINT/_API_KEY/_MODEL`) |
| `requireHumanValidation` | true (locked) | AI suggestions can never auto-commit — not configurable |
| `dualExtractionDefault` | false | new studies expect two independent extractors |
| `tableParsingEnabled` | true | CSV/TSV/HTML table parsing in the workspace |

## Living Reviews (Ops → Living Reviews)

`livingReviewSettings`:

| Key | Default | Meaning |
| --- | --- | --- |
| `schedulerEnabled` | true | master switch within the `livingReview` flag (env kill: `LIVING_SCHEDULER_ENABLED=0`) |
| `allowedCadences` | manual, daily, weekly, monthly | cadences projects may pick |
| `maxSavedSearchesPerProject` | 5 | per-project saved-search quota |
| `snapshotRetention` | 100 | snapshots kept per project (oldest pruned) |
| `evidenceShift.relEffectChange` | 0.25 | relative pooled-effect change → notable shift |
| `evidenceShift.i2Change` | 20 | I² point change → info shift |
| `evidenceShift.minK` | 2 | minimum studies per outcome for direction checks |

## Where things are enforced

Frontend Ops sections are UX only — the server re-reads the SiteSetting rows per request
(`server/extraction/access.js`, `server/living/livingService.js`, `server/services/screeningAiService.js`)
and every mutating admin endpoint is audited via `logAdminAction`
(`UPDATE_EXTRACTION_AI`, `UPDATE_LIVING_REVIEW`, `UPDATE_AI_SCREENING`).
