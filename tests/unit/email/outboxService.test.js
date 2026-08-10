/**
 * outboxService.test.js — enqueueEmail, the ONE door into the outbound-email
 * pipeline (server/services/emailOutboxService.js).
 *
 * What this pins:
 *  1. IDEMPOTENCY. The key is templateKey|recipient(lowercased)|entityId|
 *     discriminator, the lookup and the insert happen inside ONE transaction,
 *     and a repeat request returns 'duplicate' pointing at the ORIGINAL row
 *     instead of writing a second one. A changed discriminator (a re-issued
 *     invitation with a new expiry) is a genuinely different email and sends.
 *  2. PAUSE. Only 'invite.*' templates respect appSettings.invitationsPaused,
 *     and the check FAILS OPEN — a settings-read blip must not silently stop
 *     every invitation in the product.
 *  3. VALIDATION happens before any write, and is typed rather than thrown:
 *     nothing enqueues an unknown key, a junk address, a category the registry
 *     disagrees with, or an unbounded variable blob.
 *  4. NEVER THROWS: a rejecting database is a typed 'error', not an exception
 *     escaping into a request handler.
 *
 * The fake prisma below is an in-memory EmailOutbox table implementing exactly
 * the two operations the dedupe depends on (findFirst by idempotencyKey +
 * create), so the test fails if the lookup or the key format is dropped.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// The worker is kicked (lazily) after a successful enqueue — stub it so no mail
// transport, timer or drain loop is pulled into a service-level unit test.
vi.mock('../../../server/services/emailOutboxWorker.js', () => ({
  kickEmailOutboxWorker: vi.fn(),
}));

const db = { rows: [], seq: 0, settings: null, settingsThrows: false, createThrows: false };

const prismaMock = {
  emailOutbox: {
    findFirst: vi.fn(async ({ where }) => db.rows.find((r) => r.idempotencyKey === where.idempotencyKey) || null),
    create: vi.fn(async ({ data }) => {
      if (db.createThrows) throw new Error('database is locked');
      db.seq += 1;
      const row = { id: `ob${db.seq}`, ...data };
      db.rows.push(row);
      return row;
    }),
  },
  siteSetting: {
    findUnique: vi.fn(async () => {
      if (db.settingsThrows) throw new Error('settings unavailable');
      return db.settings;
    }),
  },
  $transaction: vi.fn(async (fn) => fn(prismaMock)),
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { enqueueEmail, buildIdempotencyKey, isPlausibleRecipient, MAX_VARIABLES_JSON_CHARS } =
  await import('../../../server/services/emailOutboxService.js');
const { kickEmailOutboxWorker } = await import('../../../server/services/emailOutboxWorker.js');

/**
 * The worker kick is deliberately fire-and-forget (a lazy `import()` that the
 * caller never awaits, so a request handler never waits on the mail transport).
 * Let those microtasks settle before asserting on it.
 */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A valid project-member invitation request (the shape both call sites use). */
const invite = (over = {}) => ({
  templateKey: 'invite.projectMember',
  recipient: 'invitee@example.test',
  category: 'transactional',
  variables: { link: 'https://app.test/invite/abc', projectName: 'Aspirin RCTs' },
  entityId: 'member-1',
  discriminator: '2026-09-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.rows = [];
  db.seq = 0;
  db.settings = null;
  db.settingsThrows = false;
  db.createThrows = false;
});

describe('buildIdempotencyKey', () => {
  it('is templateKey|lowercased recipient|entityId|discriminator', () => {
    expect(buildIdempotencyKey({
      templateKey: 'invite.waitlist', recipient: '  Jane@Example.TEST ', entityId: 'inv1', discriminator: 'x',
    })).toBe('invite.waitlist|jane@example.test|inv1|x');
  });

  it('renders absent entityId / discriminator as empty segments (stable arity)', () => {
    expect(buildIdempotencyKey({ templateKey: 'welcome', recipient: 'a@b.test' })).toBe('welcome|a@b.test||');
    expect(buildIdempotencyKey({ templateKey: 'welcome', recipient: 'a@b.test', entityId: null, discriminator: null }))
      .toBe('welcome|a@b.test||');
  });
});

