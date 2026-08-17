/**
 * 121.md §4 — "Fix Citations and Cross-References Being Inserted on the Next Line",
 * plus §4:168's shared, editor-safe insertion utility. Pinned.
 *
 * The investigation found not one bug but a FAMILY, and the useful thing about that
 * family is that most of it is expressible in Node: the decisions are made by pure
 * rules (caretBookmark.js) and by a payload policy (insertionSession.js), with the DOM
 * doing only what the rules tell it. So this file is:
 *
 *  1. the pure repros, as regression pins — the boundary cases the audit reproduced
 *     against the real modules (empty-context aliasing, the collapsed-to-next-block
 *     snapshot, the nbsp/trim refusals);
 *  2. the pure contract of the shared insertion utility — the session lifecycle and the
 *     two payload policies, which is what lets citations, cross-references and symbols
 *     share ONE caret discipline;
 *  3. SOURCE PINS for the five DOM-side normalisations, because a Range, a placeholder
 *     <br> and execCommand cannot be observed through renderToStaticMarkup and this
 *     repo has no jsdom (the readSource technique, as in 116/119/120).
 *
 * The engine proof — triple-click then cite, select across a boundary then cite, cite
 * in an empty paragraph, cite after a remount while the picker is open — is
 * e2e/manuscript/manuscript-insert-caret-121.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { readSource } from '../../helpers/readSource.js';
import {
  logicalContext, resolveContext, neighborContext, neighborsMatch, hasNeighborContext,
  CARET_CONTEXT_CHARS,
} from '../../../src/features/manuscript/richEditor/caretBookmark.js';
import {
  insertionPlan, wrapInlineChipHtml, CHIP_SEPARATOR,
  insertionPostconditionProblem, createInsertionSession,
} from '../../../src/features/manuscript/richEditor/insertionSession.js';
/* 121.md r2 — the pad rules are pure predicates on purpose, so the pad defect is
   reproduced against the REAL serializer rather than described in a comment. */
import { htmlToMd, mdToHtml } from '../../../src/features/manuscript/richEditor/mdDom.js';
import {
  trailingPadNode, padIsTrailing, livePads, padStrippedHtml,
} from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';

const EDITOR = readSource('src/features/manuscript/richEditor/RichSectionEditor.jsx');

const P1 = 'Pooled estimates favoured the intervention.';
const P2 = 'Heterogeneity was moderate across the included trials.';

/* ══════════════ (1) the pure repros ══════════════ */

describe('121.md §4 — repro E: a selection collapsed to its END lands in the NEXT block', () => {
  it('the SNAPSHOT of that position is honest — which is why only the caret can be fixed', () => {
    /* Blink reports a paragraph-granularity selection (triple-click, Shift+Down, a drag
       past the end of a line) as ending at (nextParagraph, 0). Collapsing to the end
       therefore produces a caret in the FOLLOWING block, and the snapshot taken there
       is not wrong about anything: offset 0, nothing before, the next paragraph's text
       after. Every validity check passes and the chip lands on the next line. The rule
       cannot detect this — so the repair belongs where the collapse happens, and the
       pin for it is the DOM section below. */
    const lg = logicalContext(P2, 0);
    expect(lg).toEqual({ charOffset: 0, before: '', after: P2.slice(0, CARET_CONTEXT_CHARS) });
    expect(resolveContext(P2, lg)).toBe(0);
  });

  it('…and the position it SHOULD have been resolves exactly, in the previous block', () => {
    const end = logicalContext(P1, P1.length);
    expect(resolveContext(P1, end)).toBe(P1.length);
    expect(resolveContext(P2, end)).toBe(null);   // never the following paragraph
  });
});

describe('121.md §4 — repro C4: an empty context matched EVERY empty block', () => {
  it('without neighbours, two empty blocks are indistinguishable', () => {
    const lg = logicalContext('', 0);
    expect(resolveContext('', lg)).toBe(0);          // this one
    expect(resolveContext('', lg)).toBe(0);          // …and any other one, identically
    expect(hasNeighborContext(lg)).toBe(false);
  });

  it('with neighbours, the empty paragraph in the middle is NOT the trailing affordance', () => {
    /* The §3 trailing affordance is re-synthesized on every mount at the END of the
       section: nothing follows it. A researcher's empty paragraph in the middle of the
       document has a next block. That difference is the whole of the fix — and it is
       what closes the documented F17 (docs/editor-engine-120.md item 10), where the
       bookmark re-resolved into the affordance and the citation landed at the end of
       the section. */
    const mid = { ...logicalContext('', 0), ...neighborContext(P1, P2) };
    expect(hasNeighborContext(mid)).toBe(true);
    expect(neighborsMatch(mid, P1, P2)).toBe(true);        // the same place
    expect(neighborsMatch(mid, P1, null)).toBe(false);     // the trailing affordance
    expect(neighborsMatch(mid, P2, P1)).toBe(false);       // a different empty block
    const trailing = { ...logicalContext('', 0), ...neighborContext(P2, null) };
    expect(neighborsMatch(trailing, P2, null)).toBe(true);
    expect(neighborsMatch(trailing, P2, P1)).toBe(false);
  });

  it('"there is no neighbour" is a real answer, not a missing one', () => {
    const first = neighborContext(null, P1);
    expect(first.prevTail).toBe(null);
    expect(first.nextHead).toBe(P1.slice(0, CARET_CONTEXT_CHARS));
    expect(neighborsMatch({ ...logicalContext('', 0), ...first }, null, P1)).toBe(true);
    expect(neighborsMatch({ ...logicalContext('', 0), ...first }, P2, P1)).toBe(false);
  });

  it('an OLD-SHAPE bookmark (no neighbour fields) degrades to the pre-121 behaviour', () => {
    /* `restoreCaretBookmark` accepts externally-held bookmarks — the workspace session
       holds one across the whole life of an open picker — so one taken by a previous
       build (or across a hot update) must still work, not refuse. */
    const old = { blockIndex: 3, charOffset: 0, before: '', after: '' };
    expect(hasNeighborContext(old)).toBe(false);
    expect(neighborsMatch(old, P1, P2)).toBe(true);
    expect(neighborsMatch(old, null, null)).toBe(true);
  });

  it('the neighbour context is trimmed and nbsp-folded, like the serializer', () => {
    // mdDom trims every block on the way out, so an untrimmed tail would refuse every
    // post-remount restore for exactly the wrong reason.
    expect(neighborContext(`${P1}  `, `  ${P2}`)).toEqual(neighborContext(P1, P2));
    expect(neighborContext(`${P1} `, null).prevTail).toBe(neighborContext(P1, null).prevTail);
  });
});

