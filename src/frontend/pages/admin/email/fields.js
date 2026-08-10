/**
 * email/fields.js — pure helpers for the Ops › Email package (112.md follow-up).
 *
 * Dependency-free on purpose: the editor's draft ↔ structured-fields mapping and
 * the delivery-status vocabulary are the two things unit tests must pin without
 * rendering anything.
 *
 * PARAGRAPH ENCODING. `bodyParagraphs` is an array whose members may contain
 * single '\n' line breaks (the registry uses them for "copy and paste this
 * link:\n[link]"). The editor therefore joins paragraphs with a BLANK line and
 * splits on runs of 2+ newlines — a single Enter stays inside a paragraph, a
 * blank line starts a new one. No default paragraph contains '\n\n', so the
 * round-trip is lossless for every registry template.
 */

export const PARAGRAPH_SEPARATOR = '\n\n';

/** bodyParagraphs array → the editor textarea text. */
export function paragraphsToText(paragraphs) {
  return (Array.isArray(paragraphs) ? paragraphs : []).join(PARAGRAPH_SEPARATOR);
}

/** Editor textarea text → bodyParagraphs array (blank paragraphs dropped). */
export function textToParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '');
}

/** One editor draft from a merged template view (effectiveFields). */
export function draftFromTemplate(template) {
  const f = (template && template.effectiveFields) || {};
  return {
    subject: String(f.subject || ''),
    heading: String(f.heading || ''),
    bodyText: paragraphsToText(f.bodyParagraphs),
    ctaLabel: String(f.ctaLabel || ''),
    ctaHref: String(f.ctaHref || ''),
    footerNote: String(f.footerNote || ''),
  };
}

/** Editor draft → the structured fields object the PUT/preview endpoints take. */
export function fieldsFromDraft(draft) {
  const d = draft || {};
  return {
    subject: String(d.subject || ''),
    heading: String(d.heading || ''),
    bodyParagraphs: textToParagraphs(d.bodyText),
    ctaLabel: String(d.ctaLabel || ''),
    ctaHref: String(d.ctaHref || ''),
    footerNote: String(d.footerNote || ''),
  };
}

/** Every status the outbox pipeline can leave a row in (server DELIVERY_STATUSES). */
export const DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped_disabled', 'skipped_unconfigured'];

/** Human labels — the two skip states must say WHY the email did not go out. */
export const DELIVERY_STATUS_LABELS = {
  pending: 'pending',
  sending: 'sending',
  sent: 'sent',
  failed: 'failed',
  skipped_disabled: 'skipped (disabled)',
  skipped_unconfigured: 'skipped (no SMTP)',
};

export function deliveryStatusLabel(status) {
  return DELIVERY_STATUS_LABELS[status] || String(status || 'unknown');
}
