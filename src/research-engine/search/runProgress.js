/**
 * research-engine/search/runProgress.js — the PURE, honest progress model for a
 * Pecan Search Engine run (the "Automated Search → Add to Screening" operation).
 *
 * It turns a run summary (the exact `shapeRun` shape the API already returns —
 * `{ state, counts, sources:[…] }`) into everything the progress UI needs:
 *   { percent, indeterminate, terminal, phase, phaseLabel, activityText,
 *     steps:[…], counts, sources:[…] }.
 *
 * NON-NEGOTIABLE: the percentage is derived from ACTUAL work, never a timer.
 *   • Backbone = fraction of the run's sources that have reached a terminal state
 *     (each source is worth 1/N). Every finished database delivers a real,
 *     un-fakeable 1/N jump — this alone is always truthful ("3 of 5 databases
 *     done ⇒ ≥ 60%").
 *   • The single in-flight source is refined by rawRetrieved / expectedTotal when
 *     the provider reports a trustworthy total (min(previewCount, cap)), capped so a
 *     source never claims its full 1/N before its state actually turns terminal.
 *   • Providers that only give an *estimate* total (Crossref, Semantic Scholar) are
 *     down-weighted; a source with NO total falls back to a bounded, stage-based
 *     credit rather than a fabricated ratio.
 *   • Never reaches 100 while the run is non-terminal (reserve the last step for the
 *     server's authoritative finalize); snaps to 100 the instant the run terminalises.
 *   • Monotonicity is enforced by the CALLER across polls via `nextProgressPercent`
 *     (the server is stateless per request; the client holds the running max).
 *
 * This module has ZERO imports so it is trivially unit-testable and safe to import
 * from both the browser (the modal) and the server (shapeRun / logging).
 */

/** Run states that mean "no more work will happen". */
export const TERMINAL_RUN_STATES = new Set(['completed', 'partial', 'failed', 'cancelled']);
/** Per-source states that mean "this source is finished" (incl. skipped/failed). */
export const TERMINAL_SOURCE_STATES = new Set(['completed', 'partial', 'failed', 'cancelled', 'skipped']);

/**
 * Providers whose `search()` returns an EXACT corpus total (esearch count, hitCount,
 * meta.count, totalCount, DOAJ total) — a trustworthy denominator.
 */
export const EXACT_TOTAL_PROVIDERS = new Set(['pubmed', 'europepmc', 'doaj', 'clinicaltrials', 'openalex']);
/**
 * Providers whose total is only an ESTIMATE (relevance engines that drift/shrink as
 * you page). Used as a soft hint and down-weighted; never allowed to move the bar back.
 */
export const ESTIMATE_TOTAL_PROVIDERS = new Set(['crossref', 'semanticscholar']);

/** Human labels for provider ids (the run summary only carries the id). */
export const PROVIDER_LABELS = {
  pubmed: 'PubMed',
  europepmc: 'Europe PMC',
  crossref: 'Crossref',
  doaj: 'DOAJ',
  openalex: 'OpenAlex',
  semanticscholar: 'Semantic Scholar',
  clinicaltrials: 'ClinicalTrials.gov',
};
export function providerLabel(id) {
  return PROVIDER_LABELS[id] || (id ? String(id) : 'database');
}

// Per-source in-flight fraction ceilings: a source may reach at most this share of its
// own 1/N slice until its state actually turns terminal. Keeps the bar from claiming a
// source is "done" while dedup/import for its last page is still committing.
const EXACT_FRACTION_CAP = 0.95;
const ESTIMATE_FRACTION_CAP = 0.8;
// Bounded, honest credit for a running source with NO known total — keyed by the real
// pipeline stage the source is in (pipeline.js: fetching→normalizing→deduplicating→importing).
const STAGE_FRACTION = {
  queued: 0, validating: 0.05, waiting: 0.05, counting: 0.08,
  fetching: 0.2, normalizing: 0.45, deduplicating: 0.62, importing: 0.82, finalizing: 0.92,
};
// Never let the derived value hit 100 while the run is still non-terminal.
const NON_TERMINAL_CEILING = 99;
// A tiny visible floor once the operation has been accepted (queued), so the bar is
// never a dead 0 while the worker is picking the job up.
const ACCEPTED_FLOOR = 2;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * expectedTotalFor(source) — the honest denominator for an in-flight source, or null
 * when no trustworthy total is known. `min(previewCount, cap)` because the pipeline
 * stops at `cap`, so the realistically-retrievable count is the smaller of the two.
 * Returns `{ total, trust }` where trust ∈ 'exact' | 'estimate', or null.
 */
