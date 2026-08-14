/**
 * pdfAnnotationServerModel.test.js — 116.md §76-§90, §101, §103 (Part VII).
 *
 * The SERVER pure core: wire sanitation, the whole §83/§84/§85 permission matrix, the
 * §90 concurrency rule and the §103 tombstone semantics — all as data, so the rules are
 * pinned independently of Prisma and Express (the handlers are covered separately in
 * pdfAnnotationHandlers.test.js).
 *
 * The most important pins here are the NEGATIVE ones:
 *   - a non-member resolves to no capabilities at all, so the handler 404s (§101);
 *   - nothing in this module reads an `isAdmin` flag, so an Ops/admin capability can
 *     never become an edit right over scientific annotations (§84);
 *   - a missing row is a 404 and never a 403, so the API cannot be used to probe for
 *     annotations the caller may not see.
 */
import { describe, it, expect } from 'vitest';
import {
  ANNOTATION_COLOR_KEYS, DEFAULT_ANNOTATION_COLOR,
  MAX_SELECTED_TEXT, MAX_COMMENT, MAX_RECTS,
  SCOPE_SCREENING, SCOPE_METALAB,
  normalizeColor, boundText, sanitizeRects, normalizePage, normalizeDocHash, normalizeClientId,
  annotationCapabilities, mutationDecision, clearDecision, casOutcome, wireAnnotation,
} from '../../../server/annotations/pdfAnnotationModel.js';
import {
  ANNOTATION_COLOR_KEYS as CLIENT_KEYS,
  MAX_SELECTED_TEXT as CLIENT_TEXT, MAX_COMMENT as CLIENT_COMMENT,
} from '../../../src/frontend/components/pdfAnnotationModel.js';

const HASH = 'a'.repeat(64);

describe('116.md §77 — palette + bounds are ONE definition, mirrored', () => {
  it('the server and client palettes and caps agree exactly', () => {
    expect([...ANNOTATION_COLOR_KEYS]).toEqual([...CLIENT_KEYS]);
    expect(MAX_SELECTED_TEXT).toBe(CLIENT_TEXT);
    expect(MAX_COMMENT).toBe(CLIENT_COMMENT);
  });

  it('normalizeColor clamps to the palette — an invalid colour is never stored', () => {
    for (const k of ANNOTATION_COLOR_KEYS) expect(normalizeColor(k)).toBe(k);
    expect(normalizeColor('  GREEN ')).toBe('green');
    for (const bad of ['#ff0000', 'rgb(1,2,3)', 'javascript:alert(1)', '', null, 7, {}, []]) {
      expect(normalizeColor(bad)).toBe(DEFAULT_ANNOTATION_COLOR);
    }
  });

  it('boundText truncates rather than rejecting, and never returns null', () => {
    expect(boundText(null, 10)).toBe('');
    expect(boundText(undefined, 10)).toBe('');
    expect(boundText('x'.repeat(50), 10)).toBe('xxxxxxxxxx');
    expect(boundText(12345, 3)).toBe('123');
  });
});

