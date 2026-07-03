/**
 * GradeCertaintyPanel.jsx — P12 (frontend). The NEW per-outcome, API-driven GRADE
 * workspace shown by GRADETab when the `gradeCertainty` flag is ON. The legacy,
 * primary-outcome-only, blob-based GRADE body stays untouched for the flag-OFF path.
 *
 * What it does, per selected outcome:
 *   - lists every outcome (from GET /outcomes) with its current certainty,
 *   - shows each of the 5 GRADE domains with the auto SUGGESTION + its reason (clearly
 *     labelled "Suggested"), a rating select, a per-domain note, and the data that
 *     informed it (I²/k/CI/Egger/RoB shown inline),
 *   - computes the certainty (High/Moderate/Low/Very low) live from the working ratings
 *     using the SAME pure engine the server uses (computeCertainty),
 *   - Accept-suggestion writes the suggestion INTO the working rating; nothing is saved
 *     until the reviewer clicks Save (human confirmation required),
 *   - Lock/Unlock (owner/leader) disables editing while locked,
 *   - an audit/history view (GET /audit) and a Summary-of-Findings export (json/csv/html).
 *
 * SSR/test-safe: all network access lives in effects (never run under renderToStaticMarkup);
 * the presentational leaves (OutcomeSelector, DomainCard, CertaintyReadout, InformedPanel,
 * AuditList, SofExportLinks) are pure and exported so they can be unit-tested from props.
 * No user-facing "AI" wording anywhere — GRADE is a human judgement aided by data.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { C, btnS, inp, tagS } from '../../ui/styles.js';
import { SectionHeader, InfoBox } from '../../ui/primitives.jsx';
import { alpha as themeAlpha } from '../../../theme/tokens.js';
import { gradeApi } from '../../gradeApi.js';
import { projectPerms } from '../../projectHelpers.js';
import {
  GRADE_DOMAINS, GRADE_RATINGS, computeCertainty,
} from '../../../../research-engine/grade/index.js';

/* ── shared vocabulary derived from the pure engine (single source of truth) ── */
export const CERTAINTY_DOMAINS = GRADE_DOMAINS.filter((d) => d.direction === 'down');
export const RATING_OPTIONS = [
  { v: '', label: 'Not rated', modifier: null },
  { v: 'not_serious', label: GRADE_RATINGS.not_serious.label, modifier: 0 },
  { v: 'serious', label: GRADE_RATINGS.serious.label, modifier: -1 },
  { v: 'very_serious', label: GRADE_RATINGS.very_serious.label, modifier: -2 },
];
const CERT_SYMBOL = { high: '⊕⊕⊕⊕', moderate: '⊕⊕⊕○', low: '⊕⊕○○', very_low: '⊕○○○' };

export function certaintyColor(levelKey) {
  return levelKey === 'high' ? C.grn : levelKey === 'moderate' ? C.yel : C.red;
}

const n2 = (x) => (x == null || isNaN(+x) ? null : (+x).toFixed(2));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function certaintyLabelOf(o) {
  return (o && (o.certaintyLabel || (o.certainty && o.certainty.level))) || '';
}
function certaintyKeyOf(o) {
  const k = o && o.certainty && (o.certainty.levelKey || o.certainty.key);
  if (k) return k;
  const lbl = certaintyLabelOf(o).toLowerCase();
  return lbl.includes('very') ? 'very_low' : lbl.includes('low') ? 'low' : lbl.includes('mod') ? 'moderate' : lbl.includes('high') ? 'high' : '';
}

/**
 * informedForDomain — a short, honest, per-domain line describing the data that informs
 * each GRADE judgement (pure; exported for tests). Never asserts a decision — GRADE stays
 * a reviewer judgement.
 */
