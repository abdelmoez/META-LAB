# META·LAB — Multi-User Build Summary

**Date:** 2026-06-07
**Version:** 2.1.0
**Build status:** ✅ Code complete — needs Docker + DB migration to run

---

## What was built in this phase

Full-stack multi-user authentication and database persistence added to META·LAB.

| Layer | Technology | Port |
|-------|-----------|------|
| Frontend | React 18 + Vite | 3000 |
| Backend API | Express 4 + Node 20 | 3001 |
| Database | PostgreSQL 16 (Docker) | 5432 |
| ORM | Prisma 5.22 | — |
| Auth | JWT in httpOnly cookie | — |
| Passwords | bcryptjs (cost 12) | — |

---

## What changed

### Added by Backend Agent (`/server/`)

| File | Description |
|------|-------------|
| `prisma/schema.prisma` | PostgreSQL schema: User + Project with fat-blob data column |
| `db/client.js` | Prisma singleton (globalThis pattern) |
| `auth/jwt.js` | `signToken` / `verifyToken`, 7-day expiry, secret from env |
| `auth/password.js` | `hashPassword` / `verifyPassword`, bcrypt cost 12 |
| `middleware/auth.js` | `requireAuth` — reads httpOnly cookie, verifies JWT, sets `req.user` |
| `controllers/authController.js` | register, login, logout, getMe (constant-time auth) |
| `routes/auth.js` | POST /register, POST /login, POST /logout, GET /me |
| `store.js` (rewritten) | Async Prisma-backed store; user ownership on every query |
| `controllers/projectsController.js` (rewritten) | Async, user-scoped |
| `controllers/studiesController.js` (rewritten) | Async, user-scoped |
| `controllers/recordsController.js` (rewritten) | Async, user-scoped |
| `controllers/importExportController.js` (rewritten) | Async, user-scoped |
| `routes/*.js` (all 6) | `router.use(requireAuth)` added to all existing routes |
| `index.js` (updated) | cookie-parser, auth route, CORS credentials:true |
| `package.json` (updated) | Added bcryptjs, jsonwebtoken, cookie-parser, @prisma/client, prisma |
| `.env` | Local dev secrets (gitignored) |

### Added by Frontend Agent (`/src/`)

| File | Description |
|------|-------------|
| `frontend/auth/authClient.js` | register, login, logout, getMe (returns null on 401) |
| `frontend/pages/Login.jsx` | Full-page login form — dark indigo design |
| `frontend/pages/Register.jsx` | Full-page register form — same design |
| `frontend/api-client/apiClient.js` (updated) | `credentials:'include'` on all fetches; `api.auth` group added |
| `App.jsx` (rewritten) | Auth state machine: loading → login/register → main app |

### Added by Main Claude (`/`)

| File | Description |
|------|-------------|
| `docker-compose.yml` | PostgreSQL 16-alpine on port 5432 |
| `.env.example` | Secret template — placeholder values only |
| `.gitignore` | node_modules, .env, dist, server/data covered |
| `docs/manager/file-ownership.md` | Updated for multi-user phase |
| `docs/manager/architecture-plan.md` | Auth flow, schema, security invariants |

---

## New API endpoints

| Method | Path | Auth Required | Description |
|--------|------|:---:|-------------|
| POST | `/api/auth/register` | No | Create account, set session cookie |
| POST | `/api/auth/login` | No | Authenticate, set session cookie |
| POST | `/api/auth/logout` | Yes | Clear session cookie |
| GET | `/api/auth/me` | Yes | Return current user |
| All existing 20 endpoints | Yes | 401 returned if no valid cookie |

---

## Security invariants implemented

1. **Passwords**: bcrypt hash (cost 12) — never stored plain-text, never returned in responses
2. **JWT secret**: `process.env.JWT_SECRET` — never hardcoded
3. **Session cookie**: `httpOnly: true, sameSite: 'strict'`, `secure: true` in production
4. **User ownership**: every project query filters by `userId = req.user.id` at DB level
5. **Timing attack mitigation**: login always runs bcrypt even for nonexistent emails
6. **No raw SQL**: Prisma parameterises all queries
7. **No committed secrets**: `.env` in `.gitignore`; only `.env.example` committed

---

## How to run (first time)

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. (Optional) Replace JWT_SECRET in server/.env with a real value:
#   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 3. Run DB migration (creates tables)
cd server
npx prisma migrate dev --name init   # run from server/ so Prisma finds server/.env
cd ..

# 4. Start the app
npm run dev     # → frontend: http://localhost:3000
                # → API:      http://localhost:3001
```

After the first time, only `docker compose up -d` + `npm run dev` are needed.

---

## How to run (subsequent times)

```bash
docker compose up -d
npm run dev
```

---

## Test results

```
Unit tests:   337 passed (unchanged — no regression)
Integration:  31 auth tests added (requires running server + DB)
```

---

## Known limitations

1. **The main app (meta-lab-3-patched.jsx) still reads from localStorage** — the 14-step workflow UI writes its working state to localStorage. The server API stores the persistent project record. A future sprint would wire each workflow tab to call `api.projects.update()` after every state change, replacing localStorage with server-backed persistence.
2. **Single-tenant JWT** — no refresh tokens. Sessions expire after 7 days and the user must log in again.
3. **No email verification** — accounts are created with just email + password; no confirmation flow.
4. **Large bundle** — the 467KB monolith compiles to ~523 KB JS. Code-splitting deferred to a future sprint.
