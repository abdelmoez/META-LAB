/**
 * ProjectLanding.jsx — premium post-login project command center (prompt11).
 *
 * Route: /app  (the deterministic-by-id workspace lives at /app/project/:id).
 *
 * Lists every META·LAB project the signed-in user can touch — owned and shared
 * through a workspace membership — from GET /api/projects, annotated with role,
 * linked-META·SIFT status, study/record/member counts and archive state. The
 * page lets the user search / filter / sort / triage and act safely by role
 * (open, archive, leave, delete, create, open META·SIFT) without ever writing a
 * project blob (lifecycle goes through dedicated endpoints).
 *
 * Self-contained: KPI tiles, control bar, card + table browser, action menu and
 * the Create / Archive / Delete / Leave modals are all co-located below. Theme
 * comes entirely from ../theme/tokens.js (never hex-concat — always alpha()).
 * All motion is gated on prefers-reduced-motion.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api-client/apiClient.js';
import { screeningApi } from '../screening/api-client/screeningApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import UserMenu from '../components/UserMenu.jsx';
import NotificationsBell from '../components/NotificationsBell.jsx';
import { Icon } from '../components/icons.jsx';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import {
  ROLE_LABEL, ROLE_COLOR, STATUS_META, TAG_COLORS,
  statusOf, roleOf, isOwnerOf, canEditOf,
  relTime, progressOf, FILTERS, SORTS, ROLE_ORDER,
} from './projectLanding.helpers.js';

/* ════════════════════════════════════════════════════════════════════════
   Motion + count-up primitives (reduced-motion aware)
   ════════════════════════════════════════════════════════════════════════ */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); }
    catch { return undefined; }
    const onChange = () => setReduced(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

/** Eased count-up to `target`; snaps instantly when reduced motion is on. */
function useCountUp(target, reduced, duration = 620) {
  const [val, setVal] = useState(reduced ? target : 0);
  const fromRef = useRef(reduced ? target : 0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (reduced) { setVal(target); fromRef.current = target; return undefined; }
    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) { setVal(target); return undefined; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setVal(Math.round(from + delta * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, reduced, duration]);
  return val;
}

/* ════════════════════════════════════════════════════════════════════════
   Recently-opened persistence (localStorage, dedupe-by-id, newest-first, cap 6)
   ════════════════════════════════════════════════════════════════════════ */

const RECENTS_KEY = 'metalab.recentProjects';
const RECENTS_CAP = 6;

function readRecents() {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Keep only well-formed rows; trust order (already newest-first on write).
    return arr.filter(r => r && typeof r.id === 'string').slice(0, RECENTS_CAP);
  } catch { return []; }
}

function writeRecent(project) {
  try {
    const id = project && project.id;
    if (!id) return readRecents();
    const entry = { id: String(id), name: project.name || 'Untitled project', ts: Date.now() };
    const next = [entry, ...readRecents().filter(r => r.id !== entry.id)].slice(0, RECENTS_CAP);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    return next;
  } catch { return readRecents(); }
}

/* ════════════════════════════════════════════════════════════════════════
   Small styled atoms
   ════════════════════════════════════════════════════════════════════════ */

// TAG_COLORS imported from projectLanding.helpers.js

function Pill({ variant = 'default', children, style }) {
  const col = TAG_COLORS[variant] || C.muted;
  const isDefault = variant === 'default';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 10px', borderRadius: 99, fontSize: 10, fontWeight: 600,
      letterSpacing: 0.3, lineHeight: 1.5, whiteSpace: 'nowrap',
      background: isDefault ? C.card2 : alpha(col, '14'),
      color: isDefault ? C.muted : col,
      border: `1px solid ${isDefault ? C.brd : alpha(col, '30')}`,
      ...style,
    }}>{children}</span>
  );
}

function Btn({ variant = 'default', children, style, ...rest }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    fontFamily: FONT, cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'background 0.15s ease, border-color 0.15s ease, transform 0.12s ease',
    border: '1px solid transparent',
  };
  const variants = {
    primary: {
      background: `linear-gradient(145deg, ${C.acc}, ${C.acc2})`,
      color: C.accText, boxShadow: `0 2px 12px ${alpha(C.acc2, '40')}`,
    },
    ghost:   { background: 'transparent', color: C.txt2, border: `1px solid ${C.brd2}` },
    danger:  { background: alpha(C.red, '10'), color: C.red, border: `1px solid ${alpha(C.red, '30')}` },
    default: { background: C.card2, color: C.txt, border: `1px solid ${C.brd2}` },
  };
  return (
    <button {...rest} style={{ ...base, ...(variants[variant] || variants.default), ...style }}>
      {children}
    </button>
  );
}

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: C.muted, marginBottom: 6,
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
  background: C.card, border: `1px solid ${C.brd2}`, color: C.txt,
  fontSize: 13, fontFamily: FONT, outline: 'none',
};

/* ════════════════════════════════════════════════════════════════════════
   Modal shell
   ════════════════════════════════════════════════════════════════════════ */

