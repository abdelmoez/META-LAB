/**
 * 117.md §88 (r3) — "reference merges must be auditable and undoable".
 *
 * The reference-library writers (add / edit / merge / hide / restore / delete /
 * import) are pure `lib → lib` functions invoked through `useManuscript.writeLibrary`,
 * i.e. `upd('referenceLibrary', materializeReferenceLibrary(next))`. After the
 * reference-library wave they were not undoable at all: a merge silently rewrote the
 * survivor, aliased the loser and suppressed it, with nothing to take it back.
 *
 * What this file pins:
 *   - ONE history kind (`manuscript.referenceLibrary`) with a human label per op;
 *   - entries recorded at issue time carrying COMPLETE prev/next overlay snapshots
 *     plus an `expect` precondition compared by a STABLE serialization;
 *   - an executor round trip for every op — undo restores the exact prior overlay,
 *     redo restores the exact next one;
 *   - the ABSENCE case: undoing the FIRST library op removes `project.referenceLibrary`
 *     from the blob entirely rather than leaving `{}` behind (the materialize rule);
 *   - a polite, NAMED refusal when the live overlay drifted (108.md §14/§15);
 *   - the undo-carrying snackbar sentences for the three destructive-feeling ops;
 *   - the hook wiring itself, pinned at the source (it is effect-driven, so it cannot
 *     run under static rendering — the same fallback historyOps.test.js uses).
 */
import { describe, it, expect } from 'vitest';
import {
  // the overlay model + its pure writers
  readReferenceLibrary, normalizeReferenceLibrary, materializeReferenceLibrary,
  resolveReferenceLibrary,
  libraryAddEntry, libraryEditReference, librarySuppress, libraryRestore,
  libraryDeleteEntry, libraryMerge, recordToReferenceEntry,
  // 117.md §88 — the undo/audit model
  REFERENCE_LIBRARY_KIND, REFERENCE_LIBRARY_OPS, REFERENCE_LIBRARY_OP_LABELS,
  REFERENCE_LIBRARY_NOTE_OPS,
  referenceLibraryOpLabel, referenceLibrarySignature, referenceLibraryMatches,
  referenceLibraryEntry, referenceLibraryRefusal, referenceLibraryUndoStep,
  referenceLibraryNote,
} from '../../../src/research-engine/manuscript/referenceLibrary.js';
import { readSource } from '../../helpers/readSource.js';

const PROJECT = Object.freeze({
  id: 'p1',
  studies: [
    { id: 's1', title: 'Trial A', authors: 'Smith J', year: '2020', doi: '10.1/a' },
    { id: 's2', title: 'Trial B', authors: 'Doe A', year: '2021', doi: '10.1/b' },
  ],
});

/** A project blob as it would be PERSISTED (undefined keys drop out of JSON). */
const blob = (project) => JSON.parse(JSON.stringify(project));

/**
 * The hook's write path + history, reduced to the pure pieces it is built from.
 *
 * This mirrors `useManuscript.writeLibrary` / `recordLibraryOp` / the
 * `manuscript.referenceLibrary` executor exactly — read the freshest overlay, run
 * the pure writer, materialize, record an entry carrying both snapshots; and on the
 * way back, re-validate against the LIVE overlay and write the recorded snapshot
 * through the SAME path with no op id (so a replay never records). The hook's own
 * wiring is pinned at the source at the bottom of this file.
 */