describe('121.md §4 — fix 5: the nbsp and the end-of-block trim', () => {
  it('a caret bookmarked after a chip resolves once the nbsp has become a space', () => {
    /* Repro B2: the chip inserter leaves a `&nbsp;` behind, and every serializer pass
       folds it to a plain space — so the LIVE dom said "…intervention. " while the
       remounted block says "…intervention. ". The same position, spelled differently;
       before 121 it refused and surfaced as the CARET_LOST notice. */
    const live = `${P1} `;
    const saved = `${P1} `;
    const lg = logicalContext(live, live.length);
    expect(lg.before.endsWith(' ')).toBe(true);          // normalised at snapshot time
    expect(resolveContext(saved, lg)).toBe(saved.length);
    expect(resolveContext(live, lg)).toBe(live.length);
  });

  it('…and once the serializer has TRIMMED it away entirely', () => {
    const live = `${P1} `;
    const lg = logicalContext(live, live.length);
    expect(resolveContext(P1, lg)).toBe(P1.length);      // end of block, honestly
  });

  it('the trim tolerance is anchored to the END and never invents a second match', () => {
    const text = 'ratio ratio ratio';
    // an end-of-block bookmark resolves ONLY at the end…
    const atEnd = logicalContext(`${text} `, `${text} `.length);
    expect(resolveContext(text, atEnd)).toBe(text.length);
    // …and a mid-block ambiguity still refuses rather than guessing
    expect(resolveContext(text, { charOffset: 99, before: 'ratio', after: ' ' })).toBe(null);
    // a trailing-space bookmark whose text is simply gone still refuses
    expect(resolveContext('An entirely different paragraph.', atEnd)).toBe(null);
  });

  it('nbsp normalisation does not blur two genuinely different positions', () => {
    const a = logicalContext('dose levels rose', 5);
    expect(resolveContext('dose levels rose', a)).toBe(5);
    expect(resolveContext('doses fell', a)).toBe(null);
  });
});

describe('121.md §4 — repro D: the soft-break <br> is still invisible (documented)', () => {
  it('carets either side of a <br> snapshot IDENTICALLY, and 121 does not claim otherwise', () => {
    /* A <br> contributes nothing to textContent or Range.toString(), so a caret at the
       start of a soft-wrapped second line and a caret at the end of the first line are
       the same offset in the same block's text. 121's fix set does not touch this: the
       repair would be a different representation (offsets that count elements), and
       inventing one here would be a claim the code does not keep. What 121 DOES fix is
       the case that looked identical to a researcher — the chip landing in the next
       BLOCK — which is why this stays pinned as a known limitation rather than removed.
       Recorded in docs/editor-engine-120.md; the grouping guard (gapHasElement) is what
       keeps it from being destructive. */
    const line = 'first line second line';
    const at = 'first line'.length;
    expect(logicalContext(line, at)).toEqual(logicalContext(line, at));
    expect(resolveContext(line, logicalContext(line, at))).toBe(at);
    // after a remount the soft break has become two BLOCKS, and the bookmark whose
    // context spanned it refuses instead of resolving into the wrong one
    const spanning = logicalContext(line, at);
    expect(resolveContext('first line', spanning)).toBe(null);
    expect(resolveContext('second line', spanning)).toBe(null);
  });
});

/* ══════════════ (2) the shared insertion utility ══════════════ */

