/**
 * betaWaitlist.js — the SINGLE source of truth for the Beta Waitlist domain
 * (prompt48). Dependency-free (no JSX, no Node/browser globals) so it can be
 * imported by BOTH the React public form / Ops console (client) AND the Express
 * waitlist service (server), mirroring the countries.js / editableUserFields.js
 * pattern. The server runs validateApplication() as the AUTHORITATIVE check; the
 * client mirrors it only for instant inline feedback.
 *
 * HARD RULES enforced here:
 *   - validateApplication() WHITELISTS keys → prevents mass assignment. Status,
 *     timestamps, internal notes, email-delivery fields, ids are NEVER accepted
 *     from a request; they are server-owned.
 *   - Email is normalised to a trimmed lowercase address; normalizedEmail is what
 *     the unique index + dedupe compare on (case-insensitive uniqueness).
 *   - Every option field is validated against a closed allow-list.
 */

import { COUNTRY_OPTIONS, countryNameForCode } from './countries.js';

// ── Email ────────────────────────────────────────────────────────────────────
// Pragmatic RFC-5321-ish check (same shape as editableUserFields.EMAIL_RE) plus a
// hard length cap (SMTP max is 254). Deliberately not trying to be a full parser.
export const WAITLIST_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LEN = 254;

export function normalizeEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

export function isValidEmail(email) {
  const e = String(email == null ? '' : email).trim();
  return e.length > 0 && e.length <= MAX_EMAIL_LEN && WAITLIST_EMAIL_RE.test(e);
}

// ── Closed option lists (closed allow-lists for validation) ────────────────────
export const WAITLIST_ROLES = [
  'Student',
  'PhD candidate',
  'Postdoctoral researcher',
  'Researcher',
  'Faculty / Principal investigator',
  'Clinician / physician',
  'Librarian / information specialist',
  'Statistician / methodologist',
  'Research assistant / coordinator',
  'Industry / pharma researcher',
  'Independent researcher',
  'Other',
];

export const RESEARCH_EXPERIENCE_LEVELS = [
  'Student / in training',
  'Early career (0–5 years)',
  'Mid career (5–15 years)',
  'Senior (15+ years)',
];

export const ANNUAL_REVIEW_VOLUMES = [
  'None yet',
  '1–2 per year',
  '3–5 per year',
  '6–10 per year',
  'More than 10 per year',
];

export const WORKING_STYLES = ['Individual', 'Research team'];

export const TEAM_SIZES = ['Just me', '2–5', '6–10', '11–25', 'More than 25'];

// Maps to real PecanRev capabilities (no invented features).
export const WAITLIST_INTERESTS = [
  'Search strategy building',
  'Title & abstract screening',
  'Data extraction',
  'Risk of bias assessment',
  'Meta-analysis & forest plots',
  'Team collaboration',
  'Reporting & export (PRISMA)',
  'AI-assisted screening',
];

export const PRIMARY_USES = [
  'Systematic review',
  'Meta-analysis',
  'Scoping review',
  'Literature review',
  'Guideline / policy review',
  'Teaching / training',
  'Evaluating the platform',
  'Other',
];

export const REFERRAL_SOURCES = [
  'Search engine',
  'Colleague / word of mouth',
  'Social media',
  'Conference or talk',
  'Academic publication',
  'Newsletter / email',
  'Other',
];

// ── 54.md Part 3 — questionnaire fields from WhatToCollectFromUsers.docx ────────
// These map the document's high-signal onboarding questions onto the waitlist.
// All are OPTIONAL (the doc: "make all fields optional except Country"); each is
// validated against a closed allow-list when present.

// doc Q2 — primary field of research.
export const WAITLIST_FIELDS = [
  'Medicine',
  'Nursing',
  'Pharmacy',
  'Public health',
  'Dentistry',
  'Psychology',
  'Social sciences',
  'Environmental science',
  'Other',
];

// doc Q5 — type of institution.
export const WAITLIST_INSTITUTION_TYPES = [
  'University',
  'Hospital or health system',
  'Research institute',
  'Contract research organization (CRO)',
  'Government agency',
  'Non-governmental organization (NGO)',
  'Independent',
  'Industry',
];

// doc Q4 — competitive-intelligence signal. "Not sure" is a first-class answer.
export const WAITLIST_COVIDENCE = ['Yes', 'No', 'Not sure'];

// doc Q6 — number of systematic reviews completed before (lifetime; distinct from
// RESEARCH_EXPERIENCE_LEVELS [career stage] and ANNUAL_REVIEW_VOLUMES [per year]).
export const WAITLIST_PRIOR_REVIEW_COUNTS = [
  'This is my first',
  '1–2',
  '3–5',
  'More than 5',
];

// doc Q7 — tool used for the last review (switching-friction signal).
export const WAITLIST_PRIOR_TOOLS = [
  'This is my first review',
  'Rayyan',
  'Covidence',
  'Excel only',
  'DistillerSR',
  'Other',
];

