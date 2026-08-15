/**
 * 117.md §4-§11 / §69-§70 / §92 — manuscript TABLE OBJECTS and smart cross-references.
 *
 * The contract under test, end to end and pure:
 *   §4  a hand-authored table carries a stable id + title in ONE caption-marker line
 *       that round-trips byte-stably, survives paste, and re-mints on duplication;
 *   §5-§7 every table — builder or manual — is numbered in ONE sequence by DOCUMENT
 *       order, derived per call, so deleting/moving renumbers and references follow;
 *   §8  captions render through one template-keyed formatter seam;
 *   §11 a reference whose target is gone is DETECTABLE (broken chip + export error);
 *   §69/§70 the kind set lives in one registry every consumer reads;
 *   §92 manual tables export with caption + bookmark like any other object.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  ASSET_KINDS, ASSET_KIND_IDS, ASSET_TOKEN_RE, PLAIN_MENTION_RE, assetKindLabel, assetKindOf,
  TABLE_CAPTION_LINE_RE, tableCaptionLine, findTableCaptions, collectManualTables,
  mintManualTableId, remintDuplicateCaptions, countAssetMentions,
  // 117.md §J.15 — duplicate caption ids that only a non-editor writer can create.
  collectDuplicateManualTableIds, sectionLabelOf,
  CAPTION_FORMATS, captionFormatFor, formatAssetLabel, formatCaptionPrefix, formatAssetCaption,
  resolveNumbering, renderAssetMarkers,
  computeManuscriptAssets, computePlacements, validateExport,
} from '../../../src/research-engine/manuscript/index.js';
import {
  makeManuscriptDraft, normalizeDraft, JOURNAL_TEMPLATE_IDS,
} from '../../../src/research-engine/manuscript/model.js';
import {
  mdToHtml, htmlToMd, stripInlineMd,
} from '../../../src/features/manuscript/richEditor/mdDom.js';
import { makeCaptionedTableMd } from '../../../src/features/manuscript/richEditor/tableOps.js';
import { buildManuscriptDocx } from '../../../src/features/manuscript/export/manuscriptDocx.js';

const rt = (md, opts) => htmlToMd(mdToHtml(md, opts));
const sec = (id, content) => ({ id, content });
/** A registry-shaped asset (origin defaults to 'auto', like every builder asset). */
const A = (id, kind, extra = {}) => ({
  id, kind, available: true, included: true, title: id, origin: 'auto', ...extra,
});
/** A manual (in-prose) table asset. */
const M = (bare, title) => ({
  id: `table:${bare}`, kind: 'table', origin: 'manual', manualId: bare,
  available: true, included: true, title, defaultCaption: title,
});

const TBL = ['| Group | N |', '| --- | --- |', '| A | 12 |'].join('\n');

/* ════════════ §69/§70 — one kind registry ════════════ */

describe('117.md §69/§70 — the asset kind registry is the single source', () => {
  it('drives the token regex, the plain-mention scanner and the chip labels', () => {
    expect(ASSET_KIND_IDS).toEqual(['table', 'figure']);
    // the token regex is BUILT from the registry, byte-identical to the old literal
    expect(ASSET_TOKEN_RE.source).toBe('\\[\\[(table|figure):([a-z0-9:-]+)\\]\\]');
    // the plain-mention scanner uses the registry LABELS
    expect(PLAIN_MENTION_RE.source).toBe('\\b(Table|Figure)\\s+(\\d+)\\b');
    for (const k of ASSET_KINDS) expect(assetKindLabel(k.id)).toBe(k.label);
    // a full asset id resolves to its kind label too (chip/caption rendering)
    expect(assetKindLabel('figure:forest:mace-5y')).toBe('Figure');
    expect(assetKindOf('table:study')).toBe('table');
    expect(assetKindOf('suppl:x')).toBe(null); // unknown prefix stays unknown
  });
});

/* ════════════ §8 — the caption formatter seam ════════════ */