describe('121.md §4:168 — the payload policy is why one utility can serve three features', () => {
  it('a CHIP gets the sacrificial wrapper and the grouping separator', () => {
    const plan = insertionPlan({ kind: 'chip', html: '<span class="ms-cite">[1]</span>' });
    expect(plan).toEqual({ via: 'html', html: '<span><span class="ms-cite">[1]</span></span>&nbsp;' });
    expect(wrapInlineChipHtml('X')).toBe('<span>X</span>');
    expect(CHIP_SEPARATOR).toBe('&nbsp;');
    // the separator is configurable rather than baked in
    expect(insertionPlan({ kind: 'chip', html: 'X', separator: '' }).html).toBe('<span>X</span>');
  });

  it('TEXT gets neither — no wrapper, no nbsp, nothing added at all', () => {
    /* Both halves matter. An element around a symbol cannot round-trip (htmlToMd
       serializes only known constructs and would drop the span); a trailing nbsp would
       hand symbols the chip path's own post-remount refusal bug, because the serializer
       folds it to a space and trims it at a block end. */
    expect(insertionPlan({ kind: 'text', text: '≤' })).toEqual({ via: 'text', text: '≤' });
    const plan = insertionPlan({ kind: 'text', text: 'α' });
    expect(plan.html).toBeUndefined();
    expect(JSON.stringify(plan)).not.toContain('span');
    expect(JSON.stringify(plan)).not.toContain('nbsp');
    // …and the payload is never HTML-escaped on this path: it goes through
    // execCommand('insertText'), which takes the string verbatim
    expect(insertionPlan({ kind: 'text', text: '<' }).text).toBe('<');
  });

  it('is defensive: an empty or unknown payload produces NO transaction', () => {
    expect(insertionPlan(null)).toBe(null);
    expect(insertionPlan({ kind: 'text', text: '' })).toBe(null);
    expect(insertionPlan({ kind: 'chip', html: '' })).toBe(null);
    expect(insertionPlan({ kind: 'block', html: '<p>x</p>' })).toBe(null);
  });

  it('the DEV postcondition names the defect: a different line block than the bookmark', () => {
    const a = { id: 'p1' };
    const b = { id: 'p2' };
    expect(insertionPostconditionProblem(a, a)).toBe(null);
    expect(insertionPostconditionProblem(a, b)).toMatch(/DIFFERENT line block/);
    expect(insertionPostconditionProblem(null, b)).toBe(null);   // nothing to compare
  });
});

describe('121.md §4:168 — the session lifecycle, as one testable machine', () => {
  const makeApi = (over = {}) => ({
    saveCaretBookmark: () => ({ logical: { blockIndex: 1 } }),
    clearCaretBookmark: () => {},
    restoreCaretBookmark: () => true,
    ...over,
  });

  const harness = (over = {}) => {
    const store = { current: null };
    const calls = [];
    const api = makeApi(over.api);
    const session = createInsertionSession({
      store,
      caretSectionId: () => 'methods',
      apiFor: (id) => (id === 'methods' ? api : null),
      getApi: () => makeApi({ restoreCaretBookmark: () => { calls.push('fallback-restore'); return true; } }),
      isLocked: over.isLocked || (() => false),
      targetLocked: over.targetLocked || (() => false),
      onBegin: () => calls.push('begin'),
      onRefusal: () => calls.push('refusal'),
      ...over.deps,
    });
    return { session, store, calls, api };
  };

  it('begin bookmarks the CARET\'s section and clears any stale notice', () => {
    const { session, store, calls } = harness();
    session.begin();
    expect(calls).toContain('begin');
    expect(store.current.sectionId).toBe('methods');
    expect(store.current.bm).toBeTruthy();
  });

  it('a section with no caret to save leaves NO session (never a half-armed one)', () => {
    const { session, store } = harness({ api: { saveCaretBookmark: () => null } });
    session.begin();
    expect(store.current).toBe(null);
  });

  it('end clears the bookmark and modifies nothing else (the cancel contract)', () => {
    let cleared = 0;
    const { session, store } = harness({ api: { clearCaretBookmark: () => { cleared += 1; } } });
    session.begin();
    session.end();
    expect(cleared).toBe(1);
    expect(store.current).toBe(null);
    session.end();                    // idempotent — a second cancel is not an error
    expect(cleared).toBe(1);
  });

  it('an insert routes to the BOOKMARKED section and consumes the session', () => {
    const { session, store, calls } = harness();
    session.begin();
    let ran = null;
    session.withBookmarkedCaret((api) => { ran = api; });
    expect(ran).toBeTruthy();
    expect(store.current).toBe(null);        // the bookmark is spent, not reusable
    expect(calls).not.toContain('refusal');
    expect(calls).not.toContain('fallback-restore');
  });

  it('a caret that cannot be re-found REFUSES — nothing is inserted anywhere', () => {
    const { session, calls } = harness({ api: { restoreCaretBookmark: () => false } });
    session.begin();
    let ran = false;
    session.withBookmarkedCaret(() => { ran = true; });
    expect(ran).toBe(false);
    expect(calls).toContain('refusal');
  });

  it('a locked bookmarked section refuses silently, before any restore is attempted', () => {
    let restores = 0;
    const { session, calls } = harness({
      isLocked: () => true,
      api: { restoreCaretBookmark: () => { restores += 1; return true; } },
    });
    session.begin();
    let ran = false;
    session.withBookmarkedCaret(() => { ran = true; });
    expect(ran).toBe(false);
    expect(restores).toBe(0);
    expect(calls).not.toContain('refusal');   // nothing was lost — the section is locked
  });

  it('a caller with NO session keeps the pre-120 behaviour, guarded by targetLocked', () => {
    const { session } = harness();
    let ran = false;
    session.withBookmarkedCaret(() => { ran = true; });
    expect(ran).toBe(true);
    const locked = harness({ targetLocked: () => true });
    let ran2 = false;
    locked.session.withBookmarkedCaret(() => { ran2 = true; });
    expect(ran2).toBe(false);
  });
});

/* ══════════════ (3) the DOM-side normalisations ══════════════ */

