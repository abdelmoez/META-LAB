/**
 * manuscript/historyOps.js — 108.md §§6, §9, §14. The pure read/apply/compare
 * primitives behind the manuscript's two undoable STRUCTURED mutations.
 *
 * ── WHY ONLY TWO ─────────────────────────────────────────────────────────────
 * The manuscript editor splits cleanly along the line 108.md §7 draws:
 *   - FREEFORM PROSE stays with the browser. `RichSectionEditor` is a
 *     contentEditable div with role="textbox" and its header states that commands
 *     go through execCommand specifically to keep native undo/redo. The canonical
 *     editable predicate covers role="textbox", so Ctrl+Z there never reaches the
 *     router. Rewriting `section.content` from the app would also need a key bump
 *     to become visible, destroying the caret — a second reason to leave it alone.
 *   - DISCRETE STRUCTURED MUTATIONS go through `useManuscript.mutateActive`, which
 *     flushes pending typing first (a real transaction boundary — §13) and persists
 *     immediately. Of those, the SECTION LOCK toggle and the FACT PIN pair
 *     (overrideFact ↔ clearFactOverride) are exact inverses of one another.
 * Deliberately excluded this round: version snapshots (`removeSnapshot` is
 * destructive), sync decisions (bulk structural rewrites) and asset overrides.
 *
 * ── THE FACT-PIN RESIDUE, AND WHY capture/apply TAKE A SNAPSHOT ──────────────
 * `revertFact` does TWO things: it writes `factOverrides[key]` AND marks the
 * originating factLog entry `reverted` (101.md §12 — "the change is MARKED
 * reverted, never removed"). `clearFactOverride` only undoes the first. A naive
 * inverse would therefore leave a change struck through with no pin behind it. So
 * the entry carries a SNAPSHOT of both halves — the override object (or its
 * absence) and the log entry's three revert fields (or their absence) — and
 * `applyFactPin` restores exactly that, byte for byte. It is the same
 * capture-the-pre-image discipline the keyword and extraction entries use.
 *
 * Everything here is pure: no ids, no timestamps, no DOM, no React.
 */

const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/* ════════════ section lock ════════════ */

/** The persisted lock state of one section (absent ⇒ false). */
export function sectionLockOf(draft, sectionId) {
  const d = asObj(draft);
  const sections = d ? asObj(d.sections) : null;
  const s = sections && sectionId ? asObj(sections[sectionId]) : null;
  return !!(s && s.locked);
}

/**
 * sectionLockMatches(draft, sectionId, expected) — the §14 precondition. The
 * executor refuses when a collaborator (or the user, in another tab) already moved
 * the lock somewhere else, rather than clobbering their state.
 */
export function sectionLockMatches(draft, sectionId, expected) {
  return sectionLockOf(draft, sectionId) === !!expected;
}

/* ════════════ fact pin (101.md §10 override / revert) ════════════ */

/** The three fields `markChangeReverted` writes onto a factLog entry. */
function revertFieldsOf(entry) {
  const e = asObj(entry);
  if (!e) return null;
  return {
    reverted: !!e.reverted,
    revertedAt: e.revertedAt == null ? null : e.revertedAt,
    revertedBy: e.revertedBy == null ? '' : String(e.revertedBy),
  };
}

/**
 * captureFactPin(draft, key, changeId) → snapshot
 *
 * The COMPLETE pre-image of one fact's pin: the override record (or null when the
 * fact was tracking project data) plus the revert flags of the change that caused
 * it (or null when no change id was involved / the change is not in the log).
 */
export function captureFactPin(draft, key, changeId) {
  const d = asObj(draft);
  const overrides = d ? asObj(d.factOverrides) : null;
  const ov = overrides && key ? asObj(overrides[key]) : null;
  let change = null;
  if (changeId && d && Array.isArray(d.factLog)) {
    const found = d.factLog.find((c) => c && c.id === changeId);
    if (found) change = revertFieldsOf(found);
  }
  return {
    key: String(key == null ? '' : key),
    changeId: changeId == null ? null : String(changeId),
    override: ov ? { ...ov } : null,
    change,
  };
}

/**
 * applyFactPin(draft, snapshot) → draft
 *
 * Restore both halves verbatim. Absence is restored as ABSENCE (the key is deleted,
 * and `factOverrides` itself is dropped when it empties) so a project that never
 * pinned a fact goes back to a byte-identical blob — the repo's byte-stability rule
 * applied to an undo.
 */
export function applyFactPin(draft, snapshot) {
  const d = asObj(draft);
  const snap = asObj(snapshot);
  if (!d || !snap || !snap.key) return draft;

  const prev = asObj(d.factOverrides) || {};
  const nextOverrides = { ...prev };
  if (snap.override) nextOverrides[snap.key] = { ...snap.override };
  else delete nextOverrides[snap.key];

  const out = { ...d };
  if (Object.keys(nextOverrides).length) out.factOverrides = nextOverrides;
  else delete out.factOverrides;

  if (snap.changeId && snap.change && Array.isArray(d.factLog)) {
    let touched = false;
    const log = d.factLog.map((c) => {
      if (!c || c.id !== snap.changeId) return c;
      touched = true;
      if (!snap.change.reverted) {
        // Restore "never reverted" as the ABSENCE of the three fields, which is
        // what an entry that was never reverted actually looks like.
        const { reverted, revertedAt, revertedBy, ...rest } = c;
        return rest;
      }
      return {
        ...c,
        reverted: true,
        revertedAt: snap.change.revertedAt,
        revertedBy: snap.change.revertedBy,
      };
    });
    if (touched) out.factLog = log;
  }
  return out;
}

/**
 * factPinMatches(draft, snapshot) → boolean — the §14 precondition for the fact
 * pair. Compares the override VALUE (not its timestamp/actor, which a redo
 * legitimately restores verbatim) and the presence of a pin.
 */
export function factPinMatches(draft, snapshot) {
  const snap = asObj(snapshot);
  if (!snap || !snap.key) return false;
  const d = asObj(draft);
  const overrides = d ? asObj(d.factOverrides) : null;
  const cur = overrides ? asObj(overrides[snap.key]) : null;
  if (!snap.override) return !cur;
  if (!cur) return false;
  return String(cur.value) === String(snap.override.value);
}

export default {
  sectionLockOf, sectionLockMatches, captureFactPin, applyFactPin, factPinMatches,
};