// Lifecycle status model. WAITLISTED is the only status the submit path may set.
export const WAITLIST_STATUSES = [
  'WAITLISTED',
  'UNDER_REVIEW',
  'INVITED',
  'ACCEPTED',
  'DECLINED',
  'REMOVED',
];
export const DEFAULT_WAITLIST_STATUS = 'WAITLISTED';

export const WAITLIST_STATUS_LABELS = {
  WAITLISTED: 'Waitlisted',
  UNDER_REVIEW: 'Under review',
  INVITED: 'Invited',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  REMOVED: 'Removed',
};

// Confirmation-email delivery states (server-owned).
export const EMAIL_STATUSES = ['pending', 'queued', 'sent', 'failed', 'skipped'];

// Field length caps (characters). Server truncates/normalises to these.
export const WAITLIST_MAX = {
  name: 100,
  institution: 200,
  customRole: 100,
  message: 2000,
  notes: 5000,
  referralOther: 120,
};

// Current consent copy version — bump when the consent wording changes so a record
// always records WHICH consent text the applicant agreed to.
export const CONSENT_VERSION = '2026-06-26'; // 54.md two-layer consent

// ── Helpers ────────────────────────────────────────────────────────────────────
export function isValidStatus(s) {
  return WAITLIST_STATUSES.includes(s);
}

const inList = (list, v) => typeof v === 'string' && list.includes(v);

// Collapse runs of whitespace, trim, cap length — for single-line fields.
function cleanStr(v, max) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Strip ASCII control characters EXCEPT tab (\t) and newline (\n) so stored
// free-text stays render-safe without flattening intentional line breaks.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function isKnownCountryCode(code) {
  if (typeof code !== 'string') return false;
  const c = code.trim().toUpperCase();
  return COUNTRY_OPTIONS.some((o) => o.code === c);
}

/**
 * validateApplication — the authoritative validator for a public waitlist
 * submission. Returns:
 *   { ok:true, value }  — `value` is a SANITISED, WHITELISTED object safe to pass
 *                         to the repository (no status/notes/timestamps/ids).
 *   { ok:false, errors }— `errors` maps fieldName → human message (accessible
 *                         inline errors); a top-level `_` key holds form-wide errors.
 *
 * The same function runs on the client (instant feedback) and the server
 * (source of truth). Unknown keys in `payload` are ignored — never copied.
 */
