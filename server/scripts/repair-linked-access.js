#!/usr/bin/env node
/**
 * repair-linked-access.js  (prompt5 Task 4 §9)
 *
 * Repairs membership/access consistency for linked Review Workspaces so existing
 * projects that have members but broken access are healed. Safe + idempotent:
 *
 *   1. Every ScreenProject gets a valid OWNER member row (self-heals legacy
 *      'leader'-as-owner rows → role 'owner' with full permissions).
 *   2. Every member row gets a sane permissionPreset if missing/blank.
 *   3. Reports linked workspaces and how many members gain META·LAB / META·SIFT
 *      visibility, so an operator can verify cross-app access is now correct.
 *
 * Nothing is destructive: no member is removed and no permission is downgraded.
 *
 * Run from project root:  node server/scripts/repair-linked-access.js
 */
import '../load-env.js';   // populate DATABASE_URL from server/.env before Prisma loads
import { PrismaClient } from '@prisma/client';
import { fullPermissions, PERMISSION_KEYS } from '../../src/research-engine/screening/permissionPresets.js';

const prisma = new PrismaClient();

async function ensureOwnerRow(project) {
  const existing = await prisma.screenProjectMember.findFirst({
    where: { projectId: project.id, userId: project.ownerId },
  });
  const full = fullPermissions();
  if (existing) {
    if (existing.role !== 'owner' || existing.status !== 'active') {
      await prisma.screenProjectMember.update({
        where: { id: existing.id },
        data: { role: 'owner', status: 'active', permissionPreset: 'owner', canScreen: true, canChat: true, canResolveConflicts: true, ...full },
      });
      return 'healed';
    }
    return 'ok';
  }
  const owner = await prisma.user.findUnique({ where: { id: project.ownerId } });
  if (!owner) return 'no-owner';
  await prisma.screenProjectMember.create({
    data: {
      projectId: project.id, userId: owner.id, name: owner.name || '', email: owner.email || '',
      role: 'owner', status: 'active', permissionPreset: 'owner',
      canScreen: true, canChat: true, canResolveConflicts: true, ...full,
    },
  });
  return 'created';
}

async function main() {
  const projects = await prisma.screenProject.findMany({
    select: { id: true, title: true, ownerId: true, linkedMetaLabProjectId: true },
  });

  let ownerCreated = 0, ownerHealed = 0, presetFilled = 0;
  let linkedCount = 0, metalabVisible = 0, metasiftVisible = 0;

  for (const p of projects) {
    const r = await ensureOwnerRow(p);
    if (r === 'created') ownerCreated++;
    if (r === 'healed') ownerHealed++;

    // Backfill blank permissionPreset on member rows.
    const members = await prisma.screenProjectMember.findMany({ where: { projectId: p.id } });
    for (const m of members) {
      if (!m.permissionPreset) {
        const preset = m.role === 'owner' ? 'owner' : m.role === 'leader' ? 'leader' : m.role === 'viewer' ? 'viewer' : 'reviewer';
        await prisma.screenProjectMember.update({ where: { id: m.id }, data: { permissionPreset: preset } });
        presetFilled++;
      }
    }

    if (p.linkedMetaLabProjectId) {
      linkedCount++;
      const active = members.filter(m => m.status === 'active');
      metalabVisible += active.filter(m => m.role === 'owner' || m.role === 'leader' || m.canViewMetaLab || m.canEditMetaLab).length;
      metasiftVisible += active.filter(m => m.role === 'owner' || m.role === 'leader' || m.canViewMetaSift).length;
    }
  }

  console.log('\nrepair-linked-access complete:');
  console.log(`  projects scanned         : ${projects.length}`);
  console.log(`  owner rows created       : ${ownerCreated}`);
  console.log(`  owner rows healed        : ${ownerHealed}`);
  console.log(`  permissionPreset filled  : ${presetFilled}`);
  console.log(`  linked workspaces        : ${linkedCount}`);
  console.log(`  members w/ META·LAB view : ${metalabVisible}`);
  console.log(`  members w/ META·SIFT view: ${metasiftVisible}`);
  console.log(`  (PERMISSION_KEYS tracked : ${PERMISSION_KEYS.length})`);
}

main().catch(e => { console.error('Repair failed:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
