/**
 * opsGovernanceWiring.test.jsx — 109.md §§5, 7, 16, 29, 32, 36 (W2-B).
 *
 * The gates themselves cannot be exercised without a DOM (the house style has no
 * jsdom), so this file pins the WIRING at the source level — the same technique
 * `keywordUndoWiring` and `screeningNavRaces` use for the 107/108 invariants — plus
 * SSR-shape assertions for the two surfaces whose default rendering must not move.
 *
 * The invariant each pin protects is stated with it. A refactor that keeps the
 * behaviour must update the pin; one that drops the gate cannot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// 116.md validation — read source through the LF-normalising helper so these
// wiring pins compare content, not the checkout's line-ending policy.
import { readSource } from '../helpers/readSource.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryControlsView } from '../../src/frontend/stitch/shell/StitchHistoryControls.jsx';
import {
  createRegistry, registerBinding, routeKeydown, shortcutInventory, TIER,
} from '../../src/research-engine/interaction/shortcutRouter.js';

const src = (p) => readSource(new URL(`../../${p}`, import.meta.url));
const SCREENING = src('src/frontend/screening/tabs/ScreeningTab.jsx');
const PROVIDER = src('src/frontend/history/ProjectInteractionProvider.jsx');
const HISTORY = src('src/frontend/history/HistoryContext.jsx');
const CONTROLS = src('src/frontend/stitch/shell/StitchHistoryControls.jsx');
const ANALYSIS = src('src/frontend/workspace/tabs/analysisTabs.jsx');

/* ═══════════ 1. the shortcut flag is a TERM in the guard chain ═══════════ */

