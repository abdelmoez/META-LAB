/**
 * Onboarding.jsx — optional, skippable post-registration profile (prompt26).
 * Five fields, all optional. "Skip for now" and "Continue" both enter the app;
 * onboarding never blocks access. Institution is free text (server normalizes +
 * matches). Day-first, clean, minimal.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { saveOnboarding } from '../auth/authClient.js';
import { PRIMARY_ROLE_OPTIONS, RESEARCH_FIELD_OPTIONS, MAIN_USE_CASE_OPTIONS } from '../../shared/editableUserFields.js';

export default function Onboarding() {
  const navigate = useNavigate();
  const [v, setV] = useState({ primaryRole: '', researchField: '', mainUseCase: '', institution: '', country: '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setV(s => ({ ...s, [k]: e.target.value }));

  async function onContinue() {
    setSaving(true);
    try { await saveOnboarding(v); } catch { /* never block entry */ }
    navigate('/app');
  }

  // prompt31 Part 1 — "Skip for now" marks onboarding done (without saving any
  // answers) so the user is not prompted again on later sign-ins, then enters.
  async function onSkip() {
    setSaving(true);
    try { await saveOnboarding({ skipped: true }); } catch { /* never block entry */ }
    navigate('/app');
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 480, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: '40px', boxShadow: `0 24px 48px ${C.shadow}` }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.txt, marginBottom: 6 }}>Tell us a little about you</div>
        <div style={{ fontSize: 13.5, color: C.muted, marginBottom: 26, lineHeight: 1.5 }}>
          Optional — it helps us tailor META·LAB. You can skip this and add it later in your profile.
        </div>

        <Select label="Primary role" value={v.primaryRole} onChange={set('primaryRole')} options={PRIMARY_ROLE_OPTIONS} />
        <Text   label="Institution / organization" value={v.institution} onChange={set('institution')} placeholder="e.g. Harvard University" />
        <Select label="Research field" value={v.researchField} onChange={set('researchField')} options={RESEARCH_FIELD_OPTIONS} />
        <Select label="Main use case" value={v.mainUseCase} onChange={set('mainUseCase')} options={MAIN_USE_CASE_OPTIONS} />
        <Text   label="Country / region" value={v.country} onChange={set('country')} placeholder="e.g. United States" />

        <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
          <button onClick={onSkip} disabled={saving} style={btn(C.card2, C.txt2, C.brd2)}>Skip for now</button>
          <button onClick={onContinue} disabled={saving} style={btn(C.acc, C.accText, C.acc)}>{saving ? 'Saving…' : 'Continue'}</button>
        </div>
      </div>
    </div>
  );
}

function fieldWrap(label, control) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10.5, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: 6 }}>{label}</div>
      {control}
    </div>
  );
}
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, fontFamily: FONT, color: C.txt, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, outline: 'none' };

function Select({ label, value, onChange, options }) {
  return fieldWrap(label, (
    <select value={value} onChange={onChange} style={inputStyle}>
      <option value="">— Select —</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  ));
}
function Text({ label, value, onChange, placeholder }) {
  return fieldWrap(label, (
    <input type="text" value={value} onChange={onChange} placeholder={placeholder} style={inputStyle} />
  ));
}
function btn(bg, fg, brd) {
  return { flex: 1, background: bg, color: fg, border: `1px solid ${brd}`, borderRadius: 9, padding: '11px 16px', fontSize: 14, fontWeight: 600, fontFamily: FONT, cursor: 'pointer' };
}
