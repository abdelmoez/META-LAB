/**
 * 118.md §22-§27 / §66-Export — THE NEUTRAL, UNBRANDED WORD EXPORT.
 *
 * §22: "Do NOT export PecanRev's application colors or UI visual styling into the
 * manuscript." The audit behind this suite found the exporter itself was already
 * ~neutral — every run it writes is black, its table borders are grey, its notes are
 * grey. The colour came from two places nobody had to write down:
 *
 *   1. word/styles.xml. `Document({styles:{default:…}})` is handed straight to the
 *      docx library's DefaultStylesFactory, which merges per-style overrides over
 *      its OWN defaults — Word-blue Heading 1/2/4/5 (2E74B5), darker-blue Heading 3/6
 *      (1F4D78) and an ITALIC Heading 4. Passing no heading key meant shipping those.
 *      Nothing in document.xml shows it; the colour lives in the style part, which is
 *      why it survived every existing assertion in this directory.
 *   2. The figure builders' two decorative tints — PRISMA's bluish-grey header /
 *      stage bands and its green "included" terminal box, the funnel's green pooled
 *      line — plus the RoB traffic light, which was lettered in the WEB APP's UI font
 *      stacks (Inter / IBM Plex Mono) while every other figure in the same .docx is
 *      set in Georgia.
 *
 * These pins are written against the ARTIFACT (unzip the .docx, read the emitted SVG
 * string), not against the source, because "the exported file is neutral" is a
 * property of the file. They also pin what deliberately STAYS coloured, so a later
 * blanket de-colouring sweep has to be an explicit decision: Word's own 0563C1
 * external-link convention, and the Okabe–Ito risk-of-bias judgement hues, which are
 * semantic (colour-blind-safe, redundant with the +/!/×/? symbols) rather than brand.
 */
import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';

// figures.js rasterizes through the DOM canvas, which Node has not got. Only that
// ONE function is replaced (importOriginal keeps zipFiles/crc32 real for the repro
// bundle below) so prismaPng/funnelPng run their real builder + option threading and
// hand back the SVG string this suite inspects.
vi.mock('../../../src/frontend/components/exportCore.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    rasterizeSvg: async () => new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]),
  };
});

import { buildManuscriptDocx } from '../../../src/features/manuscript/export/manuscriptDocx.js';
import { buildReproPackage } from '../../../src/features/manuscript/export/manuscriptRepro.js';
import { prismaPng, funnelPng, prismaSvg } from '../../../src/features/manuscript/export/figures.js';
import { buildPrismaFlowSVG } from '../../../src/research-engine/prisma/svg.js';
import { derivePrismaFlow } from '../../../src/research-engine/prisma/derive.js';
import { buildPrismaSVG, buildFunnelSVG } from '../../../src/frontend/workspace/charts/svgBuilders.js';
import { buildTrafficLightSVG } from '../../../src/frontend/rob/RobTrafficLight.jsx';
import { runMeta } from '../../../src/research-engine/statistics/meta-analysis.js';
import { computePrismaCounts } from '../../../src/research-engine/manuscript/index.js';
import { makeManuscriptDraft, normalizeDraft } from '../../../src/research-engine/manuscript/model.js';
import { OKABE_ITO, FONT, MONO } from '../../../src/frontend/theme/tokens.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function fixtureProject() {
  return {
    id: 'p1',
    name: 'Statins for primary prevention',
    pico: { question: 'Do statins reduce CV events?' },
    search: { dbs: { PubMed: true }, date: '2026-01-15', string: '(statin*)' },
    prisma: { dbs: '1200', reg: '50', other: '0', dedupe: '250', excTA: '800', excFull: '180', included: '', quant: '' },
    robMethod: 'RoB2',
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', journal: 'Lancet', volume: '12', issue: '3', pages: '100-110', doi: '10.1/a', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', nExp: '500', nCtrl: '500' },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', journal: 'NEJM', doi: '10.1/b', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06', nExp: '300', nCtrl: '300' },
      { id: 's3', title: 'Trial C', authors: 'Brown T', year: '2019', journal: 'JAMA', doi: '10.1/c', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05', nExp: '400', nCtrl: '400' },
    ],
  };
}