export function expectedTotalFor(source) {
  if (!source) return null;
  const preview = source.previewCount;
  if (preview == null || !Number.isFinite(Number(preview)) || Number(preview) <= 0) return null;
  const cap = num(source.cap);
  const total = cap > 0 ? Math.min(Number(preview), cap) : Number(preview);
  if (total <= 0) return null;
  if (EXACT_TOTAL_PROVIDERS.has(source.provider)) return { total, trust: 'exact' };
  if (ESTIMATE_TOTAL_PROVIDERS.has(source.provider)) return { total, trust: 'estimate' };
  // Unknown provider that still reported a number — treat conservatively as an estimate.
  return { total, trust: 'estimate' };
}

/** The [0,1] contribution of ONE source toward the run backbone. */
function sourceFraction(source) {
  const state = source.state || 'pending';
  if (TERMINAL_SOURCE_STATES.has(state)) return 1;
  const retrieved = num(source.rawCount);
  const exp = expectedTotalFor(source);
  if (exp) {
    const cap = exp.trust === 'exact' ? EXACT_FRACTION_CAP : ESTIMATE_FRACTION_CAP;
    return clamp(retrieved / Math.max(exp.total, 1), 0, cap);
  }
  // No trustworthy total → bounded, stage-based credit (honest: "we've reached the
  // importing stage of this source", not a fabricated record ratio). But a source can
  // sit in "fetching"/"importing" with ZERO rows committed yet, so until real records
  // exist we only grant a tiny "started" nudge — never a solid 20%/82% for nothing.
  const stageCredit = STAGE_FRACTION[source.stage];
  if (typeof stageCredit === 'number') {
    return retrieved > 0 ? stageCredit : Math.min(stageCredit, 0.05);
  }
  return state === 'running' ? 0.05 : 0;
}

/**
 * The single "dominant" activity across concurrently-streaming sources — the most
 * downstream stage currently in progress, which is what the user most wants to see.
 * Priority: importing > deduplicating/normalizing > fetching > finalizing > preparing.
 */
function dominantPhase(run, sources) {
  if (run.state === 'queued') return 'preparing';
  const anyStage = (names) => sources.some((s) => !TERMINAL_SOURCE_STATES.has(s.state) && names.includes(s.stage));
  if (anyStage(['importing'])) return 'adding';
  if (anyStage(['deduplicating', 'normalizing'])) return 'processing';
  if (anyStage(['fetching', 'counting', 'waiting', 'validating'])) return 'searching';
  const allSourcesDone = sources.length > 0 && sources.every((s) => TERMINAL_SOURCE_STATES.has(s.state));
  if (allSourcesDone) return 'finalizing';
  return 'preparing';
}

const PHASE_LABELS = {
  preparing: 'Preparing',
  searching: 'Searching databases',
  processing: 'Checking for duplicates',
  adding: 'Adding to Screening',
  finalizing: 'Finalizing',
  completed: 'Completed',
  partial: 'Completed with warnings',
  failed: 'Could not complete',
  cancelled: 'Cancelled',
};

/**
 * A compact, honest counts view for the UI. Aggregated from the per-source rows
 * because they are updated live per page — the run-level `counts` JSON is only
 * written at finalize (`{}` during a running poll), so relying on it would show 0s
 * for the whole run. Falls back to `run.counts` when no source rows are present
 * (e.g. a history list item, or an optimistic pre-seed stub).
 */
