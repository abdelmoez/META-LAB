/**
 * features/manuscript/ContinuousView.jsx — 118.md §10-§19, §43, §45, §60, §64-§65.
 *
 * The Continuous Document View: the WHOLE manuscript as ONE scrollable document
 * (title → abstract → body sections → declarations → references), inside the ONE
 * `.ms-paper` page the Editor already owns.
 *
 * What this file is NOT (118.md §13/§61): a second manuscript state. It renders the
 * SAME draft, through the SAME `RichSectionEditor` contract, committed through the
 * SAME `m.updateSection` → queueEdit path as Section View. `editorProps(sectionId)`
 * is handed in by the panel and is the identical prop factory Section View mounts
 * its single editor from, so "editing works the same in both views" (§18) is
 * structural rather than maintained by hand. Nothing here holds manuscript text.
 *
 * Document, not dashboard (§11/§14): one page column, real heading hierarchy, and a
 * per-section chrome row that is deliberately SUBORDINATE — small, quiet, no card
 * borders — so the eye reads prose, not eight stacked panels.
 *
 * Ink: everything inside the paper uses LITERAL paper colours (the page is white in
 * both themes — see RICH_EDITOR_CSS), never `var(--t-*)`. Theme tokens belong to the
 * application chrome around the page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SECTION_TYPES, STATEMENT_TYPES, JOURNAL_TEMPLATES, sectionStatus,
} from '../../research-engine/manuscript/index.js';
import { RichSectionEditor } from './richEditor/RichSectionEditor.jsx';
import { AbstractEditor } from './richEditor/AbstractEditor.jsx';

/* ── the document's own ink (literal — the page is white in both themes) ──────── */
export const INK = {
  text: '#1c2330',
  mid: '#4c566b',
  soft: '#98a1b3',
  rule: '#e2e6ee',
  amber: '#8a5a00',
  amberBg: 'rgba(214,158,46,0.12)',
  green: '#1e7a46',
  greenBg: 'rgba(30,122,70,0.10)',
  slateBg: 'rgba(15,23,42,0.05)',
  link: '#2450b3',
};

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'IBM Plex Sans',sans-serif";

/** The sections that carry prose in the document body (title/abstract lead it). */
export const BODY_SECTIONS = SECTION_TYPES.filter((s) => s.id !== 'title' && s.id !== 'abstract');

/** Every section the continuous document anchors, in reading order. */
export const DOC_SECTION_IDS = SECTION_TYPES.map((s) => s.id);

/** Attribute that marks a scroll/observe anchor: `[data-ms-section="methods"]`. */
export const MS_SECTION_ATTR = 'data-ms-section';
export const msSectionSelector = (id) => `[${MS_SECTION_ATTR}="${id}"]`;

/** Test id of one section block in the document. */
export const docSectionTestId = (id) => `stitch-manuscript-doc-${id}`;

/* ══════════ 118.md §15-§17 — scrolling that respects the sticky toolbar ══════════ */