function harness(baseProject) {
  const h = {
    project: { ...baseProject },
    undoStack: [],
    redoStack: [],
    notes: [],
  };

  h.write = (mutator, op = null) => {
    const cur = readReferenceLibrary(h.project);
    const next = mutator(cur);
    if (!next) return false;
    h.project = { ...h.project, referenceLibrary: materializeReferenceLibrary(next) };
    if (op) {
      const entry = referenceLibraryEntry(op, cur, next);
      if (entry) {
        h.undoStack.push(entry);
        h.redoStack.length = 0;
        const added = Math.max(0, (next.entries || []).length - (cur.entries || []).length);
        const message = referenceLibraryNote(op, added);
        if (message) h.notes.push({ message, label: entry.label, entryId: entry.entityKey });
      }
    }
    return true;
  };

  h.exec = (op) => {
    const step = referenceLibraryUndoStep(readReferenceLibrary(h.project), op);
    if (!step.ok) return { ok: false, reason: 'refused', detail: step.detail };
    return h.write(() => step.library) ? { ok: true } : { ok: false, reason: 'failed' };
  };

  h.undo = () => {
    const e = h.undoStack.pop();
    if (!e) return { ok: false, reason: 'no-entry' };
    const r = h.exec(e.undoOp);
    if (r.ok) h.redoStack.push(e); else h.undoStack.push(e);
    return r;
  };

  h.redo = () => {
    const e = h.redoStack.pop();
    if (!e) return { ok: false, reason: 'no-entry' };
    const r = h.exec(e.redoOp);
    if (r.ok) h.undoStack.push(e); else h.redoStack.push(e);
    return r;
  };

  return h;
}

/* ════════════ labels + the one kind ════════════ */

describe('117.md §88 — one kind, a human label per op', () => {
  it('uses ONE history kind for the whole overlay', () => {
    expect(REFERENCE_LIBRARY_KIND).toBe('manuscript.referenceLibrary');
  });

  it('pins the label of every op', () => {
    expect(REFERENCE_LIBRARY_OP_LABELS).toEqual({
      add: 'Add reference',
      edit: 'Edit reference',
      merge: 'Merge references',
      suppress: 'Hide reference',
      restore: 'Restore reference',
      delete: 'Delete reference',
      import: 'Import references',
    });
    expect(REFERENCE_LIBRARY_OPS).toEqual(['add', 'edit', 'merge', 'suppress', 'restore', 'delete', 'import']);
  });

  it('labels each op through the accessor, and never leaves an unknown op nameless', () => {
    expect(referenceLibraryOpLabel('merge')).toBe('Merge references');
    expect(referenceLibraryOpLabel('delete')).toBe('Delete reference');
    expect(referenceLibraryOpLabel('import')).toBe('Import references');
    expect(referenceLibraryOpLabel('nonsense')).toBe('Reference library change');
    expect(referenceLibraryOpLabel(null)).toBe('Reference library change');
  });
});

/* ════════════ the stable serialization behind `expect` ════════════ */

describe('117.md §88 — the precondition compares a STABLE serialization', () => {
  it('two deep-equal overlays match whatever order their keys arrived in', () => {
    const a = { entries: [{ id: 'x', title: 'T', year: '2020' }], removed: ['s1'] };
    const b = { removed: ['s1'], entries: [{ year: '2020', id: 'x', title: 'T' }] };
    expect(referenceLibrarySignature(a)).toBe(referenceLibrarySignature(b));
    expect(referenceLibraryMatches(a, b)).toBe(true);
  });

  it('an absent overlay and an empty one are the same state', () => {
    expect(referenceLibraryMatches(undefined, {})).toBe(true);
    expect(referenceLibraryMatches(null, normalizeReferenceLibrary(null))).toBe(true);
  });

  it('any real difference — entries, edits, aliases, removed — is a different signature', () => {
    const base = normalizeReferenceLibrary({ entries: [{ id: 'x', title: 'T' }] });
    expect(referenceLibraryMatches(base, { entries: [{ id: 'x', title: 'U' }] })).toBe(false);
    expect(referenceLibraryMatches(base, { ...base, removed: ['s1'] })).toBe(false);
    expect(referenceLibraryMatches(base, { ...base, aliases: { a: 'b' } })).toBe(false);
    expect(referenceLibraryMatches(base, { ...base, edits: { s1: { title: 'T' } } })).toBe(false);
  });
});

/* ════════════ the recorded entry ════════════ */

