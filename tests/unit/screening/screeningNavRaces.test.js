/**
 * screeningNavRaces.test.js — 107.md rec: the three list-navigation races in
 * ScreeningTab that only exist in the wiring, not in any pure helper.
 *
 *   1. an arrow keystroke fired during an in-flight RESET load issued an append
 *      computed from the pre-reset page, merging two different queries into one array;
 *   2. a deferred auto-advance resolved against whatever load finished first, so a
 *      mid-flight project/filter switch selected a record from the previous dataset;
 *   3. the nearest-scroll pass re-ran one commit after the Resume one-shot and wrote
 *      `scrollTop` into its running smooth `block:'center'` animation, cancelling it.
 *
 * The decisions themselves live in unit-tested pure helpers (`moveIntent`,
 * `advanceContextMatches`, `nearestScrollTop`). What cannot be executed hermetically —
 * the repo has no jsdom, and SSR runs no effects — is whether the component still FEEDS
 * them the right inputs. These are string assertions over the source, in the style of
 * tests/unit/adminVisibility.test.js: cheap, and they fail loudly on the exact
 * regressions above rather than on incidental reformatting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(
  new URL('../../../src/frontend/screening/tabs/ScreeningTab.jsx', import.meta.url), 'utf8',
);

/* ── 1. concurrent pagination during a reset ──────────────────────────────────── */

describe('moveSelection counts an in-flight RESET as loading', () => {
  it('threads `loading` into the nav context and into moveIntent', () => {
    expect(SRC).toMatch(/navCtxRef\.current\s*=\s*\{[^}]*\bloading\b[^}]*\}/);
    // 109.md §36 — `blockNavigationWhileLoading` made the swallow configurable, so the
    // in-flight input is assembled one line earlier. The REQUEST LOCK stays
    // unconditional (only the busy/resetting half sits behind the setting), and
    // moveIntent still receives the combined value.
    expect(SRC).toMatch(/const\s+inFlight\s*=\s*advanceLockRef\.current\s*\|\|\s*\(blockWhileLoading\s*&&\s*\(busy\s*\|\|\s*resetting\)\)/);
    expect(SRC).toMatch(/loadingMore:\s*inFlight/);
  });

  it('does not fall back to the loadingMore-only check', () => {
    expect(SRC).not.toMatch(/loadingMore:\s*busy\s*\|\|\s*advanceLockRef\.current/);
  });
});

/* ── 1b. cross-query merges: the load generation ──────────────────────────────── */

describe('load generation discards a superseded append', () => {
  it('bumps the generation on every reset and captures it per request', () => {
    expect(SRC).toMatch(/const\s+loadGenRef\s*=\s*useRef\(0\)/);
    expect(SRC).toMatch(/const\s+gen\s*=\s*reset\s*\?\s*\(loadGenRef\.current\s*\+=\s*1\)\s*:\s*loadGenRef\.current/);
  });

  it('drops a non-reset response whose generation moved, BEFORE merging it', () => {
    expect(SRC).toMatch(/if\s*\(!reset\s*&&\s*gen\s*!==\s*loadGenRef\.current\)\s*return\s+false;/);
    const guardAt = SRC.indexOf('if (!reset && gen !== loadGenRef.current) return false;');
    const mergeAt = SRC.indexOf('recordsRef.current = reset ? recs');
    const setAt = SRC.indexOf('setRecords(recordsRef.current);');
    expect(guardAt).toBeGreaterThan(-1);
    expect(mergeAt).toBeGreaterThan(guardAt);   // no splice of foreign rows
    expect(setAt).toBeGreaterThan(guardAt);     // and no setRecords/setPage either
  });
});

/* ── 2. the deferred auto-advance is scoped to its dataset ────────────────────── */

