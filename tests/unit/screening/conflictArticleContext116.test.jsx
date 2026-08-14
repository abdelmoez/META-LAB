/**
 * conflictArticleContext116.test.jsx — 116.md §67 (§§67-70, D14).
 *
 * The Conflict tab must give a resolver the SAME article context the Title &
 * Abstract workbench gives a screener — by REUSING that surface, not by forking a
 * thinner copy. Pins, all SSR static markup (project convention: no jsdom, no RTL):
 *
 *  1. EXTRACTION FIDELITY — MiddleColumn's article region is exactly what the
 *     shared <RecordArticleCard> renders (containment, character-for-character),
 *     so the T&A output cannot drift when the shared component changes.
 *  2. §67/§68 — the conflict card renders the full title, the metadata line, the
 *     DOI/PMID links, the source/duplicate badges, and the COMPLETE abstract with
 *     the same PICO <mark> highlighting + structured-heading <strong> primitives.
 *     The fold is all-or-nothing: no clamped/ellipsised abstract text, ever.
 *  3. §69 — the record-keyed PdfViewer is mounted with the T&A permission bar
 *     (canScreen || isLeader), and only for the conflicted record.
 *  4. §70 — reviewer decisions keep their DecisionChips and gain names + exclusion
 *     reason / notes / quality rating; the leader's resolve form (include/exclude/
 *     maybe + note + Resolve Conflict) is unchanged, and a non-resolver still sees
 *     "Awaiting leader resolution."
 *  5. Blind mode: the component renders only what the server sent — a blinded
 *     payload (see listConflicts116.test.js) carries no names/details to leak.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import { MiddleColumn } from '../../../src/frontend/screening/tabs/ScreeningTab.jsx';
import RecordArticleCard from '../../../src/frontend/screening/components/RecordArticleCard.jsx';
import { ConflictCard, conflictReviewerRows } from '../../../src/frontend/screening/tabs/ConflictsTab.jsx';

const noop = () => {};

const RECORD = {
  id: 'rec-1',
  title: 'A randomized trial of drug-resistant epilepsy surgery',
  authors: 'Doe J, Roe R, Poe E',
  journal: 'Journal of Trials',
  year: 2021,
  doi: '10.1000/xyz123',
  pmid: '12345678',
  sourceDb: 'PubMed',
  isDuplicate: true,
  abstract:
    'BACKGROUND: Drug-resistant epilepsy is common. METHODS: A randomized controlled trial in adults. '
    + 'RESULTS: The animal study was excluded. CONCLUSIONS: Useful.',
  keywords: 'epilepsy; surgery, adults',
  currentStage: 'title_abstract',
};

const INCLUSION = ['randomized controlled trial'];
const EXCLUSION = ['animal study'];

const CONFLICT = {
  id: 'cf-1',
  recordId: 'rec-1',
  record: RECORD,
  reviewerDecisions: '{"u1":"include","u2":"exclude"}',
  decisions: [
    { reviewerId: 'u1', reviewerName: 'Dr Ada Byron', isMe: true, isEngine: false, decision: 'include', exclusionReason: '', notes: 'Population matches.', rating: 4 },
    { reviewerId: 'u2', reviewerName: 'Dr Grace Hopper', isMe: false, isEngine: false, decision: 'exclude', exclusionReason: 'Wrong population', notes: '', rating: null },
  ],
  finalDecision: '',
  resolvedAt: null,
};

const LEADER = { isLeader: true, canScreen: true, canResolveConflicts: true };

const card = (over = {}) => r(h(ConflictCard, {
  pid: 'p1', conflict: CONFLICT, blindMode: false,
  inclusion: INCLUSION, exclusion: EXCLUSION,
  access: LEADER, canResolve: true,
  expanded: true, onToggleAbstract: noop,
  form: {}, onFormChange: noop, onResolve: noop, busy: false, ...over,
}));

const article = (over = {}) => r(h(RecordArticleCard, {
  record: RECORD, blindMode: false,
  inclusion: INCLUSION, exclusion: EXCLUSION, showInclusion: true, showExclusion: true, ...over,
}));

const middle = (over = {}) => r(h(MiddleColumn, {
  record: RECORD, loading: false, blindMode: false, canScreen: true, isLeader: false,
  inclusion: INCLUSION, exclusion: EXCLUSION, showInclusion: true, showExclusion: true, pid: 'p1',
  decision: '', excReason: '', setExcReason: noop, notes: '', setNotes: noop,
  rating: 0, setRating: noop, reasons: [], setReasons: noop,
  labels: [], chosenLabels: [], toggleLabel: noop,
  onDecisionClick: noop, onUndo: noop, onSaveDetails: noop,
  saving: false, saveMsg: '', decErr: '',
  recordIndex: 0, recordCount: 8, totalCount: 8,
  hasMore: false, loadingMore: false, listError: null,
  onPrev: noop, onNext: noop, shortcutPrefs: undefined,
  ai: { enabled: false }, elig: { enabled: false }, ...over,
}));

/* ── 1. Extraction fidelity — one surface, byte-for-byte ──────────────────────── */

