#!/usr/bin/env node
/**
 * engine-version.mjs — internal per-engine version tooling (54.md Part 5).
 *
 *   node scripts/engine-version.mjs check            # dry-run: detect + classify, NO writes
 *   node scripts/engine-version.mjs bump             # apply detected/declared bumps to the DB
 *   node scripts/engine-version.mjs bump --engine screening --type minor --summary "…"   # manual override
 *
 * Decision hierarchy (highest precedence first):
 *   1. Manual override flags (--engine/--type/--summary)         — one explicit change
 *   2. Explicit manifest file  engine-changes.json              — { engineChanges: [...] }
 *   3. Structured commit footers (Engine:/Engine-Change:/Engine-Summary:)
 *   4. Rule-based inference from changed files (defaults to MINOR + warning)
 * An explicit declaration (1–3) always beats rule-based inference (4). When the
 * engine is known but major-vs-minor is uncertain, we default to MINOR and warn.
 * When a changed file maps to no engine and isn't shared-infra/no-bump, we report
 * the ambiguity (and FAIL in --strict CI mode rather than guess).
 *
 * Idempotency: a (commit SHA, engineId) pair is applied at most once (the DB's
 * ProcessedEngineChange unique constraint), so CI retries / reruns / multiple
 * instances never double-increment. `check` writes NOTHING.
 *
 * The core classification is pure + unit-tested (src/research-engine/engine-registry);
 * this script only adds git I/O + DB application. The DB is imported LAZILY so
 * `check` works even where the DB isn't reachable.
 */
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

import {
  classifyChanges, parseManifest, parseCommitFooters, validateDeclarations,
  formatVersion, bumpVersion, isEngineId, isValidChangeType, ENGINE_BY_ID,
} from '../src/research-engine/engine-registry/index.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ── tiny arg parser ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'check';
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') opts.strict = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--engine') opts.engine = argv[++i];
    else if (a === '--type') opts.type = argv[++i];
    else if (a === '--summary') opts.summary = argv[++i];
    else if (a === '--range') opts.range = argv[++i];
    else if (a === '--change-key') opts.changeKey = argv[++i];
    else if (a.startsWith('--engine=')) opts.engine = a.slice(9);
    else if (a.startsWith('--type=')) opts.type = a.slice(7);
    else if (a.startsWith('--summary=')) opts.summary = a.slice(10);
    else if (a.startsWith('--range=')) opts.range = a.slice(8);
  }
  return { cmd, opts };
}

// ── git helpers (graceful: empty/null when git is unavailable) ───────────────────
function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return ''; }
}
function gitOrNull(args) { const v = git(args); return v || null; }

function changedFiles(range) {
  if (range) {
    return git(`diff --name-only ${range}`).split('\n').map((s) => s.trim()).filter(Boolean);
  }
  // Local default: working-tree + staged + untracked changes vs HEAD.
  // IMPORTANT: read porcelain WITHOUT trimming the whole output — trimming would
  // strip the leading status space of the FIRST line and misalign slice(3) for it.
  let porcelain = '';
  try {
    porcelain = execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch { porcelain = ''; }
  const lines = porcelain.split('\n').filter((l) => l.length > 0);
  if (lines.length) {
    return lines
      .map((l) => l.slice(3))                   // porcelain v1: 2 status chars + 1 space, then path
      .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1] : p)) // renames
      .map((p) => p.replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  }
  // Clean tree (e.g. CI on a committed merge): diff the last commit.
  const parent = gitOrNull('rev-parse --verify HEAD~1');
  if (parent) return git('diff --name-only HEAD~1..HEAD').split('\n').map((s) => s.trim()).filter(Boolean);
  return [];
}

function commitMessages(range) {
  if (range) return git(`log --format=%B ${range}`);
  return git('log -1 --format=%B') || '';
}

function gitMeta(range) {
  const head = range ? gitOrNull(`rev-parse ${range.split(/\.\.+/).pop()}`) : gitOrNull('rev-parse HEAD');
  const shortSha = head ? head.slice(0, 12) : null;
  const branch = gitOrNull('rev-parse --abbrev-ref HEAD');
  return { commitSha: shortSha, branch: branch && branch !== 'HEAD' ? branch : null };
}