/** A draft that exercises every heading level, a caption, a table and a citation. */
function richDraft() {
  const d = normalizeDraft(makeManuscriptDraft({ title: 'A neutral manuscript' }));
  d.sections.abstract.content = 'Background text with a citation [[cite:s1]].';
  d.sections.methods.content = [
    '# Level two heading',
    '',
    '## Level three heading',
    '',
    '### Level four heading',
    '',
    'Body prose referencing [[table:study]] and [[cite:s2]].',
  ].join('\n');
  d.sections.results.content = 'Results prose citing [[cite:s3]] and [[figure:prisma]].';
  return d;
}

async function docxParts(project, draft, opts = {}) {
  const blob = await buildManuscriptDocx(project, draft, opts);
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const read = async (name) => (zip.file(name) ? zip.file(name).async('string') : '');
  return { doc: await read('word/document.xml'), styles: await read('word/styles.xml') };
}

/** The `<w:style …>…</w:style>` element for one styleId. */
const styleEl = (styles, id) => {
  const m = styles.match(new RegExp(`<w:style [^>]*w:styleId="${id}"[^>]*>[\\s\\S]*?</w:style>`));
  return m ? m[0] : '';
};

/** Every `<w:p>…</w:p>` whose paragraph properties name one of `ids` as its pStyle. */
function paragraphsWithStyle(doc, ids) {
  const out = [];
  const re = /<w:p>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(doc)) !== null) {
    const s = m[0];
    const ps = s.match(/<w:pStyle w:val="([^"]+)"\/>/);
    if (ps && ids.includes(ps[1])) out.push(s);
  }
  return out;
}

/** The bibliography paragraphs — identified by the §27 hanging indent they carry. */
const bibEntries = (doc) => (doc.match(/<w:p>[\s\S]*?<\/w:p>/g) || [])
  .filter((p) => p.includes('<w:ind w:left="360" w:hanging="360"/>'));

/** Drop every paint attribute, leaving geometry + text: the "same drawing" probe. */
const stripPaint = (svg) => svg.replace(/\s(?:fill|stroke)="[^"]*"/g, '');

/* ════════════ §22-§24 — word/styles.xml carries no application colour ════════ */

describe('118.md §22/§23 — the .docx style part is neutral', () => {
  it('contains neither of the docx-library heading blues anywhere', async () => {
    const { styles } = await docxParts(fixtureProject(), richDraft());
    expect(styles).not.toContain('2E74B5');
    expect(styles).not.toContain('1F4D78');
  });

  it('THE PIN IS NOT VACUOUS — an unconfigured Document really does ship the blues', async () => {
    // Proof the assertion above is about OUR configuration and not about the
    // library having no colour to begin with. This is the exact document the
    // exporter would have produced with `styles.default` left as it was.
    const D = await import('docx');
    const bare = new D.Document({
      styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
      sections: [{ children: [new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, text: 'x' })] }],
    });
    const zip = await JSZip.loadAsync(Buffer.from(await (await D.Packer.toBlob(bare)).arrayBuffer()));
    const styles = await zip.file('word/styles.xml').async('string');
    expect(styles).toContain('2E74B5');
    expect(styles).toContain('1F4D78');
    expect(styleEl(styles, 'Heading4')).toContain('<w:i/>');   // …and an italic Heading 4
  });

  it('gives Title and Heading 1–6 an explicit black run colour', async () => {
    const { styles } = await docxParts(fixtureProject(), richDraft());
    for (const id of ['Title', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6']) {
      const el = styleEl(styles, id);
      expect(el, `${id} style should be defined`).not.toBe('');
      expect(el, `${id} should be black`).toContain('<w:color w:val="000000"/>');
    }
  });

  it('§24 — keeps a REAL heading hierarchy (sizes are not flattened by the override)', async () => {
    // The factory merges `run` SHALLOWLY, so an override that named only a colour
    // would silently drop Word's 16/13/12pt heading sizes and leave every heading at
    // body size — "plain" turned into "structureless", which §24 explicitly forbids.
    const { styles } = await docxParts(fixtureProject(), richDraft());
    expect(styleEl(styles, 'Title')).toContain('<w:sz w:val="56"/>');
    expect(styleEl(styles, 'Heading1')).toContain('<w:sz w:val="32"/>');
    expect(styleEl(styles, 'Heading2')).toContain('<w:sz w:val="26"/>');
    expect(styleEl(styles, 'Heading3')).toContain('<w:sz w:val="24"/>');
  });

  it('turns OFF the library\'s italic Heading 4', async () => {
    const { styles } = await docxParts(fixtureProject(), richDraft());
    expect(styleEl(styles, 'Heading4')).toContain('<w:i w:val="false"/>');
  });

  it('DELIBERATELY keeps Word\'s own 0563C1 external-link colour', async () => {
    // §27 "do not convert them into arbitrary colored hyperlinks" is about the
    // BIBLIOGRAPHY. A real external link rendered in Word's blue is Word's
    // convention, not our branding — pinned so removing it is a decision, not drift.
    const { styles } = await docxParts(fixtureProject(), richDraft());
    expect(styleEl(styles, 'Hyperlink')).toContain('0563C1');
  });

  it('keeps the conservative academic base: Calibri 11pt body, 1in margins', async () => {
    const { doc, styles } = await docxParts(fixtureProject(), richDraft());
    expect(styles).toContain('Calibri');
    expect(styles).toContain('<w:sz w:val="22"/>');
    expect(doc).toContain('w:top="1440"');
    expect(doc).toContain('w:bottom="1440"');
    expect(doc).toContain('w:left="1440"');
    expect(doc).toContain('w:right="1440"');
  });
});

