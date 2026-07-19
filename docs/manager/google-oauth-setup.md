# Google OAuth setup — Google Cloud Console (94.md Part 6)

Exact dashboard steps to create the Google OAuth 2.0 / OpenID Connect client
that backs "Continue with Google". The application code (routes under
`/api/auth/google/*`, callback validation, account linking, session issuance)
ships in this repository; **everything in this document is an EXTERNAL action in
the Google Cloud Console and NONE of it has been performed.** Every checklist box
below is genuinely not done.

The app requests **only** the basic identity scopes `openid email profile`. No
Gmail, Drive, Calendar, or other Google API scopes — which is what keeps the
consent screen out of Google's expensive verification track (see §2).

## 0. What the backend expects (the contract these steps satisfy)

| Env var | Meaning | Example |
|---|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID from §3 | `1234…apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret from §3 (secret — `shared/server.env` only) | `GOCSPX-…` |
| `GOOGLE_REDIRECT_URI` | Explicit callback URL. **If set, it wins.** If unset, the app derives `APP_BASE_URL` + `/api/auth/google/callback` | `https://pecanrev.com/api/auth/google/callback` |
| `GOOGLE_POST_LOGIN_REDIRECT` | Where the app sends the browser after success (optional; app has a sane default) | `/app` |
| `GOOGLE_POST_ERROR_REDIRECT` | Where the app sends the browser on failure, with a safe `?googleError=CODE` (optional) | `/login` |

Test-only overrides (`GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_JWKS_URL`,
`GOOGLE_ISSUER`) point the flow at a mock issuer in the test suite and must be
**unset in every real environment** — they exist so automated tests never touch
real Google. Do not set them in prod/staging/dev env files.

> Production boot fails fast if Google is half-configured (client id without
> secret, or vice-versa). Either set the full trio (`GOOGLE_CLIENT_ID` +
> `GOOGLE_CLIENT_SECRET` + a resolvable redirect) or leave all Google vars unset
> — in which case the frontend hides the button (`/api/settings/public` reports
> `googleAuthEnabled:false`) and a direct hit on `GET /api/auth/google/start`
> returns a 302 to `/login?googleError=GOOGLE_NOT_CONFIGURED` instead of crashing.

## 1. Create or select the Google Cloud project

- [ ] Sign in at <https://console.cloud.google.com/> with an account that should
      own this (prefer a role/shared Google account, not a personal one — the
      project owner controls the OAuth client and secret).
- [ ] Top bar → project picker → **New Project** (or select an existing
      PecanRev project). Name it e.g. `pecanrev-auth`. No billing account is
      required for OAuth login.
- [ ] Note the project name; all steps below happen inside it.

## 2. Configure the OAuth consent screen

APIs & Services → **OAuth consent screen**.

- [ ] **User type: External.** ("Internal" only works for Google Workspace org
      accounts and would block every non-org Google user — wrong for a public
      beta.) External + basic scopes does **not** require Google's app
      verification as long as you request no sensitive/restricted scopes.
- [ ] **App name:** `PecanRev` (this string appears on Google's consent dialog —
      keep it exactly the product name).
- [ ] **User support email:** a monitored role address (e.g.
      `support@pecanrev.com`).
- [ ] **App logo (optional):** uploading a logo triggers Google brand review and
      is not needed for launch — skip it for now.
- [ ] **Authorized domains:** add `pecanrev.com` (covers `pecanrev.com`,
      `www.pecanrev.com`, and `staging.pecanrev.com`). `localhost` is not an
      authorized domain and does not need to be listed — local redirect URIs are
      still allowed in §3.
- [ ] **Developer contact email:** a monitored address (Google uses it for
      policy notices).
- [ ] **Scopes:** add ONLY `openid`, `email` (`.../auth/userinfo.email`),
      `profile` (`.../auth/userinfo.profile`). Do **not** add any Gmail/Drive/
      Calendar/other scope — doing so forces verification and a security review.
- [ ] **Publishing status:** starts in **Testing**. In Testing, only listed test
      users can sign in and refresh tokens expire in 7 days (irrelevant here — we
      store no Google tokens). Add every dev/QA Google address under **Test
      users** (§5) while validating.