describe('109.md §5/§17 — abstractKeywordShortcuts never bypasses the guard chain', () => {
  it('the flag joins canHandle; it does not gate `enabled` or short-circuit before it', () => {
    // 108 invariant 3: preventDefault only after the FULL guard chain passes. A flag
    // that disabled the listener wholesale would be fine too, but a flag that
    // preventDefaulted first and checked later would not — pin the safe shape.
    expect(SCREENING).toMatch(
      /canHandle:\s*\(\)\s*=>\s*kwCtxRef\.current\.canEditKeywords\s*&&\s*kwCtxRef\.current\.shortcutsEnabled/,
    );
    expect(SCREENING).toMatch(/shortcutsEnabled:\s*govFlags\.abstractKeywordShortcuts\s*!==\s*false/);
    // The hook stays enabled — the decision belongs to canHandle, one place only.
    expect(SCREENING).toMatch(/useAbstractSelectionShortcuts\(\{\s*\n\s*enabled:\s*true,/);
  });

  it('the context-menu flag is checked BEFORE preventDefault, and withholds the handler', () => {
    const flagAt = SCREENING.indexOf('if (!kwCtxRef.current.contextMenuEnabled) return;');
    const preventAt = SCREENING.indexOf('e.preventDefault();\n    const el = e.currentTarget;');
    expect(flagAt).toBeGreaterThan(-1);
    expect(preventAt).toBeGreaterThan(flagAt);
    expect(SCREENING).toContain('onKeywordMenu={contextMenuOn ? openKeywordMenu : undefined}');
  });

  it('every gate reads DEFAULT-ON (`!== false`), never a bare truthiness check', () => {
    for (const line of [
      'const suggestionsOn = govFlags.keywordSuggestions !== false;',
      'const contextMenuOn = govFlags.keywordContextMenu !== false;',
      'const keyboardNavOn = gov.keyboardNavigationEnabled !== false;',
      'const autoLoadMoreOn = gov.autoLoadMoreEnabled !== false;',
      'const blockNavWhileLoading = gov.blockNavigationWhileLoading !== false;',
    ]) expect(SCREENING).toContain(line);
  });
});

/* ═══════════ 2. suggestions gate hides proposals, never active keywords ═════ */

describe('109.md §5 — keywordSuggestions hides the PROPOSAL surface only', () => {
  it('only the pending/conflict lists are gated; the active terms are untouched', () => {
    expect(SCREENING).toMatch(
      /const suggested = useMemo\(\(\) => \(suggestionsOn\s*\n\s*\?\s*\{ include: kw\.include\.pending, exclude: kw\.exclude\.pending, conflicts: kw\.conflicts \}\s*\n\s*: NO_SUGGESTIONS\)/,
    );
    // The four ACTIVE-keyword reads never mention the flag.
    expect(SCREENING).toContain('const inclusion = kw.include.terms;');
    expect(SCREENING).toContain('const exclusion = kw.exclude.terms;');
  });

  it('the empty set is a shared frozen object (byte stability)', () => {
    expect(SCREENING).toMatch(/const NO_SUGGESTIONS = Object\.freeze\(/);
  });

  it('the suggestion-count refresh trigger reads the GATED lists', () => {
    expect(SCREENING).toContain("suggested.include.join('|'), suggested.exclude.join('|')");
  });
});

/* ═══════════ 3. projectUndoRedo — no recording, no chords, no buttons ══════ */

describe('109.md §5 — projectUndoRedo OFF is pre-108 behaviour', () => {
  it('record() and coalesce() become no-ops, and nothing already stored is dropped', () => {
    expect(HISTORY).toContain('if (live.current.enabled === false) return null;');
    // Availability is gated, the STACKS are not cleared.
    expect(HISTORY).toMatch(/canUndo: enabled \? rawAvail\.canUndo : false/);
    expect(HISTORY).not.toMatch(/enabled === false[\s\S]{0,80}clearAllPure/);
  });

  it('run() refuses so a note button or a stale click cannot slip past the chords', () => {
    expect(HISTORY).toMatch(/if \(live\.current\.enabled === false\s*\n\s*\|\| \(direction === 'redo' && live\.current\.redoEnabled === false\)\)/);
  });

  it('the chords decline through `when`, so Ctrl+Z is released to the browser', () => {
    // canUndo/canRedo are false when the provider is disabled, and the bindings'
    // `when` already reads them — no preventDefault ⇒ 108.md §26's no-op rule.
    expect(PROVIDER).toContain('when: (ctx) => historyShortcutAllowed(ctx) && hist.canUndo');
    expect(PROVIDER).toContain('enabled={undoRedoOn}');
    expect(PROVIDER).toContain("const undoRedoOn = flags.projectUndoRedo !== false;");
  });

  it('the header pair is removed entirely rather than left permanently greyed', () => {
    expect(CONTROLS).toContain('if (!undoRedoOn) return null;');
  });
});

/* ═══════════ 4. the interaction knobs ═══════════ */

describe('109.md §16 — the interaction knobs reach their consumers', () => {
  it('historyCap is applied to the pure stack module, once, from the provider', () => {
    expect(PROVIDER).toContain('useEffect(() => { setHistoryCap(cap); }, [cap]);');
  });
  it('the Ctrl+Y alias is passed to the redo binding rather than hardcoded', () => {
    expect(PROVIDER).toContain('match: (e) => isRedoChord(e, { ctrlYAlias: live.current.ctrlYRedoAlias })');
    expect(PROVIDER).toContain('ctrlYRedoAlias={gov.ctrlYRedoAlias === true}');
  });
  it('undoToastMs reaches the snackbar through the feedback provider', () => {
    expect(PROVIDER).toContain('dismissMs={toastMs}');
  });
  it('undoToastEnabled silences CONFIRMATIONS only — refusals stay visible', () => {
    expect(HISTORY).toMatch(
      /if \(live\.current\.toastEnabled === false && \(!note\.tone \|\| note\.tone === 'info'\)\) return;/,
    );
  });
  it('redoEnabled removes the Redo button but never the Undo one', () => {
    expect(CONTROLS).toContain('showRedo={gov.redoEnabled !== false}');
    expect(CONTROLS).toMatch(/\{showRedo && \(\s*\n\s*<StitchTooltip label=\{redoLabel\}/);
  });
});

/* ═══════════ 5. history replays are labelled for the audit ledger ═════════ */

describe('109.md §14 — undo/redo replays carry `via`', () => {
  it("the keyword executor stamps 'undo'/'redo' from the provider's direction", () => {
    expect(SCREENING).toContain("const via = direction === 'redo' ? 'redo' : 'undo';");
    expect(SCREENING).toContain('const r = await runKeywordOp({ ...body, via });');
  });
  it('FORWARD ops send no `via` at all (the server defaults them to user)', () => {
    // runKeywordOpTracked posts the bare op; only the executor adds the field.
    expect(SCREENING).toContain('const r = await runKeywordOp(op);');
    expect(SCREENING.match(/\.\.\.body, via/g)).toHaveLength(1);
  });
});

/* ═══════════ 6. analysis override policy ═══════════ */

describe('109.md §32 — the compatibility OVERRIDE is governable; the GUARD is not', () => {
  it('the form is withheld and replaced with an explanation, never silently missing', () => {
    expect(ANALYSIS).toContain('{onRecordOverride&&overrideAllowed&&(');
    expect(ANALYSIS).toContain('data-testid="proportion-override-disabled"');
  });
  it('an already-recorded override is still honoured and still clearable', () => {
    // The honoured/stale banners are outside the overrideAllowed branch.
    const bannerAt = ANALYSIS.indexOf('⚠ Compatibility warning overridden');
    const gateAt = ANALYSIS.indexOf('{onRecordOverride&&overrideAllowed&&(');
    expect(bannerAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeLessThan(gateAt);
  });
  it('the guard itself has no gate anywhere in the panel', () => {
    expect(ANALYSIS).not.toMatch(/compatibilityGuard/);
  });
  it('a required rationale blocks the button instead of recording an empty one', () => {
    expect(ANALYSIS).toContain('const rationaleMissing=rationaleRequired&&!note.trim();');
    expect(ANALYSIS).toContain('onClick={()=>{if(rationaleMissing) return;onRecordOverride(note);setNote("");}}');
  });
});

/* ═══════════ 7. SSR shape is unchanged at defaults ═══════════ */

describe('109.md — the default render is byte-identical to v4.13.0', () => {
  it('HistoryControlsView still renders BOTH buttons when showRedo is omitted', () => {
    const html = renderToStaticMarkup(
      <HistoryControlsView canUndo canRedo undoBlocked={false} redoBlocked={false} />,
    );
    expect(html).toContain('data-testid="stitch-history-undo"');
    expect(html).toContain('data-testid="stitch-history-redo"');
  });

  it('showRedo=false drops only the Redo button', () => {
    const html = renderToStaticMarkup(
      <HistoryControlsView canUndo canRedo showRedo={false} undoBlocked={false} redoBlocked={false} />,
    );
    expect(html).toContain('data-testid="stitch-history-undo"');
    expect(html).not.toContain('data-testid="stitch-history-redo"');
  });
});

/* ═══════════ 8. the shortcut inventory (109.md §15, decision 10) ═══════════ */

describe('109.md §15 — the Ops shortcut inventory is DERIVED, not maintained', () => {
  it('registerBinding carries the descriptor and routing ignores it', () => {
    const reg = createRegistry();
    registerBinding(reg, {
      id: 'x', tier: TIER.GLOBAL, match: (e) => e.key === 'x', run: () => true,
      chord: 'X', label: 'Do X', scopeLabel: 'Everywhere',
    });
    // A binding with NO descriptor still registers and still routes.
    registerBinding(reg, { id: 'y', tier: TIER.ENGINE, match: (e) => e.key === 'y', run: () => true });
    const inv = shortcutInventory(reg);
    expect(inv.map((b) => b.id)).toEqual(['y', 'x']);        // lower tier first
    expect(inv[1]).toMatchObject({ chord: 'X', label: 'Do X', scopeLabel: 'Everywhere', tierName: 'global' });
    expect(inv[0]).toMatchObject({ chord: '', label: '', scopeLabel: '' });
    // Plain data only — an Ops payload must never carry a function.
    for (const row of inv) for (const v of Object.values(row)) expect(typeof v).not.toBe('function');
    expect(routeKeydown(reg, { key: 'x' }, {}).binding.id).toBe('x');
  });

  it('a non-string descriptor is dropped rather than echoed into Ops', () => {
    const reg = createRegistry();
    registerBinding(reg, { id: 'z', tier: TIER.GLOBAL, match: () => false, chord: { evil: true } });
    expect(shortcutInventory(reg)[0].chord).toBe('');
  });

  it('every routed binding declares one, so the inventory has no blank rows', () => {
    for (const [file, ids] of [
      ['src/frontend/history/ProjectInteractionProvider.jsx', ["id: 'history.undo'", "id: 'history.redo'"]],
      ['src/features/manuscript/manuscriptPanels.jsx', ["id: 'manuscript.stepPlaceholder'"]],
      ['src/features/searchBuilder/SearchBuilderTab.jsx', ["id:'searchBuilder.undo'"]],
    ]) {
      const text = src(file);
      for (const id of ids) {
        const at = text.indexOf(id);
        expect(at, `${file} ${id}`).toBeGreaterThan(-1);
        // the descriptor sits inside the next ~500 chars of the same declaration
        expect(text.slice(at, at + 500)).toMatch(/chord\s*:\s*'/);
        expect(text.slice(at, at + 500)).toMatch(/scopeLabel\s*:\s*'/);
      }
    }
  });

  it('the provider publishes it as a callable, not a snapshot', () => {
    expect(src('src/frontend/shortcuts/ShortcutProvider.jsx'))
      .toContain('const inventory = useCallback(() => shortcutInventory(regRef.current), []);');
    expect(src('src/frontend/shortcuts/ShortcutProvider.jsx')).toContain('inventory: () => [],');
  });
});
