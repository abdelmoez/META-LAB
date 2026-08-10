/**
 * chatDigestSweep.test.js — the DELIVERY half of project-chat email digests
 * (112.md §2): server/services/chatDigestPolicy.js + the digest sweep in
 * server/services/emailOutboxWorker.js.
 *
 * What this pins:
 *  1. THE TWO WINDOWS. A burst mails when the thread has been quiet for
 *     QUIET_MS *or* when MAX_MS has passed since the first message — and does
 *     NOT mail while both windows are open. Getting the OR wrong in either
 *     direction (AND, or dropping the max ceiling) is caught here.
 *  2. EVERY RE-CHECK CAN ONLY SUPPRESS. Preference off, membership lost, thread
 *     already read, daily cap spent — each resolves to 'drop' (delete the row,
 *     send nothing), never to 'wait'. A row that can never be honestly mailed
 *     must not become immortal.
 *  3. READ SUPPRESSION IS >=, NOT >. A user who opened the chat at exactly the
 *     last message's timestamp has caught up; emailing them is a notification
 *     about nothing.
 *  4. GATE ORDER. The daily cap is evaluated LAST, which is what lets the sweep
 *     probe with sentToday=0 and skip a COUNT over the whole outbox in the
 *     common case. A test asserts the probe/settle sequence, so re-ordering the
 *     gates fails loudly instead of silently costing a query per row.
 *  5. THE REGISTRY ENTRY. 'chat.digest' exists, is category 'optional' (hence
 *     disableable, hence carries List-Unsubscribe), and declares exactly the
 *     variable contract the sweep passes — so the two halves cannot drift.
 *  6. THE SWEEP'S I/O CONTRACT. Rows are deleted after a successful enqueue and
 *     KEPT when the outbox reports a DB error; the enqueue carries
 *     entityId=projectId + discriminator=firstMessageAt so a re-swept row
 *     dedupes instead of double-sending.
 *
 * The policy half needs no mocks at all — that is the point of extracting it.
 * The sweep half runs against an in-memory prisma; emailService is mocked so no
 * transport is constructed, and emailOutboxService is mocked so the enqueue
 * contract is observable as arguments rather than as rows.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const sendEmail = vi.fn(async () => ({ sent: true }));
const isEmailConfigured = vi.fn(() => true);
vi.mock('../../../server/services/emailService.js', () => ({ sendEmail, isEmailConfigured }));

const enqueueEmail = vi.fn(async () => ({ enqueued: true, outboxId: 'ob-1' }));
vi.mock('../../../server/services/emailOutboxService.js', () => ({ enqueueEmail }));

// ── In-memory stand-ins for every table the sweep reads ──────────────────────
const db = { pending: [], users: [], projects: [], members: [], reads: [], outbox: [] };

const prismaMock = {
  chatDigestPending: {
    findMany: vi.fn(async ({ where, take }) => {
      const [quiet, max] = where.OR;
      return db.pending
        .filter((r) => new Date(r.lastMessageAt) <= quiet.lastMessageAt.lte
          || new Date(r.firstMessageAt) <= max.firstMessageAt.lte)
        .slice(0, take)
        .map((r) => ({ ...r }));
    }),
    deleteMany: vi.fn(async ({ where }) => {
      const before = db.pending.length;
      db.pending = db.pending.filter((r) => r.id !== where.id);
      return { count: before - db.pending.length };
    }),
  },
  user: {
    findUnique: vi.fn(async ({ where }) => {
      const hit = db.users.find((u) => u.id === where.id);
      return hit ? { ...hit } : null;
    }),
  },
  screenProject: {
    findUnique: vi.fn(async ({ where }) => {
      const hit = db.projects.find((p) => p.id === where.id);
      return hit ? { ...hit } : null;
    }),
  },
  screenProjectMember: {
    findFirst: vi.fn(async ({ where }) => {
      const hit = db.members.find((m) => m.projectId === where.projectId && m.userId === where.userId);
      return hit ? { ...hit } : null;
    }),
  },
  screenChatRead: {
    findUnique: vi.fn(async ({ where }) => {
      const { projectId, userId } = where.projectId_userId;
      const hit = db.reads.find((r) => r.projectId === projectId && r.userId === userId);
      return hit ? { ...hit } : null;
    }),
  },
  emailOutbox: {
    count: vi.fn(async ({ where }) => db.outbox.filter((o) => o.templateKey === where.templateKey
      && o.recipientUserId === where.recipientUserId
      && new Date(o.createdAt) >= where.createdAt.gte).length),
    // Unused by the sweep, present so the worker module loads intact.
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async () => ({})),
  },
  emailTemplate: { findFirst: vi.fn(async () => null) },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const {
  CHAT_DIGEST_TEMPLATE_KEY, DEFAULT_QUIET_MS, DEFAULT_MAX_MS, DEFAULT_DAILY_CAP,
  GENERIC_DIGEST_PREVIEW,
  chatDigestPrefEnabled, chatDigestUrl, decideChatDigest, formatSenderSummary,
  parseSenderNames, readChatDigestConfig, startOfDayMs,
} = await import('../../../server/services/chatDigestPolicy.js');

const { sweepChatDigests, settleChatDigestRow } = await import('../../../server/services/emailOutboxWorker.js');
const { getEmailTemplate, renderTemplate } = await import('../../../server/services/emailTemplates.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0); // fixed clock; UTC so the cap window is deterministic
const CONFIG = { quietMs: DEFAULT_QUIET_MS, maxMs: DEFAULT_MAX_MS, dailyCap: DEFAULT_DAILY_CAP };

/** An eligible decision input; each test perturbs exactly one axis. */
function eligible(over = {}) {
  return {
    now: T0,
    firstMessageAt: new Date(T0 - 10 * 60 * 1000), // 10 min old burst
    lastMessageAt: new Date(T0 - 6 * 60 * 1000),   // quiet for 6 min
    messageCount: 3,
    quietMs: DEFAULT_QUIET_MS,
    maxMs: DEFAULT_MAX_MS,
    prefEnabled: true,
    isMember: true,
    lastReadAt: null,
    sentToday: 0,
    dailyCap: DEFAULT_DAILY_CAP,
    ...over,
  };
}

