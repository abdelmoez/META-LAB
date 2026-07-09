/**
 * features/publicSynthesis/PublishPanel.jsx — 68.md (P8). The owner/leader publish
 * workflow, rendered at the END of the Project Control stage. Flag-gated INTERNALLY
 * (renders null when `publicSynthesis` is off) so the mount point stays a one-line,
 * flag-free append. When the caller can't manage the page, it shows a quiet note.
 *
 * Workflow: status card (published vX / not published, last published date/by) →
 * section toggles + public title/summary → actions (Preview · Publish · Unpublish ·
 * Regenerate link · Copy link · Copy embed · Download QR) → embed on/off →
 * collapsible dashboard composer. Publish/Unpublish/Regenerate confirm EXACTLY what
 * changes. Every mutation re-reads status from the server (single source of truth).
 *
 * A published synthesis is PUBLIC: the confirm copy names precisely which sections
 * become visible so the owner never publishes more than they intend.
 */
import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { publicSynthesisFlagEnabled } from './flag.js';
import synthesisApi, { publicUrls, embedSnippet } from './publicSynthesisApi.js';
import { tierErrorMessage } from '../../frontend/entitlements/index.js';
import ComposerPanel from './ComposerPanel.jsx';

const PublicSynthesisPageLazy = lazy(() => import('./PublicSynthesisPage.jsx'));

const SECTION_LABELS = {
  prisma: 'PRISMA flow counts',
  forest: 'Meta-analysis forest plots',
  studies: 'Included studies table',
  rob: 'Risk-of-bias distribution',
  methods: 'Review question & methods (PICO)',
  yearHistogram: 'Publication-year histogram',
};

