/**
 * SecondReviewTab.jsx — META·SIFT full-text / second-review stage (Part 3).
 *
 * Records that reach inclusion quorum (≥2 reviewers include them in
 * title/abstract screening) are promoted to the `full_text` stage and surface
 * here. Reviewers cast a second-review decision; the project leader finalizes
 * each record by accepting it (handed off to the linked META·LAB project's Data
 * Extraction) or rejecting it with a reason.
 *
 * Props:
 *   pid            — screening project id
 *   project        — current project object (from the shell); used for keyword
 *                    highlighting + blindMode.
 *   access         — { isLeader, canScreen, ..., blindMode }
 *   refreshProject — () => Promise, re-fetches the shell's project after a mutation
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO } from '../ui/theme.js';
import {
  Loading, ErrorBanner, Button, Badge, DecisionChip, Card, EmptyState, Modal,
} from '../ui/components.jsx';
import { renderHighlighted } from '../ui/highlightRender.jsx';
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

// Map a second-review decision-button value → DecisionChip vocabulary.
const SECOND_REVIEW_OPTIONS = [
  { value: 'include', label: 'Include', color: C.grn },
  { value: 'exclude', label: 'Exclude', color: C.red },
  { value: 'maybe',   label: 'Maybe',   color: C.ylw },
];

// finalStatus → badge styling.
function statusBadge(finalStatus) {
  if (finalStatus === 'accepted') return { color: C.grn, label: 'ACCEPTED → DATA EXTRACTION' };
  if (finalStatus === 'rejected') return { color: C.red, label: 'REJECTED' };
  return { color: C.teal, label: 'PENDING REVIEW' };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SecondReviewTab({ pid, project, access = {}, refreshProject }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Per-record transient state.
  const [savingDecision, setSavingDecision] = useState({}); // { [rid]: decision }
  const [finalizing, setFinalizing]         = useState({}); // { [rid]: bool }
  const [rowError, setRowError]             = useState({}); // { [rid]: string }

  const [rejectFor, setRejectFor] = useState(null); // record being rejected (modal)
  const [rejectReason, setRejectReason] = useState('');

  const [toast, setToast] = useState(null); // { kind: 'ok'|'info'|'err', text }

  // Keyword highlighting (guarded parse).
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
      setError(e?.message || 'Failed to load second-review records.');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  // Auto-dismiss toast.
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
    // Optimistic reflect of myDecision.
    setData(prev => prev && ({
      ...prev,
      records: prev.records.map(r =>
        r.id === rec.id ? { ...r, myDecision: { ...(r.myDecision || {}), decision } } : r),
    }));
    try {
      await screeningApi.saveDecision(pid, rec.id, { decision, stage: 'full_text' });
    } catch (e) {
      setRowError(prev => ({ ...prev, [rec.id]: e?.message || 'Failed to save decision.' }));
      await load(); // re-sync truth from server on failure
    } finally {
      setSavingDecision(prev => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  }, [pid, savingDecision, load]);

  const handleAccept = useCallback(async (rec) => {
    if (finalizing[rec.id]) return;
    setFinalizing(prev => ({ ...prev, [rec.id]: true }));
    setRowError(prev => ({ ...prev, [rec.id]: '' }));
    try {
      const resp = await screeningApi.finalizeRecord(pid, rec.id, { decision: 'accept' });
      const h = resp?.handoff || {};
      if (h.handed === true) {
        setToast({ kind: 'ok', text: 'Sent to META·LAB Data Extraction.' });
      } else if (h.reason === 'no_link' || h.reason === 'link_missing') {
        setToast({ kind: 'info', text: 'Accepted. Link a META·LAB project (Settings) to export it.' });
      } else if (h.reason === 'duplicate') {
        setToast({ kind: 'info', text: 'Accepted — already present in Data Extraction.' });
      } else {
        setToast({ kind: 'ok', text: 'Record accepted.' });
      }
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setRowError(prev => ({ ...prev, [rec.id]: e?.message || 'Failed to accept record.' }));
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
      setToast({ kind: 'info', text: 'Record rejected at full-text review.' });
      setRejectFor(null);
      setRejectReason('');
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setRowError(prev => ({ ...prev, [rec.id]: e?.message || 'Failed to reject record.' }));
    } finally {
      setFinalizing(prev => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  }, [pid, rejectFor, rejectReason, load, refreshProject]);

  // ── Loading / error ──
  if (loading && !data) {
    return (
      <div style={{ animation: 'sift-fade 0.3s ease' }}>
        <Loading label="Loading second-review records…" />
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

  return (
    <div style={{ fontFamily: FONT, color: C.txt, animation: 'sift-fade 0.3s ease', maxWidth: 1000, position: 'relative' }}>

      {/* Transient toast */}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {/* Soft error banner (when a refresh fails but we still have data) */}
      {error && data && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner onRetry={load}>{error}</ErrorBanner>
        </div>
      )}

      {/* Explainer banner */}
      <div style={{
        background: `linear-gradient(180deg, ${C.surf}, ${C.card})`,
        border: `1px solid ${C.brd}`, borderLeft: `3px solid ${C.teal}`,
        borderRadius: 10, padding: '14px 18px', marginBottom: 20,
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }} aria-hidden>📑</span>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, marginBottom: 3 }}>
            Second Review · Full-Text Stage
          </div>
          <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>
            Records that reached inclusion quorum (≥2 reviewers) appear here for full-text / second
            review. {access.isLeader
              ? 'Accept a record to hand it off to META·LAB Data Extraction, or reject it with a reason.'
              : 'Cast your full-text decision; the project leader makes the final call.'}
          </div>
        </div>
        <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <Badge color={C.acc} title="Records currently in second review">
            {records.length} record{records.length === 1 ? '' : 's'}
          </Badge>
        </span>
      </div>

      {/* Empty state */}
      {records.length === 0 ? (
        <EmptyState
          icon="🔎"
          title="No records in second review yet"
        >
          Records advance here automatically once two reviewers include them in title/abstract screening.
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {records.map(rec => (
            <RecordCard
              key={rec.id}
              rec={rec}
              access={access}
              blindMode={blindMode}
              inclusion={inclusion}
              exclusion={exclusion}
              savingDecision={savingDecision[rec.id]}
              finalizing={!!finalizing[rec.id]}
              rowError={rowError[rec.id]}
              onDecision={handleDecision}
              onAccept={handleAccept}
              onRejectClick={() => { setRejectFor(rec); setRejectReason(rec.rejectedReason || ''); }}
            />
          ))}
        </div>
      )}

      {/* Reject reason modal */}
      {rejectFor && (
        <Modal onClose={() => { if (!finalizing[rejectFor.id]) { setRejectFor(null); setRejectReason(''); } }} width={460}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 6 }}>
            Reject record
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
            Reason for rejection
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
            <Button
              variant="ghost"
              disabled={!!finalizing[rejectFor.id]}
              onClick={() => { setRejectFor(null); setRejectReason(''); }}
            >Cancel</Button>
            <Button
              variant="danger"
              disabled={!!finalizing[rejectFor.id]}
              onClick={submitReject}
            >{finalizing[rejectFor.id] ? 'Rejecting…' : 'Reject record'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Record card ───────────────────────────────────────────────────────────────
function RecordCard({
  rec, access, blindMode, inclusion, exclusion,
  savingDecision, finalizing, rowError,
  onDecision, onAccept, onRejectClick,
}) {
  const [expanded, setExpanded] = useState(false);

  const sb = statusBadge(rec.finalStatus);
  const isPending = !rec.finalStatus;
  const myDecision = rec.myDecision?.decision || null;

  const abstract = rec.abstract || '';
  const isLong = abstract.length > ABSTRACT_CLAMP;
  const shownAbstract = expanded || !isLong ? abstract : abstract.slice(0, ABSTRACT_CLAMP) + '…';

  // Citation meta line (authors / journal hidden under blind mode).
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
          lineHeight: 1.4, letterSpacing: '-0.01em', flex: 1, wordBreak: 'break-word',
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
          <span style={{ fontSize: 12, color: C.txt2 }}>{metaParts.join(' · ')}</span>
        )}
        {blindMode && (
          <Badge color={C.gold} title="Author / journal hidden during blind screening">Blind</Badge>
        )}
        {rec.doi && (
          <a href={`https://doi.org/${rec.doi}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}
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

      {/* Rejection reason (if rejected) */}
      {rec.finalStatus === 'rejected' && rec.rejectedReason && (
        <div style={{
          fontSize: 12, color: C.red, background: '#450a0a55',
          border: `1px solid ${C.red}30`, borderRadius: 7, padding: '8px 12px', marginBottom: 14,
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
          <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {renderHighlighted(shownAbstract, { inclusion, exclusion, showInclusion: true, showExclusion: true })}
          </div>
          {isLong && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                marginTop: 8, background: 'none', border: 'none', color: C.acc,
                fontSize: 12, fontFamily: FONT, fontWeight: 600, cursor: 'pointer', padding: 0,
              }}
            >
              {expanded ? '▲ Show less' : '▼ Show more'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 14 }}>
          No abstract available for this record.
        </div>
      )}

      {/* Reviewer decisions row */}
      <div style={{ marginBottom: isPending && (access.canScreen || access.isLeader) ? 16 : 0 }}>
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
          <div style={{ fontSize: 12, color: C.muted }}>No second-review decisions yet.</div>
        )}
      </div>

      {/* Actions */}
      {isPending && (
        <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14, marginTop: 14 }}>
          {/* Reviewer second-review decision */}
          {access.canScreen && (
            <div style={{ marginBottom: access.isLeader ? 14 : 0 }}>
              <div style={{
                fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted, marginBottom: 8,
              }}>
                Your full-text decision
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {SECOND_REVIEW_OPTIONS.map(opt => {
                  const active = myDecision === opt.value;
                  const busy = savingDecision === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={!!savingDecision}
                      onClick={() => onDecision(rec, opt.value)}
                      style={{
                        fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
                        padding: '7px 16px', borderRadius: 7,
                        cursor: savingDecision ? 'wait' : 'pointer',
                        background: active ? opt.color + '20' : 'transparent',
                        border: `1px solid ${active ? opt.color + '80' : C.brd}`,
                        color: active ? opt.color : C.txt2,
                        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                        opacity: savingDecision && !busy ? 0.5 : 1,
                      }}
                      onMouseEnter={e => { if (!active && !savingDecision) { e.currentTarget.style.borderColor = opt.color + '80'; e.currentTarget.style.color = opt.color; } }}
                      onMouseLeave={e => { if (!active && !savingDecision) { e.currentTarget.style.borderColor = C.brd; e.currentTarget.style.color = C.txt2; } }}
                    >
                      {busy ? 'Saving…' : opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Leader finalize actions */}
          {access.isLeader && (
            <div>
              <div style={{
                fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted, marginBottom: 8,
              }}>
                Final decision (leader)
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button
                  variant="primary"
                  disabled={finalizing}
                  style={{ background: C.grn, color: '#06210f' }}
                  onClick={() => onAccept(rec)}
                  title="Accept and hand off to META·LAB Data Extraction"
                >
                  {finalizing ? 'Finalizing…' : 'Accept → META·LAB'}
                </Button>
                <Button
                  variant="danger"
                  disabled={finalizing}
                  onClick={onRejectClick}
                  title="Reject this record at full-text review"
                >
                  Reject
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Row-level error */}
      {rowError && (
        <div style={{ fontSize: 12, color: C.red, marginTop: 12 }}>{rowError}</div>
      )}
    </Card>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ toast, onClose }) {
  const tone = toast.kind === 'ok'
    ? { color: C.grn, bg: '#14532d40', brd: C.grn }
    : toast.kind === 'err'
      ? { color: C.red, bg: '#450a0a55', brd: C.red }
      : { color: C.teal, bg: '#0c233340', brd: C.teal };
  return (
    <div
      role="status"
      style={{
        position: 'sticky', top: 8, zIndex: 50, marginBottom: 16,
        background: C.surf, border: `1px solid ${tone.brd}60`, borderLeft: `3px solid ${tone.brd}`,
        borderRadius: 9, padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 8px 30px rgba(0,0,0,0.4)', animation: 'sift-fade 0.2s ease',
      }}
    >
      <span style={{ fontSize: 15 }} aria-hidden>
        {toast.kind === 'ok' ? '✓' : toast.kind === 'err' ? '✕' : 'ℹ'}
      </span>
      <span style={{ fontSize: 13, color: tone.color, fontWeight: 500, flex: 1 }}>{toast.text}</span>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
        onMouseEnter={e => e.currentTarget.style.color = C.txt2}
        onMouseLeave={e => e.currentTarget.style.color = C.muted}
      >×</button>
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
