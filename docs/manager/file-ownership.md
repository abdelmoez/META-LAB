# META·LAB — File Ownership Map (v2 — Multi-User Phase)

Maintained by Main Claude (Manager). Each agent writes ONLY within its assigned directory.
Cross-boundary edits require Manager approval.

---

## Main Claude (Manager / Integrator)

**Owns:**
- `/src/App.jsx` — root React component, auth routing
- `/src/main.jsx` — Vite entry point
- `/package.json` — root workspace package
- `/vite.config.js` — Vite + proxy config
- `/docker-compose.yml` — local Postgres container
- `/.env.example` — secret template (never commit real values)
- `/.gitignore` — ignore rules
- `/index.html` — HTML shell
- `/docs/manager/` — architecture docs (this directory)
- `/meta-lab-3-patched.jsx` — monolith source (preserved as-is)

---

## Backend Agent

**Owns (`/server/` only):**
- `/server/prisma/schema.prisma` — database schema
- `/server/db/client.js` — Prisma client singleton
- `/server/auth/jwt.js` — JWT sign/verify
- `/server/auth/password.js` — bcrypt hash/verify
- `/server/middleware/auth.js` — requireAuth middleware
- `/server/middleware/requestLogger.js` — (existing)
- `/server/middleware/errorHandler.js` — (existing)
- `/server/routes/auth.js` — register/login/logout/me
- `/server/routes/projects.js` — (existing, update for auth)
- `/server/routes/studies.js` — (existing, update for auth)
- `/server/routes/records.js` — (existing, update for auth)
- `/server/routes/meta.js` — (existing, update for auth)
- `/server/routes/validation.js` — (existing, update for auth)
- `/server/routes/importExport.js` — (existing, update for auth)
- `/server/controllers/*.js` — all controllers (update for auth + Prisma)
- `/server/store.js` — rewrite to Prisma-backed async store
- `/server/index.js` — add cookie-parser, auth route, CORS credentials
- `/server/package.json` — add bcryptjs, jsonwebtoken, cookie-parser, @prisma/client

**May read:** `/src/research-engine/` (imports only, do not modify)

---

## Frontend Agent

**Owns (`/src/frontend/` only):**
- `/src/frontend/auth/authClient.js` — auth API functions
- `/src/frontend/pages/Login.jsx` — login page
- `/src/frontend/pages/Register.jsx` — register page
- `/src/frontend/api-client/apiClient.js` — add credentials:include
- All existing frontend components (may read and update)

**May read:** `/server/docs/api-contract.md`, `/meta-lab-3-patched.jsx`

---

## Research Engine Agent

**Owns:** `/src/research-engine/` — **COMPLETE. DO NOT MODIFY.**

---

## QA Agent

**Owns:** `/tests/` (all subdirectories and `tests/report.md`)

**May read:** all other folders (read-only)

---

## Communication Protocol

No agent edits another agent's files. All cross-agent integration goes through Main Claude.