describe('117.md §88 — entries are recorded at issue time with both snapshots', () => {
  const prev = normalizeReferenceLibrary(null);
  const next = libraryAddEntry(prev, { id: 'x1', title: 'A guideline', type: 'guideline' });

  it('carries kind, label, and COMPLETE prev/next overlays with mirrored expects', () => {
    const e = referenceLibraryEntry('add', prev, next);
    expect(e.kind).toBe('manuscript.referenceLibrary');
    expect(e.label).toBe('Add reference');
    expect(e.entityKey).toBe('referenceLibrary');
    expect(e.undoOp.op).toBe('add');
    expect(e.undoOp.library).toEqual(prev);
    expect(e.undoOp.expect).toEqual(normalizeReferenceLibrary(next));
    expect(e.redoOp.library).toEqual(normalizeReferenceLibrary(next));
    expect(e.redoOp.expect).toEqual(prev);
  });

  it('records NOTHING when the overlay did not actually move', () => {
    expect(referenceLibraryEntry('edit', next, next)).toBeNull();
    expect(referenceLibraryEntry('add', null, {})).toBeNull();
  });
});

/* ════════════ executor round trip, op by op ════════════ */

describe('117.md §88 — executor round trip for every library op', () => {
  /** Run one forward op and assert undo → exact prior blob, redo → exact next blob. */
  const roundTrip = (seed, op, mutator) => {
    const h = harness(seed);
    const before = blob(h.project);
    expect(h.write(mutator, op)).toBe(true);
    const after = blob(h.project);
    expect(after).not.toEqual(before);
    expect(h.undoStack).toHaveLength(1);
    expect(h.undoStack[0].label).toBe(referenceLibraryOpLabel(op));

    expect(h.undo()).toEqual({ ok: true });
    expect(blob(h.project)).toEqual(before);

    expect(h.redo()).toEqual({ ok: true });
    expect(blob(h.project)).toEqual(after);
    return h;
  };

  it('add — undo restores the exact prior overlay', () => {
    roundTrip(PROJECT, 'add', (lib) => libraryAddEntry(lib, { id: 'x1', title: 'A guideline', type: 'guideline' }));
  });

  it('edit — a correction on a DERIVED reference (an `edits` patch) round-trips', () => {
    const h = roundTrip(PROJECT, 'edit', (lib) => libraryEditReference(lib, 's1', { journal: 'Lancet' }));
    expect(readReferenceLibrary(h.project).edits.s1.journal).toBe('Lancet');
  });

  it('suppress — hiding a derived reference round-trips', () => {
    roundTrip(PROJECT, 'suppress', (lib) => librarySuppress(lib, 's1'));
  });

  it('restore — un-hiding round-trips back to the hidden state', () => {
    const seed = { ...PROJECT, referenceLibrary: { removed: ['s1'] } };
    roundTrip(seed, 'restore', (lib) => libraryRestore(lib, 's1'));
  });

  it('delete — an entry AND its edits patch come back together', () => {
    const seed = {
      ...PROJECT,
      referenceLibrary: {
        entries: [{ id: 'x1', title: 'A guideline', type: 'guideline' }],
        edits: { x1: { journal: 'BMJ' } },
      },
    };
    const h = roundTrip(seed, 'delete', (lib) => libraryDeleteEntry(lib, 'x1'));
    // The forward op dropped both halves; the undo brought both back.
    const lib = readReferenceLibrary(h.project);
    expect(lib.entries.map((e) => e.id)).toEqual([]);
    h.undo();
    const restored = readReferenceLibrary(h.project);
    expect(restored.entries.map((e) => e.id)).toEqual(['x1']);
    expect(restored.edits.x1).toEqual({ journal: 'BMJ' });
  });

  it('merge — the alias, the suppression AND the blank-fill patch all reverse as one step', () => {
    const h = harness(PROJECT);
    const before = blob(h.project);
    const ok = h.write((lib) => libraryMerge(lib, {
      survivorId: 's1',
      mergedId: 's2',
      refs: resolveReferenceLibrary(h.project, { library: lib }).refs,
    }), 'merge');
    expect(ok).toBe(true);

    // The forward merge really did all three things (this is what makes a hand-rolled
    // inverse a bad idea — see referenceLibrary.js §88).
    const merged = readReferenceLibrary(h.project);
    expect(merged.aliases.s2).toBe('s1');
    expect(merged.removed).toContain('s2');
    const after = blob(h.project);

    expect(h.undo()).toEqual({ ok: true });
    expect(blob(h.project)).toEqual(before);
    expect(readReferenceLibrary(h.project).aliases).toEqual({});
    expect(readReferenceLibrary(h.project).removed).toEqual([]);

    expect(h.redo()).toEqual({ ok: true });
    expect(blob(h.project)).toEqual(after);
    expect(readReferenceLibrary(h.project).aliases.s2).toBe('s1');
  });

  it('import — a BATCH of records is one undo step, not N', () => {
    const records = [
      { id: 'rec1', title: 'Imported one', authors: 'Lee K', year: '2018' },
      { id: 'rec2', title: 'Imported two', authors: 'Ng P', year: '2019' },
      { id: 'rec3', title: 'Imported three', authors: 'Oh S', year: '2022' },
    ];
    const h = harness(PROJECT);
    const before = blob(h.project);
    h.write((lib) => {
      let next = lib;
      const used = new Set();
      records.forEach((rec, i) => {
        const entry = recordToReferenceEntry(rec, { linkRecordId: true });
        const step = libraryAddEntry(next, { ...entry, id: `imp${i}` }, { usedIds: used });
        if (step) { next = step; used.add(`imp${i}`); }
      });
      return next;
    }, 'import');

    expect(readReferenceLibrary(h.project).entries).toHaveLength(3);
    expect(h.undoStack).toHaveLength(1);          // ONE entry for three references
    expect(h.undo()).toEqual({ ok: true });
    expect(blob(h.project)).toEqual(before);
    expect(readReferenceLibrary(h.project).entries).toHaveLength(0);
  });

  it('two ops in a row undo LIFO, each back through its own snapshot', () => {
    const h = harness(PROJECT);
    const s0 = blob(h.project);
    h.write((lib) => libraryAddEntry(lib, { id: 'x1', title: 'One' }), 'add');
    const s1 = blob(h.project);
    h.write((lib) => librarySuppress(lib, 's1'), 'suppress');
    const s2 = blob(h.project);

    expect(h.undo()).toEqual({ ok: true });
    expect(blob(h.project)).toEqual(s1);
    expect(h.undo()).toEqual({ ok: true });
    expect(blob(h.project)).toEqual(s0);
    expect(h.redo()).toEqual({ ok: true });
    expect(blob(h.project)).toEqual(s1);
    expect(h.redo()).toEqual({ ok: true });
    expect(blob(h.project)).toEqual(s2);
  });
});

