/**
 * manifest.test.js — explicit-declaration validation, JSON manifest parsing, and
 * commit-footer parsing.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_SUMMARY,
  validateDeclaration,
  validateDeclarations,
  parseManifest,
  parseCommitFooters,
} from '../../../src/research-engine/engine-registry/manifest.js';

describe('validateDeclaration', () => {
  it('accepts a well-formed declaration (engine key)', () => {
    const r = validateDeclaration({ engine: 'screening', type: 'minor', summary: '  hello  ' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ engineId: 'screening', type: 'minor', summary: 'hello' });
  });
  it('accepts engineId key', () => {
    const r = validateDeclaration({ engineId: 'meta-analysis', type: 'major', summary: 'x' });
    expect(r.ok).toBe(true);
    expect(r.value.engineId).toBe('meta-analysis');
  });
  it('rejects unknown engine id', () => {
    const r = validateDeclaration({ engine: 'nope', type: 'minor', summary: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown engine id: nope/);
  });
  it('rejects invalid type', () => {
    const r = validateDeclaration({ engine: 'screening', type: 'patch', summary: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid change type/);
  });
  it('rejects missing / empty summary', () => {
    expect(validateDeclaration({ engine: 'screening', type: 'minor', summary: '' }).ok).toBe(false);
    expect(validateDeclaration({ engine: 'screening', type: 'minor', summary: '   ' }).ok).toBe(false);
    expect(validateDeclaration({ engine: 'screening', type: 'minor' }).ok).toBe(false);
    const r = validateDeclaration({ engine: 'screening', type: 'minor', summary: 5 });
    expect(r.error).toMatch(/non-empty summary/);
  });
  it('caps summary to MAX_SUMMARY', () => {
    const long = 'x'.repeat(MAX_SUMMARY + 50);
    const r = validateDeclaration({ engine: 'screening', type: 'minor', summary: long });
    expect(r.ok).toBe(true);
    expect(r.value.summary).toHaveLength(MAX_SUMMARY);
  });
});

describe('validateDeclarations', () => {
  it('validates a list and reports duplicates', () => {
    const r = validateDeclarations([
      { engine: 'screening', type: 'minor', summary: 'a' },
      { engine: 'screening', type: 'major', summary: 'b' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('duplicate declaration for engine: screening');
    // the first valid one is kept
    expect(r.declarations).toHaveLength(1);
  });
  it('collects per-item errors', () => {
    const r = validateDeclarations([
      { engine: 'nope', type: 'minor', summary: 'a' },
      { engine: 'screening', type: 'minor', summary: 'b' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.declarations).toHaveLength(1);
    expect(r.declarations[0].engineId).toBe('screening');
  });
  it('ok with empty list', () => {
    expect(validateDeclarations([])).toEqual({ ok: true, errors: [], declarations: [] });
  });
});

describe('parseManifest', () => {
  it('parses a valid { engineChanges: [...] }', () => {
    const r = parseManifest(JSON.stringify({
      engineChanges: [{ engine: 'screening', type: 'minor', summary: 'x' }],
    }));
    expect(r.ok).toBe(true);
    expect(r.declarations).toHaveLength(1);
    expect(r.declarations[0]).toEqual({ engineId: 'screening', type: 'minor', summary: 'x' });
  });
  it('accepts a bare array', () => {
    const r = parseManifest(JSON.stringify([{ engine: 'validation', type: 'major', summary: 'y' }]));
    expect(r.ok).toBe(true);
    expect(r.declarations[0].engineId).toBe('validation');
  });
  it('flags invalid engine id', () => {
    const r = parseManifest(JSON.stringify({ engineChanges: [{ engine: 'nope', type: 'minor', summary: 'x' }] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unknown engine/);
  });
  it('flags invalid type', () => {
    const r = parseManifest(JSON.stringify({ engineChanges: [{ engine: 'screening', type: 'huge', summary: 'x' }] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/invalid change type/);
  });
  it('flags missing summary', () => {
    const r = parseManifest(JSON.stringify({ engineChanges: [{ engine: 'screening', type: 'minor' }] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/summary/);
  });
  it('flags duplicate engine', () => {
    const r = parseManifest(JSON.stringify({
      engineChanges: [
        { engine: 'screening', type: 'minor', summary: 'a' },
        { engine: 'screening', type: 'minor', summary: 'b' },
      ],
    }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duplicate/);
  });
  it('non-JSON → error', () => {
    const r = parseManifest('{ not json');
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('manifest is not valid JSON');
  });
  it('empty {} → ok with 0 decls (valid no-op)', () => {
    const r = parseManifest('{}');
    expect(r).toEqual({ ok: true, declarations: [], errors: [] });
  });
  it('empty engineChanges → ok with 0 decls', () => {
    const r = parseManifest(JSON.stringify({ engineChanges: [] }));
    expect(r.ok).toBe(true);
    expect(r.declarations).toEqual([]);
  });
});

describe('parseCommitFooters', () => {
  it('parses a single commit message with footers', () => {
    const msg = [
      'feat: rework ranking',
      '',
      'Engine: network-meta-analysis',
      'Engine-Change: major',
      'Engine-Summary: Replace ranking model',
    ].join('\n');
    expect(parseCommitFooters(msg)).toEqual([
      { engine: 'network-meta-analysis', type: 'major', summary: 'Replace ranking model' },
    ]);
  });
  it('parses an array of commits → one decl each', () => {
    const decls = parseCommitFooters([
      'fix\n\nEngine: screening\nEngine-Change: minor\nEngine-Summary: tweak',
      'feat\n\nEngine: validation\nEngine-Change: major\nEngine-Summary: gate',
    ]);
    expect(decls).toEqual([
      { engine: 'screening', type: 'minor', summary: 'tweak' },
      { engine: 'validation', type: 'major', summary: 'gate' },
    ]);
  });
  it('groups multiple declarations within one message', () => {
    const msg = [
      'Engine: screening',
      'Engine-Change: minor',
      'Engine-Summary: a',
      'Engine: validation',
      'Engine-Change: major',
      'Engine-Summary: b',
    ].join('\n');
    expect(parseCommitFooters(msg)).toEqual([
      { engine: 'screening', type: 'minor', summary: 'a' },
      { engine: 'validation', type: 'major', summary: 'b' },
    ]);
  });
  it('is case-insensitive on keys and tolerant of whitespace', () => {
    const msg = '  engine:   screening  \n  ENGINE-CHANGE:  Minor \n Engine-Summary:   trimmed  ';
    expect(parseCommitFooters(msg)).toEqual([
      { engine: 'screening', type: 'minor', summary: 'trimmed' },
    ]);
  });
  it('ignores change/summary lines before any Engine: line', () => {
    const msg = 'Engine-Change: minor\nEngine-Summary: orphan';
    expect(parseCommitFooters(msg)).toEqual([]);
  });
  it('no footers → []', () => {
    expect(parseCommitFooters('just a normal commit message')).toEqual([]);
    expect(parseCommitFooters('')).toEqual([]);
  });
  it('parsed footers feed validateDeclarations cleanly', () => {
    const decls = parseCommitFooters('Engine: screening\nEngine-Change: minor\nEngine-Summary: ok');
    const r = validateDeclarations(decls);
    expect(r.ok).toBe(true);
    expect(r.declarations[0]).toEqual({ engineId: 'screening', type: 'minor', summary: 'ok' });
  });
});
