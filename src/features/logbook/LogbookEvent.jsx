/**
 * features/logbook/LogbookEvent.jsx — 119.md §8 one Logbook event: the collapsed
 * line, the expandable details, and the before/after change table.
 *
 * STYLING: LEGACY tokens only (C/btnS/tagS + var(--t-*)) — mounts in both shells.
 *
 * The collapsed row answers WHO did WHAT, WHERE and WHEN in one line. Expanding it
 * (§8 "Expandable event details") adds the structured before/after, the affected
 * resource with a link when there is a real destination, the operation/correlation
 * ids an investigation needs, and the undo/redo relationship. Nothing is editable —
 * the Logbook is append-only and this view has no write path at all.
 */
import { C, tagS } from '../../frontend/workspace/ui/styles.js';
import {
  engineLabel, statusMeta, actorLine, actorTypeLabel, clockTime, fullTime, isoTime,
  changePairs, resourceLink, resourceText, VIA_LABELS,
} from './logbookFormat.js';

/** Bridged legacy rows carry less than native ones — say so instead of faking parity. */
const SOURCE_NOTE = {
  screen_audit: 'Recorded by the screening audit log before the Logbook existed.',
  project_event: 'Recorded by the research provenance ledger.',
  extraction_audit: 'Recorded by the extraction audit log before the Logbook existed.',
  rob_audit: 'Recorded by the risk-of-bias audit log before the Logbook existed.',
};

function Meta({ label, value, testid }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11.5, lineHeight: 1.7 }} data-testid={testid}>
      <span style={{ color: C.muted, minWidth: 128 }}>{label}</span>
      <span style={{ color: C.txt2, wordBreak: 'break-word', fontFamily: label === 'Operation id' || label === 'Event id' ? 'monospace' : undefined }}>{value}</span>
    </div>
  );
}

export function LogbookEventDetails({ event, projectId, onFocusMember, onFocusEngine }) {
  const pairs = changePairs(event.before, event.after);
  const link = resourceLink(event, projectId);
  const via = VIA_LABELS[event.via] || '';
  return (
    <div data-testid={`logbook-details-${event.id}`}
      style={{ padding: '10px 0 4px 0', borderTop: `1px dashed ${C.brd}`, marginTop: 8 }}>
      {pairs.length > 0 ? (
        <div style={{ marginBottom: 10 }} data-testid={`logbook-diff-${event.id}`}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 5 }}>What changed</div>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: C.muted, fontWeight: 600, padding: '2px 8px 2px 0', width: '28%' }}>Field</th>
                <th style={{ textAlign: 'left', color: C.muted, fontWeight: 600, padding: '2px 8px 2px 0' }}>Before</th>
                <th style={{ textAlign: 'left', color: C.muted, fontWeight: 600, padding: '2px 0' }}>After</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => (
                <tr key={`${p.key}-${i}`}>
                  <td style={{ color: C.txt2, padding: '2px 8px 2px 0', verticalAlign: 'top' }}>{p.key || 'Value'}</td>
                  <td style={{ color: C.muted, padding: '2px 8px 2px 0', verticalAlign: 'top', wordBreak: 'break-word' }}>{p.from}</td>
                  <td style={{ color: C.txt, padding: '2px 0', verticalAlign: 'top', wordBreak: 'break-word' }}>{p.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
          No before/after values were recorded for this event.
        </div>
      )}

      <Meta label="When" value={`${fullTime(event.at)} · ${isoTime(event.at)} UTC`} testid={`logbook-when-${event.id}`} />
      <Meta label="Who" value={`${actorLine(event)} · ${actorTypeLabel(event.actorType)}`} />
      <Meta label="Engine" value={engineLabel(event.engine)} />
      <Meta label="Action" value={event.action} />
      <Meta label="Outcome" value={statusMeta(event.status).label} />
      {link ? (
        <div style={{ display: 'flex', gap: 8, fontSize: 11.5, lineHeight: 1.7 }}>
          <span style={{ color: C.muted, minWidth: 128 }}>Affected resource</span>
          <a href={link.href} data-testid={`logbook-resource-link-${event.id}`} style={{ color: C.acc, fontWeight: 600 }}>
            {resourceText(event) || link.label} →
          </a>
        </div>
      ) : (
        <Meta label="Affected resource" value={resourceText(event)} />
      )}
      <Meta label="Operation id" value={event.opId} />
      <Meta label="Correlation id" value={event.correlationId} />
      <Meta label="Session" value={event.sessionId} />
      <Meta label="Related event" value={event.relatedEventId} />
      <Meta label="How" value={via ? via.replace(/^via /, '') : ''} />
      <Meta label="Event id" value={event.id} />
      <Meta label="Source" value={SOURCE_NOTE[event.source] || (event.source === 'logbook' ? 'Recorded by the Logbook.' : event.source)} />

      <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
        {event.actorId && onFocusMember && (
          <button type="button" data-testid={`logbook-focus-member-${event.id}`} onClick={() => onFocusMember(event.actorId)}
            style={{ background: 'none', border: 'none', color: C.acc, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
            Show everything this member did
          </button>
        )}
        {event.engine && onFocusEngine && (
          <button type="button" data-testid={`logbook-focus-engine-${event.id}`} onClick={() => onFocusEngine(event.engine)}
            style={{ background: 'none', border: 'none', color: C.acc, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
            Show all {engineLabel(event.engine)} activity
          </button>
        )}
      </div>
    </div>
  );
}

export default function LogbookEventRow({ event, projectId, expanded, onToggle, onFocusMember, onFocusEngine }) {
  const st = statusMeta(event.status);
  const isSystem = event.actorType !== 'user';
  return (
    <li data-testid={`logbook-event-${event.id}`}
      style={{ listStyle: 'none', borderBottom: `1px solid ${C.brd}`, padding: '10px 0' }}>
      <button
        type="button"
        data-testid={`logbook-expand-${event.id}`}
        aria-expanded={expanded ? 'true' : 'false'}
        onClick={onToggle}
        style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 12, alignItems: 'baseline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
      >
        <span style={{ fontSize: 11.5, color: C.muted, fontVariantNumeric: 'tabular-nums', minWidth: 74 }}>{clockTime(event.at)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, color: C.txt, fontWeight: 600 }}>{event.summary}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2 }}>
            {actorLine(event)} · {engineLabel(event.engine)}
            {event.resourceType ? ` · ${resourceText(event)}` : ''}
          </span>
        </span>
        {isSystem && <span style={{ ...tagS('grey'), flex: '0 0 auto' }}>{actorTypeLabel(event.actorType)}</span>}
        {event.status !== 'success' && <span style={{ ...tagS(st.tone), flex: '0 0 auto' }}>{st.label}</span>}
        <span aria-hidden="true" style={{ fontSize: 11, color: C.muted, flex: '0 0 auto' }}>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <LogbookEventDetails event={event} projectId={projectId} onFocusMember={onFocusMember} onFocusEngine={onFocusEngine} />
      )}
    </li>
  );
}
