/**
 * META·LAB — Design tokens and shared style helpers
 *
 * Extracted verbatim from meta-lab-3-patched.jsx (the C object and helper
 * functions that appear ~line 971 in that file).  All components import
 * from here so the colour palette stays in a single place.
 */

/* ─── Colour palette ─────────────────────────────────────────────────── */
export const C = {
  bg:    "#060a12",   // deepest background
  surf:  "#0c1220",   // sidebar / elevated surface
  card:  "#111827",   // card background
  card2: "#162032",   // slightly lighter card for nesting
  brd:   "#1e2d42",   // border
  brd2:  "#253548",   // slightly lighter border
  acc:   "#38bdf8",   // sky blue accent
  acc2:  "#0ea5e9",   // deeper accent for hover
  grn:   "#34d399",   // emerald green
  grn2:  "#059669",   // deeper green
  yel:   "#fbbf24",   // amber
  red:   "#f87171",   // red
  purp:  "#a78bfa",   // violet
  txt:   "#e2e8f0",   // primary text
  txt2:  "#cbd5e1",   // secondary text
  muted: "#64748b",   // muted text
  dim:   "#374151",   // very dim
};

/* ─── Button style helper ────────────────────────────────────────────── */
/**
 * Returns an inline-style object for a button.
 * @param {'primary'|'ghost'|'danger'|'success'|string} v  variant
 */
export const btnS = (v = "primary") => ({
  padding: "7px 16px",
  borderRadius: 7,
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "'IBM Plex Sans', sans-serif",
  fontWeight: 600,
  transition:
    "transform 0.13s cubic-bezier(0.23,1,0.32,1), box-shadow 0.18s ease, filter 0.15s ease, background 0.18s ease, border-color 0.15s ease",
  letterSpacing: 0.3,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  ...(v === "primary"
    ? {
        background: `linear-gradient(135deg,${C.acc},${C.acc2})`,
        color: "#03070f",
        boxShadow: `0 1px 0 0 ${C.acc}44 inset, 0 2px 8px ${C.acc}28`,
      }
    : v === "ghost"
    ? {
        background: "transparent",
        color: C.muted,
        border: `1px solid ${C.brd2}`,
      }
    : v === "danger"
    ? {
        background: "transparent",
        color: C.red,
        border: `1px solid ${C.red}44`,
      }
    : v === "success"
    ? {
        background: `linear-gradient(135deg,${C.grn},${C.grn2})`,
        color: "#03070f",
        boxShadow: `0 2px 8px ${C.grn}28`,
      }
    : { background: C.card2, color: C.txt, border: `1px solid ${C.brd2}` }),
});

/* ─── Input style object ─────────────────────────────────────────────── */
export const inp = {
  background: C.surf,
  border: `1px solid ${C.brd}`,
  borderRadius: 7,
  padding: "8px 11px",
  color: C.txt,
  fontFamily: "'IBM Plex Sans', sans-serif",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

/* ─── Label style object ─────────────────────────────────────────────── */
export const lbl = {
  fontSize: 10,
  fontWeight: 700,
  color: C.muted,
  display: "block",
  marginBottom: 6,
  letterSpacing: 0.9,
  textTransform: "uppercase",
};

/* ─── Table-header style object ─────────────────────────────────────── */
export const th = {
  padding: "9px 12px",
  background: C.bg,
  color: C.muted,
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  textAlign: "right",
  borderBottom: `1px solid ${C.brd}`,
  whiteSpace: "nowrap",
};

/* ─── Tag / badge style helper ───────────────────────────────────────── */
/**
 * Returns an inline-style object for a small coloured tag.
 * @param {'green'|'red'|'yellow'|'blue'|'purple'|string} c  colour variant
 */
export const tagS = (c) => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 9px",
  borderRadius: 99,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.4,
  whiteSpace: "nowrap",
  ...(c === "green"
    ? { background: "#052e16", color: C.grn,  border: `1px solid ${C.grn}44`  }
    : c === "red"
    ? { background: "#3b0d12", color: C.red,  border: `1px solid ${C.red}44`  }
    : c === "yellow"
    ? { background: "#2d1f08", color: C.yel,  border: `1px solid ${C.yel}44`  }
    : c === "blue"
    ? { background: "#071e3d", color: C.acc,  border: `1px solid ${C.acc}44`  }
    : c === "purple"
    ? { background: "#160d30", color: C.purp, border: `1px solid ${C.purp}44` }
    : { background: C.card2,   color: C.muted, border: `1px solid ${C.brd}`   }),
});