describe('decideChatDigest — the windows', () => {
  it('waits while the thread is still live and the ceiling is far off', () => {
    const d = decideChatDigest(eligible({
      firstMessageAt: new Date(T0 - 3 * 60 * 1000),
      lastMessageAt: new Date(T0 - 60 * 1000),
    }));
    expect(d).toEqual({ action: 'wait', reason: 'window_open' });
  });

  it('sends once the QUIET window has elapsed since the last message', () => {
    const d = decideChatDigest(eligible({
      firstMessageAt: new Date(T0 - 7 * 60 * 1000),
      lastMessageAt: new Date(T0 - DEFAULT_QUIET_MS),
    }));
    expect(d).toEqual({ action: 'send', reason: 'quiet' });
  });

  it('sends on the MAX ceiling even while the conversation is still going', () => {
    // Never quiet (last message 30s ago) but the burst started 30 min ago.
    const d = decideChatDigest(eligible({
      firstMessageAt: new Date(T0 - DEFAULT_MAX_MS),
      lastMessageAt: new Date(T0 - 30 * 1000),
    }));
    expect(d).toEqual({ action: 'send', reason: 'max_age' });
  });

  it('is an OR, not an AND — one open window is enough to hold, one closed is enough to send', () => {
    const bothOpen = decideChatDigest(eligible({
      firstMessageAt: new Date(T0 - 60 * 1000),
      lastMessageAt: new Date(T0 - 10 * 1000),
    }));
    expect(bothOpen.action).toBe('wait');
    const quietOnly = decideChatDigest(eligible({
      firstMessageAt: new Date(T0 - 60 * 1000), // well inside the max ceiling
      lastMessageAt: new Date(T0 - DEFAULT_QUIET_MS - 1),
    }));
    expect(quietOnly.action).toBe('send');
  });

  it('honours injected window overrides (env-tunable timings)', () => {
    const d = decideChatDigest(eligible({
      quietMs: 1000, maxMs: 5000,
      firstMessageAt: new Date(T0 - 2000),
      lastMessageAt: new Date(T0 - 1500),
    }));
    expect(d.action).toBe('send');
  });
});

