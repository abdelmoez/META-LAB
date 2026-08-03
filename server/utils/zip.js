/**
 * server/utils/zip.js — zero-dependency, Buffer-emitting ZIP builder (97.md Phase 2).
 *
 * Port of the hand-rolled STORE writer in src/frontend/components/exportCore.js
 * (prompt42 Task 8) to a server-side, sink-streaming builder — the repo deliberately
 * keeps a tiny dependency footprint, so the screening ZIP export reuses this instead
 * of adding archiver/jszip to production deps (jszip stays a devDependency used only
 * by tests to READ the produced archives).
 *
 * Extensions over the client writer (97.md plan §2b, Decision E2):
 *  - method-8 raw DEFLATE — abstract-heavy CSV/JSON members at STORE would multiply
 *    download size. Buffered entries use 'auto' (keep whichever of STORE/DEFLATE is
 *    smaller); streamed entries always DEFLATE.
 *  - TRUE member streaming: addEntry also accepts an async (or sync) iterable of
 *    chunks. Streamed entries use a general-purpose bit-3 local header (sizes/CRC
 *    deferred to a trailing data descriptor), pipe chunks through a streaming
 *    zlib.createDeflateRaw (async, off the JS thread), and compute CRC-32
 *    incrementally — so the bound is ONE CHUNK at a time, never a whole member,
 *    and the event loop is never blocked by a synchronous deflate of a large body.
 *  - streaming to an async sink: every archive byte is written to `write(buffer)`
 *    in order as it is produced; finalize() appends the central directory. The
 *    archive is never assembled in memory.
 *  - Buffered (Buffer/string) entries still deflate ASYNCHRONOUSLY (zlib.deflateRaw)
 *    so even small-member compression never blocks the event loop.
 *
 * Failure semantics for streamed entries: the local header is deferred until the
 * source produces its first chunk, so a source that fails BEFORE yielding anything
 * leaves the archive byte-identical (the caller can skip the member cleanly — the
 * screening export uses this for the optional RIS member). A source that fails
 * MID-STREAM leaves already-written bytes as dead space that central-directory
 * readers ignore (the entry is never registered), and the error propagates.
 *
 * Layering rule: the server never imports from src/frontend/** — this module is the
 * server-side home of the ZIP logic; the client exportCore.js copy stays untouched.
 */
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { once } from 'node:events';

const deflateRawAsync = promisify(zlib.deflateRaw);

// CRC-32 (IEEE) with a cached lookup table — required by the ZIP spec per entry.
let _crcTable = null;
function crcTable() {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  _crcTable = t;
  return t;
}

/**
 * Incremental CRC-32 step over the RUNNING (pre-final-xor) state. Seed with
 * 0xffffffff, feed chunks in order, then finish with `^ 0xffffffff >>> 0`.
 * Exported so streaming callers/tests can share the exact table.
 */
export function crc32Step(state, bytes) {
  const t = crcTable();
  let crc = state;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ t[(crc ^ bytes[i]) & 0xff];
  return crc >>> 0;
}

