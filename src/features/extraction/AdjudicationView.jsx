/**
 * features/extraction/AdjudicationView.jsx — 66.md (P5). Adjudicator surface for one
 * study: side-by-side extractor A / extractor B per element+arm, driven by GET
 * /compare. Rows where the two agree are collapsed green; conflicts are highlighted
 * amber with the conflict KIND (from the pure `conflicts` engine, surfaced by the
 * server as result.kind). Per row the adjudicator picks Accept A / Accept B / Enter
 * value, with an optional note; "Save resolutions" batches POST /adjudicate. After
 * saving, the consensus column is shown.
 *
 * "Send to meta-analysis" prompts for an effect-size type (constrained to the element
 * types present), then POST /send-to-ma. On 409 HAS_EFFECT_SIZE it shows a confirm
 * dialog with current-vs-proposed and retries with overwrite:true; on success it
 * surfaces any returned warnings.
 */
import { useMemo, useState } from 'react';
import { C, btnS, inp, lbl, themeAlpha, Chip, ErrorBanner, Skeleton, ValueInput, renderValue } from './parts.jsx';

const keyOf = (elementId, armKey) => `${elementId}::${armKey || ''}`;
const DEFAULT_ARMS = ['intervention', 'comparator'];

const KIND_LABEL = {
  numeric_mismatch: 'Numbers differ',
  categorical_mismatch: 'Categories differ',
  text_mismatch: 'Text differs',
  missing_vs_present: 'One side is empty',
  unit_mismatch: 'Units differ',
};

/** Which effect-size types make sense given the elements present. */
function esTypeOptions(elements) {
  const hasDich = elements.some((e) => e.maCompatible === 'dichotomous' || e.type === 'dichotomous_outcome');
  const hasCont = elements.some((e) => e.maCompatible === 'continuous' || e.type === 'continuous_outcome');
  const out = [];
  if (hasDich) out.push(['OR', 'Odds ratio (OR)'], ['RR', 'Risk ratio (RR)'], ['RD', 'Risk difference (RD)']);
  if (hasCont) out.push(['MD', 'Mean difference (MD)'], ['SMD', 'Std. mean difference (SMD)']);
  return out;
}

/** Build the flat row model: one row per element × arm that appears in either side. */
function buildRows(elements, extractors, conflicts) {
  const [a, b] = extractors;
  const conflictByKey = {};
  if (conflicts && Array.isArray(conflicts.conflicts)) {
    for (const c of conflicts.conflicts) conflictByKey[keyOf(c.elementId, c.armKey)] = c.result;
  }
  const rows = [];
  for (const el of elements) {
    const armKeys = el.armScope === 'arm' ? DEFAULT_ARMS : [''];
    // Expand over any arm keys actually present too.
    const present = new Set(armKeys);
    for (const side of [a, b]) {
      if (!side) continue;
      for (const k of Object.keys(side.values || {})) {
        if (k.startsWith(`${el.id}::`)) present.add(k.slice(el.id.length + 2));
      }
    }
    for (const armKey of [...present]) {
      const k = keyOf(el.id, armKey);
      const va = a && a.values ? a.values[k] : undefined;
      const vb = b && b.values ? b.values[k] : undefined;
      const conflict = conflictByKey[k] || null;
      rows.push({ element: el, armKey, key: k, a: va, b: vb, conflict });
    }
  }
  return rows;
}