describe('isPlausibleRecipient', () => {
  it.each(['a@b.test', 'first.last+tag@sub.domain.example'])('accepts %s', (v) => {
    expect(isPlausibleRecipient(v)).toBe(true);
  });
  it.each(['', '   ', null, undefined, 'nope', 'a@b', 'a b@c.test', `${'x'.repeat(320)}@b.test`])(
    'rejects %s', (v) => { expect(isPlausibleRecipient(v)).toBe(false); },
  );
});

describe('enqueueEmail — the idempotency matrix', () => {
  it('writes one row with the registry category and the composed key', async () => {
    const r = await enqueueEmail(invite());
    expect(r).toEqual({ enqueued: true, outboxId: 'ob1' });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      templateKey: 'invite.projectMember',
      recipient: 'invitee@example.test',
      category: 'transactional',
      status: 'pending',
      entityId: 'member-1',
      attempts: 0,
      idempotencyKey: 'invite.projectMember|invitee@example.test|member-1|2026-09-01T00:00:00.000Z',
    });
    expect(JSON.parse(db.rows[0].variablesJson)).toEqual({ link: 'https://app.test/invite/abc', projectName: 'Aspirin RCTs' });
    await flush();
    expect(kickEmailOutboxWorker).toHaveBeenCalledTimes(1);
  });

  it('dedupes an identical request and points at the ORIGINAL row', async () => {
    const first = await enqueueEmail(invite());
    const second = await enqueueEmail(invite());
    expect(second).toEqual({ enqueued: false, reason: 'duplicate', outboxId: first.outboxId });
    expect(db.rows).toHaveLength(1);
    // A duplicate is not new work — nothing to kick the worker for.
    await flush();
    expect(kickEmailOutboxWorker).toHaveBeenCalledTimes(1);
  });

  it('dedupes case- and whitespace-variant recipients (same human, same mail)', async () => {
    await enqueueEmail(invite());
    const dup = await enqueueEmail(invite({ recipient: '  Invitee@EXAMPLE.test  ' }));
    expect(dup.reason).toBe('duplicate');
    expect(db.rows).toHaveLength(1);
  });

  it('a NEW discriminator (re-issued invitation, new expiry) enqueues again', async () => {
    await enqueueEmail(invite());
    const reissued = await enqueueEmail(invite({ discriminator: '2026-10-01T00:00:00.000Z' }));
    expect(reissued.enqueued).toBe(true);
    expect(db.rows).toHaveLength(2);
  });

  it('the same template to a DIFFERENT entity is a different email', async () => {
    await enqueueEmail(invite());
    const other = await enqueueEmail(invite({ entityId: 'member-2' }));
    expect(other.enqueued).toBe(true);
    expect(db.rows).toHaveLength(2);
  });

  it('the same entity + a DIFFERENT template is a different email', async () => {
    await enqueueEmail(invite());
    const other = await enqueueEmail(invite({
      templateKey: 'invite.waitlist',
      variables: { link: 'https://app.test/accept?token=x' },
    }));
    expect(other.enqueued).toBe(true);
    expect(db.rows).toHaveLength(2);
  });

  it('does the lookup and the insert inside ONE transaction', async () => {
    await enqueueEmail(invite());
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Both halves ran against the transaction client handed to the callback.
    expect(prismaMock.emailOutbox.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailOutbox.create).toHaveBeenCalledTimes(1);
  });
});