// theme-token styles (this panel lives inside the authed workspace)
const T = {
  card: { background: 'var(--t-card, #fff)', border: '1px solid var(--t-brd, #e2e4ee)', borderRadius: 8, padding: 16, marginBottom: 14 },
  muted: { color: 'var(--t-muted, #5b6178)' },
  label: { fontSize: 9.5, fontWeight: 700, color: 'var(--t-muted, #5b6178)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 9 },
  input: { width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--t-brd, #e2e4ee)', background: 'var(--t-bg, #fff)', color: 'var(--t-txt, #1a1e2e)' },
};
const btn = (kind) => ({
  fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
  border: kind === 'primary' ? '1px solid var(--t-acc, #6d28d9)' : '1px solid var(--t-brd, #e2e4ee)',
  background: kind === 'primary' ? 'var(--t-acc, #6d28d9)' : (kind === 'danger' ? 'transparent' : 'var(--t-bg, #fff)'),
  color: kind === 'primary' ? '#fff' : (kind === 'danger' ? 'var(--t-red, #dc2626)' : 'var(--t-txt, #1a1e2e)'),
});

export default function PublishPanel({ projectId }) {
  const [flag, setFlag] = useState(null);   // null=checking, false=off, true=on
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');      // action name in-flight
  const [flash, setFlash] = useState('');
  const [copied, setCopied] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind, run }
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState(null);
  const [maOutcomes, setMaOutcomes] = useState([]);
  const [showComposer, setShowComposer] = useState(false);

  // 78.md #3 — the preview modal must NOT be dismissed by an accidental outside/
  // background click (that was destroying the visible synthesis until a refresh).
  // Closing is now DELIBERATE ONLY: the explicit Close button or the Escape key.
  // The Escape listener is scoped to while the modal is open, so it never affects
  // any other surface. previewPayload is retained regardless, so the content is
  // never lost.
  useEffect(() => {
    if (!previewOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  useEffect(() => {
    let alive = true;
    publicSynthesisFlagEnabled().then((v) => { if (alive) setFlag(v); }).catch(() => { if (alive) setFlag(false); });
    return () => { alive = false; };
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const s = await synthesisApi.status(projectId);
      setStatus(s);
      setSettings(s.settings);
      setErr('');
    } catch (e) {
      // Flag off / no access → server 404s; treat as "not available here".
      if (e.status === 404) { setFlag(false); return; }
      setErr(e.message || 'Could not load the publish status.');
    }
  }, [projectId]);

  useEffect(() => { if (flag) loadStatus(); }, [flag, loadStatus]);

  const canManage = !!(status && status.canManage);
  const token = status && status.shareToken;

  const showError = (e) => setErr(tierErrorMessage(e) || e.message || 'Something went wrong.');
  const doFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(''), 1600); };

  const saveSettings = async (nextSettings, embedEnabled) => {
    setSettings(nextSettings);
    setBusy('settings'); setErr('');
    try {
      const s = await synthesisApi.saveSettings(projectId, nextSettings, embedEnabled);
      setStatus(s); setSettings(s.settings); doFlash('Saved');
    } catch (e) { showError(e); loadStatus(); }
    setBusy('');
  };

  const toggleSection = (key) => {
    if (!settings) return;
    saveSettings({ ...settings, sections: { ...settings.sections, [key]: !settings.sections[key] } });
  };
  const setField = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  const commitField = () => { if (settings) saveSettings(settings); };

  const runPublish = async () => {
    setBusy('publish'); setErr(''); setConfirm(null);
    try { const s = await synthesisApi.publish(projectId, settings); setStatus(s); setSettings(s.settings); doFlash('Published'); }
    catch (e) { showError(e); }
    setBusy('');
  };
  const runUnpublish = async () => {
    setBusy('unpublish'); setErr(''); setConfirm(null);
    try { const s = await synthesisApi.unpublish(projectId); setStatus(s); doFlash('Unpublished'); }
    catch (e) { showError(e); }
    setBusy('');
  };
  const runRegenerate = async () => {
    setBusy('regen'); setErr(''); setConfirm(null);
    try { const s = await synthesisApi.regenerateToken(projectId); setStatus(s); doFlash('New link created'); }
    catch (e) { showError(e); }
    setBusy('');
  };

  const openPreview = async () => {
    setBusy('preview'); setErr('');
    try {
      const { payload } = await synthesisApi.preview(projectId);
      setPreviewPayload(payload);
      setMaOutcomes(Array.isArray(payload && payload.ma) ? payload.ma : []);
      setPreviewOpen(true);
    } catch (e) { showError(e); }
    setBusy('');
  };

  const copy = (text, tag) => {
    try {
      navigator.clipboard.writeText(text).then(() => { setCopied(tag); setTimeout(() => setCopied(''), 1600); });
    } catch { /* clipboard unavailable */ }
  };

  // Flag off (or still checking) → render nothing (keeps the mount point clean).
  if (flag === null || flag === false) return null;
  if (!status) {
    return err
      ? <div style={{ ...T.card, ...T.muted, fontSize: 12.5 }}>{err}</div>
      : <div style={{ ...T.card, ...T.muted, fontSize: 12.5 }}>Loading publish options…</div>;
  }
  // Member without manage rights → quiet note (viewing only).
  if (!canManage) {
    return (
      <div style={T.card}>
        <div style={{ ...T.label, color: 'var(--t-acc, #6d28d9)' }}>Public synthesis page</div>
        <div style={{ fontSize: 12.5, ...T.muted, lineHeight: 1.6 }}>
          {status.published
            ? 'This project has a published public synthesis page. Only the owner or a leader can change what is published.'
            : 'No public page has been published for this project yet. Only the owner or a leader can publish one.'}
        </div>
      </div>
    );
  }

  const enabledSections = Object.keys(SECTION_LABELS).filter((k) => settings.sections[k]);

  return (
    <div style={{ ...T.card, borderColor: 'var(--t-acc, #6d28d9)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ ...T.label, color: 'var(--t-acc, #6d28d9)', marginBottom: 0 }}>
          Public synthesis page{flash && <span style={{ marginLeft: 8, color: 'var(--t-grn, #16a34a)', textTransform: 'none', letterSpacing: 0 }}>✓ {flash}</span>}
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
          background: status.published ? 'rgba(22,163,74,0.12)' : 'var(--t-bg, #f7f7fb)',
          color: status.published ? 'var(--t-grn, #16a34a)' : 'var(--t-muted, #5b6178)',
          border: `1px solid ${status.published ? 'rgba(22,163,74,0.4)' : 'var(--t-brd, #e2e4ee)'}`,
        }}>
          {status.published ? `Published${status.currentVersion ? ` · v${status.currentVersion}` : ''}` : 'Not published'}
        </span>
      </div>

      <div style={{ fontSize: 12, ...T.muted, lineHeight: 1.6, margin: '10px 0 4px' }}>
        Publish a read-only, shareable snapshot of this review's synthesis — PRISMA counts, forest plots, included studies,
        risk of bias and more — at a public link. Nothing private (reviewer names, notes, decisions, emails) is ever included.
        {status.published && status.publishedAt && (
          <> Last published {fmtDate(status.publishedAt)}{status.publishedByName ? ` by ${status.publishedByName}` : ''}.</>
        )}
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--t-red, #dc2626)', margin: '8px 0' }}>{err}</div>}

      {/* Public title + summary */}
      <div style={{ display: 'grid', gap: 10, margin: '14px 0' }}>
        <div>
          <div style={T.label}>Public title</div>
          <input style={T.input} value={settings.publicTitle || ''} disabled={busy === 'settings'}
            placeholder="Defaults to the project name"
            onChange={(e) => setField('publicTitle', e.target.value)} onBlur={commitField} />
        </div>
        <div>
          <div style={T.label}>Public summary</div>
          <textarea style={{ ...T.input, minHeight: 72, resize: 'vertical', lineHeight: 1.6 }} value={settings.publicSummary || ''}
            disabled={busy === 'settings'} placeholder="A short plain-language summary shown at the top of the public page."
            onChange={(e) => setField('publicSummary', e.target.value)} onBlur={commitField} />
        </div>
      </div>

      {/* Section toggles */}
      <div style={{ ...T.label, marginTop: 4 }}>Sections shown on the public page</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 8 }}>
        {Object.entries(SECTION_LABELS).map(([key, label]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--t-brd, #e2e4ee)' }}>
            <input type="checkbox" checked={!!settings.sections[key]} disabled={busy === 'settings'} onChange={() => toggleSection(key)} />
            <span style={{ color: 'var(--t-txt, #1a1e2e)' }}>{label}</span>
          </label>
        ))}
      </div>

      {/* Branding + download toggles */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '4px 0 14px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={settings.showBranding !== false} disabled={busy === 'settings'}
            onChange={(e) => saveSettings({ ...settings, showBranding: e.target.checked })} />
          Show &ldquo;Published from PecanRev&rdquo;
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={settings.allowDownload !== false} disabled={busy === 'settings'}
            onChange={(e) => saveSettings({ ...settings, allowDownload: e.target.checked })} />
          Allow visitors to download JSON / CSV
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!status.embedEnabled} disabled={busy === 'settings'}
            onChange={(e) => saveSettings(settings, e.target.checked)} />
          Allow embedding on other sites
        </label>
      </div>

      {/* Primary actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={openPreview} disabled={!!busy} style={btn('ghost')}>
          {busy === 'preview' ? 'Loading…' : 'Preview'}
        </button>
        <button type="button" style={btn('primary')} disabled={!!busy}
          onClick={() => setConfirm({
            kind: 'publish',
            title: status.published ? 'Publish a new version?' : 'Publish this synthesis?',
            body: (
              <>
                This creates a public, read-only snapshot at a shareable link. The following will be visible to anyone with the link:
                <ul style={{ margin: '8px 0 8px 18px', padding: 0 }}>
                  {enabledSections.map((k) => <li key={k}>{SECTION_LABELS[k]}</li>)}
                  {settings.publicTitle && <li>Public title &amp; summary</li>}
                </ul>
                Reviewer names, notes, decisions and emails are never included.
              </>
            ),
            confirmLabel: status.published ? 'Publish new version' : 'Publish',
            run: runPublish,
          })}>
          {busy === 'publish' ? 'Publishing…' : (status.published ? 'Publish new version' : 'Publish')}
        </button>
        {status.published && (
          <button type="button" style={btn('danger')} disabled={!!busy}
            onClick={() => setConfirm({
              kind: 'unpublish', title: 'Unpublish this page?',
              body: 'The public link stops working immediately. The link itself is kept, so you can re-publish later without changing it.',
              confirmLabel: 'Unpublish', run: runUnpublish, danger: true,
            })}>
            {busy === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
          </button>
        )}
      </div>

      {/* Share block (only meaningful once a token exists / published) */}
      {token && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--t-brd, #e2e4ee)' }}>
          <div style={T.label}>Share</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <code style={{ fontSize: 11.5, background: 'var(--t-bg, #f7f7fb)', border: '1px solid var(--t-brd, #e2e4ee)', borderRadius: 6, padding: '6px 9px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {publicUrls.page(token)}
            </code>
            <button type="button" style={btn('ghost')} onClick={() => copy(publicUrls.page(token), 'link')}>{copied === 'link' ? '✓ Copied' : 'Copy link'}</button>
            {status.embedEnabled && (
              <button type="button" style={btn('ghost')} onClick={() => copy(embedSnippet(token), 'embed')}>{copied === 'embed' ? '✓ Copied' : 'Copy embed snippet'}</button>
            )}
            <a href={publicUrls.qr(token)} download="synthesis-qr.png" style={{ ...btn('ghost'), textDecoration: 'none' }}>Download QR</a>
            <button type="button" style={btn('ghost')} disabled={!!busy}
              onClick={() => setConfirm({
                kind: 'regen', title: 'Create a new link?',
                body: 'This replaces the current share link with a new one. The old link (and any embed or QR code using it) will stop working. Anyone you shared it with will need the new link.',
                confirmLabel: 'Create new link', run: runRegenerate, danger: true,
              })}>
              {busy === 'regen' ? 'Working…' : 'Regenerate link'}
            </button>
          </div>
        </div>
      )}

      {/* Composer (collapsible) */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--t-brd, #e2e4ee)' }}>
        <button type="button" onClick={() => setShowComposer((v) => !v)}
          style={{ ...btn('ghost'), width: 'auto' }}>
          {showComposer ? '▾' : '▸'} Customize dashboard layout
        </button>
        {showComposer && (
          <div style={{ marginTop: 12 }}>
            <ComposerPanel projectId={projectId} canManage={canManage} maOutcomes={maOutcomes} />
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      {confirm && (
        <div role="dialog" aria-modal="true" onClick={() => setConfirm(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,30,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--t-card, #fff)', border: '1px solid var(--t-brd, #e2e4ee)', borderRadius: 12, padding: 22, maxWidth: 460, width: '100%', boxShadow: '0 12px 40px rgba(10,10,30,0.28)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: 'var(--t-txt, #1a1e2e)' }}>{confirm.title}</div>
            <div style={{ fontSize: 13, ...T.muted, lineHeight: 1.6, marginBottom: 18 }}>{confirm.body}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConfirm(null)} style={btn('ghost')}>Cancel</button>
              <button type="button" onClick={confirm.run}
                style={confirm.danger ? { ...btn('primary'), background: 'var(--t-red, #dc2626)', borderColor: 'var(--t-red, #dc2626)' } : btn('primary')}>
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal — the real public page component, fed the sanitized payload.
          78.md #3 — the backdrop is NOT a click-away dismiss: an outside/background
          click must never destroy the visible synthesis (the reported bug). Closing
          is deliberate only — the Close button below or the Escape key. */}
      {previewOpen && previewPayload && (
        <div role="dialog" aria-modal="true" aria-label="Public synthesis preview"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,30,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '24px 16px', overflow: 'auto' }}>
          <div
            style={{ background: '#fff', borderRadius: 12, maxWidth: 920, width: '100%', overflow: 'hidden', boxShadow: '0 16px 50px rgba(10,10,30,0.35)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid #e2e4ee', background: '#faf9ff' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4c1d95' }}>Preview — this is what visitors will see</span>
              <button type="button" onClick={() => setPreviewOpen(false)} style={btn('ghost')}>Close</button>
            </div>
            <div style={{ maxHeight: '80vh', overflow: 'auto' }}>
              <Suspense fallback={<div style={{ padding: 24, color: '#5b6178' }}>Loading preview…</div>}>
                <PublicSynthesisPageLazy payload={previewPayload} embed />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return ''; }
}
