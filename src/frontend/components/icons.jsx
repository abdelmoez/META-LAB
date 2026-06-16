/**
 * icons.jsx — the app-wide monochrome icon system (prompt7 Task 10).
 *
 * Inline SVG, 24×24 viewBox, stroke `currentColor`, uniform 1.7 stroke
 * width, round caps/joins. Icons inherit color from the surrounding
 * text so they work in both night and day themes with zero extra code.
 *
 * Usage:  <Icon name="bell" size={16} />
 *         <Icon name="forest" size={14} style={{ color: C.muted }} />
 *
 * Add new glyphs to ICON_PATHS only — keep them single-color line work
 * (no fills except the few small `fill="currentColor"` dots).
 */

const ICON_PATHS = {
  /* ── navigation / system ─────────────────────────────────────────── */
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.2V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.2" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </>
  ),
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2.2 2.4H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  ),
  folders: (
    <>
      <path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h3l1.8 2H20a1.5 1.5 0 0 1 1.5 1.5V15" />
      <path d="M2.5 10A1.5 1.5 0 0 1 4 8.5h3.4l1.8 2h7.3A1.5 1.5 0 0 1 18 12v6.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V10Z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M2.8 19.5c.5-3.2 3-5 6.2-5s5.7 1.8 6.2 5" />
      <path d="M15.4 5.8a3 3 0 1 1 1.2 5.8" />
      <path d="M17.5 14.7c2.3.5 3.6 2.2 3.9 4.8" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h8" /><path d="M16.5 7H20" /><circle cx="14" cy="7" r="2.2" />
      <path d="M4 17h4" /><path d="M12.5 17H20" /><circle cx="10" cy="17" r="2.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.2 12a7.2 7.2 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2-1.2L14.3 3h-4l-.4 2.6a7.3 7.3 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.2 7.2 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.3 7.3 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z" />
    </>
  ),
  shield: (
    <path d="M12 3l7 2.8v5.4c0 4.5-2.9 8.2-7 9.8-4.1-1.6-7-5.3-7-9.8V5.8L12 3Z" />
  ),
  shieldCheck: (
    <>
      <path d="M12 3l7 2.8v5.4c0 4.5-2.9 8.2-7 9.8-4.1-1.6-7-5.3-7-9.8V5.8L12 3Z" />
      <path d="M8.8 11.8l2.3 2.4 4.2-4.6" />
    </>
  ),
  bell: (
    <>
      <path d="M18 10.2c0-3.5-2.7-6.2-6-6.2s-6 2.7-6 6.2c0 4.8-1.9 6-1.9 6h15.8s-1.9-1.2-1.9-6Z" />
      <path d="M10.3 19.8a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  chat: (
    <path d="M21 14.5a2 2 0 0 1-2 2H8.2L3 20.8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9.5Z" />
  ),
  menu: (
    <>
      <path d="M4 6.5h16" />
      <path d="M4 12h16" />
      <path d="M4 17.5h16" />
    </>
  ),
  send: (
    <>
      <path d="M21.5 2.5 11 13" />
      <path d="M21.5 2.5 14.8 21l-3.8-8-8-3.7L21.5 2.5Z" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7.5 12 13l8.5-5.5" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5" />
      <path d="M16 16.5 20.5 12 16 7.5" />
      <path d="M20.5 12H9.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
    </>
  ),
  moon: (
    <path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.4a7 7 0 0 0 10 10.1Z" />
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.2 10.5V7.3a3.8 3.8 0 0 1 7.6 0v3.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.8" />
      <path d="M16 16l5 5" />
    </>
  ),
  /* ── actions ─────────────────────────────────────────────────────── */
  check: <path d="M4.5 12.8l4.8 4.7L19.5 6.5" />,
  x: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  pencil: (
    <path d="M16.7 3.8l3.5 3.5L8 19.5 3.5 20.5l1-4.5L16.7 3.8Z" />
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.2 7V5.4A1.4 1.4 0 0 1 10.6 4h2.8a1.4 1.4 0 0 1 1.4 1.4V7" />
      <path d="M6.5 7l.9 12.2a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.5 7" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="M7.2 10.2 12 15l4.8-4.8" />
      <path d="M4 16.5V18a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-1.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 14.5v-11" />
      <path d="M7.2 8.3 12 3.5l4.8 4.8" />
      <path d="M4 16.5V18a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-1.5" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.8a4.5 4.5 0 0 0 6.6.3l2.8-2.8a4.5 4.5 0 0 0-6.3-6.3l-1.5 1.5" />
      <path d="M13.8 10.2a4.5 4.5 0 0 0-6.6-.3l-2.8 2.8a4.5 4.5 0 0 0 6.3 6.3l1.5-1.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 11.5A8.5 8.5 0 1 0 18 17.6" />
      <path d="M20.5 6.5v5h-5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 14.5H4.8A1.8 1.8 0 0 1 3 12.7V4.8A1.8 1.8 0 0 1 4.8 3h7.9a1.8 1.8 0 0 1 1.8 1.8v.7" />
    </>
  ),
  chevronRight: <path d="M9 5.5l6.5 6.5L9 18.5" />,
  chevronLeft: <path d="M15 5.5 8.5 12 15 18.5" />,
  chevronDown: <path d="M5.5 9 12 15.5 18.5 9" />,
  arrowRight: (
    <>
      <path d="M4 12h15.5" />
      <path d="M13.5 6 19.5 12l-6 6" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M20 12H4.5" />
      <path d="M10.5 6 4.5 12l6 6" />
    </>
  ),
  /* ── status ──────────────────────────────────────────────────────── */
  alert: (
    <>
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.8" r="0.4" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.4" fill="currentColor" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 7.2V12l3.4 2" />
    </>
  ),
  /* ── research workflow ───────────────────────────────────────────── */
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.7" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V6a1.5 1.5 0 0 0-1.5-1.5H15" />
      <rect x="9" y="2.8" width="6" height="3.4" rx="1" />
      <path d="M8.5 11h7M8.5 15h5" />
    </>
  ),
  fileText: (
    <>
      <path d="M6.5 2.8h7.2L19 8.1V19.7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.7V4.3a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M13.5 3v5.4H19" />
      <path d="M8.5 13h7M8.5 17h5.5" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="1.8" />
      <path d="M3 9.8h18M9.8 4.5v15" />
    </>
  ),
  flow: (
    <>
      <circle cx="6" cy="5.2" r="2.1" />
      <circle cx="6" cy="18.8" r="2.1" />
      <circle cx="18" cy="8.5" r="2.1" />
      <path d="M6 7.3v9.4" />
      <path d="M18 10.6c0 3.4-3.2 4.6-6 4.6H8.5" />
    </>
  ),
  sigma: <path d="M17.5 5.5H7l6 6.5-6 6.5h10.5" />,
  forest: (
    <>
      <path d="M14.5 3v18" />
      <path d="M4 7h7" /><rect x="6.2" y="5.9" width="2.2" height="2.2" fill="currentColor" stroke="none" />
      <path d="M7 12h10" /><rect x="10.6" y="10.9" width="2.2" height="2.2" fill="currentColor" stroke="none" />
      <path d="M9 17h11" /><rect x="13" y="15.9" width="2.2" height="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  activity: <path d="M2.5 12.5h4l2.7-7.5 4.4 14 2.9-8h5" />,
  layers: (
    <>
      <path d="M12 3 21 8l-9 5-9-5 9-5Z" />
      <path d="M3.5 12.5 12 17l8.5-4.5" />
      <path d="M3.5 16.5 12 21l8.5-4.5" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="5.3" />
      <path d="M8.7 13.4 7.2 21l4.8-2.4L16.8 21l-1.5-7.6" />
    </>
  ),
  checkSquare: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M8 12.4l2.9 3 5.3-6.2" />
    </>
  ),
  bookOpen: (
    <>
      <path d="M2.5 4.5h6A3.5 3.5 0 0 1 12 8v12.5a3 3 0 0 0-3-3H2.5V4.5Z" />
      <path d="M21.5 4.5h-6A3.5 3.5 0 0 0 12 8v12.5a3 3 0 0 1 3-3h6.5V4.5Z" />
    </>
  ),
  barChart: <path d="M5 20v-7M12 20V4.5M19 20v-10" />,
  scale: (
    <>
      <path d="M12 4v16.5M7.5 20.5h9" />
      <path d="M5 7.5h14" />
      <path d="M5 7.5 2.5 13a2.9 2.9 0 0 0 5 0L5 7.5ZM19 7.5 16.5 13a2.9 2.9 0 0 0 5 0L19 7.5Z" />
    </>
  ),
  flask: (
    <>
      <path d="M9.2 3h5.6" />
      <path d="M10 3v5.8L4.6 18.6A1.9 1.9 0 0 0 6.3 21.5h11.4a1.9 1.9 0 0 0 1.7-2.9L14 8.8V3" />
      <path d="M7.5 15.5h9" />
    </>
  ),
  hexagon: (
    <path d="M12 2.7 20 7.3v9.4l-8 4.6-8-4.6V7.3l8-4.6Z" />
  ),
  diamond: <path d="M12 4.2 19 12l-7 7.8L5 12l7-7.8Z" />,
  filter: (
    <path d="M3.5 5h17l-6.7 7.8v5.7l-3.6 2V12.8L3.5 5Z" />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M3.3 12h17.4M12 3.3c2.4 2.3 3.6 5.2 3.6 8.7s-1.2 6.4-3.6 8.7c-2.4-2.3-3.6-5.2-3.6-8.7s1.2-6.4 3.6-8.7Z" />
    </>
  ),
  // rob.md — RoB judgement glyphs (low / some / high / NA). Paired with colour
  // AND a text label everywhere (never colour alone) for color-blind safety.
  circleCheck: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="m8.3 12 2.6 2.6 4.8-5" />
    </>
  ),
  alertTriangle: (
    <>
      <path d="M12 3.6 21 19.4H3L12 3.6Z" />
      <path d="M12 9.8v4.2M12 16.8h.02" />
    </>
  ),
  alertOctagon: (
    <>
      <path d="M8.1 3.3h7.8l5.5 5.5v7.8l-5.5 5.5H8.1L2.6 16.6V8.8L8.1 3.3Z" />
      <path d="M12 8v4.6M12 16.2h.02" />
    </>
  ),
  minus: <path d="M5 12h14" />,
};

export const ICON_NAMES = Object.keys(ICON_PATHS);

export function Icon({ name, size = 16, strokeWidth = 1.7, style, className, title }) {
  const glyph = ICON_PATHS[name];
  if (!glyph) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: 'middle', ...style }}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
}

export default Icon;
