#!/usr/bin/env node
/**
 * rebrand-pecanrev.js — PecanRev rebrand data migration for EXISTING databases.
 *
 * Fresh installs already DEFAULT to PecanRev (the DEFAULTS in
 * settingsController.js / init-settings.js and the onboarding defaults were all
 * updated as part of the rebrand). But a database that was seeded BEFORE the
 * rebrand still has the old brand text baked into its persisted SiteSetting and
 * OnboardingQuestion rows (those rows are written once and never overwritten by
 * the defaults). This one-off script rewrites that stored brand copy in place:
 *
 *   - SiteSetting 'appSettings'        → appName, maintenanceMessage
 *   - SiteSetting 'landingContent'     → aboutText + every other landing string
 *   - SiteSetting 'onboardingSettings' → introTitle, introBody
 *   - OnboardingQuestion 'main_use_case' (seeded) → prompt
 *
 * Replacements (applied to display copy only — never identifiers):
 *   "META·LAB"  → "PecanRev"
 *   "META·SIFT" → "Screening"
 *
 * SAFE + IDEMPOTENT:
 *   - Only touches rows that already exist (never creates anything).
 *   - A no-op (and reported as "unchanged") when the stored text already says
 *     PecanRev/Screening — safe to run any number of times.
 *   - Logs exactly which rows/fields it changed.
 *
 * Run from the project root:
 *   node server/scripts/rebrand-pecanrev.js
 */
import '../load-env.js'; // populate DATABASE_URL from server/.env before Prisma loads
import { prisma } from '../db/client.js';

// Display-copy replacements only. The middle-dot ("·") never appears in code
// identifiers, so a "·" occurrence is always safe-to-rewrite display text.
const REPLACEMENTS = [
  ['META·LAB', 'PecanRev'],
  ['META·SIFT', 'Screening'],
];

/** Apply every brand replacement to a single string. Returns the rewritten value. */
function rebrandString(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [from, to] of REPLACEMENTS) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

/**
 * Rewrite a JSON-stringified SiteSetting row in place. Parses the stored value,
 * rebrands every string field listed in `fields` (or ALL string fields when
 * `fields` is null), and writes it back only when something actually changed.
 */
async function rebrandJsonSetting(key, fields = null) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  if (!row) {
    console.log(`  SiteSetting '${key}': not present — skipped`);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(row.value || '{}');
  } catch {
    console.log(`  SiteSetting '${key}': value is not valid JSON — skipped`);
    return;
  }

  const changedKeys = [];
  const targetKeys = fields || Object.keys(parsed);
  for (const f of targetKeys) {
    if (typeof parsed[f] !== 'string') continue;
    const next = rebrandString(parsed[f]);
    if (next !== parsed[f]) {
      parsed[f] = next;
      changedKeys.push(f);
    }
  }

  if (changedKeys.length === 0) {
    console.log(`  SiteSetting '${key}': unchanged (already PecanRev)`);
    return;
  }

  await prisma.siteSetting.update({
    where: { key },
    data: { value: JSON.stringify(parsed) },
  });
  console.log(`  SiteSetting '${key}': updated fields → ${changedKeys.join(', ')}`);
}

/** Rewrite the seeded onboarding question prompt (and description, if branded). */
async function rebrandOnboardingQuestion(questionKey) {
  const row = await prisma.onboardingQuestion.findUnique({ where: { key: questionKey } });
  if (!row) {
    console.log(`  OnboardingQuestion '${questionKey}': not present — skipped`);
    return;
  }

  const data = {};
  const nextPrompt = rebrandString(row.prompt);
  if (nextPrompt !== row.prompt) data.prompt = nextPrompt;
  const nextDescription = rebrandString(row.description);
  if (nextDescription !== row.description) data.description = nextDescription;

  if (Object.keys(data).length === 0) {
    console.log(`  OnboardingQuestion '${questionKey}': unchanged (already PecanRev)`);
    return;
  }

  await prisma.onboardingQuestion.update({ where: { key: questionKey }, data });
  console.log(`  OnboardingQuestion '${questionKey}': updated fields → ${Object.keys(data).join(', ')}`);
}

async function main() {
  console.log('Rebranding stored brand text → PecanRev …');

  // appSettings: brand appears in appName + maintenanceMessage.
  await rebrandJsonSetting('appSettings', ['appName', 'maintenanceMessage']);
  // landingContent: aboutText is the known carrier, but rebrand ALL string fields
  // so any other landing brand copy (banners, headlines) is covered too.
  await rebrandJsonSetting('landingContent', null);
  // onboardingSettings: intro copy shown on the onboarding screen.
  await rebrandJsonSetting('onboardingSettings', ['introTitle', 'introBody']);
  // The one seeded onboarding question whose prompt named the product.
  await rebrandOnboardingQuestion('main_use_case');

  console.log('Done.');
}

main()
  .catch(err => {
    console.error('rebrand-pecanrev failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
