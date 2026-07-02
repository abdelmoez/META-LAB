/**
 * SearchExportPanel.jsx — 69.md. Shown in the Run step. Two reproducibility actions:
 *
 *  1. "Export reproducible search log" — assembles a self-describing JSON document
 *     client-side (buildReproLog): the live strategy + the saved version list + (when
 *     Search & Discovery is enabled and has runs) the per-run provider counts from
 *     pecanSearchApi.listRuns. Downloaded via the shared downloadText helper.
 *
 *  2. "Copy methods paragraph" — GET methods-text, shown in a textarea modal with a
 *     Copy button. A 404 (searchEngine flag off / backend not deployed) degrades to a
 *     quiet hint pointing at Ops rather than an error.
 *
 * Everything is best-effort and flag-tolerant: fetch failures render quiet notes and
 * never break the Run step. Data loading is on click (no effects), so the panel is
 * SSR-safe; its pure leaves (MethodsModal, the reproLog builder) are unit-tested.
 */
import { useState, useCallback } from 'react';
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';
import { downloadText } from '../../frontend/components/exportCore.js';
import { loadSearch } from '../searchBuilder/index.js';
import { searchVersionsApi } from './searchVersionsApi.js';
import { pecanSearchApi } from '../pecanSearch/pecanSearchApi.js';
import { reproLogToJson, reproLogFilename } from './reproLog.js';

/** Pure leaf: the methods-paragraph modal. Exported for unit tests. */
export function MethodsModal({ text, status, onCopy, onClose, copied }) {
  const unavailable = status === 'unavailable';
  return (
    <div role="dialog" aria-label="Methods paragraph" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha('#000000', '55'), padding: 20 }}>
      <div style={{ width: 'min(680px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 18, fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>Methods paragraph</span>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', ...ghost() }}>Close</button>
        </div>
        {unavailable ? (
          <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.7, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 10, padding: '14px 16px' }}>
            The methods paragraph is generated on the server and needs the <strong style={{ color: C.txt }}>Search Builder Engine</strong> enabled in the Ops console. Once it’s on, this will produce a ready-to-paste search-methods paragraph for your manuscript.
          </div>
        ) : (
          <>
            <textarea readOnly value={text} style={{ flex: 1, minHeight: 200, resize: 'vertical', width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 10, border: `1px solid ${C.brd2}`, background: C.surf, color: C.txt, fontSize: 12.5, lineHeight: 1.6, fontFamily: FONT }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <button type="button" onClick={onCopy} style={primary()}>{copied ? 'Copied ✓' : 'Copy'}</button>
              <span style={{ fontSize: 11, color: C.muted }}>Paste into your manuscript’s Methods → Search section.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function SearchExportPanel({ projectId, getLive, pecanEnabled, readOnly }) {
  const [busy, setBusy] = useState('');       // '' | 'log' | 'methods'
  const [note, setNote] = useState('');       // transient status line
  const [modal, setModal] = useState(null);   // { text, status } | null
  const [copied, setCopied] = useState(false);

  const exportLog = useCallback(async () => {
    setBusy('log'); setNote('');
    try {
      // Live strategy (fall back to the saved one), version list, and — when enabled — runs.
      let strategy = (typeof getLive === 'function' && getLive()) || null;
      if (!strategy || !(Array.isArray(strategy.concepts) && strategy.concepts.length)) {
        strategy = (await loadSearch(projectId).catch(() => null)) || strategy || {};
      }
      const v = await searchVersionsApi.list(projectId);
      let runs;
      if (pecanEnabled) {
        try { const r = await pecanSearchApi.listRuns(projectId, { skip: 0, take: 50 }); runs = (r && r.runs) || []; }
        catch { runs = undefined; /* runs are optional in the log */ }
      }
      const json = reproLogToJson({ projectId, strategy: strategy || {}, versions: v.versions, runs });
      downloadText(json, reproLogFilename(projectId), 'application/json;charset=utf-8');
      setNote('Search log downloaded.');
    } catch (e) {
      setNote(`Could not export: ${(e && e.message) || 'error'}`);
    } finally {
      setBusy('');
    }
  }, [projectId, getLive, pecanEnabled]);

  const openMethods = useCallback(async () => {
    setBusy('methods'); setNote(''); setCopied(false);
    const out = await searchVersionsApi.methodsText(projectId);
    setModal(out.available && out.text ? { text: out.text, status: 'ready' } : { text: '', status: 'unavailable' });
    setBusy('');
  }, [projectId]);

  const copyMethods = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && modal && modal.text) {
        await navigator.clipboard.writeText(modal.text);
        setCopied(true);
      }
    } catch { /* clipboard blocked — the textarea is selectable as a fallback */ }
  }, [modal]);

  return (
    <div style={{ marginTop: 16, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 4 }}>Reproducibility</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Export an auditable record of your search, or copy a ready-to-paste methods paragraph for your manuscript.
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={exportLog} disabled={busy === 'log'} style={btn()}>
          {busy === 'log' ? 'Preparing…' : 'Export reproducible search log'}
        </button>
        <button type="button" onClick={openMethods} disabled={busy === 'methods'} style={btn()}>
          {busy === 'methods' ? 'Loading…' : 'Copy methods paragraph'}
        </button>
      </div>
      {note && <div style={{ marginTop: 10, fontSize: 11.5, color: C.txt2 }}>{note}</div>}

      {modal && (
        <MethodsModal
          text={modal.text}
          status={modal.status}
          copied={copied}
          onCopy={copyMethods}
          onClose={() => { setModal(null); setCopied(false); }}
        />
      )}
    </div>
  );
}

function btn() {
  return { padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
}
function primary() {
  return { padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: FONT, background: `linear-gradient(135deg,${C.acc},${C.acc2})`, color: C.accText };
}
function ghost() {
  return { padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, fontFamily: FONT, background: 'transparent', color: C.muted, border: `1px solid ${C.brd2}` };
}
