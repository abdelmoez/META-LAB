# Load Testing (93.md Phase 10)

Dependency-free virtual-user (VU) load-test suite for pre-beta capacity checks.
Driver: `scripts/loadtest/beta-load.mjs` (plain Node, no npm packages).

## How to run

```bash
# 1. Start the target server locally (dev mode — NEVER NODE_ENV=production):
PORT=3001 node server/index.js

# 2. In another terminal, run the suite:
npm run loadtest:beta

# Custom shape / target / server telemetry:
BASE_URL=http://127.0.0.1:3001 VUS=40 DURATION_S=180 RAMP_S=20 \
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='LocalDevAdmin!2026' \
npm run loadtest:beta
```

Output: a per-scenario table on stdout plus machine-readable
`scripts/loadtest/last-run.json`. Exit code is **non-zero when thresholds are
breached**, so the suite can gate CI or a pre-release checklist.

### Why the server must NOT run `NODE_ENV=production`

- The seed phase registers `loadtest-user-<i>@example.test` accounts via
  `/api/auth/register`. Dev-mode auth rate limits (5000/15min) absorb this;
  production limits would 429 the seed immediately (the driver aborts with a
  clear message when that happens).
- Leave SMTP unconfigured (the dev default): registration then logs instead of
  sending mail, so a load test can never spam a mailbox.

## Scenario mix (weighted)

| Scenario | Weight | What it does |
| --- | --- | --- |
| `decision` | 20 | POST a random include/exclude/maybe screening decision |
| `dashboard` | 14 | `GET /api/projects` (dashboard list) |
| `projectOpen` | 14 | Screening project detail + records list |
| `health` | 10 | `GET /api/health` + `/api/health/ready` |
| `extractionAutosave` | 9 | CAS-guarded project autosave with extraction values |
| `manuscriptAutosave` | 9 | CAS-guarded project autosave with `documents[]` |
| `importSmall` | 5 | Synchronous 15-record RIS import (owner VUs only) |
| `dedup` | 5 | Duplicate-detection job submit + status poll (owner VUs only) |
| `exportRun` | 5 | Async export start + job poll (owner VUs only; self-disables on admin/tier gate) |
| `login` | 4 | Re-login (bcrypt cost shows up here — sub-second p95 expected) |
| `aiRun` | 3 | AI-score job submit + status poll (owner VUs only; self-disables when the `aiScreening` flag / tier gate rejects) |
| `projectCreate` | 2 | Create + immediately delete a throwaway screening project |

Seeding is idempotent: VU accounts are login-or-register, each VU pair shares
one screening project found-or-created by title, the seed import uses a stable
tag (a rerun's file-hash `409 duplicate_import` is accepted as the idempotency
guard working), and each VU owns one META·LAB project created through the
autosave create path. Odd VUs join their pair's project with the `reviewer`
preset — which by design cannot import/dedup/export, so those scenarios run on
owner VUs only (matching real beta usage).

**Flag-gated scenarios self-disable**: `aiRun` and `exportRun` probe once; a
402/403 gate response disables the scenario for the rest of the run and prints
a `self-disabled: …` note instead of polluting the error rate.

### Deliberately excluded (never load-test these)

- `/api/pecan-search` run/preview, `/api/citation*`, `/api/citation-mining`,
  and OA PDF retrieval (`oa-retrieve`): they fan out to third-party providers
  (NCBI, OpenAlex, Unpaywall, Crossref…). Load-testing them would hammer
  external infrastructure and violate provider terms. Provider resilience is
  covered instead by outbound-fetch timeouts (15s metadata / 60s download,
  `server/utils/fetchTimeout.js`) and their unit tests.
- Email flows: no scenario triggers outbound mail; keep SMTP unset.

## Configuration (env)

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://127.0.0.1:3001` | Target server root |
| `VUS` | 25 | Concurrent virtual users (suite is sized for 20–50) |
| `DURATION_S` | 120 | Measured load phase length (seed excluded) |
| `RAMP_S` | 10 | VU start stagger window |
| `THINK_MS` | 500 | Mean think time between scenario iterations (±50% jitter) |
| `THRESH_P95_MS` | 2000 | Per-scenario p95 latency gate |
| `THRESH_ERR_RATE` | 0.02 | Overall error-rate gate (2%) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | unset | When BOTH set, polls `GET /api/admin/metrics/runtime` every 10s (dev admin: `admin@example.com`) |

## Thresholds (initial values — revise with real data)

- **p95 ≤ 2000 ms per scenario.** Rationale: an interactive research tool
  should feel responsive; 2s is a deliberately loose starting envelope that
  still catches event-loop blocking and lock contention. Latency samples are
  recorded **per HTTP request** (job polls each count individually), so slow
  background jobs don't fake a latency breach.
- **Overall error rate ≤ 2%.** Expected statuses are whitelisted per scenario
  (autosave CAS 409, duplicate-job-guard 409/429, seed rerun 409) so only real
  failures count.

Tighten both once a few baseline runs exist; the JSON history in
`scripts/loadtest/last-run.json` is the record to compare against.

## What the suite detects

- **Event-loop blocking**: `/api/admin/metrics/runtime` polling reports event-loop
  delay p50/p95/p99/max — a CPU-bound handler (the class of bug 92.md fixed in
  duplicate detection) shows up as a p95 spike even when latencies still pass.
- **Connection/handle exhaustion & freezes**: rising latencies across ALL
  scenarios plus `health` failures indicate the server stopped accepting work.
- **Duplicate heavy jobs**: queue depths (`import`/`export`/`duplicates`/
  `aiScoring`/`fullText`) are captured each poll; a depth that grows without
  draining means the single-active-job / dedupe guards regressed.
- **Memory growth**: heap/RSS maxima across the run surface leaks under load.
- **Auth/permission regressions**: unexpected 4xx immediately raise the error
  rate (each note carries the first offending `method path -> status`).

### Reference smoke result (2026-07-18, VUS=5, DURATION_S=20, dev laptop)

144 requests, 0 errors, 6.8 req/s; worst scenario p95 1087 ms (`exportRun`,
includes job polling); server event-loop p95 max 63.7 ms, heap max 31 MB,
export queue depth peaked at 2 and drained. Exit code 0.

## Known limitations

- **Single-machine driver**: the driver and (usually) the server share one
  machine, so driver CPU competes with the server at high VU counts and network
  latency is ~0 — treat absolute numbers as relative baselines, not production
  capacity figures.
- **Dev-mode rate limits**: the suite depends on them; it cannot exercise the
  production limiter behaviour (that is a config check, not a load property).
- **External providers mocked out by omission**: search/citation/OA scenarios
  are excluded (see above), so provider-side slowness is out of scope here.
- **SQLite dev DB**: production Postgres has different locking/latency
  characteristics; a dev-DB pass does not guarantee identical Postgres
  behaviour (run the same suite against a staging Postgres for that).
- **Seed data accretes**: `importSmall` and decisions add rows on every run;
  wipe `loadtest-user-*` accounts / `Load Test Pair *` projects when the dev DB
  needs a reset.