describe('116.md §76/§101 — rectangle sanitation (never trust the client)', () => {
  it('normalizes orientation and rounds to 4 dp', () => {
    expect(sanitizeRects([{ x0: 30.000049, y0: 100, x1: 10, y1: 80 }]))
      .toEqual([{ x0: 10, y0: 80, x1: 30, y1: 100 }]);
  });

  it('drops degenerate, non-finite and absurd rectangles', () => {
    expect(sanitizeRects([
      { x0: 10, y0: 10, x1: 10, y1: 20 },        // zero width
      { x0: 10, y0: 10, x1: 20, y1: 10 },        // zero height
      { x0: 'a', y0: 1, x1: 2, y1: 3 },
      { x0: 1, y0: 2 },
      { x0: 1e9, y0: 1, x1: 1e9 + 5, y1: 5 },    // beyond any real page
      null, 'x', 42,
    ])).toEqual([]);
  });

  it('accepts a JSON STRING (the stored column shape) as well as an array', () => {
    expect(sanitizeRects('[{"x0":1,"y0":2,"x1":3,"y1":4}]')).toEqual([{ x0: 1, y0: 2, x1: 3, y1: 4 }]);
    expect(sanitizeRects('not json')).toEqual([]);
    expect(sanitizeRects(undefined)).toEqual([]);
  });

  it('caps the rectangle count so one request cannot store a corpus', () => {
    const many = Array.from({ length: MAX_RECTS + 50 }, (_, i) => ({ x0: 0, y0: i, x1: 10, y1: i + 0.5 }));
    expect(sanitizeRects(many)).toHaveLength(MAX_RECTS);
  });

  it('page / docHash / clientId reject anything they do not recognise', () => {
    expect(normalizePage('3')).toBe(3);
    expect(normalizePage(3.7)).toBe(3);
    expect(normalizePage(0)).toBe(null);
    expect(normalizePage(-1)).toBe(null);
    expect(normalizePage(1e9)).toBe(null);
    expect(normalizePage('x')).toBe(null);

    expect(normalizeDocHash(HASH.toUpperCase())).toBe(HASH);
    expect(normalizeDocHash(`  ${HASH}  `)).toBe(HASH);
    expect(normalizeDocHash('a'.repeat(63))).toBe('');
    expect(normalizeDocHash('../../etc/passwd')).toBe('');
    expect(normalizeDocHash(null)).toBe('');

    expect(normalizeClientId('an-0123456789')).toBe('an-0123456789');
    expect(normalizeClientId('short')).toBe('');                     // < 8 chars
    expect(normalizeClientId('has spaces here')).toBe('');
    expect(normalizeClientId(`an-${'x'.repeat(200)}`)).toBe('');     // > 120 chars
  });
});

describe('116.md §83/§84 — the permission matrix', () => {
  const screening = (a) => annotationCapabilities({ scope: SCOPE_SCREENING, access: a });
  const metalab = (a) => annotationCapabilities({ scope: SCOPE_METALAB, access: a });

  it('NON-MEMBER (null access) gets nothing — the handler then 404s, not 403 (§101)', () => {
    expect(screening(null)).toEqual({ canRead: false, canCreate: false, canModerate: false });
    expect(metalab(null)).toEqual({ canRead: false, canCreate: false, canModerate: false });
    expect(annotationCapabilities()).toEqual({ canRead: false, canCreate: false, canModerate: false });
    expect(annotationCapabilities({ scope: 'nonsense', access: { canScreen: true } }))
      .toEqual({ canRead: false, canCreate: false, canModerate: false });
  });

  it('screening VIEWER may read but not create or moderate', () => {
    expect(screening({ role: 'viewer', canScreen: false, isLeader: false }))
      .toEqual({ canRead: true, canCreate: false, canModerate: false });
  });

  it('screening REVIEWER (canScreen) may create their own, never moderate', () => {
    expect(screening({ role: 'reviewer', canScreen: true, isLeader: false }))
      .toEqual({ canRead: true, canCreate: true, canModerate: false });
  });

  it('screening LEADER and OWNER may create AND moderate (§83 elevated authority)', () => {
    expect(screening({ role: 'leader', canScreen: false, isLeader: true }))
      .toEqual({ canRead: true, canCreate: true, canModerate: true });
    expect(screening({ role: 'owner', canScreen: true, isLeader: true, isOwner: true }))
      .toEqual({ canRead: true, canCreate: true, canModerate: true });
  });

  it('extraction scope maps canView/canEdit + owner/leader onto the same three answers', () => {
    expect(metalab({ canView: true, canEdit: false, role: 'reviewer' }))
      .toEqual({ canRead: true, canCreate: false, canModerate: false });
    expect(metalab({ canView: true, canEdit: true, role: 'reviewer' }))
      .toEqual({ canRead: true, canCreate: true, canModerate: false });
    expect(metalab({ canView: true, canEdit: true, role: 'leader' }))
      .toEqual({ canRead: true, canCreate: true, canModerate: true });
    expect(metalab({ canView: true, canEdit: true, isOwner: true, role: 'owner' }))
      .toEqual({ canRead: true, canCreate: true, canModerate: true });
  });

  it('§84 — an `isAdmin` flag buys NOTHING; only the real resolvers answer', () => {
    // A site admin who is not a member of the project resolves to a null access
    // context upstream. Even handed a hand-crafted "admin" object, the model refuses.
    expect(screening({ isAdmin: true, role: 'admin' }))
      .toEqual({ canRead: true, canCreate: false, canModerate: false });
    expect(metalab({ isAdmin: true }))
      .toEqual({ canRead: false, canCreate: false, canModerate: false });
    // And the module never mentions the flag at all.
    expect(annotationCapabilities.toString()).not.toMatch(/isAdmin/);
  });
});

