#!/usr/bin/env node
/**
 * scripts/gen-extraction-fixtures.mjs — deterministically generate the SYNTHETIC
 * extraction fixtures under tests/fixtures/extraction/ (RoadMap/4.md §11 fallback:
 * the real Sujan/Khoury PDFs are not in the repo). Every fixture is normalized text
 * items ({str,x,y,w,h}, pdf.js user space, y grows UP) + an `expected` block.
 *
 * Re-run: `node scripts/gen-extraction-fixtures.mjs`  (idempotent — stable output).
 *
 * These are labelled `"synthetic": true`. A synthetic fixture is never described as
 * real; see tests/fixtures/extraction/README.md for adding the real PDFs.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'extraction');
mkdirSync(OUT_DIR, { recursive: true });

const CW = 6;          // approx char width (user-space units)
const ROW_H = 12;      // baseline-to-baseline row spacing
const item = (str, x, y, h = 10) => ({ str, x, y, w: str.length * CW, h });

/** row(y, cells) — cells = [{str, x}], produce items at baseline y. */
const row = (y, cells) => cells.map((c) => item(c.str, c.x, y, c.h));

function write(name, obj) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
  console.log('wrote', name, `(${(obj.items || []).length} items)`);
}

/* ── 1. Sujan-style: effect-per-row, caption subtitle, mid-word header splits ── */
{
  let y = 760;
  const items = [];
  // Caption with a subtitle that must NOT leak into cells.
  items.push(item('Table 2. Predictors of severe outcome (Test Cohort, n = 390)', 60, y)); y -= ROW_H * 1.5;
  // Header row with DELIBERATE mid-word splits: "u"+"nivariate", "v"+"ariables".
  // Columns at x = 60 (Variable), 300 (aOR), 360 (95% CI), 470 (P).
  items.push(item('Predictor v', 60, y), item('ariables', 60 + 11 * CW + 1.5, y));
  items.push(item('aOR', 300, y), item('95% CI', 360, y), item('P value', 470, y)); y -= ROW_H;
  // Body rows.
  const body = [
    ['SIRS', '2.24', '1.40-3.57', '<0.001'],
    ['Age, per year', '1.02', '0.99-1.03', '0.34'],
    ['Male sex', '1.45', '1.10-1.91', '0.008'],
    ['Elevated CRP', '1.88', '1.20-2.94', '0.006'],
  ];
  for (const [label, or, ci, p] of body) {
    items.push(item(label, 60, y), item(or, 300, y), item(ci, 360, y), item(p, 470, y));
    y -= ROW_H;
  }
  // Footnote (small font) — must be separated from data rows.
  y -= 4;
  items.push(item('CI, confidence interval; aOR, adjusted odds ratio; SIRS, systemic inflammatory response syndrome.', 60, y, 7));
  write('sujan-table2.synthetic.json', {
    synthetic: true,
    describes: 'Sujan 2018 Table 2 (structure only; not the real PDF)',
    page: 6,
    items,
    expected: {
      canonicalShape: 'effect-per-row',
      captionMatch: 'Test Cohort, n = 390',
      noCaptionLeak: true,
      headerRepaired: ['Predictor variables', 'aOR', '95% CI', 'P value'],
      sirsRow: { effect: '2.24', ci: [1.40, 3.57], p: 0.001, pOperator: '<' },
      footnoteExcluded: 'confidence interval',
    },
  });
}

