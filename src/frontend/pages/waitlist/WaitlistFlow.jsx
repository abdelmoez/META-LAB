/**
 * WaitlistFlow.jsx — the multi-step Beta Waitlist form, rendered NATIVE to the
 * Stitch design system (54.md).
 *   Step 1  Email  ·  Step 2  About you  ·  Step 3  Your work  ·  Step 4  Review & confirm
 *
 * Validation is mirrored from the shared, server-authoritative validateApplication
 * so client + server never drift. Server 422 field errors are mapped back onto the
 * step that owns them and the first invalid field is focused. The confirmation
 * state is HONEST: no invented queue position, acceptance date, or beta-access
 * claim. Email-delivery hiccups never present as a failed submission.
 *
 * Only email + countryCode + consent are required — everything else is optional
 * (the questionnaire doc: "all fields optional except Country").
 */

import { useState, useRef, useCallback } from 'react';
import { S, salpha } from '../../stitch/theme/stitchTokens.js';
import { StitchButton, StitchCard } from '../../stitch/primitives/index.js';
import {
  WAITLIST_ROLES, WAITLIST_FIELDS, WAITLIST_INSTITUTION_TYPES, WAITLIST_COVIDENCE,
  WAITLIST_PRIOR_REVIEW_COUNTS, WAITLIST_PRIOR_TOOLS, RESEARCH_EXPERIENCE_LEVELS,
  ANNUAL_REVIEW_VOLUMES, WORKING_STYLES, TEAM_SIZES, WAITLIST_INTERESTS, PRIMARY_USES,
  REFERRAL_SOURCES, validateApplication, isValidEmail,
} from '../../../shared/betaWaitlist.js';
import { COUNTRY_OPTIONS } from '../../../shared/countries.js';
import { TextField, TextareaField, SelectField, RadioGroupField, CheckboxGroupField, ConsentCheckbox } from './fields.jsx';
import { submitWaitlist, resendWaitlist } from './waitlistApi.js';

const COUNTRY_SELECT = COUNTRY_OPTIONS.map((c) => ({ value: c.code, label: c.name }));
const toOptions = (arr) => arr.map((v) => ({ value: v, label: v }));

const STEPS = [
  { key: 'email', label: 'Email' },
  { key: 'about', label: 'About you' },
  { key: 'institution', label: 'Your work' },
  { key: 'review', label: 'Review' },
];

// Maps each step to the fields it owns, so a server 422 routes to the right step.
const STEP_FIELDS = {
  email: ['email'],
  about: ['firstName', 'lastName', 'role', 'customRole', 'primaryField', 'priorReviewCount', 'lastReviewTool'],
  institution: ['countryCode', 'institutionType', 'institutionName', 'institutionRorId', 'covidenceLicense',
    'primaryUse', 'researchExperienceLevel', 'annualReviewVolume', 'workingStyle', 'teamSize',
    'areasOfInterest', 'referralSource', 'referralOther', 'message'],
  review: ['consent', 'researchConsent'],
};

// Order used to focus the first error and to render the error summary.
const FOCUS_ORDER = [
  'email', 'firstName', 'lastName', 'role', 'customRole', 'primaryField', 'priorReviewCount', 'lastReviewTool',
  'countryCode', 'institutionType', 'institutionName', 'covidenceLicense', 'primaryUse',
  'researchExperienceLevel', 'annualReviewVolume', 'workingStyle', 'teamSize', 'referralSource', 'referralOther',
  'consent', 'researchConsent',
];

// Human labels for the error-summary links.
const FIELD_LABELS = {
  email: 'Email address', firstName: 'First name', lastName: 'Last name', role: 'Role', customRole: 'Your role',
  primaryField: 'Field of research', priorReviewCount: 'Reviews completed', lastReviewTool: 'Tool used last',
  countryCode: 'Country', institutionType: 'Institution type', institutionName: 'Institution', covidenceLicense: 'Covidence license',
  primaryUse: 'Primary use', researchExperienceLevel: 'Research experience', annualReviewVolume: 'Reviews per year',
  workingStyle: 'Working style', teamSize: 'Team size', referralSource: 'How you heard about us', referralOther: 'Where you heard about us',
  consent: 'Contact consent', researchConsent: 'Research opt-in', areasOfInterest: 'Areas of interest', message: 'Message',
};

