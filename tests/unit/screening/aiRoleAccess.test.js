/**
 * 89.md — unit tests for the Guided Screening authorization helpers + status trimming
 * (server/controllers/screeningAiController.js). Pure functions, no DB/HTTP: they
 * decide who is a project screening ADMINISTRATOR (leader / settings-manager / site
 * admin) and strip admin-grade fields from a regular user's status payload.
 */
import { describe, it, expect } from 'vitest';
import {
  isSiteAdmin, canConfigureAi, canRunAi, publicAiStatus,
} from '../../../server/controllers/screeningAiController.js';
import { stripAiInternals } from '../../../server/services/screeningAiService.js';

const reqWith = (role) => ({ user: role ? { role } : {} });
const access = (o = {}) => ({ isLeader: false, canManageSettings: false, canScreen: false, ...o });

describe('isSiteAdmin', () => {
  it('is true only for role admin', () => {
    expect(isSiteAdmin(reqWith('admin'))).toBe(true);
    expect(isSiteAdmin(reqWith('mod'))).toBe(false);
    expect(isSiteAdmin(reqWith('user'))).toBe(false);
    expect(isSiteAdmin(reqWith(null))).toBe(false);
    expect(isSiteAdmin({})).toBe(false);
  });
});

describe('canConfigureAi — who sees/operates the advanced Guided Screening surface', () => {
  it('allows project leaders', () => {
    expect(canConfigureAi(access({ isLeader: true }), reqWith('user'))).toBe(true);
  });
  it('allows settings-managers', () => {
    expect(canConfigureAi(access({ canManageSettings: true }), reqWith('user'))).toBe(true);
  });
  it('allows site admins even without a project role', () => {
    expect(canConfigureAi(access(), reqWith('admin'))).toBe(true);
  });
  it('DENIES a plain reviewer/member (canScreen only)', () => {
    expect(canConfigureAi(access({ canScreen: true }), reqWith('user'))).toBe(false);
  });
  it('DENIES a read-only collaborator', () => {
    expect(canConfigureAi(access(), reqWith('user'))).toBe(false);
  });
  it('DENIES a mod (not a site admin)', () => {
    expect(canConfigureAi(access({ canScreen: true }), reqWith('mod'))).toBe(false);
  });
});

describe('canRunAi — who can initiate scoring', () => {
  it('allows leaders regardless of the global toggle', () => {
    expect(canRunAi(access({ isLeader: true }), { allowReviewersToRun: false }, reqWith('user'))).toBe(true);
  });
  it('allows reviewers only when the admin enabled allowReviewersToRun', () => {
    expect(canRunAi(access({ canScreen: true }), { allowReviewersToRun: false }, reqWith('user'))).toBe(false);
    expect(canRunAi(access({ canScreen: true }), { allowReviewersToRun: true }, reqWith('user'))).toBe(true);
  });
  it('always allows a site admin member to run', () => {
    expect(canRunAi(access(), { allowReviewersToRun: false }, reqWith('admin'))).toBe(true);
  });
  it('DENIES a plain member who cannot screen', () => {
    expect(canRunAi(access(), { allowReviewersToRun: true }, reqWith('user'))).toBe(false);
  });
});