/** CRC-32 of a whole Buffer/Uint8Array (ZIP spec, IEEE polynomial). */
export function crc32(bytes) {
  return (crc32Step(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  return { dosDate: date & 0xffff, dosTime: time & 0xffff };
}

// Classic (non-ZIP64) format limits. The screening export is far below these in
// practice; hitting them fails loudly instead of writing a corrupt archive.
const MAX_UINT32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const FLAG_UTF8 = 0x0800;       // general purpose bit 11: UTF-8 names
const FLAG_DESCRIPTOR = 0x0008; // general purpose bit 3: sizes/CRC in a data descriptor

/** True when `data` should take the streaming path (any non-Buffer iterable). */
function isStreamSource(data) {
  return data != null && typeof data !== 'string' && !Buffer.isBuffer(data)
    && (typeof data[Symbol.asyncIterator] === 'function' || typeof data[Symbol.iterator] === 'function');
}

/**
 * Create a streaming ZIP builder over an async byte sink.
 *
 * @param {object} o
 * @param {(chunk: Buffer) => Promise<void>|void} o.write — receives every archive byte in order
 * @param {Date} [o.date] — timestamp stamped on all entries (default now)
 * @returns {{
 *   addEntry: (name: string, data: Buffer|string|AsyncIterable<Buffer|string>|Iterable<Buffer|string>, opts?: {method?: 'auto'|'store'|'deflate'}) => Promise<{name:string, method:number, size:number, compressedSize:number}>,
 *   finalize: () => Promise<{entries:number, totalBytes:number}>,
 * }}
 */
export function createZipBuilder({ write, date } = {}) {
  if (typeof write !== 'function') throw new Error('createZipBuilder requires a write(chunk) sink');
  const { dosDate, dosTime } = dosDateTime(date || new Date());
  const central = []; // per-entry metadata for the central directory
  let offset = 0;
  let finalized = false;

  const emit = async (buf) => { await write(buf); offset += buf.length; };

  /** Buffered entry: sizes/CRC known up front — classic local header, no descriptor. */
  async function addBufferedEntry(nameBytes, raw, method) {
    const crc = crc32(raw);

    let stored = raw;
    let usedMethod = METHOD_STORE;
    if (method !== 'store') {
      // Async deflate — even the buffered path never blocks the event loop.
      const deflated = await deflateRawAsync(raw);
      // 'auto' keeps the smaller encoding; explicit 'deflate' always compresses.
      if (method === 'deflate' || deflated.length < raw.length) {
        stored = deflated;
        usedMethod = METHOD_DEFLATE;
      }
    }
    if (raw.length > MAX_UINT32 || stored.length > MAX_UINT32) {
      throw new Error('zip entry too large (ZIP64 is not supported)');
    }

    const entryOffset = offset;
    if (entryOffset > MAX_UINT32) throw new Error('zip archive too large (ZIP64 is not supported)');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(FLAG_UTF8, 6);
    lh.writeUInt16LE(usedMethod, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(stored.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28);            // extra length
    await emit(lh);
    await emit(nameBytes);
    await emit(stored);

    central.push({ nameBytes, crc, method: usedMethod, flags: FLAG_UTF8, size: raw.length, compressedSize: stored.length, offset: entryOffset });
    return { name: nameBytes.toString('utf8'), method: usedMethod, size: raw.length, compressedSize: stored.length };
  }

  /**
   * Streamed entry (bounded memory): bit-3 local header (sizes/CRC follow in the
   * trailing data descriptor + central directory), chunks piped through a streaming
   * DEFLATE, CRC computed incrementally. The local header is deferred until the
   * FIRST source chunk so an immediately-failing source leaves the archive intact.
   */
  async function addStreamingEntry(nameBytes, source) {
    let entryOffset = 0;
    let headerWritten = false;
    const writeHeader = async () => {
      entryOffset = offset;
      if (entryOffset > MAX_UINT32) throw new Error('zip archive too large (ZIP64 is not supported)');
      const lh = Buffer.alloc(30); // crc/sizes stay 0 — bit 3 defers them to the descriptor
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(FLAG_UTF8 | FLAG_DESCRIPTOR, 6);
      lh.writeUInt16LE(METHOD_DEFLATE, 8);
      lh.writeUInt16LE(dosTime, 10);
      lh.writeUInt16LE(dosDate, 12);
      lh.writeUInt16LE(nameBytes.length, 26);
      lh.writeUInt16LE(0, 28);
      await emit(lh);
      await emit(nameBytes);
      headerWritten = true;
    };

    const deflater = zlib.createDeflateRaw();
    let crcState = 0xffffffff;
    let size = 0;
    let compressedSize = 0;
    let sourceError = null;

    // Producer: feed source chunks into the deflater (writable side, with drain
    // backpressure). All producer emits (the header) complete BEFORE the first
    // deflater.write, so header bytes always precede data bytes at the sink.
    const producer = (async () => {
      try {
        for await (const chunk of source) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk == null ? '' : String(chunk), 'utf8');
          if (!buf.length) continue;
          if (!headerWritten) await writeHeader();
          crcState = crc32Step(crcState, buf);
          size += buf.length;
          if (size > MAX_UINT32) throw new Error('zip entry too large (ZIP64 is not supported)');
          if (!deflater.write(buf)) await once(deflater, 'drain');
        }
        if (!headerWritten) await writeHeader(); // an empty source is still a member
        deflater.end();
      } catch (e) {
        sourceError = sourceError || e;
        deflater.destroy(e);
      }
    })();

    // Consumer: drain deflater output to the sink as it is produced (for-await
    // handles readable-side backpressure — one zlib output chunk at a time).
    try {
      for await (const out of deflater) {
        compressedSize += out.length;
        if (compressedSize > MAX_UINT32) throw new Error('zip entry too large (ZIP64 is not supported)');
        await emit(out);
      }
    } catch (e) {
      sourceError = sourceError || e;
    }
    await producer;
    if (sourceError) throw sourceError;

    const crc = (crcState ^ 0xffffffff) >>> 0;
    // Data descriptor with the de-facto-standard signature (what streaming zip
    // writers emit; readers navigate via the central directory regardless).
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0);
    dd.writeUInt32LE(crc, 4);
    dd.writeUInt32LE(compressedSize, 8);
    dd.writeUInt32LE(size, 12);
    await emit(dd);

    central.push({ nameBytes, crc, method: METHOD_DEFLATE, flags: FLAG_UTF8 | FLAG_DESCRIPTOR, size, compressedSize, offset: entryOffset });
    return { name: nameBytes.toString('utf8'), method: METHOD_DEFLATE, size, compressedSize };
  }

  async function addEntry(name, data, { method = 'auto' } = {}) {
    if (finalized) throw new Error('addEntry after finalize');
    if (!name) throw new Error('zip entry needs a name');
    if (central.length >= MAX_ENTRIES) throw new Error('zip entry limit exceeded');
    const nameBytes = Buffer.from(String(name), 'utf8');
    if (isStreamSource(data)) return addStreamingEntry(nameBytes, data);
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data == null ? '' : String(data), 'utf8');
    return addBufferedEntry(nameBytes, raw, method);
  }

  async function finalize() {
    if (finalized) throw new Error('finalize called twice');
    finalized = true;
    const centralStart = offset;
    for (const f of central) {
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(20, 4);          // version made by
      ch.writeUInt16LE(20, 6);          // version needed
      ch.writeUInt16LE(f.flags ?? FLAG_UTF8, 8);
      ch.writeUInt16LE(f.method, 10);
      ch.writeUInt16LE(dosTime, 12);
      ch.writeUInt16LE(dosDate, 14);
      ch.writeUInt32LE(f.crc, 16);
      ch.writeUInt32LE(f.compressedSize, 20);
      ch.writeUInt32LE(f.size, 24);
      ch.writeUInt16LE(f.nameBytes.length, 28);
      // extra/comment/disk/internal attrs (30..37) all zero
      ch.writeUInt32LE(0, 38);          // external attrs
      ch.writeUInt32LE(f.offset, 42);
      await emit(ch);
      await emit(f.nameBytes);
    }
    const centralSize = offset - centralStart;
    if (offset + 22 > MAX_UINT32) throw new Error('zip archive too large (ZIP64 is not supported)');
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralStart, 16);
    eocd.writeUInt16LE(0, 20);
    await emit(eocd);
    return { entries: central.length, totalBytes: offset };
  }

  return { addEntry, finalize };
}

/**
 * Convenience: build a whole archive into one Buffer (small archives + tests).
 * @param {Array<{name:string, data:Buffer|string, method?:'auto'|'store'|'deflate'}>} entries
 * @param {{date?: Date}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function zipToBuffer(entries, { date } = {}) {
  const chunks = [];
  const zip = createZipBuilder({ write: (c) => { chunks.push(c); }, date });
  for (const e of entries || []) {
    if (!e || !e.name) continue;
    await zip.addEntry(e.name, e.data, { method: e.method || 'auto' });
  }
  await zip.finalize();
  return Buffer.concat(chunks);
}