export function validateApplication(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const errors = {};
  const value = {};

  // Email (required)
  const email = String(p.email == null ? '' : p.email).trim();
  if (!email) errors.email = 'Email is required.';
  else if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
  else {
    value.email = email;
    value.normalizedEmail = normalizeEmail(email);
  }

  // Names (OPTIONAL — 54.md: only email + country + consent are required; the doc
  // assumes identity is known post-signup, but a cold waitlist still benefits from
  // a name to address invitees, so we collect it lightly without requiring it).
  const firstName = cleanStr(p.firstName, WAITLIST_MAX.name);
  const lastName = cleanStr(p.lastName, WAITLIST_MAX.name);
  if (firstName) value.firstName = firstName;
  if (lastName) value.lastName = lastName;

  // Institution NAME (OPTIONAL — the doc flags institution name as too sensitive
  // for a first impression; institution TYPE is the high-signal question instead).
  const institutionName = cleanStr(p.institutionName, WAITLIST_MAX.institution);
  if (institutionName) value.institutionName = institutionName;
  // Optional normalized institution identifier (ROR id), when the client resolved one.
  const rorId = cleanStr(p.institutionRorId, 64);
  if (rorId) value.institutionRorId = rorId;

  // Role (OPTIONAL, closed list — doc Q1) + optional custom role
  if (p.role != null && p.role !== '') {
    if (!inList(WAITLIST_ROLES, p.role)) {
      errors.role = 'Select a valid professional or academic role.';
    } else {
      value.role = p.role;
      // Conditional requirement: if you choose "Other", tell us what it is.
      if (p.role === 'Other') {
        const customRole = cleanStr(p.customRole, WAITLIST_MAX.customRole);
        if (!customRole) errors.customRole = 'Tell us your role.';
        else value.customRole = customRole;
      }
    }
  }

  // Country (REQUIRED — doc Q3, GDPR — must be a real ISO alpha-2)
  const countryCode = typeof p.countryCode === 'string' ? p.countryCode.trim().toUpperCase() : '';
  if (!countryCode) {
    errors.countryCode = 'Select your country.';
  } else if (!isKnownCountryCode(countryCode)) {
    errors.countryCode = 'Select a valid country.';
  } else {
    value.countryCode = countryCode;
    value.countryName = countryNameForCode(countryCode) || '';
  }

  // ── 54.md questionnaire fields (all OPTIONAL, validated-if-present) ──
  // doc Q2 — primary field
  if (p.primaryField != null && p.primaryField !== '') {
    if (!inList(WAITLIST_FIELDS, p.primaryField)) errors.primaryField = 'Select a valid field.';
    else value.primaryField = p.primaryField;
  }
  // doc Q5 — institution type
  if (p.institutionType != null && p.institutionType !== '') {
    if (!inList(WAITLIST_INSTITUTION_TYPES, p.institutionType)) errors.institutionType = 'Select a valid institution type.';
    else value.institutionType = p.institutionType;
  }
  // doc Q4 — Covidence license
  if (p.covidenceLicense != null && p.covidenceLicense !== '') {
    if (!inList(WAITLIST_COVIDENCE, p.covidenceLicense)) errors.covidenceLicense = 'Select Yes, No, or Not sure.';
    else value.covidenceLicense = p.covidenceLicense;
  }
  // doc Q6 — prior review count
  if (p.priorReviewCount != null && p.priorReviewCount !== '') {
    if (!inList(WAITLIST_PRIOR_REVIEW_COUNTS, p.priorReviewCount)) errors.priorReviewCount = 'Select a valid number of completed reviews.';
    else value.priorReviewCount = p.priorReviewCount;
  }
  // doc Q7 — last review tool
  if (p.lastReviewTool != null && p.lastReviewTool !== '') {
    if (!inList(WAITLIST_PRIOR_TOOLS, p.lastReviewTool)) errors.lastReviewTool = 'Select a valid tool.';
    else value.lastReviewTool = p.lastReviewTool;
  }

  // Primary intended use (OPTIONAL, closed list)
  if (p.primaryUse != null && p.primaryUse !== '') {
    if (!inList(PRIMARY_USES, p.primaryUse)) errors.primaryUse = 'Select a valid primary intended use.';
    else value.primaryUse = p.primaryUse;
  }

  // ── Optional, validated-if-present fields ──
  if (p.researchExperienceLevel != null && p.researchExperienceLevel !== '') {
    if (!inList(RESEARCH_EXPERIENCE_LEVELS, p.researchExperienceLevel)) {
      errors.researchExperienceLevel = 'Select a valid experience level.';
    } else value.researchExperienceLevel = p.researchExperienceLevel;
  }

  if (p.annualReviewVolume != null && p.annualReviewVolume !== '') {
    if (!inList(ANNUAL_REVIEW_VOLUMES, p.annualReviewVolume)) {
      errors.annualReviewVolume = 'Select a valid review volume.';
    } else value.annualReviewVolume = p.annualReviewVolume;
  }

  if (p.workingStyle != null && p.workingStyle !== '') {
    if (!inList(WORKING_STYLES, p.workingStyle)) {
      errors.workingStyle = 'Select a valid working style.';
    } else {
      value.workingStyle = p.workingStyle;
      if (p.workingStyle === 'Research team' && p.teamSize != null && p.teamSize !== '') {
        if (!inList(TEAM_SIZES, p.teamSize)) errors.teamSize = 'Select a valid team size.';
        else value.teamSize = p.teamSize;
      }
    }
  }

  // Areas of interest (optional multi-select, deduped + closed list)
  if (p.areasOfInterest != null) {
    if (!Array.isArray(p.areasOfInterest)) {
      errors.areasOfInterest = 'Areas of interest must be a list.';
    } else {
      const seen = new Set();
      const cleaned = [];
      for (const a of p.areasOfInterest) {
        if (inList(WAITLIST_INTERESTS, a) && !seen.has(a)) {
          seen.add(a);
          cleaned.push(a);
        }
      }
      value.areasOfInterest = cleaned;
    }
  }

  if (p.referralSource != null && p.referralSource !== '') {
    if (!inList(REFERRAL_SOURCES, p.referralSource)) {
      errors.referralSource = 'Select a valid referral source.';
    } else {
      value.referralSource = p.referralSource;
      if (p.referralSource === 'Other') {
        const ro = cleanStr(p.referralOther, WAITLIST_MAX.referralOther);
        if (ro) value.referralOther = ro;
      }
    }
  }

  // Optional free-text message (length-capped; newlines/tabs preserved, other
  // control characters stripped to keep stored text clean and render-safe).
  if (p.message != null && String(p.message).trim() !== '') {
    const msg = String(p.message).replace(CONTROL_CHARS_RE, '').trim().slice(0, WAITLIST_MAX.message);
    if (msg) value.message = msg;
  }

  // Consent — TWO SEPARATE LAYERS (54.md / doc legal requirement):
  //   (1) OPERATIONAL consent (required, explicit true, never pre-checked): agree to
  //       be contacted about the beta. Without it we cannot run the waitlist.
  //   (2) RESEARCH-insights opt-in (OPTIONAL, separate, never pre-checked): consent
  //       to aggregated/anonymized research-insights use. Defaults to false; only
  //       stored true when the applicant explicitly opts in. NEVER required.
  if (p.consent !== true) {
    errors.consent = 'You must agree to be contacted about the beta to join the waitlist.';
  } else {
    value.consent = true;
    value.consentVersion = CONSENT_VERSION;
  }
  value.researchConsent = p.researchConsent === true;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

/** Display helper: full name from a record, falling back gracefully. */
export function applicantDisplayName(rec) {
  if (!rec) return '';
  const n = [rec.firstName, rec.lastName].filter(Boolean).join(' ').trim();
  return n || rec.email || '';
}

/** Display helper: the effective role label (custom role when role === 'Other'). */
export function applicantRoleLabel(rec) {
  if (!rec) return '';
  if (rec.role === 'Other' && rec.customRole) return rec.customRole;
  return rec.role || '';
}