describe('enqueueEmail — the invitation pause switch', () => {
  const paused = () => { db.settings = { key: 'appSettings', value: JSON.stringify({ invitationsPaused: true }) }; };

  it('refuses every invite.* template while invitations are paused, writing nothing', async () => {
    paused();
    expect(await enqueueEmail(invite())).toEqual({ enqueued: false, reason: 'paused' });
    expect(await enqueueEmail(invite({ templateKey: 'invite.waitlist', variables: { link: 'https://a.test/x' } })))
      .toEqual({ enqueued: false, reason: 'paused' });
    expect(db.rows).toHaveLength(0);
  });

  it('does NOT pause non-invitation mail (a password reset is not an invitation)', async () => {
    paused();
    const r = await enqueueEmail({
      templateKey: 'password.reset',
      recipient: 'user@example.test',
      variables: { link: 'https://app.test/reset?token=x' },
      entityId: 'pr1',
      discriminator: '1',
    });
    expect(r.enqueued).toBe(true);
  });

  it('treats invitationsPaused:false / absent settings as not paused', async () => {
    db.settings = { key: 'appSettings', value: JSON.stringify({ invitationsPaused: false }) };
    expect((await enqueueEmail(invite())).enqueued).toBe(true);
    db.rows = [];
    db.settings = null;
    expect((await enqueueEmail(invite())).enqueued).toBe(true);
  });

  it('FAILS OPEN when the settings row cannot be read or is corrupt', async () => {
    db.settingsThrows = true;
    expect((await enqueueEmail(invite())).enqueued).toBe(true);
    db.rows = [];
    db.settingsThrows = false;
    db.settings = { key: 'appSettings', value: '{not json' };
    expect((await enqueueEmail(invite())).enqueued).toBe(true);
  });
});

describe('enqueueEmail — validation refuses before any write', () => {
  const expectInvalid = async (patch) => {
    const r = await enqueueEmail(invite(patch));
    expect(r.enqueued).toBe(false);
    expect(r.reason).toBe('invalid');
    expect(db.rows).toHaveLength(0);
    expect(prismaMock.emailOutbox.create).not.toHaveBeenCalled();
    return r;
  };

  it('rejects a template key the registry does not know', async () => {
    const r = await expectInvalid({ templateKey: 'invite.doesNotExist' });
    expect(r.error).toMatch(/unknown template key/i);
  });

  it('rejects a missing / implausible recipient', async () => {
    await expectInvalid({ recipient: '' });
    db.rows = [];
    prismaMock.emailOutbox.create.mockClear();
    await expectInvalid({ recipient: 'not-an-address' });
  });

  it('rejects a category that disagrees with the registry', async () => {
    // 'invite.projectMember' is transactional — claiming it is optional would
    // otherwise attach an unsubscribe promise we do not honour.
    const r = await expectInvalid({ category: 'optional' });
    expect(r.error).toMatch(/does not match registry category 'transactional'/);
  });

  it('accepts an omitted category (the registry decides) and stamps the registry value', async () => {
    const r = await enqueueEmail({
      templateKey: 'welcome',
      recipient: 'user@example.test',
      recipientUserId: 'u1',
      variables: {},
      entityId: 'u1',
      discriminator: 'welcome',
    });
    expect(r.enqueued).toBe(true);
    expect(db.rows[0]).toMatchObject({ category: 'optional', recipientUserId: 'u1' });
  });

  it('rejects non-object and oversized variable payloads', async () => {
    await expectInvalid({ variables: 'nope' });
    db.rows = []; prismaMock.emailOutbox.create.mockClear();
    await expectInvalid({ variables: ['a'] });
    db.rows = []; prismaMock.emailOutbox.create.mockClear();
    const r = await expectInvalid({ variables: { link: 'x'.repeat(MAX_VARIABLES_JSON_CHARS + 50) } });
    expect(r.error).toMatch(/exceed/i);
  });

  it('rejects a circular variable payload instead of throwing', async () => {
    const circular = { link: 'https://a.test/x' };
    circular.self = circular;
    await expectInvalid({ variables: circular });
  });
});

describe('enqueueEmail — never throws', () => {
  it('reports a rejecting database as a typed error', async () => {
    db.createThrows = true;
    const r = await enqueueEmail(invite());
    expect(r.enqueued).toBe(false);
    expect(r.reason).toBe('error');
    expect(r.error).toMatch(/database is locked/);
    await flush();
    expect(kickEmailOutboxWorker).not.toHaveBeenCalled();
  });

  it('reports a missing argument object as invalid rather than crashing', async () => {
    expect(await enqueueEmail()).toMatchObject({ enqueued: false, reason: 'invalid' });
    expect(await enqueueEmail({})).toMatchObject({ enqueued: false, reason: 'invalid' });
  });
});
