/**
 * screeningAiAdminPolicy.test.js — se2.md Increment 1b.
 *
 * Pure unit tests for the AI Screening global-policy plumbing that backs the
 * relocated Ops → Screening → AI Policy panel:
 *   - coerceAiScreeningSettings: schema whitelist + clamping + injection defence,
 *     including the kill-switch / live-update fields Increment 1 forgot to persist.
 *   - diffAiScreeningSettings: before→after audit map ("what changed").
 *   - applyKillSwitch: emergency override (kill switch forces enabled=false).
 *
 * No DB / network: all three functions are pure.
 */
import { describe, it, expect } from 'vitest';
import {
  coerceAiScreeningSettings,
  diffAiScreeningSettings,
} from '../../server/controllers/screeningAiAdminController.js';
import { applyKillSwitch, AI_GLOBAL_DEFAULTS } from '../../server/services/screeningAiService.js';

const base = () => ({ ...AI_GLOBAL_DEFAULTS });

describe('coerceAiScreeningSettings', () => {
  it('keeps current values when the patch is empty', () => {
    const cur = base();
    expect(coerceAiScreeningSettings({}, cur)).toEqual(cur);
  });

  it('drops unknown keys (injection defence)', () => {
    const out = coerceAiScreeningSettings({ __proto__: { polluted: true }, hacker: 1, enabled: false }, base());
    expect(out.hacker).toBeUndefined();
    expect(out.polluted).toBeUndefined();
    expect(out.enabled).toBe(false);
  });

  it('ignores wrong-typed values', () => {
    const cur = base();
    const out = coerceAiScreeningSettings({ enabled: 'yes', killSwitch: 'on', requireHumanFinalDecision: 1 }, cur);
    expect(out.enabled).toBe(cur.enabled);
    expect(out.killSwitch).toBe(cur.killSwitch);
    expect(out.requireHumanFinalDecision).toBe(cur.requireHumanFinalDecision);
  });

  it('only accepts known providers and policies', () => {
    const cur = base();
    expect(coerceAiScreeningSettings({ embeddingProvider: 'gpt4' }, cur).embeddingProvider).toBe(cur.embeddingProvider);
    expect(coerceAiScreeningSettings({ embeddingProvider: 'hosted' }, cur).embeddingProvider).toBe('hosted');
    expect(coerceAiScreeningSettings({ defaultPolicy: 'delete_all' }, cur).defaultPolicy).toBe(cur.defaultPolicy);
    expect(coerceAiScreeningSettings({ defaultPolicy: 'prioritize' }, cur).defaultPolicy).toBe('prioritize');
  });

  it('clamps numeric fields to safe bounds', () => {
    const cur = base();
    expect(coerceAiScreeningSettings({ maxRecordsPerRun: 9_999_999 }, cur).maxRecordsPerRun).toBe(100000);
    expect(coerceAiScreeningSettings({ maxRecordsPerRun: 1 }, cur).maxRecordsPerRun).toBe(10);
    expect(coerceAiScreeningSettings({ includeThreshold: 5 }, cur).includeThreshold).toBe(1);
    expect(coerceAiScreeningSettings({ excludeThreshold: -2 }, cur).excludeThreshold).toBe(0);
    expect(coerceAiScreeningSettings({ retrainDebounceMs: 10 }, cur).retrainDebounceMs).toBe(500);
    expect(coerceAiScreeningSettings({ retrainDebounceMs: 9_000_000 }, cur).retrainDebounceMs).toBe(60000);
  });

  it('persists the kill-switch + live-update fields (the Increment 1 gap)', () => {
    const out = coerceAiScreeningSettings(
      { killSwitch: true, liveUpdateEnabled: false, retrainDebounceMs: 8000 },
      base(),
    );
    expect(out.killSwitch).toBe(true);
    expect(out.liveUpdateEnabled).toBe(false);
    expect(out.retrainDebounceMs).toBe(8000);
  });

  it('tolerates a non-object patch', () => {
    const cur = base();
    expect(coerceAiScreeningSettings(null, cur)).toEqual(cur);
    expect(coerceAiScreeningSettings('nope', cur)).toEqual(cur);
  });

  it('round-trip: clearing the kill switch preserves stored enabled (no clobber)', () => {
    // The PUT handler baselines on getRawGlobalAiSettings (NOT the kill-switch-overridden
    // value), so toggling killSwitch off without touching `enabled` must keep enabled=true.
    const raw = { ...base(), enabled: true, killSwitch: true };
    const next = coerceAiScreeningSettings({ killSwitch: false }, raw);
    expect(next.enabled).toBe(true);
    expect(next.killSwitch).toBe(false);
    // and the engine-effective view is now enabled again:
    expect(applyKillSwitch(next).enabled).toBe(true);
  });
});

describe('diffAiScreeningSettings', () => {
  it('returns an empty map when nothing changed', () => {
    expect(diffAiScreeningSettings(base(), base())).toEqual({});
  });

  it('records before→after for each changed key only', () => {
    const cur = base();
    const next = { ...cur, enabled: !cur.enabled, killSwitch: true };
    const d = diffAiScreeningSettings(cur, next);
    expect(d).toEqual({
      enabled: { from: cur.enabled, to: next.enabled },
      killSwitch: { from: cur.killSwitch, to: true },
    });
  });
});

describe('applyKillSwitch', () => {
  it('forces enabled=false when the kill switch is on', () => {
    const out = applyKillSwitch({ ...base(), enabled: true, killSwitch: true });
    expect(out.enabled).toBe(false);
  });

  it('leaves enabled untouched when the kill switch is off', () => {
    const out = applyKillSwitch({ ...base(), enabled: true, killSwitch: false });
    expect(out.enabled).toBe(true);
  });

  it('does not mutate its input (pure)', () => {
    const input = { ...base(), enabled: true, killSwitch: true };
    const snapshot = { ...input };
    applyKillSwitch(input);
    expect(input).toEqual(snapshot);
  });
});
