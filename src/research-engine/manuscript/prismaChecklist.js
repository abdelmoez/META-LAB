/**
 * manuscript/prismaChecklist.js — 64.md (P3). Pure builders for the PRISMA 2020
 * reporting checklist and the PRISMA-S search-reporting checklist, pre-filled from
 * the project's real data and the manuscript draft. Exported as structured arrays
 * + CSV. No DOM/React.
 *
 * Status values: 'reported' | 'partial' | 'not-reported'. We mark an item
 * 'reported' when the user has ticked it (Project.data.reportChecked) OR we can
 * confirm the data exists; 'partial' when some but not all signals are present;
 * 'not-reported' otherwise. These are HINTS — the user confirms before submission.
 */

import { PRISMA_CL } from '../project-model/monolithConstants.js';

const clean = (s) => String(s == null ? '' : s).trim();

// RFC-4180 + CSV-injection-safe cell (mirrors server/utils/csv.js behaviour).
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRows(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** Auto-detect signals per PRISMA item id so we can pre-fill status honestly. */
function autoSignal(project, manuscript, id) {
  const search = (project && project.search) || {};
  const dbsOn = Object.keys(search.dbs || {}).filter((k) => search.dbs[k]);
  const pico = (project && project.pico) || {};
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const sect = (manuscript && manuscript.sections) || {};
  const has = (k) => !!(sect[k] && clean(sect[k].content));
  switch (id) {
    case 'T1': return has('title') || clean(project && project.name) ? 'reported' : 'not-reported';
    case 'A1': return has('abstract') ? 'reported' : 'not-reported';
    case 'I1': case 'I2': return has('introduction') || clean(pico.question) ? 'reported' : 'not-reported';
    case 'M1': return clean(pico.incl) || clean(pico.excl) || clean(pico.P) ? 'reported' : 'not-reported';
    case 'M2': return dbsOn.length ? (clean(search.date) ? 'reported' : 'partial') : 'not-reported';
    case 'M3': return clean(search.string) ? 'reported' : (dbsOn.length ? 'partial' : 'not-reported');
    case 'M7': return studies.some((s) => s.rob && Object.keys(s.rob).length) ? 'reported' : 'not-reported';
    case 'M8': return studies.some((s) => clean(s.esType)) ? 'reported' : 'not-reported';
    default: return null;
  }
}

/**
 * Build the PRISMA 2020 checklist. Pure.
 * @returns array of { id, section, item, description, status, location, note }
 */
export function buildPrismaChecklist(project, manuscript) {
  const checked = (project && project.reportChecked) || {};
  return PRISMA_CL.map((it) => {
    const auto = autoSignal(project, manuscript, it.id);
    const status = checked[it.id] ? 'reported' : (auto || 'not-reported');
    return {
      id: it.id,
      section: it.sec,
      item: it.item,
      description: it.desc,
      status,
      location: '',
      note: checked[it.id] ? 'Marked complete in PRISMA Checklist tab' : (auto && auto !== 'not-reported' ? 'Auto-detected from project data — verify' : ''),
    };
  });
}

export function prismaChecklistToCSV(items) {
  const header = ['Item ID', 'Section', 'Item', 'Checklist description', 'Status', 'Location in manuscript', 'Notes'];
  const rows = (items || []).map((i) => [i.id, i.section, i.item, i.description, i.status, i.location, i.note]);
  return '﻿' + csvRows([header, ...rows]);
}

/**
 * PRISMA-S (search reporting) checklist — 16 core items grouped, pre-filled from
 * the project's search data. Pure.
 */
const PRISMA_S_ITEMS = [
  { id: 'S1', group: 'Database', item: 'Database name', desc: 'Name each database searched and the platform/interface used.' },
  { id: 'S2', group: 'Database', item: 'Multi-database searching', desc: 'Indicate when multiple databases were searched together.' },
  { id: 'S3', group: 'Database', item: 'Study registries', desc: 'Indicate registries searched (e.g. ClinicalTrials.gov, WHO ICTRP).' },
  { id: 'S4', group: 'Other sources', item: 'Online resources & browsing', desc: 'Report websites/search engines browsed for studies.' },
  { id: 'S5', group: 'Other sources', item: 'Citation searching', desc: 'Report backward/forward citation searching.' },
  { id: 'S6', group: 'Other sources', item: 'Contacts', desc: 'Report contacting authors/organisations.' },
  { id: 'S7', group: 'Search strategies', item: 'Full search strategies', desc: 'Present the full line-by-line strategy for each database.' },
  { id: 'S8', group: 'Search strategies', item: 'Limits and restrictions', desc: 'Report any date, language, or document-type limits.' },
  { id: 'S9', group: 'Search strategies', item: 'Search filters', desc: 'Report published/validated filters used and their source.' },
  { id: 'S10', group: 'Search strategies', item: 'Prior work', desc: 'Indicate strategies adapted from prior reviews.' },
  { id: 'S11', group: 'Search strategies', item: 'Updates', desc: 'Report any re-running/updating of searches and dates.' },
  { id: 'S12', group: 'Search strategies', item: 'Dates of searches', desc: 'Report the date each source was last searched.' },
  { id: 'S13', group: 'Peer review', item: 'Peer review', desc: 'Describe any peer review of the search strategy (e.g. PRESS).' },
  { id: 'S14', group: 'Managing records', item: 'Total records', desc: 'Report total records retrieved from each source.' },
  { id: 'S15', group: 'Managing records', item: 'Deduplication', desc: 'Describe the deduplication process and software.' },
  { id: 'S16', group: 'Managing records', item: 'Records management', desc: 'Name software used to manage records.' },
];

export function buildPrismaSChecklist(project) {
  const search = (project && project.search) || {};
  const prisma = (project && project.prisma) || {};
  const dbsOn = Object.keys(search.dbs || {}).filter((k) => search.dbs[k]);
  const has = (b) => (b ? 'reported' : 'not-reported');
  const prefill = {
    S1: has(dbsOn.length),
    S2: has(dbsOn.length > 1),
    S3: has(dbsOn.some((d) => /trial|ictrp|registr/i.test(d))),
    S7: has(clean(search.string)),
    S8: has(clean(search.notes)),
    S12: has(clean(search.date)),
    S14: has(clean(prisma.dbs)),
    S15: has(clean(prisma.dedupe)),
  };
  return PRISMA_S_ITEMS.map((it) => ({
    id: it.id,
    group: it.group,
    item: it.item,
    description: it.desc,
    status: prefill[it.id] || 'not-reported',
    detail: it.id === 'S1' && dbsOn.length ? dbsOn.join('; ')
      : it.id === 'S12' && clean(search.date) ? clean(search.date)
        : it.id === 'S7' && clean(search.string) ? 'See search-strategy export'
          : '',
    note: prefill[it.id] === 'reported' ? 'Auto-detected from project data — verify' : '',
  }));
}

export function prismaSChecklistToCSV(items) {
  const header = ['Item ID', 'Group', 'Item', 'PRISMA-S description', 'Status', 'Detail', 'Notes'];
  const rows = (items || []).map((i) => [i.id, i.group, i.item, i.description, i.status, i.detail, i.note]);
  return '﻿' + csvRows([header, ...rows]);
}

export default {
  buildPrismaChecklist,
  prismaChecklistToCSV,
  buildPrismaSChecklist,
  prismaSChecklistToCSV,
};
