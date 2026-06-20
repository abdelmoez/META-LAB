# PecanRev

PecanRev is a systematic review and meta-analysis platform with screening, data
extraction, risk of bias, search building, project collaboration, and a complete
review workflow.

## Production domain

PecanRev runs in production at **https://pecanrev.com**.

Local development uses **http://localhost:3000** (frontend) and
**http://localhost:3001** (API). In production, `APP_BASE_URL` and `CORS_ORIGIN`
must be set to the production domain (`https://pecanrev.com`); the domain is
env-driven and is not hardcoded in the application code.
