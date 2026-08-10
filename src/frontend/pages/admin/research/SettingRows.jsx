/**
 * research/SettingRows.jsx — the catalogue-driven control renderer.
 *
 * Every row in the Research Governance section is derived from an entry in
 * src/shared/opsSettingsCatalog.js — the SAME declaration the server coerces
 * against. Nothing about a setting (its label, help text, bounds, enum options,
 * danger level or source) is re-typed here, which is the whole point of 109.md §3:
 * add a catalogue entry and the Ops UI grows a validated control for free.
 *
 * Governance rules enforced by construction:
 *   - `scientific` / `env` entries have no {domain, path}, so `isWritable()` is
 *     false and they render as a VALUE + rationale, never a control (§2, §45).
 *   - `guarded` entries route through a confirmation modal carrying the §41
 *     impact preview (Current → New) and an optional audit reason (§42).
 *   - a knob whose client consumer has not landed yet is labelled, not faked
 *     (see pendingWiring.js).
 */
import { useState } from 'react';
import { C, MONO, alpha } from '../../../theme/tokens.js';
import { DANGER, SETTING_TYPES, isWritable } from '../../../../shared/opsSettingsCatalog.js';
import {
  Badge, ConfirmModal, DangerBadge, DraftInput, SectionCard, SettingShell,
  SourceBadge, Spinner, Toggle, fmtValue, ghostBtn, inputStyle, selectStyle,
} from './primitives.jsx';
import { PENDING_NOTE, isPendingClientWiring } from './pendingWiring.js';

/* ─── Read-only rendering ────────────────────────────────────────────────── */

