/**
 * 97.md M33 — SSR-render tests for the flagship Phase 2 surface: the ExportTab
 * "Download screening file (ZIP)" card (src/frontend/screening/tabs/ExportTab.jsx,
 * exported as the presentational ZipExportCard). Uses renderToStaticMarkup (the
 * repo's component-test style — no jsdom, no network). States covered:
 *  - idle copy: format categories + the no-universal-compatibility disclaimer;
 *  - empty project: button disabled + "Import records before exporting.";
 *  - running: "Preparing…" + live progress status;
 *  - completed: note + persistent re-download link with the job's download URL;
 *  - warning banner when the job finished with partial-failure warnings;
 *  - the GENERIC banner fallback when warningCount > 0 but the texts were lost.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ZipExportCard, ZIP_CONTENTS, GENERIC_ZIP_WARNING } from '../../../src/frontend/screening/tabs/ExportTab.jsx';

const render = (props = {}) => renderToStaticMarkup(createElement(ZipExportCard, { onDownload: () => {}, ...props }));

describe('ZipExportCard — idle copy (97.md format categories, honest compatibility)', () => {
  const html = render();

  it('renders the headline action enabled', () => {
    expect(html).toContain('Download screening file');
    expect(html).toContain('↓ Download screening file (ZIP)');
    expect(html).not.toContain('disabled');
  });

  it('lists all three format categories with researcher-facing descriptions', () => {
    expect(ZIP_CONTENTS.length).toBe(3);
    expect(html).toContain('References and decisions (CSV)');
    expect(html).toContain('References (RIS)');
    expect(html).toContain('Complete screening backup (JSON)');
    expect(html).toContain('Zotero');
  });

  it('names example spreadsheet tools and never claims universal compatibility', () => {
    expect(html).toContain('Google Sheets');
    expect(html).toContain('LibreOffice');
    expect(html).not.toMatch(/any spreadsheet/i);
  });

  it('carries the PecanRev-specific-fields disclaimer', () => {
    expect(html).toContain('Not every third-party application can');
    expect(html).toContain('README inside the file explains each format');
  });

  it('shows no progress, error, note, link or warning banner while idle', () => {
    expect(html).not.toContain('Preparing');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('Download again');
    expect(html).not.toContain('finished with a warning');
  });
});

describe('ZipExportCard — empty project', () => {
  it('disables the button and explains why', () => {
    const html = render({ empty: true });
    expect(html).toContain('disabled');
    expect(html).toContain('Import records before exporting.');
  });
});

describe('ZipExportCard — running', () => {
  const html = render({ running: true, progress: 'Preparing your screening file… (40%)' });

  it('disables the button and relabels it Preparing…', () => {
    expect(html).toContain('disabled');
    expect(html).toContain('Preparing…');
    expect(html).not.toContain('↓ Download screening file (ZIP)');
  });

  it('announces live progress via a polite status region', () => {
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Preparing your screening file… (40%)');
  });
});

describe('ZipExportCard — completed', () => {
  const html = render({
    note: 'Download started.',
    downloadUrl: '/api/screening/projects/p1/export/jobs/j1/download',
    filename: 'my-project-screening-export-2026-08-02.zip',
  });

  it('shows the completion note', () => {
    expect(html).toContain('Download started.');
  });

  it('renders a persistent re-download link pointing at the job download URL', () => {
    expect(html).toContain('Download again');
    expect(html).toContain('href="/api/screening/projects/p1/export/jobs/j1/download"');
    expect(html).toContain('download="my-project-screening-export-2026-08-02.zip"');
  });

  it('hides the re-download link while a new export is running', () => {
    const runningHtml = render({ running: true, downloadUrl: '/x', filename: 'f.zip' });
    expect(runningHtml).not.toContain('Download again');
  });
});

describe('ZipExportCard — error state', () => {
  it('surfaces the failure as an alert', () => {
    const html = render({ error: 'The export failed. Please try again.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('The export failed. Please try again.');
  });
});

describe('ZipExportCard — partial-failure warning banner (non-blocking, 97.md Phase 2)', () => {
  it('lists each warning and points at EXPORT-WARNINGS.txt', () => {
    const w = 'references.ris could not be generated: renderer exploded. The CSV and JSON files in this export are complete.';
    const html = render({ warnings: [w], warningCount: 1 });
    expect(html).toContain('finished with a warning');
    expect(html).toContain('references.ris could not be generated');
    expect(html).toContain('EXPORT-WARNINGS.txt');
  });

  it('falls back to a GENERIC banner when warningCount > 0 but the texts were lost', () => {
    // e.g. an unparseable stored warnings payload degrades to [] server-side —
    // the user must still see that an optional file is missing.
    const html = render({ warnings: [], warningCount: 2 });
    expect(html).toContain('finished with a warning');
    expect(html).toContain(GENERIC_ZIP_WARNING);
  });

  it('renders no banner when the export was clean', () => {
    const html = render({ warnings: [], warningCount: 0 });
    expect(html).not.toContain('finished with a warning');
  });
});
