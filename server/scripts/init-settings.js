#!/usr/bin/env node
/**
 * init-settings.js — Seeds default SiteSettings into the database.
 * Only inserts rows that don't already exist.
 *
 * Run from project root:
 *   node server/scripts/init-settings.js
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULTS = {
  appSettings: JSON.stringify({
    appName: 'PecanRev',
    registrationOpen: true,
    maintenanceMode: false,
    contactEnabled: true,
    projectCreationEnabled: true,
    exportEnabled: true,
    maxProjectsPerUser: null,
    maxStudiesPerProject: null,
  }),
  landingContent: JSON.stringify({
    heroHeadline: 'A serious workspace for systematic reviews and meta-analysis.',
    heroSubtitle:
      'Organize evidence, extract data, run pooled analyses, and export research-ready reports — all in one secure platform.',
    ctaText: 'Start Your Review',
    aboutText:
      'PecanRev is built for researchers who take systematic evidence synthesis seriously.',
    footerText: 'Systematic review platform · Research use only',
    announcementBanner: null,
    maintenanceBanner: null,
  }),
  featureFlags: JSON.stringify({
    autosave: true,
    contactForm: true,
    projectDuplication: true,
    advancedMetaAnalysis: true,
    exportTools: true,
  }),
};

async function main() {
  console.log('Initializing default SiteSettings...');

  for (const [key, value] of Object.entries(DEFAULTS)) {
    const result = await prisma.siteSetting.upsert({
      where: { key },
      update: {}, // don't overwrite existing values
      create: { key, value },
    });
    console.log(`  ${key}: ${result.updatedAt ? 'already exists (skipped)' : 'created'}`);
  }

  console.log('Done.');
}

main()
  .catch(err => {
    console.error('Init-settings failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
