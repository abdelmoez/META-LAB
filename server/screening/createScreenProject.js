/**
 * server/screening/createScreenProject.js (prompt6 Task 2)
 *
 * Shared helper: create a META·SIFT ScreenProject linked to a META·LAB project,
 * server-side in the same request (never a second client POST — two client
 * calls can't be atomic, and a half-created pair is exactly the broken-link
 * state Task 3 fixes).
 *
 * Mirrors screeningController.createProject seeding (default keyword
 * suggestions, the same 7 default exclusion reasons, ensureLeaderMember)
 * WITHOUT importing the HTTP controller. The exclusion-reason list below is a
 * deliberate literal copy — keep it in sync with screeningController.
 */

import { prisma } from '../db/client.js';
import { ensureLeaderMember } from './access.js';
import { snapshotPico } from './picoSnapshot.js';
import {
  DEFAULT_INCLUDE_KEYWORDS,
  DEFAULT_EXCLUDE_KEYWORDS,
} from '../../src/research-engine/screening/defaultKeywords.js';
import { PERMISSION_KEYS } from '../../src/research-engine/screening/permissionPresets.js';

// Same literal list screeningController.createProject seeds.
const DEFAULT_EXCLUSION_REASONS = [
  'Wrong population', 'Wrong intervention', 'Wrong comparator',
  'Wrong outcome', 'Wrong study design', 'Duplicate', 'Not accessible',
];

/**
 * Create a ScreenProject linked to a META·LAB project.
 *
 * @param {object} opts
 * @param {string} opts.ownerId                 — workspace owner (the creator)
 * @param {string} opts.title                   — project title (same as the ML project name)
 * @param {string} opts.linkedMetaLabProjectId  — the META·LAB project id to link
 * @param {object} [opts.mlData]                — full META·LAB project object (PICO snapshot source)
 * @param {object[]} [opts.members]             — optional ScreenProjectMember-shaped rows to mirror
 * @returns {Promise<object>} the created ScreenProject
 */
export async function createLinkedScreenProject({ ownerId, title, linkedMetaLabProjectId, mlData, members }) {
  const project = await prisma.screenProject.create({
    data: {
      ownerId,
      title,
      description: '',
      linkedMetaLabProjectId,
      // Cache the PICO/criteria from the META·LAB side at link time (Task 2).
      picoSnapshot: snapshotPico(mlData || {}),
      // Seed editable default keyword suggestions (same as SIFT-side create).
      inclusionKeywords: JSON.stringify(DEFAULT_INCLUDE_KEYWORDS),
      exclusionKeywords: JSON.stringify(DEFAULT_EXCLUDE_KEYWORDS),
    },
  });

  // Seed default exclusion reasons (literal copy of the SIFT-side seed).
  await prisma.screenExclusionReason.createMany({
    data: DEFAULT_EXCLUSION_REASONS.map(text => ({ projectId: project.id, text })),
  });

  // The creator automatically becomes the workspace owner member row.
  await ensureLeaderMember(project);

  // Optionally mirror member rows ("same initial members"). Rows are shaped
  // like ScreenProjectMember rows: copy preset + all permission flags + status
  // + name/email/userId. The owner email is skipped (seeded above), as is any
  // foreign 'owner'-role row (a workspace has exactly one owner row).
  if (Array.isArray(members) && members.length) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { email: true } });
    const seen = new Set([String((owner && owner.email) || '').trim().toLowerCase()]);
    for (const m of members) {
      const email = String((m && m.email) || '').trim().toLowerCase();
      if (!email || seen.has(email)) continue;   // skip owner + in-batch duplicates
      if (m.role === 'owner') continue;          // owner row already seeded
      seen.add(email);
      const flags = {};
      for (const k of PERMISSION_KEYS) {
        if (m[k] !== undefined) flags[k] = !!m[k];
      }
      // Best-effort per row — one bad member row must never fail project creation.
      try {
        await prisma.screenProjectMember.create({
          data: {
            projectId: project.id,
            userId: m.userId || null,
            name: m.name || '',
            email,
            role: m.role || 'reviewer',
            status: m.status || 'active',
            permissionPreset: m.permissionPreset || 'reviewer',
            ...flags,
          },
        });
      } catch { /* skip row (e.g. unique [projectId,email] race) */ }
    }
  }

  return project;
}
