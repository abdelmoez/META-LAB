/**
 * Onboarding.jsx — dynamic, server-driven onboarding questions (prompt32).
 * Fetches pending questions from GET /api/onboarding/pending on mount.
 * Renders one question at a time with progress, submit, and (where allowed) skip.
 * Never hard-blocks the app: any fatal error lets the user proceed to /app.
 * Preserves the existing visual style (C tokens, inputStyle, btn helper, fieldWrap).
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { getPendingOnboarding, submitOnboardingResponses, skipOnboarding } from '../auth/authClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import InstitutionAutocomplete from '../components/InstitutionAutocomplete.jsx';

// True when an institution answer (string or selection object) has a usable name.
function institutionAnswered(a) {
  if (!a) return false;
  if (typeof a === 'string') return a.trim().length > 0;
  return !!(a.name || a.canonicalName);
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { refreshPendingOnboarding } = useAuth();

  const [questions, setQuestions]   = useState([]);
  const [intro, setIntro]           = useState(null);
  const [idx, setIdx]               = useState(0);         // current question index
  const [answers, setAnswers]       = useState({});        // questionId → answer value
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  // Fetch (or re-fetch) pending questions from the server
  const loadPending = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { questions: qs, intro: intr } = await getPendingOnboarding();
      if (!qs || qs.length === 0) {
        // Nothing pending — enter the app
        await refreshPendingOnboarding();
        navigate('/app');
        return;
      }
      setQuestions(qs);
      setIntro(intr);
      setIdx(0);
      setAnswers({});
    } catch {
      // Network failure — never block access
      navigate('/app');
    } finally {
      setLoading(false);
    }
  }, [navigate, refreshPendingOnboarding]);

  useEffect(() => { loadPending(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = questions[idx] || null;
  const total = questions.length;
  const answer = q ? (answers[q.id] ?? '') : '';

  function setAnswer(val) {
    if (!q) return;
    setAnswers(prev => ({ ...prev, [q.id]: val }));
  }

  // Is the current question answered well enough to submit?
  function isAnswered() {
    if (!q) return false;
    if (q.type === 'multi_select') return Array.isArray(answer) && answer.length > 0;
    if (q.type === 'boolean') return answer === true || answer === false;
    if (q.type === 'institution') return institutionAnswered(answer);
    return answer !== '' && answer !== null && answer !== undefined;
  }

  async function onSave() {
    if (!q) return;
    if (q.isRequired && !isAnswered()) {
      setError('This question is required. Please provide an answer before continuing.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = { questionId: q.id, answer: buildAnswer() };
      const result = await submitOnboardingResponses([response]);
      const remaining = result.pending || [];
      if (remaining.length === 0) {
        await refreshPendingOnboarding();
        navigate('/app');
      } else {
        // More questions remain — advance or reload
        if (idx + 1 < total) {
          setIdx(i => i + 1);
        } else {
          await loadPending();
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function onSkip() {
    if (!q) return;
    setSaving(true);
    setError('');
    try {
      const result = await skipOnboarding([q.id]);
      const remaining = result.pending || [];
      if (remaining.length === 0) {
        await refreshPendingOnboarding();
        navigate('/app');
      } else {
        if (idx + 1 < total) {
          setIdx(i => i + 1);
        } else {
          await loadPending();
        }
      }
    } catch {
      // On skip failure, advance anyway — never block
      if (idx + 1 < total) { setIdx(i => i + 1); }
      else { navigate('/app'); }
    } finally {
      setSaving(false);
    }
  }

  async function onSkipAll() {
    setSaving(true);
    setError('');
    try {
      await skipOnboarding();
    } catch { /* ignore */ }
    await refreshPendingOnboarding();
    navigate('/app');
  }

  // Build the typed answer value to submit
  function buildAnswer() {
    if (!q) return answer;
    if (q.type === 'number') return answer === '' ? null : Number(answer);
    if (q.type === 'boolean') return answer; // already true/false
    if (q.type === 'multi_select') return Array.isArray(answer) ? answer : [];
    if (q.type === 'institution') return institutionAnswered(answer) ? answer : null; // string|object
    return answer; // text, single_select, date → string
  }

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={outerStyle}>
        <div style={cardStyle}>
          <div style={{ color: C.muted, fontSize: 14 }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (!q) return null;

  const canSkip = !q.isRequired && q.allowSkip !== false;

  // Are ALL remaining questions skippable?
  const allSkippable = questions.slice(idx).every(qu => !qu.isRequired && qu.allowSkip !== false);

  return (
    <div style={outerStyle}>
      <div style={cardStyle}>
        {/* Intro header (only shown on first question) */}
        {idx === 0 && intro && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.txt, marginBottom: 6 }}>{intro.title}</div>
            {intro.body && (
              <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>{intro.body}</div>
            )}
          </div>
        )}
        {idx === 0 && !intro && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.txt, marginBottom: 6 }}>A few quick questions</div>
            <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
              Help us tailor META·LAB to you. You can update answers later in your profile.
            </div>
          </div>
        )}

        {/* Progress indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <div style={{ flex: 1, height: 4, background: alpha(C.acc, 0.15), borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${((idx + 1) / total) * 100}%`, height: '100%', background: C.acc, borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: 11, fontFamily: MONO, color: C.muted, whiteSpace: 'nowrap' }}>
            {idx + 1} / {total}
          </div>
        </div>

        {/* Question prompt */}
        <div style={{ marginBottom: 4 }}>
          <div style={labelStyle}>
            {q.prompt}
            {q.isRequired && <span style={{ color: C.red || '#e53e3e', marginLeft: 4 }}>*</span>}
          </div>
          {q.description && (
            <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{q.description}</div>
          )}
        </div>

        {/* Input by type */}
        <div style={{ marginBottom: 20 }}>
          {q.type === 'text' && (
            <input
              type="text"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              placeholder={q.prompt}
              aria-label={q.prompt}
              style={inputStyle}
            />
          )}

          {q.type === 'number' && (
            <input
              type="number"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              aria-label={q.prompt}
              style={inputStyle}
            />
          )}

          {q.type === 'date' && (
            <input
              type="date"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              aria-label={q.prompt}
              style={inputStyle}
            />
          )}

          {q.type === 'single_select' && (
            <select
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              aria-label={q.prompt}
              style={inputStyle}
            >
              <option value="">— Select —</option>
              {(q.options || []).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}

          {q.type === 'institution' && (
            <InstitutionAutocomplete
              value={answer || null}
              onChange={val => setAnswer(val)}
              autoFocus
            />
          )}

          {q.type === 'multi_select' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(q.options || []).map(opt => {
                const checked = Array.isArray(answer) && answer.includes(opt.value);
                return (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: C.txt }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => {
                        const cur = Array.isArray(answer) ? answer : [];
                        setAnswer(e.target.checked ? [...cur, opt.value] : cur.filter(v => v !== opt.value));
                      }}
                      style={{ width: 16, height: 16, accentColor: C.acc }}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          )}

          {q.type === 'boolean' && (
            <div style={{ display: 'flex', gap: 10 }}>
              {[{ value: true, label: 'Yes' }, { value: false, label: 'No' }].map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => setAnswer(opt.value)}
                  aria-pressed={answer === opt.value}
                  style={{
                    ...btn(
                      answer === opt.value ? C.acc : C.card2,
                      answer === opt.value ? C.accText : C.txt2,
                      answer === opt.value ? C.acc : C.brd2
                    ),
                    flex: 1,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div role="alert" style={{ fontSize: 13, color: C.red || '#e53e3e', marginBottom: 14, lineHeight: 1.4 }}>{error}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canSkip && (
            <button onClick={onSkip} disabled={saving} style={btn(C.card2, C.txt2, C.brd2)}>
              Skip
            </button>
          )}
          <button
            onClick={onSave}
            disabled={saving || (q.isRequired && !isAnswered())}
            style={{ ...btn(C.acc, C.accText, C.acc), flex: 2, opacity: (q.isRequired && !isAnswered()) ? 0.55 : 1 }}
          >
            {saving ? 'Saving…' : idx + 1 < total ? 'Save & continue' : 'Finish'}
          </button>
        </div>

        {/* Skip all remaining (only shown when all remaining are skippable and more than 1 left) */}
        {allSkippable && total > 1 && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button
              onClick={onSkipAll}
              disabled={saving}
              style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline', fontFamily: FONT }}
            >
              Skip all remaining questions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles (matches original Onboarding.jsx visual style) ─────────────────
const outerStyle = {
  minHeight: '100vh', background: C.bg, display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  fontFamily: FONT, padding: '24px 16px',
};
const cardStyle = {
  width: '100%', maxWidth: 480, background: C.card,
  border: `1px solid ${C.brd}`, borderRadius: 14,
  padding: '40px', boxShadow: `0 24px 48px ${C.shadow}`,
};
const labelStyle = {
  fontSize: 10.5, fontFamily: MONO, fontWeight: 600,
  letterSpacing: '0.1em', textTransform: 'uppercase',
  color: C.muted, marginBottom: 8, display: 'block',
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px',
  fontSize: 14, fontFamily: FONT, color: C.txt, background: C.surf,
  border: `1px solid ${C.brd2}`, borderRadius: 8, outline: 'none',
};
function btn(bg, fg, brd) {
  return {
    flex: 1, background: bg, color: fg, border: `1px solid ${brd}`,
    borderRadius: 9, padding: '11px 16px', fontSize: 14, fontWeight: 600,
    fontFamily: FONT, cursor: 'pointer',
  };
}