describe('117.md §8 — caption rendering goes through ONE template-keyed seam', () => {
  it('defaults to "Table N. Title" for every shipped journal template', () => {
    for (const id of JOURNAL_TEMPLATE_IDS) {
      expect(captionFormatFor(id)).toBe(CAPTION_FORMATS.default);
      expect(formatAssetCaption('table', 3, 'Baseline characteristics', { templateId: id }))
        .toBe('Table 3. Baseline characteristics');
    }
    expect(formatAssetLabel('table', 3)).toBe('Table 3');
    expect(formatAssetLabel('figure', null)).toBe('Figure ?');
    expect(formatCaptionPrefix('figure', 2)).toBe('Figure 2.');
    // a title-less object still gets an honest caption line
    expect(formatAssetCaption('table', 1, '')).toBe('Table 1.');
  });

  it('is a real seam: a different format changes the caption without touching semantics', () => {
    const bracketed = {
      id: 'bracketed',
      label: (kind, n) => `${kind} ${n == null ? '—' : n}`,
      prefix: (kind, n) => `${kind.toUpperCase()} ${n == null ? '—' : n} |`,
      caption: (prefix, title) => `${prefix} ${title}`.trim(),
    };
    expect(formatAssetCaption('table', 4, 'Pooled estimates', { format: bracketed }))
      .toBe('TABLE 4 | Pooled estimates');
    expect(formatAssetLabel('table', 4, { format: bracketed })).toBe('Table 4');
    // the object itself never changed — only the rendering did
    expect(formatAssetCaption('table', 4, 'Pooled estimates')).toBe('Table 4. Pooled estimates');
  });
});

/* ════════════ §4 — the caption grammar ════════════ */

