/**
 * workflowState.test.js — pure concurrency core of the server-backed module
 * state service (prompt38). The DB-touching paths are covered by the integration
 * suite; here we lock the merge/conflict/whitelist logic.
 */
import { describe, it, expect } from 'vitest';
import {
  mergePatch, isStale, safeParse, isValidModuleKey, MODULE_KEYS, MODULE_AUDIT_ACTION,
} from '../../server/services/workflowState.js';

describe('mergePatch (shallow, conflict-safe)', () => {
  it('replaces only the named top-level keys', () => {
    expect(mergePatch({ a: 1, b: 2 }, { b: 9 })).toEqual({ a: 1, b: 9 });
  });
  it('adds new keys without dropping existing ones', () => {
    expect(mergePatch({ a: 1 }, { c: 3 })).toEqual({ a: 1, c: 3 });
  });
  it('ignores a non-object / array patch (never clobbers)', () => {
    expect(mergePatch({ a: 1 }, null)).toEqual({ a: 1 });
    expect(mergePatch({ a: 1 }, [1, 2])).toEqual({ a: 1 });
    expect(mergePatch(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});

describe('isStale (optimistic concurrency)', () => {
  it('null/undefined base opts out of the check', () => {
    expect(isStale(null, 5)).toBe(false);
    expect(isStale(undefined, 5)).toBe(false);
  });
  it('matching revision is fresh; mismatch is stale', () => {
    expect(isStale(5, 5)).toBe(false);
    expect(isStale(4, 5)).toBe(true);
    expect(isStale(6, 5)).toBe(true);
  });
  it('compares strictly — a bogus non-integer type is treated as stale (defense in depth)', () => {
    // The controller already rejects non-integers; isStale never coerces, so a
    // bad type can never coincidentally pass the conflict check.
    expect(isStale('5', 5)).toBe(true);
    expect(isStale(true, 5)).toBe(true);
  });
});

describe('safeParse', () => {
  it('parses objects, defaults to {} on junk/non-object', () => {
    expect(safeParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeParse('not json')).toEqual({});
    expect(safeParse('[1,2]')).toEqual({}); // arrays are not module states
    expect(safeParse('5')).toEqual({});
  });
});

describe('module key whitelist', () => {
  it('accepts whitelisted keys, rejects arbitrary ones', () => {
    expect(isValidModuleKey('protocol')).toBe(true);
    expect(isValidModuleKey('project_control')).toBe(true);
    expect(isValidModuleKey('planProtocol')).toBe(true); // prompt46 #1 — Plan & Protocol engine
    expect(isValidModuleKey('__proto__')).toBe(false);
    expect(isValidModuleKey('arbitrary')).toBe(false);
    expect(isValidModuleKey('')).toBe(false);
  });
  it('every whitelisted key has an audit action', () => {
    for (const k of MODULE_KEYS) expect(typeof MODULE_AUDIT_ACTION[k]).toBe('string');
  });
});