// ── gather explicit declarations (manifest + commit footers) ─────────────────────
function gatherDeclarations(range) {
  const errors = [];
  const decls = [];

  const manifestPath = path.join(ROOT, 'engine-changes.json');
  if (existsSync(manifestPath)) {
    const parsed = parseManifest(readFileSync(manifestPath, 'utf8'));
    if (!parsed.ok) errors.push(...parsed.errors.map((e) => `engine-changes.json: ${e}`));
    decls.push(...parsed.declarations);
  }

  const footers = parseCommitFooters(commitMessages(range));
  if (footers.length) {
    const v = validateDeclarations(footers);
    if (!v.ok) errors.push(...v.errors.map((e) => `commit footer: ${e}`));
    decls.push(...v.declarations);
  }

  // De-dup explicit declarations by engine (last wins) — but flag conflicting types.
  const byEngine = new Map();
  for (const d of decls) {
    const prev = byEngine.get(d.engineId);
    if (prev && prev.type !== d.type) {
      errors.push(`conflicting declarations for ${d.engineId}: ${prev.type} vs ${d.type}`);
    }
    byEngine.set(d.engineId, d);
  }
  return { declarations: [...byEngine.values()], errors };
}

// ── lazy DB (only when applying, or to show current versions in check) ───────────
async function loadDb() {
  try {
    const require = (await import('module')).createRequire(import.meta.url);
    const dotenv = require('dotenv');
    dotenv.config({ path: path.join(ROOT, 'server', '.env') });
  } catch { /* dotenv optional */ }
  return import('../server/engineVersion/engineVersionService.js');
}

async function currentVersions() {
  try {
    const svc = await loadDb();
    const list = await svc.listEngines();
    const map = {};
    for (const e of list) map[e.id] = { major: e.major, minor: e.minor, version: e.version };
    return map;
  } catch {
    return null; // DB not reachable → check still works, just can't show current
  }
}

// ── commands ─────────────────────────────────────────────────────────────────
function manualDeclaration(opts) {
  if (!opts.engine && !opts.type && !opts.summary) return null;
  const errors = [];
  if (!isEngineId(opts.engine)) errors.push(`--engine: unknown engine id "${opts.engine}"`);
  if (!isValidChangeType(opts.type)) errors.push(`--type: must be minor|major (got "${opts.type}")`);
  if (!opts.summary || !String(opts.summary).trim()) errors.push('--summary: a meaningful summary is required');
  return { errors, declaration: errors.length ? null : { engineId: opts.engine, type: opts.type, summary: String(opts.summary).trim() } };
}

function buildPlan(opts) {
  const range = opts.range || null;
  const files = changedFiles(range);
  const { commitSha, branch } = gitMeta(range);

  const manual = manualDeclaration(opts);
  if (manual) {
    return {
      mode: 'manual', files, commitSha, branch,
      result: manual.declaration
        ? classifyChanges({ paths: files, declarations: [manual.declaration] })
        : { source: 'manual', changes: [], warnings: [], buckets: { byEngine: {}, shared: [], noBump: [], unowned: [] } },
      errors: manual.errors,
    };
  }

  const { declarations, errors } = gatherDeclarations(range);
  const result = classifyChanges({ paths: files, declarations });
  return { mode: declarations.length ? 'explicit' : 'rule', files, commitSha, branch, result, errors };
}

