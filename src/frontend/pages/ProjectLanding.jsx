/**
 * ProjectLanding.jsx — Nextly-design workspace selector (prompt16).
 *
 * Route: /app  (the deterministic-by-id workspace lives at /app/project/:id).
 *
 * DESIGN: Nextly template language — bright white/indigo SaaS palette, soft
 * cards (rounded-12-16px), subtle borders, generous spacing, Inter font, indigo
 * accents, staggered Framer Motion entrance, whileHover card lift.
 *
 * DATA / LOGIC: 100% unchanged from prompt11–14. All props, data fetching,
 * navigation, permissions, filters, sorts, actions and recent-projects logic
 * are preserved. Only the visual layer (containers, cards, controls) is
 * restyled.
 *
 * Style: ../theme/tokens.js (C, FONT, MONO, alpha) — never hex-concat.
 * Motion: framer-motion (installed). Reduced-motion respected.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  relTime, progressOf, SORTS, ROLE_ORDER,
  readDashboardPrefs, writeDashboardPrefs, sanitizeDashboardPrefs,
} from './projectLanding.helpers.js';

/* ════════════════════════════════════════════════════════════════════════
   Dashboard quick-filters (prompt19)

   Status-based segments derived ONLY from data already on each project
   object. "Linking" is no longer a user-facing concept, so there are no
   linked / unlinked filters here. Each predicate's data source:

     all        → always true
     active     → statusOf(p) === 'active'  (not archived, screening not yet
                  in progress or done)        ← _archived + _linkedMetaSift.progressStatus
     inprogress → statusOf(p) === 'in_progress' (screening underway)
                                                 ← _linkedMetaSift.progressStatus === 'in_progress'
     done       → statusOf(p) === 'done'    (screening complete)
                                                 ← _linkedMetaSift.progressStatus === 'done'
     owned      → isOwnerOf(p)               ← _permissions.isOwner / _role + !_shared
     shared     → _shared && !isOwnerOf(p)   ← _shared
     recent     → updatedAt within RECENT_WINDOW_MS ← updatedAt
     archived   → _archived                  ← _archived
   ════════════════════════════════════════════════════════════════════════ */

const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function isRecent(p) {
  if (!p || !p.updatedAt) return false;
  const t = new Date(p.updatedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= RECENT_WINDOW_MS;
}

const DASHBOARD_FILTERS = [
  { key: 'all',        label: 'All',                   test: () => true },
  { key: 'active',     label: 'Active',                test: (p) => statusOf(p) === 'active' },
  { key: 'inprogress', label: 'Screening in progress', test: (p) => statusOf(p) === 'in_progress' },
  { key: 'done',       label: 'Completed',             test: (p) => statusOf(p) === 'done' },
  { key: 'owned',      label: 'Owned by me',           test: (p) => isOwnerOf(p) },
  { key: 'shared',     label: 'Shared with me',        test: (p) => !!p._shared && !isOwnerOf(p) },
  { key: 'recent',     label: 'Recent',                test: (p) => isRecent(p) },
  { key: 'archived',   label: 'Archived',              test: (p) => !!p._archived },
];

/* ════════════════════════════════════════════════════════════════════════
   Reduced-motion hook
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

/* ════════════════════════════════════════════════════════════════════════
   Count-up animation (eased, reduced-motion aware)
   ════════════════════════════════════════════════════════════════════════ */

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
      const eased = 1 - Math.pow(1 - t, 3);
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
   Framer Motion variants
   ════════════════════════════════════════════════════════════════════════ */

const headerVariants = {
  hidden:  { opacity: 0, y: -16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

const gridContainerVariants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.055, delayChildren: 0.05 } },
};

const cardVariants = {
  hidden:  { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

const reducedVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
};

/* ════════════════════════════════════════════════════════════════════════
   Nextly-style design atoms
   ════════════════════════════════════════════════════════════════════════ */

/** Small pill / badge — adapts colour from TAG_COLORS. */
function Pill({ variant = 'default', children, style }) {
  const col = TAG_COLORS[variant] || C.muted;
  const isDefault = variant === 'default';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 10px', borderRadius: 99, fontSize: 10.5, fontWeight: 600,
      letterSpacing: 0.3, lineHeight: 1.5, whiteSpace: 'nowrap',
      background: isDefault ? C.card2 : alpha(col, 0.10),
      color: isDefault ? C.muted : col,
      border: `1px solid ${isDefault ? C.brd : alpha(col, 0.22)}`,
      ...style,
    }}>{children}</span>
  );
}

