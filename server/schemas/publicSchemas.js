/**
 * schemas/publicSchemas.js — PERMISSIVE shape-guard Zod schemas for the public
 * (unauthenticated) POST endpoints (93.md §4.8): register, login, password
 * reset, waitlist submit, and contact.
 *
 * DESIGN CONTRACT — shape guard ONLY, never business validation:
 *   - Types + max lengths are enforced here (a mistyped or oversized body gets
 *     the structured 400 from validateBody before any controller runs — real
 *     DoS/abuse guards, not business limits).
 *   - PRESENCE and FORMAT are deliberately NOT enforced: every field is
 *     `.nullish()` so the controllers keep owning their fine-grained messages
 *     ("email is required", "password must be at least 8 characters",
 *     per-field waitlist 422s, …) that existing integration tests assert.
 *   - Every schema is `.passthrough()`: unknown keys flow through untouched.
 *     This matters concretely — the waitlist controller reads the `website`
 *     honeypot and hands the WHOLE body to the shared validateApplication()
 *     whitelister, and the register client additively sends `inviteToken`.
 *     Prototype-pollution keys are rejected by validateBody() BEFORE parsing.
 *   - The top-level shape must be a plain object: z.object() rejects arrays,
 *     strings, numbers, and null bodies with a structured 400.
 *
 * Caps are ceilings ABOVE the domain limits (e.g. waitlist message is domain-
 * capped at 2 000 chars — the 5 000 cap here only stops megabyte bodies), so
 * the domain layer's trims/slices keep behaving exactly as before.
 */

import { z } from 'zod';

// RFC 5321 path ceiling (320) — format is checked by the controllers.
const looseEmail = z.string().max(320, 'email is too long').nullish();
const loosePassword = z.string().max(1024, 'password is too long').nullish();
// Opaque single-use tokens (reset/verify/invite) are 64-hex today; 512 is a
// generous ceiling that still rejects a body abusing the field as a payload.
const looseToken = z.string().max(512, 'token is too long').nullish();
const str = (max, label = 'value') => z.string().max(max, `${label} is too long`).nullish();

/** POST /api/auth/register — controller reads email/password/name/acceptedTerms;
 *  the client additively sends inviteToken (kept by passthrough regardless). */
export const authRegisterSchema = z
  .object({
    email: looseEmail,
    password: loosePassword,
    name: str(200, 'name'),
    acceptedTerms: z.boolean().nullish(),
    inviteToken: looseToken,
  })
  .passthrough();

/** POST /api/auth/login — { email, password }. */
export const authLoginSchema = z
  .object({
    email: looseEmail,
    password: loosePassword,
  })
  .passthrough();

/** POST /api/auth/forgot-password — { email } (anti-enumeration 200 stays in
 *  the controller; only a mistyped/oversized body 400s here). */
export const passwordResetRequestSchema = z
  .object({
    email: looseEmail,
  })
  .passthrough();

/** POST /api/auth/reset-password — { token, password }. */
export const passwordResetCompleteSchema = z
  .object({
    token: looseToken,
    password: loosePassword,
  })
  .passthrough();

/**
 * POST /api/waitlist — public beta-waitlist application (prompt48/54.md).
 * Field list mirrors what src/shared/betaWaitlist.js validateApplication()
 * reads (plus the `website` honeypot the controller checks first). Closed-list
 * membership, conditional requirements, and consent stay 422s from the domain
 * validator — here we only bound types/lengths. Caps sit above WAITLIST_MAX
 * so the domain slices keep working unchanged.
 */
export const waitlistSubmitSchema = z
  .object({
    email: looseEmail,
    firstName: str(200, 'firstName'),
    lastName: str(200, 'lastName'),
    institutionName: str(400, 'institutionName'),
    institutionRorId: str(128, 'institutionRorId'),
    role: str(200, 'role'),
    customRole: str(200, 'customRole'),
    countryCode: str(10, 'countryCode'),
    primaryField: str(200, 'primaryField'),
    institutionType: str(200, 'institutionType'),
    covidenceLicense: str(50, 'covidenceLicense'),
    priorReviewCount: str(100, 'priorReviewCount'),
    lastReviewTool: str(200, 'lastReviewTool'),
    primaryUse: str(200, 'primaryUse'),
    researchExperienceLevel: str(200, 'researchExperienceLevel'),
    annualReviewVolume: str(200, 'annualReviewVolume'),
    workingStyle: str(100, 'workingStyle'),
    teamSize: str(100, 'teamSize'),
    areasOfInterest: z.array(z.string().max(200, 'interest is too long')).max(100, 'too many interests').nullish(),
    referralSource: str(200, 'referralSource'),
    referralOther: str(300, 'referralOther'),
    message: str(5000, 'message'),
    consent: z.boolean().nullish(),
    researchConsent: z.boolean().nullish(),
    // Honeypot — hidden field real users never fill; MUST reach the controller.
    website: str(1000, 'website'),
  })
  .passthrough();

/** POST /api/contact — { name?, email, subject?, message } (presence enforced
 *  by the route handler with its existing messages). */
export const contactSubmitSchema = z
  .object({
    name: str(300, 'name'),
    email: looseEmail,
    subject: str(500, 'subject'),
    message: str(10_000, 'message'),
  })
  .passthrough();