/* ════════════ §22/§26 — no colour on headings or captions in the body ═══════ */

describe('118.md §22 — heading and caption runs carry no colour attribute', () => {
  it('every Title/Heading paragraph in the document is colour-free', async () => {
    const { doc } = await docxParts(fixtureProject(), richDraft());
    const paras = paragraphsWithStyle(doc, ['Title', 'Heading1', 'Heading2', 'Heading3', 'Heading4']);
    // The fixture draft uses all of them, so an empty match would be a false pass.
    expect(paras.length).toBeGreaterThanOrEqual(5);
    for (const p of paras) expect(p, `coloured heading run: ${p}`).not.toContain('<w:color');
  });

  it('table and figure caption paragraphs are colour-free', async () => {
    const { doc } = await docxParts(fixtureProject(), richDraft());
    const captionParas = (doc.match(/<w:p>[\s\S]*?<\/w:p>/g) || [])
      .filter((p) => /(Table|Figure) \d+\./.test(p));
    expect(captionParas.length).toBeGreaterThan(0);
    for (const p of captionParas) expect(p, `coloured caption run: ${p}`).not.toContain('<w:color');
  });
});

/* ════════════ §25/§27 — tables stay real, references gain a hanging indent ═══ */

describe('118.md §25/§27 — table and reference structure', () => {
  it('§25 — data tables are real Word tables with conservative grey borders only', async () => {
    const d = richDraft();
    const { doc } = await docxParts(fixtureProject(), d);
    const i = doc.indexOf('<w:tbl>');
    expect(i).toBeGreaterThan(-1);
    const tbl = doc.slice(i, doc.indexOf('</w:tbl>', i));
    expect(tbl).toContain('w:color="999999"');   // the one border colour, a neutral grey
    expect(tbl).not.toContain('<w:shd ');        // no shaded header cards (§23)
  });

  it('§27 — bibliography entries get a paragraph-level hanging indent', async () => {
    const { doc } = await docxParts(fixtureProject(), richDraft());
    const i = doc.indexOf('>References<');
    expect(i).toBeGreaterThan(-1);
    // The indent belongs to the entries, which follow the References heading — not
    // to any paragraph before it.
    expect(doc.slice(0, i)).not.toContain('<w:ind w:left="360" w:hanging="360"/>');
    expect(bibEntries(doc).length).toBe(3);
  });

  it('§27 — the indent is presentation ONLY: entry text and numbering are unchanged', async () => {
    // The hanging indent must not disturb what the entry SAYS. These are the same
    // facts referenceLibrary117 pins; asserted here so the §27 change cannot quietly
    // re-order, re-number or re-render the bibliography — or paint it.
    const { doc } = await docxParts(fixtureProject(), richDraft());
    const entries = bibEntries(doc);
    expect(entries[0]).toContain('1. ');
    expect(entries[0]).toContain('Trial A');
    expect(entries[0]).toContain('2020;12(3):100-110.');
    expect(entries[2]).toContain('3. ');
    for (const e of entries) {
      // §27: never "arbitrary colored hyperlinks" — a bibliography entry is plain text.
      expect(e).not.toContain('<w:color');
      expect(e).not.toContain('<w:hyperlink');
    }
  });

  it('§27 — in-text markers still match the reference numbers', async () => {
    const { doc } = await docxParts(fixtureProject(), richDraft());
    expect(doc).not.toContain('[[cite:');
    expect(doc).toContain('[1]');
    expect(doc).toContain('[2]');
    expect(doc).toContain('[3]');
  });
});

