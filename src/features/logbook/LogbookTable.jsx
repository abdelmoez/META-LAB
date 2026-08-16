/**
 * features/logbook/LogbookTable.jsx — 119.md §8 "compact table mode".
 *
 * The SAME events as the timeline, denser and column-aligned for scanning or for
 * checking against an export. Rows expand into the SAME details component, so there
 * is exactly one implementation of "what an event contains".
 *
 * STYLING: LEGACY tokens only. The table scrolls horizontally inside its own
 * container so a narrow workspace never scrolls the page sideways.
 */
import { Fragment } from 'react';
import { C, tagS } from '../../frontend/workspace/ui/styles.js';
import { LogbookEventDetails } from './LogbookEvent.jsx';
import { engineLabel, statusMeta, actorLine, clockTime, dayKey, resourceText } from './logbookFormat.js';

const TH = {
  padding: '7px 10px', background: C.bg, color: C.muted, fontWeight: 700, fontSize: 10,
  letterSpacing: 0.7, textTransform: 'uppercase', textAlign: 'left',
  borderBottom: `1px solid ${C.brd}`, whiteSpace: 'nowrap',
};
const TD = { padding: '7px 10px', fontSize: 12, color: C.txt2, borderBottom: `1px solid ${C.brd}`, verticalAlign: 'top' };

export default function LogbookTable({ events, projectId, expandedId, onToggle, onFocusMember, onFocusEngine }) {
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 8 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }} data-testid="logbook-table">
        <thead>
          <tr>
            <th style={TH}>When</th>
            <th style={TH}>Who</th>
            <th style={TH}>Engine</th>
            <th style={TH}>What happened</th>
            <th style={TH}>Resource</th>
            <th style={TH}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const st = statusMeta(e.status);
            const open = expandedId === e.id;
            return (
              <Fragment key={e.id}>
                <tr data-testid={`logbook-row-${e.id}`}>
                  <td style={{ ...TD, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {dayKey(e.at)}<br />
                    <span style={{ color: C.muted }}>{clockTime(e.at)}</span>
                  </td>
                  <td style={TD}>{actorLine(e)}</td>
                  <td style={{ ...TD, whiteSpace: 'nowrap' }}>{engineLabel(e.engine)}</td>
                  <td style={{ ...TD, color: C.txt }}>
                    <button type="button" data-testid={`logbook-expand-${e.id}`} aria-expanded={open ? 'true' : 'false'}
                      onClick={() => onToggle(e.id)}
                      style={{ background: 'none', border: 'none', padding: 0, color: C.txt, fontSize: 12, fontWeight: 600, textAlign: 'left', cursor: 'pointer' }}>
                      {e.summary}
                    </button>
                  </td>
                  <td style={TD}>{resourceText(e) || '—'}</td>
                  <td style={TD}>
                    {e.status === 'success' ? <span style={{ color: C.muted }}>{st.label}</span> : <span style={tagS(st.tone)}>{st.label}</span>}
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={6} style={{ ...TD, background: C.card2 }}>
                      <LogbookEventDetails event={e} projectId={projectId} onFocusMember={onFocusMember} onFocusEngine={onFocusEngine} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