function SendToMaDialog({ elements, onCancel, onConfirm, busy }) {
  const opts = esTypeOptions(elements);
  const [esType, setEsType] = useState(opts.length ? opts[0][0] : '');
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000099', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 20, width: '100%', maxWidth: 420 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.txt, marginBottom: 6 }}>Send to meta-analysis</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
          The consensus values become this study's effect-size inputs. Choose the effect measure to compute.
        </div>
        <label style={lbl}>Effect measure</label>
        {opts.length === 0 ? (
          <div style={{ fontSize: 12, color: C.yel, lineHeight: 1.5 }}>No MA-compatible (dichotomous / continuous) elements in this form.</div>
        ) : (
          <select value={esType} onChange={(e) => setEsType(e.target.value)} style={{ ...inp, fontSize: 12.5, marginBottom: 16 }}>
            {opts.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={{ ...btnS('ghost'), fontSize: 12 }}>Cancel</button>
          <button onClick={() => onConfirm(esType)} disabled={busy || !esType} style={{ ...btnS('primary'), fontSize: 12, opacity: (busy || !esType) ? 0.6 : 1 }}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function OverwriteDialog({ current, proposed, warnings, onCancel, onConfirm, busy }) {
  const fmt = (o) => o ? Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${v}`).join(', ') : '—';
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000099', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: C.surf, border: `1px solid ${themeAlpha(C.yel, '66')}`, borderRadius: 12, padding: 20, width: '100%', maxWidth: 480 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.yel, marginBottom: 8 }}>⚠ This study already has an effect size</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>Confirm to replace it with the consensus-derived value.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5 }}><span style={{ color: C.dim }}>Current: </span><span style={{ fontFamily: "'IBM Plex Mono',monospace", color: C.txt2 }}>{fmt(current)}</span></div>
          <div style={{ fontSize: 11.5 }}><span style={{ color: C.dim }}>Proposed: </span><span style={{ fontFamily: "'IBM Plex Mono',monospace", color: C.acc }}>{fmt(proposed)}</span></div>
        </div>
        {Array.isArray(warnings) && warnings.length > 0 && (
          <div style={{ fontSize: 11, color: C.yel, marginBottom: 12, lineHeight: 1.5 }}>
            {warnings.map((w, i) => <div key={i}>• {w}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={{ ...btnS('ghost'), fontSize: 12 }}>Keep current</button>
          <button onClick={onConfirm} disabled={busy} style={{ ...btnS('primary'), fontSize: 12, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Replacing…' : 'Replace with consensus'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdjudicationView({
  compare, loading, error, onRetry, onBack, canSend,
  onSaveResolutions, saving, onSendToMa, sendBusy, sendResult,
}) {
  const [resolutions, setResolutions] = useState({}); // key → { choice, value?, note? }
  const [showSend, setShowSend] = useState(false);
  const [overwrite, setOverwrite] = useState(null); // { esType, current, proposed, warnings }

  const elements = compare ? compare.elements || [] : [];
  const extractors = compare ? compare.extractors || [] : [];
  const consensusByKey = useMemo(() => {
    const m = {};
    for (const c of (compare ? compare.consensus || [] : [])) m[keyOf(c.elementId, c.armKey)] = c;
    return m;
  }, [compare]);
  const rows = useMemo(() => (compare ? buildRows(elements, extractors, compare.conflicts) : []), [compare, elements, extractors]);

  const setChoice = (key, patch) => setResolutions((r) => ({ ...r, [key]: { ...(r[key] || {}), ...patch } }));

  const doSave = () => {
    const payload = [];
    for (const row of rows) {
      const r = resolutions[row.key];
      if (!r || !r.choice) continue;
      const item = { elementId: row.element.id, armKey: row.armKey, choice: r.choice };
      if (r.choice === 'custom') item.value = r.value || {};
      if (r.note) item.note = r.note;
      payload.push(item);
    }
    if (payload.length) onSaveResolutions(payload);
  };

  const startSend = () => setShowSend(true);
  const confirmSend = async (esType) => {
    setShowSend(false);
    const res = await onSendToMa({ esType });
    if (res && res.conflict) {
      setOverwrite({ esType, current: res.conflict.current, proposed: res.conflict.proposed, warnings: res.conflict.warnings });
    }
  };
  const confirmOverwrite = async () => {
    const ow = overwrite;
    setOverwrite(null);
    await onSendToMa({ esType: ow.esType, overwrite: true });
  };

  if (loading) {
    return (
      <div>
        <button onClick={onBack} style={{ ...btnS('ghost'), fontSize: 12, marginBottom: 12 }}>← Back to extraction</button>
        <Skeleton w="40%" mb={14} />
        {[0, 1, 2].map((i) => <Skeleton key={i} h={44} mb={10} />)}
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <button onClick={onBack} style={{ ...btnS('ghost'), fontSize: 12, marginBottom: 12 }}>← Back to extraction</button>
        <ErrorBanner message={error} onRetry={onRetry} />
      </div>
    );
  }

  const twoSided = extractors.length >= 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ ...btnS('ghost'), fontSize: 12 }}>← Back to extraction</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {compare && compare.conflicts && (
            <span style={{ fontSize: 11.5, color: C.muted }}>
              {compare.conflicts.agreements}/{compare.conflicts.total} agree
              {compare.conflicts.conflicts.length ? ` · ${compare.conflicts.conflicts.length} to resolve` : ''}
            </span>
          )}
          <button onClick={doSave} disabled={saving} style={{ ...btnS('primary'), fontSize: 12, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save resolutions'}
          </button>
          {canSend && (
            <button onClick={startSend} style={{ ...btnS('ghost'), fontSize: 12 }} title="Write consensus values to this study's meta-analysis inputs">Send to meta-analysis</button>
          )}
        </div>
      </div>

      {sendResult && sendResult.ok && (
        <div style={{ background: themeAlpha(C.grn, '12'), border: `1px solid ${themeAlpha(C.grn, '44')}`, borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 11.5, color: C.txt, lineHeight: 1.5 }}>
          <strong style={{ color: C.grn }}>Sent to meta-analysis.</strong>
          {Array.isArray(sendResult.warnings) && sendResult.warnings.length > 0 && (
            <div style={{ color: C.yel, marginTop: 4 }}>{sendResult.warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>
          )}
        </div>
      )}

      {!twoSided && (
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 12 }}>
          Only one extractor has entered values so far. Adjudication compares two extractors — the second column will appear once a second reviewer submits.
        </div>
      )}

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 2 }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: C.dim }}>No values to compare yet.</div>
        ) : rows.map((row) => {
          const agree = !row.conflict;
          const r = resolutions[row.key] || {};
          const consensus = consensusByKey[row.key];
          return (
            <div key={row.key} style={{
              border: `1px solid ${agree ? themeAlpha(C.grn, '40') : themeAlpha(C.yel, '55')}`,
              background: agree ? themeAlpha(C.grn, '08') : themeAlpha(C.yel, '08'),
              borderRadius: 8, padding: 11,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.txt, flex: 1, minWidth: 0 }}>
                  {row.element.name}{row.armKey ? <span style={{ color: C.dim, fontWeight: 400 }}> · {row.armKey}</span> : null}
                </span>
                {agree ? <Chip tone="green">Agree</Chip> : <Chip tone="amber">{KIND_LABEL[row.conflict.kind] || 'Conflict'}</Chip>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: agree ? 0 : 8 }}>
                <div style={{ border: `1px solid ${C.brd}`, borderRadius: 6, padding: '6px 9px' }}>
                  <div style={{ fontSize: 9.5, color: C.dim, letterSpacing: 0.4, marginBottom: 3 }}>EXTRACTOR A{extractors[0] && extractors[0].userName ? ` · ${extractors[0].userName}` : ''}</div>
                  <div style={{ fontSize: 12.5, fontFamily: "'IBM Plex Mono',monospace", color: C.txt2 }}>{renderValue(row.element, row.a ? row.a.value : null)}</div>
                </div>
                <div style={{ border: `1px solid ${C.brd}`, borderRadius: 6, padding: '6px 9px' }}>
                  <div style={{ fontSize: 9.5, color: C.dim, letterSpacing: 0.4, marginBottom: 3 }}>EXTRACTOR B{extractors[1] && extractors[1].userName ? ` · ${extractors[1].userName}` : ''}</div>
                  <div style={{ fontSize: 12.5, fontFamily: "'IBM Plex Mono',monospace", color: C.txt2 }}>{renderValue(row.element, row.b ? row.b.value : null)}</div>
                </div>
              </div>

              {/* Resolution controls */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {[['a', 'Accept A'], ['b', 'Accept B'], ...(agree ? [['agreement', 'Confirm agreed']] : []), ['custom', 'Enter value']].map(([choice, label]) => (
                  <button key={choice} onClick={() => setChoice(row.key, { choice })} style={{
                    padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    border: `1px solid ${r.choice === choice ? themeAlpha(C.acc, '66') : C.brd}`,
                    background: r.choice === choice ? themeAlpha(C.acc, '18') : 'transparent',
                    color: r.choice === choice ? C.acc : C.muted,
                  }}>{label}</button>
                ))}
                {consensus && <Chip tone="purple" title="Already resolved">consensus set</Chip>}
              </div>

              {r.choice === 'custom' && (
                <div style={{ marginTop: 8 }}>
                  <ValueInput element={row.element} value={r.value || {}} onChange={(val) => setChoice(row.key, { value: val })} />
                </div>
              )}
              {r.choice && (
                <input
                  value={r.note || ''} onChange={(e) => setChoice(row.key, { note: e.target.value })}
                  placeholder="Note (optional) — why this resolution"
                  style={{ ...inp, fontSize: 11.5, marginTop: 8 }}
                />
              )}

              {consensus && (
                <div style={{ marginTop: 8, fontSize: 11, color: C.muted }}>
                  <span style={{ color: C.dim }}>Consensus: </span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: C.acc }}>{renderValue(row.element, consensus.value)}</span>
                  {consensus.resolvedByName ? <span style={{ color: C.dim }}> · {consensus.resolvedByName}</span> : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showSend && (
        <SendToMaDialog elements={elements} busy={sendBusy} onCancel={() => setShowSend(false)} onConfirm={confirmSend} />
      )}
      {overwrite && (
        <OverwriteDialog
          current={overwrite.current} proposed={overwrite.proposed} warnings={overwrite.warnings}
          busy={sendBusy} onCancel={() => setOverwrite(null)} onConfirm={confirmOverwrite}
        />
      )}
    </div>
  );
}
