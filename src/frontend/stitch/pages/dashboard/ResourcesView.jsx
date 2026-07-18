/**
 * ResourcesView.jsx — the dashboard "Resources" / "Help & Feedback" surface
 * (design2.md Part 1 + menu).
 *
 * Reuses the EXISTING support pipeline rather than inventing a disconnected one:
 * the feedback form posts to api.contact → POST /api/contact → ContactMessage,
 * the same monitored inbox the Ops console reads (audit B). Name/email are
 * pre-filled from the signed-in user. Static help links point at the real public
 * pages. No fake destination.
 */
import { useState } from 'react';
import { api } from '../../../api-client/apiClient.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  StitchCard, StitchSectionHeader, StitchField, StitchInput, StitchTextarea,
  StitchButton, StitchIcon, useStitchToast, S, salpha,
} from '../../primitives';

const HELP_LINKS = [
  { icon: 'bookOpen', label: 'Terms & privacy', desc: 'How PecanRev handles your data', href: '/terms' },
  { icon: 'shieldCheck', label: 'Account & security', desc: 'Manage your profile and password', href: '/profile' },
];

// 93.md §9.3 — reporter-suggested severity (optional; validated server-side).
const SEVERITY_OPTIONS = [
  { value: '', label: 'Not sure / general feedback' },
  { value: 'low', label: 'Low — minor annoyance' },
  { value: 'medium', label: 'Medium — something is wrong but I can work around it' },
  { value: 'high', label: 'High — blocks part of my work' },
  { value: 'critical', label: 'Critical — I cannot work / possible data problem' },
];

export default function ResourcesView() {
  const { user } = useAuth();
  const toast = useStitchToast();
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [severity, setSeverity] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  // 93.md §9.3 — the server returns a quotable reference ("FB-4F7K2Q") per report.
  const [reference, setReference] = useState('');

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    const msg = message.trim();
    if (!msg) { setErr('Please describe your question or feedback.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await api.contact({
        name: user?.name || undefined,
        email: user?.email,
        subject: subject.trim() || 'In-app feedback',
        message: msg,
        ...(severity ? { severity } : {}),
      });
      setReference(res?.reference || '');
      setSent(true); setMessage(''); setSubject(''); setSeverity('');
      toast.toast('Thanks — your message was sent to our team.', { tone: 'success' });
    } catch (e2) {
      setErr(e2?.message || 'Could not send your message. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.2fr)', gap: 24, alignItems: 'start' }} className="stitch-resources-grid">
      <StitchCard>
        <StitchSectionHeader title="Help & documentation" desc="Guides and references for using PecanRev" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {HELP_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="stitch-focusable"
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, textDecoration: 'none',
                border: `1px solid ${salpha(S.outlineVariant, 0.5)}`, background: S.surfaceLow, color: S.textPrimary }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: S.brandSoft, color: S.onBrandSoft, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <StitchIcon name={l.icon} size={18} />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{l.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: S.textMuted }}>{l.desc}</span>
              </span>
              <StitchIcon name="arrowRight" size={16} />
            </a>
          ))}
        </div>
      </StitchCard>

      <StitchCard>
        <StitchSectionHeader title="Contact & feedback" desc="Report a bug or send feedback — it reaches our team directly." />
        {sent ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 12px', textAlign: 'center' }}>
            <span style={{ width: 48, height: 48, borderRadius: 14, background: S.successSoft, color: S.success, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <StitchIcon name="circleCheck" size={24} />
            </span>
            <div style={{ fontSize: 15, fontWeight: 700, color: S.textPrimary }}>Message sent</div>
            <div style={{ fontSize: 13, color: S.textSecondary, maxWidth: 360 }}>Thanks for reaching out. We read every message and will follow up by email if needed.</div>
            {/* 93.md §9.3 — quotable reference for follow-ups */}
            {reference && (
              <div style={{ fontSize: 12.5, color: S.textSecondary, background: S.surfaceLow, border: `1px solid ${salpha(S.outlineVariant, 0.5)}`, borderRadius: 10, padding: '8px 14px' }}>
                Your reference: <strong style={{ fontFamily: 'ui-monospace, monospace', color: S.textPrimary }}>{reference}</strong> — quote {reference} in follow-ups.
              </div>
            )}
            <StitchButton variant="neutral" size="sm" onClick={() => { setSent(false); setReference(''); }}>Send another</StitchButton>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <StitchField label="Subject" htmlFor="fb-subject" help="Optional — a short summary.">
              <StitchInput id="fb-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Screening export issue" maxLength={160} />
            </StitchField>
            <StitchField label="Message" htmlFor="fb-msg" required error={err || undefined}>
              <StitchTextarea id="fb-msg" rows={5} value={message} onChange={(e) => { setMessage(e.target.value); setErr(''); }}
                placeholder="Describe your question, feedback or the problem you ran into…" />
            </StitchField>
            {/* 93.md §9.3 — optional severity so bug reports can be triaged faster */}
            <StitchField label="How severe is it?" htmlFor="fb-severity" help="Optional — helps us triage bug reports.">
              <select id="fb-severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className="stitch-focusable"
                style={{ width: '100%', height: 40, padding: '0 12px', fontSize: 13.5, borderRadius: 10, color: S.textPrimary, background: S.surfaceLow, border: `1px solid ${salpha(S.outlineVariant, 0.7)}`, cursor: 'pointer' }}>
                {SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </StitchField>
            {user?.email ? <div style={{ fontSize: 12, color: S.textMuted }}>We'll reply to <strong style={{ color: S.textSecondary }}>{user.email}</strong>.</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <StitchButton type="submit" icon="send" loading={busy} disabled={!message.trim()}>Send message</StitchButton>
            </div>
          </form>
        )}
      </StitchCard>
      <style>{'@media (max-width: 880px){ html[data-ui-design="stitch"] .stitch-resources-grid{ grid-template-columns: 1fr !important; } }'}</style>
    </div>
  );
}
