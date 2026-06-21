/**
 * fields.jsx — accessible form primitives for the Beta Waitlist (prompt48 §12).
 * Token-styled (no second design system), native controls for maximum keyboard /
 * screen-reader / touch support. Every field: a real <label htmlFor>, a required
 * marker that is NOT colour-only, aria-describedby wiring for hint + error, and an
 * error announced via role="alert". Focus rings come from the global token CSS.
 */

import { C, FONT } from '../../theme/tokens.js';

const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: C.txt, marginBottom: 6, fontFamily: FONT };
const hintStyle = { fontSize: 12, color: C.muted, marginTop: 5, fontFamily: FONT, lineHeight: 1.5 };
const errorStyle = { fontSize: 12.5, color: C.red, marginTop: 6, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 };

function controlStyle(hasError) {
  return {
    width: '100%',
    boxSizing: 'border-box',
    height: 46,
    padding: '0 14px',
    fontSize: 15,
    fontFamily: FONT,
    color: C.txt,
    background: C.card,
    border: `1px solid ${hasError ? C.red : C.brd2}`,
    borderRadius: 10,
    outline: 'none',
  };
}

function RequiredMark({ required }) {
  if (!required) return null;
  // Asterisk is decorative; the real signal for AT is the visually-hidden text.
  return (
    <>
      <span aria-hidden="true" style={{ color: C.red, marginLeft: 3 }}>*</span>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}> (required)</span>
    </>
  );
}

function ErrorText({ id, error }) {
  if (!error) return null;
  return (
    <div id={id} role="alert" style={errorStyle}>
      <span aria-hidden="true" style={{
        display: 'inline-flex', width: 15, height: 15, borderRadius: '50%', background: C.red, color: '#fff',
        alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0,
      }}>!</span>
      <span>{error}</span>
    </div>
  );
}

function describedBy(id, hint, error) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
}

export function TextField({ id, label, value, onChange, error, required, type = 'text', autoComplete, placeholder, hint, maxLength, inputMode }) {
  return (
    <div style={{ position: 'relative' }}>
      <label htmlFor={id} style={labelStyle}>{label}<RequiredMark required={required} /></label>
      <input
        id={id} type={type} value={value} placeholder={placeholder}
        autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required || undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        style={controlStyle(Boolean(error))}
      />
      {hint && <div id={`${id}-hint`} style={hintStyle}>{hint}</div>}
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}

export function TextareaField({ id, label, value, onChange, error, required, placeholder, hint, maxLength, rows = 4 }) {
  return (
    <div style={{ position: 'relative' }}>
      <label htmlFor={id} style={labelStyle}>{label}<RequiredMark required={required} /></label>
      <textarea
        id={id} value={value} placeholder={placeholder} rows={rows} maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required || undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        style={{ ...controlStyle(Boolean(error)), height: 'auto', padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }}
      />
      {hint && <div id={`${id}-hint`} style={hintStyle}>{hint}</div>}
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}

export function SelectField({ id, label, value, onChange, options, error, required, placeholder = 'Select…', hint }) {
  return (
    <div style={{ position: 'relative' }}>
      <label htmlFor={id} style={labelStyle}>{label}<RequiredMark required={required} /></label>
      <div style={{ position: 'relative' }}>
        <select
          id={id} value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-required={required || undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy(id, hint, error)}
          style={{ ...controlStyle(Boolean(error)), appearance: 'none', paddingRight: 38, cursor: 'pointer' }}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span aria-hidden="true" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: C.muted, fontSize: 12 }}>▾</span>
      </div>
      {hint && <div id={`${id}-hint`} style={hintStyle}>{hint}</div>}
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}

/** Accessible multi-select rendered as a labelled fieldset of checkboxes. */
export function CheckboxGroupField({ legend, options, values, onChange, hint, error, columns = 2 }) {
  const set = new Set(values || []);
  const toggle = (v) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  };
  const groupId = `cbg-${legend.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }} aria-describedby={describedBy(groupId, hint, error)}>
      <legend style={{ ...labelStyle, padding: 0 }}>{legend}</legend>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8, marginTop: 4 }}>
        {options.map((opt) => {
          const checked = set.has(opt);
          return (
            <label key={opt} style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', cursor: 'pointer',
              border: `1px solid ${checked ? C.acc : C.brd2}`, borderRadius: 9,
              background: checked ? C.accBg : C.card, fontSize: 13.5, color: C.txt, fontFamily: FONT,
            }}>
              <input type="checkbox" checked={checked} onChange={() => toggle(opt)} style={{ width: 16, height: 16, accentColor: 'var(--t-acc)', flexShrink: 0 }} />
              <span>{opt}</span>
            </label>
          );
        })}
      </div>
      {hint && <div id={`${groupId}-hint`} style={hintStyle}>{hint}</div>}
      <ErrorText id={`${groupId}-error`} error={error} />
    </fieldset>
  );
}

/** Consent checkbox — never pre-checked; label content passed as children. */
export function ConsentCheckbox({ id, checked, onChange, error, children }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, cursor: 'pointer' }}>
        <input
          id={id} type="checkbox" checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          style={{ width: 18, height: 18, accentColor: 'var(--t-acc)', marginTop: 2, flexShrink: 0 }}
        />
        <span style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.55, fontFamily: FONT }}>{children}</span>
      </label>
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}