/** 118.md §58 — read the OS setting at call time (no state, no listener needed). */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try { return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * The element that actually scrolls this document — the shell's main scroller in
 * Stitch, the workspace's own scroll div in the legacy shell, or null when the
 * page itself scrolls. Found by walking up rather than hard-coding a test id, so
 * the same code is correct in both shells and inside Focus Mode.
 */
export function nearestScroller(el) {
  if (!el || typeof window === 'undefined' || !window.getComputedStyle) return null;
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    let overflowY = '';
    try { overflowY = window.getComputedStyle(node).overflowY || ''; } catch { overflowY = ''; }
    if (/(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * 118.md §17 — the viewport y below which content is actually readable: the bottom
 * edge of the sticky manuscript toolbar (which is what would otherwise hide the
 * heading). Read from the LIVE bar rather than a constant because its height is
 * responsive (§41) and Focus Mode moves it; one workspace renders per page, so the
 * test id is an unambiguous handle. Falls back to the scroller's own top edge.
 */
export function stickyFloor(el) {
  if (typeof document === 'undefined') return 0;
  const bar = document.querySelector('[data-testid="stitch-manuscript-header"]');
  if (bar && typeof bar.getBoundingClientRect === 'function') {
    const r = bar.getBoundingClientRect();
    if (r.height > 0) return r.bottom;
  }
  const scroller = nearestScroller(el);
  if (scroller && typeof scroller.getBoundingClientRect === 'function') return scroller.getBoundingClientRect().top;
  return 0;
}

/** Breathing room between the sticky bar and the heading it must not hide (§17). */
export const SCROLL_GAP = 12;

/**
 * 118.md §15 — the height of the sticky manuscript toolbar, tracked live.
 *
 * "The manuscript section navigation should remain visible in Continuous View" is
 * only true if the outline is ALSO sticky, and it can only stick below the toolbar
 * if it knows how tall that toolbar currently is — which changes with the
 * responsive density (§41) and with Focus Mode. Measured rather than assumed, and
 * re-measured on resize; 0 until it is known, which degrades to a non-sticky
 * outline instead of one pinned to the wrong place.
 */
export function useStickyBarHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const read = () => {
      const bar = document.querySelector('[data-testid="stitch-manuscript-header"]');
      setH(bar ? Math.round(bar.getBoundingClientRect().height) : 0);
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      if (typeof window === 'undefined') return undefined;
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const bar = document.querySelector('[data-testid="stitch-manuscript-header"]');
    const ro = new ResizeObserver(read);
    if (bar) ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  return h;
}

/**
 * 118.md §15/§41 — the editor row's own width, tracked with ResizeObserver (the
 * ManuscriptToolbar precedent: the rails, the pinned drawer and Focus Mode all
 * change this width without changing the viewport, so a media query would answer
 * the wrong question).
 */
export function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setWidth(Math.round(el.clientWidth || 0));
    read();
    if (typeof ResizeObserver === 'undefined') {
      if (typeof window === 'undefined') return undefined;
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * Below this the editor's three columns WRAP (outline 216 + gap 18 + the document
 * column's 460px flex basis), and the outline stops being a column beside the
 * document — it becomes a block above it. A sticky element there would hang over
 * the prose instead of beside it, so the pinning is disabled and the outline simply
 * scrolls with the page. Measured against the ROW, never the viewport.
 */
export const OUTLINE_STICKY_MIN_WIDTH = 700;

/**
 * 118.md §15/§17 — scroll a section anchor to just below the sticky toolbar.
 *
 * Deliberately `scrollBy` on the real scroller instead of `scrollIntoView`: only an
 * explicit delta can account for a sticky bar that overlaps the top of the scroll
 * box (`scrollIntoView({block:'start'})` puts the heading UNDER the bar, which is
 * exactly what §17 forbids).
 */
export function scrollSectionIntoView(el, opts = {}) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false;
  const behavior = (opts.instant || prefersReducedMotion()) ? 'auto' : 'smooth';
  const delta = Math.round(el.getBoundingClientRect().top - stickyFloor(el) - SCROLL_GAP);
  if (!Number.isFinite(delta)) return false;
  const scroller = nearestScroller(el);
  const target = scroller || (typeof window !== 'undefined' ? window : null);
  if (!target) return false;
  if (typeof target.scrollBy === 'function') target.scrollBy({ top: delta, left: 0, behavior });
  else if (scroller) scroller.scrollTop += delta;
  return true;
}

/** Scroll to a section id inside `rootEl` (the paper). Returns false when absent. */
export function scrollToSectionId(rootEl, id, opts) {
  if (!rootEl || typeof rootEl.querySelector !== 'function') return false;
  const el = rootEl.querySelector(msSectionSelector(id));
  return el ? scrollSectionIntoView(el, opts) : false;
}

/**
 * 118.md §16 — which section the reader is currently in, from IntersectionObserver.
 *
 * The rule is "the topmost section intersecting a thin band just under the sticky
 * toolbar", and it is jitter-free BY CONSTRUCTION rather than by damping: at a
 * boundary both neighbours intersect the band, the topmost (the one still being
 * read) wins, and the switch happens exactly once — when the outgoing section's
 * bottom edge passes above the band. When NOTHING intersects (scrolled past the
 * last section into the declarations/references blocks) the active section is
 * KEPT, never cleared: a reader who scrolls off the end has not left Conclusions.
 *
 * No IntersectionObserver (old browser, SSR, jsdom-less tests) → the hook does
 * nothing and the indicator stays click-driven, which is the documented fallback.
 */
export function useActiveSectionObserver(rootRef, { enabled, onActive, suppressRef, deps = '' }) {
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const root = rootRef.current;
    if (!root || typeof root.querySelectorAll !== 'function') return undefined;
    const nodes = Array.from(root.querySelectorAll(`[${MS_SECTION_ATTR}]`));
    if (!nodes.length) return undefined;

    const scroller = nearestScroller(root);
    const viewH = scroller ? scroller.clientHeight : (typeof window !== 'undefined' ? window.innerHeight : 0);
    const rootTop = scroller && typeof scroller.getBoundingClientRect === 'function'
      ? scroller.getBoundingClientRect().top : 0;
    // The band starts under the toolbar and is a third of the visible height —
    // deep enough that a short section still crosses it, shallow enough that the
    // active item means "what I am reading", not "what is somewhere on screen".
    const top = Math.max(0, Math.round(stickyFloor(root) - rootTop));
    const band = Math.max(120, Math.round((viewH || 800) * 0.33));
    const bottom = Math.max(0, Math.round((viewH || 800) - top - band));

    const byId = new Map();
    for (const n of nodes) byId.set(n.getAttribute(MS_SECTION_ATTR), n);
    const seen = new Set(); // the sections currently crossing the reading band

    /* Tops are re-measured HERE rather than taken from the entries: two entries can
       be recorded milliseconds apart during a scroll, and comparing positions from
       different moments is how "topmost" quietly becomes wrong. */
    const topOf = (el) => ((el && typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect().top : null);
    const apply = () => {
      let bestId = null;
      let bestTop = Infinity;
      for (const id of seen) {
        const t = topOf(byId.get(id));
        if (t != null && t < bestTop) { bestTop = t; bestId = id; }
      }
      if (!bestId) {
        /* Nothing is crossing the band — the reader has scrolled PAST the last
           section, into the declarations or the bibliography. They have not left the
           section they scrolled off the end of, so the last one that started wins;
           at the very top of the document nothing has started and the indicator is
           left exactly as it was. */
        const floor = stickyFloor(root);
        let lastTop = -Infinity;
        for (const [id, el] of byId) {
          const t = topOf(el);
          if (t != null && t <= floor && t > lastTop) { lastTop = t; bestId = id; }
        }
      }
      if (bestId && onActiveRef.current) onActiveRef.current(bestId);
    };

    let deferred = null;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = e.target.getAttribute(MS_SECTION_ATTR);
        if (!id) continue;
        if (e.isIntersecting) seen.add(id);
        else seen.delete(id);
      }
      /* A programmatic scroll owns the active section until it settles (§17): the
         sections it flies past must not steal the indicator from its destination.
         The update is DEFERRED, never dropped — the last crossing of a smooth scroll
         usually happens inside the window, and swallowing it would leave the
         indicator pointing at wherever the reader came from. */
      const until = (suppressRef && suppressRef.current) || 0;
      if (Date.now() < until) {
        if (deferred) clearTimeout(deferred);
        deferred = setTimeout(apply, (until - Date.now()) + 60);
        return;
      }
      apply();
    }, { root: scroller || null, rootMargin: `-${top}px 0px -${bottom}px 0px`, threshold: 0 });

    nodes.forEach((n) => io.observe(n));
    return () => { if (deferred) clearTimeout(deferred); io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deps]);
}

/* ══════════ small presentational pieces ══════════ */

function DocPill({ tone = 'slate', title, children, testid }) {
  const paint = tone === 'amber'
    ? { color: INK.amber, background: INK.amberBg }
    : tone === 'green'
      ? { color: INK.green, background: INK.greenBg }
      : { color: INK.mid, background: INK.slateBg };
  return (
    <span data-testid={testid} title={title}
      style={{
        ...paint, display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
        borderRadius: 99, padding: '0 7px', height: 16,
        font: `700 9.5px/16px ${SANS}`, letterSpacing: 0.3, textTransform: 'uppercase',
      }}>
      {children}
    </span>
  );
}

function DocAction({ onClick, testid, title, ariaLabel, ariaPressed, ariaExpanded, children }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid} title={title}
      aria-label={ariaLabel} aria-pressed={ariaPressed} aria-expanded={ariaExpanded}
      style={{
        border: '1px solid transparent', background: 'transparent', color: INK.mid,
        borderRadius: 6, padding: '1px 6px', cursor: 'pointer',
        font: `600 10.5px/16px ${SANS}`, whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}

/**
 * 118.md §11/§14 — the per-section chrome. It carries the section's real state
 * (auto-draft / edited / outdated / locked) and its three actions, but it is
 * TYPOGRAPHICALLY subordinate to the heading below it: 10px sans on a white page,
 * no card, no border. The document still reads as a document.
 */
function SectionChrome({ sectionId, label, section, outdated, onRegenerate, onToggleLock, onToggleWhy, whyOpen }) {
  const status = sectionStatus(section || {});
  const locked = !!(section && section.locked);
  return (
    <div data-testid={`stitch-manuscript-doc-chrome-${sectionId}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        borderTop: `1px solid ${INK.rule}`, paddingTop: 7, marginTop: 30, marginBottom: 4,
      }}>
      <span style={{ font: `700 9.5px/16px ${SANS}`, letterSpacing: 0.6, textTransform: 'uppercase', color: INK.soft }}>
        {label}
      </span>
      {status === 'ai-draft' && <DocPill tone="amber">Auto-draft</DocPill>}
      {status === 'edited' && <DocPill tone="green">Edited</DocPill>}
      {outdated && (
        <DocPill tone="amber" testid={`stitch-manuscript-doc-outdated-${sectionId}`}
          title="Project data changed since this was generated">Outdated</DocPill>
      )}
      {locked && (
        <DocPill testid={`stitch-manuscript-doc-locked-${sectionId}`}
          title="Locked — editing and generation skip this section">Locked</DocPill>
      )}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {outdated && !locked && (
          <DocAction testid={`stitch-manuscript-doc-regenerate-${sectionId}`}
            title="Regenerate this section from the latest project data"
            ariaLabel={`Regenerate ${label}`}
            onClick={() => onRegenerate && onRegenerate(sectionId)}>Regenerate</DocAction>
        )}
        <DocAction testid={`stitch-manuscript-doc-lock-${sectionId}`}
          ariaPressed={locked}
          ariaLabel={locked ? `Unlock ${label}` : `Lock ${label}`}
          title={locked ? 'Unlock this section — editing and regeneration become available again' : 'Lock this section — read-only, and generation always skips it'}
          onClick={() => onToggleLock && onToggleLock(sectionId, !locked)}>{locked ? 'Unlock' : 'Lock'}</DocAction>
        <DocAction testid={`stitch-manuscript-doc-why-${sectionId}`}
          ariaExpanded={!!whyOpen}
          ariaLabel={`Why does ${label} say this?`}
          title="Show what this section was generated from and what it depends on"
          onClick={() => onToggleWhy && onToggleWhy(sectionId)}>Why?</DocAction>
      </span>
    </div>
  );
}

/* ══════════ 118.md §11 / r3 — THE title block, used by BOTH views ══════════
 *
 * The manuscript's title + keywords are plain inputs (a title has no rich
 * structure). Section View and Continuous View used to render two hand-maintained
 * copies of this markup — one in literal hex, one in INK — and a review flagged the
 * obvious: two copies of the same UI drift. This is the single copy. INK is
 * canonical because the page is literally white in both themes (RICH_EDITOR_CSS),
 * so the theme tokens the surrounding chrome uses would be wrong here.
 *
 * State stays with the CALLER: each view already owns a controlled buffer for the
 * title (Section View's `titleBuf`, this file's `title`) with its own remount rule,
 * and this component must not become a third place manuscript text can live. It
 * renders and reports; it stores nothing.
 *
 * @param {string} value     current title text (the caller's buffer)
 * @param {string} keywords  current comma-separated keyword string
 * @param {boolean} locked   the title section's lock — disables both inputs
 * @param {function} onTitle (text) => void
 * @param {function} onKeywords (rawText, parsedList) => void — the caller keeps its
 *        own raw buffer AND persists the parsed list; the parse lives here so the
 *        two views can never disagree about what "comma-separated" means.
 */
export function TitleBlock({ value, keywords, locked = false, onTitle, onKeywords }) {
  return (
    <div data-testid="stitch-manuscript-title-block">
      <input
        value={value}
        onChange={(e) => { if (locked) return; onTitle && onTitle(e.target.value); }}
        placeholder="Full manuscript title…"
        disabled={locked}
        aria-label="Manuscript title"
        data-testid="stitch-manuscript-title-input"
        style={{
          width: '100%', border: 'none', outline: 'none', background: 'transparent',
          color: INK.text, fontFamily: SERIF, fontSize: 22, fontWeight: 700,
          lineHeight: 1.45, textAlign: 'center', boxSizing: 'border-box',
        }} />
      <div style={{ borderTop: `1px solid ${INK.rule}`, marginTop: 14, paddingTop: 10 }}>
        <div style={{
          font: `700 10px/1.6 ${SANS}`, letterSpacing: 0.6, textTransform: 'uppercase',
          color: INK.soft, marginBottom: 2,
        }}>
          Keywords (comma-separated)
        </div>
        <input
          value={keywords}
          onChange={(e) => {
            const raw = e.target.value;
            onKeywords && onKeywords(raw, raw.split(',').map((s) => s.trim()).filter(Boolean));
          }}
          placeholder="e.g. systematic review, meta-analysis, …"
          aria-label="Keywords"
          disabled={locked}
          style={{
            width: '100%', border: 'none', outline: 'none', background: 'transparent',
            color: INK.text, fontFamily: SERIF, fontSize: 14, boxSizing: 'border-box',
          }} />
      </div>
    </div>
  );
}

/** A real document heading (§11) — not a card title. */
function DocHeading({ children }) {
  return (
    <h2 style={{
      margin: '0 0 10px', textAlign: 'center', fontFamily: SERIF,
      fontSize: 19, fontWeight: 700, lineHeight: 1.3, color: INK.text,
    }}>
      {children}
    </h2>
  );
}

/**
 * 118.md §11 — the declarations, in the document, where they are printed. Compact
 * on purpose: these are one-line statements, and the Export destination keeps the
 * full form. Writes go through the SAME `m.setStatement` path (§13).
 */
function DocStatements({ m, required }) {
  const stored = m.activeDraft.statements || {};
  const [buf, setBuf] = useState(() => ({ ...stored }));
  useEffect(() => { setBuf({ ...((m.activeDraft && m.activeDraft.statements) || {}) }); }, [m.activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const reqSet = new Set(required || []);
  return (
    <section data-testid="stitch-manuscript-continuous-statements" style={{ marginTop: 34 }}>
      <DocHeading>Declarations</DocHeading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STATEMENT_TYPES.map((st) => {
          const isReq = reqSet.has(st.id);
          const empty = !String(buf[st.id] || '').trim();
          return (
            <label key={st.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{
                flex: '0 0 148px', font: `700 10px/1.6 ${SANS}`, letterSpacing: 0.4,
                textTransform: 'uppercase', color: isReq && empty ? INK.amber : INK.soft,
              }}>
                {st.label}{isReq ? ' *' : ''}
              </span>
              <input
                value={buf[st.id] || ''}
                onChange={(e) => { const v = e.target.value; setBuf((b) => ({ ...b, [st.id]: v })); m.setStatement(st.id, v); }}
                placeholder={isReq ? 'Required by this template…' : 'Optional…'}
                aria-label={st.label}
                data-testid={`stitch-manuscript-doc-statement-${st.id}`}
                style={{
                  flex: '1 1 240px', minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                  borderBottom: `1px solid ${INK.rule}`, color: INK.text, fontFamily: SERIF,
                  fontSize: 13.5, padding: '2px 0', boxSizing: 'border-box',
                }} />
            </label>
          );
        })}
      </div>
      <div style={{ font: `400 10.5px/1.6 ${SANS}`, color: INK.soft, marginTop: 8 }}>
        Required statements depend on the journal template. They are exported verbatim.
      </div>
    </section>
  );
}

/**
 * 118.md §11/§21 — the bibliography, RENDERED, at the end of the document, exactly
 * where the reader expects it. Read-only on purpose: the reference LIBRARY is the
 * References destination's job (§21 "References should remain the central PecanRev
 * reference manager"), and a second editable copy here would be a second answer to
 * "what does this reference say". The numbers are derived from the citation order
 * in the prose above, so this block updates as the text does.
 */
function DocReferences({ references, onOpenReferences }) {
  const rows = Array.isArray(references) ? references : [];
  return (
    <section data-testid="stitch-manuscript-continuous-references" style={{ marginTop: 34 }}>
      <DocHeading>References</DocHeading>
      {rows.length === 0 ? (
        <div style={{ font: `400 12px/1.7 ${SANS}`, color: INK.soft }}>
          No references yet — they appear here as you cite them, and as included studies are added.
        </div>
      ) : (
        <ol data-testid="stitch-manuscript-continuous-reference-list"
          style={{ margin: 0, paddingLeft: 26, fontFamily: SERIF, fontSize: 13, lineHeight: 1.75, color: INK.text }}>
          {rows.map((r) => (
            <li key={r.id} data-testid={`stitch-manuscript-continuous-reference-${r.id}`} style={{ marginBottom: 4 }}>
              {r.text}
            </li>
          ))}
        </ol>
      )}
      <div style={{ font: `400 10.5px/1.6 ${SANS}`, color: INK.soft, marginTop: 10 }}>
        Numbering follows the citation order in the text above.{' '}
        <button type="button" onClick={onOpenReferences}
          data-testid="stitch-manuscript-continuous-references-open"
          style={{
            border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
            color: INK.link, font: `600 10.5px/1.6 ${SANS}`, textDecoration: 'underline',
          }}>
          Add, edit or import references in the References tab
        </button>.
      </div>
    </section>
  );
}

/* ══════════ the document ══════════ */

/**
 * @param {object}   m             the ONE manuscript handle (state lives there).
 * @param {function} editorProps   (sectionId) => props for RichSectionEditor. The
 *                                 SAME factory Section View mounts from — §13/§18.
 * @param {function} abstractProps () => props for AbstractEditor.
 * @param {function} renderWhy     (sectionId, section) => node — the §84 provenance
 *                                 card, owned by the panel (it is shared with
 *                                 Section View), rendered here per section.
 * @param {function} onActiveSection (id) => void — scroll-driven active section (§16).
 * @param {object}   suppressRef   shared "a programmatic scroll is in flight" latch.
 */
export function ContinuousView({
  m, editorProps, abstractProps, renderWhy,
  onActiveSection, suppressRef, onRegenerate, onToggleLock, onOpenReferences,
  stickyOffset = 0,
}) {
  const draft = m.activeDraft || {};
  const sections = draft.sections || {};
  const outdated = m.outdated || {};
  const rootRef = useRef(null);
  const [whyOpen, setWhyOpen] = useState(null);
  const toggleWhy = (id) => setWhyOpen((cur) => (cur === id ? null : id));

  // Title + keywords are plain inputs (a title has no rich structure), buffered
  // locally and committed through the same paths Section View uses.
  const titleSection = sections.title || {};
  const [title, setTitle] = useState(titleSection.content || '');
  const [kw, setKw] = useState((draft.keywords || []).join(', '));
  useEffect(() => {
    setTitle(((m.activeDraft.sections || {}).title || {}).content || '');
    setKw((m.activeDraft.keywords || []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.activeId, titleSection.lastGeneratedAt]);
  const titleLocked = !!titleSection.locked;

  const requiredStatements = useMemo(() => {
    const tpl = JOURNAL_TEMPLATES.find((t) => t.id === draft.templateId);
    return (tpl && tpl.requiredStatements) || [];
  }, [draft.templateId]);

  // 118.md §16 — the observer is rebuilt when the mounted section SET changes; it
  // is not rebuilt on every keystroke (the anchors are stable DOM nodes).
  useActiveSectionObserver(rootRef, {
    enabled: true,
    onActive: onActiveSection,
    suppressRef,
    // The reading band is measured from the toolbar, so a toolbar that changes
    // height (responsive density, Focus Mode) rebuilds the observer rather than
    // leaving the band a row out of place.
    deps: `${m.activeId}:${stickyOffset}:${DOC_SECTION_IDS.join(',')}`,
  });

  return (
    <div ref={rootRef} data-testid="stitch-manuscript-continuous" className="ms-page-body">
      {/* ── title block (§11) ── */}
      <section data-ms-section="title" data-testid={docSectionTestId('title')}
        style={{ marginBottom: 4 }}>
        <TitleBlock
          value={title}
          keywords={kw}
          locked={titleLocked}
          onTitle={(v) => { setTitle(v); m.updateSection('title', v); }}
          onKeywords={(raw, list) => { setKw(raw); m.setMetaDebounced({ keywords: list }); }} />
      </section>

      {/* ── abstract (§11 — structured subsections, the same editor as Section View) ── */}
      <section data-ms-section="abstract" data-testid={docSectionTestId('abstract')}>
        <SectionChrome sectionId="abstract" label="Abstract" section={sections.abstract}
          outdated={!!outdated.abstract} onRegenerate={onRegenerate} onToggleLock={onToggleLock}
          onToggleWhy={toggleWhy} whyOpen={whyOpen === 'abstract'} />
        <DocHeading>Abstract</DocHeading>
        {whyOpen === 'abstract' && renderWhy && renderWhy('abstract', sections.abstract || {})}
        <AbstractEditor {...abstractProps()} />
      </section>

      {/* ── body (§11/§60) ── */}
      {BODY_SECTIONS.map((s) => {
        const sec = sections[s.id] || {};
        // `mountKey` is the editor's own remount identity (section + generation
        // stamp): the DOM is rendered from props exactly ONCE per key, so it must
        // be applied as the React key here, not merely spread as a prop.
        const props = editorProps(s.id);
        return (
          <section key={s.id} data-ms-section={s.id} data-testid={docSectionTestId(s.id)}>
            <SectionChrome sectionId={s.id} label={s.label} section={sec}
              outdated={!!outdated[s.id]} onRegenerate={onRegenerate} onToggleLock={onToggleLock}
              onToggleWhy={toggleWhy} whyOpen={whyOpen === s.id} />
            <DocHeading>{s.label}</DocHeading>
            {whyOpen === s.id && renderWhy && renderWhy(s.id, sec)}
            <RichSectionEditor key={props.mountKey} ref={props.apiRef} {...props} />
          </section>
        );
      })}

      <DocStatements m={m} required={requiredStatements} />
      <DocReferences references={m.references} onOpenReferences={onOpenReferences} />
    </div>
  );
}

export default ContinuousView;