describe('117.md §4 — the manual-table caption grammar', () => {
  it('serializes canonically and parses back with id + title + position', () => {
    expect(tableCaptionLine('t1abc', '  Baseline  characteristics ')).toBe('[[tblcap:t1abc]] Baseline characteristics');
    expect(tableCaptionLine('t1abc', '')).toBe('[[tblcap:t1abc]]');
    // bracket grammar can never be smuggled into a title (it would break parsing)
    expect(tableCaptionLine('t1abc', 'Effect [95% CI]')).toBe('[[tblcap:t1abc]] Effect 95% CI');
    const found = findTableCaptions(`intro\n\n${tableCaptionLine('t1abc', 'Baseline')}\n\n${TBL}`);
    expect(found).toEqual([{ id: 't1abc', assetId: 'table:t1abc', title: 'Baseline', index: 7, line: 2 }]);
  });

  it('is LINE-anchored — a marker inside a sentence is not a caption', () => {
    expect(findTableCaptions('See [[tblcap:t1abc]] mid-sentence.')).toEqual([]);
    expect(TABLE_CAPTION_LINE_RE.test('[[tblcap:t1abc]] Title')).toBe(true);
    expect(TABLE_CAPTION_LINE_RE.test('x [[tblcap:t1abc]] Title')).toBe(false);
    // and it can never be read as a cross-reference token (closed kind set)
    expect(new RegExp(ASSET_TOKEN_RE.source).test('[[tblcap:t1abc]]')).toBe(false);
  });

  it('collects manual tables across a draft in canonical document order', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.results.content = `${tableCaptionLine('tb', 'Second')}\n\n${TBL}`;
    draft.sections.methods.content = `${tableCaptionLine('ta', 'First')}\n\n${TBL}`;
    expect(collectManualTables(draft).map((t) => t.id)).toEqual(['ta', 'tb']);
    // a duplicate id resolves to its FIRST occurrence rather than numbering twice
    draft.sections.discussion.content = `${tableCaptionLine('ta', 'Copy')}\n\n${TBL}`;
    expect(collectManualTables(draft).map((t) => t.id)).toEqual(['ta', 'tb']);
  });

  /* 117.md §J.15 — the SAME first-wins rule, but SAID OUT LOUD. Unreachable from the
     editor (paste re-mints, see §4d below); reachable from a hand-edited or imported
     blob, which is exactly the population this collector describes. */
  it('117.md §J.15: duplicate ids are collected with their count and DISTINCT sections', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.methods.content = `${tableCaptionLine('ta', 'First')}\n\n${TBL}`;
    draft.sections.results.content = `${tableCaptionLine('tb', 'Unique')}\n\n${TBL}`;
    // clean draft → nothing to report
    expect(collectDuplicateManualTableIds(draft)).toEqual([]);

    draft.sections.discussion.content = `${tableCaptionLine('ta', 'Copy')}\n\n${TBL}`;
    expect(collectDuplicateManualTableIds(draft)).toEqual([
      { id: 'ta', count: 2, sectionIds: ['methods', 'discussion'], sectionLabels: ['Methods', 'Discussion'] },
    ]);

    // three copies, two of them in one section → the section is named ONCE
    draft.sections.results.content = `${tableCaptionLine('tb', 'A')}\n\n${TBL}\n\n${tableCaptionLine('tb', 'B')}\n\n${TBL}`;
    const dup = collectDuplicateManualTableIds(draft);
    expect(dup.map((d) => [d.id, d.count])).toEqual([['ta', 2], ['tb', 2]]);
    expect(dup.find((d) => d.id === 'tb').sectionIds).toEqual(['results']);
  });

  it('117.md §J.15: reported in FIRST-OCCURRENCE document order, and the first copy is the one that numbers', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.discussion.content = `${tableCaptionLine('zz', 'Late')}\n\n${TBL}\n\n${tableCaptionLine('zz', 'Later')}\n\n${TBL}`;
    draft.sections.introduction.content = `${tableCaptionLine('aa', 'Early')}\n\n${TBL}`;
    draft.sections.methods.content = `${tableCaptionLine('aa', 'Again')}\n\n${TBL}`;
    expect(collectDuplicateManualTableIds(draft).map((d) => d.id)).toEqual(['aa', 'zz']);
    // and the registry still resolves each id to its first occurrence
    expect(collectManualTables(draft).map((t) => t.title)).toEqual(['Early', 'Late']);
  });

  it('117.md §J.15: section labels fall back to the raw id for an unknown section', () => {
    expect(sectionLabelOf('methods')).toBe('Methods');
    expect(sectionLabelOf('conclusion')).toBe('Conclusions');
    expect(sectionLabelOf('not-a-section')).toBe('not-a-section');
    expect(sectionLabelOf(null)).toBe('');
    // an ordered-sections array (the other accepted input shape) works too
    expect(collectDuplicateManualTableIds([
      { id: 'custom', content: `${tableCaptionLine('q1', 'A')}\n\n${TBL}\n\n${tableCaptionLine('q1', 'B')}\n\n${TBL}` },
    ])).toEqual([{ id: 'q1', count: 2, sectionIds: ['custom'], sectionLabels: ['custom'] }]);
  });

  it('mints ids that satisfy the token grammar and avoid what is already used', () => {
    const used = new Set();
    for (let i = 0; i < 40; i += 1) {
      const id = mintManualTableId(used);
      expect(/^[a-z0-9-]+$/.test(id)).toBe(true);
      expect(/^(table|figure):[a-z0-9:-]+$/.test(`table:${id}`)).toBe(true);
      expect(used.has(id)).toBe(false);
      used.add(id);
    }
    // full asset ids count as "used" too
    const next = mintManualTableId(['table:zz1']);
    expect(next).not.toBe('zz1');
  });
});

/* ════════════ §4(a)/(c)/(d) — round trip, paste, duplicate mint ════════════ */

