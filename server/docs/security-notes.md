# META·LAB Security Notes

---

## HTTP Security Headers — helmet

The server mounts `helmet` (v8.x) as the first middleware layer, before CORS and all route handlers.

```js
app.use(helmet({ contentSecurityPolicy: false }));
```

`contentSecurityPolicy` is disabled because the API server serves only JSON — no HTML or scripts. The frontend (Vite / React) manages its own CSP.

Helmet sets the following response headers automatically:

| Header                          | Value / Effect |
|---------------------------------|----------------|
| X-DNS-Prefetch-Control          | off |
| X-Frame-Options                 | SAMEORIGIN |
| X-Content-Type-Options          | nosniff |
| Referrer-Policy                 | no-referrer |
| X-Permitted-Cross-Domain-Policies | none |
| Cross-Origin-Opener-Policy      | same-origin |
| Cross-Origin-Resource-Policy    | same-origin |
| Origin-Agent-Cluster            | ?1 |
| Strict-Transport-Security       | max-age=15552000; includeSubDomains (production) |

---

## Rate Limiting — express-rate-limit

Auth endpoints (`/api/auth/*`) are protected by an IP-based rate limiter:

```js
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // max 20 requests per window per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,     // RateLimit-* headers (RFC 6585)
  legacyHeaders: false,      // no X-RateLimit-* headers
});

app.use('/api/auth', authLimiter, authRouter);
```

Only auth routes are rate-limited because they are the attack surface for credential-stuffing and brute-force. Other API routes are protected by JWT authentication.

---

## Authentication

- Sessions use **httpOnly cookies** (`metalab_session`) containing a signed JWT.
- `httpOnly: true` — inaccessible to JavaScript; prevents XSS token theft.
- `sameSite: 'strict'` — blocks CSRF from cross-origin pages.
- `secure: true` in production — cookies sent only over HTTPS.
- JWT is signed with `process.env.JWT_SECRET` (stored in `server/.env`, gitignored).
- Token expiry: 7 days.

---

## Password Security

- All passwords are hashed with **bcrypt** at 12 rounds before storage.
- Plaintext passwords are never logged or returned in API responses.
- Login uses constant-time bcrypt comparison even when the user does not exist (prevents timing-based user enumeration).
- `changePassword` verifies the current password before accepting the new one.

---

## Authorization

- Every protected endpoint calls `requireAuth` middleware before executing.
- `requireAuth` validates the session cookie JWT and attaches `req.user = { id, email }`.
- Every project query is scoped by `req.user.id` at the DB query level — users can never read or write another user's projects regardless of the provided ID.

---

## Error Responses

- **500 errors** always return `{ "error": "Internal server error" }` — stack traces and `err.message` are only written to server logs, never to the HTTP response.
- **4xx errors** return human-readable descriptions that are set intentionally by route handlers (no internal details).
- The global `errorHandler` middleware enforces this split.

---

## Environment & Secrets

- All secrets (`DATABASE_URL`, `JWT_SECRET`, etc.) are stored in `server/.env`.
- `server/.env` is listed in `.gitignore` — it is never committed.
- No secret values appear in source files or committed configuration.

---

## Security Invariants (must not be broken)

1. Passwords are ALWAYS hashed with bcrypt — never stored or logged as plain text.
2. Every protected endpoint MUST call `requireAuth` middleware.
3. Every project DB query MUST scope by `userId` (`req.user.id`).
4. `.env` is gitignored — never write secrets to committed files.
5. No stack traces or internal error messages in HTTP error responses.
6. Auth routes MUST remain behind the rate limiter.