/* ════════════ byte-stability: absence is restored as ABSENCE ════════════ */

describe('117.md §88 — undoing the FIRST library op removes the key entirely', () => {
  it('materializes back to undefined, not to {}', () => {
    const h = harness(PROJECT);
    expect(blob(h.project)).not.toHaveProperty('referenceLibrary');

    h.write((lib) => libraryAddEntry(lib, { id: 'x1', title: 'One' }), 'add');
    expect(blob(h.project)).toHaveProperty('referenceLibrary');

    const step = referenceLibraryUndoStep(readReferenceLibrary(h.project), h.undoStack[0].undoOp);
    expect(step.ok).toBe(true);
    expect(materializeReferenceLibrary(step.library)).toBeUndefined();

    h.undo();
    // The persisted blob is byte-identical to a project that never used the library.
    expect(blob(h.project)).toEqual(blob(PROJECT));
    expect(Object.prototype.hasOwnProperty.call(blob(h.project), 'referenceLibrary')).toBe(false);
  });

  it('the same rule holds when a merge is the first op', () => {
    const h = harness(PROJECT);
    h.write((lib) => libraryMerge(lib, {
      survivorId: 's1', mergedId: 's2', refs: resolveReferenceLibrary(h.project, { library: lib }).refs,
    }), 'merge');
    h.undo();
    expect(blob(h.project)).toEqual(blob(PROJECT));
  });
});

