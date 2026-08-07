/**
 * BatchSearchProvenance.jsx — 104.md Part 2, the manual-search record.
 *
 * An automated run knows which database it hit and exactly when. A file import
 * knows neither: the database is whatever the parser happened to stamp on each
 * record (often nothing), and the only date is when somebody uploaded the file.
 * Those are genuinely different facts — a researcher can search Embase on the 3rd
 * and upload the export on the 11th — and the manuscript was reporting the wrong
 * one because nothing could tell it otherwise.
 *
 * This is the form that lets them say so. Three fields, because there are exactly
 * three things the file cannot tell us:
 *
 *   1. WHICH database this search was run against. Chosen from the canonical list
 *      the reporting layer understands, never free text: a name that does not
 *      canonicalize would be reported verbatim, which is how a manuscript ends up
 *      naming something that is not a database.
 *   2. WHEN the search was actually run.
 *   3. WHETHER it is part of the review's final search methodology at all. An
 *      accidental or test import is switched off here: the batch, its records and
 *      its audit trail all stay exactly where they are, and the search simply stops
 *      being reported. 104.md — "preserve audit logs, but generate the manuscript
 *      from the correct active/final research state".
 *
 * Only shown for MANUAL batches. A Pecan run already carries all three facts, and
 * offering to override them would invite someone to contradict the execution record.
 */
import { useState } from 'react';
import { C, FONT, MONO } from '../ui/theme.js';
import { Button } from '../ui/components.jsx';
import { knownDatabaseOptions } from '../../../research-engine/search/searchProvenance.js';

const OPTIONS = knownDatabaseOptions();

/** ISO timestamp → the yyyy-mm-dd a <input type="date"> expects. */
export function toDateInput(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Today, in the same format — the ceiling for the date field. */
export function todayInput(now) {
  const d = now instanceof Date ? now : new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * What the manuscript will make of the current state — shown live, because the
 * whole point of the form is that it changes what the paper says, and that
 * consequence should not be a surprise discovered later in the Methods section.
 */
export function provenanceSummary(batch) {
  const b = batch || {};
  if (b.contributesToReview === false) {
    return { tone: 'muted', text: 'Excluded from the reported search methodology.' };
  }
  const db = String(b.sourceDatabase || '').trim();
  const opt = OPTIONS.find((o) => o.key === db);
  const when = toDateInput(b.searchedAt || b.createdAt);
  if (!db) {
    return {
      tone: 'warn',
      text: 'No database recorded — this search cannot be named in the manuscript.',
    };
  }
  return {
    tone: 'ok',
    text: `Reported as ${opt ? opt.label : db}${when ? `, searched ${when}` : ''}.`,
  };
}

export default function BatchSearchProvenance({ batch, canEdit, onSave, busy = false, error = null }) {
  const b = batch || {};
  const [open, setOpen] = useState(false);
  const [db, setDb] = useState(String(b.sourceDatabase || ''));
  const [when, setWhen] = useState(toDateInput(b.searchedAt));
  const [contributes, setContributes] = useState(b.contributesToReview !== false);
  const [note, setNote] = useState(String(b.exclusionNote || ''));

  const summary = provenanceSummary({ ...b, sourceDatabase: db, searchedAt: when || b.searchedAt, contributesToReview: contributes });
  const tone = summary.tone === 'warn' ? C.gold : summary.tone === 'muted' ? C.muted : C.grn;

  const submit = (e) => {
    e.preventDefault();
    onSave({
      sourceDatabase: db,
      // '' clears the recorded date back to "use the upload date", which is a
      // meaningful choice and must be sendable.
      searchedAt: when || '',
      contributesToReview: contributes,
      exclusionNote: contributes ? '' : note,
    });
  };

  return (
    <div data-testid="batch-search-provenance" style={{ marginTop: 10, borderTop: `1px solid ${C.brd}`, paddingTop: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
          color: C.muted, fontWeight: 700, fontFamily: FONT,
        }}>
          Search record
        </span>
        <span data-testid="batch-search-summary" style={{ fontSize: 11.5, color: tone, minWidth: 0, flex: '1 1 240px' }}>
          {summary.text}
        </span>
        {canEdit && (
          <Button variant="ghost" onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title="Record which database this was, when it was searched, and whether it counts toward the review">
            {open ? 'Close' : (b.sourceDatabase ? 'Edit' : 'Add search details')}
          </Button>
        )}
      </div>

      {open && canEdit && (
        <form onSubmit={submit} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 220px', minWidth: 0, fontSize: 11.5, color: C.txt2, fontFamily: FONT }}>
              Database searched
              <select
                data-testid="batch-search-db"
                value={db}
                onChange={(e) => setDb(e.target.value)}
                style={{
                  display: 'block', width: '100%', marginTop: 3, padding: '6px 8px',
                  border: `1px solid ${C.brd}`, borderRadius: 6, background: C.surf,
                  color: C.txt, fontSize: 12.5, fontFamily: FONT,
                }}
              >
                <option value="">— not recorded —</option>
                {OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </label>

            <label style={{ flex: '0 1 190px', fontSize: 11.5, color: C.txt2, fontFamily: FONT }}>
              Date searched
              <input
                data-testid="batch-search-date"
                type="date"
                value={when}
                max={todayInput()}
                onChange={(e) => setWhen(e.target.value)}
                style={{
                  display: 'block', width: '100%', marginTop: 3, padding: '5px 8px',
                  border: `1px solid ${C.brd}`, borderRadius: 6, background: C.surf,
                  color: C.txt, fontSize: 12.5, fontFamily: MONO,
                }}
              />
              <span style={{ display: 'block', fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                When the search was run — not when the file was uploaded.
              </span>
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: C.txt2, fontFamily: FONT }}>
            <input
              data-testid="batch-search-contributes"
              type="checkbox"
              checked={contributes}
              onChange={(e) => setContributes(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              Part of this review’s search methodology
              <span style={{ display: 'block', fontSize: 10.5, color: C.muted }}>
                Uncheck for a test or accidental import. Its records and history are kept —
                it simply stops being reported in the manuscript and PRISMA.
              </span>
            </span>
          </label>

          {!contributes && (
            <label style={{ fontSize: 11.5, color: C.txt2, fontFamily: FONT }}>
              Why (kept in the audit trail)
              <input
                data-testid="batch-search-note"
                type="text"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. test import while configuring the search"
                style={{
                  display: 'block', width: '100%', marginTop: 3, padding: '5px 8px',
                  border: `1px solid ${C.brd}`, borderRadius: 6, background: C.surf,
                  color: C.txt, fontSize: 12.5, fontFamily: FONT,
                }}
              />
            </label>
          )}

          {error && <div role="alert" style={{ fontSize: 11.5, color: C.red }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save search record'}</Button>
            <Button variant="ghost" type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