describe('116.md §83 — mutationDecision (author vs other vs leader)', () => {
  const row = { id: 'a1', authorId: 'author', deletedAt: null, revision: 2 };
  const member = { canRead: true, canCreate: true, canModerate: false };
  const leader = { canRead: true, canCreate: true, canModerate: true };

  it('the AUTHOR may recolor, comment and delete their own', () => {
    for (const action of ['update', 'delete']) {
      const d = mutationDecision({ annotation: row, userId: 'author', capabilities: member, action });
      expect(d.allowed).toBe(true);
      expect(d.moderated).toBe(false);
    }
  });

  it('another MEMBER is refused with a structured, human 403 — not a silent no-op', () => {
    const d = mutationDecision({ annotation: row, userId: 'someone-else', capabilities: member, action: 'update' });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(403);
    expect(d.code).toBe('ANNOTATION_NOT_YOURS');
    expect(d.error).toBe('Only the person who created this highlight, or a project leader, can change it.');
    const del = mutationDecision({ annotation: row, userId: 'someone-else', capabilities: member, action: 'delete' });
    expect(del.error).toBe('Only the person who created this highlight, or a project leader, can delete it.');
  });

  it('a LEADER/OWNER is allowed and the write is flagged MODERATED (for the audit ledger)', () => {
    const d = mutationDecision({ annotation: row, userId: 'the-leader', capabilities: leader, action: 'delete' });
    expect(d.allowed).toBe(true);
    expect(d.moderated).toBe(true);
  });

  it('a MISSING row is 404 for everyone — existence is never leaked through a 403', () => {
    for (const caps of [member, leader]) {
      const d = mutationDecision({ annotation: null, userId: 'author', capabilities: caps, action: 'update' });
      expect(d.status).toBe(404);
      expect(d.code).toBe('ANNOTATION_NOT_FOUND');
    }
  });

  it('§103 — a tombstone is 404 for everything EXCEPT restore', () => {
    const dead = { ...row, deletedAt: new Date('2026-01-01') };
    expect(mutationDecision({ annotation: dead, userId: 'author', capabilities: member, action: 'update' }).status).toBe(404);
    expect(mutationDecision({ annotation: dead, userId: 'author', capabilities: member, action: 'delete' }).status).toBe(404);
    const r = mutationDecision({ annotation: dead, userId: 'author', capabilities: member, action: 'restore' });
    expect(r.allowed).toBe(true);
    expect(r.noop).toBeUndefined();
  });

  it('restoring a LIVE row is an allowed no-op (an undo replayed twice is harmless)', () => {
    const r = mutationDecision({ annotation: row, userId: 'author', capabilities: member, action: 'restore' });
    expect(r.allowed).toBe(true);
    expect(r.noop).toBe(true);
  });

  it('restore obeys the SAME author-or-leader rule as every other mutation', () => {
    const dead = { ...row, deletedAt: new Date('2026-01-01') };
    expect(mutationDecision({ annotation: dead, userId: 'nobody', capabilities: member, action: 'restore' }).status).toBe(403);
    expect(mutationDecision({ annotation: dead, userId: 'nobody', capabilities: leader, action: 'restore' }).allowed).toBe(true);
  });

  it('an anonymous caller is never treated as the author of an author-less row', () => {
    const orphan = { id: 'a2', authorId: '', deletedAt: null, revision: 1 };
    expect(mutationDecision({ annotation: orphan, userId: '', capabilities: member, action: 'update' }).status).toBe(403);
  });
});