function printPlan(plan, current) {
  const { result, files, commitSha, branch, errors, mode } = plan;
  console.log(`\nEngine version ${mode === 'manual' ? 'MANUAL OVERRIDE' : 'check'} — source: ${result.source}`);
  if (commitSha) console.log(`Commit: ${commitSha}${branch ? ` (${branch})` : ''}`);
  console.log(`Changed files: ${files.length}`);
  if (files.length) for (const f of files.slice(0, 40)) console.log(`  • ${f}`);
  if (files.length > 40) console.log(`  … +${files.length - 40} more`);

  if (result.buckets) {
    if (result.buckets.noBump.length) console.log(`No-bump (docs/tests/waitlist/landing/config): ${result.buckets.noBump.length}`);
    if (result.buckets.shared.length) console.log(`Shared infra (no single engine): ${result.buckets.shared.length}`);
  }

  console.log('\nProposed engine changes:');
  if (!result.changes.length) console.log('  (none — no engine-affecting changes detected)');
  for (const c of result.changes) {
    const cur = current && current[c.engineId];
    const from = cur ? cur.version : '(db unavailable)';
    const to = cur ? formatVersion(bumpVersion({ major: cur.major, minor: cur.minor }, c.type)) : `${c.type} bump`;
    console.log(`  • ${c.engineId}: ${from} → ${to}  [${c.type}, ${c.source}]`);
    console.log(`      summary: ${c.summary}`);
    console.log(`      reason:  ${c.reason}`);
  }

  if (result.warnings && result.warnings.length) {
    console.log('\nWarnings:');
    for (const w of result.warnings) console.log(`  ⚠ ${w}`);
  }
  if (errors && errors.length) {
    console.log('\nDeclaration errors:');
    for (const e of errors) console.log(`  ✖ ${e}`);
  }
}

async function cmdCheck(opts) {
  const plan = buildPlan(opts);
  const current = await currentVersions();
  if (opts.json) {
    console.log(JSON.stringify({ ...plan, current }, null, 2));
  } else {
    printPlan(plan, current);
  }
  // A manual override is authoritative (decision-hierarchy rank 1); incidental
  // unowned working-tree files must NOT block it, even under --strict.
  const ambiguous = plan.mode !== 'manual' && plan.result.buckets && plan.result.buckets.unowned.length > 0;
  const hasErrors = plan.errors && plan.errors.length > 0;
  if (opts.strict && (hasErrors || ambiguous)) {
    console.error('\nstrict mode: invalid declarations or ambiguous ownership — failing.');
    process.exit(1);
  }
  console.log('\n(dry-run — nothing was written)');
}

async function cmdBump(opts) {
  const plan = buildPlan(opts);
  if (plan.errors && plan.errors.length) {
    console.error('Refusing to apply — declaration errors:');
    for (const e of plan.errors) console.error(`  ✖ ${e}`);
    process.exit(1);
  }
  const ambiguous = plan.mode !== 'manual' && plan.result.buckets && plan.result.buckets.unowned.length > 0;
  if (opts.strict && ambiguous) {
    console.error('strict mode: ambiguous ownership — failing instead of guessing.');
    for (const w of plan.result.warnings) console.error(`  ⚠ ${w}`);
    process.exit(1);
  }
  if (!plan.result.changes.length) {
    console.log('No engine-affecting changes — nothing to bump.');
    return;
  }

  const svc = await loadDb();
  // Manual overrides get a unique change key so the operator can always apply;
  // automatic bumps key on the commit SHA so reruns are idempotent.
  const baseKey = plan.mode === 'manual'
    ? (opts.changeKey || `manual-${Date.now()}`)
    : (opts.changeKey || plan.commitSha || `nocommit-${Date.now()}`);

  const results = [];
  for (const c of plan.result.changes) {
    const res = await svc.applyBump({
      engineId: c.engineId,
      type: c.type,
      summary: c.summary,
      // The service's idempotency key is (changeKey, engineId) — so the SAME
      // baseKey across engines still records each engine exactly once per change.
      changeKey: baseKey,
      classificationReason: c.reason,
      commitSha: plan.commitSha,
      branch: plan.branch,
      actor: plan.mode === 'manual' ? 'cli:manual' : 'cli',
      automatic: plan.mode !== 'manual',
    });
    results.push(res);
    if (res.ok && res.skipped) console.log(`  = ${c.engineId}: already applied for this change (skipped)`);
    else if (res.ok) console.log(`  ✓ ${c.engineId}: ${res.from} → ${res.to} [${c.type}]`);
    else console.log(`  ✖ ${c.engineId}: ${res.error}`);
  }
  try { const { prisma } = await import('../server/db/client.js'); await prisma.$disconnect(); } catch { /* ignore */ }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.error(`\n${failed.length} bump(s) failed.`); process.exit(1); }
  console.log('\nDone.');
}

const { cmd, opts } = parseArgs(process.argv.slice(2));
const run = cmd === 'bump' ? cmdBump : cmdCheck;
run(opts).catch((err) => { console.error('engine-version error:', err?.message || err); process.exit(1); });
