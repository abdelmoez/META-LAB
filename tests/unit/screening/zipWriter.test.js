/**
 * 97.md Phase 2 — server/utils/zip.js round-trip tests. The zero-dependency,
 * sink-streaming ZIP builder (STORE + raw-DEFLATE via node:zlib) is verified by
 * READING its output with jszip (devDependency, read-only — same pattern as
 * tests/unit/manuscript/exportFigures.test.js), including CRC validation.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { crc32, createZipBuilder, zipToBuffer } from '../../../server/utils/zip.js';

const DATE = new Date('2026-08-02T10:20:30Z');

async function load(buffer) {
  // checkCRC32 forces jszip to verify every entry's CRC on extraction.
  return JSZip.loadAsync(buffer, { checkCRC32: true });
}

describe('crc32', () => {
  it('matches the IEEE reference vector', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
  it('empty input → 0', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('zipToBuffer — jszip round-trip', () => {
  it('stores + deflates entries readably (auto method), utf8 names included', async () => {
    const text = 'screening decisions '.repeat(200); // compressible
    const zip = await load(await zipToBuffer([
      { name: 'references-and-screening-decisions.csv', data: text },
      { name: 'ünïcode-ñame.txt', data: 'héllo wörld' },
      { name: 'empty.txt', data: '' },
    ], { date: DATE }));
    expect(Object.keys(zip.files).sort()).toEqual([
      'empty.txt', 'references-and-screening-decisions.csv', 'ünïcode-ñame.txt',
    ]);
    expect(await zip.file('references-and-screening-decisions.csv').async('string')).toBe(text);
    expect(await zip.file('ünïcode-ñame.txt').async('string')).toBe('héllo wörld');
    expect(await zip.file('empty.txt').async('string')).toBe('');
  });

  it('auto method deflates compressible text (smaller than raw)', async () => {
    const text = 'abcdefghij '.repeat(5000);
    const buffer = await zipToBuffer([{ name: 'a.txt', data: text }], { date: DATE });
    expect(buffer.length).toBeLessThan(Buffer.byteLength(text));
    const zip = await load(buffer);
    expect(await zip.file('a.txt').async('string')).toBe(text);
  });

  it('auto method falls back to STORE for incompressible bytes (never grows the entry)', async () => {
    // Deterministic pseudo-random bytes — raw deflate of noise is LARGER than the input.
    const bytes = Buffer.alloc(4096);
    let x = 42;
    for (let i = 0; i < bytes.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; bytes[i] = x & 0xff; }
    const buffer = await zipToBuffer([{ name: 'noise.bin', data: bytes }], { date: DATE });
    // STORE overhead is header + central dir + EOCD only (name 'noise.bin' ×2).
    expect(buffer.length).toBeLessThanOrEqual(bytes.length + 30 + 46 + 22 + 2 * 'noise.bin'.length);
    const zip = await load(buffer);
    expect(Buffer.from(await zip.file('noise.bin').async('uint8array'))).toEqual(bytes);
  });

  it('explicit store method keeps the entry byte-identical and readable', async () => {
    const buffer = await zipToBuffer([{ name: 's.txt', data: 'store me', method: 'store' }], { date: DATE });
    const zip = await load(buffer);
    expect(await zip.file('s.txt').async('string')).toBe('store me');
  });
});

describe('createZipBuilder — streaming sink contract', () => {
  it('streams entry bytes to the sink as entries are added (never one final buffer)', async () => {
    const chunks = [];
    const zip = createZipBuilder({ write: (c) => { chunks.push(c); }, date: DATE });
    const afterNothing = chunks.length;
    await zip.addEntry('one.txt', 'first member');
    const afterFirst = chunks.length;
    await zip.addEntry('two.txt', 'second member');
    const afterSecond = chunks.length;
    const { entries, totalBytes } = await zip.finalize();

    expect(afterNothing).toBe(0);
    expect(afterFirst).toBeGreaterThan(0);           // first entry hit the sink immediately
    expect(afterSecond).toBeGreaterThan(afterFirst); // second entry appended incrementally
    expect(entries).toBe(2);
    const buffer = Buffer.concat(chunks);
    expect(buffer.length).toBe(totalBytes);
    const read = await load(buffer);
    expect(await read.file('one.txt').async('string')).toBe('first member');
    expect(await read.file('two.txt').async('string')).toBe('second member');
  });

  it('refuses addEntry after finalize and double finalize', async () => {
    const zip = createZipBuilder({ write: () => {}, date: DATE });
    await zip.addEntry('a.txt', 'x');
    await zip.finalize();
    await expect(zip.addEntry('b.txt', 'y')).rejects.toThrow(/finalize/);
    await expect(zip.finalize()).rejects.toThrow(/twice/);
  });

  it('requires a write sink and entry names', async () => {
    expect(() => createZipBuilder({})).toThrow(/write/);
    const zip = createZipBuilder({ write: () => {}, date: DATE });
    await expect(zip.addEntry('', 'x')).rejects.toThrow(/name/);
  });
});

describe('createZipBuilder — streamed (async-iterable) entries, 97.md M1', () => {
  it('a paged async generator round-trips byte-identically with CRC checks (bit-3 descriptor entry)', async () => {
    const pages = Array.from({ length: 40 }, (_, i) => `page ${i}: ` + 'screening row data '.repeat(200) + '\n');
    const chunks = [];
    const zip = createZipBuilder({ write: (c) => { chunks.push(c); }, date: DATE });
    const meta = await zip.addEntry('streamed.csv', (async function* () {
      for (const p of pages) yield Buffer.from(p, 'utf8');
    })());
    await zip.finalize();

    expect(meta.method).toBe(8); // streamed entries always DEFLATE
    expect(meta.size).toBe(Buffer.byteLength(pages.join('')));
    expect(meta.compressedSize).toBeLessThan(meta.size);
    const read = await load(Buffer.concat(chunks));
    expect(await read.file('streamed.csv').async('string')).toBe(pages.join(''));
  });

  it('streams member bytes to the sink incrementally — never one whole-member buffer', async () => {
    // Incompressible noise so the deflated output is member-sized and MUST arrive
    // as many bounded chunks (compressible text could legally arrive as one tiny one).
    const PAGE_BYTES = 64 * 1024;
    const page = Buffer.alloc(PAGE_BYTES);
    let x = 7;
    for (let i = 0; i < page.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; page[i] = x & 0xff; }
    const sizes = [];
    const chunks = [];
    const zip = createZipBuilder({ write: (c) => { sizes.push(c.length); chunks.push(c); }, date: DATE });
    await zip.addEntry('big.txt', (async function* () {
      for (let i = 0; i < 64; i++) yield page; // ~4 MB member
    })());
    await zip.finalize();
    // No single sink write ever approaches the member size: the deflater emits
    // bounded output chunks (zlib readable highWaterMark), proving the member is
    // never concatenated in memory before hitting the sink.
    expect(Math.max(...sizes)).toBeLessThan(256 * 1024);
    expect(sizes.length).toBeGreaterThan(10);
    const read = await load(Buffer.concat(chunks));
    expect((await read.file('big.txt').async('uint8array')).length).toBe(page.length * 64);
  });

  it('a source that fails before its first chunk leaves the archive untouched (clean member skip)', async () => {
    const chunks = [];
    const zip = createZipBuilder({ write: (c) => { chunks.push(c); }, date: DATE });
    await zip.addEntry('first.txt', 'kept');
    const before = Buffer.concat(chunks).length;
    await expect(zip.addEntry('doomed.ris', (async function* () {
      throw new Error('renderer exploded');
      yield Buffer.from('never'); // eslint-disable-line no-unreachable
    })())).rejects.toThrow(/renderer exploded/);
    expect(Buffer.concat(chunks).length).toBe(before); // not a byte was written
    await zip.addEntry('after.txt', 'still fine');
    await zip.finalize();
    const read = await load(Buffer.concat(chunks));
    expect(Object.keys(read.files).sort()).toEqual(['after.txt', 'first.txt']);
    expect(await read.file('after.txt').async('string')).toBe('still fine');
  });

  it('a mid-stream failure propagates and the entry is never registered; the archive stays readable', async () => {
    const chunks = [];
    const zip = createZipBuilder({ write: (c) => { chunks.push(c); }, date: DATE });
    await expect(zip.addEntry('partial.txt', (async function* () {
      yield Buffer.from('some bytes went out ');
      throw new Error('db died mid-page');
    })())).rejects.toThrow(/db died mid-page/);
    await zip.addEntry('ok.txt', 'complete member');
    await zip.finalize();
    // Dead bytes from the aborted entry are ignored by central-directory readers.
    const read = await load(Buffer.concat(chunks));
    expect(Object.keys(read.files)).toEqual(['ok.txt']);
    expect(await read.file('ok.txt').async('string')).toBe('complete member');
  });

  it('an empty streamed source still produces a valid empty member', async () => {
    const chunks = [];
    const zip = createZipBuilder({ write: (c) => { chunks.push(c); }, date: DATE });
    await zip.addEntry('empty-stream.txt', (async function* () {})());
    await zip.finalize();
    const read = await load(Buffer.concat(chunks));
    expect(await read.file('empty-stream.txt').async('string')).toBe('');
  });

  it('buffered and streamed entries coexist in one archive', async () => {
    const chunks = [];
    const zip = createZipBuilder({ write: (c) => { chunks.push(c); }, date: DATE });
    await zip.addEntry('readme.txt', 'plain buffered member');
    await zip.addEntry('data.json', (async function* () {
      yield '{"rows":[';
      yield '1,2,3';
      yield ']}';
    })());
    await zip.finalize();
    const read = await load(Buffer.concat(chunks));
    expect(await read.file('readme.txt').async('string')).toBe('plain buffered member');
    expect(await read.file('data.json').async('string')).toBe('{"rows":[1,2,3]}');
  });
});