export function informedForDomain(key, meta, robSummary) {
  const m = meta || {};
  const rs = robSummary || {};
  switch (key) {
    case 'rob':
      return rs.counts
        ? `Risk of bias: ${rs.counts.low || 0} low · ${rs.counts.some || 0} some · ${rs.counts.high || 0} high across ${rs.assessed || 0} assessed.`
        : 'From the finalised Risk of Bias assessments for this outcome.';
    case 'inconsistency':
      return m.I2 != null ? `I² = ${n2(m.I2)}% across k = ${m.k} studies.` : 'From heterogeneity across the pooled studies.';
    case 'imprecision': {
      const ci = (m.ciLow != null && m.ciHigh != null) ? `95% CI ${n2(m.ciLow)} to ${n2(m.ciHigh)}` : '';
      return [ci, m.k != null ? `k = ${m.k}` : '', m.nParticipants ? `${m.nParticipants} participants` : ''].filter(Boolean).join(' · ')
        || 'From the pooled confidence interval and sample size.';
    }
    case 'publicationBias':
      return (m.egger && m.egger.pval != null)
        ? `Egger's test p = ${m.egger.pval < 0.001 ? '<0.001' : n2(m.egger.pval)} (k = ${m.k}).`
        : `${m.k != null ? `k = ${m.k} studies — ` : ''}small-study effects are hard to assess with few studies.`;
    case 'indirectness':
      return 'How directly the studies match your PICO (population, intervention, comparator, outcome) — a judgement only you can make.';
    default:
      return '';
  }
}

/* ── pure leaves ─────────────────────────────────────────────────────────────── */

