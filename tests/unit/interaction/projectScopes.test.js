/**
 * projectScopes.test.js — 108.md §3/§15/§16. The pure stage → history-scope map
 * that keeps the three project shells addressing ONE history model, plus the
 * blob-backed set an autosave 409 invalidates.
 */
import { describe, it, expect } from 'vitest';
import {
  HISTORY_SCOPES, DEFAULT_SCOPE, SCOPE_SCREENING, SCOPE_SEARCH,
  historyScopeForStage, legacyTabScope, BLOB_SCOPES, isBlobScope,
} from '../../../src/research-engine/interaction/projectScopes.js';
import { TABS } from '../../../src/frontend/workspace/projectHelpers.js';
import { activeProjectStage } from '../../../src/frontend/stitch/nav/navConfig.js';

describe('historyScopeForStage — every real stage keeps its own stack', () => {
  it('is the identity for every workflow stage id', () => {
    for (const id of HISTORY_SCOPES) expect(historyScopeForStage(id)).toBe(id);
  });

  it('covers every tab the workspace can render (no stage silently shares overview)', () => {
    for (const t of TABS) {
      expect(HISTORY_SCOPES).toContain(t.id);
      expect(historyScopeForStage(t.id)).toBe(t.id);
    }
  });

  it('mirrors navConfig: ?tab=discovery normalizes to the search scope', () => {
    expect(activeProjectStage('?tab=discovery')).toBe('search');
    expect(historyScopeForStage('discovery')).toBe(SCOPE_SEARCH);
  });

  it('falls back to the overview scope for anything unknown or missing', () => {
    expect(historyScopeForStage('not-a-stage')).toBe(DEFAULT_SCOPE);
    expect(historyScopeForStage('')).toBe(DEFAULT_SCOPE);
    expect(historyScopeForStage(null)).toBe(DEFAULT_SCOPE);
    expect(historyScopeForStage(undefined)).toBe(DEFAULT_SCOPE);
    expect(historyScopeForStage(7)).toBe(DEFAULT_SCOPE);
    expect(historyScopeForStage({})).toBe(DEFAULT_SCOPE);
  });

  it('tolerates surrounding whitespace from a hand-edited URL', () => {
    expect(historyScopeForStage('  extraction ')).toBe('extraction');
  });

  it('agrees with what the Stitch shell derives from ?tab= for every stage', () => {
    for (const id of HISTORY_SCOPES) {
      expect(historyScopeForStage(activeProjectStage(`?tab=${id}`))).toBe(id);
    }
    // No `?tab=` at all is the project overview, not a crash.
    expect(historyScopeForStage(activeProjectStage(''))).toBe(DEFAULT_SCOPE);
  });
});

describe('legacyTabScope — the legacy monolith adapter (React state, not the URL)', () => {
  it('maps the monolith tab ids onto the SAME keys the Stitch shell uses', () => {
    for (const t of TABS) {
      expect(legacyTabScope(t.id)).toBe(historyScopeForStage(activeProjectStage(`?tab=${t.id}`)));
    }
  });

  it('normalizes the retired discovery tab exactly like the URL path does', () => {
    expect(legacyTabScope('discovery')).toBe(SCOPE_SEARCH);
  });
});

describe('the standalone /sift-beta scope', () => {
  it('is the same key the embedded screening stage uses', () => {
    expect(SCOPE_SCREENING).toBe('screening');
    expect(historyScopeForStage('screening')).toBe(SCOPE_SCREENING);
  });
});

describe('BLOB_SCOPES — what one autosave 409 invalidates (108.md §15)', () => {
  it('includes every stage whose mutations land in the Project.data blob', () => {
    for (const s of ['extraction', 'analysis', 'forest', 'sensitivity', 'subgroup',
      'manuscript', 'grade', 'report', 'prisma', 'rob', 'pico', 'prospero', 'control', 'nma']) {
      expect(isBlobScope(s)).toBe(true);
    }
  });

  it('EXCLUDES the relational screening scope and the search document scope', () => {
    // A blob CAS refusal says nothing about ScreenDecision rows or keyword ops, and
    // the Search Builder owns its own clear-on-remote-adoption rule.
    expect(isBlobScope('screening')).toBe(false);
    expect(isBlobScope('search')).toBe(false);
  });

  it('excludes the read-only / non-recording pages', () => {
    for (const s of ['overview', 'methods', 'history', 'living', 'citation']) {
      expect(isBlobScope(s)).toBe(false);
    }
  });

  it('is null-safe as a clearScopes predicate', () => {
    expect(isBlobScope(null)).toBe(false);
    expect(isBlobScope(undefined)).toBe(false);
    expect(isBlobScope('')).toBe(false);
  });

  it('never names a scope that is not a real stage', () => {
    for (const s of BLOB_SCOPES) expect(HISTORY_SCOPES).toContain(s);
  });
});