/** Primary / ghost / danger / default button. */
function Btn({ variant = 'default', children, style, ...rest }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    fontFamily: FONT, cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease',
    border: '1px solid transparent',
  };
  const variants = {
    primary: {
      background: `linear-gradient(135deg, ${C.acc} 0%, ${C.acc2} 100%)`,
      color: C.accText,
      boxShadow: `0 2px 14px ${alpha(C.acc, 0.28)}`,
    },
    ghost: {
      background: 'transparent', color: C.txt2,
      border: `1px solid ${C.brd2}`,
    },
    danger: {
      background: alpha(C.red, 0.08), color: C.red,
      border: `1px solid ${alpha(C.red, 0.25)}`,
    },
    default: {
      background: C.card2, color: C.txt,
      border: `1px solid ${C.brd2}`,
    },
  };
  return (
    <button {...rest} style={{ ...base, ...(variants[variant] || variants.default), ...style }}>
      {children}
    </button>
  );
}

/** Shared form field styles. */
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: C.muted, marginBottom: 6,
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 13px', borderRadius: 9,
  background: C.card, border: `1px solid ${C.brd2}`, color: C.txt,
  fontSize: 13, fontFamily: FONT, outline: 'none',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
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
        background: alpha(C.bg, 0.82), backdropFilter: 'blur(3px)',
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto',
          background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 16,
          padding: '26px 28px', boxShadow: `0 24px 64px ${C.shadow}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: subtitle ? 6 : 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.txt, letterSpacing: '-0.015em' }}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 2, lineHeight: 0, borderRadius: 6 }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        {subtitle && <p style={{ margin: '0 0 20px', fontSize: 12.5, color: C.txt2, lineHeight: 1.65 }}>{subtitle}</p>}
        {children}
      </motion.div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   KPI summary tile — Nextly benefit-card style
   ════════════════════════════════════════════════════════════════════════ */

function KpiTile({ icon, label, value, color, reduced }) {
  const shown = useCountUp(value, reduced);
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14,
      padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, minWidth: 0,
      boxShadow: `0 1px 4px ${C.shadow}`,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 11, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: alpha(color, 0.10), color,
        border: `1.5px solid ${alpha(color, 0.20)}`,
      }}>
        <Icon name={icon} size={20} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: MONO, fontSize: 24, fontWeight: 700, color: C.txt,
          lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
        }}>
          {shown}
        </div>
        <div className="t-truncate" style={{
          fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: C.muted, marginTop: 2,
        }}>
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
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: open ? C.card2 : 'transparent',
          color: C.txt2,
          border: `1px solid ${open ? C.brd2 : 'transparent'}`,
          fontSize: 18, lineHeight: 1, fontFamily: FONT,
          transition: 'background 0.12s ease, border-color 0.12s ease',
        }}
      >…</button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
              minWidth: 196, background: C.surf, border: `1px solid ${C.brd}`,
              borderRadius: 12, padding: '5px', boxShadow: `0 10px 36px ${C.shadow}`,
            }}
          >
            {items.map((it, i) => (
              <button
                key={i}
                role="menuitem"
                onClick={() => { setOpen(false); it.onClick(); }}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9,
                  padding: '8px 11px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5,
                  fontWeight: 500, fontFamily: FONT, background: 'transparent', border: 'none',
                  color: it.danger ? C.red : C.txt,
                  transition: 'background 0.1s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = it.danger ? alpha(C.red, 0.08) : C.card2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {it.icon && <Icon name={it.icon} size={14} />}
                <span>{it.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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

  // prompt18 — screening is an in-project stage, not a separate app. Always offer
  // it; opening it auto-creates the screening workspace if it doesn't exist yet.
  actions.push({ label: 'Screening', icon: 'filter', onClick: () => handlers.openSift(p) });
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
  if (owner && linked) {
    actions.push({ label: 'Transfer ownership', icon: 'users', onClick: () => handlers.transfer(p) });
  }
  if (shared && !owner && linked) {
    actions.push({ label: 'Leave project', icon: 'logout', onClick: () => handlers.leave(p) });
  }
  if (owner) {
    actions.push({ label: 'Delete', icon: 'trash', danger: true, onClick: () => handlers.del(p) });
  }
  return actions;
}

/* ════════════════════════════════════════════════════════════════════════
   Project card — Nextly soft-card style with Framer Motion lift
   ════════════════════════════════════════════════════════════════════════ */

function ProjectCard({ p, handlers, reduced }) {
  const status = statusOf(p);
  const sm = STATUS_META[status];
  const role = roleOf(p);
  const linked = p._linkedMetaSift;
  const pct = progressOf(p);
  const owner = isOwnerOf(p);

  return (
    <motion.div
      variants={reduced ? reducedVariants : cardVariants}
      whileHover={reduced ? {} : { y: -4, boxShadow: `0 12px 32px ${C.shadow}`, borderColor: C.brd2 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14,
        padding: '20px 20px 16px 24px', overflow: 'hidden', minWidth: 0,
        boxShadow: `0 1px 4px ${C.shadow}`,
        cursor: 'default',
      }}
    >
      {/* left status accent stripe */}
      <span style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
        background: sm.color, opacity: status === 'archived' ? 0.45 : 1,
        borderRadius: '14px 0 0 14px',
      }} />

      {/* title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            className="t-truncate"
            title={p.name || 'Untitled project'}
            style={{
              fontSize: 15.5, fontWeight: 700, color: C.txt,
              marginBottom: 8, letterSpacing: '-0.01em',
            }}
          >
            {p.name || 'Untitled project'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Pill variant={ROLE_COLOR[role] || 'default'}>{ROLE_LABEL[role] || 'Owner'}</Pill>
            <Pill variant={sm.tag}>{sm.label}</Pill>
          </div>
        </div>
        <ActionMenu actions={buildActions(p, handlers)} />
      </div>

      {/* screening status (prompt18) — one project, screening is a stage inside it */}
      <div style={{ marginBottom: 11 }}>
        {linked ? (
          <Pill variant="teal" style={{ maxWidth: '100%' }}>
            <Icon name="filter" size={11} />
            <span className="t-truncate" style={{ maxWidth: 210 }}>Screening{linked.recordCount ? ` · ${linked.recordCount} records` : ' ready'}</span>
          </Pill>
        ) : (
          <Pill variant="default"><Icon name="filter" size={11} />Screening</Pill>
        )}
      </div>

      {/* meta row */}
      <div style={{
        fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: 11,
        color: C.muted, display: 'flex', flexWrap: 'wrap', gap: '3px 12px', lineHeight: 1.8,
      }}>
        {p._shared && p._owner && (
          <span className="t-truncate" style={{ maxWidth: 180 }} title={`Owner: ${p._owner.name || p._owner.email}`}>
            {p._owner.name || p._owner.email}
          </span>
        )}
        <span>{p._studyCount || 0} studies</span>
        {linked && <span>{linked.recordCount || 0} records</span>}
        {linked && <span>{linked.memberCount || 0} members</span>}
        <span>upd {relTime(p.updatedAt)}</span>
      </div>

      {/* progress bar */}
      {pct != null && (
        <div style={{ marginTop: 12, height: 4, borderRadius: 99, background: C.brd, overflow: 'hidden' }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={reduced ? { duration: 0 } : { duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            style={{
              height: '100%', borderRadius: 99,
              background: pct >= 100 ? C.grn : C.acc,
            }}
          />
        </div>
      )}

      {/* footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 15 }}>
        <Btn
          variant="primary"
          onClick={() => handlers.open(p)}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          Open Project <Icon name="arrowRight" size={14} />
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => handlers.openSift(p)}
          title="Open the Screening stage"
          style={{ padding: '8px 12px' }}
        >
          <Icon name="filter" size={14} /> Screening
        </Btn>
      </div>
      {owner && p._archived && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: C.muted, fontFamily: MONO }}>
          archived {relTime(p._archivedAt)}
        </div>
      )}
    </motion.div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Table view — clean, right-aligned numerics
   ════════════════════════════════════════════════════════════════════════ */

function ProjectTable({ rows, handlers }) {
  const th = {
    textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: C.muted, padding: '11px 14px', whiteSpace: 'nowrap',
    borderBottom: `1px solid ${C.brd}`,
    background: C.card2,
  };
  const td = {
    padding: '12px 14px', fontSize: 12.5, color: C.txt,
    borderBottom: `1px solid ${C.brd}`, verticalAlign: 'middle',
  };
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14,
      overflow: 'hidden', boxShadow: `0 1px 4px ${C.shadow}`,
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              <th style={th}>Project</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={th}>Screening</th>
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
                  style={{ cursor: 'pointer', transition: 'background 0.1s ease' }}
                  onClick={() => handlers.open(p)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.card2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <td style={td}>
                    <div className="t-truncate" style={{ fontWeight: 600, maxWidth: 260 }} title={p.name}>
                      {p.name || 'Untitled project'}
                    </div>
                  </td>
                  <td style={td}><Pill variant={ROLE_COLOR[role] || 'default'}>{ROLE_LABEL[role] || 'Owner'}</Pill></td>
                  <td style={td}><Pill variant={sm.tag}>{sm.label}</Pill></td>
                  <td style={td}>
                    {linked && linked.recordCount
                      ? <span className="t-truncate" style={{ color: C.teal, maxWidth: 180, display: 'inline-block', verticalAlign: 'bottom' }}>{linked.recordCount} records</span>
                      : status === 'in_progress'
                        ? <span style={{ color: C.teal }}>In progress</span>
                        : status === 'done'
                          ? <span style={{ color: C.grn }}>Complete</span>
                          : <span style={{ color: C.dim }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: C.txt2 }}>
                    {p._studyCount || 0}
                  </td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
                    {relTime(p.updatedAt)}
                  </td>
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
   Modals — all logic unchanged, Nextly-styled chrome
   ════════════════════════════════════════════════════════════════════════ */

function CreateModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
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
        // prompt18 — a review project always includes its screening stage; the
        // screening workspace is created automatically (no opt-in checkbox).
        createLinkedSift: true,
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
          <label style={labelStyle} htmlFor="np-desc">
            Description{' '}
            <span style={{ textTransform: 'none', fontWeight: 500, color: C.dim }}>(optional)</span>
          </label>
          <textarea id="np-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                    placeholder="A short summary of the review question"
                    style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
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
    <Modal
      title="Archive this project?"
      subtitle="You can restore it later. Archived projects are hidden from the active list and become read-only. The project's Screening stage is archived alongside it."
      onClose={onClose}
    >
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
    if (!linkedId) { setErr('This project has no Screening stage to leave.'); return; }
    setBusy(true); setErr('');
    try { await screeningApi.leaveProject(linkedId); onDone(); }
    catch (e) { setErr(e.message || 'Could not leave the project.'); setBusy(false); }
  };
  return (
    <Modal title="Leave this project?" onClose={onClose}>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: C.txt2, lineHeight: 1.65 }}>
        You will lose access to <strong style={{ color: C.txt }}>{project.name}</strong> and its Screening stage.
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
    linked ? 'The project\'s Screening stage and all screening records' : null,
    'Extraction, PRISMA, analysis and screening data',
    'Access for all project members',
  ].filter(Boolean);
  return (
    <Modal title="Delete project" subtitle="This is a guarded, reversible-by-ops soft delete. It removes the project from everyone's workspace." onClose={onClose}>
      <div style={{
        background: alpha(C.red, 0.06), border: `1px solid ${alpha(C.red, 0.22)}`, borderRadius: 10,
        padding: '13px 15px', marginBottom: 18,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.red, marginBottom: 8 }}>
          This will remove
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.txt2, lineHeight: 1.75 }}>
          {consequences.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="del-confirm">
          Type{' '}
          <span style={{ textTransform: 'none', fontWeight: 700, color: C.txt, fontFamily: MONO }}>{project.name}</span>
          {' '}to confirm
        </label>
        <input id="del-confirm" autoFocus value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
               placeholder={project.name} style={inputStyle} />
      </div>
      {err && <div style={{ marginBottom: 14, fontSize: 12, color: C.red }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="danger" onClick={confirm} disabled={busy || !matches}
             style={{ opacity: matches ? 1 : 0.45, cursor: matches ? 'pointer' : 'not-allowed' }}>
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
    if (!linked || !linked.id) { setLoadErr('This project has no members to transfer ownership to yet.'); setLoading(false); return undefined; }
    let alive = true;
    (async () => {
      try {
        const res = await screeningApi.listMembers(linked.id);
        if (!alive) return;
        const all = (res && res.members) || [];
        const eligible = all.filter(m => m.status === 'active' && m.userId && !m.isOwner && m.role !== 'owner');
        setMembers(eligible);
      } catch (e) {
        if (alive) setLoadErr(e.message || 'Could not load project members.');
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
      subtitle={`Hand ${project.name || 'this project'} to another active member. You keep full leader access afterward and can leave the project later.`}
      onClose={onClose}
    >
      {loading ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: C.muted, fontSize: 12.5 }}>
          Loading project members…
        </div>
      ) : loadErr ? (
        <div style={{ marginBottom: 16, fontSize: 12.5, color: C.red }}>{loadErr}</div>
      ) : members.length === 0 ? (
        <div style={{
          padding: '18px 16px', borderRadius: 10, marginBottom: 18,
          background: C.card2, border: `1px solid ${C.brd}`,
          fontSize: 12.5, color: C.txt2, lineHeight: 1.6,
        }}>
          There are no other active members to transfer ownership to. Invite a collaborator to the project's
          Screening stage first, then return here to hand over ownership.
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
                  padding: '10px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: FONT,
                  background: active ? alpha(C.acc, 0.10) : C.card,
                  border: `1px solid ${active ? alpha(C.acc, 0.40) : C.brd2}`,
                  transition: 'background 0.12s ease, border-color 0.12s ease',
                }}
              >
                <span style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: alpha(C.acc, 0.14), color: C.acc, fontWeight: 700, fontSize: 13,
                  border: `1px solid ${alpha(C.acc, 0.22)}`,
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
                  transition: 'background 0.12s ease, border-color 0.12s ease',
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
               style={{ opacity: picked ? 1 : 0.45, cursor: picked ? 'pointer' : 'not-allowed' }}>
            {busy ? 'Transferring…' : 'Transfer ownership'}
          </Btn>
        )}
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Empty / loading / error states — Nextly soft illustration style
   ════════════════════════════════════════════════════════════════════════ */

function EmptyState({ icon, title, body, cta }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      style={{
        textAlign: 'center', padding: '64px 24px',
        border: `1.5px dashed ${C.brd2}`,
        borderRadius: 16, background: alpha(C.card, 0.5),
      }}
    >
      <div style={{
        width: 56, height: 56, margin: '0 auto 18px', borderRadius: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: alpha(C.acc, 0.10), color: C.acc,
        border: `1.5px solid ${alpha(C.acc, 0.20)}`,
      }}>
        <Icon name={icon} size={26} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 8, letterSpacing: '-0.01em' }}>{title}</div>
      <p style={{ margin: '0 auto 20px', maxWidth: 440, fontSize: 13, color: C.txt2, lineHeight: 1.7 }}>{body}</p>
      {cta}
    </motion.div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Filter chip
   ════════════════════════════════════════════════════════════════════════ */

function Chip({ active, onClick, children, count }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '6px 13px', borderRadius: 99, fontSize: 12.5, fontWeight: 600,
        fontFamily: FONT, cursor: 'pointer', whiteSpace: 'nowrap',
        background: active ? C.acc : C.card,
        color: active ? C.accText : C.txt2,
        border: `1.5px solid ${active ? C.acc : C.brd2}`,
        boxShadow: active ? `0 2px 10px ${alpha(C.acc, 0.22)}` : 'none',
        transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {children}
      <span style={{
        fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: 10.5, fontWeight: 700,
        padding: '0 6px', borderRadius: 99, lineHeight: '17px',
        background: active ? alpha(C.accText, 0.18) : C.card2,
        color: active ? C.accText : C.muted,
      }}>{count}</span>
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Recently-opened rail
   ════════════════════════════════════════════════════════════════════════ */

function RecentsRail({ items, onOpen, reduced }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: C.muted, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Icon name="clock" size={13} /> Recently opened
      </div>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {items.map((r, i) => (
          <motion.button
            key={r.id}
            onClick={() => onOpen(r)}
            title={r.name}
            initial={reduced ? { opacity: 1 } : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
            whileHover={reduced ? {} : { y: -2, boxShadow: `0 4px 14px ${C.shadow}` }}
            style={{
              flex: '0 0 auto', maxWidth: 220, display: 'flex', alignItems: 'center', gap: 9,
              padding: '9px 14px', borderRadius: 11, cursor: 'pointer', fontFamily: FONT,
              background: C.card, border: `1px solid ${C.brd}`, color: C.txt,
              boxShadow: `0 1px 3px ${C.shadow}`,
            }}
          >
            <span style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: alpha(C.acc, 0.12), color: C.acc,
              border: `1px solid ${alpha(C.acc, 0.20)}`,
            }}>
              <Icon name="folder" size={13} />
            </span>
            <span className="t-truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Divider / section label helpers
   ════════════════════════════════════════════════════════════════════════ */

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
      color: C.muted, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ flex: 1, height: 1, background: C.brd }} />
      {children}
      <span style={{ flex: 1, height: 1, background: C.brd }} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Main page component
   ════════════════════════════════════════════════════════════════════════ */

export default function ProjectLanding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const reduced = usePrefersReducedMotion();

  const [projects, setProjects]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  /* controls */
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState('all');
  const [sort, setSort]           = useState('modified');
  const [view, setView]           = useState('cards'); // 'cards' | 'table'
  const [showArchived, setShowArchived] = useState(false);

  /* ── Persisted dashboard view preferences (prompt23 Task 2) ───────
     Hydrate sort/filter/view/show-archived once auth is known, then write back on
     any change. SERVER prefs (User.dashboardPreferences) win for cross-device
     sync; localStorage is the instant + offline fallback. Writes go to both
     (localStorage immediately, server best-effort — same pattern as theme). */
  const prefsHydrated = useRef(false);
  useEffect(() => {
    let alive = true;
    prefsHydrated.current = false;
    (async () => {
      let saved = readDashboardPrefs(user?.id); // fast: local first
      try {
        const prof = await api.profile.get();
        const serverPrefs = prof?.user?.dashboardPreferences ? JSON.parse(prof.user.dashboardPreferences) : null;
        const clean = sanitizeDashboardPrefs(serverPrefs);
        if (Object.keys(clean).length) saved = { ...saved, ...clean }; // server wins
      } catch { /* offline / unauth → localStorage only */ }
      if (!alive) return;
      if (saved.sort) setSort(saved.sort);
      if (saved.filter) setFilter(saved.filter);
      if (saved.view) setView(saved.view);
      if (typeof saved.showArchived === 'boolean') setShowArchived(saved.showArchived);
      prefsHydrated.current = true;
    })();
    return () => { alive = false; };
  }, [user?.id]);
  useEffect(() => {
    if (!prefsHydrated.current) return; // don't clobber saved prefs with initial defaults
    const prefs = { sort, filter, view, showArchived };
    writeDashboardPrefs(user?.id, prefs);               // instant, per-browser
    api.profile.update({ dashboardPreferences: prefs }).catch(() => {}); // best-effort cross-device
  }, [user?.id, sort, filter, view, showArchived]);

  /* modals */
  const [modal, setModal] = useState(null); // { type, project? }

  /* recently-opened (localStorage-backed) */
  const [recents, setRecents] = useState(() => readRecents());
  const recordRecent = useCallback((p) => { setRecents(writeRecent(p)); }, []);

  /* ── Legacy /app?project=<id> deep-link ─────────────────────────── */
  useEffect(() => {
    try {
      const want = new URLSearchParams(window.location.search).get('project');
      if (want) navigate(`/app/project/${encodeURIComponent(want)}`, { replace: true });
    } catch { /* ignore */ }
  }, [navigate]);

  /* ── Load roster (always include archived; filter client-side) ─── */
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

  /* ── Debounce search ──────────────────────────────────────────── */
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 220);
    return () => clearTimeout(t);
  }, [searchRaw]);

  /* ── KPI counts ───────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const accessible = projects.filter(p => !p._archived);
    return {
      accessible: accessible.length,
      owned:      projects.filter(p => isOwnerOf(p) && !p._archived).length,
      lead:       projects.filter(p => roleOf(p) === 'leader' && !p._archived).length,
      active:     projects.filter(p => { const s = statusOf(p); return s === 'active' || s === 'in_progress'; }).length,
      // Screening underway — derived from lifecycle status, not link presence.
      inProgress: projects.filter(p => statusOf(p) === 'in_progress').length,
      archived:   projects.filter(p => p._archived).length,
    };
  }, [projects]);

  /* ── Per-chip counts (respect search + show-archived scope) ──── */
  const searchPool = useMemo(() => {
    const matchesSearch = (p) => {
      if (!search) return true;
      const hay = [
        p.name,
        p._owner && (p._owner.name || p._owner.email),
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
    for (const f of DASHBOARD_FILTERS) out[f.key] = searchPool.filter(f.test).length;
    return out;
  }, [searchPool]);

  /* ── Final visible list ───────────────────────────────────────── */
  const visible = useMemo(() => {
    const f = DASHBOARD_FILTERS.find(x => x.key === filter) || DASHBOARD_FILTERS[0];
    const s = SORTS.find(x => x.key === sort) || SORTS[0];
    const filtered = searchPool.filter(f.test);
    const cmp = sort === 'role'
      ? (a, b) => (ROLE_ORDER[roleOf(a)] ?? 9) - (ROLE_ORDER[roleOf(b)] ?? 9)
      : s.cmp;
    return [...filtered].sort(cmp);
  }, [searchPool, filter, sort]);

  /* ── Recently-opened (only ids still in the roster) ───────────── */
  const recentItems = useMemo(() => {
    if (!recents.length) return [];
    const byId = new Map(projects.map(p => [String(p.id), p]));
    return recents
      .filter(r => byId.has(r.id))
      .map(r => ({ id: r.id, name: (byId.get(r.id).name || r.name || 'Untitled project') }));
  }, [recents, projects]);

  /* ── Action handlers ──────────────────────────────────────────── */
  const handlers = useMemo(() => ({
    open:      (p) => { recordRecent(p); navigate(`/app/project/${encodeURIComponent(p.id)}`); },
    // prompt18 — "Screening" opens the project's in-app Screening stage (deep
    // link ?tab=screening); the workspace is auto-created there if missing.
    openSift:  (p) => { if (p && p.id) navigate(`/app/project/${encodeURIComponent(p.id)}?tab=screening`); },
    rename:    (p) => setModal({ type: 'rename', project: p }),
    archive:   (p) => setModal({ type: 'archive', project: p }),
    unarchive: async (p) => { try { await api.projects.unarchive(p.id); await reload(); } catch { setError('Could not unarchive the project.'); } },
    leave:     (p) => setModal({ type: 'leave', project: p }),
    transfer:  (p) => setModal({ type: 'transfer', project: p }),
    del:       (p) => setModal({ type: 'delete', project: p }),
  }), [navigate, reload, recordRecent]);

  const closeModal  = () => setModal(null);
  const afterMutation = async () => { setModal(null); await reload(); };

  /* ── Derived display flags ────────────────────────────────────── */
  const name = (user && user.name) || (user && user.email && user.email.split('@')[0]) || 'there';
  const hasAnyProject = projects.length > 0;
  const archivedExist = kpis.archived > 0;
  const activeVisibleEmpty = visible.length === 0;

  /* ── Grid animation key — changes when filter/search changes so
        cards re-enter on a meaningful content change, not on every
        hover or toggle of a non-structural control. ──────────────── */
  const gridKey = `${filter}-${search}-${showArchived}`;

  /* ════════════════════════════════════════════════════════════════
     Render
     ════════════════════════════════════════════════════════════════ */
  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <NotificationsBell fixed right={56} />
      <UserMenu context="metalab" fixed />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 32px 80px' }}>

        {/* ── Welcome header ──────────────────────────────────────── */}
        <motion.div
          variants={reduced ? reducedVariants : headerVariants}
          initial="hidden"
          animate="visible"
          style={{
            display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
            gap: 20, flexWrap: 'wrap', marginBottom: 32,
          }}
        >
          <div style={{ minWidth: 0 }}>
            {/* Nextly-style pretitle */}
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: C.acc, marginBottom: 6,
            }}>
              META·LAB Workspace
            </div>
            <h1 style={{
              margin: '0 0 6px', fontSize: 28, fontWeight: 800,
              letterSpacing: '-0.025em', color: C.txt, lineHeight: 1.15,
            }}>
              Welcome back, {name}
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: C.txt2, lineHeight: 1.55 }}>
              Choose a workspace to continue your evidence synthesis.
            </p>
          </div>
          <Btn
            variant="primary"
            onClick={() => setModal({ type: 'create' })}
            style={{ padding: '10px 22px', fontSize: 13.5, borderRadius: 10 }}
          >
            <Icon name="plus" size={16} /> New Project
          </Btn>
        </motion.div>

        {/* ── Error banner ─────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              key="err"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              style={{
                marginBottom: 22, padding: '12px 16px', borderRadius: 10, fontSize: 12.5,
                background: C.redBg, color: C.red,
                border: `1px solid ${alpha(C.red, 0.25)}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}
            >
              <span><Icon name="alert" size={14} style={{ marginRight: 7, verticalAlign: 'text-bottom' }} />{error}</span>
              <button
                onClick={reload}
                style={{
                  background: 'transparent', border: `1px solid ${alpha(C.red, 0.35)}`,
                  color: C.red, borderRadius: 7, padding: '4px 10px',
                  fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                }}
              >Retry</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── KPI tiles ────────────────────────────────────────────── */}
        {!loading && hasAnyProject && (
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{
              display: 'grid', gap: 12, marginBottom: 28,
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            }}
          >
            <KpiTile icon="folders"  label="Accessible"       value={kpis.accessible} color={C.acc}   reduced={reduced} />
            <KpiTile icon="user"     label="Owned"            value={kpis.owned}      color={C.gold}  reduced={reduced} />
            <KpiTile icon="award"    label="I lead"           value={kpis.lead}       color={C.purp}  reduced={reduced} />
            <KpiTile icon="activity" label="Active"           value={kpis.active}     color={C.grn}   reduced={reduced} />
            <KpiTile icon="filter"   label="In progress"      value={kpis.inProgress} color={C.teal}  reduced={reduced} />
            <KpiTile icon="layers"   label="Archived"         value={kpis.archived}   color={C.muted} reduced={reduced} />
          </motion.div>
        )}

        {/* ── Recently-opened rail ──────────────────────────────────── */}
        {!loading && hasAnyProject && (
          <RecentsRail items={recentItems} onOpen={(r) => handlers.open(r)} reduced={reduced} />
        )}

        {/* ── Control bar ──────────────────────────────────────────── */}
        {!loading && hasAnyProject && (
          <div style={{
            marginBottom: 24,
            background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14,
            padding: '16px 20px', boxShadow: `0 1px 4px ${C.shadow}`,
          }}>
            {/* row 1: search + sort + view toggle + show-archived */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>

              {/* search input */}
              <div style={{ position: 'relative', flex: '1 1 280px', minWidth: 220 }}>
                <span style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  color: C.muted, pointerEvents: 'none', lineHeight: 0,
                }}>
                  <Icon name="search" size={15} />
                </span>
                <input
                  value={searchRaw}
                  onChange={(e) => setSearchRaw(e.target.value)}
                  placeholder="Search title, owner, status…"
                  aria-label="Search projects"
                  style={{ ...inputStyle, paddingLeft: 36, borderRadius: 9 }}
                />
                {searchRaw && (
                  <button
                    onClick={() => setSearchRaw('')}
                    aria-label="Clear search"
                    style={{
                      position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
                      background: 'transparent', border: 'none', color: C.muted,
                      cursor: 'pointer', padding: 2, lineHeight: 0,
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>

              {/* sort */}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.txt2, flexShrink: 0 }}>
                <span style={{ fontWeight: 600, color: C.muted, fontSize: 11 }}>Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  style={{ ...inputStyle, width: 'auto', padding: '7px 10px', cursor: 'pointer', fontSize: 12.5 }}
                >
                  {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>

              {/* view toggle */}
              <div style={{
                display: 'inline-flex', background: C.card2,
                border: `1px solid ${C.brd}`, borderRadius: 9, padding: 2, flexShrink: 0,
              }}>
                {[{ k: 'cards', icon: 'grid', t: 'Card view' }, { k: 'table', icon: 'table', t: 'Table view' }].map(v => (
                  <button
                    key={v.k}
                    onClick={() => setView(v.k)}
                    title={v.t}
                    aria-label={v.t}
                    aria-pressed={view === v.k}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 30, borderRadius: 7, cursor: 'pointer', border: 'none',
                      background: view === v.k ? C.acc : 'transparent',
                      color: view === v.k ? C.accText : C.txt2,
                      boxShadow: view === v.k ? `0 1px 6px ${alpha(C.acc, 0.25)}` : 'none',
                      transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
                    }}
                  >
                    <Icon name={v.icon} size={15} />
                  </button>
                ))}
              </div>

              {/* show archived toggle */}
              <button
                onClick={() => setShowArchived(s => !s)}
                aria-pressed={showArchived}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 600,
                  fontFamily: FONT, cursor: 'pointer', flexShrink: 0,
                  background: showArchived ? alpha(C.acc, 0.10) : 'transparent',
                  color: showArchived ? C.acc : C.txt2,
                  border: `1px solid ${showArchived ? alpha(C.acc, 0.35) : C.brd2}`,
                  transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                }}
              >
                <Icon name={showArchived ? 'eye' : 'layers'} size={14} />
                Archived
                {kpis.archived > 0 && (
                  <span style={{
                    fontFamily: MONO, fontSize: 10.5, fontVariantNumeric: 'tabular-nums',
                    color: showArchived ? C.acc : C.muted,
                  }}>
                    {kpis.archived}
                  </span>
                )}
              </button>
            </div>

            {/* row 2: quick-filter chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {DASHBOARD_FILTERS.filter(f => f.key !== 'archived' || showArchived).map(f => (
                <Chip
                  key={f.key}
                  active={filter === f.key}
                  count={chipCounts[f.key] || 0}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {/* ── Body ────────────────────────────────────────────────── */}
        {loading ? (
          /* Loading skeleton shimmer */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ padding: '80px 0', textAlign: 'center' }}
          >
            <div style={{
              display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              color: C.muted, fontSize: 13,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: alpha(C.acc, 0.10), color: C.acc,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="folders" size={20} />
              </div>
              Loading your projects…
            </div>
          </motion.div>

        ) : !hasAnyProject ? (
          <EmptyState
            icon="folders"
            title="No projects yet"
            body="META·LAB is your evidence-synthesis workspace, with collaborative citation Screening built into every project. Create your first project to get started."
            cta={
              <Btn variant="primary" onClick={() => setModal({ type: 'create' })} style={{ margin: '0 auto' }}>
                <Icon name="plus" size={15} /> Create your first project
              </Btn>
            }
          />

        ) : activeVisibleEmpty ? (
          search ? (
            <EmptyState
              icon="search"
              title="No matching projects"
              body={`Nothing matches "${searchRaw.trim()}" in the current filter. Try a different term or clear the search.`}
              cta={
                <Btn variant="ghost" onClick={() => { setSearchRaw(''); setFilter('all'); }}>
                  Clear search &amp; filters
                </Btn>
              }
            />
          ) : (!showArchived && archivedExist) ? (
            <EmptyState
              icon="layers"
              title="Nothing active here"
              body={`Every project matching this filter is archived. You have ${kpis.archived} archived ${kpis.archived === 1 ? 'project' : 'projects'} hidden from the active view.`}
              cta={
                <Btn variant="primary" onClick={() => setShowArchived(true)}>
                  <Icon name="eye" size={15} /> Show archived
                </Btn>
              }
            />
          ) : (
            <EmptyState
              icon="filter"
              title="No projects in this filter"
              body='No projects match the selected quick-filter. Switch back to "All" to see everything you can access.'
              cta={<Btn variant="ghost" onClick={() => setFilter('all')}>Show all projects</Btn>}
            />
          )

        ) : view === 'table' ? (
          <motion.div
            key={`table-${gridKey}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <ProjectTable rows={visible} handlers={handlers} />
          </motion.div>

        ) : (
          /* Card grid with staggered entrance */
          <motion.div
            key={`grid-${gridKey}`}
            variants={reduced ? reducedVariants : gridContainerVariants}
            initial="hidden"
            animate="visible"
            style={{
              display: 'grid', gap: 18,
              gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
            }}
          >
            {visible.map(p => (
              <ProjectCard key={p.id} p={p} handlers={handlers} reduced={reduced} />
            ))}
          </motion.div>
        )}

        {/* ── Footer count ─────────────────────────────────────────── */}
        {!loading && hasAnyProject && !activeVisibleEmpty && (
          <div style={{
            marginTop: 24, textAlign: 'center',
            fontSize: 11.5, color: C.dim, fontFamily: MONO,
          }}>
            {visible.length} {visible.length === 1 ? 'project' : 'projects'}
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
      {modal && modal.type === 'rename'   && <RenameModal   project={modal.project} onClose={closeModal} onRenamed={afterMutation} />}
      {modal && modal.type === 'archive'  && <ArchiveModal  project={modal.project} onClose={closeModal} onDone={afterMutation} />}
      {modal && modal.type === 'leave'    && <LeaveModal    project={modal.project} onClose={closeModal} onDone={afterMutation} />}
      {modal && modal.type === 'transfer' && <TransferModal project={modal.project} onClose={closeModal} onDone={afterMutation} />}
      {modal && modal.type === 'delete'   && <DeleteModal   project={modal.project} onClose={closeModal} onDone={afterMutation} />}
    </div>
  );
}