/* ── 2. Khoury-style: arms-in-columns multi-study, wrapped label, indented rows ── */
{
  let y = 760;
  const items = [];
  items.push(item('Table 1. Characteristics of included studies', 60, y)); y -= ROW_H * 1.5;
  // Study columns.
  const cols = [
    { key: 'Characteristic', x: 60 },
    { key: 'Paik et al. [5]', x: 240 },
    { key: 'Park 2018', x: 340 },
    { key: 'Kim (2019)', x: 420 },
    { key: 'Lee et al', x: 500 },
    { key: 'Cho 2020', x: 560 },
  ];
  items.push(...cols.map((c) => item(c.key, c.x, y))); y -= ROW_H;
  // Wrapped label row: "Cause of biliary ob-" / "struction" (one logical row).
  items.push(item('Cause of biliary ob-', 60, y)); y -= ROW_H;
  items.push(item('struction', 60, y)); y -= ROW_H;
  // "Patients, n" parent with indented EUS-BD / ERCP children carrying numbers.
  items.push(item('Patients, n', 60, y), item('125', 240, y), item('90', 340, y), item('110', 420, y), item('84', 500, y), item('77', 560, y)); y -= ROW_H;
  items.push(item('EUS-BD', 72, y), item('64', 240, y), item('61', 340, y), item('55', 420, y), item('40', 500, y), item('38', 560, y)); y -= ROW_H;
  items.push(item('ERCP', 72, y), item('61', 240, y), item('29', 340, y), item('55', 420, y), item('44', 500, y), item('39', 560, y)); y -= ROW_H;
  // Footnote.
  y -= 4;
  items.push(item('EUS-BD, endoscopic ultrasound-guided biliary drainage; ERCP, endoscopic retrograde cholangiopancreatography.', 60, y, 7));
  write('khoury-table1.synthetic.json', {
    synthetic: true,
    describes: 'Khoury 2024 Table 1 (structure only; not the real PDF)',
    page: 3,
    items,
    expected: {
      canonicalShape: 'arms-in-columns',
      studyColumns: 5,
      wrappedLabel: 'Cause of biliary obstruction',
      hierarchy: { parent: 'Patients, n', children: ['EUS-BD', 'ERCP'] },
      paik: { patients: 125, eusbd: 64, ercp: 61 },
      footnoteExcluded: 'endoscopic ultrasound',
    },
  });
}

/* ── 3. Mean ± SD two-arm with sample sizes (two-tier header) ── */
{
  let y = 700;
  const items = [];
  items.push(item('Intervention', 200, y), item('Control', 400, y)); y -= ROW_H;
  items.push(item('Outcome', 60, y), item('Mean', 200, y), item('SD', 260, y), item('N', 310, y),
    item('Mean', 400, y), item('SD', 460, y), item('N', 510, y)); y -= ROW_H;
  for (const r of [
    ['Pain score', '5.2', '1.1', '40', '4.8', '1.3', '38'],
    ['LOS days', '6.0', '0.9', '55', '7.5', '1.0', '50'],
  ]) {
    items.push(item(r[0], 60, y), item(r[1], 200, y), item(r[2], 260, y), item(r[3], 310, y),
      item(r[4], 400, y), item(r[5], 460, y), item(r[6], 510, y));
    y -= ROW_H;
  }
  write('mean-sd.synthetic.json', {
    synthetic: true, describes: 'two-arm mean ± SD table', page: 1, items,
    expected: { canonicalShape: 'mean-sd', arms: 2, hasSampleSizes: true },
  });
}

/* ── 4. Events/total two-arm, one missing cell + a percentage companion ── */
{
  let y = 700;
  const items = [];
  items.push(item('Intervention', 200, y), item('Control', 380, y)); y -= ROW_H;
  items.push(item('Study', 60, y), item('Events', 200, y), item('Total', 270, y),
    item('Events', 380, y), item('Total', 450, y)); y -= ROW_H;
  items.push(item('Trial A', 60, y), item('18 (15%)', 200, y), item('120', 270, y), item('12 (12%)', 380, y), item('98', 450, y)); y -= ROW_H;
  // Missing intervention-events cell in Trial B.
  items.push(item('Trial B', 60, y), item('', 200, y), item('150', 270, y), item('9', 380, y), item('77', 450, y)); y -= ROW_H;
  write('events-total.synthetic.json', {
    synthetic: true, describes: 'two-arm events/total with a missing cell + percentage companion', page: 1, items,
    expected: { canonicalShape: 'two-by-two', arms: 2, missingCell: true, percentageCompanion: true },
  });
}

