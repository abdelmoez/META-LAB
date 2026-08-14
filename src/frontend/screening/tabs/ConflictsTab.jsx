/**
 * ConflictsTab.jsx — resolve reviewer disagreements (records where reviewers chose differently).
 *
 * 116.md §§67-70 (D14) — a conflict is resolved by RE-READING the article, so this
 * tab carries the SAME article context the Title & Abstract workbench does instead
 * of a thinner mini-card:
 *   §67  the shared <RecordArticleCard> (title · authors/journal/year · DOI/PMID ·
 *        source + duplicate badges · abstract · keywords) — one component, no fork;
 *   §68  the COMPLETE abstract with the same PICO keyword highlighting and
 *        structured-heading rendering, never truncated (the per-card fold is
 *        all-or-nothing and starts open);
 *   §69  the same record-keyed <PdfViewer> — the SAME ScreenPdfAttachment the T&A
 *        and Final Review screens use (no second storage, no second upload path),
 *        so the PDF (and whatever it later grows) is reachable from here too;
 *   §70  named reviewer decisions with their exclusion reason / note / quality
 *        rating where present — blind-aware, straight from listConflicts' wire
 *        shape — while the leader's resolve form keeps its exact semantics.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Loading, ErrorBanner, Button, Badge, DecisionChip, Card, EmptyState } from '../ui/components.jsx';
import RecordArticleCard from '../components/RecordArticleCard.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { useRealtime } from '../../hooks/useRealtime.js';

function parseDecisions(json) {
  try {
    const m = JSON.parse(json || '{}');
    return Object.entries(m).map(([reviewerId, decision]) => ({ reviewerId, decision }));
  } catch { return []; }
}

/** Project inclusion/exclusion keyword lists (same parse SecondReviewTab uses). */
function parseKeywords(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter(Boolean) : [];
  } catch { return []; }
}

/**
 * 116.md §70 — the reviewer rows to render. The server now joins the real
 * ScreenDecision rows (names + reasons + notes + ratings, already blinded on the
 * wire for a blinded non-leader). `reviewerDecisions` (the {reviewerId: decision}
 * JSON on the conflict row) stays the fallback so an older/stubbed payload still
 * renders the chips it always did.
 */
export function conflictReviewerRows(conflict, blindMode) {
  const rows = Array.isArray(conflict?.decisions) ? conflict.decisions : [];
  if (rows.length) return rows;
  return parseDecisions(conflict?.reviewerDecisions).map((d, i) => ({
    reviewerId: blindMode ? undefined : d.reviewerId,
    reviewerName: blindMode ? `Reviewer ${i + 1}` : 'Reviewer',
    decision: d.decision,
  }));
}

/** One reviewer's vote plus the context they recorded with it (§70). */
function ReviewerDecisionRow({ row, index }) {
  const name = row.reviewerName || `Reviewer ${index + 1}`;
  const hasDetail = !!(row.exclusionReason || row.notes || row.rating);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200, flex: '1 1 240px',
      background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '9px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DecisionChip decision={row.decision} />
        <span style={{ fontSize: 11.5, color: C.txt2, minWidth: 0, overflowWrap: 'anywhere' }}>{name}</span>
        {row.isMe && <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>YOU</span>}
        {row.isEngine && <Badge color={C.teal}>AUTOMATED</Badge>}
      </div>
      {row.exclusionReason && (
        <div style={{ fontSize: 11.5, color: C.txt2, minWidth: 0, overflowWrap: 'anywhere' }}>
          <span style={{ color: C.muted }}>Exclusion reason: </span>{row.exclusionReason}
        </div>
      )}
      {row.notes && (
        <div style={{ fontSize: 11.5, color: C.txt2, minWidth: 0, overflowWrap: 'anywhere' }}>
          <span style={{ color: C.muted }}>Notes: </span>{row.notes}
        </div>
      )}
      {!!row.rating && (
        <div style={{ fontSize: 11.5, color: C.txt2 }}>
          <span style={{ color: C.muted }}>Quality rating: </span>{'★'.repeat(row.rating)}{'☆'.repeat(Math.max(0, 5 - row.rating))} {row.rating}/5
        </div>
      )}
      {!hasDetail && (
        <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>No reason or note recorded.</div>
      )}
    </div>
  );
}

