/**
 * 119.md §5 / §9 / §10 "File-validation tests" + "API authorization tests" — the
 * manuscript FIGURE server, hermetically.
 *
 * Two layers, no DB and no HTTP:
 *   1. figureStorage — the magic-byte sniffer that decides what a file really is
 *      (and yields the dimensions §5 wants), the storedName path guard and the
 *      figure-key grammar;
 *   2. manuscriptFigureController — the authorization matrix, the governance
 *      kill-switch, the twin-dedupe, the replace-keeps-identity rule and the
 *      delete-only-when-unreferenced rule that makes undo safe.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ── Test doubles ─────────────────────────────────────────────────────────── */
const state = {
  access: null,
  project: null,
  figures: [],
  settings: { allowImageUpload: true, maxFigureSizeMb: 12 },
  logs: [],
  written: [],     // [{projectId, storedName, bytes}]
  unlinked: [],
};

let rowSeq = 0;
const prisma = {
  project: {
    async findFirst({ where }) {
      return state.project && state.project.id === where.id ? state.project : null;
    },
  },
  manuscriptFigure: {
    async findMany({ where }) {
      return state.figures.filter((f) => f.projectId === where.projectId
        && (where.fileHash === undefined || f.fileHash === where.fileHash));
    },
    async findFirst({ where }) {
      return state.figures.find((f) => f.id === where.id && f.projectId === where.projectId) || null;
    },
    async create({ data }) {
      rowSeq += 1;
      const row = { id: `row-${rowSeq}`, createdAt: new Date(), updatedAt: new Date(), replacedCount: 0, ...data };
      state.figures.push(row);
      return row;
    },
    async update({ where, data }) {
      const row = state.figures.find((f) => f.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async delete({ where }) {
      const i = state.figures.findIndex((f) => f.id === where.id);
      return state.figures.splice(i, 1)[0];
    },
  },
};

vi.mock('../../../server/db/client.js', () => ({ prisma }));
vi.mock('../../../server/extraction/access.js', () => ({
  resolveExtractionAccess: vi.fn(async () => state.access),
}));
vi.mock('../../../server/screening/settings.js', () => ({
  getMetaSiftSettings: vi.fn(async () => state.settings),
}));
vi.mock('../../../server/logbook/logbookService.js', () => ({
  recordLogEvent: vi.fn(async (draft) => { state.logs.push(draft); return draft; }),
  logbookActor: vi.fn(() => ({ actorId: 'u1' })),
}));
vi.mock('fs', () => {
  const fake = {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn((p, buf) => state.written.push({ path: p, bytes: buf.length })),
    unlinkSync: vi.fn((p) => state.unlinked.push(p)),
    statSync: vi.fn(() => ({ size: 10 })),
    createReadStream: vi.fn(() => ({ on: () => {}, pipe: () => {} })),
    readFileSync: vi.fn(() => Buffer.alloc(0)),
  };
  return { default: fake, ...fake };
});

const FS = await import('../../../server/manuscript/figureStorage.js');
const C = await import('../../../server/controllers/manuscriptFigureController.js');

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

/** A minimal but REAL 1×1 PNG (signature + IHDR with width/height 1). */
function pngBytes(w = 1, h = 1) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function gifBytes(w = 7, h = 9) {
  const b = Buffer.alloc(14);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}
function jpegBytes(w = 640, h = 480) {
  const b = Buffer.alloc(24);
  b[0] = 0xff; b[1] = 0xd8;                 // SOI
  b[2] = 0xff; b[3] = 0xe0; b.writeUInt16BE(4, 4); // APP0, length 4 (skipped)
  b[8] = 0xff; b[9] = 0xc0;                 // SOF0
  b.writeUInt16BE(11, 10);                  // segment length
  b[12] = 8;                                // precision
  b.writeUInt16BE(h, 13);
  b.writeUInt16BE(w, 15);
  return b;
}
function webpBytes(w = 30, h = 20) {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const TIFF = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const res = () => {
  const r = {
    statusCode: 200, body: null, headers: {}, ended: false,
    status(c) { r.statusCode = c; return r; },
    json(b) { r.body = b; return r; },
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; return r; },
    end() { r.ended = true; return r; },
    get headersSent() { return false; },
  };
  return r;
};
const req = (over = {}) => ({ params: { id: 'ml1' }, user: { id: 'u1' }, headers: {}, body: {}, ...over });

beforeEach(() => {
  state.access = { project: { id: 'ml1' }, canView: true, canEdit: true, userId: 'u1', userName: 'Dr A', role: 'owner' };
  state.project = { id: 'ml1', data: JSON.stringify({ manuscripts: [] }) };
  state.figures = [];
  state.settings = { allowImageUpload: true, maxFigureSizeMb: 12 };
  state.logs = [];
  state.written = [];
  state.unlinked = [];
  rowSeq = 0;
});

/* ── 1. the sniffer ───────────────────────────────────────────────────────── */

describe('119.md §5 — figureStorage.sniffImage never trusts an extension', () => {
  it('reads PNG / JPEG / GIF / WebP dimensions from the header', () => {
    expect(FS.sniffImage(pngBytes(1200, 900))).toMatchObject({ format: 'png', mime: 'image/png', width: 1200, height: 900 });
    expect(FS.sniffImage(jpegBytes(640, 480))).toMatchObject({ format: 'jpeg', width: 640, height: 480 });
    expect(FS.sniffImage(gifBytes(7, 9))).toMatchObject({ format: 'gif', width: 7, height: 9 });
    expect(FS.sniffImage(webpBytes(30, 20))).toMatchObject({ format: 'webp', width: 30, height: 20 });
  });

  it('REJECTS SVG — it is a script container, not a picture', () => {
    expect(FS.sniffImage(SVG)).toBeNull();
  });

  it('REJECTS TIFF and other formats no browser and no Word can render', () => {
    expect(FS.sniffImage(TIFF)).toBeNull();
    expect(FS.sniffImage(Buffer.from('<html><body>hi</body></html>'))).toBeNull();
    expect(FS.sniffImage(Buffer.from([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // MZ exe
  });

  it('a PNG renamed .jpg is still a PNG (and vice versa)', () => {
    expect(FS.sniffImage(pngBytes()).mime).toBe('image/png');
    expect(FS.sniffImage(jpegBytes()).mime).toBe('image/jpeg');
  });

  it('guards the stored path against a crafted name', () => {
    expect(FS.isSafeStoredName('9a4f7c1e-1111-2222-3333-444455556666.png')).toBe(true);
    expect(FS.isSafeStoredName('../../etc/passwd')).toBe(false);
    expect(FS.isSafeStoredName('x.svg')).toBe(false);
    expect(FS.isSafeStoredName('x.exe')).toBe(false);
  });

  it('mints grammar-safe figure keys that cannot shadow a generated figure', () => {
    for (let i = 0; i < 20; i += 1) {
      const k = FS.mintFigureKey(new Set());
      expect(k).toMatch(/^[a-z0-9-]+$/);
      expect(FS.isValidFigureKey(k)).toBe(true);
    }
    for (const reserved of ['prisma', 'rob', 'forest', 'funnel', 'forest-primary']) {
      expect(FS.isValidFigureKey(reserved)).toBe(false);
    }
  });
});

/* ── 2. the controller ────────────────────────────────────────────────────── */

const upload = (buf, over = {}) => {
  const r = req({ file: { buffer: buf, originalname: 'flow.png' }, figureCapBytes: 12 * 1024 * 1024, ...over });
  const s = res();
  return C.uploadFigure(r, s).then(() => s);
};

describe('119.md §5/§9 — figure API authorization', () => {
  it('a non-member gets 404 (existence is not leaked)', async () => {
    state.access = null;
    for (const fn of [C.listFigures, C.uploadFigure, C.replaceFigure, C.updateFigure, C.rawFigure, C.downloadFigure, C.deleteFigure]) {
      const s = res();
      await fn(req({ file: { buffer: pngBytes(), originalname: 'a.png' }, params: { id: 'ml1', figureId: 'row-1' } }), s);
      expect(s.statusCode).toBe(404);
    }
  });

  it('a VIEWER can read but cannot upload, replace, edit or delete', async () => {
    state.access = { project: { id: 'ml1' }, canView: true, canEdit: false, userId: 'u2', userName: 'Viewer' };
    const list = res();
    await C.listFigures(req(), list);
    expect(list.statusCode).toBe(200);
    for (const fn of [C.uploadFigure, C.replaceFigure, C.updateFigure, C.deleteFigure]) {
      const s = res();
      await fn(req({ file: { buffer: pngBytes(), originalname: 'a.png' }, params: { id: 'ml1', figureId: 'row-1' } }), s);
      expect(s.statusCode).toBe(403);
    }
  });

  it('the admin kill-switch stops the upload at the middleware, not at the UI', async () => {
    state.settings.allowImageUpload = false;
    const s = res();
    // The middleware REFUSES: it answers 403 and never calls next(), so the resolve
    // has to come off the response — waiting for next() here would hang forever,
    // which is exactly the behaviour being asserted.
    await new Promise((done) => {
      s.json = (b) => { s.body = b; done(); return s; };
      C.figureUploadMiddleware(req(), s, () => done(new Error('next() must not run')));
    });
    expect(s.statusCode).toBe(403);
    expect(s.body.error).toContain('disabled by the administrator');
  });

  it('the admin per-file cap is applied on top of the hard ceiling', async () => {
    state.settings.maxFigureSizeMb = 2;
    const s = res();
    let capped = null;
    const r = req();
    await new Promise((done) => C.figureUploadMiddleware(r, s, () => { capped = r.figureCapBytes; done(); }));
    expect(capped).toBe(2 * 1024 * 1024);
  });
});

describe('119.md §5 — upload', () => {
  it('stores a valid PNG with its sniffed type, dimensions and content hash', async () => {
    const s = await upload(pngBytes(1200, 900));
    expect(s.statusCode).toBe(201);
    expect(s.body.figure).toMatchObject({ mimeType: 'image/png', width: 1200, height: 900, fileName: 'flow.png' });
    expect(s.body.figure.figKey).toMatch(/^[a-z0-9-]+$/);
    expect(s.body.figure.fileHash).toHaveLength(64);
    expect(state.written).toHaveLength(1);
    // The on-disk name is never handed to the client.
    expect(s.body.figure).not.toHaveProperty('storedName');
  });

  it('refuses an SVG with an honest, actionable message', async () => {
    const s = await upload(SVG, { file: { buffer: SVG, originalname: 'evil.svg' } });
    expect(s.statusCode).toBe(400);
    expect(s.body.error).toContain('SVG and TIFF are not accepted');
    expect(state.written).toHaveLength(0);
  });

  it('refuses a file over the admin cap even if multer let it through', async () => {
    const big = Buffer.concat([pngBytes(), Buffer.alloc(2048)]);
    const s = await upload(big, { figureCapBytes: 512 });
    expect(s.statusCode).toBe(400);
    expect(s.body.error).toContain('limit');
  });

  it('content-dedupes: the same bytes twice write ONE file but mint TWO figures', async () => {
    await upload(pngBytes(10, 10));
    await upload(pngBytes(10, 10));
    expect(state.figures).toHaveLength(2);
    expect(state.written).toHaveLength(1);
    expect(state.figures[0].storedName).toBe(state.figures[1].storedName);
    expect(state.figures[0].figKey).not.toBe(state.figures[1].figKey);
  });

  it('writes ONE Logbook row per upload', async () => {
    await upload(pngBytes());
    expect(state.logs.map((l) => l.action)).toEqual(['FIGURE_UPLOADED']);
    expect(state.logs[0].resourceType).toBe('manuscriptFigure');
  });
});

describe('119.md §5 — replace keeps the figure identity', () => {
  it('rewrites the bytes on the SAME row and key, and keeps the superseded file', async () => {
    const up = await upload(pngBytes(10, 10));
    const before = up.body.figure;
    const s = res();
    await C.replaceFigure(req({
      params: { id: 'ml1', figureId: before.id },
      file: { buffer: gifBytes(40, 30), originalname: 'new.gif' },
      figureCapBytes: 12 * 1024 * 1024,
    }), s);
    expect(s.statusCode).toBe(200);
    expect(s.body.figure.id).toBe(before.id);
    expect(s.body.figure.figKey).toBe(before.figKey);      // ← the whole point
    expect(s.body.figure.mimeType).toBe('image/gif');
    expect(s.body.figure.width).toBe(40);
    expect(s.body.figure.replacedCount).toBe(1);
    expect(s.body.figure.previousFileName).toBe('flow.png');
    // §5 "Version/replacement history" — the old file is NOT unlinked.
    expect(state.unlinked).toHaveLength(0);
    expect(state.logs.map((l) => l.action)).toContain('FIGURE_REPLACED');
  });

  it('identical bytes are a no-op, not a fake new version', async () => {
    const up = await upload(pngBytes(10, 10));
    const s = res();
    await C.replaceFigure(req({
      params: { id: 'ml1', figureId: up.body.figure.id },
      file: { buffer: pngBytes(10, 10), originalname: 'again.png' },
      figureCapBytes: 12 * 1024 * 1024,
    }), s);
    expect(s.body.unchanged).toBe(true);
    expect(s.body.figure.replacedCount).toBe(0);
  });
});

describe('119.md §5 — delete only when unreferenced (what makes undo safe)', () => {
  const withProse = (md) => {
    state.project = {
      id: 'ml1',
      data: JSON.stringify({ manuscripts: [{ id: 'd1', sections: { results: { content: md } } }] }),
    };
  };

  it('counts placements and cross-references separately', () => {
    const data = { manuscripts: [{ sections: { results: { content: '[[figcap:fa1]] F\n\nsee [[figure:fa1]] and [[figure:fa1]]' } } }] };
    expect(C.figureUsageInBlob(data, 'fa1')).toEqual({ placements: 1, references: 2, total: 3 });
    expect(C.figureUsageInBlob(data, 'other')).toEqual({ placements: 0, references: 0, total: 0 });
  });

  it('REFUSES to delete a figure that is still placed, and says why', async () => {
    const up = await upload(pngBytes());
    withProse(`[[figcap:${up.body.figure.figKey}]] Study flow`);
    const s = res();
    await C.deleteFigure(req({ params: { id: 'ml1', figureId: up.body.figure.id } }), s);
    expect(s.statusCode).toBe(409);
    expect(s.body.usage.placements).toBe(1);
    expect(state.figures).toHaveLength(1);
    expect(state.unlinked).toHaveLength(0);   // the bytes an undo would need survive
  });

  it('REFUSES while only a cross-reference remains (the marker is already gone)', async () => {
    const up = await upload(pngBytes());
    withProse(`see [[figure:${up.body.figure.figKey}]]`);
    const s = res();
    await C.deleteFigure(req({ params: { id: 'ml1', figureId: up.body.figure.id } }), s);
    expect(s.statusCode).toBe(409);
    expect(s.body.usage).toMatchObject({ placements: 0, references: 1 });
  });

  it('deletes row AND file once nothing points at it', async () => {
    const up = await upload(pngBytes());
    withProse('no figures here');
    const s = res();
    await C.deleteFigure(req({ params: { id: 'ml1', figureId: up.body.figure.id } }), s);
    expect(s.statusCode).toBe(200);
    expect(state.figures).toHaveLength(0);
    expect(state.unlinked).toHaveLength(1);
    expect(state.logs.map((l) => l.action)).toContain('FIGURE_DELETED');
  });

  it('keeps a file another figure still shares (reference-counted deletes)', async () => {
    const a = await upload(pngBytes(10, 10));
    await upload(pngBytes(10, 10));           // deduped twin, same storedName
    withProse('nothing');
    const s = res();
    await C.deleteFigure(req({ params: { id: 'ml1', figureId: a.body.figure.id } }), s);
    expect(s.statusCode).toBe(200);
    expect(state.unlinked).toHaveLength(0);
  });
});

describe('119.md §5 — the raw route', () => {
  it('serves a strong ETag from the content hash and answers a match with 304', async () => {
    const up = await upload(pngBytes());
    const hash = up.body.figure.fileHash;
    const s = res();
    await C.rawFigure(req({ params: { id: 'ml1', figureId: up.body.figure.id }, headers: { 'if-none-match': `"${hash}"` } }), s);
    expect(s.statusCode).toBe(304);
    expect(s.headers.etag).toBe(`"${hash}"`);
    expect(s.headers['cache-control']).toContain('must-revalidate');
    expect(s.headers['x-content-type-options']).toBe('nosniff');
  });

  it('pins the response to the SNIFFED type, never the declared one', async () => {
    const up = await upload(gifBytes(), { file: { buffer: gifBytes(), originalname: 'lies.png' } });
    const s = res();
    await C.rawFigure(req({ params: { id: 'ml1', figureId: up.body.figure.id } }), s);
    expect(s.headers['content-type']).toBe('image/gif');
  });
});
