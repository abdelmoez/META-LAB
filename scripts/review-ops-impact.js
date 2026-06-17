#!/usr/bin/env node
/**
 * review-ops-impact.js (prompt31 Part 3) — flags whether changed files likely
 * need Ops/Admin console support (a setting, metric, table, filter, or moderation
 * surface). A developer prompt, not a gate.
 *
 *   node scripts/review-ops-impact.js          # diff vs origin/main (fallback HEAD~1)
 *   node scripts/review-ops-impact.js --base HEAD~3
 *   node scripts/review-ops-impact.js a.js b.js
 *
 * Writes docs/ops-impact-report.md.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const AREAS = [
  { id: 'new user fields', re: /schema\.prisma/i, where: 'Ops › Users (directory columns / filters)', suggest: 'Surface the new User column in the user detail panel + add a filter if useful.' },
  { id: 'profile/onboarding fields', re: /onboard|profile|institution/i, where: 'Ops › Users / Analytics', suggest: 'Show onboarding completion + institution distribution.' },
  { id: 'settings / feature flags', re: /siteSetting|featureFlag|settingsController|FLAG_META/i, where: 'Ops › Settings / Feature Flags', suggest: 'Expose the flag/setting toggle in the Ops settings panel.' },
  { id: 'email verification/settings', re: /email|verif|smtp/i, where: 'Ops › Settings (email)', suggest: 'Show email/verification status + counts.' },
  { id: 'project permissions', re: /permission|preset|canAssess|role/i, where: 'Project settings (members) + Ops awareness', suggest: 'Add/show the permission in the member permission editor.' },
  { id: 'analytics', re: /analytic|usage|metrics|growth/i, where: 'Ops › Overview / Analytics', suggest: 'Add the metric to the analytics window/cards.' },
  { id: 'country/IP detection', re: /\bgeo\b|country|trust proxy|ipCountry/i, where: 'Ops › Users / country map', suggest: 'Verify country distribution + the registration country column.' },
  { id: 'institution matching', re: /institution/i, where: 'Ops › Users / institutions', suggest: 'Surface institution match key + management UI.' },
  { id: 'chat moderation', re: /chat|message/i, where: 'Ops (moderation) — if applicable', suggest: 'Consider a moderation/visibility surface; respect privacy.' },
  { id: 'PDF retrieval status', re: /pdf|oaController|attachment|resolver/i, where: 'Ops (retrieval health) — optional', suggest: 'Optionally show OA retrieval health/usage.' },
  { id: 'RoB permissions/settings', re: /\brob\b|riskOfBias|canAssessRiskOfBias/i, where: 'Project settings (members)', suggest: 'Expose the RoB assessment permission per member.' },
  { id: 'export/report settings', re: /export|report/i, where: 'Ops (usage) — optional', suggest: 'Optionally track export usage.' },
  { id: 'audit logs', re: /audit|auditLog/i, where: 'Ops › Audit', suggest: 'Ensure new audited actions appear in the audit views.' },
  { id: 'new database models', re: /^server\/prisma\/schema\.prisma$|model\s+\w+/i, where: 'Ops (data visibility)', suggest: 'Decide if admins should see/manage rows of the new model.' },
];

function changedFiles() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (args.length) return args;
  const baseIdx = process.argv.indexOf('--base');
  const base = baseIdx >= 0 ? process.argv[baseIdx + 1] : null;
  const candidates = base ? [base] : ['origin/main', 'main', 'HEAD~1'];
  for (const b of candidates) {
    try {
      const out = execSync(`git diff --name-only ${b}...HEAD`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const staged = execSync('git diff --name-only --cached', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const unstaged = execSync('git diff --name-only', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const files = [...new Set((out + staged + unstaged).split('\n').map(s => s.trim()).filter(Boolean))];
      if (files.length) return files;
    } catch { /* next */ }
  }
  return [];
}

function main() {
  const files = changedFiles().filter(f => !f.startsWith('docs/ops-impact'));
  const hits = new Map();
  for (const f of files) for (const a of AREAS) if (a.re.test(f)) (hits.get(a.id) || hits.set(a.id, new Set()).get(a.id)).add(f);
  const affected = AREAS.filter(a => hits.has(a.id));

  const lines = ['# Ops impact report (developer prompt)', '', `Changed files inspected: **${files.length}**`, ''];
  if (!affected.length) {
    lines.push('## ✅ Ops update likely NOT needed', '', 'No changed files matched admin-relevant areas.');
  } else {
    lines.push('## ⚠️ Ops update RECOMMENDED', '', '| Area | Changed files | Where in Ops/Settings | Suggestion |', '| --- | --- | --- | --- |');
    for (const a of affected) {
      lines.push(`| ${a.id} | ${[...hits.get(a.id)].slice(0, 5).join('<br>')} | ${a.where} | ${a.suggest} |`);
    }
    lines.push('', 'Keep Ops clean: prefer one clear setting/metric over a cluttered dashboard, respect admin/mod boundaries, never expose secrets.');
  }
  lines.push('', '_Generated by `npm run review:ops-impact`._');
  writeFileSync(resolve(ROOT, 'docs/ops-impact-report.md'), lines.join('\n') + '\n');

  console.log(affected.length
    ? `⚠️  Ops review recommended — ${affected.length} area(s): ${affected.map(a => a.id).join(', ')}`
    : '✅ Ops update likely not needed.');
  console.log(`   Report: docs/ops-impact-report.md (${files.length} changed files inspected)`);
  if (process.argv.includes('--strict') && affected.length) process.exit(2);
}

main();