- [ ] When ready for real users: **Publish app** → status **In production**.
      Because only `openid/email/profile` are requested, Google shows the
      standard "unverified app" consent the first time but does **not** gate you
      behind the full verification review. (Verification is only mandated by
      sensitive/restricted scopes, which we do not use — §6.)

## 3. Create the OAuth client (Web application)

APIs & Services → **Credentials** → **Create credentials** → **OAuth client ID**.

- [ ] **Application type: Web application.** (This is a server-side redirect
      flow with a confidential client secret — not "Desktop", not the deprecated
      Google Sign-In JavaScript library.)
- [ ] **Name:** `PecanRev Web` (internal label only).
- [ ] **Authorized JavaScript origins: NONE needed.** This is a redirect-based
      Authorization Code flow — the browser is sent to Google and Google redirects
      back to our server callback; no in-page Google JS SDK calls an endpoint
      from our origin, so no JavaScript origin is required. Leave this section
      empty. (Add one only if a future in-page Google Identity Services widget is
      introduced, which this implementation deliberately does not use.)
- [ ] **Authorized redirect URIs** — add **all** environments you will use. These
      must match the callback the server sends byte-for-byte (scheme, host, port,
      path, no trailing slash):

      | Environment | Authorized redirect URI |
      |---|---|
      | Local (Express direct, recommended) | `http://localhost:3001/api/auth/google/callback` |
      | Local (Vite dev server, optional)   | `http://localhost:3000/api/auth/google/callback` |
      | Staging | `https://staging.pecanrev.com/api/auth/google/callback` |
      | Production | `https://pecanrev.com/api/auth/google/callback` |

- [ ] Click **Create**. Google shows the **client ID** and **client secret**
      once — copy the secret now (§7 covers rotation if you lose it).

### Which local redirect URI do I actually use?

Both work; **prefer the Express-direct `:3001` URL** — it is the simplest and
what these docs default to:

- **Express direct (`:3001`, recommended):** run the API with `node
  server/index.js` (or the dev script) and open `http://localhost:3001`. Express
  serves the SPA and the API on the same origin, so the OAuth round-trip never
  crosses a proxy. Set `GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback`
  (or `APP_BASE_URL=http://localhost:3001` and let the app derive it).
- **Vite dev server (`:3000`, optional):** `npm run dev` serves the SPA on
  `:3000` and proxies `/api` → `127.0.0.1:3001` (see `vite.config.js`). The
  browser origin is `:3000` but the OAuth callback still lands on the backend via
  the proxy. This works because **cookies on `localhost` are keyed by host only,
  not port** — the short-lived OAuth transaction cookie (`metalab_gauth_txn`) set
  during `/start` is therefore readable at the callback regardless of which port
  served it. If you use this mode, set
  `GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback` and add
  that URI in Google too.

Register whichever local URIs you use; unused ones can stay listed harmlessly.

## 4. Map the values to environment variables

Put the two secrets into the server env file (never the frontend, never a
committed file):

```env
# shared/server.env (chmod 600) — NEVER commit real values
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
# Explicit redirect wins; otherwise the app derives APP_BASE_URL + /api/auth/google/callback
GOOGLE_REDIRECT_URI=https://pecanrev.com/api/auth/google/callback
GOOGLE_POST_LOGIN_REDIRECT=/app
GOOGLE_POST_ERROR_REDIRECT=/login
```

`.env.example` / `server/.env.example` carry these keys as documented, empty
placeholders (the backend agent owns those files). Each environment uses its own
redirect URI from the §3 table. The client ID/secret pair can be reused across
environments, OR you can create a **separate OAuth client per environment** if
you want staging and production isolated (recommended for production hardening —
a leaked staging secret then cannot touch production). If you create separate
clients, each environment's env file carries its own `GOOGLE_CLIENT_ID`/
`GOOGLE_CLIENT_SECRET`.

## 5. Add test users (while the consent screen is in Testing)

- [ ] OAuth consent screen → **Test users** → **Add users** → every developer/QA
      Google email that must sign in before the app is published.
- [ ] A Google account that is **not** a test user gets `Error 403: access_denied`
      from Google (before ever reaching our callback) while in Testing — that is
      expected, not an app bug.

## 6. Verification — only if scopes require it (they do not)

- [ ] **No action needed.** Google's app-verification review is triggered by
      **sensitive or restricted scopes**. This app requests only
      `openid email profile` (none sensitive/restricted), so no verification
      submission, no security assessment, and no annual re-verification apply.
      If anyone ever adds a broader Google API scope, verification becomes
      mandatory — do not add scopes casually.

