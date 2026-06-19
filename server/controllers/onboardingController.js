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
// prompt35 — the 'institution' question type saves through the institution service
// (canonical ROR/local linkage + uncertain-match review), preserving typed text.
import { resolveInstitutionInput, invalidateInstitutionCandidates } from '../services/institutionService.js';

// 'institution' (prompt35) is rendered as the autocomplete; its answer is an object
// { name, rorId?, canonicalName?, city?, countryName?, countryCode?, source?, confidence? }.
const QUESTION_TYPES = new Set(['text', 'single_select', 'multi_select', 'boolean', 'number', 'date', 'institution']);

// Master onboarding behaviour + intro copy (a single SiteSetting row). Defaults are
// used when no admin row exists yet, so the onboarding screen always has friendly
// intro copy out of the box (prompt32 review follow-up — never a blank heading).
const ONBOARDING_SETTINGS_DEFAULTS = {
  enabled: true,
  introTitle: 'Welcome to META·LAB',
  introBody: 'Answer a few quick questions so we can tailor your workspace. You can skip any optional question.',
};

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
  // prompt35 — optional, skippable institution question rendered as the
  // InstitutionAutocomplete (universities, hospitals, companies, institutes, …).
  {
    key: 'institution',
    prompt: 'What is your institution or organization?',
    description: 'Start typing to find your university, hospital, company, or research center. You can also keep your own typed name.',
    type: 'institution',
    options: null,
    isRequired: false,
    allowSkip: true,
    displayOrder: 35,
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
    // Always return friendly intro copy (admin override, else the defaults) so the
    // onboarding screen never shows a blank heading.
    let intro = { title: ONBOARDING_SETTINGS_DEFAULTS.introTitle, body: ONBOARDING_SETTINGS_DEFAULTS.introBody };
    try {
      const row = await prisma.siteSetting.findUnique({ where: { key: 'onboardingSettings' } });
      if (row) {
        const s = JSON.parse(row.value || '{}');
        intro = {
          title: s.introTitle != null && s.introTitle !== '' ? s.introTitle : ONBOARDING_SETTINGS_DEFAULTS.introTitle,
          body: s.introBody != null && s.introBody !== '' ? s.introBody : ONBOARDING_SETTINGS_DEFAULTS.introBody,
        };
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

// Coerce an institution answer (string or selection object) into the stored shape
// { name, rorId?, canonicalName?, city?, countryName?, countryCode?, source, confidence? }.
// Returns null when empty. Pure + exported for tests (prompt35).
export function coerceInstitutionAnswer(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const s = raw.trim().slice(0, 200);
    return s ? { name: s, source: 'custom' } : null;
  }
  if (typeof raw === 'object') {
    const name = String(raw.name || raw.original || raw.canonicalName || '').trim().slice(0, 200);
    if (!name) return null;
    const out = { name };
    if (raw.rorId) out.rorId = String(raw.rorId).slice(0, 120);
    if (raw.canonicalName) out.canonicalName = String(raw.canonicalName).trim().slice(0, 200);
    if (raw.city) out.city = String(raw.city).trim().slice(0, 120);
    if (raw.countryName) out.countryName = String(raw.countryName).trim().slice(0, 120);
    if (raw.countryCode) out.countryCode = String(raw.countryCode).trim().slice(0, 8);
    out.source = raw.rorId ? 'ror' : (raw.source === 'local' ? 'local' : 'custom');
    if (Number.isFinite(Number(raw.confidence))) out.confidence = Number(raw.confidence);
    return out;
  }
  return null;
}

// Validate + normalize an answer against its question. Returns { ok, value, error }.
export function validateAnswer(question, raw) {
  const opts = parseOptions(question.options).map(o => String(o.value));
  switch (question.type) {
    case 'institution': {
      const v = coerceInstitutionAnswer(raw);
      if (question.isRequired && !v) return { ok: false, error: 'required' };
      return { ok: true, value: v };
    }
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

// prompt35 — persist an institution answer into the canonical User columns via the
// institution service. Best-effort: a matching/DB hiccup never fails the response.
async function saveInstitutionResponse(userId, value) {
  try {
    const patch = await resolveInstitutionInput(value, prisma);
    await prisma.user.update({ where: { id: userId }, data: patch });
    invalidateInstitutionCandidates(); // a new institution should suggest immediately
  } catch (err) {
    console.error('[onboarding] saveInstitutionResponse error:', err.message);
  }
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
      if (q.type === 'institution' || q.key === 'institution') {
        // prompt35 — write the canonical institution columns (preserves typed text;
        // ROR/local picks linked, uncertain custom matches flagged needsReview).
        await saveInstitutionResponse(req.user.id, value);
      } else {
        await mirrorLegacy(req.user.id, q, value);
      }
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

// ════════════════════════════════════════════════════════════════════════════
// Onboarding ANALYTICS (prompt36 Task 6) — admin only.
//
// Denominator contract (documented + returned to the client):
//   • Every registered user is "assigned" every ACTIVE question. So for an active
//     question:  answered + skipped + pending = totalUsers, and the percentage
//     denominator is totalUsers.
//   • pending = users with no response row (neither answered nor skipped) yet.
//   • An INACTIVE question is no longer assigned (pending = 0) but keeps its
//     historical answered/skipped; its percentage denominator is the number of
//     users who actually responded to it (answered + skipped).
//   • Overview totals span ACTIVE questions only, over the (activeQuestions ×
//     totalUsers) assignment universe, so the three rates sum to ~100%.
// Privacy: aggregate counts are returned freely; individual answer VALUES are only
// returned by the per-question / per-user drill-down endpoints (and the UI gates
// them behind an explicit "Show answers" control).
// ════════════════════════════════════════════════════════════════════════════

// One-decimal percentage helper (pure, exported for tests).
export function onbPct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }

// Per-question analytics row from a question + its {answered,skipped,last*} counts.
export function questionAnalyticsRow(q, counts, totalUsers) {
  const answered = counts?.answered || 0;
  const skipped = counts?.skipped || 0;
  const responded = answered + skipped;
  const pending = q.isActive ? Math.max(0, totalUsers - responded) : 0;
  const denom = q.isActive ? totalUsers : responded; // active ⇒ all users; inactive ⇒ responders
  return {
    id: q.id, key: q.key, prompt: q.prompt, type: q.type,
    isActive: q.isActive, isRequired: q.isRequired, allowSkip: q.allowSkip && !q.isRequired,
    answered, skipped, pending,
    answeredPct: onbPct(answered, denom), skippedPct: onbPct(skipped, denom), pendingPct: onbPct(pending, denom),
    lastAnsweredAt: counts?.lastAnsweredAt || null, lastSkippedAt: counts?.lastSkippedAt || null,
    denomBasis: q.isActive ? 'all_users' : 'responders',
  };
}

// Overview totals across ACTIVE questions (consistent denominator). Pure/exported.
export function onboardingOverview({ totalQuestions, activeQuestions, totalUsers, answeredActive, skippedActive, completedUsers }) {
  const assigned = activeQuestions * totalUsers;          // (active question × user) universe
  const responded = answeredActive + skippedActive;
  const pending = Math.max(0, assigned - responded);
  return {
    totalQuestions, activeQuestions, totalUsers,
    totalAssignedResponses: assigned,
    answered: answeredActive, skipped: skippedActive, pending,
    completionRate: onbPct(answeredActive, assigned),
    skipRate: onbPct(skippedActive, assigned),
    pendingRate: onbPct(pending, assigned),
    completedUsers, completedUserRate: onbPct(completedUsers, totalUsers),
  };
}

// Per-user analytics row (counts are over ACTIVE questions). Pure/exported.
export function userAnalyticsRow(user, agg, activeQuestions) {
  const answered = agg?.answered || 0;
  const skipped = agg?.skipped || 0;
  const responded = answered + skipped;
  const pending = Math.max(0, activeQuestions - responded);
  return {
    id: user.id, name: user.name || null, email: user.email || null,
    answered, skipped, pending,
    completionPct: onbPct(answered, activeQuestions),
    lastActivity: user.lastActivity || null,
    complete: activeQuestions > 0 && pending === 0,
  };
}

// Render a stored answer for an admin drill-down. Answers are JSON-encoded; the
// 'institution' type surfaces only its human-readable name (not the raw object).
export function safeAnswerDisplay(question, rawJson) {
  if (rawJson == null) return null;
  let v; try { v = JSON.parse(rawJson); } catch { v = rawJson; }
  if (v == null || v === '') return null;
  if ((question?.type === 'institution') && typeof v === 'object') return v.canonicalName || v.name || null;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ── GET /api/admin/onboarding-analytics ────────────────────────────────────────
export async function adminOnboardingAnalytics(req, res) {
  try {
    const [questions, totalUsers] = await Promise.all([
      prisma.onboardingQuestion.findMany({ orderBy: { displayOrder: 'asc' } }),
      prisma.user.count(),
    ]);
    const activeIds = questions.filter(q => q.isActive).map(q => q.id);
    const activeQuestions = activeIds.length;

    // Per-question answered/skipped counts + last-response timestamps.
    const [answeredAgg, skippedAgg] = await Promise.all([
      prisma.userOnboardingResponse.groupBy({ by: ['questionId'], where: { status: 'answered' }, _count: { _all: true }, _max: { answeredAt: true } }),
      prisma.userOnboardingResponse.groupBy({ by: ['questionId'], where: { status: 'skipped' }, _count: { _all: true }, _max: { skippedAt: true } }),
    ]);
    const counts = {};
    for (const a of answeredAgg) counts[a.questionId] = { ...(counts[a.questionId] || {}), answered: a._count._all, lastAnsweredAt: a._max.answeredAt };
    for (const s of skippedAgg) counts[s.questionId] = { ...(counts[s.questionId] || {}), skipped: s._count._all, lastSkippedAt: s._max.skippedAt };

    const questionRows = questions.map(q => questionAnalyticsRow(q, counts[q.id], totalUsers));

    let answeredActive = 0, skippedActive = 0;
    for (const q of questions) if (q.isActive) { answeredActive += counts[q.id]?.answered || 0; skippedActive += counts[q.id]?.skipped || 0; }

    // Per-user response counts over ACTIVE questions (drives user rows + completed).
    const userAgg = activeIds.length
      ? await prisma.userOnboardingResponse.groupBy({ by: ['userId', 'status'], where: { questionId: { in: activeIds } }, _count: { _all: true } })
      : [];
    const perUser = {};
    for (const g of userAgg) { perUser[g.userId] = perUser[g.userId] || { answered: 0, skipped: 0 }; perUser[g.userId][g.status] = g._count._all; }

    let completedUsers = 0;
    if (activeQuestions > 0) for (const uid of Object.keys(perUser)) { const r = perUser[uid]; if ((r.answered + r.skipped) >= activeQuestions) completedUsers++; }

    const overview = onboardingOverview({ totalQuestions: questions.length, activeQuestions, totalUsers, answeredActive, skippedActive, completedUsers });

    // User-level table (bounded). Users with at least one onboarding response are
    // resolved to identities; the rest are trivially "all pending" and omitted to
    // keep the payload small (their count is implied by overview.totalUsers).
    const USER_CAP = 500;
    const respUserIds = Object.keys(perUser);
    let userRows = [];
    let usersTruncated = false;
    if (respUserIds.length) {
      const users = await prisma.user.findMany({ where: { id: { in: respUserIds } }, select: { id: true, name: true, email: true, lastActive: true } });
      userRows = users
        .map(u => userAnalyticsRow({ ...u, lastActivity: u.lastActive }, perUser[u.id], activeQuestions))
        .sort((a, b) => (b.pending - a.pending) || (Number(a.complete) - Number(b.complete)) || ((a.name || a.email || '').localeCompare(b.name || b.email || '')));
      if (userRows.length > USER_CAP) { usersTruncated = true; userRows = userRows.slice(0, USER_CAP); }
    }

    return res.json({
      overview, questions: questionRows, users: userRows, usersTruncated,
      usersWithActivity: respUserIds.length,
      denominatorNote: 'Active question: answered + skipped + pending = total users (denominator = total users). Inactive question percentages use the number of users who responded as the denominator.',
    });
  } catch (err) {
    console.error('[onboarding] adminOnboardingAnalytics error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/onboarding-questions/:id/analytics ──────────────────────────
export async function adminOnboardingQuestionAnalytics(req, res) {
  try {
    const { id } = req.params;
    const q = await prisma.onboardingQuestion.findUnique({ where: { id } });
    if (!q) return res.status(404).json({ error: 'Question not found' });

    const SAMPLE_CAP = 1000;
    const PENDING_CAP = 200;
    // Authoritative answered/skipped counts come from groupBy (NOT the capped
    // sample) so this drill-down stays consistent with the overview/list endpoints
    // even when a question has more than SAMPLE_CAP responses; the capped fetch is
    // used ONLY to populate the displayed sample lists.
    const [totalUsers, statusAgg, sample] = await Promise.all([
      prisma.user.count(),
      prisma.userOnboardingResponse.groupBy({ by: ['status'], where: { questionId: id }, _count: { _all: true } }),
      prisma.userOnboardingResponse.findMany({
        where: { questionId: id },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ answeredAt: 'desc' }, { skippedAt: 'desc' }],
        take: SAMPLE_CAP,
      }),
    ]);
    const totals = { answered: 0, skipped: 0 };
    for (const g of statusAgg) if (g.status === 'answered' || g.status === 'skipped') totals[g.status] = g._count._all;
    const row = questionAnalyticsRow(q, totals, totalUsers);

    const answeredUsers = [], skippedUsers = [];
    for (const r of sample) {
      const base = { userId: r.userId, name: r.user?.name || null, email: r.user?.email || null };
      if (r.status === 'answered') answeredUsers.push({ ...base, answeredAt: r.answeredAt, answer: safeAnswerDisplay(q, r.answer) });
      else if (r.status === 'skipped') skippedUsers.push({ ...base, skippedAt: r.skippedAt });
    }
    const answeredTruncated = totals.answered > answeredUsers.length;
    const skippedTruncated = totals.skipped > skippedUsers.length;

    // Pending users (only while active): users with NO response row for this
    // question — computed via relation-negation so it is correct regardless of the
    // sample cap (the old notIn:[sampledIds] mislabeled responders beyond the cap).
    let pendingUsers = [], pendingTruncated = false;
    if (q.isActive && row.pending > 0) {
      const users = await prisma.user.findMany({
        where: { onboardingResponses: { none: { questionId: id } } },
        select: { id: true, name: true, email: true },
        take: PENDING_CAP, orderBy: { createdAt: 'desc' },
      });
      pendingUsers = users.map(u => ({ userId: u.id, name: u.name || null, email: u.email || null }));
      pendingTruncated = row.pending > pendingUsers.length;
    }
    return res.json({ question: row, answeredUsers, skippedUsers, answeredTruncated, skippedTruncated, pendingUsers, pendingCount: row.pending, pendingTruncated, totalUsers });
  } catch (err) {
    console.error('[onboarding] adminOnboardingQuestionAnalytics error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/onboarding-users/:id/status ─────────────────────────────────
export async function adminOnboardingUserStatus(req, res) {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, onboardingCompletedAt: true, lastActive: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [questions, responses] = await Promise.all([
      prisma.onboardingQuestion.findMany({ orderBy: { displayOrder: 'asc' } }),
      prisma.userOnboardingResponse.findMany({ where: { userId: id } }),
    ]);
    const byQ = {};
    for (const r of responses) byQ[r.questionId] = r;
    let answered = 0, skipped = 0, pending = 0;
    const items = questions.map(q => {
      const r = byQ[q.id];
      let status;
      if (r?.status === 'answered') { status = 'answered'; answered++; }
      else if (r?.status === 'skipped') { status = 'skipped'; skipped++; }
      else if (q.isActive) { status = 'pending'; pending++; }
      else status = 'not_assigned';
      return {
        id: q.id, key: q.key, prompt: q.prompt, type: q.type, isActive: q.isActive, isRequired: q.isRequired,
        status, answeredAt: r?.answeredAt || null, skippedAt: r?.skippedAt || null,
        answer: r?.status === 'answered' ? safeAnswerDisplay(q, r.answer) : null,
      };
    });
    const activeQuestions = questions.filter(q => q.isActive).length;
    return res.json({
      user,
      counts: { answered, skipped, pending, activeQuestions, completionPct: onbPct(answered, activeQuestions) },
      items,
    });
  } catch (err) {
    console.error('[onboarding] adminOnboardingUserStatus error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