describe('116.md §85 — clear semantics', () => {
  it('"Clear my annotations" is open to any member who can read the PDF', () => {
    expect(clearDecision({ mode: 'mine', capabilities: { canRead: true, canModerate: false } }).allowed).toBe(true);
  });

  it('a non-member cannot clear even their own — 404, existence hidden', () => {
    const d = clearDecision({ mode: 'mine', capabilities: { canRead: false } });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(404);
  });

  it('"Clear all" is LEADER/OWNER only, with a structured 403 for everyone else', () => {
    expect(clearDecision({ mode: 'all', capabilities: { canRead: true, canModerate: true } }).allowed).toBe(true);
    const d = clearDecision({ mode: 'all', capabilities: { canRead: true, canCreate: true, canModerate: false } });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(403);
    expect(d.code).toBe('ANNOTATION_MODERATE_DENIED');
    expect(d.error).toContain('Only a project leader or owner');
  });

  it('an unknown mode is a 400, never a silently-widened clear', () => {
    expect(clearDecision({ mode: 'everything', capabilities: { canRead: true, canModerate: true } }).status).toBe(400);
    expect(clearDecision({}).status).toBe(400);
  });
});

describe('116.md §90 — the concurrency rule', () => {
  it('a matching revision proceeds', () => {
    expect(casOutcome({ current: { revision: 4, deletedAt: null }, baseRevision: 4 })).toBe('ok');
    expect(casOutcome({ current: { revision: 4, deletedAt: null }, baseRevision: '4' })).toBe('ok');
  });

  it('a stale revision is a CONFLICT the client resolves by refetching', () => {
    expect(casOutcome({ current: { revision: 5, deletedAt: null }, baseRevision: 4 })).toBe('conflict');
  });

  it('a DELETE always wins over a concurrent recolor/comment ("A deletes while B edits")', () => {
    expect(casOutcome({ current: { revision: 4, deletedAt: new Date() }, baseRevision: 4 })).toBe('gone');
    expect(casOutcome({ current: null, baseRevision: 4 })).toBe('gone');
  });

  it('no baseline sent ⇒ last-write-wins (legacy/optional clients are not broken)', () => {
    expect(casOutcome({ current: { revision: 9, deletedAt: null } })).toBe('ok');
    expect(casOutcome({ current: { revision: 9, deletedAt: null }, baseRevision: 'x' })).toBe('ok');
  });
});

describe('116.md §78/§80 — the wire shape', () => {
  const row = {
    id: 'a1', clientId: 'an-abcdefgh', docHash: HASH, screenProjectId: 'sp1', metaLabProjectId: null,
    recordId: 'rec-1', studyId: null, page: 3, rects: '[{"x0":1,"y0":2,"x1":3,"y1":4}]',
    selectedText: 'the primary outcome', color: 'green', comment: 'unclear',
    authorId: 'u1', authorName: 'Dr Ada Byron', revision: 2,
    deletedAt: null, deletedById: null, createdAt: 'T0', updatedAt: 'T1',
  };

  it('parses rects for the render path and carries exactly the §78 fields', () => {
    const w = wireAnnotation(row);
    expect(w.rects).toEqual([{ x0: 1, y0: 2, x1: 3, y1: 4 }]);
    expect(w).toMatchObject({
      id: 'a1', clientId: 'an-abcdefgh', docHash: HASH, recordId: 'rec-1', studyId: null,
      page: 3, selectedText: 'the primary outcome', color: 'green', comment: 'unclear',
      authorId: 'u1', authorName: 'Dr Ada Byron', revision: 2, deleted: false,
      createdAt: 'T0', updatedAt: 'T1',
    });
  });

  it('never leaks the moderator id or the scope keys (§80 "no unnecessary account info")', () => {
    const w = wireAnnotation({ ...row, deletedAt: 'T2', deletedById: 'the-leader' });
    expect(w.deleted).toBe(true);
    expect(w).not.toHaveProperty('deletedById');
    expect(w).not.toHaveProperty('screenProjectId');
    expect(w).not.toHaveProperty('metaLabProjectId');
  });

  it('self-heals a row with a bad stored colour instead of shipping it', () => {
    expect(wireAnnotation({ ...row, color: 'chartreuse' }).color).toBe('yellow');
  });

  it('wireAnnotation(null) is null', () => {
    expect(wireAnnotation(null)).toBe(null);
  });
});
