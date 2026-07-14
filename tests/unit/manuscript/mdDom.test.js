/**
 * 65.md MS-CORE/MS-5/MS-8/MS-9 — pure converter suite for the WYSIWYG editor.
 * Locks in the core correctness property: markdown → HTML → markdown is STABLE
 * (exact for canonical input, fixed-point for anything else), the rendered HTML
 * never shows raw markup or [[cite:]] tokens, and paste/injection input is
 * sanitized down to the subset.
 */
import { describe, it, expect } from 'vitest';
import {
  mdToHtml, htmlToMd, citeChipHtml, parsePipeTable, extractOutline, stripInlineMd, escapeHtml,
} from '../../../src/features/manuscript/richEditor/mdDom.js';
import {
  parseAbstractSubsections, serializeAbstractSubsections, abstractTemplateInfo,
  abstractWordCount, isPlaceholderText, ABSTRACT_FORMAT_SECTIONS,
} from '../../../src/research-engine/manuscript/abstractSections.js';
import { generateAbstract, generateDraft, generateResults, studySelectionParagraph } from '../../../src/research-engine/manuscript/draft.js';
import { computePrismaCounts } from '../../../src/research-engine/manuscript/prismaCounts.js';

const rt = (md, opts) => htmlToMd(mdToHtml(md, opts));