/* ════════════ §26 — the figure builders' neutral skin ═══════════════════════ */

const FLOW = derivePrismaFlow([
  ...Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, origin: 'search', sourceDb: 'PubMed', isDuplicate: true, dedupStage: 'search' })),
  ...Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, origin: 'search', sourceDb: 'PubMed', screeningDecision: 'exclude' })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, origin: 'search', sourceDb: 'PubMed', screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong population' })),
  ...Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, origin: 'search', sourceDb: 'PubMed', screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, origin: 'mining', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true })),
]);

describe('118.md §26 — buildPrismaFlowSVG monochrome', () => {
  it('drops the header/stage-band tint and the green included box', () => {
    const mono = buildPrismaFlowSVG(FLOW, { perSource: true, monochrome: true }).svg;
    expect(mono).not.toContain('#eef1f5');
    expect(mono).not.toContain('#2e7d32');
    expect(mono).not.toContain('#f3f7f3');
  });

  it('the on-screen default is unchanged (previews keep their palette)', () => {
    const colour = buildPrismaFlowSVG(FLOW, { perSource: true }).svg;
    expect(colour).toContain('#eef1f5');
    expect(colour).toContain('#2e7d32');
  });

  it('is the SAME DRAWING OF THE SAME NUMBERS — only paint differs', () => {
    // 117.md §12/§57's invariant, stated as a property rather than a promise: strip
    // every fill/stroke and the two SVGs must be byte-identical, so `monochrome`
    // provably cannot move a box, wrap a line differently or change a count.
    const colour = buildPrismaFlowSVG(FLOW, { perSource: true });
    const mono = buildPrismaFlowSVG(FLOW, { perSource: true, monochrome: true });
    expect(stripPaint(mono.svg)).toBe(stripPaint(colour.svg));
    expect(mono.boxes).toEqual(colour.boxes);
    expect(mono.W).toBe(colour.W);
    expect(mono.H).toBe(colour.H);
  });

  it('keeps the Georgia serif stack (the wrapper measures real Georgia advances)', () => {
    // 116.md §18 r2 sizes every box from a checked-in Georgia advance table, so the
    // font family is load-bearing geometry here, not styling.
    const mono = buildPrismaFlowSVG(FLOW, { perSource: true, monochrome: true }).svg;
    expect(mono).toContain('Georgia');
  });
});

describe('118.md §26 — the legacy single-column PRISMA builder', () => {
  const shape = { dbs: 1200, reg: 50, other: 0, dedupe: 250, excTA: 800, excFull: 180, quant: 12, reasons: [{ r: 'Wrong population', n: 100 }] };

  it('monochrome drops the green included box; the default keeps it', () => {
    const mono = buildPrismaSVG(shape, { monochrome: true }).svg;
    expect(mono).not.toContain('#f3f7f3');
    expect(mono).not.toContain('#2e7d32');
    expect(buildPrismaSVG(shape, {}).svg).toContain('#2e7d32');
  });

  it('is the same drawing modulo paint', () => {
    expect(stripPaint(buildPrismaSVG(shape, { monochrome: true }).svg))
      .toBe(stripPaint(buildPrismaSVG(shape, {}).svg));
  });
});

describe('118.md §26 — buildFunnelSVG monochrome', () => {
  const result = () => runMeta([
    { id: 's1', author: 'Smith', year: '2020', es: '-0.36', lo: '-0.6', hi: '-0.12' },
    { id: 's2', author: 'Lee', year: '2021', es: '-0.22', lo: '-0.5', hi: '0.06' },
    { id: 's3', author: 'Brown', year: '2019', es: '-0.30', lo: '-0.55', hi: '-0.05' },
    { id: 's4', author: 'Green', year: '2022', es: '-0.15', lo: '-0.40', hi: '0.10' },
  ], 'random');

  it('draws the pooled reference line black and dashed instead of green', () => {
    const mono = buildFunnelSVG(result(), { esType: 'OR', monochrome: true }).svg;
    expect(mono).not.toContain('#2e7d32');
    expect(mono).toContain('stroke="#000000" stroke-width="1.5" stroke-dasharray="3,3"');
  });

  it('the on-screen/default build is unchanged', () => {
    expect(buildFunnelSVG(result(), { esType: 'OR' }).svg).toContain('#2e7d32');
  });

  it('is the same drawing modulo paint', () => {
    expect(stripPaint(buildFunnelSVG(result(), { esType: 'OR', monochrome: true }).svg))
      .toBe(stripPaint(buildFunnelSVG(result(), { esType: 'OR' }).svg));
  });
});

