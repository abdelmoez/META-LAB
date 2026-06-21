/**
 * waitlist/waitlistRepository.js — data-access layer for the Beta Waitlist DB
 * (prompt48). EVERY query against the dedicated waitlist client lives here; the
 * service layer never builds raw queries. The `client` is always passed in (from
 * getWaitlistClient()) so this module has no implicit DB binding and stays
 * isolation-clean (it never imports server/db/client.js).
 *
 * Note on case-insensitive search: Prisma `contains` compiles to SQLite `LIKE`,
 * which is case-insensitive for ASCII — so name/email/institution search works
 * without a `mode:'insensitive'` (unsupported on SQLite).
 */

import { DEFAULT_WAITLIST_STATUS, WAITLIST_MAX } from '../../src/shared/betaWaitlist.js';

// Summary columns for list endpoints — deliberately EXCLUDES message,
// internalNotes, consent details and status history (not needed for the table;
// keeps the payload small and private). prompt48 §10.
const LIST_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  institutionName: true,
  role: true,
  customRole: true,
  countryCode: true,
  countryName: true,
  status: true,
  areasOfInterest: true,
  createdAt: true,
  confirmationEmailStatus: true,
  confirmationEmailSentAt: true,
};

const SORTABLE = new Set(['createdAt', 'status', 'institutionName', 'countryName', 'email', 'lastName']);

/** Parse the JSON-encoded areasOfInterest back into an array on read. */
export function parseApplicant(row) {
  if (!row) return row;
  let interests = [];
  try {
    interests = Array.isArray(row.areasOfInterest) ? row.areasOfInterest : JSON.parse(row.areasOfInterest || '[]');
  } catch {
    interests = [];
  }
  return { ...row, areasOfInterest: Array.isArray(interests) ? interests : [] };
}

export async function findByNormalizedEmail(client, normalizedEmail) {
  if (!normalizedEmail) return null;
  const row = await client.betaWaitlistApplicant.findUnique({ where: { normalizedEmail } });
  return row ? parseApplicant(row) : null;
}

/**
 * Create an applicant from a VALIDATED + whitelisted `value` (output of
 * validateApplication). `meta` carries server-owned context (submissionSource).
 * Writes the row + an initial status-history event in one transaction.
 */
export async function createApplicant(client, value, meta = {}) {
  const now = new Date();
  const data = {
    email: value.email,
    normalizedEmail: value.normalizedEmail,
    firstName: value.firstName,
    lastName: value.lastName,
    institutionName: value.institutionName,
    institutionRorId: value.institutionRorId || null,
    role: value.role,
    customRole: value.customRole || null,
    countryCode: value.countryCode,
    countryName: value.countryName || '',
    researchExperienceLevel: value.researchExperienceLevel || null,
    annualReviewVolume: value.annualReviewVolume || null,
    workingStyle: value.workingStyle || null,
    teamSize: value.teamSize || null,
    areasOfInterest: JSON.stringify(Array.isArray(value.areasOfInterest) ? value.areasOfInterest : []),
    primaryUse: value.primaryUse,
    referralSource: value.referralSource || null,
    referralOther: value.referralOther || null,
    message: value.message || null,
    consent: value.consent === true,
    consentVersion: value.consentVersion || null,
    consentAt: value.consent === true ? now : null,
    status: DEFAULT_WAITLIST_STATUS,
    submissionSource: meta.submissionSource || 'public_web',
    confirmationEmailStatus: 'pending',
  };

  const created = await client.$transaction(async (tx) => {
    const row = await tx.betaWaitlistApplicant.create({ data });
    await tx.betaWaitlistStatusEvent.create({
      data: { applicantId: row.id, fromStatus: null, toStatus: DEFAULT_WAITLIST_STATUS, changedBy: null, note: 'Joined waitlist' },
    });
    return row;
  });
  return parseApplicant(created);
}

/**
 * Paginated, filtered, sorted list (summary fields only).
 * @returns {Promise<{rows:object[], total:number, page:number, limit:number, pages:number}>}
 */
