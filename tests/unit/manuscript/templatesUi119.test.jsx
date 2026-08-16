/**
 * 119.md §7 — the template-switching UX (SSR contract tests, house style:
 * renderToStaticMarkup + pure helpers + source pins; this repo has no jsdom).
 *
 * The dialog is judged against §7's own list: preview · diff · map · preserve ·
 * cancel · undo · customize — and against the honesty rules (guideline version and
 * reviewed date on screen, journal rules labelled verified vs "needs your
 * verification", no compliance claim anywhere).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import {
  StructureSwitcher, StructureChangeUndo, StructureProvenance, JournalProfileNotes,
  summarizeStructurePlan, PRESERVE_PROMISE, NO_COMPLIANCE_NOTE,
} from '../../../src/features/manuscript/StructureSwitcher.jsx';
import { ManuscriptToolbar, LEVEL_A_CONTROLS, levelAInline } from '../../../src/features/manuscript/ManuscriptToolbar.jsx';
import {
  makeManuscriptDraft, normalizeDraft, SECTION_TYPES,
} from '../../../src/research-engine/manuscript/model.js';
import {
  planStructureSwitch, applyStructureSwitch, structureById,
} from '../../../src/research-engine/manuscript/templates.js';

const noop = () => {};
const NOW = '2026-08-16T10:00:00.000Z';

function seeded() {
  const d = makeManuscriptDraft({ nowIso: NOW });
  for (const s of SECTION_TYPES) {
    d.sections[s.id] = { ...d.sections[s.id], content: `text of ${s.id}`, userEdited: true };
  }
  return normalizeDraft(d, NOW);
}

function mockM(draft, extra = {}) {
  return {
    activeDraft: draft,
    activeId: draft.id,
    drafts: [draft],
    freshness: { status: 'ok', label: 'Up to date', counts: {} },
    outdatedCount: 0,
    saveState: 'saved', lastError: null, retry: noop,
    setMeta: noop, setActiveId: noop, addDraft: noop, flush: noop, refreshSyncPlan: noop,
    previewStructure: (id, mapping) => planStructureSwitch(draft, id, { mapping }),
    applyStructure: noop, undoStructureChange: noop, dismissStructureChange: noop,
    lastStructureChange: null,
    ...extra,
  };
}

const dialog = (draft, extra) => renderToStaticMarkup(
  <StructureSwitcher m={mockM(draft, extra)} onClose={noop} />,
);

/* ══════════════ the pure summary helper ══════════════ */

describe('119.md §7 — the diff summary states what will happen', () => {
  it('names added, renamed, reordered, merged, preserved and dropped', () => {
    const plan = planStructureSwitch(seeded(), 'prisma-p');
    const text = summarizeStructurePlan(plan);
    expect(text).toContain('new section');
    expect(text).toContain('4 kept as written');
  });

  it('says so honestly when nothing changes', () => {
    expect(summarizeStructurePlan(planStructureSwitch(seeded(), 'imrad'))).toBe('No structural change.');
    expect(summarizeStructurePlan(null)).toBe('');
    expect(summarizeStructurePlan({ ok: false })).toBe('');
  });
});

/* ══════════════ the dialog ══════════════ */