/* ─── Global CSS string (inject once in your root component) ─────────── */
/**
 * Call this inside a <style> tag at the app root to get scrollbar styles,
 * animation keyframes, focus rings, etc.
 */
export const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;700&display=swap');

  :root {
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
    --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { background: #080c14; }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${C.brd}; border-radius: 99px; transition: background 0.2s ease; }
  ::-webkit-scrollbar-thumb:hover { background: ${C.muted}; }

  input, textarea, select { color-scheme: dark; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
  input:focus, textarea:focus, select:focus {
    outline: none !important;
    border-color: ${C.acc} !important;
    box-shadow: 0 0 0 3px ${C.acc}18 !important;
  }

  button:focus-visible, [role="button"]:focus-visible, .nav-item:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px ${C.acc}40;
    border-radius: 7px;
  }

  button {
    transition: transform 0.13s var(--ease-out), box-shadow 0.18s ease, filter 0.15s ease,
                background 0.18s ease, border-color 0.15s ease, opacity 0.15s ease;
  }
  button:active:not(:disabled) { transform: scale(0.97); }

  a { text-decoration: none; color: ${C.acc}; transition: opacity 0.12s ease; }
  a:hover { opacity: 0.8; }

  .nav-item { transition: background 0.14s ease, border-color 0.14s ease, transform 0.14s var(--ease-out); }

  .tab-content { animation: tabIn 0.2s var(--ease-out) both; }
  @keyframes tabIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  .stagger-grid > * { opacity: 0; animation: staggerIn 0.42s var(--ease-out) forwards; }
  .stagger-grid > *:nth-child(1) { animation-delay: 40ms; }
  .stagger-grid > *:nth-child(2) { animation-delay: 90ms; }
  .stagger-grid > *:nth-child(3) { animation-delay: 140ms; }
  .stagger-grid > *:nth-child(4) { animation-delay: 190ms; }
  .stagger-grid > *:nth-child(5) { animation-delay: 240ms; }
  .stagger-grid > *:nth-child(6) { animation-delay: 290ms; }
  .stagger-grid > *:nth-child(n+7) { animation-delay: 320ms; }
  @keyframes staggerIn { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }

  .hover-lift { transition: box-shadow 0.2s ease, transform 0.2s var(--ease-out), border-color 0.2s ease; }

  .stat-num { font-variant-numeric: tabular-nums; }
  .glow-acc { box-shadow: 0 0 20px ${C.acc}22; }
  .prog-bar { transition: width 0.4s var(--ease-out), background 0.3s ease; }

  .spin-ico { display: inline-block; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .pulse-soft { animation: pulseSoft 1.8s var(--ease-in-out) infinite; }
  @keyframes pulseSoft {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 ${C.acc}22; }
    50%       { transform: scale(1.04); box-shadow: 0 0 22px 2px ${C.acc}22; }
  }

  [title] { cursor: help; }

  details > summary { cursor: pointer; user-select: none; list-style: none; }
  details > summary::-webkit-details-marker { display: none; }

  .modal-bg { backdrop-filter: blur(4px); animation: modalBgIn 0.2s ease-out both; }
  @keyframes modalBgIn { from { opacity: 0; } to { opacity: 1; } }
  .modal-bg > div { animation: modalIn 0.24s var(--ease-out) both; transform-origin: center; }
  @keyframes modalIn { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }

  @media (hover: hover) and (pointer: fine) {
    button:hover:not(:disabled) { filter: brightness(1.08); }
    a:hover { opacity: 0.8; }
    .nav-item:hover { background: ${C.card} !important; transform: translateX(2px); }
    .hover-lift:hover { box-shadow: 0 6px 24px #00000044; transform: translateY(-1px); }
  }

  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .tab-content, .modal-bg > div, .stagger-grid > * { animation: rmFade 0.16s ease both; }
    .pulse-soft { animation: none; }
    button:active:not(:disabled) { transform: none; }
    .nav-item:hover { transform: none; }
    .hover-lift:hover { transform: none; }
  }
  @keyframes rmFade { from { opacity: 0; } to { opacity: 1; } }
`;
