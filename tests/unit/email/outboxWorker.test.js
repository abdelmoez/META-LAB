/**
 * outboxWorker.test.js — the delivery half of the outbox
 * (server/services/emailOutboxWorker.js).
 *
 * What this pins:
 *  1. THE CLAIM. pending → 'sending' happens behind a guarded updateMany, and
 *     only the winner processes the row: the fake prisma below implements the
 *     same compare-and-swap the database does, so the test fails if the status
 *     guard is dropped from the WHERE clause.
 *  2. EVERY TERMINAL STATUS has its own path and none of them can send by
 *     accident: 'skipped_disabled', 'skipped_unconfigured', 'failed' (unknown
 *     key / unrenderable / missing required variables), 'sent'.
 *  3. missingRequired NEVER sends. A half-rendered email containing a literal
 *     "[link]" is worse than no email at all, so the row fails and lastError
 *     names the offending tokens.
 *  4. UNSUBSCRIBE HEADERS ride along on category 'optional' rows only, and only
 *     when we know which user to key the opt-out token to. A transactional row
 *     must never advertise an opt-out we will not honour.
 *  5. TRANSIENT TRANSPORT FAILURE is retried under the SHARED attempts cap and
 *     parked (not re-queued in-loop, which would burn the whole budget against a
 *     dead relay in milliseconds); the stuck sweep re-queues it, and permanently
 *     fails it once the budget is spent. A PERMANENT reject (sendEmail's
 *     `permanent: true`, or 'recipients_skipped') skips all of that and settles
 *     terminally — retrying a 550 only re-hammers the relay.
 *  6. TERMINAL ROWS CARRY NO VARIABLES. variablesJson is the render input and
 *     holds raw single-use invite tokens; every terminal status blanks it, and
 *     only a PARKED row (which must render again) keeps it.
 *  7. NO LOST WAKEUPS. A kick that lands mid-drain re-runs the pass, and the
 *     periodic sweep tick kicks the drain UNCONDITIONALLY — that tick is the only
 *     thing that ever drains a 'pending' row this process did not enqueue.
 *  8. WAITLIST RECONCILIATION. A terminal 'invite.waitlist' row writes its
 *     outcome back to WaitlistInvitation.emailStatus, which the enqueue side
 *     leaves at 'queued'.
 *
 * emailService is mocked (no nodemailer, no usage events) and invitationService
 * is mocked (the reconciliation is observable as arguments, and the real module
 * would drag half the auth stack into a unit test); emailTemplates and
 * emailUnsubscribe are the REAL modules, so rendering and the signed
 * List-Unsubscribe token are exercised for real.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const sendEmail = vi.fn(async () => ({ sent: true, id: 'msg-1' }));
const isEmailConfigured = vi.fn(() => true);
vi.mock('../../../server/services/emailService.js', () => ({ sendEmail, isEmailConfigured }));

const recordInvitationEmailResult = vi.fn(async () => ({}));
vi.mock('../../../server/services/invitationService.js', () => ({ recordInvitationEmailResult }));

// ── An in-memory EmailOutbox + EmailTemplate with real compare-and-swap ───────
const db = { rows: [], overrides: [] };
let seq = 0;

/** Apply prisma-shaped `data` (supports the { increment } atomic form). */
function applyData(row, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && typeof v.increment === 'number') {
      row[k] = (Number(row[k]) || 0) + v.increment;
    } else {
      row[k] = v;
    }
  }
}

