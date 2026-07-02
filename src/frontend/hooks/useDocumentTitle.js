/**
 * useDocumentTitle.js — 65.md NAV-2: per-route browser tab titles.
 *
 * Every authenticated route used to show the single static index.html title;
 * multi-tab research work (several projects/stages open at once) was
 * indistinguishable in the tab bar. Sets `<title>` to "<parts> — PecanRev"
 * and restores the previous title on unmount so surfaces that manage their
 * own title (Landing, BetaWaitlist) are never clobbered after navigation.
 */
import { useEffect } from 'react';

export const TITLE_SUFFIX = 'PecanRev';

/** Compose a tab title from parts, skipping blanks: buildTitle('Screening', 'My SR') */
export function buildTitle(...parts) {
  const clean = parts.map((p) => String(p == null ? '' : p).trim()).filter(Boolean);
  return clean.length ? `${clean.join(' · ')} — ${TITLE_SUFFIX}` : TITLE_SUFFIX;
}

export function useDocumentTitle(...parts) {
  const title = buildTitle(...parts);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
}
