/**
 * 89/90.md — handler-level authorization WIRING tests for the Guided Screening
 * controller. The pure helpers (canConfigureAi / publicAiStatus / stripAiInternals)
 * are unit-tested separately; this file proves the HANDLERS actually call them — i.e.
 * a regular reviewer hitting an administrative endpoint directly gets 403, an admin or
 * project leader is allowed through, and GET /ai/status is trimmed for regular users.
 * All dependencies are mocked → hermetic, no DB / HTTP.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../server/screening/access.js', () => ({
  getProjectAccess: vi.fn(),
  writeAudit: vi.fn(),
}));
vi.mock('../../../server/services/screeningAiService.js', () => ({
  aiFlagEnabled: vi.fn(async () => true),
  getGlobalAiSettings: vi.fn(async () => ({ enabled: true, allowReviewersToRun: false })),
  getProjectAiSettings: vi.fn(() => ({ enabled: true, blindFromAi: false, policy: 'assist', minScreenedDecisions: 50 })),
  getStatus: vi.fn(async () => ({
    enabled: true, scoreCount: 3,
    project: { enabled: true, blindFromAi: false, policy: 'prioritize', includeThreshold: 0.8, engineConfigVersion: 'v3' },
    global: { allowReviewersToRun: true, requireHumanFinalDecision: true },
    engineConfig: { activeLabel: 'cfg-7', catalogue: [{ id: 'a' }] },
    embedding: { provider: 'hosted', model: 'secret-model' },
    latestRun: { mode: 'supervised', status: 'completed', metrics: { auc: 0.91 }, labelCounts: { include: 30 } },
  })),
  getValidation: vi.fn(async () => ({ metrics: { auc: 0.9 } })),
  listModelVersions: vi.fn(async () => [{ id: 'v1' }, { id: 'v2' }]),
  getValidationSampleStatus: vi.fn(async () => ({ sample: null })),
  getScoresMap: vi.fn(async () => ({})),
  getRecordExplanation: vi.fn(async () => null),
  recordFeedback: vi.fn(async () => ({ id: 'f1' })),
  rollbackToRun: vi.fn(async () => ({ run: { id: 'r' }, scoredCount: 1 })),
  createValidationSample: vi.fn(async () => ({ ok: true })),
  stripAiInternals: (x) => x,
}));
vi.mock('../../../server/services/citationEnrichmentService.js', () => ({ getCitationStatus: vi.fn(async () => ({ coverage: 0.5 })) }));
vi.mock('../../../server/services/entitlementService.js', () => ({ requireEntitlement: vi.fn(async () => {}), sendTierLimit: vi.fn(() => false) }));
vi.mock('../../../server/services/screeningAiJobs.js', () => ({
  getJobStatus: vi.fn(async () => ({ state: 'idle' })),
  enqueueManualRun: vi.fn(async () => ({ id: 'j', status: 'queued' })),
  enqueueCitationEnrichment: vi.fn(async () => ({ id: 'j', status: 'queued' })),
}));
vi.mock('../../../server/realtime/bus.js', () => ({ emitToProjectMembers: vi.fn() }));
vi.mock('../../../server/db/client.js', () => ({
  prisma: {
    screenProject: { findUnique: vi.fn(async () => ({ id: 'p', aiSettings: '{}' })), update: vi.fn(async () => ({})) },
    screenDecision: { findMany: vi.fn(async () => []) },
  },
}));

import {
  getAiValidation, getAiModelVersions, postAiRollback, putAiSettings,
  getAiCitationStatus, getAiValidationSample, postAiValidationSample, getAiStatus,
} from '../../../server/controllers/screeningAiController.js';
import { getProjectAccess } from '../../../server/screening/access.js';

const mkRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const mkReq = (role = 'user') => ({ params: { pid: 'p1', rid: 'rec1' }, user: { id: 'u1', role }, query: {}, body: { runId: 'run1', size: 100 } });

const REVIEWER = { isLeader: false, canManageSettings: false, canScreen: true };
const LEADER = { isLeader: true, canManageSettings: true, canScreen: true };
const NON_MEMBER_ADMIN = { isLeader: false, canManageSettings: false, canScreen: false };

// Every administrative handler that must be site-admin/leader-only.
const ADMIN_HANDLERS = [
  ['getAiValidation', getAiValidation],
  ['getAiModelVersions', getAiModelVersions],
  ['postAiRollback', postAiRollback],
  ['putAiSettings', putAiSettings],
  ['getAiCitationStatus', getAiCitationStatus],
  ['getAiValidationSample', getAiValidationSample],
  ['postAiValidationSample', postAiValidationSample],
];

beforeEach(() => { vi.clearAllMocks(); });

describe('administrative endpoints reject a regular reviewer (403)', () => {
  for (const [name, handler] of ADMIN_HANDLERS) {
    it(`${name} → 403 for a reviewer (canScreen, not leader, role user)`, async () => {
      getProjectAccess.mockResolvedValue(REVIEWER);
      const res = mkRes();
      await handler(mkReq('user'), res);
      expect(res.statusCode).toBe(403);
      expect(res.body?.error).toBeTruthy();
    });
  }
});

describe('administrative endpoints allow a project leader', () => {
  for (const [name, handler] of ADMIN_HANDLERS) {
    it(`${name} → not 403 for a leader`, async () => {
      getProjectAccess.mockResolvedValue(LEADER);
      const res = mkRes();
      await handler(mkReq('user'), res);
      expect(res.statusCode).not.toBe(403);
    });
  }
});

describe('administrative endpoints allow a site admin (role admin)', () => {
  for (const [name, handler] of ADMIN_HANDLERS) {
    it(`${name} → not 403 for a site admin member`, async () => {
      getProjectAccess.mockResolvedValue(NON_MEMBER_ADMIN);
      const res = mkRes();
      await handler(mkReq('admin'), res);
      expect(res.statusCode).not.toBe(403);
    });
  }
});

describe('a mod (role mod) who is only a reviewer is still a regular user', () => {
  for (const [name, handler] of ADMIN_HANDLERS) {
    it(`${name} → 403 for a mod reviewer`, async () => {
      getProjectAccess.mockResolvedValue(REVIEWER);
      const res = mkRes();
      await handler(mkReq('mod'), res);
      expect(res.statusCode).toBe(403);
    });
  }
});

describe('GET /ai/status is trimmed for a regular user, full for an administrator', () => {
  it('reviewer gets a metrics-free status (canConfigure false, no admin fields)', async () => {
    getProjectAccess.mockResolvedValue(REVIEWER);
    const res = mkRes();
    await getAiStatus(mkReq('user'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.canConfigure).toBe(false);
    expect(res.body.global).toBeUndefined();
    expect(res.body.engineConfig).toBeUndefined();
    expect(res.body.embedding).toBeUndefined();
    expect(res.body.latestRun?.metrics).toBeUndefined();
    expect(res.body.project?.policy).toBeUndefined();
    const json = JSON.stringify(res.body);
    for (const leak of ['auc', 'secret-model', 'cfg-7', 'allowReviewersToRun', 'engineConfigVersion']) {
      expect(json).not.toContain(leak);
    }
    // ...but the screener still gets what they need
    expect(res.body.enabled).toBe(true);
    expect(res.body.canRun).toBe(false); // reviewer, allowReviewersToRun off
  });

  it('leader gets the full status with metrics + config', async () => {
    getProjectAccess.mockResolvedValue(LEADER);
    const res = mkRes();
    await getAiStatus(mkReq('user'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.canConfigure).toBe(true);
    expect(res.body.global).toBeTruthy();
    expect(res.body.engineConfig).toBeTruthy();
    expect(res.body.latestRun?.metrics?.auc).toBe(0.91);
  });

  it('404s (feature-off / no access) before any role check', async () => {
    getProjectAccess.mockResolvedValue(null);
    const res = mkRes();
    await getAiStatus(mkReq('user'), res);
    expect(res.statusCode).toBe(404);
  });
});
