/**
 * noteSignals.js — structured signal extraction from a reviewer's free-text note
 * (prompt49 item 1). Pure, deterministic, dependency-free.
 *
 * SECURITY: a reviewer note is UNTRUSTED user content. This module only ever runs
 * fixed regexes against a length-capped, lowercased copy of the note — it never
 * executes the note, never interpolates it into instructions, and the factors it
 * emits are FIXED category labels (never the raw note text). So prompt-injection
 * strings ("ignore previous instructions…") are inert: they match no category and
 * are surfaced as nothing. This makes the extraction safe to feed into the
 * explanation layer without echoing reviewer content or leaking it across tenants.
 *
 * It is deliberately CONSERVATIVE: a category fires only on clear phrases, so a
 * neutral note produces no signals (false negatives preferred over false claims).
 */

const MAX_NOTE_LEN = 4000; // untrusted input — cap before any processing

// Category → { polarity, label (fixed, safe), patterns }. polarity drives which
// side of the explanation a factor lands on; 'concern'/'uncertain'/'quality' are
// neutral (shown as context, not as include/exclude drivers).
const CATEGORIES = [
  { key: 'wrongPopulation', polarity: 'exclude', label: 'Reviewer noted a population mismatch',
    patterns: [/\bwrong population\b/, /\bpopulation (?:does ?n[o']?t|doesn'?t) match\b/, /\bnot (?:the )?(?:target )?population\b/, /\b(?:p(?:a?ediatric)|children|animal|in[ -]?vitro)\b.*\b(?:not|exclud)/] },
  { key: 'populationMatch', polarity: 'include', label: 'Reviewer confirmed the population matches',
    patterns: [/\b(?:correct|right|matching|relevant) population\b/, /\bpopulation matches\b/] },
  { key: 'wrongIntervention', polarity: 'exclude', label: 'Reviewer noted an intervention mismatch',
    patterns: [/\bwrong intervention\b/, /\bintervention (?:does ?n[o']?t|doesn'?t) match\b/, /\bdifferent (?:drug|intervention|treatment)\b/] },
  { key: 'interventionMatch', polarity: 'include', label: 'Reviewer confirmed the intervention matches',
    patterns: [/\b(?:correct|right|matching) intervention\b/, /\bintervention matches\b/] },
  { key: 'wrongComparator', polarity: 'exclude', label: 'Reviewer noted a comparator mismatch',
    patterns: [/\bwrong comparator\b/, /\bno comparator\b/, /\bcomparator (?:does ?n[o']?t|doesn'?t) match\b/] },
  { key: 'wrongOutcome', polarity: 'exclude', label: 'Reviewer noted an outcome mismatch',
    patterns: [/\bwrong outcome\b/, /\boutcome (?:does ?n[o']?t|doesn'?t) match\b/, /\bdoes ?n[o']?t report (?:the )?outcome\b/, /\bno (?:relevant )?outcome\b/] },
  { key: 'outcomeMatch', polarity: 'include', label: 'Reviewer confirmed the outcome is reported',
    patterns: [/\b(?:reports|reported|measures|measured) (?:the )?(?:relevant )?outcome\b/, /\boutcome matches\b/] },
  { key: 'studyDesignConcern', polarity: 'concern', label: 'Reviewer flagged a study-design concern',
    patterns: [/\bwrong (?:study )?design\b/, /\bnot (?:an? )?(?:rct|randomi[sz]ed|trial)\b/, /\bobservational\b.*\b(?:only|not eligible)\b/, /\bcase report\b/, /\b(?:narrative )?review\b.*\bexclud/] },
  { key: 'methodologicalLimitation', polarity: 'concern', label: 'Reviewer noted a methodological limitation',
    patterns: [/\bmethodological(?:ly)? (?:weak|flaw|limitation|concern|poor)\b/, /\bpoor (?:method|quality|design)\b/, /\bhigh risk of bias\b/, /\bflawed\b/] },
  { key: 'biasConcern', polarity: 'concern', label: 'Reviewer flagged a risk-of-bias concern',
    patterns: [/\b(?:risk of |selection |attrition |reporting |detection )?bias\b/, /\bconfound(?:ed|ing)\b/, /\bunblinded\b/] },
  { key: 'sampleSizeConcern', polarity: 'concern', label: 'Reviewer flagged a sample-size concern',
    patterns: [/\b(?:small|tiny|insufficient|low) sample\b/, /\bunderpowered\b/, /\bsmall (?:n|cohort|study)\b/, /\bsample size (?:too )?small\b/] },
  { key: 'duplicateConcern', polarity: 'exclude', label: 'Reviewer flagged a possible duplicate',
    patterns: [/\bduplicate\b/, /\balready (?:included|screened|in)\b/, /\bsame (?:study|cohort|trial) as\b/] },
  { key: 'wrongSetting', polarity: 'exclude', label: 'Reviewer noted the wrong setting',
    patterns: [/\bwrong (?:setting|country|context)\b/, /\bnot (?:the )?(?:right )?setting\b/] },
  { key: 'wrongLanguage', polarity: 'exclude', label: 'Reviewer noted a language exclusion',
    patterns: [/\bwrong language\b/, /\bnot (?:in )?english\b/, /\blanguage (?:barrier|exclusion)\b/] },
  { key: 'wrongPublicationType', polarity: 'exclude', label: 'Reviewer noted the wrong publication type',
    patterns: [/\b(?:editorial|commentary|letter|conference abstract|protocol|erratum|retract)\b/, /\bwrong (?:publication|article) type\b/] },
  { key: 'reasonInclude', polarity: 'include', label: 'Reviewer gave a reason to include',
    patterns: [/\b(?:should|to) include\b/, /\beligible\b/, /\bmeets (?:the )?(?:inclusion )?criteria\b/, /\brelevant\b.*\binclud/] },
  { key: 'reasonExclude', polarity: 'exclude', label: 'Reviewer gave a reason to exclude',
    patterns: [/\b(?:should|to) exclude\b/, /\bineligible\b/, /\bdoes ?n[o']?t meet\b/, /\bnot relevant\b/, /\bout of scope\b/, /\birrelevant\b/] },
  { key: 'uncertainty', polarity: 'uncertain', label: 'Reviewer expressed uncertainty',
    patterns: [/\b(?:unsure|uncertain|not sure|unclear|maybe|possibly|need(?:s)? (?:full[- ]?text|more info)|hard to tell|borderline|check)\b/, /\?\?/] },
  { key: 'qualityObservation', polarity: 'quality', label: 'Reviewer made a quality observation',
    patterns: [/\b(?:high|low|good|poor|excellent) quality\b/, /\bwell[- ]conducted\b/, /\brigorous\b/] },
];

/**
 * Extract structured signals from ONE reviewer note.
 * @param {string|null|undefined} note
 * @returns {{ hasContent:boolean, flags:Record<string,boolean>, factors:Array<{key,polarity,label}>, length:number }}
 */
export function extractNoteSignals(note) {
  if (note == null) return { hasContent: false, flags: {}, factors: [], length: 0 };
  const text = String(note).slice(0, MAX_NOTE_LEN).toLowerCase();
  const trimmed = text.trim();
  if (!trimmed) return { hasContent: false, flags: {}, factors: [], length: 0 };

  const flags = {};
  const factors = [];
  for (const cat of CATEGORIES) {
    if (cat.patterns.some((re) => re.test(text))) {
      flags[cat.key] = true;
      factors.push({ key: cat.key, polarity: cat.polarity, label: cat.label });
    }
  }
  return { hasContent: true, flags, factors, length: trimmed.length };
}

/** The full list of category keys (for tests / docs). */
export const NOTE_SIGNAL_KEYS = CATEGORIES.map((c) => c.key);