describe('publicAiStatus — the trimmed status a regular user receives', () => {
  const fullStatus = {
    enabled: true,
    scoreCount: 42,
    project: { enabled: true, blindFromAi: true, policy: 'prioritize', includeThreshold: 0.8, excludeThreshold: 0.2, engineConfigVersion: 'v3' },
    embedding: { provider: 'hosted', model: 'secret-model' },
    citation: { coverage: 0.5 },
    global: { allowReviewersToRun: true, requireHumanFinalDecision: true, embeddingProvider: 'hosted' },
    engineConfig: { activeLabel: 'cfg-7', catalogue: [{ id: 'a' }] },
    latestRun: { id: 'run1', mode: 'supervised', status: 'completed', completedAt: '2026-01-01', metrics: { auc: 0.91, wss95: 0.7 }, labelCounts: { include: 30 }, nFeatures: 5000, triggeredByName: 'Dr X' },
  };

  const pub = publicAiStatus(fullStatus, { canRun: true, stage: 'title_abstract' });

  it('keeps only the fields the simplified UI needs', () => {
    expect(pub).toEqual({
      enabled: true,
      canRun: true,
      canConfigure: false,
      stage: 'title_abstract',
      scoreCount: 42,
      project: { enabled: true, blindFromAi: true },
      latestRun: { mode: 'supervised', status: 'completed', completedAt: '2026-01-01' },
    });
  });

  it('strips ALL administrative / diagnostic fields', () => {
    expect(pub.embedding).toBeUndefined();
    expect(pub.citation).toBeUndefined();
    expect(pub.global).toBeUndefined();
    expect(pub.engineConfig).toBeUndefined();
    // latestRun metrics/labelCounts/nFeatures/triggeredByName must not leak.
    expect(pub.latestRun.metrics).toBeUndefined();
    expect(pub.latestRun.labelCounts).toBeUndefined();
    expect(pub.latestRun.nFeatures).toBeUndefined();
    expect(pub.latestRun.triggeredByName).toBeUndefined();
    // project thresholds/policy/engineConfigVersion must not leak.
    expect(pub.project.policy).toBeUndefined();
    expect(pub.project.includeThreshold).toBeUndefined();
    expect(pub.project.engineConfigVersion).toBeUndefined();
  });

  it('serialises to JSON with no admin fields anywhere', () => {
    const json = JSON.stringify(pub);
    for (const leak of ['auc', 'wss95', 'secret-model', 'cfg-7', 'allowReviewersToRun', 'includeThreshold', 'nFeatures', 'triggeredByName', 'catalogue']) {
      expect(json).not.toContain(leak);
    }
  });

  it('handles a not-yet-run project (no latestRun)', () => {
    const pub2 = publicAiStatus({ enabled: true, scoreCount: 0, project: { enabled: true, blindFromAi: false } }, { canRun: false, stage: 'title_abstract' });
    expect(pub2.latestRun).toBeNull();
    expect(pub2.scoreCount).toBe(0);
    expect(pub2.canRun).toBe(false);
  });
});

describe('stripAiInternals — server-side score trim for regular screeners', () => {
  const fullScore = {
    recordId: 'r1', score: 0.82, band: 'very_high', prediction: 'include',
    proba: 0.9, calibratedProba: 0.75, confidence: 0.7, uncertainty: 0.3,
    mode: 'supervised', picoMean: 0.6, lowConfidence: false, missingAbstract: false,
    subScores: { classifier: 0.8, semantic: 0.5 }, signals: { reviewer: { x: 1 } },
    explanation: { reasonsInclude: [{ text: 'ok' }], subScores: { classifier: 0.8 }, signals: { y: 2 }, picoBreakdown: [] },
    updatedAt: '2026-01-01',
  };

  it('keeps the fields a screener needs', () => {
    const t = stripAiInternals(fullScore);
    expect(t.score).toBe(0.82);
    expect(t.band).toBe('very_high');
    expect(t.prediction).toBe('include');
    expect(t.missingAbstract).toBe(false);
    expect(t.lowConfidence).toBe(false);
    // plain-language explanation survives
    expect(t.explanation.reasonsInclude).toEqual([{ text: 'ok' }]);
    expect(t.explanation.picoBreakdown).toEqual([]);
  });

  it('removes every model internal at the top level AND inside explanation', () => {
    const t = stripAiInternals(fullScore);
    for (const k of ['proba', 'calibratedProba', 'confidence', 'uncertainty', 'mode', 'picoMean', 'subScores', 'signals']) {
      expect(t[k]).toBeUndefined();
    }
    expect(t.explanation.subScores).toBeUndefined();
    expect(t.explanation.signals).toBeUndefined();
    const json = JSON.stringify(t);
    for (const leak of ['calibratedProba', 'subScores', 'confidence', 'uncertainty']) expect(json).not.toContain(leak);
  });

  it('does not mutate the input', () => {
    const copy = JSON.parse(JSON.stringify(fullScore));
    stripAiInternals(fullScore);
    expect(fullScore).toEqual(copy);
  });

  it('is null/undefined-safe', () => {
    expect(stripAiInternals(null)).toBeNull();
    expect(stripAiInternals(undefined)).toBeUndefined();
    expect(stripAiInternals({ score: 0.5 })).toEqual({ score: 0.5 });
  });
});