describe('pendingAdvance is stamped with, and checked against, its dataset', () => {
  it('stamps pid + filter + search + generation at arm time', () => {
    expect(SRC).toMatch(
      /pendingAdvanceRef\.current\s*=\s*\{[\s\S]{0,240}?\bpid\b[\s\S]{0,240}?filter:\s*filterRef\.current[\s\S]{0,240}?search:\s*searchRef\.current[\s\S]{0,240}?gen:\s*loadGenRef\.current/,
    );
    // The unscoped shape (a bare id Set) must not come back.
    expect(SRC).not.toMatch(/pendingAdvanceRef\.current\s*=\s*\{\s*seen:\s*new Set\(recs\.map\(r\s*=>\s*r\.id\)\)\s*\}/);
  });

  it('drops the advance without selecting when the stamp no longer matches', () => {
    expect(SRC).toMatch(/advanceContextMatches\(pend,\s*\{/);
    // The guard runs before the selection, not after it.
    const guardAt = SRC.indexOf('if (!advanceContextMatches(pend, {');
    const selectAt = SRC.indexOf('const next = displayRecords.find(r => !pend.seen.has(r.id));');
    expect(guardAt).toBeGreaterThan(-1);
    expect(selectAt).toBeGreaterThan(guardAt);
  });

  it('scrubs the advance on a project switch (the [pid] reset effect)', () => {
    expect(SRC).toMatch(/pendingAdvanceRef\.current\s*=\s*null;\s*advanceLockRef\.current\s*=\s*false;/);
    // …in the [pid] effect specifically, i.e. before loadRecords' first reset.
    const scrubAt = SRC.indexOf('pendingAdvanceRef.current = null; advanceLockRef.current = false;');
    const firstLoadAt = SRC.indexOf("loadRecords({ reset: true, s: '', f: 'all' });");
    expect(scrubAt).toBeGreaterThan(-1);
    expect(firstLoadAt).toBeGreaterThan(scrubAt);
  });
});

/* ── 3. the Resume one-shot owns its scroll ───────────────────────────────────── */

describe('the Resume smooth scroll is not cancelled by the nearest-scroll pass', () => {
  it('hands the selection to the nav refs before clearing the one-shot flag', () => {
    expect(SRC).toMatch(/if\s*\(centred\)\s*\{\s*navSelRef\.current\s*=\s*selectedId;\s*navPendingRef\.current\s*=\s*false;\s*\}/);
    const claimAt = SRC.indexOf('if (centred) { navSelRef.current = selectedId; navPendingRef.current = false; }');
    const clearAt = SRC.indexOf('if (onScrolledToSelected) onScrolledToSelected();');
    expect(claimAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(claimAt);
  });

  it('only claims ownership when it actually scrolled the row', () => {
    // The windowed/unmounted branch returns early and keeps the flag set, so the next
    // pass still centres the row; claiming there would strand it edge-aligned.
    expect(SRC).toMatch(/let\s+centred\s*=\s*false;/);
    expect(SRC).toMatch(/behavior:\s*'smooth'\s*\}\)[\s\S]{0,80}?centred\s*=\s*true;/);
  });

  it('declares the shared nav refs above BOTH effects that touch them', () => {
    const declAt = SRC.indexOf('const navSelRef = useRef(null);');
    const resumeEffectAt = SRC.indexOf("try { row.scrollIntoView({ block: 'center', behavior: 'smooth' });");
    expect(declAt).toBeGreaterThan(-1);
    expect(resumeEffectAt).toBeGreaterThan(declAt);
  });
});

/* ── 4. the sticky "Load more" bar is subtracted from the usable viewport ─────── */

describe('nearest-scroll accounts for the sticky Load-more bar', () => {
  it('measures the bar with a ref and passes it as insetBottom', () => {
    expect(SRC).toMatch(/const\s+loadMoreRef\s*=\s*useRef\(null\)/);
    expect(SRC).toMatch(/<div ref=\{loadMoreRef\}[^>]*data-testid="screening-load-more"/);
    expect(SRC).toMatch(
      /const\s+insetBottom\s*=\s*\(hasMore\s*&&\s*loadMoreRef\.current\)\s*\?\s*\(loadMoreRef\.current\.offsetHeight\s*\|\|\s*0\)\s*:\s*0;/,
    );
  });

  it('applies the inset on BOTH the measured and the windowed-estimate paths', () => {
    const uses = SRC.match(/nearestScrollTop\(\{[\s\S]*?\}\)/g) || [];
    expect(uses.length).toBe(2);
    for (const call of uses) expect(call, call).toContain('insetBottom');
  });
});