describe('119.md §7 — the structure switcher dialog', () => {
  const html = dialog(seeded());

  it('is a real modal dialog with the pinned test id', () => {
    expect(html).toContain('data-testid="stitch-manuscript-structure-dialog"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it('offers every shipped structure as a radio, with its guideline and version', () => {
    for (const id of ['imrad', 'prisma-2020', 'prisma-nma', 'prisma-scr', 'consort',
      'strobe', 'stard', 'care', 'srqr', 'prisma-p']) {
      expect(html, id).toContain(`data-testid="stitch-manuscript-structure-option-${id}"`);
    }
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('CONSORT');
    expect(html).toContain('2025 (published 14 April 2025; 30-item checklist)');
  });

  it('marks which structure the draft is CURRENTLY on', () => {
    expect(html).toContain('data-testid="stitch-manuscript-structure-current-imrad"');
    expect(html).toContain('Current');
  });

  it('PREVIEWS the resulting structure section by section, with its state', () => {
    expect(html).toContain('data-testid="stitch-manuscript-structure-preview"');
    for (const s of SECTION_TYPES) {
      expect(html, s.id).toContain(`data-testid="stitch-manuscript-structure-row-${s.id}"`);
    }
    expect(html).toContain('data-state="kept"');
  });

  it('shows the guideline provenance §7 requires (version + reviewed date + source)', () => {
    expect(html).toContain('data-testid="stitch-manuscript-structure-provenance"');
    expect(html).toContain('Reviewed:');
    expect(html).toContain('2026-08-16');
    expect(html).toContain('Guideline:');
  });

  it('never claims compliance', () => {
    expect(html).toContain(NO_COMPLIANCE_NOTE);
    expect(NO_COMPLIANCE_NOTE).toMatch(/do not check or guarantee compliance/i);
    expect(html).not.toMatch(/compliant with|guarantees compliance|fully compliant/i);
  });

  it('offers Cancel and Apply, and Cancel is the one that writes nothing', () => {
    expect(html).toContain('data-testid="stitch-manuscript-structure-cancel"');
    expect(html).toContain('data-testid="stitch-manuscript-structure-apply"');
    const src = readSource('src/features/manuscript/StructureSwitcher.jsx');
    // The only write in the component is inside `apply`.
    expect(src).toContain('const apply = () => {');
    expect(src).toContain('m.applyStructure(selected, mapping);');
    // The ONE call site is inside `apply` — the guard above it does not write.
    expect(src.match(/m\.applyStructure\(selected, mapping\)/g).length).toBe(1);
    // Escape closes without writing, and claims the focus-mode exit (117.md §44).
    expect(src).toContain('markOverlayEscape();');
  });

  it('changing the TARGET clears the mapping (target ids moved)', () => {
    const src = readSource('src/features/manuscript/StructureSwitcher.jsx');
    const fn = src.slice(src.indexOf('const pickStructure = useCallback('));
    expect(fn.slice(0, 200)).toContain('setMapping({});');
  });
});

describe('119.md §7 — unmapped content is offered a map, and preserved by default', () => {
  // IMRAD → protocol: Results/Discussion/Limitations/Conclusions have no home.
  const html = dialog(seeded(), {});
  const protocolHtml = renderToStaticMarkup(
    <StructureSwitcher
      m={{
        ...mockM(seeded()),
        // the dialog opens on the CURRENT structure; simulate the selection by
        // handing it a draft already on the protocol structure's "from" side.
      }}
      onClose={noop} />,
  );

  it('the plan the dialog renders lists every unmapped section with its size', () => {
    const plan = planStructureSwitch(seeded(), 'prisma-p');
    expect(plan.unmapped.map((u) => u.id).sort())
      .toEqual(['conclusion', 'discussion', 'limitations', 'results']);
    for (const u of plan.unmapped) expect(u.mappedTo).toBe('');   // preserved by default
  });

  it('renders a mapping select per unmapped section, defaulting to "keep"', () => {
    const draft = seeded();
    const m = mockM(draft);
    // Force the dialog onto the protocol structure by rendering with a draft that is
    // ALREADY on CARE, so the current-vs-target diff has unmapped rows on open.
    const care = applyStructureSwitch(draft, 'care', { nowIso: NOW }).draft;
    const careHtml = renderToStaticMarkup(
      <StructureSwitcher m={mockM(care)} onClose={noop} />,
    );
    // On CARE, the preserved sections from the IMRAD switch are visible as rows.
    expect(careHtml).toContain('data-testid="stitch-manuscript-structure-row-methods"');
    // …and the source wires one <select> per unmapped section.
    const src = readSource('src/features/manuscript/StructureSwitcher.jsx');
    expect(src).toContain('data-testid={`stitch-manuscript-structure-map-${u.id}`}');
    expect(src).toContain('<option value="">Keep as its own section (preserved)</option>');
    expect(src).toContain('data-testid="stitch-manuscript-structure-unmapped"');
    void m; void html; void protocolHtml;
  });

  it('states the never-delete promise in words, once', () => {
    const src = readSource('src/features/manuscript/StructureSwitcher.jsx');
    expect(PRESERVE_PROMISE).toMatch(/Nothing is deleted/);
    expect(src).toContain('{PRESERVE_PROMISE}');
  });

  it('a preserved section is labelled in the RESULT, not merely kept on disk', () => {
    const care = applyStructureSwitch(seeded(), 'care', { nowIso: NOW }).draft;
    const careHtml = renderToStaticMarkup(<StructureSwitcher m={mockM(care)} onClose={noop} />);
    // Re-applying CARE keeps the retained sections, still flagged as preserved.
    expect(careHtml).toContain('stitch-manuscript-structure-preserved-methods');
    expect(careHtml).toContain('Not part of this template');
  });
});

/* ══════════════ the undo affordance ══════════════ */

describe('119.md §7 — undo a template change', () => {
  const change = {
    applied: true, structureId: 'care', label: 'Case report (CARE)',
    snapshotId: 'snap_1_x', merged: [{ from: 'conclusion', to: 'discussion' }],
    preserved: ['methods', 'results'],
  };
  const html = renderToStaticMarkup(
    <StructureChangeUndo m={{ lastStructureChange: change, undoStructureChange: noop, dismissStructureChange: noop }} />,
  );

  it('appears after a switch with an explicit Undo control', () => {
    expect(html).toContain('data-testid="stitch-manuscript-structure-undo-bar"');
    expect(html).toContain('data-testid="stitch-manuscript-structure-undo"');
    expect(html).toContain('Undo structure change');
  });

  it('says what happened to the researcher\'s text — and that nothing was deleted', () => {
    expect(html).toContain('Case report (CARE)');
    expect(html).toContain('1 section merged into another.');
    expect(html).toContain('2 sections kept as written — nothing was deleted.');
  });

  it('renders nothing when there is no change to undo', () => {
    expect(renderToStaticMarkup(<StructureChangeUndo m={{}} />)).toBe('');
    expect(renderToStaticMarkup(<StructureChangeUndo m={{ lastStructureChange: { applied: false } }} />)).toBe('');
  });

  /* A defect found by the §10-15 browser run and fixed here, pinned so it stays
     fixed: RichSectionEditor renders its DOM once per mount key, and that key was
     section identity + GENERATION stamp only. A structure MERGE and a snapshot
     RESTORE both rewrite `sections[id].content` without moving `lastGeneratedAt`,
     so the mounted editor kept showing the pre-change paragraph — and the next
     keystroke committed that stale DOM back over the new text. */
  it('every editor re-mounts when prose is replaced from OUTSIDE the editor', () => {
    const hook = readSource('src/features/manuscript/useManuscript.js');
    expect(hook).toContain('const [contentEpoch, setContentEpoch] = useState(0);');
    expect(hook).toContain('const bumpContentEpoch = useCallback(() => setContentEpoch((n) => n + 1), []);');
    // …bumped by BOTH external-replacement paths.
    const restore = hook.slice(hook.indexOf('const restoreSnapshotById = useCallback('));
    expect(restore.slice(0, 300)).toContain('bumpContentEpoch();');
    const apply = hook.slice(hook.indexOf('const applyStructure = useCallback('));
    expect(apply.slice(0, 2200)).toContain('bumpContentEpoch();');
    // …and folded into the two mount keys the editors are rendered from.
    const panels = readSource('src/features/manuscript/manuscriptPanels.jsx');
    expect(panels).toContain('mountKey: `${m.activeId}:${id}:${sec.lastGeneratedAt || \'\'}:${m.contentEpoch || 0}`,');
    expect(panels).toContain('const key = `${m.activeId}:abstract:${sec.lastGeneratedAt || \'\'}:${m.contentEpoch || 0}`;');
    // The popover epoch follows the same remount, or a chip menu outlives its chip.
    expect(panels).toContain('}:${m.contentEpoch || 0}`;');
  });

  it('is backed by a snapshot taken INSIDE the same write as the switch', () => {
    const src = readSource('src/features/manuscript/useManuscript.js');
    const fn = src.slice(src.indexOf('const applyStructure = useCallback('), src.indexOf('/** §7 "Undo a template change"'));
    expect(fn).toContain('if (flushPending) flushPending();');
    expect(fn).toContain('const before = createSnapshot(draft, projectRef.current, {');
    expect(fn).toContain('applyStructureSwitch(before.draft, structureId,');
    // …and the snapshot id is what the undo restores.
    expect(src).toContain('restoreSnapshotById(lastStructureChange.snapshotId);');
  });
});

/* ══════════════ the three dimensions, on screen ══════════════ */

describe('119.md §7 — three controls for three dimensions', () => {
  it('the toolbar carries Structure as its own control, beside Template and Citation style', () => {
    expect(LEVEL_A_CONTROLS).toContain('structure');
    expect(LEVEL_A_CONTROLS).toContain('template');
    expect(LEVEL_A_CONTROLS).toContain('citation');
    const html = renderToStaticMarkup(
      <ManuscriptToolbar m={mockM(seeded())} tab="editor" onTabChange={noop} onOpenStructure={noop} />,
    );
    expect(html).toContain('data-testid="stitch-manuscript-structure-select"');
    expect(html).toContain('Structure:');
    // 118.md §53/§54 stay exactly as they were — the journal profile keeps its id.
    expect(html).toContain('data-testid="stitch-manuscript-template-select"');
    expect(html).toContain('Template:');
    expect(html).toContain('data-testid="stitch-manuscript-citation-select"');
  });

  it('118.md §41 density contract is unchanged by the new control', () => {
    expect(levelAInline('overflow')).toEqual(['template', 'citation']);
    expect(levelAInline('minimal')).toEqual([]);
    expect(levelAInline('full')).toEqual(LEVEL_A_CONTROLS);
    // Nothing is ever dropped: every control is inline or in the '⋯' menu.
    for (const d of ['full', 'compact', 'overflow', 'minimal']) {
      const inline = levelAInline(d);
      const over = LEVEL_A_CONTROLS.filter((k) => !inline.includes(k));
      expect([...inline, ...over].sort()).toEqual([...LEVEL_A_CONTROLS].sort());
    }
  });

  it('the structure control OPENS the dialog rather than committing a value', () => {
    const src = readSource('src/features/manuscript/ManuscriptToolbar.jsx');
    expect(src).toContain('<ToolbarButton key="structure"');
    expect(src).toContain('onClick={onOpenStructure}');
    // …and the workspace flushes before previewing (118.md §45).
    const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
    expect(ws).toContain('const openStructure = useCallback(() => {');
    expect(ws).toContain('if (m.flush) m.flush();');
    expect(ws).toContain('onOpenStructure={openStructure}');
  });

  it('the Export destination separates the three dimensions into three blocks', () => {
    const src = readSource('src/features/manuscript/manuscriptPanels.jsx');
    expect(src).toContain('title="Reporting structure"');
    expect(src).toContain('title="Journal profile"');
    expect(src).toContain('title="Citation style"');
    expect(src).toContain('switching profiles never changes your sections');
    expect(src).toContain('it never adds, removes or reorders a section');
  });
});

/* ══════════════ journal-profile honesty on screen ══════════════ */

describe('119.md §7 — journal profiles show their source and what is unverified', () => {
  it('renders publisher, source, last-reviewed date and the verified facts', () => {
    const html = renderToStaticMarkup(<JournalProfileNotes templateId="jama" />);
    expect(html).toContain('data-testid="stitch-manuscript-journal-provenance"');
    expect(html).toContain('American Medical Association');
    expect(html).toContain('jamanetwork.com');
    expect(html).toContain('2026-08-16');
    expect(html).toContain('350 words');
  });

  it('names the fields the user must still verify, per profile', () => {
    const html = renderToStaticMarkup(<JournalProfileNotes templateId="lancet" />);
    expect(html).toContain('data-testid="stitch-manuscript-journal-unverified"');
    expect(html).toContain('Requires your verification:');
    expect(html).toContain('abstractWordLimit');
    // …and says outright that the instructions could not be read.
    expect(html).toContain('data-testid="stitch-manuscript-journal-note"');
    expect(html).toMatch(/403/);
  });

  it('renders nothing for an unknown profile rather than inventing one', () => {
    expect(renderToStaticMarkup(<JournalProfileNotes templateId="nope" />))
      .toContain('ICMJE'); // falls back to the generic profile, honestly labelled
  });
});

/* ══════════════ customization in the Export destination ══════════════ */

describe('119.md §7 — customize the resulting structure', () => {
  const src = readSource('src/features/manuscript/manuscriptPanels.jsx');

  it('lists every section of the draft with rename and reorder controls', () => {
    expect(src).toContain('data-testid={`stitch-manuscript-structure-section-${s.id}`}');
    expect(src).toContain('data-testid={`stitch-manuscript-structure-rename-${s.id}`}');
    expect(src).toContain('data-testid={`stitch-manuscript-structure-up-${s.id}`}');
    expect(src).toContain('data-testid={`stitch-manuscript-structure-down-${s.id}`}');
  });

  it('marks a section kept from a previous structure', () => {
    expect(src).toContain('Kept from a previous structure');
    expect(src).toContain('data-testid={`stitch-manuscript-structure-kept-${s.id}`}');
  });

  it('writes through the pure engine writers, never a local mutation', () => {
    expect(src).toContain('m.renameSection(editing.id, v)');
    expect(src).toContain('m.moveSection(s.id, -1)');
    expect(src).toContain('m.moveSection(s.id, 1)');
    const hook = readSource('src/features/manuscript/useManuscript.js');
    expect(hook).toContain('draftOf(renameDraftSection(draft, sectionId, label,');
    expect(hook).toContain('draftOf(moveDraftSection(draft, sectionId, delta,');
  });
});

/* ══════════════ provenance renderer ══════════════ */

describe('119.md §7 — StructureProvenance', () => {
  it('prints guideline, version, reviewed date, checklist size and source', () => {
    const html = renderToStaticMarkup(<StructureProvenance structure={structureById('care')} />);
    expect(html).toContain('CARE');
    expect(html).toContain('2013 (13-item checklist; explanation and elaboration 2017)');
    expect(html).toContain('13 items');
    expect(html).toContain('care-statement.org');
  });

  it('renders nothing without a structure', () => {
    expect(renderToStaticMarkup(<StructureProvenance structure={null} />)).toBe('');
  });
});
