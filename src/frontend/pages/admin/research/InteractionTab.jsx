/**
 * research/InteractionTab.jsx — 109.md §§7, 15-19, 36.
 *
 * The keyboard/navigation and Undo/Redo half of the control plane: how reviewers
 * move through citations, how decisions are presented, and how much page-scoped
 * history the app keeps.
 *
 * Two honesty rules are load-bearing here:
 *  - §17: enabling the abstract shortcuts must never mean blanket-blocking a
 *    browser accelerator. The contextual guard chain has NO off switch and is shown
 *    as a read-only guarantee.
 *  - §19/§46: there is no undo/redo telemetry. History is in-memory and
 *    session-scoped by design (108 §16), so this tab does not pretend to show live
 *    stack depths — it points at the client-error feed, which is real capture.
 */
import { C, MONO } from '../../../theme/tokens.js';
import { OPS_SETTINGS } from '../../../../shared/opsSettingsCatalog.js';
import { Badge, NoticeBox, SectionCard, SettingShell } from './primitives.jsx';
import { GovernanceSettings } from './SettingRows.jsx';

const NAV_ENTRIES = OPS_SETTINGS.filter((e) => e.category === 'screening');
const HISTORY_ENTRIES = OPS_SETTINGS.filter((e) => e.category === 'interaction');

/**
 * 109.md §15 — the shipped chords, as documented by the features that own them.
 * This is a DOCUMENTED map, not a live registry read: the shortcut router stores
 * only {id, tier, match, when, run}, so a real inventory (chord string, scope,
 * priority, conflicts) needs declarative descriptors added at each registration
 * site — that lands with the client-wiring change in this release. Rather than
 * synthesise a fake registry, this table states what ships and the card below says
 * plainly what is still missing (§16).
 */
const SHORTCUTS = [
  { chord: 'Ctrl / Cmd + I', action: 'Add the selected abstract text as an INCLUSION keyword', scope: 'Screening — active abstract', flag: 'abstractKeywordShortcuts' },
  { chord: 'Ctrl / Cmd + E', action: 'Add the selected abstract text as an EXCLUSION keyword', scope: 'Screening — active abstract', flag: 'abstractKeywordShortcuts' },
  { chord: 'Ctrl / Cmd + Z', action: 'Undo the last recorded action on this page', scope: 'Project — page-scoped history', flag: 'projectUndoRedo' },
  { chord: 'Ctrl / Cmd + Shift + Z', action: 'Redo', scope: 'Project — page-scoped history', flag: 'projectUndoRedo' },
  { chord: 'Ctrl + Y', action: 'Redo (Windows/Linux alias, off by default)', scope: 'Project — page-scoped history', flag: 'projectUndoRedo' },
  { chord: 'Arrow keys', action: 'Move between citations in the screening list', scope: 'Screening — record list', flag: null },
];

function ShortcutInventory() {
  const th = { padding: '8px 12px', textAlign: 'left', fontSize: 9.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: `1px solid ${C.brd}` };
  const td = { padding: '9px 12px', fontSize: 11.5, color: C.txt2, borderBottom: `1px solid ${C.brd}` };
  return (
    <SectionCard
      testId="rg-shortcuts"
      title="Shortcut map"
      subtitle="The chords these features ship with, and the feature flag that governs each. Per-user screening decision keys (Include / Exclude / Maybe) are a USER preference edited in the reviewer's profile, not an Ops setting."
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Shortcut', 'Action', 'Scope', 'Governed by'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.chord}>
              <td style={{ ...td, fontFamily: MONO, color: C.txt, whiteSpace: 'nowrap' }}>{s.chord}</td>
              <td style={td}>{s.action}</td>
              <td style={td}>{s.scope}</td>
              <td style={td}>{s.flag ? <span style={{ fontFamily: MONO, fontSize: 10.5 }}>{s.flag}</span> : <span style={{ color: C.muted }}>always on</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '12px 16px' }}>
        <NoticeBox tone={C.muted} testId="rg-shortcut-inventory-note">
          <strong>No live conflict detector yet.</strong> The shortcut router records only a match predicate per binding, so a
          real inventory (declared chord, scope, priority, native-override and collision checks — §16) requires declarative
          descriptors at every registration site. That is part of the client-wiring change; this table is the documented map
          in the meantime, not a registry read.
        </NoticeBox>
      </div>
    </SectionCard>
  );
}

function HistoryDiagnostics() {
  return (
    <SectionCard testId="rg-history-diagnostics" title="Undo / Redo diagnostics">
      <SettingShell
        label="Live history stacks"
        description="Undo history is in-memory and page-scoped by design: it lives in the browser tab and is discarded on reload, so there is no server-side stack to inspect and no per-user telemetry to report."
        rationale="109 §46 forbids inventing metrics. What IS captured is the client-error beacon feed — see the Client Errors tab for real failures (stale revision, collaborator conflict, network) raised in the browser."
        badges={<Badge text="no telemetry" color={C.muted} />}
      >
        <span style={{ fontSize: 11.5, color: C.muted, maxWidth: 200, textAlign: 'right', lineHeight: 1.5 }}>Not collected</span>
      </SettingShell>
      <SettingShell
        label="Undo and the audit ledger are separate systems"
        description="Undoing an action appends a NEW immutable ledger record (KEYWORD_UNDO / KEYWORD_REDO); it never rewrites or deletes the original entry. An undo can therefore never make an audit record disappear."
        rationale="Reinforced by 109 §50 and 108 §12. The keyword audit feed on the Keywords tab shows both classes side by side."
        badges={<Badge text="append-only" color={C.purp} />}
        last
      >
        <span style={{ fontSize: 11.5, color: C.muted, maxWidth: 200, textAlign: 'right', lineHeight: 1.5 }}>Architectural guarantee</span>
      </SettingShell>
    </SectionCard>
  );
}

export default function InteractionTab({ gov }) {
  return (
    <div>
      <GovernanceSettings
        testId="rg-navigation-settings"
        title="Screening navigation & decision controls"
        subtitle="How reviewers move through the citation list and how decisions are presented. Presentation settings never change or delete a recorded decision."
        entries={NAV_ENTRIES}
        gov={gov}
      />
      <GovernanceSettings
        testId="rg-history-settings"
        title="Keyboard shortcuts & project history"
        subtitle="Undo/Redo limits and the shortcut behaviour guarantees. The master switches for the shortcut and history features are the Abstract Keyword Shortcuts and Project-Wide Undo / Redo feature flags."
        entries={HISTORY_ENTRIES}
        gov={gov}
      />
      <ShortcutInventory />
      <HistoryDiagnostics />
    </div>
  );
}