function summarizeCounts(run, sources) {
  if (sources.length) {
    let retrieved = 0; let imported = 0; let duplicates = 0; let existing = 0;
    let ambiguous = 0; let failed = 0; let normalized = 0;
    let sourcesDone = 0; let sourcesFailed = 0; let sourcesPartial = 0;
    for (const s of sources) {
      // Tolerate the leaner history-list source shape (`raw`/`imported`) too.
      retrieved += num(s.rawCount != null ? s.rawCount : s.raw);
      imported += num(s.importedCount != null ? s.importedCount : s.imported);
      duplicates += num(s.exactDupCount) + num(s.fuzzyDupCount);
      existing += num(s.existingMatchCount);
      ambiguous += num(s.ambiguousDupCount);
      failed += num(s.failedRecordCount);
      normalized += num(s.normalizedCount);
      if (TERMINAL_SOURCE_STATES.has(s.state)) sourcesDone += 1;
      if (s.state === 'failed') sourcesFailed += 1;
      if (s.state === 'partial') sourcesPartial += 1;
    }
    return { retrieved, imported, duplicates, existing, ambiguous, failed, normalized, sourcesDone, sourcesTotal: sources.length, sourcesFailed, sourcesPartial };
  }
  const c = run.counts || {};
  return {
    retrieved: num(c.rawRetrieved), imported: num(c.imported),
    duplicates: num(c.exactDup) + num(c.fuzzyDup), existing: num(c.existingMatched),
    ambiguous: num(c.ambiguousDup), failed: num(c.failedRecords), normalized: num(c.normalized),
    sourcesDone: num(c.sourcesCompleted) + num(c.sourcesFailed) + num(c.sourcesPartial),
    sourcesTotal: c.perSource ? Object.keys(c.perSource).length : 0,
    sourcesFailed: num(c.sourcesFailed), sourcesPartial: num(c.sourcesPartial),
  };
}

/** Localised integer with thousands separators, SSR-safe. */
function fmt(n) {
  const v = num(n);
  try { return v.toLocaleString(); } catch { return String(v); }
}

/**
 * The live one-sentence "current activity" text — reflects REAL backend work
 * (never a random rotating message). Uses the dominant phase + live counts, and
 * names the currently-fetching database with its own numbers when known.
 */
function activityFor(run, sources, phase, counts) {
  // All-skipped: every selected database was unavailable at run time — say so plainly
  // rather than the generic "failed" copy (deriveRunState reports this as 'failed').
  if (sources.length && sources.every((s) => s.state === 'skipped')) {
    return 'None of the selected databases were available to run this search. Ask an administrator to enable them, then try again.';
  }
  switch (run.state) {
    case 'completed':
      return counts.imported
        ? `Done — ${fmt(counts.imported)} new ${counts.imported === 1 ? 'record' : 'records'} added to Screening.`
        : 'Done — no new records to add (all were already in your project).';
    case 'partial':
      return `Finished with some databases incomplete — ${fmt(counts.imported)} ${counts.imported === 1 ? 'record' : 'records'} added to Screening.`;
    case 'failed':
      // A streaming run can land records page-by-page before a later page fails, so a
      // 'failed' run may still have imported some — never claim "nothing was added".
      return counts.imported
        ? `The search stopped early — ${fmt(counts.imported)} ${counts.imported === 1 ? 'record was' : 'records were'} already added to Screening. Retrying is safe and will not create duplicates.`
        : 'The search could not be completed. No records were added, so nothing was left half-saved.';
    case 'cancelled':
      return counts.imported
        ? `Search cancelled — ${fmt(counts.imported)} ${counts.imported === 1 ? 'record was' : 'records were'} already saved and kept.`
        : 'Search cancelled. No records were added.';
    default: break;
  }
  if (run.state === 'queued') return 'Preparing your search…';
  if (phase === 'searching') {
    // Name the source that is actively fetching with the largest remaining work.
    const fetching = sources.filter((s) => !TERMINAL_SOURCE_STATES.has(s.state) && (s.stage === 'fetching' || s.stage === 'counting'));
    const named = fetching[0];
    if (named) {
      const exp = expectedTotalFor(named);
      if (exp) return `Searching ${providerLabel(named.provider)} — ${fmt(named.rawCount)} of ${fmt(exp.total)} records`;
      return `Searching ${providerLabel(named.provider)} — ${fmt(named.rawCount)} records so far`;
    }
    return `Searching databases — ${fmt(counts.sourcesDone)} of ${fmt(counts.sourcesTotal)} complete`;
  }
  if (phase === 'processing') return `Checking ${fmt(counts.retrieved)} records for duplicates…`;
  if (phase === 'adding') return `Adding new records to Screening — ${fmt(counts.imported)} added so far`;
  if (phase === 'finalizing') return 'Finalizing your screening dataset…';
  return 'Preparing your search…';
}

