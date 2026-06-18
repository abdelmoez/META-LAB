/**
 * onboardingController.js — prompt32 Task 6/7.
 *
 * Generic, ops-managed onboarding questions with PER-QUESTION, PER-USER state.
 * The legacy `User.onboardingCompletedAt` + 5 fixed profile columns are preserved
 * for analytics/back-compat; this layer adds `OnboardingQuestion` (admin-authored)
 * + `UserOnboardingResponse` (answered|skipped per user) so that:
 *   - a NEW active question automatically appears for already-registered users on
 *     their next login (pending = active questions with no response row), and
 *   - answered/skipped questions never reappear (unless an admin resets them).
 *
 * NEVER blocks app access on error — onboarding is best-effort by design.
 */
import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import {
  PRIMARY_ROLE_OPTIONS,
  RESEARCH_FIELD_OPTIONS,
  MAIN_USE_CASE_OPTIONS,
} from '../../src/shared/editableUserFields.js';

const QUESTION_TYPES = new Set(['text', 'single_select', 'multi_select', 'boolean', 'number', 'date']);

// Known canonical question keys → legacy User column, so answering a seeded
// question keeps feeding the existing Ops Users analytics (byPrimaryRole, …).
const LEGACY_FIELD_MAP = {
  primary_role: 'primaryRole',
  research_field: 'researchField',
  main_use_case: 'mainUseCase',
  country: 'country',
};

function toOptionObjects(values) {
  return (values || []).filter(v => v && v !== '').map(v => ({ value: v, label: v }));
}

// The 3 legacy select questions, seeded once so behaviour is unchanged on first deploy.
const SEED_QUESTIONS = [
  {
    key: 'primary_role',
    prompt: 'What is your primary role?',
    description: 'Helps us tailor templates and defaults to how you work.',
    type: 'single_select',
    options: toOptionObjects(PRIMARY_ROLE_OPTIONS),
    isRequired: false,
    allowSkip: true,
    displayOrder: 10,
  },
  {
    key: 'research_field',
    prompt: 'What is your main research field?',
    description: null,
    type: 'single_select',
    options: toOptionObjects(RESEARCH_FIELD_OPTIONS),
    isRequired: false,
    allowSkip: true,
    displayOrder: 20,
  },
  {
    key: 'main_use_case',
    prompt: 'What will you mainly use META·LAB for?',
    description: null,
    type: 'single_select',
    options: toOptionObjects(MAIN_USE_CASE_OPTIONS),
    isRequired: false,
    allowSkip: true,
    displayOrder: 30,
  },
];

/**
 * Seed the canonical onboarding questions (idempotent — upsert by key, never
 * overwrites an admin's edits). Called best-effort at startup.
 */
export async function seedOnboardingQuestions() {
  try {
    for (const q of SEED_QUESTIONS) {
      await prisma.onboardingQuestion.upsert({
        where: { key: q.key },
        update: {}, // never clobber admin edits
        create: {
          key: q.key,
          prompt: q.prompt,
          description: q.description,
          type: q.type,
          options: q.options ? JSON.stringify(q.options) : null,
          isActive: true,
          isRequired: q.isRequired,
          allowSkip: q.allowSkip,
          displayOrder: q.displayOrder,
        },
      });
    }
    console.log('[onboarding] Canonical onboarding questions seeded.');
  } catch (err) {
    console.error('[onboarding] seed failed:', err.message);
  }
}

function parseOptions(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr
      .map(o => (typeof o === 'string' ? { value: o, label: o } : { value: o?.value, label: o?.label || o?.value }))
      .filter(o => o.value != null && o.value !== '');
  } catch {
    return [];
  }
}

// Shape a question row for the client (options parsed; no internal-only fields).
function publicQuestion(q) {
  return {
    id: q.id,
    key: q.key,
    prompt: q.prompt,
    description: q.description || '',
    type: q.type,
    options: parseOptions(q.options),
    isRequired: q.isRequired,
    allowSkip: q.allowSkip && !q.isRequired,
    displayOrder: q.displayOrder,
  };
}

async function isOnboardingEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'onboardingSettings' } });
    if (!row) return true; // default ON
    const s = JSON.parse(row.value || '{}');
    return s.enabled !== false;
  } catch {
    return true;
  }
}

/**
 * Compute the active questions this user has NOT yet answered or skipped.
 */