const prismaMock = {
  emailOutbox: {
    findFirst: vi.fn(async ({ where, orderBy }) => {
      void orderBy;
      const hit = db.rows.find((r) => r.status === where.status);
      return hit ? { id: hit.id } : null;
    }),
    findUnique: vi.fn(async ({ where }) => {
      const hit = db.rows.find((r) => r.id === where.id);
      return hit ? { ...hit } : null;
    }),
    findMany: vi.fn(async ({ where }) => db.rows.filter((r) => r.status === where.status).map((r) => ({ ...r }))),
    updateMany: vi.fn(async ({ where, data }) => {
      const ids = where.id && typeof where.id === 'object' && Array.isArray(where.id.in) ? where.id.in : [where.id];
      let count = 0;
      for (const id of ids) {
        const row = db.rows.find((r) => r.id === id);
        if (!row) continue;
        // The guard the real claim depends on: apply ONLY if the status still matches.
        if (where.status !== undefined && row.status !== where.status) continue;
        applyData(row, data);
        count += 1;
      }
      return { count };
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = db.rows.find((r) => r.id === where.id);
      if (!row) throw new Error('row not found');
      applyData(row, data);
      return { ...row };
    }),
  },
  emailTemplate: {
    // EmailTemplate has no unique constraint on templateKey, so duplicate
    // override rows are possible — this fake only sorts when the caller ASKS for
    // an order, which is what makes the determinism test meaningful.
    findFirst: vi.fn(async ({ where, orderBy }) => {
      const hits = db.overrides.filter((o) => o.templateKey === where.templateKey);
      if (orderBy && orderBy.createdAt === 'asc') {
        hits.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
      }
      return hits[0] || null;
    }),
  },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const {
  drainEmailOutbox, processOutboxRow, recoverStuckOutboxEmails,
  runOutboxSweepTick, isEmailOutboxWorkerEnabled,
} = await import('../../../server/services/emailOutboxWorker.js');
const { DEFAULT_MAX_JOB_ATTEMPTS } = await import('../../../server/utils/jobRetry.js');

const LINK = 'https://app.test/accept-invitation?token=abc';

/** Seed one outbox row. Defaults are a valid, pending waitlist invitation. */
function seed(over = {}) {
  seq += 1;
  const row = {
    id: `ob${seq}`,
    templateKey: 'invite.waitlist',
    recipient: 'invitee@example.test',
    recipientUserId: null,
    category: 'transactional',
    status: 'pending',
    idempotencyKey: `k${seq}`,
    entityId: 'inv1',
    variablesJson: JSON.stringify({ greeting: 'Hi Jane,', link: LINK }),
    renderedSubject: null,
    attempts: 0,
    lastError: null,
    heartbeatAt: null,
    sentAt: null,
    createdAt: new Date(2026, 0, seq),
    ...over,
  };
  db.rows.push(row);
  return row;
}
const get = (id) => db.rows.find((r) => r.id === id);

/**
 * Let a fire-and-forget kick (setImmediate → drainEmailOutbox) run to
 * completion. Every fake prisma call resolves as a microtask, so one macrotask
 * turn after the kick's own turn drains the whole queue.
 */
const flushKick = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

const ENV = ['EMAIL_OUTBOX_WORKER_ENABLED', 'APP_BASE_URL', 'JWT_SECRET'];
let saved;

beforeEach(() => {
  vi.clearAllMocks();
  db.rows = [];
  db.overrides = [];
  seq = 0;
  sendEmail.mockResolvedValue({ sent: true, id: 'msg-1' });
  isEmailConfigured.mockReturnValue(true);
  saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  delete process.env.EMAIL_OUTBOX_WORKER_ENABLED;
  process.env.APP_BASE_URL = 'https://app.test';
  process.env.JWT_SECRET = 'test-secret-for-unsubscribe-tokens';
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('isEmailOutboxWorkerEnabled', () => {
  it('defaults ON and is switched off only by an explicit "false"', () => {
    expect(isEmailOutboxWorkerEnabled()).toBe(true);
    process.env.EMAIL_OUTBOX_WORKER_ENABLED = '';
    expect(isEmailOutboxWorkerEnabled()).toBe(true);
    process.env.EMAIL_OUTBOX_WORKER_ENABLED = 'true';
    expect(isEmailOutboxWorkerEnabled()).toBe(true);
    process.env.EMAIL_OUTBOX_WORKER_ENABLED = 'FALSE';
    expect(isEmailOutboxWorkerEnabled()).toBe(false);
  });
});

describe('the claim loop', () => {
  it('claims each pending row exactly once, incrementing attempts and stamping a heartbeat', async () => {
    seed();
    seed({ recipient: 'second@example.test' });
    await drainEmailOutbox();

    expect(sendEmail).toHaveBeenCalledTimes(2);
    for (const row of db.rows) {
      expect(row.status).toBe('sent');
      expect(row.attempts).toBe(1);
      expect(row.heartbeatAt).toBeInstanceOf(Date);
    }
  });

  it('claims behind a status guard — a row taken by another drain is skipped', async () => {
    const row = seed();
    // Simulate the race: the row is claimed by someone else between the
    // findFirst and our updateMany.
    prismaMock.emailOutbox.findFirst.mockImplementationOnce(async () => {
      row.status = 'sending';
      return { id: row.id };
    });
    await drainEmailOutbox();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(row.attempts).toBe(0);
  });

  it('does nothing at all when the worker is disabled', async () => {
    process.env.EMAIL_OUTBOX_WORKER_ENABLED = 'false';
    seed();
    await drainEmailOutbox();
    expect(prismaMock.emailOutbox.findFirst).not.toHaveBeenCalled();
    expect(db.rows[0].status).toBe('pending');
  });

  it('settles a row that fails unexpectedly instead of wedging the queue', async () => {
    seed();
    seed({ recipient: 'second@example.test' });
    sendEmail.mockRejectedValueOnce(new Error('transport exploded'));
    await drainEmailOutbox();
    expect(get('ob1').status).toBe('failed');
    expect(get('ob1').lastError).toMatch(/transport exploded/);
    expect(get('ob2').status).toBe('sent'); // the queue kept moving
  });
});

describe('processOutboxRow — terminal statuses', () => {
  const claim = (over) => {
    const row = seed({ status: 'sending', attempts: 1, heartbeatAt: new Date(), ...over });
    return row;
  };

  it('sends and records sentAt + the rendered subject', async () => {
    const row = claim();
    expect(await processOutboxRow(row)).toBe('sent');
    const saved2 = get(row.id);
    expect(saved2.status).toBe('sent');
    expect(saved2.sentAt).toBeInstanceOf(Date);
    expect(saved2.renderedSubject).toMatch(/invited to PecanRev/i);
    expect(saved2.lastError).toBeNull();

    const arg = sendEmail.mock.calls[0][0];
    expect(arg.to).toBe('invitee@example.test');
    expect(arg.context).toBe('invite.waitlist');
    expect(arg.html).toContain(LINK);
    expect(arg.text).toContain(LINK);
  });

  it('FAILS without sending when a required variable is missing, naming the token', async () => {
    const row = claim({ variablesJson: JSON.stringify({ greeting: 'Hi Jane,' }) }); // no link
    expect(await processOutboxRow(row)).toBe('failed');
    expect(sendEmail).not.toHaveBeenCalled();
    const saved2 = get(row.id);
    expect(saved2.status).toBe('failed');
    expect(saved2.lastError).toMatch(/Missing required template variable\(s\): link/);
    // The subject still renders — recorded so an operator can see what it was.
    expect(saved2.renderedSubject).toBeTruthy();
  });

  it('fails permanently on a template key the registry no longer knows', async () => {
    const row = claim({ templateKey: 'invite.removedLongAgo' });
    expect(await processOutboxRow(row)).toBe('failed');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(get(row.id).lastError).toMatch(/Unknown email template/);
  });

  it('skips (recording the subject) when SMTP is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const row = claim();
    expect(await processOutboxRow(row)).toBe('skipped_unconfigured');
    expect(sendEmail).not.toHaveBeenCalled();
    const saved2 = get(row.id);
    expect(saved2.status).toBe('skipped_unconfigured');
    expect(saved2.renderedSubject).toMatch(/invited to PecanRev/i);
  });

  it('skips a DISABLEABLE template an admin switched off', async () => {
    db.overrides.push({ templateKey: 'welcome', enabled: false, fieldsJson: '{}' });
    const row = claim({ templateKey: 'welcome', category: 'optional', recipientUserId: 'u1', variablesJson: '{}' });
    expect(await processOutboxRow(row)).toBe('skipped_disabled');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(get(row.id).status).toBe('skipped_disabled');
  });

  it('IGNORES an override that tries to disable a TRANSACTIONAL template', async () => {
    // The registry, not the override table, decides what may be switched off —
    // there is no honest way to opt out of your own invitation.
    db.overrides.push({ templateKey: 'invite.waitlist', enabled: false, fieldsJson: '{}' });
    const row = claim();
    expect(await processOutboxRow(row)).toBe('sent');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('resolves DUPLICATE override rows deterministically — the oldest wins', async () => {
    // Nothing stops two EmailTemplate rows existing for one key (no unique
    // constraint). Unordered, the same queue could render two different subjects
    // depending on what the planner returned.
    db.overrides.push(
      { templateKey: 'invite.waitlist', enabled: true, createdAt: new Date(2026, 0, 9), fieldsJson: JSON.stringify({ subject: 'Newer duplicate' }) },
      { templateKey: 'invite.waitlist', enabled: true, createdAt: new Date(2026, 0, 2), fieldsJson: JSON.stringify({ subject: 'Oldest override' }) },
    );
    const row = claim();
    await processOutboxRow(row);
    expect(prismaMock.emailTemplate.findFirst.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
    expect(sendEmail.mock.calls[0][0].subject).toBe('Oldest override');
  });

  it('applies an admin copy override to the rendered mail', async () => {
    db.overrides.push({
      templateKey: 'invite.waitlist',
      enabled: true,
      fieldsJson: JSON.stringify({ subject: 'A custom invitation subject' }),
    });
    const row = claim();
    await processOutboxRow(row);
    expect(sendEmail.mock.calls[0][0].subject).toBe('A custom invitation subject');
    expect(get(row.id).renderedSubject).toBe('A custom invitation subject');
  });

  it('tolerates unparseable variables / override fields rather than crashing', async () => {
    db.overrides.push({ templateKey: 'invite.waitlist', enabled: true, fieldsJson: '{not json' });
    const row = claim({ variablesJson: '{not json' });
    // Variables degrade to {} → the required `link` is missing → honest failure.
    expect(await processOutboxRow(row)).toBe('failed');
    expect(get(row.id).lastError).toMatch(/Missing required/);
  });
});

describe('processOutboxRow — unsubscribe headers', () => {
  it('attaches List-Unsubscribe to an OPTIONAL-category row with a known user', async () => {
    const row = seed({
      status: 'sending', attempts: 1, templateKey: 'welcome', category: 'optional',
      recipientUserId: 'user-1', variablesJson: '{}',
    });
    await processOutboxRow(row);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.headers).toBeTruthy();
    expect(arg.headers['List-Unsubscribe']).toMatch(/^<https:\/\/app\.test\/api\/email\/unsubscribe\?token=.+>$/);
  });

  it('attaches NOTHING to a transactional row, even with a known user', async () => {
    const row = seed({ status: 'sending', attempts: 1, recipientUserId: 'user-1' });
    await processOutboxRow(row);
    expect(sendEmail.mock.calls[0][0].headers).toBeUndefined();
  });

  it('attaches nothing to an optional row with no recipientUserId (nothing to key the token to)', async () => {
    const row = seed({
      status: 'sending', attempts: 1, templateKey: 'welcome', category: 'optional',
      recipientUserId: null, variablesJson: '{}',
    });
    await processOutboxRow(row);
    expect(sendEmail.mock.calls[0][0].headers).toBeUndefined();
  });

  it('sends without headers when the unsubscribe URL cannot be built (no APP_BASE_URL)', async () => {
    delete process.env.APP_BASE_URL;
    const row = seed({
      status: 'sending', attempts: 1, templateKey: 'welcome', category: 'optional',
      recipientUserId: 'user-1', variablesJson: '{}',
    });
    expect(await processOutboxRow(row)).toBe('sent');
    expect(sendEmail.mock.calls[0][0].headers).toBeUndefined();
  });
});

describe('transport failure, retry and the attempts cap', () => {
  it('parks a failed send for the sweep instead of re-claiming it in the same pass', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', error: 'ECONNREFUSED relay' });
    seed();
    await drainEmailOutbox();

    const row = get('ob1');
    expect(row.status).toBe('sending');    // parked, NOT pending
    expect(row.heartbeatAt).toBeNull();    // → immediately stuck for the sweep
    expect(row.lastError).toMatch(/ECONNREFUSED relay/);
    expect(row.attempts).toBe(1);
    // Exactly one attempt in this drain — the budget was not burned in a tight loop.
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('permanently fails once the shared attempts cap is spent', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', error: 'relay refused' });
    const row = seed({ status: 'sending', attempts: DEFAULT_MAX_JOB_ATTEMPTS });
    expect(await processOutboxRow(row)).toBe('failed');
    const saved2 = get(row.id);
    expect(saved2.status).toBe('failed');
    expect(saved2.lastError).toMatch(new RegExp(`gave up after ${DEFAULT_MAX_JOB_ATTEMPTS} attempts`));
  });

  it('bounds lastError so a huge provider message cannot bloat the row', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', error: 'x'.repeat(5000) });
    const row = seed({ status: 'sending', attempts: 1 });
    await processOutboxRow(row);
    expect(get(row.id).lastError.length).toBeLessThanOrEqual(500);
  });
});

describe('permanent failures are never retried as transient', () => {
  it('settles a PERMANENT reject terminally — no park, no second attempt', async () => {
    // sendEmail classifies an SMTP 5xx as permanent. Parking it would hand a
    // message the relay has already refused back to the sweep, N more times.
    sendEmail.mockResolvedValue({
      sent: false, reason: 'send_failed', permanent: true, error: '550 5.1.1 mailbox unavailable',
    });
    seed();
    await drainEmailOutbox();

    const row = get('ob1');
    expect(row.status).toBe('failed');
    expect(row.heartbeatAt).not.toBeNull();          // NOT parked for the sweep
    expect(row.lastError).toMatch(/550 5\.1\.1 mailbox unavailable/);
    expect(row.lastError).not.toMatch(/gave up after/); // it never spent the budget
    expect(row.attempts).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // ...and the sweep must not resurrect it.
    await recoverStuckOutboxEmails();
    expect(get('ob1').status).toBe('failed');
  });

  it("settles 'recipients_skipped' terminally — the staging policy dropped every address", async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'recipients_skipped', skipped: ['real@user.test'] });
    const row = seed({ status: 'sending', attempts: 1 });
    expect(await processOutboxRow(row)).toBe('failed');
    expect(get(row.id).status).toBe('failed');
    expect(get(row.id).lastError).toMatch(/recipients_skipped/);
  });

  it('still PARKS a transient failure — permanent:false is the retryable case', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', permanent: false, error: 'ECONNRESET' });
    const row = seed({ status: 'sending', attempts: 1 });
    expect(await processOutboxRow(row)).toBe('retry');
    expect(get(row.id).status).toBe('sending');
    expect(get(row.id).heartbeatAt).toBeNull();
  });

  it('an UNCLASSIFIED failure is still treated as transient (no flag = no new terminal path)', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', error: 'relay hiccup' });
    const row = seed({ status: 'sending', attempts: 1 });
    expect(await processOutboxRow(row)).toBe('retry');
  });
});

