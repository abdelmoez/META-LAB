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

// ── P11 — PRISMA-S search-strategy DOCUMENTATION ──────────────────────────────
// Extends the per-run report with the search-strategy Studio provenance: the final
// (or latest) strategy version, the per-database FINAL executed string + live hit
// count, the full iteration/change trail, the applied filters, seed/recall summary,
// and — when a run is supplied — the run's PRISMA identification counts + per-source
// detail. Every number derives from persisted rows (never reconstructed).

/**
 * buildSearchDocumentation({ projectId, runId? }) — the reproducible search-strategy
 * documentation payload for a project. `runId` is optional; when present and it belongs
 * to the project, its PRISMA-S run report is embedded (records retrieved per source).
 */
export async function buildSearchDocumentation({ projectId, runId = null }) {
  // Optional run report (records retrieved / per-source), scoped to this project.
  let base = null;
  if (runId) {
    const run = await prisma.pecanSearchRun.findUnique({ where: { id: runId }, select: { metaLabProjectId: true } });
    if (run && run.metaLabProjectId === projectId) base = await buildReport(runId);
  }

  // Final (isFinal) strategy version, else the most recent snapshot.
  const finalVersion = (await prisma.searchStrategyVersion.findFirst({
    where: { metaLabProjectId: projectId, isFinal: true }, orderBy: { version: 'desc' },
  })) || (await prisma.searchStrategyVersion.findFirst({
    where: { metaLabProjectId: projectId }, orderBy: { version: 'desc' },
  }));

  // Iteration trail grouped by database (latest per DB = the final executed string).
  const iterations = await prisma.searchStrategyIteration.findMany({
    where: { metaLabProjectId: projectId }, orderBy: [{ createdAt: 'asc' }],
  });
  const byDb = new Map();
  for (const it of iterations) {
    const arr = byDb.get(it.database) || [];
    arr.push(it);
    byDb.set(it.database, arr);
  }
  const perDatabase = [];
  for (const [db, arr] of byDb.entries()) {
    const last = arr[arr.length - 1];
    perDatabase.push({
      database: db,
      finalSearchString: last.searchString,
      hitCount: last.hitCount,
      hitKind: last.hitKind,
      iterations: arr.length,
      profile: last.profile || '',
      trail: arr.map((r) => ({
        iteration: r.iteration,
        hitCount: r.hitCount,
        hitKind: r.hitKind,
        criticScore: (safe(r.criticJson, {}) || {}).score ?? null,
        changes: safe(r.changesJson, {}),
        at: r.createdAt,
      })),
    });
  }

  // Applied filters (from the live 'search' module) + seed/recall summary.
  let filters = {};
  try {
    const mod = await prisma.workflowModuleState.findUnique({ where: { projectId_moduleKey: { projectId, moduleKey: 'search' } } });
    if (mod) filters = safe(mod.stateJson, {}).filters || {};
  } catch { filters = {}; }
  const seedTotal = await prisma.searchSeedStudy.count({ where: { metaLabProjectId: projectId } });
  const latestRecall = await prisma.searchRecallReport.findFirst({
    where: { metaLabProjectId: projectId }, orderBy: { createdAt: 'desc' },
  });

  return {
    project: projectId,
    generatedAt: new Date().toISOString(),
    searchDate: base ? base.runDate : (finalVersion ? finalVersion.createdAt : null),
    engineVersion: base ? base.engineVersion : null,
    finalStrategy: finalVersion ? {
      version: finalVersion.version,
      name: finalVersion.name || '',
      isFinal: !!finalVersion.isFinal,
      canonicalText: finalVersion.canonicalText || '',
      createdAt: finalVersion.createdAt,
    } : null,
    perDatabase,
    filters,
    seedTotal,
    recall: latestRecall ? {
      seedTotal: latestRecall.seedTotal,
      foundCount: latestRecall.foundCount,
      estimatedRecall: latestRecall.estimatedRecall,
      at: latestRecall.createdAt,
    } : null,
    prismaCounts: base ? base.counts : null,
    run: base ? {
      runId: base.runId, searchName: base.searchName, state: base.state,
      perSource: base.perSource,
    } : null,
  };
}

/** CSV export of the per-database strategy documentation (formula-injection guarded). */
export function searchDocToCsv(doc) {
  const d = doc || {};
  const cols = ['database', 'finalSearchString', 'hitCount', 'hitKind', 'iterations', 'profile'];
  const head = cols.join(',');
  const rows = (d.perDatabase || []).map((s) => cols.map((c) => csvCell(s[c])).join(','));
  const fs = d.finalStrategy || {};
  const meta = [
    `# PRISMA-S search strategy documentation,${csvCell(d.project)}`,
    `# Search date,${csvCell(d.searchDate)}`,
    `# Final strategy version,${csvCell(fs.version)}`,
    `# Final strategy name,${csvCell(fs.name)}`,
    `# Canonical strategy,${csvCell(fs.canonicalText)}`,
    `# Seed studies,${csvCell(d.seedTotal)}`,
    `# Estimated recall,${csvCell(d.recall ? d.recall.estimatedRecall : '')}`,
    `# Records identified,${csvCell(d.prismaCounts ? d.prismaCounts.recordsIdentified : '')}`,
  ];
  return [...meta, '', head, ...rows].join('\n');
}