function RegistryBody({ entry }) {
  const rows = Array.isArray(entry.default) ? entry.default : [];
  const isPairs = rows.length > 0 && typeof rows[0] === 'object';
  return (
    <div style={{ padding: '4px 18px 14px' }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={isPairs ? r.value : `${r}-${i}`}>
              <td style={{ padding: '4px 16px 4px 0', fontSize: 11.5, color: C.txt }}>{isPairs ? r.label : r}</td>
              {isPairs && (
                <td style={{ padding: '4px 0', fontFamily: MONO, fontSize: 10.5, color: C.muted }}>{r.value}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A display-only catalogue entry: the value, where it comes from, and why. */
export function ReadOnlyEntry({ entry, value, last = false, valueLabel }) {
  const shown = valueLabel !== undefined ? valueLabel : fmtValue(value !== undefined ? value : entry.default);
  return (
    <>
      <SettingShell
        testId={`rg-setting-${entry.key}`}
        label={entry.label}
        description={entry.description}
        rationale={entry.rationale || entry.note}
        badges={<><DangerBadge entry={entry} /><SourceBadge entry={entry} /></>}
        last={last && entry.type !== SETTING_TYPES.REGISTRY}
      >
        {entry.type !== SETTING_TYPES.REGISTRY && (
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.txt, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 6, padding: '5px 10px' }}>
            {shown}
          </span>
        )}
      </SettingShell>
      {entry.type === SETTING_TYPES.REGISTRY && <RegistryBody entry={entry} />}
    </>
  );
}

/* ─── Writable controls ──────────────────────────────────────────────────── */

function StringListEditor({ entry, value, disabled, onCommit }) {
  const [draft, setDraft] = useState('');
  const list = Array.isArray(value) ? value : [];
  const add = () => {
    const t = draft.trim().toLowerCase();
    if (!t || list.includes(t)) { setDraft(''); return; }
    setDraft('');
    onCommit([...list, t]);
  };
  return (
    <div style={{ minWidth: 260, maxWidth: 320 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          data-testid={`rg-input-${entry.key}`}
          value={draft}
          disabled={disabled}
          maxLength={entry.maxLength || 64}
          placeholder="add a term…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button data-testid={`rg-add-${entry.key}`} onClick={add} disabled={disabled} style={ghostBtn}>Add</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
        {list.length === 0 && <span style={{ fontSize: 11, color: C.muted }}>Empty — the built-in list applies unchanged.</span>}
        {list.map((t) => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: MONO, color: C.txt2, background: alpha(C.acc, '12'), border: `1px solid ${alpha(C.acc, '30')}`, borderRadius: 12, padding: '2px 8px' }}>
            {t}
            <button
              onClick={() => onCommit(list.filter((x) => x !== t))}
              disabled={disabled}
              aria-label={`Remove ${t}`}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}
            >×</button>
          </span>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>
        Up to {entry.maxItems || 100} terms, {entry.maxLength || 64} characters each. Terms are lower-cased and de-duplicated server-side.
      </div>
    </div>
  );
}

function Control({ entry, value, disabled, busy, onCommit }) {
  if (busy) return <Spinner size={14} />;
  switch (entry.type) {
    case SETTING_TYPES.BOOLEAN:
      return <Toggle checked={value === true} disabled={disabled} onChange={(v) => onCommit(v)} testId={`rg-toggle-${entry.key}`} />;
    case SETTING_TYPES.NUMBER:
      return (
        <DraftInput
          testId={`rg-number-${entry.key}`}
          type="number"
          min={entry.min}
          max={entry.max}
          step={entry.step}
          width={110}
          disabled={disabled}
          value={value}
          onCommit={(raw) => { const n = Number(raw); if (Number.isFinite(n)) onCommit(n); }}
        />
      );
    case SETTING_TYPES.ENUM:
      return (
        <select
          data-testid={`rg-enum-${entry.key}`}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(e) => onCommit(e.target.value)}
          style={{ ...selectStyle, minWidth: 240 }}
        >
          {(entry.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case SETTING_TYPES.STRING_LIST:
      return <StringListEditor entry={entry} value={value} disabled={disabled} onCommit={onCommit} />;
    default:
      return <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>{fmtValue(value)}</span>;
  }
}

/** The plain-language consequence line for the §41 preview. */
function impactLine(entry, from, to) {
  return (
    <>
      <div style={{ marginBottom: 10 }}>{entry.description}</div>
      <div style={{ display: 'flex', gap: 18, fontFamily: MONO, fontSize: 12, marginBottom: 10 }}>
        <span><span style={{ color: C.muted }}>current </span>{fmtValue(from)}</span>
        <span style={{ color: C.muted }}>→</span>
        <span><span style={{ color: C.muted }}>new </span><strong style={{ color: C.txt }}>{fmtValue(to)}</strong></span>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted }}>
        Configuration only. No extraction value, screening decision, keyword or saved analysis is changed by this.
      </div>
    </>
  );
}

/**
 * A card of catalogue rows. Writable `safe` rows save immediately (each write is a
 * single-key read-merge-write on the server); `guarded` rows open the confirmation
 * modal first. Read-only rows render their value + rationale.
 */
export function GovernanceSettings({ entries, gov, title, subtitle, action, testId }) {
  const [pending, setPending] = useState(null); // { entry, value }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const commit = async (entry, value) => {
    if (entry.danger === DANGER.GUARDED) { setReason(''); setPending({ entry, value }); return; }
    await gov.saveEntry(entry, value);
  };

  const confirmGuarded = async () => {
    if (!pending) return;
    setBusy(true);
    try { await gov.saveEntry(pending.entry, pending.value, reason); }
    finally { setBusy(false); setPending(null); setReason(''); }
  };

  return (
    <SectionCard title={title} subtitle={subtitle} action={action} testId={testId}>
      {entries.map((entry, i) => {
        const last = i === entries.length - 1;
        if (!isWritable(entry)) {
          return <ReadOnlyEntry key={entry.key} entry={entry} last={last} />;
        }
        const value = gov.valueOf(entry);
        const def = gov.defaultOf(entry);
        const differs = JSON.stringify(value) !== JSON.stringify(def);
        return (
          <SettingShell
            key={entry.key}
            testId={`rg-setting-${entry.key}`}
            label={entry.label}
            description={entry.description}
            note={isPendingClientWiring(entry.key) ? PENDING_NOTE : undefined}
            badges={
              <>
                <DangerBadge entry={entry} />
                {differs && <Badge text="changed from default" color={C.acc} title={`Default: ${fmtValue(def)}`} />}
              </>
            }
            last={last}
          >
            <Control
              entry={entry}
              value={value}
              disabled={!gov.ready || gov.loadFailed}
              busy={gov.savingKey === entry.key}
              onCommit={(v) => commit(entry, v)}
            />
          </SettingShell>
        );
      })}

      <ConfirmModal
        open={!!pending}
        testId="rg-setting-confirm"
        title={pending ? `Change “${pending.entry.label}”?` : ''}
        confirmLabel="Save change"
        busy={busy}
        reason={reason}
        onReason={setReason}
        onCancel={() => { setPending(null); setReason(''); }}
        onConfirm={confirmGuarded}
      >
        {pending ? impactLine(pending.entry, gov.valueOf(pending.entry), pending.value) : null}
      </ConfirmModal>
    </SectionCard>
  );
}

export default GovernanceSettings;