describe('terminal rows carry no variables blob', () => {
  // variablesJson is the render input; for 'invite.waitlist' it holds the accept
  // link with a RAW single-use token in it. A settled row is history.
  const settledBlob = (id) => get(id).variablesJson;

  it('is scrubbed on sent, and the rendered subject survives as the history', async () => {
    const row = seed({ status: 'sending', attempts: 1 });
    await processOutboxRow(row);
    expect(get(row.id).status).toBe('sent');
    expect(settledBlob(row.id)).toBe('{}');
    expect(get(row.id).renderedSubject).toMatch(/invited to PecanRev/i);
  });

  it('is scrubbed on every failed path', async () => {
    const unknown = seed({ status: 'sending', attempts: 1, templateKey: 'invite.removedLongAgo' });
    await processOutboxRow(unknown);
    expect(settledBlob(unknown.id)).toBe('{}');

    const missing = seed({ status: 'sending', attempts: 1, variablesJson: JSON.stringify({ greeting: 'Hi Jane,' }) });
    await processOutboxRow(missing);
    expect(settledBlob(missing.id)).toBe('{}');

    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', permanent: true, error: '550 rejected' });
    const permanent = seed({ status: 'sending', attempts: 1 });
    await processOutboxRow(permanent);
    expect(settledBlob(permanent.id)).toBe('{}');

    const spent = seed({ status: 'sending', attempts: DEFAULT_MAX_JOB_ATTEMPTS });
    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', error: 'relay refused' });
    await processOutboxRow(spent);
    expect(settledBlob(spent.id)).toBe('{}');
  });

  it('is scrubbed on both skipped_* statuses', async () => {
    isEmailConfigured.mockReturnValue(false);
    const unconfigured = seed({ status: 'sending', attempts: 1 });
    await processOutboxRow(unconfigured);
    expect(get(unconfigured.id).status).toBe('skipped_unconfigured');
    expect(settledBlob(unconfigured.id)).toBe('{}');

    isEmailConfigured.mockReturnValue(true);
    db.overrides.push({ templateKey: 'welcome', enabled: false, fieldsJson: '{}' });
    const disabled = seed({
      status: 'sending', attempts: 1, templateKey: 'welcome',
      category: 'optional', recipientUserId: 'u1', variablesJson: JSON.stringify({ toName: 'Jane' }),
    });
    await processOutboxRow(disabled);
    expect(get(disabled.id).status).toBe('skipped_disabled');
    expect(settledBlob(disabled.id)).toBe('{}');
  });

  it("is scrubbed by the sweep's give-up branch too", async () => {
    const doomed = seed({
      status: 'sending', attempts: DEFAULT_MAX_JOB_ATTEMPTS, heartbeatAt: null, lastError: 'relay refused',
    });
    await recoverStuckOutboxEmails();
    expect(get(doomed.id).status).toBe('failed');
    expect(settledBlob(doomed.id)).toBe('{}');
  });

  it('is scrubbed when a row throws unexpectedly mid-drain', async () => {
    sendEmail.mockRejectedValueOnce(new Error('transport exploded'));
    seed();
    await drainEmailOutbox();
    expect(get('ob1').status).toBe('failed');
    expect(settledBlob('ob1')).toBe('{}');
  });

  it('KEEPS the blob on a parked row — it has to render again on the retry', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', error: 'temporary' });
    const row = seed({ status: 'sending', attempts: 1 });
    expect(await processOutboxRow(row)).toBe('retry');
    expect(JSON.parse(get(row.id).variablesJson).link).toBe(LINK);
    // ...and the re-queued row still renders the real link on the next pass.
    await recoverStuckOutboxEmails();
    sendEmail.mockResolvedValue({ sent: true, id: 'msg-2' });
    await drainEmailOutbox();
    expect(get(row.id).status).toBe('sent');
    expect(sendEmail.mock.calls.at(-1)[0].html).toContain(LINK);
  });
});

