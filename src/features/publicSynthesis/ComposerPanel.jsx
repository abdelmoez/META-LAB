/**
 * features/publicSynthesis/ComposerPanel.jsx — 68.md (P8). The dashboard composer,
 * rendered collapsibly INSIDE PublishPanel. Lets an owner/leader arrange the public
 * page's card order: add a card (type from the server whitelist), remove, move
 * up/down, and edit a card's title. Forest cards pick an outcome from the preview
 * payload's ma[] list. Saves via PUT /dashboard.
 *
 * The card `settings` object mirrors the server whitelist (pickCardSettings): only
 * display-only keys survive — this UI only sets `outcome`/`timepoint`/`esType` for
 * forest cards. Styling matches the surrounding workspace (theme tokens).
 */
import { useEffect, useState, useCallback } from 'react';
import synthesisApi from './publicSynthesisApi.js';

const CARD_TYPE_LABELS = {
  summaryText: 'Summary text',
  keyFindings: 'Key findings',
  prisma: 'PRISMA flow',
  forest: 'Forest plot',
  includedStudies: 'Included studies',
  rob: 'Risk of bias',
  yearHistogram: 'Publication years',
  note: 'Note',
};
const CARD_TYPES = Object.keys(CARD_TYPE_LABELS);

let _uid = 0;
const localId = () => `card_${Date.now()}_${_uid++}`;