/* ════════════ 108.md §14/§15 — refusal on drift ════════════ */

describe('117.md §88 — a drifted library refuses politely, by name', () => {
  it('refuses when the live overlay no longer matches `expect`', () => {
    const h = harness(PROJECT);
    h.write((lib) => libraryMerge(lib, {
      survivorId: 's1', mergedId: 's2', refs: resolveReferenceLibrary(h.project, { library: lib }).refs,
    }), 'merge');
    const after = blob(h.project);

    // A collaborator (or this user in another tab) adds a reference underneath us.
    h.write((lib) => libraryAddEntry(lib, { id: 'collab', title: 'Landed elsewhere' }));

    const r = h.undo();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('refused');
    expect(r.detail).toBe('The reference library changed since “Merge references” — reload before undoing.');
    // …and nothing was clobbered: the collaborator's addition is still there and the
    // entry went back on the stack (108.md §8.6).
    expect(readReferenceLibrary(h.project).entries.map((e) => e.id)).toEqual(['collab']);
    expect(h.undoStack).toHaveLength(1);          // the merge entry went back on it
    expect(h.redoStack).toHaveLength(0);
    expect(blob(h.project)).not.toEqual(after);
  });

  it('names the op in the refusal for every op id', () => {
    expect(referenceLibraryRefusal('delete'))
      .toBe('The reference library changed since “Delete reference” — reload before undoing.');
    expect(referenceLibraryRefusal('import'))
      .toBe('The reference library changed since “Import references” — reload before undoing.');
  });

  it('a malformed op is refused rather than written', () => {
    expect(referenceLibraryUndoStep({}, null).ok).toBe(false);
    expect(referenceLibraryUndoStep({}, { op: 'add' }).ok).toBe(false);       // no library
    expect(referenceLibraryUndoStep({}, { op: 'add', library: {}, expect: { entries: [{ id: 'z' }] } }).ok).toBe(false);
  });
});

/* ════════════ §88 — the undo-carrying snackbar ════════════ */

describe('117.md §88 — merge / delete / import get an undoable note', () => {
  it('pins which ops get a note', () => {
    expect(REFERENCE_LIBRARY_NOTE_OPS).toEqual(['merge', 'delete', 'import']);
  });

  it('pins the sentences', () => {
    expect(referenceLibraryNote('merge')).toBe('References merged — every citation still resolves.');
    expect(referenceLibraryNote('delete')).toBe('Reference deleted from the library.');
    expect(referenceLibraryNote('import', 1)).toBe('1 reference imported into the library.');
    expect(referenceLibraryNote('import', 4)).toBe('4 references imported into the library.');
    expect(referenceLibraryNote('import', 0)).toBe('0 references imported into the library.');
  });

  it('the quiet ops get NO note — they are visible and reversible in the panel', () => {
    for (const op of ['add', 'edit', 'suppress', 'restore', 'nonsense']) {
      expect(referenceLibraryNote(op)).toBe('');
    }
  });

  it('a merge posts exactly one note, an add posts none', () => {
    const h = harness(PROJECT);
    h.write((lib) => libraryAddEntry(lib, { id: 'x1', title: 'One' }), 'add');
    expect(h.notes).toHaveLength(0);
    h.write((lib) => libraryMerge(lib, {
      survivorId: 's1', mergedId: 's2', refs: resolveReferenceLibrary(h.project, { library: lib }).refs,
    }), 'merge');
    expect(h.notes).toEqual([{
      message: 'References merged — every citation still resolves.',
      label: 'Merge references',
      entryId: 'referenceLibrary',
    }]);
  });

  it('the import note counts what actually landed', () => {
    const h = harness(PROJECT);
    h.write((lib) => {
      let next = lib;
      const used = new Set();
      ['a', 'b'].forEach((id) => { next = libraryAddEntry(next, { id, title: id }, { usedIds: used }) || next; used.add(id); });
      return next;
    }, 'import');
    expect(h.notes[0].message).toBe('2 references imported into the library.');
  });
});