describe('121.md §4 — fix 1: the boundary normalisation, wired at all three sites', () => {
  it('exists, is scoped by hadSelection, and never snaps into a table or a figure', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const snapCollapsedEndIntoBlock = (range, origin) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('if (!range.collapsed) return false;');
    // (a) the ROOT-LEVEL rule is unconditional — a caret between two blocks is not a
    // text position, and inserting there makes mdDom write a whole new paragraph
    expect(body).toContain('if (range.startContainer !== el) return false;');
    expect(body).toContain('if (isRealLineBlock(prev)) return moveTo(caretAtEndOfBlock(prev));');
    // (b) the START-OF-BLOCK rule is scoped to a real selection that began EARLIER
    expect(body).toContain('if (!origin || origin.collapsed) return false;');
    expect(body).toContain('if (!atBlockStart(top, range)) return false;');
    expect(body).toContain('if (here <= 0 || began < 0 || began >= here) return false;');
    expect(body).toContain('if (!isRealLineBlock(prev)) return false;');
    // …and a media object is never a snap target
    const real = EDITOR.slice(EDITOR.indexOf('const isRealLineBlock = (top) => {'));
    expect(real.slice(0, real.indexOf('\n  };'))).toContain('if (isMediaBlockNode(top)) return false;');
  });

  it('the previously-DEAD hadSelection flag is what scopes it, at SAVE time', () => {
    /* Recorded since 120, never read. Normalising at save time (not only at insert
       time) is also what keeps the tightened null-logical refusal rare: a root-level
       end becomes a real position in a real block before the bookmark describes it. */
    const fn = EDITOR.slice(EDITOR.indexOf('saveCaretBookmark: () => {'));
    const body = fn.slice(0, fn.indexOf('\n    },'));
    expect(body).toContain('const hadSelection = !r.collapsed;');
    expect(body).toContain('snapCollapsedEndIntoBlock(end, hadSelection ? r : null);');
    expect(body.indexOf('snapCollapsedEndIntoBlock')).toBeLessThan(body.indexOf('logical: caretLogicalOf(end)'));
  });

  it('…and the same normalisation runs on the commit path and on the resolved caret', () => {
    const col = EDITOR.slice(EDITOR.indexOf('const collapseSelectionToEnd = () => {'));
    const colBody = col.slice(0, col.indexOf('\n  };'));
    expect(colBody).toContain('end.collapse(false);');
    expect(colBody).toContain('snapCollapsedEndIntoBlock(end, r);');
    expect(colBody.indexOf('end.collapse(false);')).toBeLessThan(colBody.indexOf('snapCollapsedEndIntoBlock'));
    const apply = EDITOR.slice(EDITOR.indexOf('const applyCaretRange = (r) => {'));
    expect(apply.slice(0, apply.indexOf('\n  };'))).toContain('snapCollapsedEndIntoBlock(r, null);');
  });

  it('the end-of-block caret skips a trailing placeholder <br>', () => {
    // A caret AFTER the placeholder renders on a second visual line — the very shape
    // §4 is about, one block lower.
    const fn = EDITOR.slice(EDITOR.indexOf('const caretAtEndOfBlock = (block) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain("const isBr = n.nodeType === 1 && String(n.tagName || '').toUpperCase() === 'BR';");
    expect(body).toContain('r.setStartAfter(last);');
  });
});

describe('121.md §4 — fixes 2-4: the caret side, the aliasing, and the null logical', () => {
  it('fix 2 — an EMPTY block collapses to its START, before the placeholder <br>', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const rangeAtTextOffset = (top, offset) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain("r.collapse(!(top.textContent || '').length);");
    // a block WITH text keeps the old end-of-block meaning for this branch
    expect(body).toContain('r.selectNodeContents(top);');
  });

  it('fix 3 — the empty-context index hit is held to the scan\'s uniqueness discipline', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const rangeFromLogical = (logical) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('const emptyContext = !logical.before && !logical.after;');
    expect(body).toContain('if (off != null && emptyContext) {');
    expect(body).toContain('if (claims !== 1) return null;');
    // …and every candidate must still have the neighbours the bookmark was taken beside
    expect(body).toContain('const ok = neighborsMatch(');
    expect(body).toContain('return ok ? off : null;');
    // the snapshot side records them for empty blocks only
    const snap = EDITOR.slice(EDITOR.indexOf('const caretLogicalOf = (r) => {'));
    const snapBody = snap.slice(0, snap.indexOf('\n  };'));
    expect(snapBody).toContain('if (!lg.before && !lg.after) {');
    expect(snapBody).toContain('Object.assign(lg, neighborContext(');
  });

  it('fix 4 — a null logical is refused unless the range is in a real line block', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const liveRangeStillValid = (r, logical) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('if (isRealLineBlock(topBlockOf(r && r.endContainer))) return true;');
    expect(body).not.toContain('return true;            // nothing to verify against');
    /* r1 — SCOPED to what fix 4 always meant: "between BLOCKS", not "container is the
       root". Typing the first run into an empty section leaves bare text nodes, chips
       and <br>s as DIRECT children of the editing host, so the caret after a
       Shift+Enter has a root container and is nevertheless an ordinary position inside
       the one implicit line — refusing it turned "cite, Shift+Enter, cite again" into a
       CARET_LOST notice (manuscript-citation-caret-120.spec.ts §5 r2). */
    expect(body).toContain('return !!r && rootInlineCaret(r.endContainer, r.endOffset);');
    const scope = EDITOR.slice(EDITOR.indexOf('const rootInlineCaret = (container, offset) => {'));
    const scopeBody = scope.slice(0, scope.indexOf('\n  };'));
    // a host with no blocks at all has nothing to be BETWEEN…
    expect(scopeBody).toContain('if (!blocks.length) return true;');
    // …and otherwise the answer is whether either side of the offset is INLINE.
    expect(scopeBody).toContain('return inline(prev) || inline(next);');
    expect(scopeBody).toContain('if (isMediaBlockNode(n)) return false;');
    /* 121.md r2 — re-pinned: the tag test is unchanged in intent, but a CONTAINER of
       lines is refused before it. A UL/OL is a block to mdDom's walkBlocks and was
       inline to this classifier, which is what accepted the root-level caret Ctrl+A
       leaves after a trailing list — and put the chip after the `</ul>` as its own
       paragraph. See the F5 behaviour pins below. */
    expect(scopeBody).toContain('if (BLOCK_CONTAINER_TAGS.has(tag)) return false;');
    expect(scopeBody).toContain('return !LINE_BLOCK_TAGS.has(tag);');
    /* …and the LIVE range is deliberately not neighbour-checked: it is the node the
       bookmark was taken in, not a re-resolution, so demanding unchanged neighbours
       would refuse a good caret because the paragraph above it was edited. The
       neighbour discipline lives in rangeFromLogical, where positions are re-FOUND. */
    expect(body).toContain('return now.before === logical.before && now.after === logical.after;');
    expect(body).not.toContain('neighborsMatch(');
  });

  it('fix 4 — focusWithSelection will not install a saved range pointed at the ROOT', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const focusWithSelection = () => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('const rootedSaved = !!saved && saved.commonAncestorContainer === el;');
    expect(body).toContain('(!rootedSaved || snapCollapsedEndIntoBlock(saved, null))');
    expect(body).toContain('else if (usable()) {');
  });
});

