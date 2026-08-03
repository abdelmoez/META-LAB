/**
 * 97.md Phase 2 — server/utils/filenames.js: cross-OS-safe screening export
 * filename (`project-title-screening-export-YYYY-MM-DD.zip`) + the safeFilePart
 * sanitizer (server-side port of exportCore.js semantics).
 */
import { describe, it, expect } from 'vitest';
import { safeFilePart, isoDatePart, screeningExportFilename } from '../../../server/utils/filenames.js';

describe('safeFilePart', () => {
  it('lowercases and collapses every non-alphanumeric run to a single dash', () => {
    expect(safeFilePart('My Project: EUS/BD (2026)')).toBe('my-project-eus-bd-2026');
    expect(safeFilePart('  A   B  ')).toBe('a-b');
    expect(safeFilePart('Ünïcode — reviewers & <script>')).toBe('n-code-reviewers-script');
  });
  it('strips leading/trailing dashes and caps at 60 chars', () => {
    expect(safeFilePart('---x---')).toBe('x');
    const long = 'a'.repeat(200);
    expect(safeFilePart(long)).toBe('a'.repeat(60));
  });
  it('empty / symbol-only input falls back', () => {
    expect(safeFilePart('')).toBe('file');
    expect(safeFilePart('???', 'project')).toBe('project');
    expect(safeFilePart(null, 'project')).toBe('project');
  });
  it('neutralizes Windows-reserved and path characters', () => {
    const out = safeFilePart('con<>:"/\\|?*.zip');
    expect(out).not.toMatch(/[<>:"/\\|?*]/);
  });
});

describe('screeningExportFilename', () => {
  const date = new Date('2026-08-02T23:59:59Z');
  it('follows the 97.md convention', () => {
    expect(screeningExportFilename('My Project', date)).toBe('my-project-screening-export-2026-08-02.zip');
  });
  it('sanitizes hostile titles', () => {
    expect(screeningExportFilename('EUS/BD: a "review"?', date)).toBe('eus-bd-a-review-screening-export-2026-08-02.zip');
  });
  it('falls back for blank titles', () => {
    expect(screeningExportFilename('', date)).toBe('project-screening-export-2026-08-02.zip');
  });
  it('isoDatePart is UTC-stable YYYY-MM-DD', () => {
    expect(isoDatePart(date)).toBe('2026-08-02');
  });
});