async function computePending(userId) {
  if (!(await isOnboardingEnabled())) return [];
  const [active, responded] = await Promise.all([
    prisma.onboardingQuestion.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } }),
    prisma.userOnboardingResponse.findMany({ where: { userId }, select: { questionId: true } }),
  ]);
  const seen = new Set(responded.map(r => r.questionId));
  return active.filter(q => !seen.has(q.id)).map(publicQuestion);
}

// ── GET /api/onboarding/pending (requireAuth) ──────────────────────────────────
export async function getPending(req, res) {
  try {
    const questions = await computePending(req.user.id);
    let intro = { title: '', body: '' };
    try {
      const row = await prisma.siteSetting.findUnique({ where: { key: 'onboardingSettings' } });
      if (row) {
        const s = JSON.parse(row.value || '{}');
        intro = { title: s.introTitle || '', body: s.introBody || '' };
      }
    } catch { /* keep defaults */ }
    return res.json({ questions, intro });
  } catch (err) {
    // Never block app entry on an onboarding read failure.
    console.error('[onboarding] getPending error:', err.message);
    return res.json({ questions: [], intro: { title: '', body: '' } });
  }
}

// Pure helper (unit-testable): given active questions + the set of question ids
// this user has already responded to (answered OR skipped), return the pending list.
export function pendingFromQuestions(activeQuestions, respondedIds) {
  const seen = respondedIds instanceof Set ? respondedIds : new Set(respondedIds || []);
  return (activeQuestions || [])
    .filter(q => q && q.isActive !== false && !seen.has(q.id))
    .map(publicQuestion);
}

// Validate + normalize an answer against its question. Returns { ok, value, error }.
export function validateAnswer(question, raw) {
  const opts = parseOptions(question.options).map(o => String(o.value));
  switch (question.type) {
    case 'text': {
      const s = raw == null ? '' : String(raw).trim().slice(0, 2000);
      if (question.isRequired && !s) return { ok: false, error: 'required' };
      return { ok: true, value: s };
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return question.isRequired ? { ok: false, error: 'required' } : { ok: true, value: null };
      return { ok: true, value: n };
    }
    case 'boolean':
      return { ok: true, value: raw === true || raw === 'true' };
    case 'date': {
      const s = raw == null ? '' : String(raw).trim().slice(0, 40);
      return { ok: true, value: s || null };
    }
    case 'single_select': {
      const s = raw == null ? '' : String(raw).trim();
      if (!s) return question.isRequired ? { ok: false, error: 'required' } : { ok: true, value: null };
      if (opts.length && !opts.includes(s)) return { ok: false, error: 'invalid option' };
      return { ok: true, value: s };
    }
    case 'multi_select': {
      const arr = Array.isArray(raw) ? raw.map(v => String(v).trim()) : (raw ? [String(raw).trim()] : []);
      const cleaned = opts.length ? arr.filter(v => opts.includes(v)) : arr;
      if (question.isRequired && !cleaned.length) return { ok: false, error: 'required' };
      return { ok: true, value: cleaned };
    }
    default:
      return { ok: true, value: raw == null ? null : String(raw).slice(0, 2000) };
  }
}

// Mirror a seeded canonical answer onto the legacy User column for Ops analytics.
async function mirrorLegacy(userId, question, value) {
  try {
    const col = LEGACY_FIELD_MAP[question.key];
    if (col && (typeof value === 'string' || value == null)) {
      await prisma.user.update({ where: { id: userId }, data: { [col]: value || null } });
    }
  } catch { /* best-effort — analytics mirror must never fail the response */ }
}

// After any response, if no pending questions remain, mark legacy onboarding done.
async function maybeMarkComplete(userId) {
  try {
    const pending = await computePending(userId);
    if (pending.length === 0) {
      await prisma.user.update({ where: { id: userId }, data: { onboardingCompletedAt: new Date() } });
    }
    return pending;
  } catch {
    return [];
  }
}