describe('WaitlistInvitation reconciliation', () => {
  it('records the SENT outcome against the invitation the row was minted for', async () => {
    const row = seed({ status: 'sending', attempts: 1, entityId: 'inv-42' });
    await processOutboxRow(row);
    expect(recordInvitationEmailResult).toHaveBeenCalledWith('inv-42', { status: 'sent' });
  });

  it('records a FAILED outcome carrying the provider error', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', permanent: true, error: '550 no such user' });
    const row = seed({ status: 'sending', attempts: 1, entityId: 'inv-43' });
    await processOutboxRow(row);
    expect(recordInvitationEmailResult).toHaveBeenCalledTimes(1);
    const [id, result] = recordInvitationEmailResult.mock.calls[0];
    expect(id).toBe('inv-43');
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/550 no such user/);
  });

  it('reconciles a render failure too — an invite that can never send is not "queued"', async () => {
    const row = seed({ status: 'sending', attempts: 1, entityId: 'inv-44', variablesJson: '{}' });
    expect(await processOutboxRow(row)).toBe('failed');
    expect(recordInvitationEmailResult.mock.calls[0][1].status).toBe('failed');
  });

  it('leaves a PARKED row alone — the invitation stays queued until the row settles', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed', error: 'temporary' });
    const row = seed({ status: 'sending', attempts: 1 });
    expect(await processOutboxRow(row)).toBe('retry');
    expect(recordInvitationEmailResult).not.toHaveBeenCalled();
  });

  it('leaves a skipped_unconfigured row alone — nothing was handed off to fail', async () => {
    isEmailConfigured.mockReturnValue(false);
    const row = seed({ status: 'sending', attempts: 1 });
    expect(await processOutboxRow(row)).toBe('skipped_unconfigured');
    expect(recordInvitationEmailResult).not.toHaveBeenCalled();
  });

  it('touches nothing for another template, or for an invite row with no entityId', async () => {
    const anonymous = seed({ status: 'sending', attempts: 1, entityId: null });
    await processOutboxRow(anonymous);
    const other = seed({
      status: 'sending', attempts: 1, templateKey: 'welcome',
      category: 'optional', recipientUserId: 'u1', entityId: 'u1', variablesJson: '{}',
    });
    await processOutboxRow(other);
    expect(get(anonymous.id).status).toBe('sent');
    expect(get(other.id).status).toBe('sent');
    expect(recordInvitationEmailResult).not.toHaveBeenCalled();
  });

  it('never fails a delivered email because the bookkeeping threw', async () => {
    recordInvitationEmailResult.mockRejectedValueOnce(new Error('invitation table gone'));
    const row = seed({ status: 'sending', attempts: 1 });
    expect(await processOutboxRow(row)).toBe('sent');
    expect(get(row.id).status).toBe('sent');
  });

  it('reconciles from the sweep give-up branch as well', async () => {
    seed({ status: 'sending', attempts: DEFAULT_MAX_JOB_ATTEMPTS, heartbeatAt: null, entityId: 'inv-45' });
    await recoverStuckOutboxEmails();
    expect(recordInvitationEmailResult.mock.calls[0][0]).toBe('inv-45');
    expect(recordInvitationEmailResult.mock.calls[0][1].status).toBe('failed');
  });
});