/* ── 5. KM figure: axis ticks + at-risk table ── */
{
  // Axis ticks as text items near the axes; the digitizer harvests these.
  const items = [];
  // x-axis (months) at bottom (small y), evenly spaced px.
  for (const [v, x] of [[0, 100], [6, 200], [12, 300], [18, 400], [24, 500]]) items.push(item(String(v), x, 80, 8));
  // y-axis (%) at left (x small), evenly spaced px.
  for (const [v, y] of [[0, 100], [25, 200], [50, 300], [75, 400], [100, 500]]) items.push(item(String(v), 60, y, 8));
  // At-risk table below.
  let y = 50;
  items.push(item('At risk', 60, y), item('0', 100, y), item('6', 200, y), item('12', 300, y), item('18', 400, y), item('24', 500, y)); y -= ROW_H;
  items.push(item('EUS-BD', 60, y), item('64', 100, y), item('55', 200, y), item('42', 300, y), item('30', 400, y), item('18', 500, y)); y -= ROW_H;
  items.push(item('ERCP', 60, y), item('61', 100, y), item('48', 200, y), item('35', 300, y), item('22', 400, y), item('12', 500, y));
  write('km-figure.synthetic.json', {
    synthetic: true, describes: 'Kaplan–Meier axis ticks + at-risk table', page: 8, items,
    expected: {
      figureType: 'km',
      xTicks: [{ px: 100, value: 0 }, { px: 200, value: 6 }, { px: 300, value: 12 }, { px: 400, value: 18 }, { px: 500, value: 24 }],
      yTicks: [{ px: 100, value: 0 }, { px: 200, value: 25 }, { px: 300, value: 50 }, { px: 400, value: 75 }, { px: 500, value: 100 }],
      xScale: 'linear', yScale: 'linear',
    },
  });
}

/* ── 6. Forest figure: log ticks 0.1/1/10 + a misleading annotation ── */
{
  const items = [];
  // Log-spaced VALUES at evenly-spaced pixels → the fit must choose log.
  for (const [v, x] of [[0.1, 100], [1, 300], [10, 500]]) items.push(item(String(v), x, 80, 8));
  // A misleading numeric annotation that is NOT a tick (a p-value in the plot body).
  items.push(item('p=0.03', 350, 250, 8));
  items.push(item('HR 0.84', 320, 260, 8));
  write('forest-figure.synthetic.json', {
    synthetic: true, describes: 'forest plot log ticks with a misleading annotation', page: 9, items,
    expected: {
      figureType: 'forest',
      xTicks: [{ px: 100, value: 0.1 }, { px: 300, value: 1 }, { px: 500, value: 10 }],
      xScale: 'log',
      nonTickAnnotations: ['p=0.03', 'HR 0.84'],
    },
  });
}

/* ── 7. Rasterized page: OCR word boxes in IMAGE pixel space (y grows DOWN) ── */
{
  // Tesseract-style words; the OCR normalizer maps these to PDF user space.
  const words = [
    { text: 'Mortality', confidence: 94, bbox: { x0: 60, y0: 40, x1: 140, y1: 58 } },
    { text: 'was', confidence: 91, bbox: { x0: 150, y0: 40, x1: 180, y1: 58 } },
    { text: '12', confidence: 88, bbox: { x0: 190, y0: 40, x1: 210, y1: 58 } },
    { text: '(9.6%)', confidence: 71, bbox: { x0: 215, y0: 40, x1: 270, y1: 58 } }, // ambiguous OCR
    { text: 'HR', confidence: 90, bbox: { x0: 60, y0: 70, x1: 82, y1: 88 } },
    { text: '0.80', confidence: 86, bbox: { x0: 90, y0: 70, x1: 130, y1: 88 } },
  ];
  write('rasterized-ocr.synthetic.json', {
    synthetic: true, describes: 'OCR word boxes for a text-less page (image pixel space)', page: 5,
    imageHeight: 800, viewport: { width: 600, height: 800, scale: 1 },
    words,
    expected: {
      wordCount: 6,
      ambiguous: '(9.6%)',
      // After normalizeOcrWords with pageHeight=800: a word at image-top (y0=40) maps to
      // a LARGE user-space y (near pageHeight).
      topWordMapsToLargeUserY: true,
    },
  });
}

console.log('done.');
