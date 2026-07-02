/**
 * reproLog.js — 69.md. Pure builder for the "reproducible search log" JSON that the
 * SearchExportPanel downloads. Kept out of the component so it is deterministic and
 * unit-testable (no React, no network). Given the live strategy, the saved version
 * list, and (when Search & Discovery ran) the per-run provider counts, it assembles a
 * single self-describing JSON document a reviewer can archive alongside the manuscript.
 *
 * Nothing here fabricates numbers: every field is copied from data the caller already
 * has. Missing inputs simply omit their section.
 */

const SCHEMA = 'pecanrev.search-log/v1';

/** Concept summary rows: id, label, PICO field, and the live term texts. Defensive. */
function summarizeConcepts(concepts) {
  return (Array.isArray(concepts) ? concepts : []).map((c) => ({
    id: c && c.id,
    label: (c && c.label) || '',
    picoField: (c && c.picoField) || null,
    terms: Array.isArray(c && c.terms)
      ? c.terms.map((t) => String((t && t.text) || '').trim()).filter(Boolean)
      : [],
  }));
}

/** Compact version rows for the log (drops any heavy nested strategy). */
function summarizeVersions(versions) {
  return (Array.isArray(versions) ? versions : []).map((v) => ({
    id: v && v.id,
    version: v && v.version,
    name: (v && v.name) || '',
    isFinal: !!(v && v.isFinal),
    note: (v && v.note) || '',
    createdByName: (v && v.createdByName) || '',
    createdAt: (v && v.createdAt) || '',
  }));
}

/**
 * Per-run provider counts, when Search & Discovery ran. Accepts the pecan `listRuns`
 * shape ({ runs:[{ id, name, state|status, startedAt|createdAt, providerCounts|counts,
 * total }] }) OR a plain array of runs. Copies only reproducibility-relevant fields.
 */
function summarizeRuns(runsInput) {
  const runs = Array.isArray(runsInput) ? runsInput
    : (runsInput && Array.isArray(runsInput.runs)) ? runsInput.runs : [];
  return runs.map((r) => ({
    id: r && r.id,
    name: (r && r.name) || '',
    state: (r && (r.state || r.status)) || '',
    at: (r && (r.startedAt || r.createdAt || r.finishedAt)) || '',
    providerCounts: (r && (r.providerCounts || r.counts)) || null,
    total: r && (r.total != null ? r.total : (r.recordCount != null ? r.recordCount : null)),
  }));
}

/**
 * buildReproLog({ projectId, strategy, versions, runs, generatedAt }) → a plain object.
 * `strategy` is the live query { concepts, filters, overrides, databases }.
 * `runs` may be omitted (Search & Discovery off / never run). Pure.
 */
export function buildReproLog({ projectId, strategy, versions, runs, generatedAt } = {}) {
  const s = strategy || {};
  const finalVersion = (Array.isArray(versions) ? versions : []).find((v) => v && v.isFinal) || null;
  const log = {
    schema: SCHEMA,
    generatedAt: generatedAt || new Date().toISOString(),
    projectId: projectId != null ? String(projectId) : null,
    strategy: {
      concepts: summarizeConcepts(s.concepts),
      filters: (s.filters && typeof s.filters === 'object') ? s.filters : {},
      databases: Array.isArray(s.databases) ? s.databases : [],
      overrides: (s.overrides && typeof s.overrides === 'object') ? s.overrides : {},
    },
    versions: summarizeVersions(versions),
    finalVersion: finalVersion
      ? { id: finalVersion.id, version: finalVersion.version, name: finalVersion.name || '' }
      : null,
  };
  if (runs !== undefined && runs !== null) log.runs = summarizeRuns(runs);
  return log;
}

/** Pretty-printed JSON string of the repro log (what the download writes). */
export function reproLogToJson(input) {
  return JSON.stringify(buildReproLog(input), null, 2);
}

/** Filesystem-safe base filename for the download (no extension). */
export function reproLogFilename(projectId) {
  const safe = String(projectId == null ? 'project' : projectId).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  const day = new Date().toISOString().slice(0, 10);
  return `search-log-${safe}-${day}.json`;
}