export default function ComposerPanel({ projectId, canManage, maOutcomes = [] }) {
  const [cards, setCards] = useState(null);   // null = loading
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(false);
  const [newType, setNewType] = useState('summaryText');

  const load = useCallback(async () => {
    try {
      const d = await synthesisApi.getDashboard(projectId);
      setCards(Array.isArray(d.cards) ? d.cards : []);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Could not load the dashboard layout.');
      setCards([]);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const save = async (next) => {
    setBusy(true); setErr('');
    try {
      const d = await synthesisApi.putDashboard(projectId, { cards: next });
      setCards(Array.isArray(d.cards) ? d.cards : next);
      setFlash(true); setTimeout(() => setFlash(false), 1400);
    } catch (e) {
      setErr(e.message || 'Could not save the dashboard layout.');
      // reload to resync with server truth
      load();
    }
    setBusy(false);
  };

  const addCard = () => {
    const c = { id: localId(), type: newType, title: '', settings: {}, order: (cards || []).length };
    save([...(cards || []), c]);
  };
  const removeCard = (id) => save((cards || []).filter((c) => c.id !== id));
  const move = (idx, dir) => {
    const arr = (cards || []).slice();
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    save(arr.map((c, i) => ({ ...c, order: i })));
  };
  const editTitle = (id, title) => setCards((cs) => (cs || []).map((c) => (c.id === id ? { ...c, title } : c)));
  const editOutcome = (id, value) => {
    const [outcome, timepoint, esType] = String(value).split('||');
    setCards((cs) => (cs || []).map((c) => (c.id === id ? { ...c, settings: { ...(c.settings || {}), outcome, timepoint, esType } } : c)));
  };
  const commitTitle = () => save(cards || []);

  const box = { background: 'var(--t-card, #fff)', border: '1px solid var(--t-brd, #e2e4ee)', borderRadius: 8, padding: 12 };
  const muted = { color: 'var(--t-muted, #5b6178)' };

  if (cards === null) return <div style={{ ...muted, fontSize: 12, padding: 8 }}>Loading dashboard layout…</div>;

  return (
    <div>
      <div style={{ fontSize: 11.5, ...muted, lineHeight: 1.5, marginBottom: 10 }}>
        Arrange the public page. Cards render in this order; text/note/key-findings cards show the title you type.
        Forest cards plot the pooled outcome you pick. Sections you toggle off above are hidden regardless of cards.
        {flash && <span style={{ marginLeft: 8, color: 'var(--t-grn, #16a34a)', fontWeight: 700 }}>✓ saved</span>}
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--t-red, #dc2626)', marginBottom: 8 }}>{err}</div>}

      {cards.length === 0 && (
        <div style={{ ...box, ...muted, fontSize: 12.5, marginBottom: 10 }}>
          No custom cards yet. The public page uses its default section order; add cards below to override it.
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        {cards.map((c, idx) => {
          const isText = ['summaryText', 'keyFindings', 'note'].includes(c.type);
          const isForest = c.type === 'forest';
          const val = c.settings ? `${c.settings.outcome || ''}||${c.settings.timepoint || ''}||${c.settings.esType || ''}` : '||||';
          return (
            <div key={c.id} style={{ ...box, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t-acc, #6d28d9)', minWidth: 110 }}>
                {CARD_TYPE_LABELS[c.type] || c.type}
              </span>
              {isText && (
                <input value={c.title || ''} disabled={!canManage || busy}
                  onChange={(e) => editTitle(c.id, e.target.value)} onBlur={commitTitle}
                  placeholder="Card title / text"
                  style={{ flex: 1, minWidth: 140, fontSize: 12.5, padding: '6px 9px', borderRadius: 6, border: '1px solid var(--t-brd, #e2e4ee)', background: 'var(--t-bg, #fff)', color: 'var(--t-txt, #1a1e2e)' }} />
              )}
              {isForest && (
                <select value={val} disabled={!canManage || busy} onChange={(e) => { editOutcome(c.id, e.target.value); }}
                  onBlur={commitTitle}
                  style={{ flex: 1, minWidth: 160, fontSize: 12.5, padding: '6px 9px', borderRadius: 6, border: '1px solid var(--t-brd, #e2e4ee)', background: 'var(--t-bg, #fff)', color: 'var(--t-txt, #1a1e2e)' }}>
                  <option value="||||">First / all outcomes</option>
                  {maOutcomes.map((o, i) => (
                    <option key={i} value={`${o.outcome || ''}||${o.timepoint || ''}||${o.esType || ''}`}>
                      {(o.outcome || 'Outcome')}{o.timepoint ? ` · ${o.timepoint}` : ''}{o.esType ? ` (${o.esType})` : ''}
                    </option>
                  ))}
                </select>
              )}
              {!isText && !isForest && <span style={{ flex: 1, fontSize: 12, ...muted }}>Auto-rendered from your data.</span>}
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" disabled={!canManage || busy || idx === 0} onClick={() => move(idx, -1)} style={iconBtn} title="Move up">▲</button>
                <button type="button" disabled={!canManage || busy || idx === cards.length - 1} onClick={() => move(idx, +1)} style={iconBtn} title="Move down">▼</button>
                <button type="button" disabled={!canManage || busy} onClick={() => removeCard(c.id)} style={{ ...iconBtn, color: 'var(--t-red, #dc2626)' }} title="Remove">✕</button>
              </div>
            </div>
          );
        })}
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={newType} onChange={(e) => setNewType(e.target.value)} disabled={busy}
            style={{ fontSize: 12.5, padding: '6px 9px', borderRadius: 6, border: '1px solid var(--t-brd, #e2e4ee)', background: 'var(--t-bg, #fff)', color: 'var(--t-txt, #1a1e2e)' }}>
            {CARD_TYPES.map((t) => <option key={t} value={t}>{CARD_TYPE_LABELS[t]}</option>)}
          </select>
          <button type="button" onClick={addCard} disabled={busy}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--t-acc, #6d28d9)', background: 'var(--t-acc, #6d28d9)', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            + Add card
          </button>
        </div>
      )}
    </div>
  );
}

const iconBtn = {
  width: 26, height: 26, borderRadius: 6, border: '1px solid var(--t-brd, #e2e4ee)',
  background: 'var(--t-bg, #fff)', color: 'var(--t-txt, #1a1e2e)', cursor: 'pointer', fontSize: 11, lineHeight: 1,
};
