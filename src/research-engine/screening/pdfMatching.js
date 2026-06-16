/**
 * pdfMatching.js — match a PDF to the correct screening record (roadmap 1.4).
 *
 * Pure, framework-free. Given identifiers extracted from a PDF (filename hints
 * and/or any provided metadata) and a list of records, returns ranked candidate
 * matches with a confidence in [0,1] and an explainable `matchedBy` reason.
 *
 * Guiding rule: a WRONG attachment is worse than no attachment. Only high-
 * confidence matches should auto-attach; the rest go to a review/unmatched queue.
 */
import { normalizeTitle, titleSimilarity } from './deduplication.js';

/** Confidence thresholds (roadmap 1.4). */
export const AUTO_ATTACH_THRESHOLD = 0.90;
export const REVIEW_THRESHOLD = 0.70;

/** Map a confidence to a disposition. */
export function classifyMatch(confidence) {
  if (confidence >= AUTO_ATTACH_THRESHOLD) return 'auto';
  if (confidence >= REVIEW_THRESHOLD) return 'review';
  return 'unmatched';
}

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/i;

/** Normalise a DOI for comparison (lower-case, strip URL prefix + trailing punctuation). */
export function normalizeDoi(doi) {
  return String(doi || '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .trim().toLowerCase()
    .replace(/[.,;)\]]+$/, '');
}

/**
 * Pull identifiers/hints out of a PDF filename. Publishers and reference
 * managers often encode the DOI or PMID in the filename; "/" is commonly
 * replaced by "_" so we try that recovery too.
 * @param {string} filename
 * @returns {{ doi: string, pmid: string, year: string, titleHint: string }}
 */
export function extractIdentifiersFromFilename(filename) {
  const name = String(filename || '').replace(/\.[a-z0-9]{1,5}$/i, ''); // drop extension
  let doi = '';
  const direct = name.match(DOI_RE);
  if (direct) doi = normalizeDoi(direct[1]);
  if (!doi) {
    // recover "10.1000_abc123" → "10.1000/abc123"
    const us = name.match(/\b(10\.\d{4,9})_(\S+)/);
    if (us) doi = normalizeDoi(us[1] + '/' + us[2]);
  }
  // Normalise separators so \b word-boundaries work (underscore is a \w char,
  // which would otherwise swallow the boundary around years/pmids).
  const spaced = name.replace(/[._\-]+/g, ' ');
  let pmid = '';
  const pm = spaced.match(/pmid[\s:]?\s*(\d{1,8})/i); // require the "pmid" prefix to stay safe
  if (pm) pmid = pm[1];
  const ym = spaced.match(/\b(19|20)\d{2}\b/);
  const year = ym ? ym[0] : '';
  // Title hint: strip identifiers, collapse to words.
  const titleHint = spaced
    .replace(DOI_RE, ' ').replace(/pmid[\s:]?\s*\d{1,8}/i, ' ')
    .replace(/\s+/g, ' ').trim();
  return { doi, pmid, year, titleHint };
}

/**
 * Rank records by how well they match a PDF descriptor.
 * @param {{doi?:string, pmid?:string, title?:string, year?:string, filename?:string}} pdf
 * @param {Array<{id, doi?, pmid?, title?, year?}>} records
 * @returns {Array<{ recordId, confidence, matchedBy, disposition }>} sorted desc by confidence
 */
export function matchPdfToRecords(pdf, records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const hints = pdf.filename ? extractIdentifiersFromFilename(pdf.filename) : { doi: '', pmid: '', year: '', titleHint: '' };
  const doi = normalizeDoi(pdf.doi || hints.doi);
  const pmid = String(pdf.pmid || hints.pmid || '').trim();
  const title = pdf.title || hints.titleHint || '';
  const year = String(pdf.year || hints.year || '').trim();
  const ntitle = normalizeTitle(title);

  const scored = records.map(r => {
    // 1) Exact DOI — strongest signal.
    if (doi && normalizeDoi(r.doi) && normalizeDoi(r.doi) === doi) {
      return { recordId: r.id, confidence: 0.99, matchedBy: 'doi' };
    }
    // 2) Exact PMID.
    if (pmid && String(r.pmid || '').trim() && String(r.pmid).trim() === pmid) {
      return { recordId: r.id, confidence: 0.96, matchedBy: 'pmid' };
    }
    // 3) Title similarity (+ small bonus when the year also matches).
    if (ntitle && r.title) {
      const sim = titleSimilarity(title, r.title);
      if (sim >= 0.70) {
        const yearMatch = year && String(r.year || '').trim() === year;
        // Map sim∈[0.70,1] onto a capped confidence; year agreement nudges up.
        let conf = Math.min(0.95, sim) + (yearMatch ? 0.03 : 0);
        conf = Math.min(0.95, conf);
        return { recordId: r.id, confidence: conf, matchedBy: yearMatch ? 'title+year' : 'title' };
      }
    }
    return { recordId: r.id, confidence: 0, matchedBy: 'none' };
  });

  return scored
    .filter(s => s.confidence > 0)
    .map(s => ({ ...s, disposition: classifyMatch(s.confidence) }))
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Best single match for a PDF, or null when nothing clears the review floor.
 * Returns the top candidate plus whether it is safe to auto-attach.
 */
export function bestPdfMatch(pdf, records) {
  const ranked = matchPdfToRecords(pdf, records);
  const top = ranked[0];
  if (!top || top.confidence < REVIEW_THRESHOLD) return null;
  // Guard against ambiguity: if the runner-up is nearly as good and neither is a
  // hard-id match, demote to review rather than auto-attaching the wrong PDF.
  const runnerUp = ranked[1];
  const ambiguous = runnerUp && top.matchedBy.startsWith('title') &&
    (top.confidence - runnerUp.confidence) < 0.05;
  return {
    ...top,
    disposition: ambiguous ? 'review' : top.disposition,
    candidates: ranked.slice(0, 5),
  };
}
