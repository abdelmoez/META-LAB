/**
 * 120.md §7 — Microsoft Office table recognition and import, pinned.
 *
 * Everything in the import pipeline that is a DECISION rather than an engine
 * behaviour lives in `richEditor/pasteTransform.js` precisely so it can be pinned
 * here: what counts as a table, what counts as a Word caption, which id a pasted
 * table gets, what a tab-separated clipboard is and — just as important — what is
 * NOT any of those things and must be left alone.
 *
 * What is only provable in a real engine (a DataTransfer carrying an Excel bitmap
 * beside the HTML, one native undo step for a whole paste, the caret after the
 * inserted object) is pinned in e2e/manuscript/manuscript-table-paste-120.spec.ts,
 * which runs under chromium AND the `webkit-manuscript` project.
 *
 * The sanitization cases run through the REAL htmlToMd, because that is the seam
 * the paste ladder actually calls: proving the transform is safe on markdown that
 * never went through the sanitizer would prove nothing.
 */
import { describe, it, expect } from 'vitest';
import {
  transformPastedMd, pasteTableIdentity, harvestCaptionTitle,
  hasPipeTableBlock, tsvToPipeTable,
} from '../../../src/features/manuscript/richEditor/pasteTransform.js';
import { htmlToMd, mdToHtml } from '../../../src/features/manuscript/richEditor/mdDom.js';
import { firstLineOf } from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import { TABLE_CAPTION_LINE_RE } from '../../../src/research-engine/manuscript/refTokens.js';

/** Deterministic id factory with mintManualTableId's contract (never collide with
    `taken`), so assertions can name the exact ids they expect. */
function mintSeq() {
  let n = 0;
  return (taken) => {
    for (;;) {
      n += 1;
      const id = `p${n}`;
      const has = taken && typeof taken.has === 'function'
        && (taken.has(id) || taken.has(`table:${id}`));
      if (!has) return id;
    }
  };
}

const captionsOf = (md) => md.split(/\n{2,}/).filter((b) => TABLE_CAPTION_LINE_RE.test(b));
const tablesOf = (md) => md.split(/\n{2,}/).filter((b) => /^\s*\|/.test(b));

/* A real Word "copy table + caption" payload: mso styles, a namespace, class
   attributes, a caption paragraph in Word's caption style, merged cells. */
const WORD_TABLE_HTML = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta name=Generator content="Microsoft Word 15"><style>
<!-- p.MsoCaption { mso-style-name:Caption; font-size:9.0pt; } -->
</style></head>
<body lang=EN-GB style='word-wrap:break-word'>
<p class=MsoCaption style='mso-element:field-begin'>Table 2. Baseline characteristics</p>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0
 style='border-collapse:collapse;mso-yfti-tbllook:1184'>
 <tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>
  <th style='background:#D9D9D9'><p class=MsoNormal>Group</p></th>
  <th colspan=2 style='text-align:center'><p class=MsoNormal>Outcome</p></th>
 </tr>
 <tr>
  <td rowspan=2><p class=MsoNormal>Arm A</p></td>
  <td><p class=MsoNormal>MI</p></td>
  <td><p class=MsoNormal>12</p></td>
 </tr>
 <tr>
  <td><p class=MsoNormal>Stroke</p></td>
  <td><p class=MsoNormal>8</p></td>
 </tr>