/** Outcome list with each outcome's current certainty + confirmed/locked state. */
export function OutcomeSelector({ outcomes, selectedKey, onSelect }) {
  const list = Array.isArray(outcomes) ? outcomes : [];
  if (!list.length) {
    return <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>No outcomes with a pooled effect estimate yet. Add effect sizes in Data Extraction, then grade each outcome here.</div>;
  }
  return (
    <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {list.map((o) => {
        const on = o.outcomeKey === selectedKey;
        const lvlKey = certaintyKeyOf(o);
        const label = certaintyLabelOf(o);
        return (
          <button key={o.outcomeKey} type="button" role="listitem" onClick={() => onSelect && onSelect(o.outcomeKey)} style={{
            textAlign: 'left', cursor: 'pointer', padding: '10px 12px', borderRadius: 8,
            border: `1px solid ${on ? C.acc : C.brd}`, background: on ? themeAlpha(C.acc, '10') : C.card,
            display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'IBM Plex Sans',sans-serif",
          }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: C.txt }}>{o.outcomeLabel || o.outcomeKey}</span>
            {o.locked && <span style={tagS('blue')}>Locked</span>}
            {o.confirmed === false && <span style={tagS('yellow')}>Provisional</span>}
            {label && <span style={{ fontSize: 11, fontWeight: 700, color: certaintyColor(lvlKey), whiteSpace: 'nowrap' }}>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The big certainty readout (High/Moderate/Low/Very low) — computed live from ratings. */
export function CertaintyReadout({ certainty, startLevel, provisional }) {
  const c = certainty || {};
  const levelKey = c.levelKey || '';
  const color = certaintyColor(levelKey);
  const start = startLevel || {};
  const startText = start.label || (Number(start.numeric) === 2 ? 'Low' : 'High');
  return (
    <div style={{ background: C.card, border: `2px solid ${themeAlpha(color, '55')}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 1, marginBottom: 8 }}>CERTAINTY OF EVIDENCE</div>
      <div style={{ fontSize: 30, fontWeight: 800, color, marginBottom: 2 }}>{c.level || '—'}</div>
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color, marginBottom: 10 }}>{CERT_SYMBOL[levelKey] || ''}</div>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
        Started at <strong style={{ color: C.txt }}>{startText}</strong>{start.assumed ? ' (design assumed — confirm the study design)' : ''}.
      </div>
      {provisional && <div style={{ marginTop: 8, fontSize: 11, color: C.yel, lineHeight: 1.5 }}>Provisional — not yet confirmed. Review each domain, then Save to record your judgement.</div>}
    </div>
  );
}

/** One GRADE domain: label, informing data, the Suggested rating + reason, a rating select, a note. */
export function DomainCard({ domain, rating, note, suggestion, informed, locked, onRate, onNote, onAccept }) {
  const sug = suggestion || {};
  const sugVal = sug.suggest || sug.rating || '';
  const sugLabel = sugVal && GRADE_RATINGS[sugVal] ? GRADE_RATINGS[sugVal].label : '';
  const matchesSug = !!sugVal && rating === sugVal;
  return (
    <div style={{ padding: '12px 0', borderBottom: `1px solid ${C.brd}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{domain.label}</div>
          {informed && <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>{informed}</div>}
        </div>
        <label style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Rating</span>
          <select value={rating || ''} disabled={!!locked} onChange={(e) => onRate && onRate(domain.key, e.target.value)}
            style={{ ...inp, width: 152, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.6 : 1 }}>
            {RATING_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}{o.modifier ? ` (${o.modifier})` : ''}</option>)}
          </select>
        </label>
      </div>
      {sugVal && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, lineHeight: 1.5, flexWrap: 'wrap', background: themeAlpha(C.acc, '0a'), border: `1px solid ${themeAlpha(C.acc, '22')}`, borderRadius: 6, padding: '7px 10px' }}>
          <span style={{ flexShrink: 0, fontWeight: 700, color: C.acc }}>Suggested: {sugLabel || '—'}</span>
          <span style={{ flex: 1, minWidth: 160, color: C.muted }}>{sug.reason || ''}</span>
          {!locked && (matchesSug
            ? <span style={{ ...tagS('green'), flexShrink: 0 }}>applied</span>
            : <button type="button" onClick={() => onAccept && onAccept(domain.key, sugVal)} style={{ ...btnS('ghost'), fontSize: 10, padding: '2px 8px', flexShrink: 0 }}>Use suggestion</button>)}
        </div>
      )}
      <input type="text" value={note || ''} disabled={!!locked} placeholder="Reason / footnote for this rating (optional)"
        onChange={(e) => onNote && onNote(domain.key, e.target.value)}
        style={{ ...inp, marginTop: 8, fontSize: 11.5, opacity: locked ? 0.6 : 1 }} />
    </div>
  );
}

/** "What informed this" — the pooled data behind the whole outcome. */
export function InformedPanel({ meta, robSummary }) {
  const m = meta || {};
  const rs = robSummary || {};
  const rows = [];
  if (m.k != null) rows.push(['Studies pooled', `k = ${m.k}`]);
  if (m.nParticipants) rows.push(['Participants', `${m.nParticipants}${m.nParticipantsPartial ? '*' : ''}`]);
  if (m.estimate != null) rows.push(['Pooled estimate', n2(m.estimate)]);
  if (m.ciLow != null && m.ciHigh != null) rows.push(['95% CI', `${n2(m.ciLow)} to ${n2(m.ciHigh)}`]);
  if (m.I2 != null) rows.push(['I²', `${n2(m.I2)}%`]);
  if (m.pval != null) rows.push(['P value', m.pval < 0.001 ? '<0.001' : n2(m.pval)]);
  if (m.egger && m.egger.pval != null) rows.push(["Egger's test", `p = ${m.egger.pval < 0.001 ? '<0.001' : n2(m.egger.pval)}`]);
  if (rs.counts) rows.push(['Risk of bias', `${rs.counts.low || 0} low · ${rs.counts.some || 0} some · ${rs.counts.high || 0} high`]);
  if (!rows.length) return <div style={{ fontSize: 12, color: C.muted }}>No pooled analysis for this outcome yet.</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, borderBottom: `1px solid ${C.brd}`, padding: '4px 0' }}>
          <span style={{ color: C.muted }}>{k}</span>
          <strong style={{ color: C.txt, fontFamily: "'IBM Plex Mono',monospace" }}>{v}</strong>
        </div>
      ))}
    </div>
  );
}

