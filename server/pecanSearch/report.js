/**
 * pecanSearch/report.js — PRISMA-S–oriented search report + PRISMA identification
 * counts (§17). Builds a reproducible, per-source record of exactly what was run
 * from the stored run + source rows (every number derives from persisted data,
 * never reconstructed approximately).
 *
 * Exporters: structured JSON, CSV (with formula-injection guarding), and a
 * print-friendly, self-contained HTML document (all user/provider text escaped).
 */
import { prisma } from '../db/client.js';
import { aggregateCounts, shapeSource } from './runService.js';
import { PROVIDER_REGISTRY } from './config.js';
import { csvField } from '../utils/csv.js';

/** Build the full report object for a run. */
export async function buildReport(runId) {
  const run = await prisma.pecanSearchRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const sources = await prisma.pecanSearchSource.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
  const counts = aggregateCounts(sources);

  const perSource = sources.map((s) => {
    const reg = PROVIDER_REGISTRY[s.provider] || {};
    return {
      database: reg.label || s.provider,
      provider: s.provider,
      platform: reg.platform || '',
      generatedQuery: s.generatedQuery,
      finalQuery: s.finalQuery,
      queryHash: s.queryHash,
      hasOverride: !!s.overrideById,
      translationWarnings: safe(s.translationWarnings, []),
      filters: safe(s.filters, {}),
      cap: s.cap, capReached: !!s.capReached,
      previewCount: s.previewCount, previewKind: s.previewKind,
      retrievedCount: s.rawCount,
      importedCount: s.importedCount,
      existingMatchCount: s.existingMatchCount,
      duplicatesRemoved: (s.exactDupCount || 0) + (s.fuzzyDupCount || 0),
      ambiguousPending: s.ambiguousDupCount,
      failedRecords: s.failedRecordCount,
      connectorVersion: s.providerVersion,
      state: s.state,
      startedAt: s.startedAt, completedAt: s.completedAt,
      errorClass: s.errorClass, errorDetail: s.errorDetail,
    };
  });

  return {
    runId: run.id,
    project: run.metaLabProjectId,
    searchName: run.name,
    state: run.state,
    initiatedBy: run.initiatedByName,
    runDate: run.startedAt || run.createdAt,
    completedAt: run.completedAt,
    timezoneOffsetNote: 'Timestamps are ISO-8601 (UTC).',
    canonicalQuery: run.canonicalText,
    engineVersion: run.engineVersion,
    deduplicationMethod: 'PecanRev explainable engine (scorePair / classifyPair)',
    counts: prismaCounts(counts),
    perSource,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * prismaCounts — the PRISMA 2020 identification figures derived from the run.
 *  - recordsIdentified: total RAW records retrieved across sources (NOT deduped).
 *  - duplicatesRemoved: exact + auto-merged fuzzy duplicates removed before screening.
 *  - existingMatched: records already present in the project (matched, not re-added).
 *  - recordsToScreening: net new records that entered screening.
 *  - ambiguousPending: ambiguous duplicate pairs awaiting human review (informational).
 */
export function prismaCounts(counts) {
  const recordsIdentified = counts.rawRetrieved || 0;
  const duplicatesRemoved = (counts.exactDup || 0) + (counts.fuzzyDup || 0);
  return {
    recordsIdentified,
    bySource: counts.perSource || {},
    duplicatesRemoved,
    existingMatched: counts.existingMatched || 0,
    recordsToScreening: counts.imported || 0,
    ambiguousPending: counts.ambiguousDup || 0,
    failedRecords: counts.failedRecords || 0,
  };
}

// ── Exporters ────────────────────────────────────────────────────────────────

/** CSV export of the per-source report (formula-injection guarded). */
export function reportToCsv(report) {
  const cols = ['database', 'provider', 'platform', 'finalQuery', 'queryHash', 'previewCount', 'retrievedCount', 'importedCount', 'existingMatchCount', 'duplicatesRemoved', 'ambiguousPending', 'failedRecords', 'capReached', 'state', 'startedAt', 'completedAt'];
  const head = cols.join(',');
  const rows = (report.perSource || []).map((s) => cols.map((c) => csvCell(s[c])).join(','));
  const meta = [
    `# Search report,${csvCell(report.searchName)}`,
    `# Run,${csvCell(report.runId)}`,
    `# Date,${csvCell(report.runDate)}`,
    `# Canonical query,${csvCell(report.canonicalQuery)}`,
    `# Records identified,${report.counts.recordsIdentified}`,
    `# Duplicates removed,${report.counts.duplicatesRemoved}`,
    `# Records to screening,${report.counts.recordsToScreening}`,
  ];
  return [...meta, '', head, ...rows].join('\n');
}

// CSV cell encoding (RFC-4180 quoting + spreadsheet formula-injection guard) is
// centralized in server/utils/csv.js so every exporter shares one implementation.
const csvCell = csvField;

/** Print-friendly, self-contained HTML export (all dynamic text escaped). */
export function reportToHtml(report) {
  const e = escapeHtml;
  const rows = (report.perSource || []).map((s) => `
    <tr>
      <td>${e(s.database)}</td>
      <td><code>${e(s.finalQuery)}</code>${s.hasOverride ? ' <span class="badge">override</span>' : ''}
        ${(s.translationWarnings || []).length ? `<div class="warn">⚠ ${(s.translationWarnings || []).map(e).join('; ')}</div>` : ''}</td>
      <td class="num">${s.previewCount == null ? '—' : e(s.previewCount)}</td>
      <td class="num">${e(s.retrievedCount)}${s.capReached ? ' <span class="badge">cap</span>' : ''}</td>
      <td class="num">${e(s.importedCount)}</td>
      <td class="num">${e(s.duplicatesRemoved)}</td>
      <td>${e(s.state)}${s.errorDetail ? `<div class="warn">${e(s.errorDetail)}</div>` : ''}</td>
    </tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>PRISMA-S search report — ${e(report.searchName)}</title>
<style>
 body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a2330;max-width:980px;margin:24px auto;padding:0 16px}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#5b6b7f;margin:0 0 18px}
 table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
 th,td{border:1px solid #d8e0ea;padding:6px 8px;text-align:left;vertical-align:top}
 th{background:#f3f6fa} .num{text-align:right;font-variant-numeric:tabular-nums}
 code{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
 .badge{display:inline-block;background:#e6eefb;color:#2b5cb8;border-radius:4px;padding:0 6px;font-size:11px}
 .warn{color:#a4601a;font-size:12px;margin-top:4px}
 .counts{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0;padding:10px 14px;background:#f7f9fc;border:1px solid #e3e9f1;border-radius:8px}
 .counts div b{display:block;font-size:18px} @media print{.no-print{display:none}}
</style></head><body>
<h1>PRISMA-S search report</h1>
<p class="sub">${e(report.searchName)} · run ${e(report.runId)} · ${e(formatDate(report.runDate))} · ${e(report.state)}</p>
<div class="counts">
  <div><b>${e(report.counts.recordsIdentified)}</b>records identified</div>
  <div><b>${e(report.counts.duplicatesRemoved)}</b>duplicates removed</div>
  <div><b>${e(report.counts.existingMatched)}</b>already in project</div>
  <div><b>${e(report.counts.recordsToScreening)}</b>to screening</div>
  <div><b>${e(report.counts.ambiguousPending)}</b>ambiguous (review)</div>
</div>
<p><strong>Canonical strategy:</strong> <code>${e(report.canonicalQuery)}</code></p>
<p class="sub">Deduplication: ${e(report.deduplicationMethod)} · Engine ${e(report.engineVersion)} · Generated ${e(report.generatedAt)}</p>
<table><thead><tr><th>Database</th><th>Executed query</th><th class="num">Preview</th><th class="num">Retrieved</th><th class="num">Imported</th><th class="num">Dup removed</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table>
<p class="sub">Generated by PecanRev Pecan Search Engine. Every count derives from stored run data.</p>
</body></html>`;
}

function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatDate(d) { try { return new Date(d).toISOString(); } catch { return String(d || ''); } }
function safe(s, dflt) { try { return JSON.parse(s || ''); } catch { return dflt; } }