describe('117.md §4 — round-trip stability and paste behaviour', () => {
  const CAPTIONED = `${tableCaptionLine('t1abc', 'Baseline characteristics')}\n\n${TBL}`;

  it('a captioned table round-trips md → HTML → md byte-for-byte, idempotently', () => {
    expect(rt(CAPTIONED)).toBe(CAPTIONED);
    expect(rt(rt(CAPTIONED))).toBe(CAPTIONED);
    // numbering changes the RENDERED prefix but never the persisted markdown
    expect(rt(CAPTIONED, { assetNumbers: { 'table:t1abc': 7 } })).toBe(CAPTIONED);
    // an adjacent (non-canonical) caption converges to the canonical form in one pass
    const adjacent = `${tableCaptionLine('t1abc', 'Baseline characteristics')}\n${TBL}`;
    expect(rt(adjacent)).toBe(CAPTIONED);
    expect(rt(rt(adjacent))).toBe(CAPTIONED);
  });

  it('renders a NON-PROSE caption element with a derived number and an editable title', () => {
    const html = mdToHtml(CAPTIONED, { assetNumbers: { 'table:t1abc': 3 } });
    expect(html).toContain('class="ms-tblcap" data-tblcap="t1abc" contenteditable="false"');
    expect(html).toContain('data-tblcap-num="true">Table 3.</span>');
    expect(html).toContain('data-tblcap-title="true" contenteditable="true"');
    expect(html).toContain('aria-label="Table title"');
    expect(html).toContain('>Baseline characteristics</span>');
    // 65.md: never a visible token
    expect(html).not.toContain('[[tblcap:');
    // an unnumbered caption is honest, not blank
    expect(mdToHtml(CAPTIONED)).toContain('>Table ?.</span>');
  });

  it('an empty title renders the placeholder hook and round-trips to a bare marker', () => {
    const bare = `${tableCaptionLine('t1abc', '')}\n\n${TBL}`;
    expect(mdToHtml(bare)).toContain('data-placeholder="Add a table title…"');
    expect(rt(bare)).toBe(bare);
  });

  it('LEGACY drafts without captions are byte-identical through the round trip', () => {
    const legacy = [
      'Baseline data are shown below.',
      '',
      '| Group | N |',
      '| --- | --- |',
      '| A | 12 |',
      '',
      'Table 1. Typed by hand, not an object.',
    ].join('\n');
    expect(rt(legacy)).toBe(legacy);
    expect(rt(rt(legacy))).toBe(legacy);
    expect(mdToHtml(legacy)).not.toContain('ms-tblcap');
  });

  it('paste of a DUPLICATE id mints a fresh one; a moved (unique) id is preserved', () => {
    let n = 0;
    const mint = () => `fresh${(n += 1)}`;
    const pasted = `${tableCaptionLine('t1abc', 'Copy')}\n\n${TBL}`;
    const dup = remintDuplicateCaptions(pasted, ['t1abc'], mint);
    expect(dup.md).toContain('[[tblcap:fresh1]]');
    expect(dup.reminted).toEqual([{ from: 't1abc', to: 'fresh1' }]);
    // moving a table (its id is NOT in use here) keeps the id → references survive
    const moved = remintDuplicateCaptions(pasted, ['other'], mint);
    expect(moved.md).toBe(pasted);
    expect(moved.reminted).toEqual([]);
    // two copies of the SAME id inside one paste both become distinct objects
    const twice = remintDuplicateCaptions(`${pasted}\n\n${pasted}`, [], mint);
    expect(twice.reminted).toEqual([{ from: 't1abc', to: 'fresh2' }]);
    expect(twice.md.match(/\[\[tblcap:/g)).toHaveLength(2);
  });

  it('a stray mid-paragraph marker never leaks a raw token into the page', () => {
    const html = mdToHtml('Text with a stray [[tblcap:t1abc]] marker.');
    expect(html).not.toContain('[[tblcap:');
    expect(html).toContain('Text with a stray  marker.');
    expect(stripInlineMd('[[tblcap:t1abc]] Baseline')).toBe('Baseline');
  });

  it('makeCaptionedTableMd emits the canonical shape the round trip preserves', () => {
    const md = makeCaptionedTableMd('t1abc', '', 2, 2);
    expect(md.startsWith('[[tblcap:t1abc]]\n\n|')).toBe(true);
    expect(rt(md)).toBe(md);
  });
});

/* ════════════ §5-§7 — ONE numbering sequence, by document order ════════════ */

describe('117.md §5-§7 — one numbering sequence in document order', () => {
  const assets = [A('table:search', 'table'), A('table:study', 'table'), M('mine', 'Hand table')];

  it('interleaves manual tables with registry tables by document position', () => {
    const n = resolveNumbering({
      sections: [
        sec('methods', 'Search details in [[table:search]].'),
        sec('results', `${tableCaptionLine('mine', 'Hand table')}\n\n${TBL}\n\nSee [[table:study]] and [[table:mine]].`),
      ],
      assets,
    });
    expect(n.byId['table:search']).toBe(1);   // first body mention, in Methods
    expect(n.byId['table:mine']).toBe(2);     // its OWN block position, in Results
    expect(n.byId['table:study']).toBe(3);    // mentioned after the manual table
    expect(n.orderTables).toEqual(['table:search', 'table:mine', 'table:study']);
  });

  it('a manual table anchors at its BLOCK, never at a mention of it (§7)', () => {
    const n = resolveNumbering({
      sections: [
        // the reference comes FIRST; the table itself is further down
        sec('introduction', 'We summarise this in [[table:mine]].'),
        sec('methods', 'Search details in [[table:search]].'),
        sec('results', `${tableCaptionLine('mine', 'Hand table')}\n\n${TBL}`),
      ],
      assets,
    });
    expect(n.byId['table:search']).toBe(1);
    expect(n.byId['table:mine']).toBe(2);
    expect(n.mentioned.has('table:mine')).toBe(true);
  });

  it('MOVING a table renumbers it and every reference follows (§7)', () => {
    const before = resolveNumbering({
      sections: [
        sec('methods', 'Search details in [[table:search]].'),
        sec('results', `${tableCaptionLine('mine', 'Hand table')}\n\n${TBL}`),
      ],
      assets,
    });
    expect(before.byId['table:mine']).toBe(2);
    const after = resolveNumbering({
      sections: [
        sec('introduction', `${tableCaptionLine('mine', 'Hand table')}\n\n${TBL}`),
        sec('methods', 'Search details in [[table:search]].'),
      ],
      assets,
    });
    expect(after.byId['table:mine']).toBe(1);
    expect(after.byId['table:search']).toBe(2);
    // the token in the prose never changed — only the derived number did
    expect(renderAssetMarkers('See [[table:mine]].', after)).toBe('See Table 1.');
  });

  it('DELETING a table renumbers the rest and the number is reused (§6)', () => {
    const three = [M('t1', 'One'), M('t2', 'Two'), M('t3', 'Three')];
    const body = (ids) => ids.map((i) => `${tableCaptionLine(i, i)}\n\n${TBL}`).join('\n\n');
    const full = resolveNumbering({ sections: [sec('results', body(['t1', 't2', 't3']))], assets: three });
    expect([full.byId['table:t1'], full.byId['table:t2'], full.byId['table:t3']]).toEqual([1, 2, 3]);
    // t2 deleted → the registry is DERIVED, so it simply is not there any more
    const left = [M('t1', 'One'), M('t3', 'Three')];
    const after = resolveNumbering({ sections: [sec('results', body(['t1', 't3']))], assets: left });
    expect(after.byId['table:t1']).toBe(1);
    expect(after.byId['table:t3']).toBe(2);   // renumbered, not a reserved gap
    expect('table:t2' in after.byId).toBe(false);
    // a fourth table created now becomes Table 3 — deleted numbers are not consumed
    const readded = [...left, M('t4', 'Four')];
    const grown = resolveNumbering({ sections: [sec('results', body(['t1', 't3', 't4']))], assets: readded });
    expect(grown.byId['table:t4']).toBe(3);
  });

  it('a reference to a DELETED table is unresolved, never silently renumbered (§11)', () => {
    const left = [M('t1', 'One'), M('t3', 'Three')];
    const md = `${tableCaptionLine('t1', 'One')}\n\n${TBL}\n\nAs shown in [[table:t2]].`;
    const n = resolveNumbering({ sections: [sec('results', md)], assets: left });
    expect(n.unresolved).toEqual([
      { token: '[[table:t2]]', id: 'table:t2', kind: 'table', sectionId: 'results', reason: 'unknown' },
    ]);
    expect(n.byId['table:t1']).toBe(1);
    expect(renderAssetMarkers('See [[table:t2]].', n)).toBe('See Table ?.');
  });

  it('counts how many times one object is cross-referenced (the §11 warning)', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.results.content = `${tableCaptionLine('t1', 'One')}\n\n${TBL}\n\nSee [[table:t1]].`;
    draft.sections.discussion.content = 'Again [[table:t1]] and once more [[table:t1]].';
    expect(countAssetMentions(draft, 'table:t1')).toBe(3);
    expect(countAssetMentions(draft, 'table:nope')).toBe(0);
  });
});

/* ════════════ §4/§5 — the derived registry ════════════ */

function tinyProject() {
  return {
    id: 'p1', name: 'P', pico: {}, search: { dbs: {} }, prisma: {}, studies: [],
  };
}

describe('117.md §4/§5 — manual tables join computeManuscriptAssets', () => {
  it('appear as kind table / origin manual, available and included, after the builders', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.results.content = `${tableCaptionLine('mine', 'Hand table')}\n\n${TBL}`;
    const assets = computeManuscriptAssets(tinyProject(), draft);
    const mine = assets.find((a) => a.id === 'table:mine');
    expect(mine).toMatchObject({
      kind: 'table', origin: 'manual', manualId: 'mine', sectionId: 'results',
      title: 'Hand table', available: true, included: true, source: 'manuscript',
    });
    // registry assets are explicitly 'auto' so the picker can badge the difference
    expect(assets.find((a) => a.id === 'table:study').origin).toBe('auto');
    // …and the builder tables keep their positions (no id-list churn)
    expect(assets.slice(0, 5).map((a) => a.id))
      .toEqual(['table:study', 'table:sof', 'table:prisma', 'table:rob', 'table:search']);
    expect(assets[5].id).toBe('table:mine');
  });

  it('reads side-metadata from draft.tableMeta but NEVER a title override from draft.assets', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.results.content = `${tableCaptionLine('mine', 'Prose title')}\n\n${TBL}`;
    draft.tableMeta = { mine: { caption: 'Values are mean (SD).', notes: 'Two studies excluded.', createdAt: '2026-01-02T03:04:05.000Z' } };
    draft.assets = { 'table:mine': { title: 'Override attempt' } };
    const mine = computeManuscriptAssets(tinyProject(), draft).find((a) => a.id === 'table:mine');
    // the page is the source of truth for the title (§4)
    expect(mine.title).toBe('Prose title');
    expect(mine.caption).toBe('Values are mean (SD).');
    expect(mine.note).toBe('Two studies excluded.');
    expect(mine.createdAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('are never SPLICED by placement — they are already inline prose', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.results.content = `${tableCaptionLine('mine', 'Hand table')}\n\n${TBL}`;
    const assets = computeManuscriptAssets(tinyProject(), draft);
    const numbering = resolveNumbering({ sections: draft, assets });
    const pl = computePlacements({ sections: draft, numbering, assets });
    const placedIds = Object.values(pl.bySection).flat().map((x) => x.assetId);
    expect(placedIds).not.toContain('table:mine');
    expect(pl.fallback).not.toContain('table:mine');
    // and the caption line is not mistaken for stale plain-text "Table N" prose
    expect(pl.plainMentions.some((p) => p.sectionId === 'results')).toBe(false);
  });
});

describe('117.md §4 — normalizeDraft keeps tableMeta additive (snapshots pattern)', () => {
  it('materializes only when non-empty; legacy blobs stay byte-identical', () => {
    const withMeta = normalizeDraft({ tableMeta: { t1: { createdAt: 'x' } } });
    expect(withMeta.tableMeta).toEqual({ t1: { createdAt: 'x' } });
    expect('tableMeta' in normalizeDraft({ tableMeta: {} })).toBe(false);
    expect('tableMeta' in normalizeDraft({ tableMeta: { a: null, b: 'nope' } })).toBe(false);
    expect('tableMeta' in normalizeDraft({ tableMeta: ['x'] })).toBe(false);
    expect('tableMeta' in normalizeDraft({ sections: { results: { content: 'x' } } })).toBe(false);
    expect('tableMeta' in makeManuscriptDraft({})).toBe(false);
    // The legacy pin that matters: an old blob (uncaptioned table, no tableMeta)
    // normalizes to EXACTLY the same bytes on every pass — no phantom key, no
    // migration, nothing for autosave to rewrite.
    const legacy = { id: 'draft_fixed', sections: { results: { content: `x\n\n${TBL}` } } };
    const once = JSON.stringify(normalizeDraft(legacy));
    expect(once).toBe(JSON.stringify(normalizeDraft(legacy)));
    expect(once).toBe(JSON.stringify(normalizeDraft(normalizeDraft(legacy))));
    expect(once).not.toContain('tableMeta');
  });

  /* 117.md §J.6 — ORPHAN ENTRIES, EVALUATED. Deleting a table as plain prose leaves
     its side-metadata entry behind, and that orphan is the mechanism that lets ONE
     native Ctrl+Z restore the table WITH its created/modified stamps. The narrow GC
     that was proposed (strip orphans from prepareExport's exportDraft copy) is dead
     code, and this is the evidence: the export model is byte-identical with and
     without the orphan, because every reader iterates the LIVE caption markers and
     looks each id up — an entry with no marker is never read. See the decision note
     on useManuscript.setTableMeta. */
  it('117.md §J.6: an ORPHAN tableMeta entry cannot change the export model', () => {
    const base = normalizeDraft(makeManuscriptDraft({}));
    base.sections.results.content = `${tableCaptionLine('live', 'Baseline characteristics')}\n\n${TBL}`;
    base.tableMeta = { live: { createdAt: '2026-01-01T00:00:00.000Z' } };

    const orphaned = normalizeDraft({
      ...base,
      // 'ghost' was deleted from the prose; its stamps survive for undo.
      tableMeta: { ...base.tableMeta, ghost: { createdAt: '2020-01-01T00:00:00.000Z', notes: 'gone' } },
    });

    const model = (d) => {
      const assets = computeManuscriptAssets(tinyProject(), d);
      const numbering = resolveNumbering({ sections: d, assets });
      const placements = computePlacements({ sections: d, numbering, assets });
      return JSON.stringify({
        assets,
        byId: numbering.byId,
        orderTables: numbering.orderTables,
        validation: validateExport({ project: tinyProject(), draft: d, assets, numbering, placements }),
      });
    };
    expect(model(orphaned)).toBe(model(base));
    // …and the orphan is genuinely still there to be restored by undo.
    expect(orphaned.tableMeta.ghost).toEqual({ createdAt: '2020-01-01T00:00:00.000Z', notes: 'gone' });
  });
});

/* ════════════ §11 — broken references reach validation ════════════ */

describe('117.md §11 — broken references surface honestly', () => {
  const runValidate = (draft) => {
    const assets = computeManuscriptAssets(tinyProject(), draft);
    const numbering = resolveNumbering({ sections: draft, assets });
    const placements = computePlacements({ sections: draft, numbering, assets });
    return { v: validateExport({ project: tinyProject(), draft, assets, numbering, placements }), assets, numbering };
  };

  it('a reference to a deleted manual table is an ERROR with a closest-match suggestion', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.results.content = `${tableCaptionLine('baseline', 'Baseline')}\n\n${TBL}`;
    draft.sections.discussion.content = 'As shown in [[table:baselin]].'; // typo / stale id
    const { v } = runValidate(draft);
    const err = v.errors.find((e) => e.code === 'unknown-asset-ref');
    expect(err).toBeTruthy();
    expect(err.message).toContain('[[table:baselin]]');
    expect(err.message).toContain('closest match is "table:baseline"');
  });

  it('REGENERATION that overwrites a section with manual tables leaves a broken state, not silence', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.results.content = `${tableCaptionLine('baseline', 'Baseline')}\n\n${TBL}`;
    draft.sections.discussion.content = 'Baseline data are in [[table:baseline]].';
    expect(runValidate(draft).v.errors.filter((e) => e.code === 'unknown-asset-ref')).toHaveLength(0);
    // Results is regenerated from project data — the caption (and the object) is gone.
    draft.sections.results.content = '## Study selection\n\nGenerated prose without any table.';
    const after = runValidate(draft);
    expect(after.assets.some((a) => a.id === 'table:baseline')).toBe(false);
    expect(after.numbering.unresolved.map((u) => u.id)).toEqual(['table:baseline']);
    expect(after.v.errors.map((e) => e.code)).toContain('unknown-asset-ref');
  });

  it('a table WITHOUT a caption is still reported, but only as awareness INFO', () => {
    const draft = normalizeDraft(makeManuscriptDraft({}));
    draft.sections.results.content = `${TBL}\n\n${tableCaptionLine('mine', 'Named')}\n\n${TBL}`;
    const { v } = runValidate(draft);
    const info = v.info.find((i) => i.code === 'user-tables');
    expect(info.message).toContain('1 table without a caption');
    expect(v.errors).toHaveLength(0);
  });

  it('mdToHtml marks a token outside the live registry as a BROKEN chip', () => {
    const known = new Set(['table:alive']);
    const html = mdToHtml('See [[table:alive]] and [[table:gone]].', {
      assetNumbers: { 'table:alive': 1 }, knownAssetIds: known,
    });
    expect(html).toContain('data-asset="table:alive" role="button"');
    expect(html).toContain('>Table 1</span>');
    expect(html).toContain('data-asset="table:gone" data-asset-broken="true"');
    expect(html).toContain('>Table (deleted)</span>');
    expect(html).toContain('aria-label="Broken cross-reference: Table (deleted).');
    // WITHOUT a known-id set nothing is accused of being deleted
    expect(mdToHtml('See [[table:gone]].')).not.toContain('data-asset-broken');
    // and the broken chip still reverses to its token — relinking stays possible
    expect(htmlToMd(html)).toBe('See [[table:alive]] and [[table:gone]].');
  });
});