/**
 * The run-level step narrative. Each step's status is driven by REAL signals so it is
 * never decorative. Steps stream concurrently (the pipeline interleaves fetch → dedup
 * → import per page across sources), so more than one may be "active" — the dominant
 * one carries the spinner (`dominant:true`).
 *
 * status ∈ 'waiting' | 'active' | 'done' | 'warning' | 'failed' | 'skipped'
 */
function buildSteps(run, sources, counts, phase) {
  const terminal = TERMINAL_RUN_STATES.has(run.state);
  const allSourcesDone = sources.length > 0 && sources.every((s) => TERMINAL_SOURCE_STATES.has(s.state));
  const anyStarted = run.state !== 'queued' || sources.some((s) => s.state !== 'pending');
  const retrieved = counts.retrieved;
  const dupSeen = counts.duplicates + counts.existing + counts.ambiguous;
  const hadFailure = run.state === 'failed';
  const hadWarning = run.state === 'partial' || counts.sourcesFailed > 0 || counts.sourcesPartial > 0 || counts.failed > 0;

  // Helper: resolve a streaming step's status from (started, done) signals.
  const streamStatus = (started, done) => {
    if (run.state === 'failed') return started ? 'failed' : 'waiting';
    if (done) return 'done';
    if (started) return 'active';
    return 'waiting';
  };

  const steps = [
    {
      id: 'prepare',
      label: 'Preparing search results',
      status: run.state === 'queued' ? 'active' : (anyStarted ? 'done' : 'waiting'),
      detail: sources.length ? `${fmt(sources.length)} database${sources.length === 1 ? '' : 's'} selected` : '',
    },
    {
      id: 'search',
      label: 'Searching databases',
      status: streamStatus(retrieved > 0 || sources.some((s) => s.stage === 'fetching' || TERMINAL_SOURCE_STATES.has(s.state)), allSourcesDone),
      detail: `${fmt(counts.sourcesDone)} of ${fmt(counts.sourcesTotal)} · ${fmt(retrieved)} retrieved`,
    },
    {
      id: 'dedup',
      label: 'Checking for duplicates',
      status: streamStatus(dupSeen > 0 || retrieved > 0, allSourcesDone),
      detail: `${fmt(counts.duplicates)} duplicate${counts.duplicates === 1 ? '' : 's'}, ${fmt(counts.existing)} already in project`,
    },
    {
      id: 'add',
      label: 'Adding records to Screening',
      status: streamStatus(counts.imported > 0 || sources.some((s) => s.stage === 'importing'), allSourcesDone),
      detail: `${fmt(counts.imported)} added`,
    },
    {
      id: 'finalize',
      label: 'Finalizing your screening dataset',
      status: terminal ? (hadFailure ? 'failed' : 'done') : (allSourcesDone ? 'active' : 'waiting'),
      detail: counts.ambiguous ? `${fmt(counts.ambiguous)} to review` : '',
    },
  ];

  // Layer a soft warning onto the search step for a partial/failed-source run, without
  // hiding that records still came through.
  if (hadWarning && !hadFailure) {
    const s = steps.find((x) => x.id === 'search');
    if (s && s.status === 'done') s.status = 'warning';
  }

  // Exactly one spinner: flag the dominant in-progress step.
  const dominantId = { preparing: 'prepare', searching: 'search', processing: 'dedup', adding: 'add', finalizing: 'finalize' }[phase];
  for (const s of steps) {
    s.dominant = !terminal && s.id === dominantId && (s.status === 'active');
  }
  return steps;
}

