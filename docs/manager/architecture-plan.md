# META·LAB — Architecture Plan

**Date:** 2026-06-07
**Phase:** Phase B — Routing, Autosave, Profile, Security
**Status:** Complete

---

## Goal

Convert META·LAB from a single-user, JSON-file-backed app into a real multi-user web application where each user owns their own projects and data.

---

## Stack

| Layer | Technology | Port |
|-------|-----------|------|
| Frontend | React 18 + Vite + react-router-dom v7 | 3000 |
| Backend API | Express 4 + Node 20 + helmet + rate-limit | 3001 |
| Database | SQLite via Prisma | — |
| ORM | Prisma 5.22 | — |
| Auth | JWT in httpOnly cookie | — |
| Passwords | bcryptjs (12 rounds) | — |

## Routes

| Path | Auth | Component |
|------|------|-----------|
| `/` | Public | `Landing.jsx` |
| `/login` | Public (redirect /app if authed) | `Login.jsx` via route adapter |
| `/register` | Public (redirect /app if authed) | `Register.jsx` via route adapter |
| `/app` | Protected | `AppWorkspace.jsx` → `MetaLab` |
| `/profile` | Protected | `Profile.jsx` |
| `/*` | — | Redirect to `/` |

---

## Auth Flow

```
1. User visits app → GET /api/auth/me (credentials: include)
   ├─ 200 { user } → show main app
   └─ 401          → show Login page

2. Login: POST /api/auth/login { email, password }
   └─ 200 → Set-Cookie: metalab_session=<JWT>; HttpOnly; SameSite=Strict

3. All API requests: fetch(url, { credentials: 'include' })
   └─ Cookie sent automatically on same origin

4. Logout: POST /api/auth/logout
   └─ Clears cookie
```

JWT payload: `{ id: user.id, email: user.email }` — signed with `JWT_SECRET`, expires 7 days.

---

## Database Schema

```prisma
model User {
  id        String    @id @default(uuid())
  email     String    @unique
  name      String?
  password  String              // bcrypt hash — NEVER plain text
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  projects  Project[]
}

model Project {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  data      Json     @default("{}")  // pico, search, prisma, grade, studies, records, ...
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

The `Project.data` JSON column stores the entire project payload (pico, search, prismaFlow, grade, studies[], records[], metaResults). This maximises compatibility with the existing controller logic while adding user ownership at the DB layer.

---

## User Ownership Rules

Every project query MUST include `WHERE userId = req.user.id`. No user can read or write another user's projects. The backend enforces this at the store layer — controllers pass `req.user.id` to all store functions.

---

## API Changes

### New auth endpoints
| Method | Path | Auth Required | Description |
|--------|------|--------------|-------------|
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Login, set cookie |
| POST | `/api/auth/logout` | Yes | Clear cookie |
| GET | `/api/auth/me` | Yes | Current user |

### Existing endpoints
All existing project/study/record/meta/validation/import/export endpoints now require auth (401 if no cookie). CORS updated to `credentials: true`.

---

## Security Invariants

1. Passwords stored as bcrypt hash (cost=12) — never plain text, never in logs
2. JWT secret from `process.env.JWT_SECRET` — never hardcoded
3. Cookie: `httpOnly: true, sameSite: 'strict', secure: true` (in production)
4. All project endpoints filter by `userId` — no cross-user data access
5. `.env` never committed — only `.env.example` with placeholder values
6. Prisma parameterises all queries — no SQL injection possible

---

## Local Setup (for developers)

```bash
# 1. Start Postgres
docker compose up -d

# 2. Install server dependencies
npm install --prefix server

# 3. Copy and fill env (never commit .env)
cp .env.example server/.env
# edit JWT_SECRET with a real random value:
#   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 4. Push schema to DB — run from server/ so Prisma finds server/.env
cd server
npx prisma migrate dev --name init
cd ..

# 5. Run the app
npm run dev   # starts both Express (3001) and Vite (3000)
```

---

## Autosave Architecture

The META·LAB monolith uses `window.storage.get/set` for all project persistence. `src/frontend/storage/serverStorage.js` (imported first in `main.jsx`) sets this global to bridge to the REST API:

- **`get("meta:projects")`** — `GET /api/projects` list + `GET /api/projects/:id` for each project
- **`set("meta:projects", json)`** — `PUT /api/projects/:id/autosave` upsert for each; `DELETE` for removed ones

Autosave status (Saving…/Saved/Failed) is communicated via pub-sub and shown by `AppWorkspace.jsx`.

---

## What Is NOT Changing

- The research engine (`/src/research-engine/`) — complete, untouched
- All 14-step workflow UI in `meta-lab-3-patched.jsx`
- The visual design (indigo dark theme, IBM Plex Sans)
- The 349 passing unit tests
- The core API contract for projects/studies/records/meta/validation/import/export

---

## Agent Assignments

| Agent | Work |
|-------|------|
| Backend Agent | Prisma schema, auth routes, update store.js + all controllers |
| Frontend Agent | Login/Register pages, authClient.js, App.jsx auth routing |
| QA Agent | Auth integration tests, updated report.md |
| Main Claude | docker-compose.yml, .env.example, .gitignore, this doc |