/* ════════════ §26 — the ONE seam that decides which skin an artifact gets ═══ */

describe('118.md §26 — figures.js threads monochrome for files, not for screens', () => {
  const project = fixtureProject();

  it('prismaPng is monochrome by default (it feeds the .docx and the bundle)', async () => {
    const out = await prismaPng(computePrismaCounts(project, { flow: FLOW }), { title: '' });
    expect(out.svg).not.toContain('#eef1f5');
    expect(out.svg).not.toContain('#2e7d32');
  });

  it('prismaPng still honours an explicit opt-out', async () => {
    const out = await prismaPng(computePrismaCounts(project, { flow: FLOW }), { title: '', monochrome: false });
    expect(out.svg).toContain('#eef1f5');
  });

  it('funnelPng is monochrome by default', async () => {
    const out = await funnelPng(runMeta(project.studies, 'random'), { esType: 'OR' });
    expect(out.svg).not.toContain('#2e7d32');
  });

  it('prismaSvg — shared with the in-editor preview — stays COLOUR by default', () => {
    const svg = prismaSvg(computePrismaCounts(project, { flow: FLOW }));
    expect(svg).toContain('#eef1f5');
    expect(prismaSvg(computePrismaCounts(project, { flow: FLOW }), { monochrome: true }))
      .not.toContain('#eef1f5');
  });

  it('the reproducibility bundle ships the monochrome PRISMA .svg', async () => {
    const blob = await buildReproPackage(project, richDraft(), { appVersion: 'test' });
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const svg = await zip.file('prisma/prisma_2020.svg').async('string');
    expect(svg).not.toContain('#eef1f5');
    expect(svg).not.toContain('#2e7d32');
  });
});

/* ════════════ §26 — the RoB traffic light is a FIGURE, not a web page ═══════ */

describe('118.md §26 — RoB traffic-light SVG typography', () => {
  const matrix = {
    domains: [{ id: 'D1', shortLabel: 'Randomisation' }, { id: 'D2', shortLabel: 'Deviations' }],
    rows: [
      { id: 'a', label: 'Smith 2020', overall: 'low', cells: [{ domainId: 'D1', judgment: 'low' }, { domainId: 'D2', judgment: 'some' }] },
      { id: 'b', label: 'Lee 2021', overall: 'high', cells: [{ domainId: 'D1', judgment: 'high' }] },
    ],
  };

  it('is lettered in the Georgia serif stack the other export figures use', () => {
    const { svg } = buildTrafficLightSVG(matrix, { title: 'Risk of bias' });
    expect(svg).toContain("Georgia, 'Times New Roman', serif");
    expect((svg.match(/font-family="/g) || []).length)
      .toBe((svg.match(/font-family="Georgia, 'Times New Roman', serif"/g) || []).length);
  });

  it('no longer carries the application UI stacks or an unresolvable CSS variable', () => {
    // `FONT` is `var(--t-font, 'Inter', …)`, and the canvas rasteriser renders this
    // string OFF the DOM — it has no document to resolve a custom property against.
    // The token itself is asserted here so this pin cannot pass merely because the
    // theme stopped naming Inter somewhere else.
    expect(FONT).toContain('var(--');
    expect(FONT).toContain('Inter');
    expect(MONO).toContain('IBM Plex Mono');
    const { svg } = buildTrafficLightSVG(matrix, { title: 'Risk of bias' });
    expect(svg).not.toContain('Inter');
    expect(svg).not.toContain('IBM Plex');
    expect(svg).not.toContain('var(--');
  });

  it('KEEPS the Okabe–Ito judgement hues — semantic, not decoration', () => {
    const { svg } = buildTrafficLightSVG(matrix, { title: 'Risk of bias' });
    expect(svg).toContain(OKABE_ITO.bluishGreen);  // low
    expect(svg).toContain(OKABE_ITO.orange);       // some concerns
    expect(svg).toContain(OKABE_ITO.vermillion);   // high
    // …together with the colour-free redundant symbols they are paired with.
    expect(svg).toContain('>+<');
    expect(svg).toContain('>!<');
  });
});