const EMPTY = {
  email: '', firstName: '', lastName: '', role: '', customRole: '',
  primaryField: '', countryCode: '', institutionType: '', institutionName: '', institutionRorId: '',
  covidenceLicense: '', priorReviewCount: '', lastReviewTool: '',
  researchExperienceLevel: '', annualReviewVolume: '', workingStyle: '', teamSize: '',
  primaryUse: '', areasOfInterest: [], referralSource: '', referralOther: '',
  message: '', consent: false, researchConsent: false, website: '',
};

function stepIndex(key) { return STEPS.findIndex((s) => s.key === key); }

export default function WaitlistFlow({ onSignIn }) {
  const [step, setStep] = useState('email');
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState(null);     // server response on success
  const [announce, setAnnounce] = useState('');     // aria-live message
  const [resendState, setResendState] = useState('idle'); // idle|sending|done
  const topRef = useRef(null);

  const set = useCallback((key, val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }, []);

  const focusField = useCallback((key) => {
    const el = document.getElementById(key);
    if (el && typeof el.focus === 'function') el.focus();
  }, []);

  const focusFirstError = useCallback((errs) => {
    const key = FOCUS_ORDER.find((k) => errs[k]);
    if (key) focusField(key);
  }, [focusField]);

  const goTo = useCallback((key) => {
    setStep(key);
    setSubmitError('');
    const idx = stepIndex(key);
    setAnnounce(`Step ${idx + 1} of ${STEPS.length}: ${STEPS[idx].label}.`);
    if (topRef.current) topRef.current.scrollIntoView({ block: 'nearest' });
  }, []);

  // Validate the fields belonging to a step (uses the shared validator, filtered).
  const validateStep = useCallback((key) => {
    if (key === 'email') {
      if (!isValidEmail(form.email)) {
        const e = { email: form.email.trim() ? 'Enter a valid email address.' : 'Email is required.' };
        setErrors(e); focusFirstError(e); return false;
      }
      setErrors({});
      return true;
    }
    // For non-final steps, satisfy the validator's required-consent check so only
    // THIS step's field errors surface (consent itself is validated on submit).
    const res = validateApplication({ ...form, consent: key === 'review' ? form.consent : true });
    if (res.ok) { setErrors({}); return true; }
    const fields = STEP_FIELDS[key];
    const stepErrs = {};
    for (const f of fields) if (res.errors[f]) stepErrs[f] = res.errors[f];
    if (Object.keys(stepErrs).length > 0) {
      setErrors(stepErrs);
      focusFirstError(stepErrs);
      setAnnounce('Please correct the highlighted fields before continuing.');
      return false;
    }
    setErrors({});
    return true;
  }, [form, focusFirstError]);

  const next = useCallback(() => {
    if (step === 'email' && validateStep('email')) goTo('about');
    else if (step === 'about' && validateStep('about')) goTo('institution');
    else if (step === 'institution' && validateStep('institution')) goTo('review');
  }, [step, validateStep, goTo]);

  const submit = useCallback(async () => {
    const res = validateApplication(form);
    if (!res.ok) {
      setErrors(res.errors);
      // Jump to the earliest step that owns an error.
      const target = STEPS.find((s) => STEP_FIELDS[s.key].some((f) => res.errors[f]));
      if (target && target.key !== 'review') goTo(target.key);
      focusFirstError(res.errors);
      setAnnounce('Please correct the highlighted fields.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    setAnnounce('Submitting your application…');
    try {
      const data = await submitWaitlist(form);
      setResult(data);
      setStep('done');
      setAnnounce(data.duplicate
        ? 'This email is already on the waitlist.'
        : 'Success. You have joined the PecanRev beta waitlist.');
      if (topRef.current) topRef.current.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      let msg;
      if (err.status === 422 && err.fieldErrors) {
        setErrors(err.fieldErrors);
        const target = STEPS.find((s) => STEP_FIELDS[s.key].some((f) => err.fieldErrors[f]));
        if (target && target.key !== 'review') goTo(target.key);
        focusFirstError(err.fieldErrors);
        msg = 'Please correct the highlighted fields.';
      } else if (err.status === 503) {
        msg = 'The waitlist is temporarily unavailable. Please try again in a moment.';
      } else if (err.status === 429) {
        msg = 'Too many attempts. Please wait a moment and try again.';
      } else {
        msg = err.message || 'Something went wrong. Please try again.';
      }
      // Announce from a LOCAL value (state setters don't update the local const
      // synchronously, so reading submitError here would be one render stale).
      setSubmitError(msg);
      setAnnounce(msg);
    } finally {
      setSubmitting(false);
    }
  }, [form, goTo, focusFirstError]);

  const doResend = useCallback(async () => {
    setResendState('sending');
    try { await resendWaitlist(form.email); } catch { /* generic */ }
    setResendState('done');
    setAnnounce('If that email is on the waitlist, we have re-sent the confirmation.');
  }, [form.email]);

  // ── Confirmation ──────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <ConfirmationPanel
        topRef={topRef} result={result} email={form.email} firstName={form.firstName}
        onResend={doResend} resendState={resendState} onSignIn={onSignIn} announce={announce}
      />
    );
  }

  const idx = stepIndex(step);
  // Only the fields belonging to the current step contribute to its error summary.
  const stepErrorKeys = FOCUS_ORDER.filter((k) => (STEP_FIELDS[step] || []).includes(k) && errors[k]);

  return (
    <div ref={topRef}>
      <LiveRegion message={announce} />
      <Stepper current={idx} />

      {/* Honeypot — visually hidden, off the tab order, ignored by humans. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
      </div>

      {/* Accessible error summary — only when ≥2 field errors on this step. */}
      <ErrorSummary keys={stepErrorKeys} errors={errors} onJump={focusField} />

      {step === 'email' && (
        <Section title="Join the PecanRev beta waitlist" subtitle="Start with your email — a few quick, optional questions follow.">
          <TextField
            id="email" label="Email address" type="email" required value={form.email}
            onChange={(v) => set('email', v)} error={errors.email} autoComplete="email"
            placeholder="you@university.edu" inputMode="email" icon="mail"
            hint="An institutional or .edu email is preferred, but any valid email works."
          />
          <FormError message={submitError} />
          <Actions>
            <span />
            <StitchButton type="submit" variant="primary" iconRight="arrowRight" onClick={next}>Continue</StitchButton>
          </Actions>
        </Section>
      )}

      {step === 'about' && (
        <Section title="About you" subtitle="All optional — it helps us tailor the beta.">
          <Grid2>
            <TextField id="firstName" label="First name" value={form.firstName} onChange={(v) => set('firstName', v)} error={errors.firstName} autoComplete="given-name" maxLength={100} />
            <TextField id="lastName" label="Last name" value={form.lastName} onChange={(v) => set('lastName', v)} error={errors.lastName} autoComplete="family-name" maxLength={100} />
          </Grid2>
          <SelectField id="role" label="Professional / academic role" value={form.role} onChange={(v) => set('role', v)} options={toOptions(WAITLIST_ROLES)} error={errors.role} placeholder="Select your role…" />
          {form.role === 'Other' && (
            <TextField id="customRole" label="Your role" value={form.customRole} onChange={(v) => set('customRole', v)} error={errors.customRole} maxLength={100} />
          )}
          <SelectField id="primaryField" label="Primary field of research" value={form.primaryField} onChange={(v) => set('primaryField', v)} options={toOptions(WAITLIST_FIELDS)} error={errors.primaryField} placeholder="Select a field…" />
          <RadioGroupField id="priorReviewCount" legend="How many systematic reviews have you completed?" value={form.priorReviewCount} onChange={(v) => set('priorReviewCount', v)} options={WAITLIST_PRIOR_REVIEW_COUNTS} error={errors.priorReviewCount} columns={2} />
          <SelectField id="lastReviewTool" label="What tool did you use for your last review?" value={form.lastReviewTool} onChange={(v) => set('lastReviewTool', v)} options={toOptions(WAITLIST_PRIOR_TOOLS)} error={errors.lastReviewTool} placeholder="Select a tool…" />

          <FormError message={submitError} />
          <Actions>
            <StitchButton type="button" variant="neutral" icon="arrowLeft" onClick={() => goTo('email')}>Back</StitchButton>
            <StitchButton type="submit" variant="primary" iconRight="arrowRight" onClick={next}>Continue</StitchButton>
          </Actions>
        </Section>
      )}

      {step === 'institution' && (
        <Section title="Your work" subtitle="Country is required (for regional support & compliance); the rest is optional.">
          <SelectField id="countryCode" label="Country" required value={form.countryCode} onChange={(v) => set('countryCode', v)} options={COUNTRY_SELECT} error={errors.countryCode} placeholder="Select your country" />
          <SelectField id="institutionType" label="Type of institution" value={form.institutionType} onChange={(v) => set('institutionType', v)} options={toOptions(WAITLIST_INSTITUTION_TYPES)} error={errors.institutionType} placeholder="Select institution type…" />
          <TextField id="institutionName" label="Institution or organization" value={form.institutionName} onChange={(v) => set('institutionName', v)} error={errors.institutionName} autoComplete="organization" placeholder="e.g. University of Oxford" maxLength={200} hint="Optional — you can add this later." />
          <RadioGroupField id="covidenceLicense" legend="Does your institution have a Covidence license?" value={form.covidenceLicense} onChange={(v) => set('covidenceLicense', v)} options={WAITLIST_COVIDENCE} error={errors.covidenceLicense} columns={3} />

          <Divider label="More (optional)" />
          <SelectField id="primaryUse" label="Primary intended use of PecanRev" value={form.primaryUse} onChange={(v) => set('primaryUse', v)} options={toOptions(PRIMARY_USES)} error={errors.primaryUse} placeholder="Select…" />
          <Grid2>
            <SelectField id="researchExperienceLevel" label="Research experience" value={form.researchExperienceLevel} onChange={(v) => set('researchExperienceLevel', v)} options={toOptions(RESEARCH_EXPERIENCE_LEVELS)} error={errors.researchExperienceLevel} placeholder="Select…" />
            <SelectField id="annualReviewVolume" label="Reviews per year" value={form.annualReviewVolume} onChange={(v) => set('annualReviewVolume', v)} options={toOptions(ANNUAL_REVIEW_VOLUMES)} error={errors.annualReviewVolume} placeholder="Select…" />
          </Grid2>
          <Grid2>
            <SelectField id="workingStyle" label="Do you work…" value={form.workingStyle} onChange={(v) => set('workingStyle', v)} options={toOptions(WORKING_STYLES)} error={errors.workingStyle} placeholder="Select…" />
            {form.workingStyle === 'Research team' && (
              <SelectField id="teamSize" label="Team size" value={form.teamSize} onChange={(v) => set('teamSize', v)} options={toOptions(TEAM_SIZES)} error={errors.teamSize} placeholder="Select…" />
            )}
          </Grid2>
          <CheckboxGroupField legend="Which capabilities interest you most?" options={WAITLIST_INTERESTS} values={form.areasOfInterest} onChange={(v) => set('areasOfInterest', v)} error={errors.areasOfInterest} />
          <SelectField id="referralSource" label="How did you hear about PecanRev?" value={form.referralSource} onChange={(v) => set('referralSource', v)} options={toOptions(REFERRAL_SOURCES)} error={errors.referralSource} placeholder="Select…" />
          {form.referralSource === 'Other' && (
            <TextField id="referralOther" label="Where did you hear about us?" value={form.referralOther} onChange={(v) => set('referralOther', v)} error={errors.referralOther} maxLength={120} />
          )}
          <TextareaField id="message" label="Anything else? (optional)" value={form.message} onChange={(v) => set('message', v)} error={errors.message} maxLength={2000} rows={3} placeholder="What are you hoping to use PecanRev for?" />

          <FormError message={submitError} />
          <Actions>
            <StitchButton type="button" variant="neutral" icon="arrowLeft" onClick={() => goTo('about')}>Back</StitchButton>
            <StitchButton type="submit" variant="primary" iconRight="arrowRight" onClick={next}>Review</StitchButton>
          </Actions>
        </Section>
      )}

      {step === 'review' && (
        <Section title="Review & confirm" subtitle="Check your details, then confirm.">
          <ReviewList form={form} />
          <StitchCard style={{ marginTop: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ConsentCheckbox id="consent" checked={form.consent} onChange={(v) => set('consent', v)} error={errors.consent}>
              I agree that PecanRev may store the information above and contact me by email about beta access and
              related updates. I can ask to be removed at any time. See the{' '}
              <a href="/terms#privacy" target="_blank" rel="noopener noreferrer" style={{ color: S.brand, fontWeight: 600 }}>Privacy Policy</a>.
            </ConsentCheckbox>
            <div style={{ height: 1, background: salpha(S.outlineVariant, 0.6) }} />
            <ConsentCheckbox id="researchConsent" checked={form.researchConsent} onChange={(v) => set('researchConsent', v)}>
              <strong style={{ color: S.textPrimary }}>Optional:</strong>{' '}
              I also agree that my answers may be used in aggregated, anonymized form to improve PecanRev and produce
              research insights. This is optional, never identifies me, and you can leave it unchecked.
            </ConsentCheckbox>
          </StitchCard>
          <FormError message={submitError} />
          <Actions>
            <StitchButton type="button" variant="neutral" icon="arrowLeft" onClick={() => goTo('institution')} disabled={submitting}>Back</StitchButton>
            <StitchButton type="submit" variant="primary" loading={submitting} onClick={submit}>
              {submitting ? 'Joining…' : 'Join the waitlist'}
            </StitchButton>
          </Actions>
        </Section>
      )}
    </div>
  );
}

/* ── Small presentational helpers ─────────────────────────────────────────────── */

function LiveRegion({ message }) {
  return (
    <div aria-live="polite" role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
      {message}
    </div>
  );
}

function Stepper({ current }) {
  return (
    <ol style={{ display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 22px' }}>
      {STEPS.map((s, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <li key={s.key} aria-current={active ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < STEPS.length - 1 ? 1 : '0 0 auto' }}>
            <span style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12.5, fontWeight: 700, fontFamily: S.font,
              background: active || done ? S.brand : S.surfaceContainer, color: active || done ? S.onBrand : S.textMuted,
              border: `1px solid ${active || done ? S.brand : S.outlineVariant}`,
            }}>{done ? '✓' : i + 1}</span>
            <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? S.textPrimary : S.textMuted, fontFamily: S.font, whiteSpace: 'nowrap' }}>{s.label}</span>
            {i < STEPS.length - 1 && <span aria-hidden="true" style={{ flex: 1, height: 1, background: S.outlineVariant, margin: '0 4px' }} />}
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div className="stitch-fade-in">
      <h2 style={{ fontSize: 22, fontWeight: 700, color: S.textPrimary, margin: '0 0 6px', fontFamily: S.font, letterSpacing: '-0.02em' }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 14, color: S.textMuted, margin: '0 0 20px', fontFamily: S.font, lineHeight: 1.55 }}>{subtitle}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
    </div>
  );
}

function Grid2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>{children}</div>;
}