/** Visible text of rendered HTML (tags stripped, entities decoded). */
function textContent(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function fixtureProject() {
  return {
    id: 'p1', name: 'Statins for primary prevention',
    pico: { question: 'Do statins reduce CV events?', P: 'Adults', I: 'Statins', C: 'Placebo', O: 'MACE', prosperoId: 'CRD42024000001' },
    search: { dbs: { PubMed: true, Embase: true }, date: '2026-01-15', string: '(statin*)' },
    prisma: { dbs: '1200', reg: '50', other: '0', dedupe: '250', excTA: '800', excFull: '180' },
    robMethod: 'RoB2',
    studies: [
      { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', journal: 'Lancet', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12' },
      { id: 's2', title: 'Trial B', authors: 'Lee K', year: '2021', journal: 'NEJM', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06' },
    ],
  };
}

const CANONICAL = [
  '# Heading one',
  '',
  'Para with **bold**, *ital*, `code`, a [link](https://example.com/x) and [[cite:r1]].',
  '',
  '## Sub heading',
  '',
  '- first bullet',
  '- second bullet',
  '',
  '1. step one',
  '2. step two',
  '',
  '| Col A | Col B |',
  '| --- | --- |',
  '| a1 | b1 |',
  '| a2 | b2 |',
  '',
  '### Deep heading',
  '',
  'Closing paragraph.',
].join('\n');

describe('mdDom round-trip stability (MS-CORE)', () => {
  it('canonical markdown survives md→html→md byte-for-byte', () => {
    expect(rt(CANONICAL)).toBe(CANONICAL);
  });

  it('is a fixed point: rt(rt(x)) === rt(x) for generator output', () => {
    const gen = generateDraft(fixtureProject(), {});
    for (const id of ['abstract', 'introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion']) {
      const once = rt(gen[id]);
      expect(rt(once), `section ${id} should be round-trip stable`).toBe(once);
    }
  });

  it('canonicalizes ordered-list numbering', () => {
    expect(rt('3. a\n7. b')).toBe('1. a\n2. b');
  });

  it('single-newline paragraphs converge to blank-line blocks', () => {
    const once = rt('a\nb');
    expect(once).toBe('a\n\nb');
    expect(rt(once)).toBe(once);
  });

  it('headerless pipe tables round-trip without a separator row', () => {
    const md = '| a | b |\n| c | d |';
    expect(rt(md)).toBe(md);
  });

  it('nested bold+italic stays parseable (trailing-star padding)', () => {
    const md = htmlToMd('<p><strong>a <em>b</em></strong></p>');
    expect(md).toBe('**a *b* **');
    // the padded form renders with no raw stars and is a fixed point
    expect(textContent(mdToHtml(md))).not.toMatch(/\*/);
    expect(rt(md)).toBe(md);
  });

  it('bold+italic composes to *** and back', () => {
    expect(mdToHtml('***x***')).toContain('<strong><em>x</em></strong>');
    expect(htmlToMd('<p><b><i>x</i></b></p>')).toBe('***x***');
  });
});

describe('no raw tokens in the rendered surface (MS-CORE)', () => {
  it('canonical input renders with no #, ** or [[cite: visible', () => {
    const txt = textContent(mdToHtml(CANONICAL, { orderMap: new Map([['r1', 1]]) }));
    expect(txt).not.toMatch(/\*\*/);
    expect(txt).not.toMatch(/\[\[cite:/);
    expect(txt).not.toMatch(/^#/m);
    expect(txt).not.toMatch(/\]\(/);
    expect(txt).not.toContain('---');
  });

  it('generator sections render with no raw markup', () => {
    const gen = generateDraft(fixtureProject(), {});
    for (const id of Object.keys(gen)) {
      const txt = textContent(mdToHtml(gen[id]));
      expect(txt, `section ${id}`).not.toMatch(/\*\*/);
      expect(txt, `section ${id}`).not.toMatch(/^#{1,3}\s/m);
      expect(txt, `section ${id}`).not.toMatch(/\[\[cite:/);
    }
  });

  it('numbers citation chips from orderMap; unknown ids show [?]', () => {
    const html = mdToHtml('See [[cite:b]] then [[cite:a]] and [[cite:zz]].', { orderMap: new Map([['b', 1], ['a', 2]]) });
    expect(html).toContain('data-cite="b"');
    expect(html).toContain('contenteditable="false"');
    const txt = textContent(html);
    expect(txt).toContain('[1]');
    expect(txt).toContain('[2]');
    expect(txt).toContain('[?]');
    expect(txt).not.toContain('[[cite:');
  });
});

describe('escape-first security', () => {
  it('never injects unescaped user HTML', () => {
    const html = mdToHtml('<img src=x onerror=alert(1)> and **<script>bad()</script>**');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  });
  it('blocks non-http(s)/mailto link schemes', () => {
    expect(mdToHtml('[x](javascript:alert(1))')).not.toContain('<a ');
    expect(mdToHtml('[x](https://ok.example)')).toContain('<a href="https://ok.example"');
  });
  it('escapeHtml escapes &, <, >', () => {
    expect(escapeHtml('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });
  it('percent-encodes * inside hrefs so emphasis passes cannot cross the attribute', () => {
    const html = mdToHtml('[t](https://e.com/*a*) and *i*');
    expect(html).toContain('href="https://e.com/%2Aa%2A"');
    expect(html).toContain('<em>i</em>');
  });
});

describe('htmlToMd sanitizes editor/paste HTML', () => {
  it('converts contentEditable div/br soup to paragraphs', () => {
    expect(htmlToMd('<div>a</div><div><br></div><div>b<br>c</div>')).toBe('a\n\nb\nc');
  });
  it('strips Word/Docs junk to the subset', () => {
    const word = '<html><head><style>p{color:red}</style></head><body>'
      + '<p class="MsoNormal">Hello <o:p></o:p><b>World</b></p>'
      + '<span style="font-weight:700">heavy</span><script>evil()</script></body></html>';
    const md = htmlToMd(word);
    expect(md).toBe('Hello **World**\n\n**heavy**');
    expect(md).not.toContain('color:red');
    expect(md).not.toContain('evil');
  });
  it('maps style-based bold/italic spans', () => {
    expect(htmlToMd('<p><span style="font-style:italic">x</span></p>')).toBe('*x*');
  });
  it('converts lists and tables back to markdown', () => {
    expect(htmlToMd('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two');
    expect(htmlToMd('<ol><li>one</li><li>two</li></ol>')).toBe('1. one\n2. two');
    expect(htmlToMd('<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>'))
      .toBe('| H |\n| --- |\n| v |');
  });
  it('citation chips are atomic: chip ↔ token regardless of the visible [n]', () => {
    const chip = citeChipHtml('r9', 3);
    expect(chip).toContain('data-cite="r9"');
    expect(htmlToMd(`<p>x ${chip} y</p>`)).toBe('x [[cite:r9]] y');
  });
  it('unwraps unknown inline wrappers instead of leaking tags', () => {
    expect(htmlToMd('<p><font color="red"><u>plain</u></font></p>')).toBe('plain');
  });
  it('escapes literal pipes inside table cells', () => {
    expect(htmlToMd('<table><tbody><tr><td>a|b</td></tr></tbody></table>')).toBe('| a/b |');
  });
});

describe('parsePipeTable', () => {
  it('detects the header separator', () => {
    const { header, rows } = parsePipeTable(['| a | b |', '| --- | --- |', '| 1 | 2 |']);
    expect(header).toEqual(['a', 'b']);
    expect(rows).toEqual([['1', '2']]);
  });
  it('treats tables without separator as body-only', () => {
    const { header, rows } = parsePipeTable(['| 1 | 2 |']);
    expect(header).toBeNull();
    expect(rows).toEqual([['1', '2']]);
  });
});

describe('extractOutline (MS-11)', () => {
  it('lists headings with level and a DOM-order index', () => {
    const o = extractOutline('# A\n\ntext\n\n## B\n\nmore\n\n### C');
    expect(o).toEqual([
      { level: 1, text: 'A', headingIndex: 0 },
      { level: 2, text: 'B', headingIndex: 1 },
      { level: 3, text: 'C', headingIndex: 2 },
    ]);
  });
  it('strips inline markup and cite tokens from labels', () => {
    expect(stripInlineMd('**Bold** head [[cite:x]] [t](https://e.com)')).toBe('Bold head  t');
    const o = extractOutline('## **Study** selection [[cite:a]]');
    expect(o[0].text).toContain('Study selection');
    expect(o[0].text).not.toContain('**');
  });
});

describe('abstract subsections (MS-5)', () => {
  const project = { name: 'P', pico: { question: 'Q', O: 'MACE' }, search: { dbs: { PubMed: true }, date: '2026-01-01' }, prisma: { dbs: '10', dedupe: '2', excTA: '3', excFull: '1' }, studies: [] };

  it('parses every generator format into the expected labels', () => {
    for (const [tplId, fmt] of [['jama', 'jama'], ['lancet', 'lancet'], ['generic', 'structured']]) {
      const md = generateAbstract(project, { templateId: tplId });
      const parsed = parseAbstractSubsections(md);
      expect(parsed.matched, tplId).toBe(true);
      expect(parsed.subsections.map((s) => s.label), tplId).toEqual(ABSTRACT_FORMAT_SECTIONS[fmt]);
    }
  });

  it('serialize(parse(x)) is stable', () => {
    const md = generateAbstract(project, { templateId: 'jama' });
    const once = serializeAbstractSubsections(parseAbstractSubsections(md).subsections);
    expect(serializeAbstractSubsections(parseAbstractSubsections(once).subsections)).toBe(once);
    expect(parseAbstractSubsections(once).matched).toBe(true);
  });

  it('keeps bold INSIDE subsection text out of the label', () => {
    const p = parseAbstractSubsections('**Methods.** We used **all** databases.');
    expect(p.matched).toBe(true);
    expect(p.subsections[0].label).toBe('Methods');
    expect(p.subsections[0].text).toBe('We used **all** databases.');
  });

  it('free-form abstracts fall back gracefully', () => {
    expect(parseAbstractSubsections('Just plain text.\n\nMore text.').matched).toBe(false);
    expect(parseAbstractSubsections('').matched).toBe(false);
  });

  it('collapses internal blank lines so a subsection can never split', () => {
    const md = serializeAbstractSubsections([{ label: 'Background', text: 'a\n\n\nb' }]);
    expect(md).toBe('**Background.** a\nb');
    expect(parseAbstractSubsections(md).subsections).toHaveLength(1);
  });

  it('counts words ignoring markup and cite tokens', () => {
    expect(abstractWordCount('**Background.** Two words [[cite:a]]')).toBe(3);
    expect(abstractWordCount('')).toBe(0);
  });

  it('template info exposes labels and word limits', () => {
    expect(abstractTemplateInfo('jama').wordLimit).toBe(350);
    expect(abstractTemplateInfo('generic').wordLimit).toBeNull();
    expect(abstractTemplateInfo('lancet').labels).toContain('Findings');
  });

  it('flags placeholder-only subsections', () => {
    expect(isPlaceholderText('[State the objective]')).toBe(true);
    expect(isPlaceholderText('Real content')).toBe(false);
    expect(isPlaceholderText('')).toBe(true);
  });
});

describe('studySelectionParagraph (MS-8)', () => {
  it('matches the paragraph generateResults emits', () => {
    const project = fixtureProject();
    const pc = computePrismaCounts(project, {});
    const para = studySelectionParagraph(pc);
    expect(para).toContain('PRISMA 2020 flow diagram (Figure 1)');
    expect(generateResults(project, {})).toContain(para);
  });
  it('emits honest placeholders when counts are missing', () => {
    const para = studySelectionParagraph(computePrismaCounts({ prisma: {}, studies: [] }, {}));
    expect(para).toContain('[Number of records identified unavailable]');
  });
});

/* ── 85.md B1 — asset chips ([[table:…]]/[[figure:…]]) ─────────────────────── */

describe('asset chips (85.md B1)', () => {
  it('renders tokens as atomic ms-asset chips with numbering from opts.assetNumbers', () => {
    const html = mdToHtml('See [[table:study]] and [[figure:prisma]].', {
      assetNumbers: { 'table:study': 2, 'figure:prisma': 1 },
    });
    expect(html).toContain('<span class="ms-asset" data-asset="table:study" contenteditable="false">Table 2</span>');
    expect(html).toContain('<span class="ms-asset" data-asset="figure:prisma" contenteditable="false">Figure 1</span>');
    expect(html).not.toContain('[[table:');
  });

  it('accepts a Map for assetNumbers; unknown number → label ?', () => {
    const html = mdToHtml('[[figure:funnel]] [[table:sof]]', {
      assetNumbers: new Map([['figure:funnel', 3]]),
    });
    expect(html).toContain('>Figure 3</span>');
    expect(html).toContain('>Table ?</span>');
    // no numbering map at all → all ?
    expect(mdToHtml('[[table:sof]]')).toContain('>Table ?</span>');
  });

  it('round-trips md → HTML → md as a fixed point (chips reverse via data-asset)', () => {
    const md = 'Before [[table:study]] mid [[figure:forest:mace-5y]] after.';
    expect(rt(md)).toBe(md);
    expect(rt(rt(md))).toBe(md);
    // with numbering the label changes but the reversed markdown does not
    expect(htmlToMd(mdToHtml(md, { assetNumbers: { 'table:study': 1 } }))).toBe(md);
  });

  it('chips render inside pipe-table cells and reverse correctly', () => {
    const md = '| a | [[table:sof]] |\n| --- | --- |\n| 1 | 2 |';
    const html = mdToHtml(md, { assetNumbers: { 'table:sof': 4 } });
    expect(html).toContain('data-asset="table:sof"');
    expect(html).toContain('>Table 4</span>');
    expect(rt(md)).toBe(md);
  });

  it('sanitizer keeps valid chip spans and degrades corrupt data-asset to text', () => {
    // pasted chip (valid) survives as a token
    expect(htmlToMd('<p>x <span class="ms-asset" data-asset="figure:rob" contenteditable="false">Figure 2</span> y</p>'))
      .toBe('x [[figure:rob]] y');
    // grammar-breaking id → falls back to the chip text, never a broken token
    expect(htmlToMd('<p><span class="ms-asset" data-asset="junk id!">Table ?</span></p>'))
      .toBe('Table ?');
    expect(htmlToMd('<p><span data-asset="table:UPPER">Table ?</span></p>')).toBe('Table ?');
  });

  it('stripInlineMd turns asset tokens into label-ish text (outlines never leak tokens)', () => {
    expect(stripInlineMd('Results [[table:study]] and [[figure:prisma]] [[cite:r1]]'))
      .toBe('Results Table ? and Figure ?');
    expect(stripInlineMd('## Head [[figure:funnel]]')).toContain('Figure ?');
  });

  it('asset chips never collide with cite chips', () => {
    const html = mdToHtml('[[cite:r1]] [[table:study]]', {
      orderMap: new Map([['r1', 1]]),
      assetNumbers: { 'table:study': 1 },
    });
    expect(html).toContain('class="ms-cite"');
    expect(html).toContain('class="ms-asset"');
    expect(htmlToMd(html)).toBe('[[cite:r1]] [[table:study]]');
  });
});
