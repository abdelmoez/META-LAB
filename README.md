# PecanRev

PecanRev is a systematic review and meta-analysis platform with screening, data
extraction, risk of bias, search building, project collaboration, and a complete
review workflow.

## Production domain

PecanRev runs in production at **https://pecanrev.com**.

Local development uses **http://localhost:3000** (frontend) and
**http://localhost:3001** (API). In production, `APP_BASE_URL` and `CORS_ORIGIN`
must be set to the production domain (`https://pecanrev.com`). The runtime base URL
is env-driven, but note that `pecanrev.com` still appears as a hard-coded fallback /
UA string / support address in a few places (`server/routes/publicView.js`,
`server/routes/citation.js`, `server/pecanSearch/connectors/crossref.js`,
`src/features/publicSynthesis/PublicSynthesisPage.jsx`) — self-hosters should grep
for it (86.md P3.24).