function Modal({ title, subtitle, onClose, children, maxWidth = 480 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 24,
        background: alpha(C.bg, 0.82), backdropFilter: 'blur(2px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto',
          background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 12,
          padding: '24px 26px', boxShadow: `0 20px 60px ${C.shadow}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: subtitle ? 6 : 18 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.txt, letterSpacing: '-0.01em' }}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 2, lineHeight: 0 }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        {subtitle && <p style={{ margin: '0 0 18px', fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   KPI summary tiles
   ════════════════════════════════════════════════════════════════════════ */

function KpiTile({ icon, label, value, color, reduced }) {
  const shown = useCountUp(value, reduced);
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12,
      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, minWidth: 0,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: alpha(color, '14'), color, border: `1px solid ${alpha(color, '24')}`,
      }}>
        <Icon name={icon} size={18} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: C.txt, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
          {shown}
        </div>
        <div className="t-truncate" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.muted }}>
          {label}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Per-card overflow action menu
   ════════════════════════════════════════════════════════════════════════ */

function ActionMenu({ actions }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const items = actions.filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: open ? C.card2 : 'transparent', color: C.txt2,
          border: `1px solid ${open ? C.brd2 : C.brd}`, fontSize: 18, lineHeight: 1,
          fontFamily: FONT,
        }}
      >…</button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
            minWidth: 190, background: C.surf, border: `1px solid ${C.brd2}`,
            borderRadius: 10, padding: 6, boxShadow: `0 8px 32px ${C.shadow}`,
          }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              onClick={() => { setOpen(false); it.onClick(); }}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12.5,
                fontWeight: 500, fontFamily: FONT, background: 'transparent', border: 'none',
                color: it.danger ? C.red : C.txt,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = it.danger ? alpha(C.red, '12') : C.card2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {it.icon && <Icon name={it.icon} size={15} />}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Build the role-gated action list shared by card + table row. */
function buildActions(p, handlers) {
  const owner = isOwnerOf(p);
  const canEdit = canEditOf(p);
  const linked = p._linkedMetaSift;
  const shared = !!p._shared;
  const actions = [];

  if (linked) {
    actions.push({ label: 'Open META·SIFT', icon: 'flow', onClick: () => handlers.openSift(p) });
  }
  if (owner || canEdit) {
    actions.push({ label: 'Rename', icon: 'pencil', onClick: () => handlers.rename(p) });
  }
  if (owner) {
    actions.push(
      p._archived
        ? { label: 'Unarchive', icon: 'refresh', onClick: () => handlers.unarchive(p) }
        : { label: 'Archive', icon: 'layers', onClick: () => handlers.archive(p) }
    );
  }
  // Transfer ownership — owner of a linked workspace only.
  if (owner && linked) {
    actions.push({ label: 'Transfer ownership', icon: 'users', onClick: () => handlers.transfer(p) });
  }
  // Owners NEVER see Leave — only shared, non-owner members can leave.
  if (shared && !owner && linked) {
    actions.push({ label: 'Leave project', icon: 'logout', onClick: () => handlers.leave(p) });
  }
  if (owner) {
    actions.push({ label: 'Delete', icon: 'trash', danger: true, onClick: () => handlers.del(p) });
  }
  return actions;
}

/* ════════════════════════════════════════════════════════════════════════
   Project card
   ════════════════════════════════════════════════════════════════════════ */

function ProjectCard({ p, handlers, reduced }) {
  const [hover, setHover] = useState(false);
  const status = statusOf(p);
  const sm = STATUS_META[status];
  const role = roleOf(p);
  const linked = p._linkedMetaSift;
  const pct = progressOf(p);
  const owner = isOwnerOf(p);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        background: hover ? C.cardHover : C.card,
        border: `1px solid ${hover ? C.brd2 : C.brd}`, borderRadius: 12,
        padding: '16px 18px 14px 20px', overflow: 'hidden', minWidth: 0,
        boxShadow: hover ? `0 6px 18px ${C.shadow}` : 'none',
        transform: hover && !reduced ? 'translateY(-2px)' : 'none',
        transition: reduced ? 'none' : 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease',
      }}
    >
      {/* left status stripe */}
      <span style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
        background: sm.color, opacity: status === 'archived' ? 0.5 : 0.95,
      }} />

      {/* title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="t-truncate" title={p.name || 'Untitled project'} style={{ fontSize: 15, fontWeight: 600, color: C.txt, marginBottom: 7 }}>
            {p.name || 'Untitled project'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Pill variant={ROLE_COLOR[role] || 'default'}>{ROLE_LABEL[role] || 'Owner'}</Pill>
            <Pill variant={sm.tag}>{sm.label}</Pill>
          </div>
        </div>
        <ActionMenu actions={buildActions(p, handlers)} />
      </div>

      {/* linked META·SIFT */}
      <div style={{ marginBottom: 10 }}>
        {linked ? (
          <Pill variant="teal" style={{ maxWidth: '100%' }}>
            <Icon name="flow" size={11} />
            <span className="t-truncate" style={{ maxWidth: 200 }}>META·SIFT · {linked.title || 'Workspace'}</span>
          </Pill>
        ) : (
          <Pill variant="default"><Icon name="link" size={11} />Not linked</Pill>
        )}
      </div>

      {/* meta row (MONO, tabular-nums) */}
      <div style={{
        fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: 11,
        color: C.muted, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', lineHeight: 1.7,
      }}>
        {p._shared && p._owner && (
          <span className="t-truncate" style={{ maxWidth: 170 }} title={`Owner: ${p._owner.name || p._owner.email}`}>
            {p._owner.name || p._owner.email}
          </span>
        )}
        <span>{p._studyCount || 0} studies</span>
        {linked && <span>{linked.recordCount || 0} records</span>}
        {linked && <span>{linked.memberCount || 0} members</span>}
        <span>{relTime(p.createdAt)} · upd {relTime(p.updatedAt)}</span>
      </div>

      {/* progress bar — only when meaningful */}
      {pct != null && (
        <div style={{ marginTop: 11, height: 3, borderRadius: 99, background: C.brd, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 99,
            background: pct >= 100 ? C.grn : C.acc,
            transition: reduced ? 'none' : 'width 0.4s cubic-bezier(0.22,1,0.36,1)',
          }} />
        </div>
      )}

      {/* footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13 }}>
        <Btn variant="primary" onClick={() => handlers.open(p)} style={{ flex: 1 }}>
          Open Project <Icon name="arrowRight" size={14} />
        </Btn>
        {linked && (
          <Btn variant="ghost" onClick={() => handlers.openSift(p)} title="Open the linked META·SIFT workspace">
            <Icon name="flow" size={14} /> META·SIFT
          </Btn>
        )}
      </div>
      {owner && p._archived && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: C.muted, fontFamily: MONO }}>
          archived {relTime(p._archivedAt)}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Table view
   ════════════════════════════════════════════════════════════════════════ */

function ProjectTable({ rows, handlers }) {
  const th = {
    textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em',
    textTransform: 'uppercase', color: C.muted, padding: '10px 12px', whiteSpace: 'nowrap',
    borderBottom: `1px solid ${C.brd}`,
  };
  const td = { padding: '11px 12px', fontSize: 12.5, color: C.txt, borderBottom: `1px solid ${C.brd}`, verticalAlign: 'middle' };
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              <th style={th}>Project</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={th}>Linked</th>
              <th style={{ ...th, textAlign: 'right' }}>Studies</th>
              <th style={th}>Updated</th>
              <th style={{ ...th, width: 1 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const status = statusOf(p);
              const sm = STATUS_META[status];
              const role = roleOf(p);
              const linked = p._linkedMetaSift;
              return (
                <tr
                  key={p.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handlers.open(p)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.card2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <td style={td}>
                    <div className="t-truncate" style={{ fontWeight: 600, maxWidth: 260 }} title={p.name}>{p.name || 'Untitled project'}</div>
                  </td>
                  <td style={td}><Pill variant={ROLE_COLOR[role] || 'default'}>{ROLE_LABEL[role] || 'Owner'}</Pill></td>
                  <td style={td}><Pill variant={sm.tag}>{sm.label}</Pill></td>
                  <td style={td}>
                    {linked
                      ? <span className="t-truncate" style={{ color: C.teal, maxWidth: 180, display: 'inline-block', verticalAlign: 'bottom' }} title={linked.title}>{linked.title || 'Workspace'}</span>
                      : <span style={{ color: C.muted }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: C.txt2 }}>{p._studyCount || 0}</td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{relTime(p.updatedAt)}</td>
                  <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <ActionMenu actions={buildActions(p, handlers)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Modals
   ════════════════════════════════════════════════════════════════════════ */

function CreateModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createLinkedSift, setCreateLinkedSift] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setErr('Please enter a project title.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await api.projects.create(trimmed, {
        description: description.trim() || undefined,
        createLinkedSift,
      });
      onCreated(res);
    } catch (e2) {
      setErr(e2.message || 'Could not create the project.');
      setBusy(false);
    }
  };

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle} htmlFor="np-title">Project title</label>
          <input id="np-title" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="e.g. Statins for primary prevention" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle} htmlFor="np-desc">Description <span style={{ textTransform: 'none', fontWeight: 500, color: C.dim }}>(optional)</span></label>
          <textarea id="np-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                    placeholder="A short summary of the review question" style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', cursor: 'pointer',
          background: alpha(C.acc, '08'), border: `1px solid ${alpha(C.acc, '28')}`, borderRadius: 9, marginBottom: 18,
        }}>
          <input type="checkbox" checked={createLinkedSift} onChange={(e) => setCreateLinkedSift(e.target.checked)}
                 style={{ marginTop: 2, accentColor: C.acc, width: 15, height: 15 }} />
          <span>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.txt }}>Create linked META·SIFT screening project</span>
            <span style={{ display: 'block', fontSize: 11.5, color: C.txt2, marginTop: 2, lineHeight: 1.5 }}>
              Spins up a collaborative citation-screening workspace linked to this project.
            </span>
          </span>
        </label>
        {err && <div style={{ marginBottom: 14, fontSize: 12, color: C.red }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn type="submit" variant="primary" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function RenameModal({ project, onClose, onRenamed }) {
  const [name, setName] = useState(project.name || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setErr('Title cannot be empty.'); return; }
    setBusy(true); setErr('');
    try {
      await api.projects.update(project.id, { name: trimmed });
      onRenamed();
    } catch (e2) { setErr(e2.message || 'Could not rename the project.'); setBusy(false); }
  };
  return (
    <Modal title="Rename project" onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle} htmlFor="rn-title">Project title</label>
          <input id="rn-title" autoFocus value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </div>
        {err && <div style={{ marginBottom: 14, fontSize: 12, color: C.red }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ArchiveModal({ project, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const confirm = async () => {
    setBusy(true); setErr('');
    try { await api.projects.archive(project.id); onDone(); }
    catch (e) { setErr(e.message || 'Could not archive the project.'); setBusy(false); }
  };
  return (
    <Modal title="Archive this project?" subtitle="You can restore it later. Archived projects are hidden from the active list and become read-only. A linked META·SIFT workspace you own is archived alongside it." onClose={onClose}>
      {err && <div style={{ marginBottom: 14, fontSize: 12, color: C.red }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" onClick={confirm} disabled={busy}>{busy ? 'Archiving…' : 'Archive'}</Btn>
      </div>
    </Modal>
  );
}

function LeaveModal({ project, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const confirm = async () => {
    const linkedId = project._linkedMetaSift && project._linkedMetaSift.id;
    if (!linkedId) { setErr('No linked workspace to leave.'); return; }
    setBusy(true); setErr('');
    try { await screeningApi.leaveProject(linkedId); onDone(); }
    catch (e) { setErr(e.message || 'Could not leave the project.'); setBusy(false); }
  };
  return (
    <Modal title="Leave this project?" onClose={onClose}>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: C.txt2, lineHeight: 1.65 }}>
        You will lose access to <strong style={{ color: C.txt }}>{project.name}</strong> and its linked META·SIFT workspace.
        Your past contributions remain with the project. To return, an owner or leader will need to re-invite you.
      </p>
      {err && <div style={{ marginBottom: 14, fontSize: 12, color: C.red }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="danger" onClick={confirm} disabled={busy}>{busy ? 'Leaving…' : 'Leave project'}</Btn>
      </div>
    </Modal>
  );
}

function DeleteModal({ project, onClose, onDone }) {
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const linked = project._linkedMetaSift;
  const matches = confirmName.trim() === (project.name || '').trim() && (project.name || '').trim().length > 0;
  const confirm = async () => {
    if (!matches) return;
    setBusy(true); setErr('');
    try {
      await api.projects.confirmDelete(project.id, { confirmName: confirmName.trim(), cascadeLinked: true });
      onDone();
    } catch (e) { setErr(e.message || 'Could not delete the project.'); setBusy(false); }
  };
  const consequences = [
    'This META·LAB project and its analysis data',
    linked ? `The linked META·SIFT workspace “${linked.title || 'Workspace'}”` : null,
    'Extraction, PRISMA, analysis and screening data',
    'Access for all members of the linked workspace',
  ].filter(Boolean);
  return (
    <Modal title="Delete project" subtitle="This is a guarded, reversible-by-ops soft delete. It removes the project from everyone's workspace." onClose={onClose}>
      <div style={{
        background: alpha(C.red, '08'), border: `1px solid ${alpha(C.red, '28')}`, borderRadius: 9,
        padding: '12px 14px', marginBottom: 18,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.red, marginBottom: 8 }}>
          This will remove
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.txt2, lineHeight: 1.7 }}>
          {consequences.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="del-confirm">
          Type <span style={{ textTransform: 'none', fontWeight: 700, color: C.txt, fontFamily: MONO }}>{project.name}</span> to confirm
        </label>
        <input id="del-confirm" autoFocus value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
               placeholder={project.name} style={inputStyle} />
      </div>
      {err && <div style={{ marginBottom: 14, fontSize: 12, color: C.red }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="danger" onClick={confirm} disabled={busy || !matches}
             style={{ opacity: matches ? 1 : 0.5, cursor: matches ? 'pointer' : 'not-allowed' }}>
          {busy ? 'Deleting…' : 'Delete project'}
        </Btn>
      </div>
    </Modal>
  );
}

function TransferModal({ project, onClose, onDone }) {
  const linked = project._linkedMetaSift;
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    if (!linked || !linked.id) { setLoadErr('No linked workspace to transfer.'); setLoading(false); return undefined; }
    let alive = true;
    (async () => {
      try {
        const res = await screeningApi.listMembers(linked.id);
        if (!alive) return;
        const all = (res && res.members) || [];
        // Eligible: an active member with a real userId, not the current owner.
        const eligible = all.filter(m => m.status === 'active' && m.userId && !m.isOwner && m.role !== 'owner');
        setMembers(eligible);
      } catch (e) {
        if (alive) setLoadErr(e.message || 'Could not load workspace members.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [linked]);

  const confirm = async () => {
    if (!picked || !linked || !linked.id) return;
    setBusy(true); setErr('');
    try {
      await screeningApi.transferOwner(linked.id, picked);
      onDone();
    } catch (e) { setErr(e.message || 'Could not transfer ownership.'); setBusy(false); }
  };

  const nameOf = (m) => m.name || m.email || 'Member';
  const initial = (m) => (nameOf(m).trim()[0] || '?').toUpperCase();

  return (
    <Modal
      title="Transfer ownership"
      subtitle={`Hand ${project.name || 'this project'} and its linked META·SIFT workspace to another active member. You keep full leader access afterward and can leave the project later.`}
      onClose={onClose}
    >
      {loading ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: C.muted, fontSize: 12.5 }}>
          Loading workspace members…
        </div>
      ) : loadErr ? (
        <div style={{ marginBottom: 16, fontSize: 12.5, color: C.red }}>{loadErr}</div>
      ) : members.length === 0 ? (
        <div style={{
          padding: '18px 16px', borderRadius: 9, marginBottom: 18,
          background: C.card2, border: `1px solid ${C.brd}`,
          fontSize: 12.5, color: C.txt2, lineHeight: 1.6,
        }}>
          There are no other active members to transfer ownership to. Invite a collaborator to the linked
          META·SIFT workspace first, then return here to hand over ownership.
        </div>
      ) : (
        <div role="radiogroup" aria-label="Choose a new owner" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {members.map((m) => {
            const active = picked === m.userId;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPicked(m.userId)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
                  padding: '10px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: FONT,
                  background: active ? alpha(C.acc, '12') : C.card,
                  border: `1px solid ${active ? alpha(C.acc, '50') : C.brd2}`,
                  transition: 'background 0.12s ease, border-color 0.12s ease',
                }}
              >
                <span style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: alpha(C.acc, '16'), color: C.acc, fontWeight: 700, fontSize: 13,
                  border: `1px solid ${alpha(C.acc, '24')}`,
                }}>{initial(m)}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="t-truncate" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.txt }}>{nameOf(m)}</span>
                  {m.email && m.email !== nameOf(m) && (
                    <span className="t-truncate" style={{ display: 'block', fontSize: 11, color: C.muted, fontFamily: MONO }}>{m.email}</span>
                  )}
                </span>
                <Pill variant={ROLE_COLOR[m.role] || 'default'}>{ROLE_LABEL[m.role] || m.role}</Pill>
                <span style={{
                  width: 16, height: 16, borderRadius: 99, flexShrink: 0,
                  border: `2px solid ${active ? C.acc : C.brd2}`,
                  background: active ? C.acc : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {active && <span style={{ width: 6, height: 6, borderRadius: 99, background: C.accText }} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {err && <div style={{ marginBottom: 14, fontSize: 12, color: C.red }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{members.length === 0 ? 'Close' : 'Cancel'}</Btn>
        {members.length > 0 && (
          <Btn variant="primary" onClick={confirm} disabled={busy || !picked}
               style={{ opacity: picked ? 1 : 0.5, cursor: picked ? 'pointer' : 'not-allowed' }}>
            {busy ? 'Transferring…' : 'Transfer ownership'}
          </Btn>
        )}
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Empty states
   ════════════════════════════════════════════════════════════════════════ */

function EmptyState({ icon, title, body, cta }) {
  return (
    <div style={{
      textAlign: 'center', padding: '56px 24px', border: `1px dashed ${C.brd}`,
      borderRadius: 14, background: alpha(C.card, 0.4),
    }}>
      <div style={{
        width: 52, height: 52, margin: '0 auto 16px', borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: alpha(C.acc, '12'), color: C.acc, border: `1px solid ${alpha(C.acc, '22')}`,
      }}>
        <Icon name={icon} size={24} />
      </div>
      <div style={{ fontSize: 15.5, fontWeight: 600, color: C.txt, marginBottom: 8 }}>{title}</div>
      <p style={{ margin: '0 auto 18px', maxWidth: 420, fontSize: 12.5, color: C.txt2, lineHeight: 1.65 }}>{body}</p>
      {cta}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Control bar pieces
   ════════════════════════════════════════════════════════════════════════ */

function Chip({ active, onClick, children, count }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px',
        borderRadius: 20, fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
        whiteSpace: 'nowrap',
        background: active ? C.acc2 : 'transparent',
        color: active ? C.accText : C.txt2,
        border: `1px solid ${active ? C.acc2 : C.brd2}`,
        transition: 'background 0.12s ease, color 0.12s ease, border-color 0.12s ease',
      }}
    >
      {children}
      <span style={{
        fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: 10.5, fontWeight: 600,
        padding: '0 5px', borderRadius: 99, lineHeight: '16px',
        background: active ? alpha(C.accText, '20') : C.card2,
        color: active ? C.accText : C.muted,
      }}>{count}</span>
    </button>
  );
}

// FILTERS, SORTS, ROLE_ORDER imported from projectLanding.helpers.js

/* ════════════════════════════════════════════════════════════════════════
   Recently-opened rail
   ════════════════════════════════════════════════════════════════════════ */

function RecentsRail({ items, onOpen, reduced }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
        color: C.muted, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7,
      }}>
        <Icon name="clock" size={13} /> Recently opened
      </div>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {items.map((r) => (
          <button
            key={r.id}
            onClick={() => onOpen(r)}
            title={r.name}
            style={{
              flex: '0 0 auto', maxWidth: 220, display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: FONT,
              background: C.card, border: `1px solid ${C.brd}`, color: C.txt,
              transition: reduced ? 'none' : 'background 0.15s ease, border-color 0.15s ease, transform 0.12s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.cardHover; e.currentTarget.style.borderColor = C.brd2; if (!reduced) e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.card; e.currentTarget.style.borderColor = C.brd; e.currentTarget.style.transform = 'none'; }}
          >
            <span style={{
              width: 26, height: 26, borderRadius: 7, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: alpha(C.acc, '14'), color: C.acc, border: `1px solid ${alpha(C.acc, '22')}`,
            }}>
              <Icon name="folder" size={13} />
            </span>
            <span className="t-truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Main page
   ════════════════════════════════════════════════════════════════════════ */

export default function ProjectLanding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const reduced = usePrefersReducedMotion();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // controls
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('modified');
  const [view, setView] = useState('cards'); // 'cards' | 'table'
  const [showArchived, setShowArchived] = useState(false);

  // modals
  const [modal, setModal] = useState(null); // { type, project }

  // recently-opened (localStorage-backed, dedupe-by-id, newest-first, cap 6)
  const [recents, setRecents] = useState(() => readRecents());
  const recordRecent = useCallback((p) => { setRecents(writeRecent(p)); }, []);

  /* ── Legacy /app?project=<id> deep-link → route-param workspace ─────── */
  useEffect(() => {
    try {
      const want = new URLSearchParams(window.location.search).get('project');
      if (want) navigate(`/app/project/${encodeURIComponent(want)}`, { replace: true });
    } catch { /* ignore */ }
  }, [navigate]);

  /* ── Load roster (always include archived; we filter client-side so the
        "show archived" toggle and the Archived chip count are accurate) ── */
  const reload = useCallback(async () => {
    try {
      setError('');
      const list = await api.projects.list({ includeArchived: true });
      const arr = Array.isArray(list) ? list : (list && list.projects) || [];
      setProjects(arr);
    } catch {
      setError('Could not load your projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await api.projects.list({ includeArchived: true }).catch(() => null);
      if (!alive) return;
      if (list == null) setError('Could not load your projects.');
      else setProjects(Array.isArray(list) ? list : (list.projects || []));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  /* ── Debounce search ──────────────────────────────────────────────── */
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 220);
    return () => clearTimeout(t);
  }, [searchRaw]);

  /* ── KPI counts (real, derived from the full roster) ──────────────── */
  const kpis = useMemo(() => {
    const accessible = projects.filter(p => !p._archived);
    return {
      accessible: accessible.length,
      owned: projects.filter(p => isOwnerOf(p) && !p._archived).length,
      lead: projects.filter(p => roleOf(p) === 'leader' && !p._archived).length,
      active: projects.filter(p => { const s = statusOf(p); return s === 'active' || s === 'in_progress'; }).length,
      linked: projects.filter(p => p._linkedMetaSift && !p._archived).length,
      archived: projects.filter(p => p._archived).length,
    };
  }, [projects]);

  /* ── Per-chip counts (respect search + show-archived scope) ───────── */
  const searchPool = useMemo(() => {
    const matchesSearch = (p) => {
      if (!search) return true;
      const hay = [
        p.name,
        p._owner && (p._owner.name || p._owner.email),
        p._linkedMetaSift && p._linkedMetaSift.title,
        STATUS_META[statusOf(p)] && STATUS_META[statusOf(p)].label,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(search);
    };
    return projects.filter((p) => {
      if (!showArchived && p._archived) return false;
      return matchesSearch(p);
    });
  }, [projects, search, showArchived]);

  const chipCounts = useMemo(() => {
    const out = {};
    for (const f of FILTERS) out[f.key] = searchPool.filter(f.test).length;
    return out;
  }, [searchPool]);

  /* ── Final visible list ───────────────────────────────────────────── */
  const visible = useMemo(() => {
    const f = FILTERS.find(x => x.key === filter) || FILTERS[0];
    const s = SORTS.find(x => x.key === sort) || SORTS[0];
    const filtered = searchPool.filter(f.test);
    const cmp = sort === 'role'
      ? (a, b) => (ROLE_ORDER[roleOf(a)] ?? 9) - (ROLE_ORDER[roleOf(b)] ?? 9)
      : s.cmp;
    return [...filtered].sort(cmp);
  }, [searchPool, filter, sort]);

  /* ── Recently-opened (only ids still in the roster; skip stale) ─────── */
  const recentItems = useMemo(() => {
    if (!recents.length) return [];
    const byId = new Map(projects.map(p => [String(p.id), p]));
    return recents
      .filter(r => byId.has(r.id))
      .map(r => ({ id: r.id, name: (byId.get(r.id).name || r.name || 'Untitled project') }));
  }, [recents, projects]);

  /* ── Action handlers ──────────────────────────────────────────────── */
  const handlers = useMemo(() => ({
    open:      (p) => { recordRecent(p); navigate(`/app/project/${encodeURIComponent(p.id)}`); },
    openSift:  (p) => { const id = p._linkedMetaSift && p._linkedMetaSift.id; if (id) navigate(`/sift-beta/projects/${encodeURIComponent(id)}`); },
    rename:    (p) => setModal({ type: 'rename', project: p }),
    archive:   (p) => setModal({ type: 'archive', project: p }),
    unarchive: async (p) => { try { await api.projects.unarchive(p.id); await reload(); } catch { setError('Could not unarchive the project.'); } },
    leave:     (p) => setModal({ type: 'leave', project: p }),
    transfer:  (p) => setModal({ type: 'transfer', project: p }),
    del:       (p) => setModal({ type: 'delete', project: p }),
  }), [navigate, reload, recordRecent]);

  const closeModal = () => setModal(null);
  const afterMutation = async () => { setModal(null); await reload(); };

  /* ── Render ───────────────────────────────────────────────────────── */
  const name = (user && user.name) || (user && user.email && user.email.split('@')[0]) || 'there';
  const hasAnyProject = projects.length > 0;
  const archivedExist = kpis.archived > 0;
  const activeVisibleEmpty = visible.length === 0;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <NotificationsBell fixed right={56} />
      <UserMenu context="metalab" fixed />

      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 32px 64px' }}>

        {/* ── Greeting band ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 28 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: '0 0 6px', fontSize: 25, fontWeight: 700, letterSpacing: '-0.02em', color: C.txt }}>
              Welcome back, {name}
            </h1>
            <p style={{ margin: 0, fontSize: 13.5, color: C.txt2 }}>
              Choose a workspace to continue your evidence synthesis.
            </p>
          </div>
          <Btn variant="primary" onClick={() => setModal({ type: 'create' })} style={{ padding: '9px 18px', fontSize: 13 }}>
            <Icon name="plus" size={15} /> New Project
          </Btn>
        </div>

        {error && (
          <div style={{
            marginBottom: 20, padding: '11px 14px', borderRadius: 9, fontSize: 12.5,
            background: C.redBg, color: C.red, border: `1px solid ${alpha(C.red, '30')}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <span><Icon name="alert" size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />{error}</span>
            <button onClick={reload} style={{ background: 'transparent', border: `1px solid ${alpha(C.red, '40')}`, color: C.red, borderRadius: 7, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>Retry</button>
          </div>
        )}

        {/* ── KPI summary tiles ─────────────────────────────────────── */}
        {!loading && hasAnyProject && (
          <div style={{
            display: 'grid', gap: 12, marginBottom: 26,
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          }}>
            <KpiTile icon="folders"     label="Accessible"        value={kpis.accessible} color={C.acc}  reduced={reduced} />
            <KpiTile icon="user"        label="Owned"             value={kpis.owned}      color={C.gold} reduced={reduced} />
            <KpiTile icon="award"       label="I lead"            value={kpis.lead}       color={C.purp} reduced={reduced} />
            <KpiTile icon="activity"    label="Active"            value={kpis.active}     color={C.grn}  reduced={reduced} />
            <KpiTile icon="flow"        label="Linked META·SIFT"  value={kpis.linked}     color={C.teal} reduced={reduced} />
            <KpiTile icon="layers"      label="Archived"          value={kpis.archived}   color={C.muted} reduced={reduced} />
          </div>
        )}

        {/* ── Recently opened rail (above the control bar) ──────────── */}
        {!loading && hasAnyProject && (
          <RecentsRail items={recentItems} onOpen={(r) => handlers.open(r)} reduced={reduced} />
        )}

        {/* ── Control bar ───────────────────────────────────────────── */}
        {!loading && hasAnyProject && (
          <div style={{ marginBottom: 22 }}>
            {/* row 1: search + sort + view + show-archived */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
                <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.muted, pointerEvents: 'none' }}>
                  <Icon name="search" size={15} />
                </span>
                <input
                  value={searchRaw}
                  onChange={(e) => setSearchRaw(e.target.value)}
                  placeholder="Search title, owner, linked workspace, status…"
                  aria-label="Search projects"
                  style={{ ...inputStyle, paddingLeft: 34 }}
                />
                {searchRaw && (
                  <button onClick={() => setSearchRaw('')} aria-label="Clear search"
                          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                    <Icon name="x" size={15} />
                  </button>
                )}
              </div>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.txt2 }}>
                <span style={{ color: C.muted, fontWeight: 600 }}>Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}
                        style={{ ...inputStyle, width: 'auto', padding: '7px 10px', cursor: 'pointer' }}>
                  {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>

              {/* view toggle */}
              <div style={{ display: 'inline-flex', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: 2 }}>
                {[{ k: 'cards', icon: 'grid', t: 'Card view' }, { k: 'table', icon: 'table', t: 'Table view' }].map(v => (
                  <button key={v.k} onClick={() => setView(v.k)} title={v.t} aria-label={v.t} aria-pressed={view === v.k}
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 28,
                            borderRadius: 6, cursor: 'pointer', border: 'none',
                            background: view === v.k ? C.acc2 : 'transparent',
                            color: view === v.k ? C.accText : C.txt2,
                          }}>
                    <Icon name={v.icon} size={15} />
                  </button>
                ))}
              </div>

              {/* show archived */}
              <button
                onClick={() => setShowArchived(s => !s)}
                aria-pressed={showArchived}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 8,
                  fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
                  background: showArchived ? alpha(C.acc, '12') : C.card,
                  color: showArchived ? C.acc : C.txt2,
                  border: `1px solid ${showArchived ? alpha(C.acc, '40') : C.brd2}`,
                }}>
                <Icon name={showArchived ? 'eye' : 'layers'} size={14} />
                Archived
                {kpis.archived > 0 && (
                  <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: 10.5, color: showArchived ? C.acc : C.muted }}>
                    {kpis.archived}
                  </span>
                )}
              </button>
            </div>

            {/* row 2: quick-filter chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {FILTERS.filter(f => f.key !== 'archived' || showArchived).map(f => (
                <Chip key={f.key} active={filter === f.key} count={chipCounts[f.key] || 0}
                      onClick={() => setFilter(f.key)}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {/* ── Body ──────────────────────────────────────────────────── */}
        {loading ? (
          <div style={{ padding: '64px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
            Loading your projects…
          </div>
        ) : !hasAnyProject ? (
          <EmptyState
            icon="folders"
            title="No projects yet"
            body="META·LAB is your evidence-synthesis workspace; META·SIFT handles collaborative citation screening. Create your first project to get started — you can link a screening workspace in one click."
            cta={<Btn variant="primary" onClick={() => setModal({ type: 'create' })}><Icon name="plus" size={15} /> Create your first project</Btn>}
          />
        ) : activeVisibleEmpty ? (
          search ? (
            <EmptyState
              icon="search"
              title="No matching projects"
              body={`Nothing matches “${searchRaw.trim()}” in the current filter. Try a different term or clear the search.`}
              cta={<Btn variant="ghost" onClick={() => { setSearchRaw(''); setFilter('all'); }}>Clear search & filters</Btn>}
            />
          ) : (!showArchived && archivedExist) ? (
            <EmptyState
              icon="layers"
              title="Nothing active here"
              body={`Every project matching this filter is archived. You have ${kpis.archived} archived ${kpis.archived === 1 ? 'project' : 'projects'} hidden from the active view.`}
              cta={<Btn variant="primary" onClick={() => setShowArchived(true)}><Icon name="eye" size={15} /> Show archived</Btn>}
            />
          ) : (
            <EmptyState
              icon="filter"
              title="No projects in this filter"
              body="No projects match the selected quick-filter. Switch back to “All” to see everything you can access."
              cta={<Btn variant="ghost" onClick={() => setFilter('all')}>Show all projects</Btn>}
            />
          )
        ) : view === 'table' ? (
          <ProjectTable rows={visible} handlers={handlers} />
        ) : (
          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          }}>
            {visible.map(p => <ProjectCard key={p.id} p={p} handlers={handlers} reduced={reduced} />)}
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      {modal && modal.type === 'create' && (
        <CreateModal
          onClose={closeModal}
          onCreated={(res) => {
            closeModal();
            const id = res && res.id;
            if (id) navigate(`/app/project/${encodeURIComponent(id)}`);
            else reload();
          }}
        />
      )}
      {modal && modal.type === 'rename'  && <RenameModal  project={modal.project} onClose={closeModal} onRenamed={afterMutation} />}
      {modal && modal.type === 'archive' && <ArchiveModal project={modal.project} onClose={closeModal} onDone={afterMutation} />}
      {modal && modal.type === 'leave'    && <LeaveModal    project={modal.project} onClose={closeModal} onDone={afterMutation} />}
      {modal && modal.type === 'transfer' && <TransferModal project={modal.project} onClose={closeModal} onDone={afterMutation} />}
      {modal && modal.type === 'delete'   && <DeleteModal   project={modal.project} onClose={closeModal} onDone={afterMutation} />}
    </div>
  );
}