/**
 * 116.md §69 (r3) — how many conflict cards mount their <PdfViewer> at first paint.
 *
 * The conflicts list is unpaginated BY DESIGN (listConflicts has no take/cursor —
 * "conflicts are unpaginated and few by construction"), and every mounted PdfViewer
 * issues its own `GET …/records/:rid/pdf` from its mount effect whether or not the
 * preview is open. One viewer per card therefore turned "open the Conflicts tab"
 * into one request per unresolved conflict: a dual-independent-screening project
 * with 5,000 records and a normal ~10% disagreement rate fires ~500 of them in a
 * single commit phase (and 500 localStorage writes with them).
 *
 * The fix is DEFERRAL, never removal — §69 keeps every capability on every card
 * (see whether a PDF exists, upload, open, view, annotate). A card mounts its
 * viewer when it is on screen: the first PDF_EAGER_CARDS are on screen the moment
 * the tab opens, so they mount immediately, and the rest mount from an
 * IntersectionObserver as the resolver scrolls — with a screenful of rootMargin
 * head start, so the PDF row is already there by the time the card is readable.
 * No click is introduced, because §69 asks the tab to ANSWER "does a PDF exist?".
 */
export const PDF_EAGER_CARDS = 3;

/** Pure — the conflict ids whose PDF viewer mounts at first paint (§69 r3). */
export function eagerPdfIds(unresolved, limit = PDF_EAGER_CARDS) {
  const out = new Set();
  for (const c of unresolved || []) {
    if (out.size >= Math.max(0, limit)) break;
    if (c && c.id != null) out.add(c.id);
  }
  return out;
}

/**
 * Mount `children` once this slot is (nearly) on screen — see PDF_EAGER_CARDS.
 *
 * `eager` short-circuits the whole thing for the cards that are already visible.
 * Where there is NO IntersectionObserver the effect mounts immediately, i.e. the
 * pre-r3 behaviour: a missing optimisation must never cost a capability. That also
 * makes the deferred branch the SSR-pinnable one (effects do not run under
 * renderToStaticMarkup), which is how the bound is regression-tested without jsdom.
 * Same shape as the landing page's whileInView gate.
 */