describe('121.md §4 — one transaction, one undo step, one emit', () => {
  it('the commit runs exactly ONE insertion call, chosen by the payload plan', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const commitInsertion = (payload) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('const plan = insertionPlan(payload);');
    /* r1 — still ONE call per plan; the option is what turns on the end-of-block pad,
       which an INLINE insertion needs and a block insertion must never get. */
    expect(body).toContain("if (plan.via === 'html') insertHtml(plan.html, { inlineAtCaret: true });");
    expect(body).toContain('else insertPlainText(plan.text);');
    expect((body.match(/insertHtml\(/g) || [])).toHaveLength(1);
    expect((body.match(/insertPlainText\(/g) || [])).toHaveLength(1);
    // the postcondition is DEV-only: two Range reads and a console warning, never a
    // cost in a researcher's session
    expect(body).toContain('const before = DEV_INSERT_CHECKS ? caretLine() : null;');
    expect(EDITOR).toContain('const DEV_INSERT_CHECKS = (() => {');
  });

  /* ── r1 — the two normalisations the DOM half of §4 turned out to need ────────── */

  it('r1 — the end-of-block pad is an NBSP, is KEPT, and never touches a media island', () => {
    /* Blink puts an ELEMENT inserted at the end of a block AFTER the block; one nbsp
       appended to the block makes the caret no longer the last position in it. It must
       be an nbsp (a plain space is collapsed and the engine still calls it end-of-block)
       and it must stay (removing it corrupts the engine's un-apply of the very command
       that inserted the chip, which breaks §4's single undoable transaction). It is not
       content: mdDom folds nbsp to a space and TRIMS every block. */
    const fn = EDITOR.slice(EDITOR.indexOf('const endOfBlockPad = () => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    /* 121.md r2 — re-pinned: still ONE nbsp, still appended, still never removed HERE
       (the un-apply of the very command that inserted the chip depends on it staying).
       The node is now NAMED so `emit` can drop it once it stops being trailing — which
       is a different moment, a different transaction, and the only way an interior pad
       can be kept out of the model. */
    expect(body).toContain("const pad = document.createTextNode(' ');");
    expect(body).toContain('block.appendChild(pad);');
    expect(body).not.toContain('removeChild');
    // …and never a SECOND pad: an existing one already holds the end of the block.
    expect(body).toContain('if (trailingPadNode(block)) return false;');
    // never inside a caption/figure island, and never when something already holds the end
    expect(body).toContain('if (isMediaBlockNode(block)) return false;');
    expect(body).toContain('if (gap.toString().length) return false;');
    expect(body).toContain('if (gapHasElement(gap)) return false;');
    // …and a section whose prose is not wrapped in a block has nothing to be pushed out of
    expect(body).toContain('if (!block || block === el || block.nodeType !== 1) return false;');
  });

  it('r1 — a selection that ENDS in a media island lands on the last real line it covered', () => {
    /* WebKit's paragraph-granularity selection reaches past the paragraph into the
       caption island that follows it; collapsing to that end put the cross-reference
       inside the table's TITLE, where the serializer keeps only the marker. */
    const fn = EDITOR.slice(EDITOR.indexOf('const snapCollapsedEndIntoBlock = (range, origin) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('if (!isRealLineBlock(top)) {');
    expect(body).toContain("if (lbTag === 'TD' || lbTag === 'TH') return false;");
    expect(body).toContain('if (isRealLineBlock(blocks[i])) return moveTo(caretAtEndOfBlock(blocks[i]));');
    // a COLLAPSED caret is never touched by it — §1's symbol in a caption title
    expect(body).toContain('if (!origin || origin.collapsed) return false;');
  });

  it('all three insert paths share the ONE caret discipline', () => {
    for (const m of ['insertCitation: (refId) => {', 'insertAssetRef: (assetId) => {']) {
      const f = EDITOR.slice(EDITOR.indexOf(m));
      expect(f.slice(0, f.indexOf('\n    },')), m).toContain('if (!prepareCaret()) return;');
    }
    expect(EDITOR).toContain('const insertAtCaret = (payload) => (prepareCaret() ? commitInsertion(payload) : false);');
    const sym = EDITOR.slice(EDITOR.indexOf('insertSymbol: (ch) => {'));
    expect(sym.slice(0, sym.indexOf('\n    },'))).toContain("insertAtCaret({ kind: 'text', text: s });");
  });
});

/* ══════════════ 121.md r2 — the round-2 repairs ══════════════
 *
 * Five of them are DOM-side and pinned from source for the reason the header states
 * (no jsdom in this repo). The end-of-block PAD is the exception: its rules were made
 * pure node predicates on purpose, so the defect the r1 pad created — a nbsp that
 * stops being trailing and folds into a PERMANENT double space in the markdown — is
 * reproduced and closed here against the real serializer, not described in a comment.
 */

/* A DOM shaped exactly as much as the pad helpers read: nodeType, nodeValue,
   childNodes/parentNode, tagName, removeChild, contains, cloneNode, innerHTML.
   Serializable to HTML so the REAL mdDom sees the same tree the browser would. */
function txt(v) {
  const t = { nodeType: 3, nodeValue: v, parentNode: null, cloneNode: () => txt(t.nodeValue) };
  return t;
}
function el(tag, kids = []) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: [],
    parentNode: null,
    removeChild(c) {
      const i = node.childNodes.indexOf(c);
      if (i >= 0) node.childNodes.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    contains(n) {
      let up = n;
      while (up) { if (up === node) return true; up = up.parentNode; }
      return false;
    },
    cloneNode(deep) {
      return el(tag, deep ? node.childNodes.map((k) => k.cloneNode(true)) : []);
    },
    get innerHTML() { return node.childNodes.map(html).join(''); },
  };
  for (const k of kids) { k.parentNode = node; node.childNodes.push(k); }
  return node;
}
function html(n) {
  if (n.nodeType === 3) return n.nodeValue;
  if (n.tagName === 'BR') return '<br>';
  const inner = n.childNodes.map(html).join('');
  if (n.tagName === 'SPAN') {
    return `<span class="ms-cite-chip" data-cite="s1" contenteditable="false">${inner}</span>`;
  }
  const t = n.tagName.toLowerCase();
  return `<${t}>${inner}</${t}>`;
}
const CHIP = () => el('span', [txt('[1]')]);
const NBSP = ' ';
const SENTENCE = 'Two trials reported the outcome ';

describe('121.md r2 — the end-of-block pad is transparent, and never reaches the model', () => {
  it('the DEFECT: a pad that stopped being trailing is a permanent double space', () => {
    /* r1 claimed the pad "cannot reach the model — the serializer folds nbsp to a
       space and TRIMS every block". True only while it is the last thing in the block.
       A caret at the true end of the line sits AFTER the pad (End, Ctrl+End, a click
       past the last glyph), so the next thing written — a typed word, a second chip —
       lands behind it and the pad becomes interior content. mdDom trims block EDGES
       only, so the separator nbsp plus the pad nbsp serialize to two spaces, and that
       markdown round-trips byte-stably: the double space is permanent, in the autosave
       and in the .docx. */
    const p = el('p', [
      txt(SENTENCE), CHIP(), txt(NBSP), txt(NBSP), txt('and a cohort agreed.'),
    ]);
    const md = htmlToMd(html(p));
    expect(md).toBe('Two trials reported the outcome [[cite:s1]]  and a cohort agreed.');
    expect(htmlToMd(mdToHtml(md))).toBe(md);         // …and it never heals itself
  });

  it('…closed: a pad that no longer ends its block is stripped before serialization', () => {
    const pad = txt(NBSP);
    const p = el('p', [
      txt(SENTENCE), CHIP(), txt(NBSP), pad, txt('and a cohort agreed.'),
    ]);
    const root = el('div', [p]);
    expect(padIsTrailing(pad)).toBe(false);
    const stripped = padStrippedHtml(root, [pad]);
    expect(htmlToMd(stripped))
      .toBe('Two trials reported the outcome [[cite:s1]] and a cohort agreed.');
    // …and the LIVE dom is untouched: the caret, the selection and the native undo
    // stack all live there, and none of them may move because a section was saved.
    expect(p.childNodes).toHaveLength(5);
    expect(pad.nodeValue).toBe(NBSP);
  });

  it('…including the pad the ENGINE typed into, which is the everyday shape', () => {
    /* Both engines write a character typed at the end of the line INTO the pad's own
       text node rather than beside it, so the node the caret is sitting in becomes
       "<nbsp>and a cohort agreed.". Its head is still this editor's markup. */
    const pad = txt(`${NBSP}and a cohort agreed.`);
    const p = el('p', [txt(SENTENCE), CHIP(), txt(NBSP), pad]);
    const root = el('div', [p]);
    expect(htmlToMd(padStrippedHtml(root, [pad])))
      .toBe('Two trials reported the outcome [[cite:s1]] and a cohort agreed.');
    expect(pad.nodeValue).toBe(`${NBSP}and a cohort agreed.`);   // live node untouched
  });

  it('a pad still at the END of its block is left exactly where it is', () => {
    /* r1's third measured property, deliberately not weakened: undo of the insertion
       that created the pad must revert to the paragraph plus this one nbsp. It costs
       the model nothing, because there the serializer really does trim it — so there
       is nothing to strip and the live innerHTML is serialized unchanged. */
    const pad = txt(NBSP);
    const p = el('p', [txt(SENTENCE), CHIP(), txt(NBSP), pad]);
    const root = el('div', [p]);
    expect(padIsTrailing(pad)).toBe(true);
    expect(padStrippedHtml(root, [pad])).toBe(null);   // nothing to strip
    expect(p.childNodes).toHaveLength(4);              // still there, for the un-apply
    expect(htmlToMd(html(p))).toBe('Two trials reported the outcome [[cite:s1]]');
  });

  it('…and the WEBKIT shape, where node identity cannot be followed at all', () => {
    /* Measured under `webkit-manuscript`: its insertHTML rebuilds the block's text
       nodes, so the separator, the pad and the prose typed after them come out as ONE
       node and the tracked node is detached. Two adjacent nbsp immediately after an
       ELEMENT is a shape only this editor produces — one separator from the chip
       inserter, one pad from the block — so it is recognised structurally. */
    const detached = txt(NBSP);
    const p = el('p', [txt(SENTENCE), CHIP(), txt(`${NBSP}${NBSP}and a cohort agreed.`)]);
    const root = el('div', [p]);
    expect(livePads(root, [detached])).toEqual([]);      // identity is no help here
    expect(htmlToMd(padStrippedHtml(root, [])))          // …and none is needed
      .toBe('Two trials reported the outcome [[cite:s1]] and a cohort agreed.');
    expect(htmlToMd(padStrippedHtml(root, [detached])))
      .toBe('Two trials reported the outcome [[cite:s1]] and a cohort agreed.');
    // …in either engine's spelling of the pair (WebKit normalises one to a space)…
    const mixed = el('div', [el('p', [txt(SENTENCE), CHIP(), txt(`${NBSP} and a cohort agreed.`)])]);
    expect(htmlToMd(padStrippedHtml(mixed, [])))
      .toBe('Two trials reported the outcome [[cite:s1]] and a cohort agreed.');
    // …and a double space that came from the MARKDOWN is content, and is left alone.
    const typed = el('div', [el('p', [txt(SENTENCE), CHIP(), txt('  and a cohort agreed.')])]);
    expect(padStrippedHtml(typed, [])).toBe(null);
  });

  it('a section this editor never padded serializes through the untouched fast path', () => {
    const p = el('p', [txt('Nothing was inserted here.')]);
    expect(padStrippedHtml(el('div', [p]), [])).toBe(null);
    expect(padStrippedHtml(el('div', [p]), null)).toBe(null);
  });

  it('a placeholder <br> after the pad does not make it content', () => {
    const pad = txt(NBSP);
    const p = el('p', [txt('Methods '), pad, el('br')]);
    expect(padIsTrailing(pad)).toBe(true);
    expect(trailingPadNode(p)).toBe(pad);
  });

  it('trailingPadNode finds the pad run — and never mistakes real prose for one', () => {
    const pad = txt(NBSP);
    expect(trailingPadNode(el('p', [txt('outcome'), pad]))).toBe(pad);
    // Blink writes a typed trailing space INTO the prose node; that is content.
    expect(trailingPadNode(el('p', [txt(`outcome${NBSP}`)]))).toBe(null);
    expect(trailingPadNode(el('p', [txt('outcome')]))).toBe(null);
    expect(trailingPadNode(el('p', [txt(NBSP), txt('outcome')]))).toBe(null);
    /* an already-accumulated run (a section written by the r1 build) reports its FIRST
       node, so the caret snap moves in front of the whole run and the reuse rule sees
       it. */
    const a = txt(NBSP); const b = txt(NBSP);
    expect(trailingPadNode(el('p', [txt('outcome'), a, b]))).toBe(a);
  });

  it('a pad an undo or a remount took away is simply forgotten', () => {
    const pad = txt(NBSP);
    const orphan = el('p', [pad]).removeChild(pad);
    expect(livePads(el('div', []), [orphan])).toEqual([]);
    expect(livePads(null, [pad])).toEqual([]);
    // …and so is a node the engine merged something in FRONT of: not ours any more.
    const merged = txt(`typed${NBSP}`);
    const root = el('div', [el('p', [merged])]);
    expect(livePads(root, [merged])).toEqual([]);
  });
});

describe('121.md r2 — the DOM-side repairs, pinned from source', () => {
  it('F3 — the pad is skipped by the caret, so it cannot accumulate or block grouping', () => {
    /* A caret AFTER the pad measured an empty gap and padded again (one more nbsp per
       insert), and measured a TWO-nbsp gap to the previous chip — `joinableGap` allows
       one — so 120.md §5's citation grouping was refused and "[1] [2]" was produced
       where "[1,2]" belonged. The pad is markup, not a character of the document: the
       caret goes in front of it, which is the same visual position and makes the pad
       probe, the grouping gap and the insertion agree again. */
    const fn = EDITOR.slice(EDITOR.indexOf('const snapCaretBeforeTrailingPad = () => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('const pad = trailingPadNode(block);');
    expect(body).toContain('before.setStartBefore(pad);');
    // …and a caret EARLIER in the line is left exactly where the researcher put it.
    expect(body).toContain('if (before.compareBoundaryPoints(Range.START_TO_START, r) > 0) return;');
    // it is part of the ONE shared caret discipline, not a fourth insertion path
    const prep = EDITOR.slice(EDITOR.indexOf('const prepareCaret = () => {'));
    expect(prep.slice(0, prep.indexOf('\n  };'))).toContain('snapCaretBeforeTrailingPad();');
    // …and emit is where a stale pad is dropped, beside the other two normalisations
    expect(EDITOR).toContain('const padded = padStrippedHtml(el, padNodesRef.current);');
    expect(EDITOR).toContain('htmlToMd(padded == null ? el.innerHTML : padded, {');
    /* …and TYPING is held to the same rule, through a NATIVE beforeinput listener:
       React 18 synthesizes onBeforeInput from `textInput` in Blink, which carries no
       inputType, so the discrimination this needs would be impossible there. An IME
       composition is deliberately excluded — its caret must not be moved. */
    expect(EDITOR).toContain("el.addEventListener('beforeinput', onBeforeInput);");
    expect(EDITOR).toContain(
      "if (t !== 'insertText' && t !== 'insertFromPaste' && t !== 'insertReplacementText') return;",
    );
    /* WebKit ignores a caret moved in `beforeinput` (it computes the insertion point
       from the selection captured before that event is dispatched), and moving the
       caret in `keydown` instead SWALLOWED the keystroke there — both measured under
       `webkit-manuscript`. So the DOM half is Blink-only by nature, and the model is
       protected in the one place every engine passes through: serialization. */
    expect(EDITOR).toContain('const padded = padStrippedHtml(el, padNodesRef.current);');
  });

  it('F4 — an empty formatting shell in the gap is not content', () => {
    /* `cloneContents` PARTIALLY contains the element a boundary point sits inside and
       clones it as a shell holding one zero-length text node, so `childNodes.length`
       said "content" for a caret at the end of a trailing <b>/<i>/<a> — the pad was
       refused at exactly the position 121.md's matrix names ("Immediately before and
       after links and formatted text") and Blink ejected the chip onto its own line.
       Void content (a <br>, a picture) is still content, which is 120.md r2's rule. */
    const fn = EDITOR.slice(EDITOR.indexOf('const gapHasElement = (range) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain("if (VOID_CONTENT_TAGS.has(String(el.tagName || '').toUpperCase())) return true;");
    expect(body).toContain("if ((el.textContent || '').length) return true;");
    expect(body).not.toContain('if (el.childNodes && el.childNodes.length) return true;');
  });

  it('F5 — a LIST is a block, and its last item is the line a caret snaps into', () => {
    /* A section ending in a bulleted list defeated both halves at once: the snap
       refused (a UL is not a real line block) and rootInlineCaret then read the same UL
       as INLINE and accepted the root-level caret, so the chip was written after the
       </ul> and mdDom serialized it as its own paragraph — the one §4 variant that
       survives a reload. mdDom's walkBlocks has always treated ul/ol as blocks. */
    const fn = EDITOR.slice(EDITOR.indexOf('const snapCollapsedEndIntoBlock = (range, origin) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('const lastLi = lastListLine(prev);');
    expect(body).toContain('if (lastLi) return moveTo(caretAtEndOfBlock(lastLi));');
    expect(body).toContain('const firstLi = firstListLine(next);');
    expect(EDITOR).toContain("const BLOCK_CONTAINER_TAGS = new Set(['UL', 'OL', 'DL', 'TABLE', 'FIGURE', 'HR']);");
  });

  it('F6 — a caret at an atomic chip’s LEADING edge escapes BEFORE it', () => {
    /* The unconditional setStartAfter put the symbol on the wrong side of the I-beam
       for a paragraph that BEGINS with a manual-input placeholder — the everyday shape
       the r1 comment itself names. Mid-chip and end-of-chip carets still escape after
       it, so nothing about the r1 "a caret inside an atomic is not a caret" rule
       (which exists because the serializer would drop a chip written inside one) is
       weakened. */
    const fn = EDITOR.slice(EDITOR.indexOf('const snapCaretOutOfAtomic = () => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('leading = probe.toString().length === 0;');
    expect(body).toContain('if (leading) out.setStartBefore(atomic);');
    expect(body).toContain('else out.setStartAfter(atomic);');
  });
});

/* ══════════════ 121.md r2 — the Testing-Requirements rows that had no test ══════════
 *
 * The matrix names "In headings", "Before and after punctuation" and "Immediately
 * before and after links and formatted text". The pure offset+context logic is what
 * the first two rest on and it is character-agnostic — pinned here; the block-shape
 * halves (an H2's end-of-block pad, a chip beside a bold run or a link) cross
 * execCommand and live in e2e/manuscript/manuscript-insert-caret-121.spec.ts.
 */
describe('121.md r2 — insertion beside punctuation is an ordinary position', () => {
  const S = 'Mortality fell (p = 0.03), and the effect persisted.';

  it('a caret immediately before or after a full stop resolves exactly', () => {
    const beforeStop = logicalContext(S, S.length - 1);
    expect(resolveContext(S, beforeStop)).toBe(S.length - 1);
    const afterStop = logicalContext(S, S.length);
    expect(resolveContext(S, afterStop)).toBe(S.length);
    expect(beforeStop.charOffset).not.toBe(afterStop.charOffset);
  });

  it('…and so is one inside a parenthesis, a comma or a semicolon run', () => {
    for (const ch of [')', ',', ';', ':', '”']) {
      const t = `Effect was small${ch} and non-significant.`;
      const at = t.indexOf(ch);
      expect(resolveContext(t, logicalContext(t, at))).toBe(at);
      expect(resolveContext(t, logicalContext(t, at + 1))).toBe(at + 1);
    }
  });

  it('punctuation does not make two positions look alike', () => {
    // The window is characters, not words, so "(p" and ")," are as distinguishable as
    // any other pair — the row is covered by the same rule everything else uses.
    const a = logicalContext(S, S.indexOf('(') + 1);
    const b = logicalContext(S, S.indexOf(')'));
    expect(resolveContext(S, a)).not.toBe(resolveContext(S, b));
  });
});
