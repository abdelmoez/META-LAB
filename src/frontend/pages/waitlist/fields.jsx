/**
 * fields.jsx — accessible form-field wrappers for the Beta Waitlist, rendered
 * NATIVE to the Stitch design system (54.md). They reuse the Stitch primitives
 * (StitchInput/StitchSelect/StitchTextarea/StitchRadioGroup) and the theme-aware
 * `S` tokens so the public page matches the rest of the app (deep-purple focus,
 * 8px radius, light fill).
 *
 * The accessible contract is preserved exactly:
 *   - a real <label htmlFor> (or <legend> for groups);
 *   - a required marker that is NOT colour-only (decorative asterisk +
 *     visually-hidden " (required)" text);
 *   - aria-describedby wiring hint + error ids onto the control;
 *   - aria-invalid / aria-required on the control;
 *   - the error announced via role="alert".
 */

import { S, salpha } from '../../stitch/theme/stitchTokens.js';
import { StitchInput, StitchSelect, StitchTextarea, StitchRadioGroup } from '../../stitch/primitives/index.js';

const labelStyle = {
  display: 'block', fontSize: 13, fontWeight: 600, color: S.textPrimary,
  marginBottom: 6, fontFamily: S.font,
};
const hintStyle = { fontSize: 12, color: S.textMuted, marginTop: 5, fontFamily: S.font, lineHeight: 1.5 };
const errorStyle = {
  fontSize: 12.5, color: S.danger, marginTop: 6, fontFamily: S.font,
  display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600,
};

export function RequiredMark({ required }) {
  if (!required) return null;
  // The asterisk is decorative; the real signal for AT is the visually-hidden text.
  return (
    <>
      <span aria-hidden="true" style={{ color: S.danger, marginLeft: 3 }}>*</span>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}> (required)</span>
    </>
  );
}

export function ErrorText({ id, error }) {
  if (!error) return null;
  return (
    <div id={id} role="alert" style={errorStyle}>
      <span aria-hidden="true" style={{
        display: 'inline-flex', width: 15, height: 15, borderRadius: '50%', background: S.danger, color: S.onDanger,
        alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0,
      }}>!</span>
      <span>{error}</span>
    </div>
  );
}

export function describedBy(id, hint, error) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
}

export function TextField({ id, label, value, onChange, error, required, type = 'text', autoComplete, placeholder, hint, maxLength, inputMode, icon }) {
  return (
    <div style={{ position: 'relative' }}>
      <label htmlFor={id} style={labelStyle}>{label}<RequiredMark required={required} /></label>
      <StitchInput
        id={id} type={type} value={value} placeholder={placeholder} icon={icon}
        autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        invalid={Boolean(error)}
        aria-required={required || undefined}
        aria-describedby={describedBy(id, hint, error)}
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
      <StitchTextarea
        id={id} value={value} placeholder={placeholder} rows={rows} maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        invalid={Boolean(error)}
        aria-required={required || undefined}
        aria-describedby={describedBy(id, hint, error)}
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
      <StitchSelect
        id={id} value={value}
        onChange={(e) => onChange(e.target.value)}
        invalid={Boolean(error)}
        aria-required={required || undefined}
        aria-describedby={describedBy(id, hint, error)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </StitchSelect>
      {hint && <div id={`${id}-hint`} style={hintStyle}>{hint}</div>}
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}

/** Accessible single-select rendered as a labelled fieldset of radio "cards". */
export function RadioGroupField({ id, legend, value, onChange, options, error, required, hint, columns = 1 }) {
  const legendId = `${id}-legend`;
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend id={legendId} style={{ ...labelStyle, padding: 0 }}>{legend}<RequiredMark required={required} /></legend>
      <StitchRadioGroup
        name={id}
        value={value}
        onChange={onChange}
        options={options}
        columns={columns}
        ariaLabelledBy={legendId}
        ariaDescribedBy={describedBy(id, hint, error)}
        invalid={Boolean(error)}
      />
      {hint && <div id={`${id}-hint`} style={hintStyle}>{hint}</div>}
      <ErrorText id={`${id}-error`} error={error} />
    </fieldset>
  );
}

/** Accessible multi-select rendered as a labelled fieldset of checkbox cards. */
export function CheckboxGroupField({ legend, options, values, onChange, hint, error, columns = 2 }) {
  const set = new Set(values || []);
  const toggle = (v) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  };
  const groupId = `cbg-${String(legend).replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }} aria-describedby={describedBy(groupId, hint, error)}>
      <legend style={{ ...labelStyle, padding: 0 }}>{legend}</legend>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8, marginTop: 4 }}>
        {options.map((opt) => {
          const checked = set.has(opt);
          return (
            <label key={opt} style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', cursor: 'pointer',
              border: `1.5px solid ${checked ? S.brand : S.outlineVariant}`, borderRadius: S.radiusControl,
              background: checked ? salpha(S.brand, 0.08) : S.card, fontSize: 13.5, color: S.textPrimary, fontFamily: S.font,
              transition: 'border-color 0.15s ease, background 0.15s ease',
            }}>
              <input
                type="checkbox" checked={checked} onChange={() => toggle(opt)}
                style={{ width: 16, height: 16, accentColor: S.brand, flexShrink: 0 }}
              />
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
          style={{ width: 18, height: 18, accentColor: S.brand, marginTop: 2, flexShrink: 0 }}
        />
        <span style={{ fontSize: 13.5, color: S.textSecondary, lineHeight: 1.55, fontFamily: S.font }}>{children}</span>
      </label>
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}