export async function listApplicants(client, params = {}) {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 25));
  const sortBy = SORTABLE.has(params.sortBy) ? params.sortBy : 'createdAt';
  const sortDir = params.sortDir === 'asc' ? 'asc' : 'desc';

  const where = {};
  if (params.status) where.status = params.status;
  if (params.role) where.role = params.role;
  if (params.countryCode) where.countryCode = String(params.countryCode).toUpperCase();
  if (params.emailStatus) where.confirmationEmailStatus = params.emailStatus;

  const dateFilter = {};
  if (params.dateFrom) { const d = new Date(params.dateFrom); if (!Number.isNaN(d.getTime())) dateFilter.gte = d; }
  if (params.dateTo) { const d = new Date(params.dateTo); if (!Number.isNaN(d.getTime())) dateFilter.lte = d; }
  if (Object.keys(dateFilter).length) where.createdAt = dateFilter;

  const search = (params.search || '').trim().slice(0, 200);
  if (search) {
    where.OR = [
      { email: { contains: search } },
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { institutionName: { contains: search } },
    ];
  }

  const [total, rows] = await Promise.all([
    client.betaWaitlistApplicant.count({ where }),
    client.betaWaitlistApplicant.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    rows: rows.map(parseApplicant),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getApplicantById(client, id) {
  if (!id) return null;
  const row = await client.betaWaitlistApplicant.findUnique({
    where: { id },
    include: { statusEvents: { orderBy: { createdAt: 'desc' } } },
  });
  return row ? parseApplicant(row) : null;
}

/** Minimal fields for metrics aggregation (no PII free-text). */
export async function allForMetrics(client) {
  const rows = await client.betaWaitlistApplicant.findMany({
    select: {
      createdAt: true,
      status: true,
      confirmationEmailStatus: true,
      role: true,
      customRole: true,
      institutionName: true,
      countryName: true,
      countryCode: true,
      areasOfInterest: true,
    },
  });
  return rows.map(parseApplicant);
}

/** Rows for CSV export honoring the same filters as the list (no pagination). */
export async function forExport(client, params = {}) {
  const where = {};
  if (params.status) where.status = params.status;
  if (params.role) where.role = params.role;
  if (params.countryCode) where.countryCode = String(params.countryCode).toUpperCase();
  if (params.emailStatus) where.confirmationEmailStatus = params.emailStatus;
  const dateFilter = {};
  if (params.dateFrom) { const d = new Date(params.dateFrom); if (!Number.isNaN(d.getTime())) dateFilter.gte = d; }
  if (params.dateTo) { const d = new Date(params.dateTo); if (!Number.isNaN(d.getTime())) dateFilter.lte = d; }
  if (Object.keys(dateFilter).length) where.createdAt = dateFilter;
  const search = (params.search || '').trim().slice(0, 200);
  if (search) {
    where.OR = [
      { email: { contains: search } },
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { institutionName: { contains: search } },
    ];
  }
  // Hard cap so a huge export can't exhaust memory.
  const rows = await client.betaWaitlistApplicant.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50_000,
  });
  return rows.map(parseApplicant);
}

const STATUS_TIMESTAMP_FIELD = {
  INVITED: 'invitedAt',
  ACCEPTED: 'acceptedAt',
  REMOVED: 'removedAt',
};

/** Change status (validated upstream) + append a status-history event atomically. */
export async function updateStatus(client, id, toStatus, opts = {}) {
  return client.$transaction(async (tx) => {
    const current = await tx.betaWaitlistApplicant.findUnique({ where: { id }, select: { status: true } });
    if (!current) return null;
    const data = { status: toStatus };
    const tsField = STATUS_TIMESTAMP_FIELD[toStatus];
    if (tsField) data[tsField] = new Date();
    const updated = await tx.betaWaitlistApplicant.update({ where: { id }, data });
    await tx.betaWaitlistStatusEvent.create({
      data: {
        applicantId: id,
        fromStatus: current.status,
        toStatus,
        changedBy: opts.changedBy || null,
        note: (opts.note || '').slice(0, 500) || null,
      },
    });
    return parseApplicant(updated);
  });
}

export async function updateNotes(client, id, notes) {
  const clean = notes == null ? null : String(notes).slice(0, WAITLIST_MAX.notes);
  const updated = await client.betaWaitlistApplicant.update({
    where: { id },
    data: { internalNotes: clean || null },
  });
  return parseApplicant(updated);
}

/**
 * Record a confirmation-email send result. `error` is a SAFE short reason only.
 * Increments the attempt counter and stamps lastConfirmationAttemptAt.
 */
export async function recordEmailResult(client, id, result) {
  const data = { confirmationEmailStatus: result.status };
  // Only a REAL send attempt (sent/failed) counts against the attempt counter and
  // the persisted resend cooldown clock. 'skipped' (SMTP not configured) sent
  // nothing, so it must not consume an admin's resend cooldown.
  if (result.status !== 'skipped') {
    data.lastConfirmationAttemptAt = new Date();
    data.confirmationEmailAttempts = { increment: 1 };
  }
  if (result.status === 'sent') {
    data.confirmationEmailSentAt = new Date();
    data.lastConfirmationEmailError = null;
  } else if (result.status === 'failed') {
    data.lastConfirmationEmailError = (result.error || 'send failed').slice(0, 300);
  }
  const updated = await client.betaWaitlistApplicant.update({ where: { id }, data });
  return parseApplicant(updated);
}

export async function deleteApplicant(client, id) {
  await client.betaWaitlistApplicant.delete({ where: { id } });
  return true;
}