</table>
</body></html>`;

describe('120.md §7 — recognizing a table in sanitized clipboard markdown', () => {
  it('a Word table survives sanitization as a pipe table and is detected', () => {
    const md = htmlToMd(WORD_TABLE_HTML);
    expect(hasPipeTableBlock(md)).toBe(true);
    // mso-*, the Office namespaces, the class attributes and the <style> block are
    // all gone — nothing of Word's stylesheet reaches the document.
    expect(md).not.toMatch(/mso-/i);
    expect(md).not.toMatch(/MsoTableGrid|MsoCaption|MsoNormal/);
    expect(md).not.toMatch(/urn:schemas-microsoft-com/);
  });

  it('a <table> hidden inside a dropped tag never triggers the table route', () => {
    // THE ORDERING PROPERTY: the check is asked of the CONVERTED markdown, never of
    // the raw clipboard string, so markup the sanitizer has already decided is not
    // content cannot steer the paste.
    const hostile = '<p>hello</p><script><table><tr><td>x</td></tr></table></script>';
    expect(/<table/i.test(hostile)).toBe(true);
    expect(hasPipeTableBlock(htmlToMd(hostile))).toBe(false);
  });

  it('ordinary prose is not a table', () => {
    expect(hasPipeTableBlock(htmlToMd('<p>Randomised trials were pooled.</p>'))).toBe(false);
    expect(hasPipeTableBlock('')).toBe(false);
    expect(hasPipeTableBlock(null)).toBe(false);
  });
});

describe('120.md §7 — identity minting', () => {
  it('a caption-less pasted table gets a fresh id and a caption line', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const out = transformPastedMd(md, { usedTableIds: [], mint: mintSeq() });
    expect(out.mintedTables).toEqual([{ id: 'p1', title: '' }]);
    expect(out.md).toBe('[[tblcap:p1]]\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
    // …and the result is a fixed point of the converters (the §63 guarantee).
    expect(htmlToMd(mdToHtml(out.md))).toBe(out.md);
  });

  it('multiple tables in ONE paste each get their own id', () => {
    const md = '| A |\n| --- |\n| 1 |\n\n| B |\n| --- |\n| 2 |';
    const out = transformPastedMd(md, { usedTableIds: [], mint: mintSeq() });
    expect(out.mintedTables.map((t) => t.id)).toEqual(['p1', 'p2']);
    expect(captionsOf(out.md)).toHaveLength(2);
    expect(tablesOf(out.md)).toHaveLength(2);
  });

  it('a table that ALREADY carries a caption marker gets no second caption', () => {
    const md = '[[tblcap:keepme]] Pooled estimates\n\n| A |\n| --- |\n| 1 |';
    const out = transformPastedMd(md, { usedTableIds: [], mint: mintSeq() });
    expect(out.mintedTables).toEqual([]);
    expect(out.md).toBe(md);
    expect(captionsOf(out.md)).toHaveLength(1);
  });

  it('a DUPLICATE caption id is re-minted (copy = a new table), a free one is kept (cut = a move)', () => {
    const md = '[[tblcap:t1]] Baseline\n\n| A |\n| --- |\n| 1 |';
    const copy = transformPastedMd(md, { usedTableIds: ['t1'], mint: mintSeq() });
    expect(copy.md).toContain('[[tblcap:p1]]');
    expect(copy.reminted).toEqual([{ from: 't1', to: 'p1' }]);
    // …and it is still ONE caption, not a remint plus a fresh mint.
    expect(captionsOf(copy.md)).toHaveLength(1);
    expect(copy.mintedTables).toEqual([]);

    const move = transformPastedMd(md, { usedTableIds: ['other'], mint: mintSeq() });
    expect(move.md).toBe(md);
    expect(move.reminted).toEqual([]);
  });

  it('a minted id never collides with the document or with the fragment', () => {
    const md = '[[tblcap:p1]] Kept\n\n| A |\n| --- |\n| 1 |\n\n| B |\n| --- |\n| 2 |';
    const out = pasteTableIdentity(md, ['table:p2'], { mint: mintSeq() });
    // p1 is claimed by the fragment, p2 by the document → the new table takes p3.
    expect(out.mintedTables.map((t) => t.id)).toEqual(['p3']);
  });

  it('a placed figure marker is dropped, an unplaced one survives the paste', () => {
    const md = '[[figcap:abc]] Study flow\n\n[[figcap:xyz]] Forest plot';
    const out = transformPastedMd(md, { usedFigureKeys: ['abc'], mint: mintSeq() });
    expect(out.droppedFigures).toEqual(['abc']);
    expect(out.md).toBe('[[figcap:xyz]] Forest plot');
  });

  it('a table still gets its identity when a figure marker above it was dropped', () => {
    /* REGRESSION: dropping a marker LINE leaves the surviving fragment starting
       with a newline, and a block that does not start with a pipe is not a table —
       the pasted table would have gone in anonymous (unnumbered, unreferenceable). */
    const md = '[[figcap:abc]] Study flow\n\n| A |\n| --- |\n| 1 |';
    const out = transformPastedMd(md, { usedFigureKeys: ['abc'], mint: mintSeq() });
    expect(out.droppedFigures).toEqual(['abc']);
    expect(out.md).toBe('[[tblcap:p1]]\n\n| A |\n| --- |\n| 1 |');
    expect(out.mintedTables).toEqual([{ id: 'p1', title: '' }]);
  });
});

describe('120.md §7 — Word caption harvest', () => {
  it('consumes "Table 2. Baseline characteristics", keeps the title, DISCARDS the number', () => {
    const md = 'Table 2. Baseline characteristics\n\n| A |\n| --- |\n| 1 |';
    const out = transformPastedMd(md, { usedTableIds: [], mint: mintSeq() });
    expect(out.mintedTables).toEqual([{ id: 'p1', title: 'Baseline characteristics' }]);
    // ONE caption, and the imported "2" appears nowhere: PecanRev renumbers.
    expect(out.md).toBe('[[tblcap:p1]] Baseline characteristics\n\n| A |\n| --- |\n| 1 |');
    expect(captionsOf(out.md)).toHaveLength(1);
    expect(out.md).not.toContain('Table 2');
  });

  it('the whole Word payload — caption + merged cells — imports as one titled table', () => {
    const md = htmlToMd(WORD_TABLE_HTML);
    const out = transformPastedMd(md, { usedTableIds: [], mint: mintSeq() });
    expect(out.mintedTables).toEqual([{ id: 'p1', title: 'Baseline characteristics' }]);
    expect(captionsOf(out.md)).toHaveLength(1);
    expect(tablesOf(out.md)).toHaveLength(1);
    // Merged cells are flattened HONESTLY: the colspan and the rowspan become
    // visible blank cells rather than a silent column shift (116.md §66 r3).
    const table = tablesOf(out.md)[0];
    expect(table).toContain('| Group | Outcome |  |');
    expect(table).toContain('| Arm A | MI | 12 |');
    expect(table).toContain('|  | Stroke | 8 |');
    expect(htmlToMd(mdToHtml(out.md))).toBe(out.md);
  });

  it('accepts the separator family Word actually emits, and an empty remainder', () => {
    expect(harvestCaptionTitle('Table 1. Baseline')).toBe('Baseline');
    expect(harvestCaptionTitle('Table 2: Outcomes')).toBe('Outcomes');
    expect(harvestCaptionTitle('Table 3 — Adverse events')).toBe('Adverse events');
    expect(harvestCaptionTitle('Table 4 – Follow-up')).toBe('Follow-up');
    expect(harvestCaptionTitle('TABLE IV. Sensitivity analyses')).toBe('Sensitivity analyses');
    // No descriptive part → an EMPTY title (the placeholder shows). Never invented.
    expect(harvestCaptionTitle('Table 5')).toBe('');
    expect(harvestCaptionTitle('Table 5.')).toBe('');
  });

  it('does NOT eat ordinary prose that happens to start with "Table N"', () => {
    // The sentence a researcher copies together with the table it describes.
    expect(harvestCaptionTitle('Table 1 shows the pooled baseline data.')).toBe(null);
    expect(harvestCaptionTitle('Tables were extracted independently.')).toBe(null);
    expect(harvestCaptionTitle('The table below lists the trials.')).toBe(null);
    // …and neither structure nor length is harvested.
    expect(harvestCaptionTitle('# Table 1. Heading')).toBe(null);
    expect(harvestCaptionTitle('- Table 1. A list item')).toBe(null);
    expect(harvestCaptionTitle(`Table 1. ${'x'.repeat(220)}`)).toBe(null);
    expect(harvestCaptionTitle('Table 1. Two\nlines')).toBe(null);
  });

  it('only the block IMMEDIATELY before a table is a candidate', () => {
    const md = 'Table 9. Not adjacent\n\nAn intervening paragraph.\n\n| A |\n| --- |\n| 1 |';
    const out = transformPastedMd(md, { usedTableIds: [], mint: mintSeq() });
    expect(out.mintedTables).toEqual([{ id: 'p1', title: '' }]);
    expect(out.md).toContain('Table 9. Not adjacent');       // the paragraph is untouched
    expect(out.md).toContain('An intervening paragraph.');
  });

  it('a caption paragraph with NO table after it is left as prose', () => {
    const md = 'Table 2. Baseline characteristics';
    const out = transformPastedMd(md, { usedTableIds: [], mint: mintSeq() });
    expect(out.md).toBe(md);
    expect(out.mintedTables).toEqual([]);
  });
});

describe('120.md §7 — tab-separated clipboard text', () => {
  it('an Excel range becomes a pipe table, first row as the header', () => {
    const md = tsvToPipeTable('Group\tEvents\tTotal\nArm A\t12\t100\nArm B\t8\t101\n');
    expect(md).toBe([
      '| Group | Events | Total |',
      '| --- | --- | --- |',
      '| Arm A | 12 | 100 |',
      '| Arm B | 8 | 101 |',
    ].join('\n'));
    expect(hasPipeTableBlock(md)).toBe(true);
    expect(htmlToMd(mdToHtml(md))).toBe(md);
  });

  it('handles CRLF, blank cells and a literal pipe in a cell', () => {
    const md = tsvToPipeTable('A\tB\r\n\t2\r\nx | y\t3\r\n');
    expect(md).toContain('|  | 2 |');
    expect(md).toContain('| x \\| y | 3 |');
    expect(htmlToMd(mdToHtml(md))).toBe(md);
  });

  it('REJECTS anything that is not a grid — ordinary text pasting must not change', () => {
    expect(tsvToPipeTable('one line only\twith a tab')).toBe(null);   // <2 rows
    expect(tsvToPipeTable('no tabs here\nnor here')).toBe(null);      // 0 tabs
    expect(tsvToPipeTable('a\tb\nc\td\te')).toBe(null);               // ragged
    expect(tsvToPipeTable('a\tb\n\nc\td')).toBe(null);                // blank interior row
    expect(tsvToPipeTable('')).toBe(null);
    expect(tsvToPipeTable(null)).toBe(null);
  });

  it('an Excel FORMULA copied as text is imported as text, never evaluated', () => {
    const md = tsvToPipeTable('Value\tFormula\n42\t=SUM(A1:A9)\n');
    expect(md).toContain('=SUM(A1:A9)');
    expect(hasPipeTableBlock(md)).toBe(true);
  });
});

describe('120.md §7 — sanitization and scale', () => {
  it('scripts, event handlers, form elements and Office XML are dropped', () => {
    const hostile = `<table onmouseover="steal()">
      <tr><td onclick="alert(1)"><script>evil()</script>Cell<!--[if gte mso 9]><xml>
      <o:DocumentProperties/></xml><![endif]--></td>
      <td><form><input value="x"><button>go</button></form>Safe</td></tr></table>`;
    const md = htmlToMd(hostile);
    expect(hasPipeTableBlock(md)).toBe(true);
    expect(md).not.toMatch(/onmouseover|onclick|<script|evil\(|steal\(/i);
    expect(md).not.toMatch(/DocumentProperties|<o:|<xml/i);
    expect(md).toContain('Cell');
    expect(md).toContain('Safe');
    const out = transformPastedMd(md, { usedTableIds: [], mint: mintSeq() });
    expect(out.mintedTables).toHaveLength(1);
    expect(htmlToMd(mdToHtml(out.md))).toBe(out.md);
  });

  it('a javascript: href stays literal text, never a link', () => {
    const md = htmlToMd('<table><tr><td><a href="javascript:alert(1)">click</a></td></tr></table>');
    expect(md).toContain('click');
    expect(md).not.toContain('javascript:');
    expect(md).not.toMatch(/\]\(/);
  });

  it('a NESTED table degrades to space-separated text inside its cell — the documented fallback', () => {
    /* The pipe grammar has no nested table, so the inner one is flattened into the
       cell it sat in. That is lossy but VISIBLE and it never merges unrelated
       content: the inner values stay inside the cell that contained them, and the
       outer grid keeps its own shape. */
    const md = htmlToMd(
      '<table><tr><td>Outer<table><tr><td>in1</td><td>in2</td></tr></table></td><td>Next</td></tr></table>',
    );
    expect(md.split('\n')).toHaveLength(1);            // ONE row: no second table
    expect(md).toContain('in1');
    expect(md).toContain('in2');
    expect(md).toContain('Next');
    expect(htmlToMd(mdToHtml(md))).toBe(md);
  });

  it('a 100-column × 200-row monster converts without blowing up', () => {
    const cells = (tag) => Array.from({ length: 100 }, (_, i) => `<${tag}>c${i}</${tag}>`).join('');
    const html = `<table><tr>${cells('th')}</tr>${
      Array.from({ length: 200 }, () => `<tr>${cells('td')}</tr>`).join('')}</table>`;
    const t0 = Date.now();
    const out = transformPastedMd(htmlToMd(html), { usedTableIds: [], mint: mintSeq() });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(out.mintedTables).toHaveLength(1);
    expect(tablesOf(out.md)[0].split('\n')).toHaveLength(202);  // header + separator + 200
  });
});

describe('120.md §7 — the one-line title paste', () => {
  it('firstLineOf reduces a multi-line clipboard payload to its first line', () => {
    expect(firstLineOf('Baseline characteristics\nof the included trials')).toBe('Baseline characteristics');
    expect(firstLineOf('  spaced  \r\nsecond')).toBe('spaced');
    expect(firstLineOf('')).toBe('');
    expect(firstLineOf(null)).toBe('');
  });
});