/** Print-friendly, self-contained HTML export of the strategy documentation. */
export function searchDocToHtml(doc) {
  const d = doc || {};
  const e = escapeHtml;
  const fs = d.finalStrategy;
  const dbRows = (d.perDatabase || []).map((s) => `
    <tr>
      <td>${e(s.database)}</td>
      <td><code>${e(s.finalSearchString)}</code></td>
      <td class="num">${s.hitCount == null ? '—' : e(s.hitCount)}${s.hitKind ? ` <span class="badge">${e(s.hitKind)}</span>` : ''}</td>
      <td class="num">${e(s.iterations)}</td>
      <td>${e(s.profile)}</td>
    </tr>`).join('');
  const trailRows = (d.perDatabase || []).flatMap((s) => (s.trail || []).map((t) => `
    <tr>
      <td>${e(s.database)}</td>
      <td class="num">${e(t.iteration)}</td>
      <td class="num">${t.hitCount == null ? '—' : e(t.hitCount)}</td>
      <td class="num">${t.criticScore == null ? '—' : e(t.criticScore)}</td>
      <td>${e(t.changes && t.changes.reason ? t.changes.reason : (t.changes && t.changes.edits ? (Array.isArray(t.changes.edits) ? t.changes.edits.join('; ') : String(t.changes.edits)) : '—'))}</td>
    </tr>`)).join('');
  const filters = d.filters || {};
  const filterBits = [];
  if (filters.dateFrom || filters.dateTo) filterBits.push(`Dates ${e(filters.dateFrom || '…')}–${e(filters.dateTo || '…')}`);
  if (Array.isArray(filters.languages) && filters.languages.length) filterBits.push(`Languages: ${filters.languages.map(e).join(', ')}`);
  if (Array.isArray(filters.pubTypes) && filters.pubTypes.length) filterBits.push(`Publication types: ${filters.pubTypes.map(e).join(', ')}`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>PRISMA-S search strategy documentation</title>
<style>
 body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a2330;max-width:980px;margin:24px auto;padding:0 16px}
 h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 6px} .sub{color:#5b6b7f;margin:0 0 18px}
 table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}
 th,td{border:1px solid #d8e0ea;padding:6px 8px;text-align:left;vertical-align:top}
 th{background:#f3f6fa} .num{text-align:right;font-variant-numeric:tabular-nums}
 code{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
 .badge{display:inline-block;background:#e6eefb;color:#2b5cb8;border-radius:4px;padding:0 6px;font-size:11px}
 .counts{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0;padding:10px 14px;background:#f7f9fc;border:1px solid #e3e9f1;border-radius:8px}
 .counts div b{display:block;font-size:18px}
</style></head><body>
<h1>PRISMA-S search strategy documentation</h1>
<p class="sub">Project ${e(d.project)} · search date ${e(formatDate(d.searchDate))} · generated ${e(d.generatedAt)}</p>
${fs ? `<p><strong>Final strategy:</strong> v${e(fs.version)}${fs.name ? ` — ${e(fs.name)}` : ''}${fs.isFinal ? ' <span class="badge">final</span>' : ''}</p>
<p><code>${e(fs.canonicalText)}</code></p>` : '<p class="sub">No saved strategy version yet.</p>'}
<div class="counts">
  <div><b>${e(d.seedTotal || 0)}</b>seed studies</div>
  <div><b>${d.recall && d.recall.estimatedRecall != null ? e((d.recall.estimatedRecall * 100).toFixed(0)) + '%' : '—'}</b>estimated recall</div>
  <div><b>${d.prismaCounts ? e(d.prismaCounts.recordsIdentified) : '—'}</b>records identified</div>
</div>
${filterBits.length ? `<p class="sub">Limits: ${filterBits.join(' · ')}</p>` : ''}
<h2>Final executed strategy per database</h2>
<table><thead><tr><th>Database</th><th>Executed query</th><th class="num">Hits</th><th class="num">Iterations</th><th>Profile</th></tr></thead>
<tbody>${dbRows || '<tr><td colspan="5" class="sub">No optimisation iterations recorded yet.</td></tr>'}</tbody></table>
<h2>Refinement trail</h2>
<table><thead><tr><th>Database</th><th class="num">Iteration</th><th class="num">Hits</th><th class="num">Critic</th><th>Change</th></tr></thead>
<tbody>${trailRows || '<tr><td colspan="5" class="sub">No iterations recorded.</td></tr>'}</tbody></table>
<p class="sub">Generated by PecanRev. Every value derives from stored strategy, iteration and run data.</p>
</body></html>`;
}