describe('RecordArticleCard is literally the Title & Abstract article surface (116.md §67)', () => {
  it('MiddleColumn embeds the shared component character-for-character', () => {
    expect(middle()).toContain(article());
  });

  it('…in blind mode too, and for a record with no metadata at all', () => {
    expect(middle({ blindMode: true })).toContain(article({ blindMode: true }));
    const bare = {
      ...RECORD, authors: '', journal: '', doi: '', pmid: '', sourceDb: '',
      isDuplicate: false, abstract: '', keywords: '',
    };
    expect(middle({ record: bare })).toContain(article({ record: bare }));
  });

  it('the default (T&A) render is NOT collapsible — no fold control leaks into it', () => {
    expect(middle()).not.toContain('article-abstract-toggle');
    expect(article()).not.toContain('article-abstract-toggle');
  });
});

/* ── 2. §§67-68 — full article context in the conflict card ───────────────────── */

describe('ConflictCard article context (116.md §§67-68)', () => {
  it('renders the shared article surface verbatim — same title, metadata, links, badges', () => {
    const html = card();
    expect(html).toContain(article({ collapsible: true, expanded: true, onToggle: noop }));
    expect(html).toContain('A randomized trial of drug-resistant epilepsy surgery');
    expect(html).toContain('Doe J, Roe R, Poe E');
    expect(html).toContain('Journal of Trials');
    expect(html).toContain('2021');
    expect(html).toContain('https://doi.org/10.1000/xyz123');
    expect(html).toContain('https://pubmed.ncbi.nlm.nih.gov/12345678');
    expect(html).toContain('>PubMed<');
    expect(html).toContain('>Duplicate<');
    expect(html).toContain('KEYWORDS');
  });

  it('shows the COMPLETE abstract with the same highlighting primitives T&A uses', () => {
    const html = card();
    // Every sentence of the abstract survives — nothing is clamped or ellipsised.
    expect(html).toContain('Drug-resistant epilepsy is common.');
    expect(html).toContain('CONCLUSIONS');
    expect(html).toContain('Useful.');
    // …and the abstract paragraph itself carries no "show more" ellipsis.
    const para = html.slice(html.indexOf('data-testid="screening-abstract"'));
    expect(para.slice(0, para.indexOf('</p>'))).not.toContain('…');
    // 107.md §4 structured headings → <strong>; PICO terms → <mark>.
    expect(html).toContain('<strong');
    expect(html).toContain('<mark');
    expect(html).toContain('randomized controlled trial');
    expect(html).toContain('animal study');
    expect(html).toContain('data-testid="screening-abstract"');
  });

  it('folds all-or-nothing (never a truncated abstract) and says so', () => {
    const folded = card({ expanded: false });
    expect(folded).toContain('article-abstract-toggle');
    expect(folded).toContain('▼ Show full abstract');
    expect(folded).toContain('Abstract hidden — show it to read the complete text.');
    // The title and metadata stay visible while folded…
    expect(folded).toContain('A randomized trial of drug-resistant epilepsy surgery');
    // …and no partial abstract text is emitted.
    expect(folded).not.toContain('Drug-resistant epilepsy is common.');
    expect(card()).toContain('▲ Hide abstract');
  });

  it('handles a record with no abstract the same way T&A does', () => {
    const html = card({ conflict: { ...CONFLICT, record: { ...RECORD, abstract: '' } } });
    expect(html).toContain('No abstract available for this record.');
  });
});

/* ── 3. §69 — the shared, record-keyed PDF surface ────────────────────────────── */

describe('ConflictCard PDF (116.md §69)', () => {
  it('mounts the shared screening PdfViewer for the conflicted record', () => {
    const html = card();
    expect(html).toContain('Full-text PDF');
  });

  it('is folded away with the rest of the article context', () => {
    expect(card({ expanded: false })).not.toContain('Full-text PDF');
  });

  it('renders nothing PDF-ish when the conflict carries no record', () => {
    const html = card({ conflict: { ...CONFLICT, record: null } });
    expect(html).not.toContain('Full-text PDF');
  });
});

/* ── 4. §70 — reviewer context + untouched resolve semantics ──────────────────── */