describe('decideChatDigest — the re-checks all suppress, never defer', () => {
  it('drops when the projectChat preference is no longer on', () => {
    expect(decideChatDigest(eligible({ prefEnabled: false }))).toEqual({ action: 'drop', reason: 'pref_off' });
  });

  it('drops when the user is no longer a member of the project', () => {
    expect(decideChatDigest(eligible({ isMember: false }))).toEqual({ action: 'drop', reason: 'not_member' });
  });

  it('drops when the user has already read past the last message', () => {
    const d = decideChatDigest(eligible({ lastReadAt: new Date(T0 - 60 * 1000) }));
    expect(d).toEqual({ action: 'drop', reason: 'already_read' });
  });

  it('treats a read AT the last message timestamp as caught up (>=, not >)', () => {
    const lastMessageAt = new Date(T0 - 6 * 60 * 1000);
    expect(decideChatDigest(eligible({ lastMessageAt, lastReadAt: lastMessageAt })).action).toBe('drop');
    // One millisecond earlier and there is genuinely something unread.
    const stale = new Date(lastMessageAt.getTime() - 1);
    expect(decideChatDigest(eligible({ lastMessageAt, lastReadAt: stale })).action).toBe('send');
  });

  it('a read older than the burst does not suppress', () => {
    expect(decideChatDigest(eligible({ lastReadAt: new Date(T0 - 60 * 60 * 1000) })).action).toBe('send');
  });

  it('drops at the daily cap, and a cap of 0 disables digests entirely', () => {
    expect(decideChatDigest(eligible({ sentToday: DEFAULT_DAILY_CAP - 1 })).action).toBe('send');
    expect(decideChatDigest(eligible({ sentToday: DEFAULT_DAILY_CAP }))).toEqual({ action: 'drop', reason: 'daily_cap' });
    expect(decideChatDigest(eligible({ sentToday: 0, dailyCap: 0 })).reason).toBe('daily_cap');
  });

  it('drops an empty or malformed row rather than re-examining it forever', () => {
    expect(decideChatDigest(eligible({ messageCount: 0 })).reason).toBe('empty');
    expect(decideChatDigest(eligible({ lastMessageAt: 'not-a-date' })).reason).toBe('malformed_timestamps');
  });

  it('the window is checked FIRST — a not-yet-due row waits even when it would be dropped later', () => {
    const d = decideChatDigest(eligible({
      firstMessageAt: new Date(T0 - 60 * 1000),
      lastMessageAt: new Date(T0 - 10 * 1000),
      prefEnabled: false,
      isMember: false,
    }));
    expect(d.action).toBe('wait');
  });

  it('the cap is checked LAST — every cheaper gate wins first', () => {
    // Over the cap AND not a member: the cheaper membership gate must be the reason,
    // which is what lets the sweep skip the outbox COUNT.
    const d = decideChatDigest(eligible({ isMember: false, sentToday: 99 }));
    expect(d.reason).toBe('not_member');
  });
});