## 7. Rotate the client secret

Do this on a schedule and immediately on any suspected exposure:

- [ ] Credentials → open the **PecanRev Web** client → **Add secret** (Google now
      supports multiple concurrent secrets). Deploy the new secret to
      `shared/server.env`, reload the app, verify a Google login works, then
      **delete the old secret**. This rotates with zero downtime.
- [ ] If your console version only supports one secret: generate a new client
      secret, update the env, reload, confirm login — accept the brief window
      where the old secret is invalidated. Do this in a maintenance moment.
- [ ] Record the rotation in `secret-rotation.md`.

## 8. Revoke compromised credentials

- [ ] Suspected client-secret leak: **delete** the affected secret in Credentials
      immediately (this invalidates it for token exchange), then rotate in a fresh
      one per §7. A deleted secret can no longer complete the server-side token
      exchange, so a leaked secret alone cannot mint sessions.
- [ ] If the whole client is compromised, delete the OAuth client and create a
      new one (new client ID + secret + redirect URIs) — users are unaffected
      because we store no Google tokens; they simply re-consent on next Google
      login.
- [ ] Rotate anything that shared the blast radius, and file an entry per
      `incident-response.md`.

## 9. Verification checklist (prove it works, per environment)

Run after the env vars are in place and the app is (re)started. No secrets appear
in any of these outputs.

- [ ] **Start returns a Google redirect (configured case):**
      ```bash
      curl -sSi "https://<host>/api/auth/google/start" | grep -i '^location:'
      # → 302 Location: https://accounts.google.com/o/oauth2/v2/auth?...client_id=...&scope=openid...
      ```
      If Google is intentionally not configured yet, the same call returns
      `Location: /login?googleError=GOOGLE_NOT_CONFIGURED` — also a PASS for
      "the route is wired", just not "Google is live".
- [ ] **Redirect URI matches exactly.** In the `Location` URL above, confirm the
      `redirect_uri=` param URL-decodes to the exact string registered in §3 for
      this environment. A mismatch yields Google `Error 400: redirect_uri_mismatch`
      after login — fix by aligning `GOOGLE_REDIRECT_URI` and the Google console
      entry.
- [ ] **Full round-trip in a browser:** open `https://<host>/login` → click
      **Continue with Google** → complete Google → you land signed in on
      `GOOGLE_POST_LOGIN_REDIRECT` with a `metalab_session` cookie set
      (`HttpOnly`, `Secure` in staging/prod). Verify the same user's normal
      email/password login still works.
- [ ] **Scopes are minimal:** the Google consent dialog lists only "name, email,
      and profile" — nothing about Gmail/Drive/Calendar. If it lists more, a
      broader scope crept into the consent screen (§2) — remove it.
- [ ] **Denied/invalid paths show friendly errors** (no raw OAuth text/tokens):
      cancel at Google → you return to `GOOGLE_POST_ERROR_REDIRECT` with a
      generic message; a Testing-mode non-test-user sees `access_denied` handled
      gracefully.
- [ ] **Staging uses its own callback** (`staging.pecanrev.com/...`) and never
      the production URI — see `staging-deployment.md`.

## 10. External-actions summary (all NOT DONE)

| Action | Where | Status |
|---|---|---|
| Create/select Google Cloud project | Cloud Console | NOT DONE |
| Configure OAuth consent screen (External, `openid email profile`) | Cloud Console | NOT DONE |
| Create Web-application OAuth client | Cloud Console | NOT DONE |
| Add local/staging/production redirect URIs | Cloud Console | NOT DONE |
| Add test users (while in Testing) | Cloud Console | NOT DONE |
| Publish consent screen (Testing → In production) | Cloud Console | NOT DONE |
| Copy client ID/secret into each env file | Ops / server env | NOT DONE |
| Establish secret-rotation cadence | Ops | NOT DONE |

## Related

- Cloudflare adoption and the proxy/real-IP interaction: `cloudflare-setup.md`.
- Staging separation (own callback URL + Turnstile keys): `staging-deployment.md`.
- Cookie/session behaviour incl. the OAuth transaction cookie:
  `deployment-config.md`.
- Launch ledger of external actions: `launch-checklist.md`.