describe('ConflictCard reviewer decisions (116.md §70)', () => {
  it('keeps a DecisionChip per reviewer and adds their name', () => {
    const html = card();
    expect(html).toContain('Reviewer decisions');
    // DecisionChip = glyph + capitalised decision word (unchanged from before).
    expect(html).toContain('✓');
    expect(html).toContain('✗');
    expect(html).toContain('Dr Ada Byron');
    expect(html).toContain('Dr Grace Hopper');
    expect(html).toContain('>YOU<');
    // One chip per reviewer + the three resolve-form buttons.
    expect(html.match(/>include</g)).toHaveLength(2);
    expect(html.match(/>exclude</g)).toHaveLength(2);
    // No form ⇒ only the chips.
    const readOnly = card({ canResolve: false, access: { isLeader: false, canScreen: true } });
    expect(readOnly.match(/>include</g)).toHaveLength(1);
  });

  it('surfaces the exclusion reason, note and quality rating where present', () => {
    const html = card();
    expect(html).toContain('Exclusion reason: ');
    expect(html).toContain('Wrong population');
    expect(html).toContain('Notes: ');
    expect(html).toContain('Population matches.');
    expect(html).toContain('Quality rating: ');
    expect(html).toContain('4/5');
    // A reviewer who recorded nothing is described honestly, not left blank.
    const bare = card({
      conflict: {
        ...CONFLICT,
        decisions: [{ reviewerId: 'u1', reviewerName: 'Dr Ada Byron', decision: 'include', exclusionReason: '', notes: '', rating: null }],
      },
    });
    expect(bare).toContain('No reason or note recorded.');
  });

  it('marks an automated (eligibility engine) vote as such instead of implying a reviewer', () => {
    const html = card({
      conflict: {
        ...CONFLICT,
        decisions: [
          { reviewerId: 'u1', reviewerName: 'Dr Ada Byron', decision: 'include' },
          { reviewerId: 'eligibility-engine', reviewerName: 'Eligibility screening (automated)', isEngine: true, decision: 'exclude' },
        ],
      },
    });
    expect(html).toContain('AUTOMATED');
    expect(html).toContain('Eligibility screening (automated)');
  });

  it('preserves the leader resolve form exactly (include / exclude / maybe + note + button)', () => {
    const html = card();
    expect(html).toContain('Final decision');
    expect(html).toContain('>include<');
    expect(html).toContain('>exclude<');
    expect(html).toContain('>maybe<');
    expect(html).toContain('placeholder="Resolution note (optional)"');
    expect(html).toContain('Resolve Conflict');
    // Disabled until a decision is picked; enabled once one is.
    expect(html).toContain('disabled=""');
    expect(card({ form: { finalDecision: 'include' } })).not.toContain('disabled=""');
    expect(card({ form: { finalDecision: 'include' }, busy: true })).toContain('Resolving…');
    // Excluding tells the leader the note becomes the record's exclusion reason.
    expect(card({ form: { finalDecision: 'exclude' } })).toContain('Saved as this record&#x27;s exclusion reason.');
  });

  it('a member who cannot resolve gets the article context but no form', () => {
    const html = card({ canResolve: false, access: { isLeader: false, canScreen: true } });
    expect(html).toContain('Awaiting leader resolution.');
    expect(html).not.toContain('Resolve Conflict');
    expect(html).toContain('A randomized trial of drug-resistant epilepsy surgery');
  });
});

/* ── 5. Blind mode: the component renders only what the wire carried ──────────── */

describe('ConflictCard under a blinded payload (116.md §70)', () => {
  // Exactly what listConflicts sends a blinded non-leader resolver (see
  // listConflicts116.test.js): no authors/journal, no ids, no free-text detail.
  const BLIND_CONFLICT = {
    ...CONFLICT,
    record: { ...RECORD, authors: '', journal: '' },
    decisions: [
      { reviewerName: 'Reviewer 1', decision: 'include', exclusionReason: '', notes: '', rating: null, isMe: true },
      { reviewerName: 'Reviewer 2', decision: 'exclude', exclusionReason: '', notes: '', rating: null, isMe: false },
    ],
  };

  it('shows the anonymised positional labels and no identity or free-text detail', () => {
    const html = card({ conflict: BLIND_CONFLICT, blindMode: true });
    expect(html).toContain('Reviewer 1');
    expect(html).toContain('Reviewer 2');
    expect(html).not.toContain('Dr Ada Byron');
    expect(html).not.toContain('Dr Grace Hopper');
    expect(html).not.toContain('Wrong population');
    expect(html).not.toContain('Population matches.');
    expect(html).not.toContain('Quality rating: ');
    // …and the article still reads: title + abstract remain, the author line does not.
    expect(html).toContain('A randomized trial of drug-resistant epilepsy surgery');
    expect(html).toContain('Drug-resistant epilepsy is common.');
    expect(html).not.toContain('Doe J, Roe R, Poe E');
    expect(html).not.toContain('Journal of Trials');
  });
});

/* ── Reviewer-row selection (legacy payload compatibility) ────────────────────── */

describe('conflictReviewerRows', () => {
  it('prefers the server-joined decisions', () => {
    expect(conflictReviewerRows(CONFLICT, false)).toBe(CONFLICT.decisions);
  });

  it('falls back to the reviewerDecisions JSON map when no join is present', () => {
    const rows = conflictReviewerRows({ reviewerDecisions: '{"u1":"include","u2":"exclude"}' }, false);
    expect(rows.map(r0 => r0.decision)).toEqual(['include', 'exclude']);
    expect(rows[0].reviewerName).toBe('Reviewer');
    const blind = conflictReviewerRows({ reviewerDecisions: '{"u1":"include","u2":"exclude"}' }, true);
    expect(blind.map(r0 => r0.reviewerName)).toEqual(['Reviewer 1', 'Reviewer 2']);
    expect(blind.every(r0 => r0.reviewerId === undefined)).toBe(true);
  });

  it('survives a malformed map', () => {
    expect(conflictReviewerRows({ reviewerDecisions: 'not json' }, false)).toEqual([]);
    expect(conflictReviewerRows(null, false)).toEqual([]);
  });
});
