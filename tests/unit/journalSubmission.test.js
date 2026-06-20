/**
 * journalSubmission.test.js — prompt42 Task 8. Pure helpers for the one-click
 * journal-submission ZIP: the zero-dep ZIP writer (exportCore), outcome
 * enumeration + study-table CSV + README/manifest/warnings, and the methods-text
 * generator. No browser/network — all pure.
 */
import { describe, it, expect } from 'vitest';
import { crc32, zipFiles, safeFilePart } from '../../src/frontend/components/exportCore.js';
import {
  getOutcomePairs, filterStudiesForOutcome, buildStudyTableCSV,
  buildReadmeMarkdown, buildManifest, buildWarningsText, safeName,
} from '../../src/research-engine/import-export/journalSubmission.js';
import { buildMethodsMarkdown } from '../../src/research-engine/docs/methodsText.js';

const enc = (s) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches known CRC-32 (IEEE) values', () => {
    expect(crc32(enc(''))).toBe(0);
    expect(crc32(enc('abc'))).toBe(0x352441c2);       // canonical
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('zipFiles (zero-dep STORE ZIP)', () => {
  it('produces a valid ZIP blob with the PK signature + EOCD', async () => {
    const blob = await zipFiles([
      { name: 'a.txt', text: 'hello' },
      { name: 'dir/b.json', text: '{"x":1}' },
    ], { date: new Date('2020-01-02T03:04:05Z') });
    expect(blob.type).toBe('application/zip');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Local file header signature "PK\x03\x04"
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End-of-central-directory signature "PK\x05\x06" near the end
    const tail = bytes.slice(-22);
    expect([tail[0], tail[1], tail[2], tail[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    // 2 entries recorded in the EOCD (offsets 8 and 10, little-endian)
    expect(tail[8] | (tail[9] << 8)).toBe(2);
    expect(tail[10] | (tail[11] << 8)).toBe(2);
  });
  it('accepts a Blob entry (binary payload)', async () => {
    const inner = new Blob([new Uint8Array([1, 2, 3, 4])]);
    const blob = await zipFiles([{ name: 'bin', blob: inner }]);
    expect(blob.size).toBeGreaterThan(22);
  });
  it('skips entries without a name', async () => {
    const blob = await zipFiles([{ text: 'x' }, { name: 'ok.txt', text: 'y' }]);
    const tail = new Uint8Array(await blob.arrayBuffer()).slice(-22);
    expect(tail[8] | (tail[9] << 8)).toBe(1);
  });
});

describe('safeFilePart / safeName', () => {
  it('slugifies to filesystem-safe lowercase', () => {
    expect(safeFilePart('Mortality @ 6 months')).toBe('mortality-6-months');
    expect(safeName('Clinical Success!!')).toBe('clinical-success');
    expect(safeName('', 'outcome-1')).toBe('outcome-1');
  });
});

const STUDIES = [
  { id: 's1', author: 'Smith', authors: 'Smith J, Lee K', year: '2020', title: 'Trial A', journal: 'NEJM', country: 'US', design: 'RCT', outcome: 'Mortality', timepoint: '6mo', esType: 'RR', es: '0.8', lo: '0.6', hi: '1.0', n: '200' },
  { id: 's2', author: 'Jones', year: '2021', title: 'Trial B', outcome: 'Mortality', timepoint: '6mo', esType: 'RR', es: '0.7', lo: '0.5', hi: '0.95', nExp: '50', nCtrl: '50' },
  { id: 's3', author: 'Wu', year: '2019', title: 'Trial C', outcome: 'Clinical success', esType: 'OR', es: '1.4', lo: '1.1', hi: '1.8' },
  { id: 's4', author: 'NoES', year: '2018', outcome: 'Mortality', es: '' }, // excluded (no numeric ES)
];

describe('getOutcomePairs / filterStudiesForOutcome', () => {
  it('enumerates distinct outcome+timepoint pairs with numeric ES only', () => {
    const pairs = getOutcomePairs(STUDIES);
    expect(pairs.map(p => p.outcome).sort()).toEqual(['Clinical success', 'Mortality']);
    const mort = pairs.find(p => p.outcome === 'Mortality');
    expect(mort.timepoint).toBe('6mo');
    expect(filterStudiesForOutcome(STUDIES, mort).map(s => s.id)).toEqual(['s1', 's2']);
  });
  it('labels by name (+timepoint)', () => {
    const pairs = getOutcomePairs(STUDIES);
    expect(pairs.find(p => p.outcome === 'Mortality').label).toBe('Mortality @ 6mo');
  });
});

describe('buildStudyTableCSV', () => {
  it('emits a BOM header + one row per study with the required columns', () => {
    const csv = buildStudyTableCSV(STUDIES, { s1: 'Low' });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.replace(/^﻿/, '').split('\n');
    expect(lines[0]).toContain('Title');
    expect(lines[0]).toContain('Risk of bias');
    expect(lines.length).toBe(1 + STUDIES.length);
    expect(lines[1]).toContain('Smith J, Lee K');
    expect(lines[1]).toContain('Low');     // RoB summary injected
    expect(lines[1]).toContain('200');     // sample size from n
    expect(lines[2]).toContain('100');     // sample size derived from nExp+nCtrl
  });
});

describe('README / manifest / warnings', () => {
  it('README lists files and warnings', () => {
    const md = buildReadmeMarkdown({ projectName: 'P', appVersion: '3.25.0', files: [{ name: 'a.svg', note: 'fig' }], warnings: ['missing X'] });
    expect(md).toContain('# Journal submission package — P');
    expect(md).toContain('`a.svg`');
    expect(md).toContain('⚠ missing X');
  });
  it('manifest maps included files to names', () => {
    const m = buildManifest({ projectId: 'p1', includedFiles: [{ name: 'a' }, 'b'], warnings: ['w'] });
    expect(m.includedFiles).toEqual(['a', 'b']);
    expect(m.warnings).toEqual(['w']);
  });
  it('warnings.txt has a friendly empty state', () => {
    expect(buildWarningsText([])).toMatch(/No warnings/);
    expect(buildWarningsText(['a', 'b'])).toBe('- a\n- b\n');
  });
});

describe('buildMethodsMarkdown', () => {
  it('renders accurate statements from the context and marks gaps', () => {
    const md = buildMethodsMarkdown({
      projectName: 'My SR', software: 'META·LAB 3.25.0',
      pico: { P: 'adults', I: 'drug', C: 'placebo', O: 'mortality' },
      measure: 'Risk ratio', model: 'random', hksj: true, k: 8,
      heterogeneity: { I2: 42, tau2: '0.03', Q: '12.1', Qdf: 7, Qp: '0.10' },
      outcomes: ['Mortality', 'Clinical success'], robTool: 'Cochrane RoB 2', grade: true,
    });
    expect(md).toContain('# Methods — My SR');
    expect(md).toContain('DerSimonian–Laird random-effects model');
    expect(md).toContain('Hartung–Knapp–Sidik–Jonkman');
    expect(md).toContain('I² = 42%');
    expect(md).toContain('Cochrane RoB 2');
    expect(md).toContain('GRADE');
    // databases not provided → placeholder, not fabricated
    expect(md).toContain('[not recorded — please complete]');
  });
  it('uses the fixed-effect wording when model=fixed', () => {
    const md = buildMethodsMarkdown({ model: 'fixed' });
    expect(md).toContain('inverse-variance common (fixed) effect model');
  });
});
