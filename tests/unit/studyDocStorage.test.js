/**
 * 77.md §5 — pure guards for the study-document store. isSafeStoredName is the
 * path-traversal defence for the blob-anchored storedName pointer.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { isPdfBuffer, sha256, isSafeStoredName } from '../../server/studyDocs/studyDocStorage.js';

describe('isPdfBuffer', () => {
  it('accepts a real PDF header and rejects everything else', () => {
    expect(isPdfBuffer(Buffer.from('%PDF-1.7\n...'))).toBe(true);
    expect(isPdfBuffer(Buffer.from('not a pdf'))).toBe(false);
    expect(isPdfBuffer(Buffer.from(''))).toBe(false);
    expect(isPdfBuffer(null)).toBe(false);
  });
});

describe('sha256', () => {
  it('is a deterministic 64-hex digest', () => {
    const a = sha256(Buffer.from('hello'));
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256(Buffer.from('hello'))).toBe(a);
    expect(sha256(Buffer.from('world'))).not.toBe(a);
  });
});

describe('isSafeStoredName (path-traversal guard)', () => {
  it('accepts a server-generated <uuid>.pdf', () => {
    expect(isSafeStoredName(`${randomUUID()}.pdf`)).toBe(true);
  });
  it('rejects traversal, absolute, and non-pdf names', () => {
    for (const bad of ['../../etc/passwd', '../secret.pdf', '/etc/passwd', 'foo/bar.pdf', 'x.pdf', 'a'.repeat(36) + '.exe', '', null, undefined, 42]) {
      expect(isSafeStoredName(bad)).toBe(false);
    }
  });
});