/** Append-only audit history for the whole project. */
export function AuditList({ entries }) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return <div style={{ fontSize: 12, color: C.muted }}>No changes recorded yet.</div>;
  return (
    <div>
      {list.map((e, i) => (
        <div key={e.id || i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: `1px solid ${C.brd}`, fontSize: 11.5 }}>
          <span style={{ ...tagS(e.action === 'LOCK' ? 'blue' : e.action === 'UNLOCK' ? 'yellow' : 'green'), flexShrink: 0 }}>{e.action}</span>
          <span style={{ flex: 1, minWidth: 0, color: C.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.outcomeKey || '—'}</span>
          <span style={{ color: C.muted, flexShrink: 0 }}>{(e.changedBy && e.changedBy.name) || e.changedByName || '—'}</span>
          <span style={{ color: C.dim, fontFamily: "'IBM Plex Mono',monospace", flexShrink: 0 }}>{fmtDate(e.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

/** Download links for the project Summary-of-Findings table (json/csv/html). */
export function SofExportLinks({ pid }) {
  const link = (fmt, label) => (
    <a key={fmt} href={gradeApi.sofUrl(pid, fmt)} download={`summary-of-findings.${fmt}`}
      style={{ ...btnS('ghost'), textDecoration: 'none', fontSize: 11 }}>{label}</a>
  );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: C.muted, marginRight: 4 }}>Summary of Findings:</span>
      {link('csv', 'Download CSV')}
      {link('html', 'Download HTML')}
      {link('json', 'Download JSON')}
    </div>
  );
}

/* ── container ───────────────────────────────────────────────────────────────── */

export function GradeCertaintyPanel({ project, upd }) { // eslint-disable-line no-unused-vars
  const pid = project && project.id;
  const perms = projectPerms(project);
  const canEdit = !!(perms && perms.canEdit && !perms.readOnly);
  const canLock = !!(perms && (perms.isOwner || perms.role === 'leader'));

  const [outcomes, setOutcomes] = useState(null); // null = loading
  const [available, setAvailable] = useState(true);
  const [selKey, setSelKey] = useState(null);
  const [sel, setSel] = useState(null);
  const [working, setWorking] = useState({});
  const [notes, setNotes] = useState({});
  const [genNotes, setGenNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState(null);

  const syncFromDTO = useCallback((dto) => {
    setSel(dto);
    const w = {}; const n = {};
    const dmn = (dto && dto.domains) || {};
    for (const d of CERTAINTY_DOMAINS) {
      const eff = dmn[d.key] || {};
      w[d.key] = eff.rating || '';
      n[d.key] = eff.note || '';
    }
    setWorking(w); setNotes(n);
    setGenNotes((dto && dto.assessment && dto.assessment.notes) || (dto && dto.notes) || '');
    setDirty(false);
  }, []);

  const loadList = useCallback(async (preferKey) => {
    const r = await gradeApi.listOutcomes(pid);
    setAvailable(r.available);
    const list = r.outcomes || [];
    setOutcomes(list);
    if (list.length) {
      const k = (preferKey && list.some((o) => o.outcomeKey === preferKey)) ? preferKey : list[0].outcomeKey;
      setSelKey(k);
    } else { setSelKey(null); setSel(null); }
  }, [pid]);

  useEffect(() => { if (pid) loadList(); }, [pid, loadList]);

  // Sync the working ratings whenever the selected key or the loaded list changes.
  useEffect(() => {
    if (!selKey || !outcomes) return;
    const dto = outcomes.find((o) => o.outcomeKey === selKey);
    if (dto) syncFromDTO(dto);
  }, [selKey, outcomes, syncFromDTO]);

  const replaceOutcome = useCallback((dto) => {
    if (!dto) return;
    setOutcomes((prev) => (prev || []).map((o) => (o.outcomeKey === dto.outcomeKey ? dto : o)));
  }, []);

  const refreshAudit = useCallback(async () => {
    const r = await gradeApi.audit(pid);
    setAudit(r.entries || []);
  }, [pid]);

  // Live certainty from the WORKING ratings, via the same pure engine the server uses.
  const liveCertainty = useMemo(() => {
    if (!sel) return null;
    const startNumeric = (sel.startLevel && Number(sel.startLevel.numeric)) || 4;
    const domains = {};
    for (const k of Object.keys(working)) if (working[k]) domains[k] = working[k];
    try { return computeCertainty({ startLevel: startNumeric, domains }); } catch { return null; }
  }, [sel, working]);

  const locked = !!(sel && sel.locked);

  const onRate = useCallback((k, v) => { if (locked) return; setWorking((w) => ({ ...w, [k]: v })); setDirty(true); }, [locked]);
  const onNote = useCallback((k, v) => { if (locked) return; setNotes((n) => ({ ...n, [k]: v })); setDirty(true); }, [locked]);
  const onAccept = useCallback((k, v) => { if (locked) return; setWorking((w) => ({ ...w, [k]: v })); setDirty(true); }, [locked]);

  const onSave = useCallback(async () => {
    if (!sel || !canEdit || locked) return;
    setBusy(true); setError('');
    try {
      const domains = {};
      for (const d of CERTAINTY_DOMAINS) {
        const r = working[d.key];
        if (r) domains[d.key] = { rating: r, note: notes[d.key] || '' };
      }
      const dto = await gradeApi.saveOutcome(pid, sel.outcomeKey, {
        domains,
        notes: genNotes,
        startLevel: sel.startLevel && sel.startLevel.numeric,
      });
      if (dto) { replaceOutcome(dto); syncFromDTO(dto); }
      if (showAudit) refreshAudit();
    } catch (e) {
      setError(e && e.code === 'GRADE_LOCKED'
        ? 'This outcome was locked before your change could save. Reload to see the latest.'
        : (e && e.message) || 'Could not save this assessment.');
    } finally { setBusy(false); }
  }, [sel, canEdit, locked, working, notes, genNotes, pid, replaceOutcome, syncFromDTO, showAudit, refreshAudit]);

  const onToggleLock = useCallback(async () => {
    if (!sel || !canLock) return;
    setBusy(true); setError('');
    try {
      const dto = sel.locked ? await gradeApi.unlock(pid, sel.outcomeKey) : await gradeApi.lock(pid, sel.outcomeKey);
      if (dto) { replaceOutcome(dto); syncFromDTO(dto); }
      if (showAudit) refreshAudit();
    } catch (e) {
      setError(e && e.code === 'GRADE_NOT_SAVED'
        ? 'Save the GRADE assessment before locking it.'
        : (e && e.message) || 'Could not update the lock.');
    } finally { setBusy(false); }
  }, [sel, canLock, pid, replaceOutcome, syncFromDTO, showAudit, refreshAudit]);

  const onToggleAudit = useCallback(() => {
    setShowAudit((s) => { const ns = !s; if (ns && audit == null) refreshAudit(); return ns; });
  }, [audit, refreshAudit]);

  if (outcomes === null) {
    return <div style={{ padding: 24, color: C.muted, fontSize: 13 }}>Loading GRADE…</div>;
  }

  return (
    <div>
      <SectionHeader icon="award" title="GRADE Certainty of Evidence"
        desc="Rate the certainty of evidence for each outcome. Suggestions are computed from your data — the final judgement is yours, and nothing is recorded until you save." />

      {!available && (
        <InfoBox color={C.yel}>The GRADE service is not reachable right now. Your ratings can’t be loaded or saved until it’s available again.</InfoBox>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Outcome selector */}
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.acc, letterSpacing: 1, marginBottom: 10 }}>OUTCOMES</div>
          <OutcomeSelector outcomes={outcomes} selectedKey={selKey} onSelect={setSelKey} />
        </div>

        {/* Selected outcome workspace */}
        <div>
          {!sel ? (
            <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 18, fontSize: 13, color: C.muted }}>
              Select an outcome to grade its certainty.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, minWidth: 0 }}>{sel.outcomeLabel || sel.outcomeKey}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={onToggleAudit} style={{ ...btnS('ghost'), fontSize: 11 }}>{showAudit ? 'Hide history' : 'History'}</button>
                  {canLock && (
                    <button type="button" onClick={onToggleLock} disabled={busy} style={{ ...btnS(locked ? 'ghost' : 'ghost'), fontSize: 11, opacity: busy ? 0.6 : 1 }}>
                      {locked ? 'Unlock' : 'Lock'}
                    </button>
                  )}
                </div>
              </div>

              {locked && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: C.acc, background: themeAlpha(C.acc, '0c'), border: `1px solid ${themeAlpha(C.acc, '33')}`, borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
                  This assessment is locked{sel.assessment && sel.assessment.lockedBy && sel.assessment.lockedBy.name ? ` by ${sel.assessment.lockedBy.name}` : ''}. Unlock it to make changes.
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
                <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.acc, letterSpacing: 1, marginBottom: 6 }}>RATE EACH DOMAIN</div>
                  {CERTAINTY_DOMAINS.map((d) => (
                    <DomainCard key={d.key} domain={d}
                      rating={working[d.key]} note={notes[d.key]}
                      suggestion={sel.suggestions && sel.suggestions[d.key]}
                      informed={informedForDomain(d.key, sel.meta, sel.robSummary)}
                      locked={locked}
                      onRate={onRate} onNote={onNote} onAccept={onAccept} />
                  ))}

                  <div style={{ marginTop: 12 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>Notes for this outcome</span>
                    <textarea value={genNotes} disabled={locked} rows={3}
                      onChange={(e) => { if (!locked) { setGenNotes(e.target.value); setDirty(true); } }}
                      placeholder="Overall notes on the certainty judgement for this outcome (optional)"
                      style={{ ...inp, fontSize: 12, lineHeight: 1.6, resize: 'vertical', opacity: locked ? 0.6 : 1 }} />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                    <button type="button" onClick={onSave} disabled={!canEdit || locked || busy}
                      style={{ ...btnS('primary'), opacity: (!canEdit || locked || busy) ? 0.5 : 1, cursor: (!canEdit || locked || busy) ? 'not-allowed' : 'pointer' }}>
                      {busy ? 'Saving…' : sel.confirmed ? 'Save changes' : 'Save & confirm'}
                    </button>
                    {dirty && !locked && <span style={{ fontSize: 11, color: C.yel }}>Unsaved changes</span>}
                    {!canEdit && <span style={{ fontSize: 11, color: C.muted }}>You have read-only access to this project.</span>}
                    {error && <span style={{ fontSize: 11.5, color: C.red }}>{error}</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <CertaintyReadout certainty={liveCertainty} startLevel={sel.startLevel} provisional={sel.confirmed === false} />
                  <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 14 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 1, marginBottom: 10 }}>WHAT INFORMED THIS</div>
                    <InformedPanel meta={sel.meta} robSummary={sel.robSummary} />
                  </div>
                </div>
              </div>

              {showAudit && (
                <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.acc, letterSpacing: 1, marginBottom: 10 }}>HISTORY</div>
                  {audit === null ? <div style={{ fontSize: 12, color: C.muted }}>Loading history…</div> : <AuditList entries={audit} />}
                </div>
              )}
            </>
          )}

          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.acc, letterSpacing: 1, marginBottom: 10 }}>SUMMARY OF FINDINGS</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
              Export a GRADE Summary-of-Findings table (one row per outcome, with certainty and explanatory footnotes).
            </div>
            <SofExportLinks pid={pid} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default GradeCertaintyPanel;