function DeferredPdf({ eager, children }) {
  const [shown, setShown] = useState(!!eager);
  const ref = useRef(null);
  useEffect(() => {
    if (shown) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return undefined; }
    const el = ref.current;
    if (!el) { setShown(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  if (shown) return children;
  return (
    <div ref={ref} data-testid="conflict-pdf-deferred"
      style={{ border: `1px solid ${C.brd}`, borderRadius: 10, background: C.card,
        padding: '11px 14px', fontSize: 11.5, color: C.muted, fontFamily: FONT }}>
      PDF loads when this conflict scrolls into view.
    </div>
  );
}

/**
 * One unresolved conflict: full article context (§§67-69) above the reviewer
 * decisions and the leader's resolve form (§70). Exported so the layout can be
 * SSR-pinned without standing up the tab's fetch/realtime machinery.
 */
export function ConflictCard({
  pid, conflict, blindMode, inclusion = [], exclusion = [], access, canResolve,
  expanded = true, onToggleAbstract, form = {}, onFormChange, onResolve, busy = false,
  // 116.md §69 (r3) — true for the cards that are on screen when the tab opens.
  pdfEager = true,
}) {
  const decs = conflictReviewerRows(conflict, blindMode);
  const set = (patch) => onFormChange?.({ ...form, ...patch });
  return (
    <Card style={{ padding: '18px 20px' }}>
      {/* §§67-68 — the SAME article surface the Title & Abstract workbench
          renders, with the complete abstract and its PICO highlighting. */}
      <RecordArticleCard
        record={conflict.record} blindMode={blindMode}
        inclusion={inclusion} exclusion={exclusion}
        showInclusion showExclusion
        collapsible expanded={expanded}
        onToggle={onToggleAbstract}
      />

      {/* §69 — the record-keyed PDF: same ScreenPdfAttachment entity, same viewer,
          same permission bar as Title & Abstract / Final Review. Mounted through
          DeferredPdf so an unpaginated list of conflicts cannot fan out one
          attachment fetch per card the moment the tab opens (§69 r3). */}
      {expanded && conflict.record?.id && (
        <div style={{ margin: '4px 0 16px' }}>
          <DeferredPdf eager={pdfEager}>
            <PdfViewer pid={pid} recordId={conflict.record.id} canManage={access.canScreen || access.isLeader} />
          </DeferredPdf>
        </div>
      )}

      {/* §70 — reviewer decisions WITH the context each reviewer recorded. */}
      <div style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
        Reviewer decisions
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {decs.length === 0
          ? <div style={{ fontSize: 12, color: C.muted }}>No reviewer decisions on record.</div>
          : decs.map((d, i) => <ReviewerDecisionRow key={d.reviewerId ?? i} row={d} index={i} />)}
      </div>

      {canResolve ? (
        <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Final decision</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {['include', 'exclude', 'maybe'].map(d => (
              <button key={d} onClick={() => set({ finalDecision: d })}
                style={{ flex: 1, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, padding: '7px 0', borderRadius: 6,
                  textTransform: 'capitalize', background: form.finalDecision === d ? C.acc2 : C.card, color: form.finalDecision === d ? C.accText : C.txt2,
                  border: `1px solid ${form.finalDecision === d ? C.acc2 : C.brd2}` }}>{d}</button>
            ))}
          </div>
          <input value={form.notes || ''} onChange={e => set({ notes: e.target.value })}
            placeholder="Resolution note (optional)"
            style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd2}`, borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: FONT, outline: 'none', marginBottom: 10 }} />
          {/* Honest about where the note lands: resolving as exclude stores it as
              the record's exclusion reason (resolveConflict → rejectedReason). */}
          {form.finalDecision === 'exclude' && (
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
              Saved as this record's exclusion reason.
            </div>
          )}
          <Button onClick={onResolve} disabled={!form.finalDecision || busy}>
            {busy ? 'Resolving…' : 'Resolve Conflict'}
          </Button>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Awaiting leader resolution.</div>
      )}
    </Card>
  );
}

export default function ConflictsTab({ pid, project, access, refreshProject }) {
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [forms, setForms]       = useState({});  // cid -> { finalDecision, notes }
  const [busy, setBusy]         = useState(null);
  const [flash, setFlash]       = useState('');
  // 116.md §68 — article context starts EXPANDED (parity with T&A); this holds the
  // conflict ids the leader has folded away while working through a long list.
  const [folded, setFolded]     = useState({});
  // The server is the authority on blinding (it strips authors/journal and reviewer
  // identity on the wire); the project prop is only the pre-fetch default.
  const [wireBlind, setWireBlind] = useState(null);
  const blindMode = wireBlind ?? !!project?.blindMode;

  const canResolve = access.isLeader || access.canResolveConflicts;
  const inclusion = parseKeywords(project?.inclusionKeywords);
  const exclusion = parseKeywords(project?.exclusionKeywords);

  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), 4200); return () => clearTimeout(t); }, [flash]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await screeningApi.listConflicts(pid);
      setConflicts(data.conflicts || []);
      if (data.blindMode !== undefined) setWireBlind(!!data.blindMode);
    } catch (e) { setError(e.message || 'Failed to load conflicts'); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  // prompt50 WS3 — refetch when ANY reviewer decision changes or a conflict is
  // resolved elsewhere, so a conflict appears the moment it is created and
  // disappears the moment it is resolved, without a manual reload. Server-side
  // syncConflicts is the single source of truth; this only re-reads it.
  //
  // 116.md §67 (D14) — this used to also subscribe to `conflict.changed`, an event
  // NO server code has ever emitted. Rather than invent a second poke that would
  // fire in lockstep with `decision.saved` (double refetch on the common path),
  // subscribe to the pokes that are actually emitted on every path that can change
  // a conflict row: `decision.saved` (saveDecision → syncConflicts, resolveConflict,
  // eligibility auto-apply) and `eligibility.updated` (the auto-apply undo, which
  // deletes the engine's decision and can therefore clear a conflict).
  useRealtime({
    'decision.saved':      (ev) => { if (!ev || ev.projectId === pid || ev.projectId === undefined) load(); },
    'eligibility.updated': (ev) => { if (!ev || ev.projectId === pid || ev.projectId === undefined) load(); },
  });

  async function resolve(cid) {
    const f = forms[cid] || {};
    if (!f.finalDecision) return;
    setBusy(cid);
    try {
      const resp = await screeningApi.resolveConflict(pid, cid, { finalDecision: f.finalDecision, notes: f.notes || '' });
      setFlash(resp?.promoted
        ? 'Resolved as include — moved to Final Review.'
        : `Conflict resolved as ${f.finalDecision}.`);
      await load();
      // prompt23 Task 4 — the resolver is excluded from their own realtime event, so
      // refresh the project here to update the workflow stepper, overview counts, and
      // (on tab switch) the Title & Abstract list for this user immediately.
      refreshProject?.();
    } catch (e) { setError(e.message || 'Failed to resolve'); }
    finally { setBusy(null); }
  }

  if (loading) return <Loading label="Loading conflicts…" />;

  const unresolved = conflicts.filter(c => !c.resolvedAt);
  const resolved   = conflicts.filter(c => c.resolvedAt);
  // 116.md §69 (r3) — only the cards that are on screen at first paint mount their
  // PDF viewer eagerly; the rest mount on scroll (DeferredPdf).
  const eagerPdf = eagerPdfIds(unresolved);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Conflict Resolution</h2>
        <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>{unresolved.length} unresolved · {resolved.length} resolved</span>
      </div>
      {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}
      {flash && (
        <div style={{ background: C.grnBg, border: `1px solid ${alpha(C.grn, '55')}`, borderLeft: `3px solid ${C.grn}`, borderRadius: 8, padding: '10px 14px', color: C.grn, fontSize: 12.5, marginBottom: 14 }}>
          {flash}
        </div>
      )}

      <p style={{ fontSize: 13, color: C.txt2, marginBottom: 18, lineHeight: 1.6 }}>
        A conflict appears when two or more reviewers record different decisions on the same article.
        {canResolve ? ' As leader you can set the final decision.' : ' Only the project leader can resolve conflicts.'}
      </p>

      {unresolved.length === 0 && resolved.length === 0 && (
        <EmptyState icon="✓" title="No conflicts found">Reviewer decisions are in agreement, or screening hasn't produced disagreements yet.</EmptyState>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {unresolved.map(c => {
          const expanded = !folded[c.id];
          return (
            <ConflictCard
              key={c.id} pid={pid} conflict={c} blindMode={blindMode}
              inclusion={inclusion} exclusion={exclusion}
              access={access} canResolve={canResolve}
              pdfEager={eagerPdf.has(c.id)}
              expanded={expanded}
              onToggleAbstract={() => setFolded(s => ({ ...s, [c.id]: expanded }))}
              form={forms[c.id] || {}}
              onFormChange={(next) => setForms(s => ({ ...s, [c.id]: next }))}
              onResolve={() => resolve(c.id)}
              busy={busy === c.id}
            />
          );
        })}
      </div>

      {resolved.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button onClick={() => setShowResolved(v => !v)}
            style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 13, fontFamily: FONT, padding: 0, marginBottom: 12 }}>
            {showResolved ? '▾' : '▸'} Resolved ({resolved.length})
          </button>
          {showResolved && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {resolved.map(c => (
                <Card key={c.id} style={{ opacity: 0.75 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ fontSize: 13, color: C.txt, minWidth: 0, overflowWrap: 'anywhere' }}>{c.record?.title || 'Untitled'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <DecisionChip decision={c.finalDecision} />
                      <Badge color={c.resolvedBy === 'auto' ? C.teal : C.grn}>{c.resolvedBy === 'auto' ? 'AUTO' : 'RESOLVED'}</Badge>
                    </div>
                  </div>
                  {c.notes && <div style={{ fontSize: 12, color: C.txt2, marginTop: 6, minWidth: 0, overflowWrap: 'anywhere' }}>{c.notes}</div>}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