describe('no lost wakeups', () => {
  it('re-runs the pass when a kick lands mid-drain', async () => {
    // The race: a row is committed and kicked while a drain is running, at the
    // moment that drain's claim query has ALREADY returned nothing. Before the
    // fix the kick was dropped at the `draining` guard and the row sat until the
    // next 5-minute sweep.
    prismaMock.emailOutbox.findFirst.mockImplementationOnce(async () => {
      seed();                    // ...a row lands...
      await drainEmailOutbox();  // ...and its kick hits the re-entrancy guard
      return null;               // our own (earlier) query still sees nothing
    });

    await drainEmailOutbox();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(get('ob1').status).toBe('sent');
  });

  it('a kick during a drain never starts a second concurrent drain', async () => {
    seed();
    let concurrent = 0;
    sendEmail.mockImplementationOnce(async () => {
      concurrent += 1;
      await drainEmailOutbox(); // re-entrant call — must be a no-op, not a claim
      return { sent: true, id: 'msg-1' };
    });
    await drainEmailOutbox();
    expect(concurrent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(get('ob1').attempts).toBe(1);
  });
});

describe('runOutboxSweepTick', () => {
  it('kicks the drain on EVERY tick, even when it re-queued nothing', async () => {
    // A pending row this process never enqueued (another instance, or a crash
    // between the commit and the kick). recoverStuckOutboxEmails only looks at
    // 'sending', so nothing is re-queued — the tick still has to drain it.
    seed();
    expect(await runOutboxSweepTick()).toEqual({ requeued: 0, failed: 0 });
    await flushKick();
    expect(get('ob1').status).toBe('sent');
  });

  it('kicks even when the recovery query itself blows up', async () => {
    prismaMock.emailOutbox.findMany.mockRejectedValueOnce(new Error('db blip'));
    seed();
    await runOutboxSweepTick();
    await flushKick();
    expect(get('ob1').status).toBe('sent');
  });

  it('does not kick a disabled worker', async () => {
    process.env.EMAIL_OUTBOX_WORKER_ENABLED = 'false';
    seed();
    await runOutboxSweepTick();
    await flushKick();
    expect(get('ob1').status).toBe('pending');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('recoverStuckOutboxEmails', () => {
  it('re-queues parked / crash-interrupted rows and leaves live ones alone', async () => {
    const parked = seed({ status: 'sending', attempts: 1, heartbeatAt: null });
    const crashed = seed({ status: 'sending', attempts: 2, heartbeatAt: new Date(Date.now() - 60 * 60 * 1000) });
    const live = seed({ status: 'sending', attempts: 1, heartbeatAt: new Date() });
    const pending = seed();

    const out = await recoverStuckOutboxEmails();
    expect(out).toEqual({ requeued: 2, failed: 0 });
    expect(get(parked.id).status).toBe('pending');
    expect(get(parked.id).heartbeatAt).toBeNull();
    expect(get(crashed.id).status).toBe('pending');
    expect(get(live.id).status).toBe('sending');   // actively draining — untouched
    expect(get(pending.id).status).toBe('pending');
  });

  it('permanently fails a poison-pill row whose retry budget is spent', async () => {
    const doomed = seed({ status: 'sending', attempts: DEFAULT_MAX_JOB_ATTEMPTS, heartbeatAt: null, lastError: 'relay refused' });
    const out = await recoverStuckOutboxEmails();
    expect(out).toEqual({ requeued: 0, failed: 1 });
    const row = get(doomed.id);
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(/relay refused .*gave up after/);
  });

  it('is a no-op when nothing is in flight', async () => {
    seed();
    expect(await recoverStuckOutboxEmails()).toEqual({ requeued: 0, failed: 0 });
  });

  it('a parked row is re-queued by the sweep and then sends on the next drain', async () => {
    sendEmail.mockResolvedValueOnce({ sent: false, reason: 'send_failed', error: 'temporary' });
    seed();
    await drainEmailOutbox();
    expect(get('ob1').status).toBe('sending');

    await recoverStuckOutboxEmails();
    expect(get('ob1').status).toBe('pending');

    await drainEmailOutbox();
    expect(get('ob1').status).toBe('sent');
    expect(get('ob1').attempts).toBe(2);
  });
});