/** Per-source view for the expandable details table. */
function shapeSources(sources) {
  return sources.map((s) => {
    const exp = expectedTotalFor(s);
    const retrieved = num(s.rawCount);
    let percent = null;
    if (TERMINAL_SOURCE_STATES.has(s.state)) percent = 100;
    else if (exp) percent = Math.round(clamp(retrieved / Math.max(exp.total, 1), 0, 1) * 100);
    return {
      provider: s.provider,
      label: providerLabel(s.provider),
      state: s.state || 'pending',
      stage: s.stage || 'queued',
      retrieved,
      imported: num(s.importedCount),
      duplicates: num(s.exactDupCount) + num(s.fuzzyDupCount),
      existing: num(s.existingMatchCount),
      ambiguous: num(s.ambiguousDupCount),
      failed: num(s.failedRecordCount),
      expected: exp ? exp.total : null,
      expectedTrust: exp ? exp.trust : null,
      percent,
      capReached: !!s.capReached,
      retryCount: num(s.retryCount),
      error: s.errorDetail || '',
    };
  });
}

/**
 * computeRunProgress(run) — the single public entry point. `run` is a `shapeRun`
 * summary (or a partial optimistic stub). Returns the full progress model; pure and
 * side-effect free.
 */
export function computeRunProgress(run) {
  const r = run || {};
  const state = r.state || 'queued';
  const sources = Array.isArray(r.sources) ? r.sources : [];
  const terminal = TERMINAL_RUN_STATES.has(state);
  const counts = summarizeCounts(r, sources);
  const N = sources.length;

  // ── Honest percentage ──────────────────────────────────────────────────────
  let percent;
  let indeterminate = false;
  if (terminal) {
    percent = 100;
  } else if (N === 0) {
    // Run accepted but its per-source rows aren't visible yet (optimistic open, or the
    // brief window before the worker seeds them). Honest indeterminate with a small floor.
    percent = ACCEPTED_FLOOR;
    indeterminate = true;
  } else {
    const backbone = sources.reduce((acc, s) => acc + sourceFraction(s), 0) / N;
    percent = Math.round(backbone * 100);
    // Genuinely-nothing-yet window: running but no records and no known totals → we
    // cannot claim a number, so degrade to an honest indeterminate bar.
    const anySignal = counts.retrieved > 0
      || counts.sourcesDone > 0
      || sources.some((s) => expectedTotalFor(s) != null || (s.state === 'running' && s.stage && s.stage !== 'queued'));
    if (!anySignal) { indeterminate = true; percent = Math.max(percent, ACCEPTED_FLOOR); }
    percent = clamp(percent, ACCEPTED_FLOOR, NON_TERMINAL_CEILING);
  }

  const phase = terminal ? state : dominantPhase(r, sources);
  const steps = buildSteps(r, sources, counts, phase);

  return {
    state,
    terminal,
    percent,
    indeterminate,
    phase,
    phaseLabel: PHASE_LABELS[phase] || 'Working',
    activityText: activityFor(r, sources, phase, counts),
    steps,
    counts,
    sources: shapeSources(sources),
  };
}

/**
 * nextProgressPercent(prev, run) — the MONOTONIC display value the client should show.
 * The server's derived `percent` can wobble (estimate totals shrink, previewCount
 * arrives late, resume re-seeds counters), so the client clamps to a running max.
 *   • terminal run → always 100 (the authoritative finish).
 *   • otherwise → max(prev, derived), never exceeding the non-terminal ceiling.
 * `prev` may be null/undefined on the first sample.
 */
export function nextProgressPercent(prev, run) {
  const model = computeRunProgress(run);
  if (model.terminal) return 100;
  const floor = Number.isFinite(Number(prev)) ? Number(prev) : 0;
  return clamp(Math.max(floor, model.percent), 0, NON_TERMINAL_CEILING);
}