// ── POST /api/onboarding/responses (requireAuth) ───────────────────────────────
// Body: { responses: [{ questionId, answer }] }
export async function submitResponses(req, res) {
  try {
    const list = Array.isArray(req.body?.responses) ? req.body.responses : [];
    const now = new Date();
    for (const r of list) {
      if (!r || !r.questionId) continue;
      const q = await prisma.onboardingQuestion.findUnique({ where: { id: r.questionId } });
      if (!q || !q.isActive) continue;
      const { ok, value } = validateAnswer(q, r.answer);
      if (!ok) continue; // skip invalid; client validates required too
      await prisma.userOnboardingResponse.upsert({
        where: { userId_questionId: { userId: req.user.id, questionId: q.id } },
        update: { answer: JSON.stringify(value), status: 'answered', answeredAt: now, skippedAt: null },
        create: { userId: req.user.id, questionId: q.id, answer: JSON.stringify(value), status: 'answered', answeredAt: now },
      });
      await mirrorLegacy(req.user.id, q, value);
    }
    const pending = await maybeMarkComplete(req.user.id);
    return res.json({ ok: true, pending });
  } catch (err) {
    console.error('[onboarding] submitResponses error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/onboarding/skip (requireAuth) ────────────────────────────────────
// Body: { questionIds?: [...] }  (omit ⇒ skip all currently-pending skippable)
export async function skipQuestions(req, res) {
  try {
    const now = new Date();
    let ids = Array.isArray(req.body?.questionIds) ? req.body.questionIds : null;
    if (!ids) {
      const pending = await computePending(req.user.id);
      ids = pending.map(q => q.id);
    }
    for (const id of ids) {
      const q = await prisma.onboardingQuestion.findUnique({ where: { id } });
      if (!q || !q.isActive) continue;
      // Required questions can never be skipped; allowSkip=false also blocks it.
      if (q.isRequired || q.allowSkip === false) continue;
      await prisma.userOnboardingResponse.upsert({
        where: { userId_questionId: { userId: req.user.id, questionId: q.id } },
        update: { status: 'skipped', skippedAt: now, answer: null },
        create: { userId: req.user.id, questionId: q.id, status: 'skipped', skippedAt: now },
      });
    }
    const pending = await maybeMarkComplete(req.user.id);
    return res.json({ ok: true, pending });
  } catch (err) {
    console.error('[onboarding] skipQuestions error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Admin CRUD (Ops Console › Onboarding) — all mounted under requireAdmin.
// ════════════════════════════════════════════════════════════════════════════

export function coerceQuestionInput(body) {
  const type = QUESTION_TYPES.has(body?.type) ? body.type : 'single_select';
  const out = {
    prompt: String(body?.prompt || '').trim().slice(0, 500),
    description: body?.description ? String(body.description).trim().slice(0, 1000) : null,
    type,
    options: null,
    isActive: body?.isActive !== false,
    isRequired: body?.isRequired === true,
    allowSkip: body?.allowSkip !== false,
    displayOrder: Number.isFinite(Number(body?.displayOrder)) ? Number(body.displayOrder) : 0,
  };
  if (type === 'single_select' || type === 'multi_select') {
    const opts = parseOptions(body?.options);
    out.options = JSON.stringify(opts);
  }
  return out;
}

// ── GET /api/admin/onboarding-questions ────────────────────────────────────────
export async function adminListQuestions(req, res) {
  try {
    const [questions, totalUsers, grouped] = await Promise.all([
      prisma.onboardingQuestion.findMany({ orderBy: { displayOrder: 'asc' } }),
      prisma.user.count(),
      prisma.userOnboardingResponse.groupBy({ by: ['questionId', 'status'], _count: { _all: true } }),
    ]);
    const counts = {};
    for (const g of grouped) {
      counts[g.questionId] = counts[g.questionId] || { answered: 0, skipped: 0 };
      counts[g.questionId][g.status] = g._count._all;
    }
    const rows = questions.map(q => {
      const c = counts[q.id] || { answered: 0, skipped: 0 };
      const responded = (c.answered || 0) + (c.skipped || 0);
      return {
        ...publicQuestion(q),
        isActive: q.isActive,
        allowSkip: q.allowSkip,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
        counts: {
          answered: c.answered || 0,
          skipped: c.skipped || 0,
          // pending only meaningful while active: users who have neither answered nor skipped
          pending: q.isActive ? Math.max(0, totalUsers - responded) : 0,
        },
      };
    });
    return res.json({ questions: rows, totalUsers });
  } catch (err) {
    console.error('[onboarding] adminListQuestions error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/onboarding-questions ───────────────────────────────────────
export async function adminCreateQuestion(req, res) {
  try {
    const data = coerceQuestionInput(req.body);
    if (!data.prompt) return res.status(400).json({ error: 'Prompt is required' });
    let key = String(req.body?.key || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key) key = 'q_' + Math.random().toString(36).slice(2, 8);
    const exists = await prisma.onboardingQuestion.findUnique({ where: { key } });
    if (exists) key = `${key}_${Math.random().toString(36).slice(2, 5)}`;
    const created = await prisma.onboardingQuestion.create({ data: { key, ...data } });
    await logAdminAction(req, 'CREATE_ONBOARDING_QUESTION', 'OnboardingQuestion', created.id, { key, prompt: data.prompt });
    return res.json({ ok: true, question: { ...publicQuestion(created), isActive: created.isActive, allowSkip: created.allowSkip } });
  } catch (err) {
    console.error('[onboarding] adminCreateQuestion error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/onboarding-questions/:id ──────────────────────────────────
export async function adminUpdateQuestion(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.onboardingQuestion.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Question not found' });
    const data = coerceQuestionInput({ ...existing, options: existing.options, ...req.body });
    const updated = await prisma.onboardingQuestion.update({ where: { id }, data });
    await logAdminAction(req, 'UPDATE_ONBOARDING_QUESTION', 'OnboardingQuestion', id, { fields: Object.keys(req.body || {}) });
    return res.json({ ok: true, question: { ...publicQuestion(updated), isActive: updated.isActive, allowSkip: updated.allowSkip } });
  } catch (err) {
    console.error('[onboarding] adminUpdateQuestion error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/onboarding-questions/reorder  Body: { order: [id, …] } ──────
export async function adminReorderQuestions(req, res) {
  try {
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    let i = 0;
    for (const id of order) {
      i += 10;
      try { await prisma.onboardingQuestion.update({ where: { id }, data: { displayOrder: i } }); } catch { /* skip unknown id */ }
    }
    await logAdminAction(req, 'REORDER_ONBOARDING_QUESTIONS', 'OnboardingQuestion', null, { count: order.length });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[onboarding] adminReorderQuestions error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/onboarding-questions/:id/reset  Body: { userId? } ──────────
// Deletes responses so the question reappears for one user (userId) or everyone.
export async function adminResetQuestion(req, res) {
  try {
    const { id } = req.params;
    const userId = req.body?.userId || null;
    const where = userId ? { questionId: id, userId } : { questionId: id };
    const result = await prisma.userOnboardingResponse.deleteMany({ where });
    await logAdminAction(req, 'RESET_ONBOARDING_QUESTION', 'OnboardingQuestion', id, { userId: userId || 'ALL', cleared: result.count });
    return res.json({ ok: true, cleared: result.count });
  } catch (err) {
    console.error('[onboarding] adminResetQuestion error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/admin/onboarding-questions/:id ─────────────────────────────────
export async function adminDeleteQuestion(req, res) {
  try {
    const { id } = req.params;
    await prisma.onboardingQuestion.delete({ where: { id } }); // cascades responses
    await logAdminAction(req, 'DELETE_ONBOARDING_QUESTION', 'OnboardingQuestion', id, {});
    return res.json({ ok: true });
  } catch (err) {
    console.error('[onboarding] adminDeleteQuestion error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

const ONBOARDING_SETTINGS_DEFAULTS = {
  enabled: true,
  introTitle: 'Welcome to META·LAB',
  introBody: 'Answer a few quick questions so we can tailor your workspace. You can skip any optional question.',
};

// ── GET /api/admin/onboarding-settings ─────────────────────────────────────────
export async function adminGetSettings(req, res) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'onboardingSettings' } });
    const stored = row ? JSON.parse(row.value || '{}') : {};
    return res.json({ ...ONBOARDING_SETTINGS_DEFAULTS, ...stored });
  } catch (err) {
    console.error('[onboarding] adminGetSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PUT /api/admin/onboarding-settings ─────────────────────────────────────────
export async function adminUpdateSettings(req, res) {
  try {
    const b = req.body || {};
    const value = {
      enabled: b.enabled !== false,
      introTitle: String(b.introTitle ?? ONBOARDING_SETTINGS_DEFAULTS.introTitle).slice(0, 200),
      introBody: String(b.introBody ?? ONBOARDING_SETTINGS_DEFAULTS.introBody).slice(0, 1000),
    };
    await prisma.siteSetting.upsert({
      where: { key: 'onboardingSettings' },
      update: { value: JSON.stringify(value), updatedBy: req.user.id },
      create: { key: 'onboardingSettings', value: JSON.stringify(value), updatedBy: req.user.id },
    });
    await logAdminAction(req, 'UPDATE_SETTING', 'SiteSetting', 'onboardingSettings', { keys: Object.keys(b) });
    return res.json({ ok: true, settings: value });
  } catch (err) {
    console.error('[onboarding] adminUpdateSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