describe('policy helpers', () => {
  it('chatDigestPrefEnabled is strict opt-in on projectChat', () => {
    expect(chatDigestPrefEnabled('{"projectChat":true}')).toBe(true);
    expect(chatDigestPrefEnabled('{"projectChat":false}')).toBe(false);
    expect(chatDigestPrefEnabled('{}')).toBe(false);
    expect(chatDigestPrefEnabled(null)).toBe(false);
    expect(chatDigestPrefEnabled('not json')).toBe(false);
  });

  it('a one-click unsubscribe (chat.digest:false) also switches the digest off', () => {
    // The worker attaches List-Unsubscribe to every 'optional' row and the
    // endpoint writes the TEMPLATE KEY — honouring only projectChat would
    // advertise an opt-out we then ignored.
    expect(chatDigestPrefEnabled('{"projectChat":true,"chat.digest":false}')).toBe(false);
    expect(chatDigestPrefEnabled('{"projectChat":true,"chat.digest":true}')).toBe(true);
  });

  it('formatSenderSummary collapses to "A, B and N others"', () => {
    expect(formatSenderSummary([])).toBe('A teammate');
    expect(formatSenderSummary(['Ana'])).toBe('Ana');
    expect(formatSenderSummary(['Ana', 'Ben'])).toBe('Ana and Ben');
    expect(formatSenderSummary(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben and 1 other');
    expect(formatSenderSummary(['Ana', 'Ben', 'Cy', 'Dee', 'Eli'])).toBe('Ana, Ben and 3 others');
  });

  it('parseSenderNames is defensive — junk in, clean string[] out', () => {
    expect(parseSenderNames('["Ana"," Ana ","",null,"Ben"]')).toEqual(['Ana', 'Ben']);
    expect(parseSenderNames('{"nope":1}')).toEqual([]);
    expect(parseSenderNames('broken')).toEqual([]);
    expect(parseSenderNames(null)).toEqual([]);
  });

  it('readChatDigestConfig falls back to the documented defaults', () => {
    expect(readChatDigestConfig({})).toEqual({
      quietMs: DEFAULT_QUIET_MS, maxMs: DEFAULT_MAX_MS, dailyCap: DEFAULT_DAILY_CAP,
    });
    expect(readChatDigestConfig({
      EMAIL_CHAT_DIGEST_QUIET_MS: '1000',
      EMAIL_CHAT_DIGEST_MAX_MS: '2000',
      EMAIL_CHAT_DIGEST_DAILY_CAP: '0',
    })).toEqual({ quietMs: 1000, maxMs: 2000, dailyCap: 0 });
    // Junk never silently becomes 0 (which would mean "mail instantly, forever").
    expect(readChatDigestConfig({ EMAIL_CHAT_DIGEST_QUIET_MS: 'soon' }).quietMs).toBe(DEFAULT_QUIET_MS);
    expect(readChatDigestConfig({ EMAIL_CHAT_DIGEST_MAX_MS: '-5' }).maxMs).toBe(DEFAULT_MAX_MS);
  });

  it('chatDigestUrl builds an absolute project link and tolerates a missing base', () => {
    expect(chatDigestUrl('p1', 'https://app.test/')).toBe('https://app.test/sift-beta/projects/p1');
    expect(chatDigestUrl('p 1', '')).toBe('/sift-beta/projects/p%201');
  });

  it('startOfDayMs is UTC midnight, so the cap boundary is instance-independent', () => {
    expect(startOfDayMs(new Date('2026-01-15T23:59:59.000Z'))).toBe(Date.UTC(2026, 0, 15));
    expect(startOfDayMs(new Date('2026-01-16T00:00:00.000Z'))).toBe(Date.UTC(2026, 0, 16));
  });
});

describe("the 'chat.digest' registry entry", () => {
  const entry = getEmailTemplate('chat.digest');

  it('is registered, optional and therefore disableable', () => {
    expect(entry).toBeTruthy();
    expect(entry.key).toBe(CHAT_DIGEST_TEMPLATE_KEY);
    expect(entry.category).toBe('optional');
    expect(entry.disableable).toBe(true);
  });

  it('declares exactly the variable contract the sweep passes', () => {
    expect([...entry.requiredVariables].sort())
      .toEqual(['chatUrl', 'messageCount', 'preview', 'projectName', 'senderSummary']);
    expect(entry.optionalVariables).toEqual(['recipientName']);
  });

  it('renders with the sweep-shaped variables and leaves no literal tokens', () => {
    const { subject, html, text, missingRequired } = renderTemplate('chat.digest', {
      recipientName: 'Ana',
      projectName: 'Statin RCTs',
      senderSummary: 'Ben and Cy',
      messageCount: 4,
      preview: GENERIC_DIGEST_PREVIEW,
      chatUrl: 'https://app.test/sift-beta/projects/p1',
    });
    expect(missingRequired).toEqual([]);
    expect(subject).toBe('4 new messages in Statin RCTs');
    expect(text).toContain('Ben and Cy');
    expect(text).toContain('https://app.test/sift-beta/projects/p1');
    expect(html).not.toMatch(/\[(projectName|senderSummary|messageCount|preview|chatUrl|recipientName)\]/);
  });

  it('never sends half-rendered: a missing required variable is reported, not printed', () => {
    const r = renderTemplate('chat.digest', { projectName: 'P', senderSummary: 'A', messageCount: 1, preview: 'x' });
    expect(r.missingRequired).toEqual(['chatUrl']);
  });

  it('drops the greeting when no recipientName is known', () => {
    const named = renderTemplate('chat.digest', {
      recipientName: 'Ana', projectName: 'P', senderSummary: 'A', messageCount: 1, preview: 'x', chatUrl: 'https://a.test/x',
    });
    const anon = renderTemplate('chat.digest', {
      projectName: 'P', senderSummary: 'A', messageCount: 1, preview: 'x', chatUrl: 'https://a.test/x',
    });
    expect(named.text).toContain('Hi Ana,');
    expect(anon.text).not.toContain('Hi');
  });
});

// ── The sweep ────────────────────────────────────────────────────────────────

function seedWorld({ pending = {}, prefs = '{"projectChat":true}', memberStatus = 'active', read = null } = {}) {
  db.pending = [{
    id: 'pd-1',
    userId: 'u-1',
    projectId: 'p-1',
    firstMessageAt: new Date(T0 - 10 * 60 * 1000),
    lastMessageAt: new Date(T0 - 6 * 60 * 1000),
    messageCount: 3,
    senderNamesJson: '["Ben","Cy"]',
    ...pending,
  }];
  db.users = [{ id: 'u-1', email: 'ana@test.dev', name: 'Ana', emailNotifications: prefs }];
  db.projects = [{ id: 'p-1', ownerId: 'owner-9', title: 'Statin RCTs', deletedAt: null }];
  db.members = memberStatus ? [{ projectId: 'p-1', userId: 'u-1', status: memberStatus }] : [];
  db.reads = read ? [{ projectId: 'p-1', userId: 'u-1', lastReadAt: read }] : [];
  db.outbox = [];
}

describe('sweepChatDigests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueEmail.mockResolvedValue({ enqueued: true, outboxId: 'ob-1' });
    seedWorld();
  });

  it('enqueues one digest for a due row and deletes the pending row', async () => {
    const totals = await sweepChatDigests(T0, CONFIG);
    expect(totals).toEqual({ sent: 1, dropped: 0, waiting: 0 });
    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    expect(db.pending).toHaveLength(0);
  });

  it('passes the full variable contract, keyed for idempotency on the burst', async () => {
    await sweepChatDigests(T0, CONFIG);
    const arg = enqueueEmail.mock.calls[0][0];
    expect(arg).toMatchObject({
      templateKey: 'chat.digest',
      recipient: 'ana@test.dev',
      recipientUserId: 'u-1',
      category: 'optional',
      entityId: 'p-1',
      discriminator: new Date(T0 - 10 * 60 * 1000).toISOString(),
    });
    expect(arg.variables).toEqual({
      recipientName: 'Ana',
      projectName: 'Statin RCTs',
      senderSummary: 'Ben and Cy',
      messageCount: 3,
      preview: GENERIC_DIGEST_PREVIEW,
      chatUrl: chatDigestUrl('p-1', process.env.APP_BASE_URL),
    });
    // The contract the registry declares is exactly what arrives.
    expect(renderTemplate('chat.digest', arg.variables).missingRequired).toEqual([]);
  });

  it('leaves a row whose windows are both still open', async () => {
    seedWorld({ pending: { firstMessageAt: new Date(T0 - 60 * 1000), lastMessageAt: new Date(T0 - 10 * 1000) } });
    const totals = await sweepChatDigests(T0, CONFIG);
    // Not even selected by the query — the WHERE mirrors the policy's windows.
    expect(totals.sent).toBe(0);
    expect(enqueueEmail).not.toHaveBeenCalled();
    expect(db.pending).toHaveLength(1);
  });

  it('drops without sending when the preference was switched off after the row was written', async () => {
    seedWorld({ prefs: '{"projectChat":false}' });
    const totals = await sweepChatDigests(T0, CONFIG);
    expect(totals).toEqual({ sent: 0, dropped: 1, waiting: 0 });
    expect(enqueueEmail).not.toHaveBeenCalled();
    expect(db.pending).toHaveLength(0);
  });

  it('drops when the user was removed from the project', async () => {
    seedWorld({ memberStatus: null });
    expect((await sweepChatDigests(T0, CONFIG)).dropped).toBe(1);
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('drops for an inactive member but sends for the project owner with no member row', async () => {
    seedWorld({ memberStatus: 'inactive' });
    expect((await sweepChatDigests(T0, CONFIG)).dropped).toBe(1);

    vi.clearAllMocks();
    seedWorld({ memberStatus: null });
    db.projects[0].ownerId = 'u-1'; // owner is always a member (getProjectAccess)
    expect((await sweepChatDigests(T0, CONFIG)).sent).toBe(1);
  });

  it('drops when the project has been soft-deleted', async () => {
    seedWorld();
    db.projects[0].deletedAt = new Date(T0 - 1000);
    expect((await sweepChatDigests(T0, CONFIG)).dropped).toBe(1);
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('drops when the user has already read the thread', async () => {
    seedWorld({ read: new Date(T0 - 60 * 1000) });
    expect((await sweepChatDigests(T0, CONFIG)).dropped).toBe(1);
    expect(enqueueEmail).not.toHaveBeenCalled();
    expect(db.pending).toHaveLength(0);
  });

  it('drops when the user is already at the daily cap', async () => {
    seedWorld();
    db.outbox = Array.from({ length: DEFAULT_DAILY_CAP }, (_, i) => ({
      templateKey: 'chat.digest', recipientUserId: 'u-1', createdAt: new Date(T0 - i * 1000),
    }));
    expect((await sweepChatDigests(T0, CONFIG)).dropped).toBe(1);
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it("yesterday's digests do not count against today's cap", async () => {
    seedWorld();
    db.outbox = Array.from({ length: DEFAULT_DAILY_CAP }, () => ({
      templateKey: 'chat.digest', recipientUserId: 'u-1', createdAt: new Date(T0 - 26 * 60 * 60 * 1000),
    }));
    expect((await sweepChatDigests(T0, CONFIG)).sent).toBe(1);
  });

  it('only pays for the outbox COUNT when every cheaper gate has passed', async () => {
    seedWorld({ prefs: '{"projectChat":false}' });
    await sweepChatDigests(T0, CONFIG);
    expect(prismaMock.emailOutbox.count).not.toHaveBeenCalled();

    vi.clearAllMocks();
    seedWorld();
    await sweepChatDigests(T0, CONFIG);
    expect(prismaMock.emailOutbox.count).toHaveBeenCalledTimes(1);
  });

  it('KEEPS the pending row when the outbox reports a DB error (the digest is not lost)', async () => {
    enqueueEmail.mockResolvedValue({ enqueued: false, reason: 'error', error: 'db down' });
    const totals = await sweepChatDigests(T0, CONFIG);
    expect(totals).toEqual({ sent: 0, dropped: 0, waiting: 1 });
    expect(db.pending).toHaveLength(1);
  });

  it('treats a duplicate enqueue as settled — the digest is already queued', async () => {
    enqueueEmail.mockResolvedValue({ enqueued: false, reason: 'duplicate', outboxId: 'ob-0' });
    const totals = await sweepChatDigests(T0, CONFIG);
    expect(totals.sent).toBe(1);
    expect(db.pending).toHaveLength(0);
  });

  it('one bad row does not starve the rest of the batch', async () => {
    seedWorld();
    db.pending.push({
      id: 'pd-2', userId: 'u-missing', projectId: 'p-1',
      firstMessageAt: new Date(T0 - 20 * 60 * 1000), lastMessageAt: new Date(T0 - 19 * 60 * 1000),
      messageCount: 2, senderNamesJson: '["Ben"]',
    });
    const totals = await sweepChatDigests(T0, CONFIG);
    expect(totals.sent).toBe(1);      // pd-1 still went out
    expect(totals.dropped).toBe(1);   // pd-2 (no such user) was cleaned up
    expect(db.pending).toHaveLength(0);
  });

  it('survives a query failure without throwing into the timer', async () => {
    prismaMock.chatDigestPending.findMany.mockRejectedValueOnce(new Error('no such table'));
    await expect(sweepChatDigests(T0, CONFIG)).resolves.toEqual({ sent: 0, dropped: 0, waiting: 0 });
  });

  it('settleChatDigestRow is directly drivable for one row', async () => {
    seedWorld();
    await expect(settleChatDigestRow(db.pending[0], T0, CONFIG)).resolves.toBe('sent');
  });
});