/* ════════════ §92/§41 — the Word export ════════════ */

describe('117.md §92/§41 — manual tables export with caption, bookmark and cross-refs', () => {
  it('emits an in-place numbered caption, a Bookmark anchor and an InternalHyperlink', async () => {
    const project = tinyProject();
    const draft = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    draft.sections.results.content = `${tableCaptionLine('baseline', 'Baseline characteristics')}\n\n${TBL}`;
    draft.sections.discussion.content = 'Baseline data are summarised in [[table:baseline]].';
    draft.tableMeta = { baseline: { caption: 'Values are mean (SD).', notes: 'One study excluded.' } };

    const blob = await buildManuscriptDocx(project, draft, {});
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');

    // §8 caption line, rendered through the template formatter
    expect(xml).toContain('Table 1. Baseline characteristics');
    // §4 side-metadata reaches the file (caption paragraph + note under the table)
    expect(xml).toContain('Values are mean (SD).');
    expect(xml).toContain('One study excluded.');
    // §41/§92 bookmark + cross-reference hyperlink to it
    expect(xml).toContain('w:name="ref_table_baseline"');
    expect(xml).toContain('w:anchor="ref_table_baseline"');
    // the raw grammar never leaks into the manuscript
    expect(xml).not.toContain('[[tblcap:');
    expect(xml).not.toContain('[[table:');
    // the table itself is emitted ONCE (inline), not duplicated at the end
    expect(xml.split('Baseline characteristics').length - 1).toBe(1);
  }, 30_000);

  it('numbers a manual table AFTER a registry table mentioned earlier in the body', async () => {
    const project = {
      ...tinyProject(),
      studies: [{ id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', outcome: 'MACE' }],
    };
    const draft = normalizeDraft(makeManuscriptDraft({ title: 'T' }));
    draft.sections.methods.content = 'Study characteristics appear in [[table:study]].';
    draft.sections.results.content = `${tableCaptionLine('extra', 'Sensitivity analyses')}\n\n${TBL}`;
    const blob = await buildManuscriptDocx(project, draft, {});
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Table 2. Sensitivity analyses');
  }, 30_000);
});