/* ════════════ the hook wiring (source pins) ════════════ */

describe('useManuscript wiring (source pins) — 117.md §88', () => {
  const s = readSource(new URL('../../../src/features/manuscript/useManuscript.js', import.meta.url));

  it('registers ONE executor for the library kind', () => {
    expect(s).toContain('registerExecutor(REFERENCE_LIBRARY_KIND, (op) => {');
  });

  it('re-validates against the LIVE overlay and refuses with the named detail', () => {
    expect(s).toContain('referenceLibraryUndoStep(readReferenceLibrary(projectRef.current), op)');
    expect(s).toContain("if (!step.ok) return { ok: false, reason: 'refused', detail: step.detail };");
  });

  it('undo/redo write through the SAME writeLibrary path, and record nothing', () => {
    // No op id on the replay call — an executor must never record what it replays.
    expect(s).toContain('const applied = writeLibrary(() => step.library);');
    expect(s).toContain('if (op) recordLibraryOp(op, cur, next);');
  });

  it('every writer passes its op id to writeLibrary', () => {
    expect(s).toContain("}, 'add');");
    expect(s).toContain("    'edit',\n  ), [writeLibrary]);");
    expect(s).toContain("writeLibrary((lib) => librarySuppress(lib, id), 'suppress')");
    expect(s).toContain("writeLibrary((lib) => libraryRestore(lib, id), 'restore')");
    expect(s).toContain("writeLibrary((lib) => libraryDeleteEntry(lib, id), 'delete')");
    expect(s).toContain("    'merge',\n  ), [writeLibrary]);");
    expect(s).toContain("}, 'import');");
  });

  it('the entry is built by the pure builder and the note is ENTRY-TARGETED', () => {
    expect(s).toContain('const entry = referenceLibraryEntry(op, prev, next);');
    expect(s).toContain('const stamped = historyRef.current.record(entry);');
    expect(s).toContain('undo: () => { historyRef.current.undoEntry(stamped.id); },');
    expect(s).toContain('entryId: stamped.id,');
  });

  it('the manuscript reads the shared feedback queue (inert outside a provider)', () => {
    expect(s).toContain("import { useUndoFeedback } from '../../frontend/history/useUndoFeedback.jsx';");
    expect(s).toContain('const feedback = useUndoFeedback();');
    expect(s).toContain('feedbackRef.current = feedback;');
  });
});

/* ════════════ TASK 2 — the barrel ════════════ */

describe('117.md §26-§33 — referenceLibrary.js is exported from the manuscript barrel', () => {
  const barrel = readSource(new URL('../../../src/research-engine/manuscript/index.js', import.meta.url));

  it('re-exports the module', () => {
    expect(barrel).toContain("export * from './referenceLibrary.js';");
  });

  it('every reference-library export is reachable through the barrel, unshadowed', async () => {
    const mod = await import('../../../src/research-engine/manuscript/index.js');
    const direct = await import('../../../src/research-engine/manuscript/referenceLibrary.js');
    const names = Object.keys(direct).filter((k) => k !== 'default');
    expect(names.length).toBeGreaterThan(30);
    for (const n of names) {
      expect(mod[n], `barrel is missing ${n}`).toBeDefined();
      expect(mod[n], `barrel shadows ${n}`).toBe(direct[n]);
    }
  });
});