function Divider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 2px' }}>
      <span style={{ flex: 1, height: 1, background: salpha(S.outlineVariant, 0.6) }} />
      <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.textMuted, fontFamily: S.font }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: salpha(S.outlineVariant, 0.6) }} />
    </div>
  );
}

function Actions({ children }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>{children}</div>;
}

function FormError({ message }) {
  if (!message) return null;
  return (
    <div role="alert" style={{ padding: '11px 14px', background: S.dangerSoft, border: `1px solid ${salpha(S.danger, 0.5)}`, borderRadius: S.radiusControl, color: S.onDangerSoft, fontSize: 13.5, fontWeight: 600, fontFamily: S.font, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span aria-hidden="true">⚠</span><span>{message}</span>
    </div>
  );
}

/** Accessible error summary — rendered only when a step has ≥2 field errors. */
function ErrorSummary({ keys, errors, onJump }) {
  if (!keys || keys.length < 2) return null;
  return (
    <div role="alert" style={{
      marginBottom: 18, padding: '14px 16px', background: S.dangerSoft,
      border: `1px solid ${salpha(S.danger, 0.5)}`, borderRadius: S.radiusCardSm, fontFamily: S.font,
    }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: S.onDangerSoft }}>
        Please fix {keys.length} field{keys.length > 1 ? 's' : ''} before continuing:
      </h3>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {keys.map((k) => (
          <li key={k}>
            <button
              type="button" className="stitch-focusable"
              onClick={() => onJump(k)}
              style={{ background: 'none', border: 'none', padding: 0, color: S.onDangerSoft, fontSize: 13, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontFamily: S.font, textAlign: 'left' }}
            >
              {FIELD_LABELS[k] || k}: {errors[k]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewRow({ label, value }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.5)}` }}>
      <div style={{ width: 150, flexShrink: 0, fontSize: 12.5, color: S.textMuted, fontWeight: 600, fontFamily: S.font }}>{label}</div>
      <div style={{ fontSize: 13.5, color: S.textPrimary, fontFamily: S.font, lineHeight: 1.5, wordBreak: 'break-word', minWidth: 0 }}>{Array.isArray(value) ? value.join(', ') : value}</div>
    </div>
  );
}

function ReviewList({ form }) {
  const country = COUNTRY_SELECT.find((c) => c.value === form.countryCode);
  return (
    <div style={{ border: `1px solid ${salpha(S.outlineVariant, 0.5)}`, borderRadius: S.radiusCardSm, padding: '4px 16px', background: S.surfaceLow }}>
      <ReviewRow label="Email" value={form.email} />
      <ReviewRow label="Name" value={`${form.firstName} ${form.lastName}`.trim()} />
      <ReviewRow label="Role" value={form.role === 'Other' ? form.customRole : form.role} />
      <ReviewRow label="Field of research" value={form.primaryField} />
      <ReviewRow label="Reviews completed" value={form.priorReviewCount} />
      <ReviewRow label="Tool used last" value={form.lastReviewTool} />
      <ReviewRow label="Country" value={country ? country.label : ''} />
      <ReviewRow label="Institution type" value={form.institutionType} />
      <ReviewRow label="Institution" value={form.institutionName} />
      <ReviewRow label="Covidence license" value={form.covidenceLicense} />
      <ReviewRow label="Primary use" value={form.primaryUse} />
      <ReviewRow label="Experience" value={form.researchExperienceLevel} />
      <ReviewRow label="Reviews / year" value={form.annualReviewVolume} />
      <ReviewRow label="Works" value={form.workingStyle === 'Research team' && form.teamSize ? `Research team (${form.teamSize})` : form.workingStyle} />
      <ReviewRow label="Interests" value={form.areasOfInterest} />
      <ReviewRow label="Heard via" value={form.referralSource === 'Other' && form.referralOther ? `Other — ${form.referralOther}` : form.referralSource} />
      <ReviewRow label="Message" value={form.message} />
    </div>
  );
}

function ConfirmationPanel({ topRef, result, email, firstName, onResend, resendState, onSignIn, announce }) {
  const duplicate = result && result.duplicate;
  const emailStatus = result && result.emailStatus;
  let emailLine;
  if (duplicate) emailLine = 'This email is already associated with a waitlist submission.';
  else if (emailStatus === 'sent') emailLine = `A confirmation email is on its way to ${email}.`;
  else if (emailStatus === 'failed') emailLine = "We've saved your spot. Our confirmation email is delayed, but your place on the waitlist is secure.";
  else emailLine = "We've recorded your spot. You'll hear from us by email about next steps.";

  return (
    <div ref={topRef} className="stitch-fade-in" style={{ textAlign: 'center', padding: '8px 4px' }}>
      <LiveRegion message={announce} />
      <div aria-hidden="true" style={{
        width: 60, height: 60, borderRadius: '50%', margin: '0 auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: S.successSoft, color: S.onSuccessSoft, fontSize: 30, fontWeight: 800, border: `1px solid ${salpha(S.success, 0.5)}`,
      }}>✓</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: S.textPrimary, margin: '0 0 10px', fontFamily: S.font, letterSpacing: '-0.02em' }}>
        {duplicate ? "You're already on the list" : `You're on the waitlist${firstName ? `, ${firstName}` : ''}!`}
      </h2>
      <p style={{ fontSize: 15, color: S.textSecondary, margin: '0 auto 6px', maxWidth: 440, lineHeight: 1.6, fontFamily: S.font }}>
        {duplicate
          ? 'No need to sign up again — your details are safe with us.'
          : 'Thanks for joining the PecanRev beta waitlist.'}
      </p>
      <p style={{ fontSize: 14, color: S.textMuted, margin: '0 auto 4px', maxWidth: 460, lineHeight: 1.6, fontFamily: S.font }}>{emailLine}</p>
      <p style={{ fontSize: 13.5, color: S.textMuted, margin: '0 auto 24px', maxWidth: 460, lineHeight: 1.6, fontFamily: S.font }}>
        Joining the waitlist doesn't guarantee immediate access. If a place opens up, we'll email you with the next steps.
      </p>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <StitchButton type="button" variant="neutral" icon="mail" onClick={onResend} disabled={resendState !== 'idle'}>
          {resendState === 'sending' ? 'Sending…' : resendState === 'done' ? 'Confirmation re-sent' : 'Resend confirmation email'}
        </StitchButton>
        <StitchButton type="button" variant="primary" onClick={onSignIn}>Already have an account? Sign in</StitchButton>
      </div>
    </div>
  );
}
