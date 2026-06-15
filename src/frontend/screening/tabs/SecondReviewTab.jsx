/**
 * SecondReviewTab.jsx — Final Review (the full-text decision stage; prompt21).
 *
 * User-facing name: "Final Review" (internal stage = `full_text`; the engine name
 * META·SIFT is kept out of the UI). Records that reach inclusion quorum (≥2
 * reviewers include them at title/abstract) surface here for the final inclusion
 * decision. The leader accepts a record to SEND it to Data Extraction, or excludes
 * it with a reason. The page is split into two sub-tabs:
 *   • Not Sent to Data Extraction — pending decisions, accepted-but-not-yet-sent, excluded
 *   • Sent to Data Extraction      — accepted records now in Data Extraction (revertible)
 *
 * Reverting a sent record is scientifically safe: the backend snapshots the study
 * (so extracted data survives), removes it from active extraction, and returns the
 * record to pending — which cleanly updates PRISMA, analysis readiness, and any
 * meta-analysis that used it. A later re-accept restores the snapshot.
 *
 * Props: pid, project, access ({ isLeader, canScreen, ..., blindMode }), refreshProject
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import {
  Loading, ErrorBanner, Button, Badge, DecisionChip, Card, EmptyState, Modal,
} from '../ui/components.jsx';
import { renderHighlighted } from '../ui/highlightRender.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

// ── Helpers ─────────────────────────────────────────────────────────────────
const ABSTRACT_CLAMP = 420; // chars before "show more"

function parseKeywords(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter(Boolean) : [];
  } catch {
    return [];
  }
}

const SECOND_REVIEW_OPTIONS = [
  { value: 'include', label: 'Include', color: C.grn },
  { value: 'exclude', label: 'Exclude', color: C.red },
  { value: 'maybe',   label: 'Maybe',   color: C.ylw },
];

// A record is "in Data Extraction" when accepted AND handed off (or already present).
const isSent = (r) => r.finalStatus === 'accepted' && (r.handoffStatus === 'sent' || r.handoffStatus === 'already_exists');

// finalStatus + handoff → badge styling.
function statusBadge(rec) {
  if (rec.finalStatus === 'accepted') {
    return isSent(rec)
      ? { color: C.grn,  label: 'IN DATA EXTRACTION' }
      : { color: C.gold, label: 'ACCEPTED · NOT YET SENT' };
  }
  if (rec.finalStatus === 'rejected') return { color: C.red, label: 'EXCLUDED' };
  return { color: C.teal, label: 'PENDING REVIEW' };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SecondReviewTab({ pid, project, access = {}, refreshProject, onGoToExtraction }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [subTab, setSubTab] = useState('pending'); // 'pending' (Not Sent) | 'sent'

  const [savingDecision, setSavingDecision] = useState({});
  const [finalizing, setFinalizing]         = useState({});
  const [rowError, setRowError]             = useState({});

  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [revertFor, setRevertFor] = useState(null); // record awaiting revert confirm
  const [restoreFor, setRestoreFor] = useState(null); // re-accept: restore vs start fresh

  const [toast, setToast] = useState(null); // { kind: 'ok'|'info'|'err', text }

  const inclusion = parseKeywords(project?.inclusionKeywords);
  const exclusion = parseKeywords(project?.exclusionKeywords);
  const blindMode = !!(data?.blindMode ?? project?.blindMode ?? access.blindMode);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await screeningApi.listSecondReview(pid);
      setData(d);
    } catch (e) {
      setError(e?.message || 'Failed to load final-review records.');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Mutations ──
  const handleDecision = useCallback(async (rec, decision) => {
    if (savingDecision[rec.id]) return;
    setSavingDecision(prev => ({ ...prev, [rec.id]: decision }));
    setRowError(prev => ({ ...prev, [rec.id]: '' }));
    setData(prev => prev && ({
      ...prev,
      records: prev.records.map(r =>
        r.id === rec.id ? { ...r, myDecision: { ...(r.myDecision || {}), decision } } : r),
    }));
    try {
      await screeningApi.saveDecision(pid, rec.id, { decision, stage: 'full_text' });
    } catch (e) {
      setRowError(prev => ({ ...prev, [rec.id]: e?.message || 'Failed to save decision.' }));
      await load();
    } finally {
      setSavingDecision(prev => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  }, [pid, savingDecision, load]);

  const handleAccept = useCallback(async (rec, restoreSnapshot = true) => {
    if (finalizing[rec.id]) return;
    setRestoreFor(null);
    setFinalizing(prev => ({ ...prev, [rec.id]: true }));
    setRowError(prev => ({ ...prev, [rec.id]: '' }));
    try {
      const resp = await screeningApi.finalizeRecord(pid, rec.id, { decision: 'accept', restoreSnapshot });
      const h = resp?.handoff || {};
      const kind = h.handoffStatus === 'sent' ? 'ok' : h.handoffStatus === 'failed' ? 'err' : 'info';
      const restored = h.restored ? ' (previous extraction restored)' : '';
      setToast({ kind, text: (h.message || (h.handed ? 'Sent to Data Extraction.' : 'Record accepted.')) + restored });
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setRowError(prev => ({ ...prev, [rec.id]: e?.message || 'Failed to accept record.' }));
    } finally {
      setFinalizing(prev => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  }, [pid, finalizing, load, refreshProject]);

  // Re-accepting a record that was previously reverted: offer restore vs start fresh.
  const requestAccept = useCallback((rec) => {
    if (rec.hasRevertSnapshot) setRestoreFor(rec);
    else handleAccept(rec, true);
  }, [handleAccept]);

  // Retry the Data Extraction send for an accepted record (e.g. linked later).
  const handleRetryHandoff = useCallback(async (rec) => {
    if (finalizing[rec.id]) return;
    setFinalizing(prev => ({ ...prev, [rec.id]: true }));
    setRowError(prev => ({ ...prev, [rec.id]: '' }));
    try {
      const resp = await screeningApi.retryHandoff(pid, rec.id);
      const h = resp?.handoff || {};
      const kind = h.handoffStatus === 'sent' ? 'ok' : h.handoffStatus === 'failed' ? 'err' : 'info';
      setToast({ kind, text: h.message || 'Send retried.' });
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setRowError(prev => ({ ...prev, [rec.id]: e?.message || 'Failed to retry send.' }));
    } finally {
      setFinalizing(prev => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  }, [pid, finalizing, load, refreshProject]);

  const submitReject = useCallback(async () => {
    const rec = rejectFor;
    if (!rec) return;
    setFinalizing(prev => ({ ...prev, [rec.id]: true }));
    setRowError(prev => ({ ...prev, [rec.id]: '' }));
    try {
      await screeningApi.finalizeRecord(pid, rec.id, { decision: 'reject', reason: rejectReason.trim() });
      setToast({ kind: 'info', text: 'Record excluded at final review.' });
      setRejectFor(null);
      setRejectReason('');
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setRowError(prev => ({ ...prev, [rec.id]: e?.message || 'Failed to exclude record.' }));
    } finally {
      setFinalizing(prev => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  }, [pid, rejectFor, rejectReason, load, refreshProject]);

  // Revert a sent record back to pending Final Review (removes it from active
  // Data Extraction; the server snapshots it so a re-accept restores it).
  const submitRevert = useCallback(async () => {
    const rec = revertFor;
    if (!rec) return;
    setFinalizing(prev => ({ ...prev, [rec.id]: true }));
    setRowError(prev => ({ ...prev, [rec.id]: '' }));
    try {
      const resp = await screeningApi.revertFinalReview(pid, rec.id);
      const removed = resp?.reverted?.removedFromExtraction;
      setToast({ kind: 'info', text: removed ? 'Returned to Final Review and removed from Data Extraction.' : 'Returned to Final Review.' });
      setRevertFor(null);
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setRowError(prev => ({ ...prev, [rec.id]: e?.message || 'Failed to revert record.' }));
    } finally {
      setFinalizing(prev => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  }, [pid, revertFor, load, refreshProject]);

  // ── Loading / error ──
  if (loading && !data) {
    return (
      <div style={{ animation: 'sift-fade 0.3s ease' }}>
        <Loading label="Loading final-review records…" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <div style={{ animation: 'sift-fade 0.3s ease', paddingTop: 8 }}>
        <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      </div>
    );
  }

  const records = Array.isArray(data?.records) ? data.records : [];
  const sentRecords    = records.filter(isSent);
  const pendingRecords = records.filter(r => !isSent(r));
  const shown = subTab === 'sent' ? sentRecords : pendingRecords;

  // Continue-to-Data-Extraction CTA (prompt22 Task 5). Only shown when embedded in
  // the project workspace (onGoToExtraction is wired); jumps to THIS project's Data
  // Extraction stage — no separate-project handoff. Active once any study is sent.
  const sentCount    = sentRecords.length;
  const undecided    = records.filter(r => !r.finalStatus).length; // pending final decisions

  const SUBTABS = [
    { key: 'pending', label: 'Not Sent to Data Extraction', count: pendingRecords.length },
    { key: 'sent',    label: 'Sent to Data Extraction',     count: sentRecords.length },
  ];

  return (
    <div style={{ fontFamily: FONT, color: C.txt, animation: 'sift-fade 0.3s ease', maxWidth: 1000, position: 'relative' }}>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {error && data && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner onRetry={load}>{error}</ErrorBanner>
        </div>
      )}

      {/* Explainer banner — unified project wording (no separate-app language) */}
      <div style={{
        background: `linear-gradient(180deg, ${C.surf}, ${C.card})`,
        border: `1px solid ${C.brd}`, borderLeft: `3px solid ${C.teal}`,
        borderRadius: 10, padding: '14px 18px', marginBottom: 18,
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }} aria-hidden>📑</span>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, marginBottom: 3 }}>
            Final Review
          </div>
          <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>
            Records that reached inclusion quorum (≥2 reviewers) appear here for the final
            inclusion decision. {access.isLeader
              ? 'Accept studies to send them to Data Extraction, or exclude them with a documented reason.'
              : 'Cast your final-review decision; the project leader makes the final call.'}
          </div>
        </div>
      </div>

      {/* Sub-tabs (Not Sent / Sent) + the Continue-to-Data-Extraction CTA */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SUBTABS.map(t => {
            const on = subTab === t.key;
            return (
              <button key={t.key} onClick={() => setSubTab(t.key)}
                style={{
                  fontFamily: FONT, fontSize: 12.5, fontWeight: on ? 700 : 500,
                  padding: '7px 15px', borderRadius: 9, cursor: 'pointer',
                  background: on ? alpha(C.acc, '16') : 'transparent',
                  color: on ? C.acc : C.txt2, border: `1px solid ${on ? alpha(C.acc, '45') : C.brd2}`,
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                }}>
                {t.label}
                <span style={{
                  fontFamily: MONO, fontSize: 11, fontWeight: 700,
                  background: on ? alpha(C.acc, '22') : C.card, color: on ? C.acc : C.muted,
                  borderRadius: 20, padding: '1px 8px', minWidth: 20, textAlign: 'center',
                }}>{t.count}</span>
              </button>
            );
          })}
        </div>

        {onGoToExtraction && (
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <Button
              variant="primary"
              disabled={sentCount === 0}
              onClick={onGoToExtraction}
              title={sentCount === 0
                ? 'Accept studies in Final Review before continuing to Data Extraction.'
                : 'Open Data Extraction for this project'}>
              Continue to Data Extraction →
            </Button>
            {sentCount === 0 ? (
              <span style={{ fontSize: 11, color: C.muted, maxWidth: 240, textAlign: 'right', lineHeight: 1.4 }}>
                Accept studies in Final Review to continue.
              </span>
            ) : undecided > 0 ? (
              <span style={{ fontSize: 11, color: C.muted, maxWidth: 260, textAlign: 'right', lineHeight: 1.4 }}>
                You can extract sent studies while {undecided} decision{undecided === 1 ? '' : 's'} remain.
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* List */}
      {shown.length === 0 ? (
        <EmptyState
          icon={subTab === 'sent' ? '📤' : '🔎'}
          title={subTab === 'sent' ? 'Nothing sent to Data Extraction yet' : 'No records awaiting final review'}
        >
          {subTab === 'sent'
            ? 'Accepted studies appear here once they are sent to Data Extraction.'
            : 'Records advance here automatically once two reviewers include them in title & abstract screening.'}
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {shown.map(rec => (
            <RecordCard
              key={rec.id}
              pid={pid}
              rec={rec}
              access={access}
              blindMode={blindMode}
              inclusion={inclusion}
              exclusion={exclusion}
              savingDecision={savingDecision[rec.id]}
              finalizing={!!finalizing[rec.id]}
              rowError={rowError[rec.id]}
              onDecision={handleDecision}
              onAccept={requestAccept}
              onRetryHandoff={handleRetryHandoff}
              onRevert={() => setRevertFor(rec)}
              onRejectClick={() => { setRejectFor(rec); setRejectReason(rec.rejectedReason || ''); }}
            />
          ))}
        </div>
      )}

      {/* Exclude reason modal */}
      {rejectFor && (
        <Modal onClose={() => { if (!finalizing[rejectFor.id]) { setRejectFor(null); setRejectReason(''); } }} width={460}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 6 }}>
            Exclude record
          </div>
          <div style={{
            fontSize: 12.5, color: C.txt2, lineHeight: 1.5, marginBottom: 16,
            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {rejectFor.title || <span style={{ fontStyle: 'italic', color: C.muted }}>Untitled record</span>}
          </div>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 600, color: C.txt2,
            marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            Reason for exclusion
          </label>
          <textarea
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="e.g. Wrong population, no full text available, retracted…"
            rows={3}
            autoFocus
            style={{
              width: '100%', background: C.card, border: `1px solid ${C.brd2}`,
              borderRadius: 7, padding: '9px 12px', color: C.txt, fontSize: 13,
              fontFamily: FONT, outline: 'none', resize: 'vertical', lineHeight: 1.5,
            }}
          />
          {rowError[rejectFor.id] && (
            <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>{rowError[rejectFor.id]}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <Button variant="ghost" disabled={!!finalizing[rejectFor.id]}
              onClick={() => { setRejectFor(null); setRejectReason(''); }}>Cancel</Button>
            <Button variant="danger" disabled={!!finalizing[rejectFor.id]}
              onClick={submitReject}>{finalizing[rejectFor.id] ? 'Excluding…' : 'Exclude record'}</Button>
          </div>
        </Modal>
      )}

      {/* Revert (return to Final Review) confirmation — explains downstream effects */}
      {revertFor && (
        <Modal onClose={() => { if (!finalizing[revertFor.id]) setRevertFor(null); }} width={480}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 6 }}>
            Return to Final Review?
          </div>
          <div style={{
            fontSize: 12.5, color: C.txt2, lineHeight: 1.5, marginBottom: 14,
            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {revertFor.title || <span style={{ fontStyle: 'italic', color: C.muted }}>Untitled record</span>}
          </div>
          <div style={{
            fontSize: 12.5, color: C.txt2, lineHeight: 1.65, background: C.surf,
            border: `1px solid ${alpha(C.gold, '40')}`, borderRadius: 8, padding: '11px 13px', marginBottom: 16,
          }}>
            This removes the study from active <strong style={{ color: C.txt }}>Data Extraction</strong> and returns
            the record to pending Final Review. Downstream updates automatically:
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>PRISMA flow counts</li>
              <li>Data Extraction &amp; analysis readiness</li>
              <li>any meta-analysis that used this study may need to be re-run</li>
            </ul>
            <div style={{ marginTop: 8, color: C.grn }}>
              Extracted data is kept and restored automatically if you send it again.
            </div>
          </div>
          {rowError[revertFor.id] && (
            <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{rowError[revertFor.id]}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="ghost" disabled={!!finalizing[revertFor.id]}
              onClick={() => setRevertFor(null)}>Cancel</Button>
            <Button variant="primary" disabled={!!finalizing[revertFor.id]}
              style={{ background: C.gold, color: C.bg }}
              onClick={submitRevert}>{finalizing[revertFor.id] ? 'Reverting…' : 'Return to Final Review'}</Button>
          </div>
        </Modal>
      )}

      {/* Re-accept choice — this record was previously reverted out of extraction */}
      {restoreFor && (
        <Modal onClose={() => { if (!finalizing[restoreFor.id]) setRestoreFor(null); }} width={460}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 6 }}>Send to Data Extraction</div>
          <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, marginBottom: 16 }}>
            This study was previously in Data Extraction and then returned to Final Review.
            Its extracted data was kept. Restore that data, or start a fresh extraction entry?
          </div>
          {rowError[restoreFor.id] && (
            <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{rowError[restoreFor.id]}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="ghost" disabled={!!finalizing[restoreFor.id]}
              onClick={() => handleAccept(restoreFor, false)}>{finalizing[restoreFor.id] ? '…' : 'Start fresh'}</Button>
            <Button variant="primary" disabled={!!finalizing[restoreFor.id]} style={{ background: C.grn, color: C.bg }}
              onClick={() => handleAccept(restoreFor, true)}>{finalizing[restoreFor.id] ? 'Sending…' : 'Restore previous data'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Record card ───────────────────────────────────────────────────────────────
function RecordCard({
  pid, rec, access, blindMode, inclusion, exclusion,
  savingDecision, finalizing, rowError,
  onDecision, onAccept, onRetryHandoff, onRevert, onRejectClick,
}) {
  const [expanded, setExpanded] = useState(false);

  const sb = statusBadge(rec);
  const isPending = !rec.finalStatus;
  const sent = isSent(rec);
  const myDecision = rec.myDecision?.decision || null;

  const abstract = rec.abstract || '';
  const isLong = abstract.length > ABSTRACT_CLAMP;
  const shownAbstract = expanded || !isLong ? abstract : abstract.slice(0, ABSTRACT_CLAMP) + '…';

  const metaParts = [
    !blindMode && rec.authors ? firstAuthor(rec.authors) : null,
    !blindMode && rec.journal ? rec.journal : null,
    rec.year ? String(rec.year) : null,
  ].filter(Boolean);

  return (
    <Card style={{ padding: '18px 20px', borderColor: isPending ? C.brd : C.brd2 }}>
      {/* Header: title + status badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 8 }}>
        <h3 style={{
          fontSize: 15, fontWeight: 600, color: C.txt, margin: 0,
          lineHeight: 1.4, letterSpacing: '-0.01em', flex: 1, minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere',
        }}>
          {rec.title || <span style={{ fontStyle: 'italic', color: C.muted }}>Untitled record</span>}
        </h3>
        <span style={{ flexShrink: 0 }}>
          <Badge color={sb.color} title={`Final status: ${rec.finalStatus || 'pending'}`}>{sb.label}</Badge>
        </span>
      </div>

      {/* Citation meta + links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: rec.finalStatus === 'rejected' && rec.rejectedReason ? 8 : 14 }}>
        {metaParts.length > 0 && (
          <span style={{ fontSize: 12, color: C.txt2, minWidth: 0, overflowWrap: 'anywhere' }}>{metaParts.join(' · ')}</span>
        )}
        {blindMode && (
          <Badge color={C.gold} title="Author / journal hidden during blind screening">Blind</Badge>
        )}
        {rec.doi && (
          <a href={`https://doi.org/${rec.doi}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-all' }}
            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
            DOI: {rec.doi}
          </a>
        )}
        {rec.pmid && (
          <a href={`https://pubmed.ncbi.nlm.nih.gov/${rec.pmid}/`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}
            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
            PMID: {rec.pmid}
          </a>
        )}
      </div>

      {/* Exclusion reason (if excluded) */}
      {rec.finalStatus === 'rejected' && rec.rejectedReason && (
        <div style={{
          fontSize: 12, color: C.red, background: C.redBg,
          border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 7, padding: '8px 12px', marginBottom: 14,
        }}>
          <span style={{ fontWeight: 600 }}>Reason: </span>{rec.rejectedReason}
        </div>
      )}

      {/* Abstract preview */}
      {abstract ? (
        <div style={{
          background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 8,
          padding: '12px 14px', marginBottom: 14,
        }}>
          <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {renderHighlighted(shownAbstract, { inclusion, exclusion, showInclusion: true, showExclusion: true })}
          </div>
          {isLong && (
            <button onClick={() => setExpanded(v => !v)}
              style={{ marginTop: 8, background: 'none', border: 'none', color: C.acc, fontSize: 12, fontFamily: FONT, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              {expanded ? '▲ Show less' : '▼ Show more'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 14 }}>
          No abstract available for this record.
        </div>
      )}

      {/* Full-text PDF — upload + in-browser preview */}
      <div style={{ marginBottom: 14 }}>
        <PdfViewer pid={pid} recordId={rec.id} canManage={access.canScreen || access.isLeader} />
      </div>

      {/* Send status for accepted-but-not-yet-sent records */}
      {rec.finalStatus === 'accepted' && !sent && rec.handoffStatus && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          fontSize: 12, color: rec.handoffStatus === 'failed' ? C.red : C.gold,
          background: rec.handoffStatus === 'failed' ? C.redBg : C.goldBg,
          border: `1px solid ${alpha(rec.handoffStatus === 'failed' ? C.red : C.gold, '40')}`,
          borderRadius: 7, padding: '8px 12px', marginBottom: 14,
        }}>
          <span style={{ fontWeight: 600 }}>
            {rec.handoffStatus === 'pending' ? 'Accepted, not yet in Data Extraction.'
              : `Could not send to Data Extraction${rec.handoffError ? ' — ' + rec.handoffError : ''}.`}
          </span>
          {access.isLeader && (rec.handoffStatus === 'pending' || rec.handoffStatus === 'failed') && (
            <Button variant="ghost" disabled={finalizing} onClick={() => onRetryHandoff(rec)} style={{ fontSize: 11, padding: '4px 12px' }}>
              {finalizing ? 'Retrying…' : 'Retry send'}
            </Button>
          )}
        </div>
      )}

      {/* Reviewer decisions row */}
      <div style={{ marginBottom: isPending && (access.canScreen || access.isLeader) ? 16 : (sent && access.isLeader ? 16 : 0) }}>
        <div style={{
          fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: C.muted, marginBottom: 8,
        }}>
          Reviewer Decisions
        </div>
        {Array.isArray(rec.decisions) && rec.decisions.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {rec.decisions.map((d, i) => (
              <span key={d.reviewerId ?? i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <DecisionChip decision={d.decision} />
                <span style={{ fontSize: 11.5, color: C.txt2 }}>{d.reviewerName || `Reviewer ${i + 1}`}</span>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.muted }}>No final-review decisions yet.</div>
        )}
      </div>

      {/* Pending actions: reviewer decision + leader finalize */}
      {isPending && (
        <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14, marginTop: 14 }}>
          {access.canScreen && (
            <div style={{ marginBottom: access.isLeader ? 14 : 0 }}>
              <div style={{
                fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted, marginBottom: 8,
              }}>
                Your final-review decision
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {SECOND_REVIEW_OPTIONS.map(opt => {
                  const active = myDecision === opt.value;
                  const busy = savingDecision === opt.value;
                  return (
                    <button key={opt.value} type="button" disabled={!!savingDecision}
                      onClick={() => onDecision(rec, opt.value)}
                      style={{
                        fontFamily: FONT, fontSize: 12.5, fontWeight: 600, padding: '7px 16px', borderRadius: 7,
                        cursor: savingDecision ? 'wait' : 'pointer',
                        background: active ? alpha(opt.color, '20') : 'transparent',
                        border: `1px solid ${active ? alpha(opt.color, '80') : C.brd}`,
                        color: active ? opt.color : C.txt2,
                        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                        opacity: savingDecision && !busy ? 0.5 : 1,
                      }}
                      onMouseEnter={e => { if (!active && !savingDecision) { e.currentTarget.style.borderColor = alpha(opt.color, '80'); e.currentTarget.style.color = opt.color; } }}
                      onMouseLeave={e => { if (!active && !savingDecision) { e.currentTarget.style.borderColor = C.brd; e.currentTarget.style.color = C.txt2; } }}>
                      {busy ? 'Saving…' : opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {access.isLeader && (
            <div>
              <div style={{
                fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted, marginBottom: 8,
              }}>
                Final decision (leader)
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button variant="primary" disabled={finalizing} style={{ background: C.grn, color: C.bg }}
                  onClick={() => onAccept(rec)} title="Accept and send to Data Extraction">
                  {finalizing ? 'Finalizing…' : 'Accept → Data Extraction'}
                </Button>
                <Button variant="danger" disabled={finalizing} onClick={onRejectClick}
                  title="Exclude this record at final review">
                  Exclude
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accepted records (sent OR pending send): leader can return to Final Review */}
      {rec.finalStatus === 'accepted' && access.isLeader && (
        <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14, marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.txt2 }}>
            {sent ? 'This study is in Data Extraction.' : 'This study is accepted, not yet in Data Extraction.'}
          </span>
          <Button variant="ghost" disabled={finalizing} onClick={() => onRevert(rec)}
            title="Return to pending Final Review (safe — extracted data is kept and restorable)">
            {finalizing ? 'Working…' : '↩ Return to Final Review'}
          </Button>
        </div>
      )}

      {rowError && (
        <div style={{ fontSize: 12, color: C.red, marginTop: 12 }}>{rowError}</div>
      )}
    </Card>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ toast, onClose }) {
  const tone = toast.kind === 'ok'
    ? { color: C.grn, bg: C.grnBg, brd: C.grn }
    : toast.kind === 'err'
      ? { color: C.red, bg: C.redBg, brd: C.red }
      : { color: C.teal, bg: C.tealBg, brd: C.teal };
  return (
    <div role="status"
      style={{
        position: 'sticky', top: 8, zIndex: 50, marginBottom: 16,
        background: C.surf, border: `1px solid ${alpha(tone.brd, '60')}`, borderLeft: `3px solid ${tone.brd}`,
        borderRadius: 9, padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: `0 8px 30px ${C.shadow}`, animation: 'sift-fade 0.2s ease',
      }}>
      <span style={{ fontSize: 15 }} aria-hidden>
        {toast.kind === 'ok' ? '✓' : toast.kind === 'err' ? '✕' : 'ℹ'}
      </span>
      <span style={{ fontSize: 13, color: tone.color, fontWeight: 500, flex: 1 }}>{toast.text}</span>
      <button onClick={onClose} aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
        onMouseEnter={e => e.currentTarget.style.color = C.txt2}
        onMouseLeave={e => e.currentTarget.style.color = C.muted}>×</button>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function firstAuthor(authors) {
  const s = String(authors || '').trim();
  if (!s) return '';
  const first = s.split(/[,;]/)[0].trim();
  return /[,;]/.test(s) ? `${first} et al.` : first;
}
