/**
 * features/manuscript/export/checklistExport.js — 64.md (P3). Client helpers to
 * build + download the PRISMA 2020 and PRISMA-S checklists as CSV (pre-filled from
 * project data). CSV is the cleanest cross-tool format and reuses the injection-safe
 * encoder in the pure engine. Word/xlsx not required by acceptance criteria.
 */
import {
  buildPrismaChecklist, prismaChecklistToCSV,
  buildPrismaSChecklist, prismaSChecklistToCSV,
} from '../../../research-engine/manuscript/index.js';
import { downloadText } from '../../../frontend/components/exportCore.js';

export function prismaChecklistCsv(project, draft) {
  return prismaChecklistToCSV(buildPrismaChecklist(project, draft));
}
export function prismaSChecklistCsv(project) {
  return prismaSChecklistToCSV(buildPrismaSChecklist(project));
}

export function downloadPrismaChecklist(project, draft, filename = 'prisma-2020-checklist.csv') {
  downloadText(prismaChecklistCsv(project, draft), filename, 'text/csv;charset=utf-8');
}
export function downloadPrismaSChecklist(project, filename = 'prisma-s-checklist.csv') {
  downloadText(prismaSChecklistCsv(project), filename, 'text/csv;charset=utf-8');
}

export default { prismaChecklistCsv, prismaSChecklistCsv, downloadPrismaChecklist, downloadPrismaSChecklist };
