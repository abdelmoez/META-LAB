/**
 * controls.jsx — Stitch form controls.
 *
 * Presentation only: they forward value/onChange/disabled/required and all native
 * props to real inputs, so existing form engines, schemas, validation, and autosave
 * keep working unchanged. Inputs use a light fill with no border until focus, then a
 * 2px brand ring (DESIGN.md "Input Fields").
 */
import { useId } from 'react';
import { Icon } from '../../components/icons.jsx';
import { S, salpha } from '../theme/stitchTokens.js';

const fieldFill = () => ({
  width: '100%', background: S.surfaceLow, color: S.textPrimary,
  border: `1.5px solid transparent`, borderRadius: S.radiusControl,
  fontFamily: S.font, fontSize: 14, lineHeight: 1.5, outline: 'none',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
});

function applyFocus(e, on) {
  e.currentTarget.style.borderColor = on ? S.brand : 'transparent';
  e.currentTarget.style.background = on ? S.card : S.surfaceLow;
  e.currentTarget.style.boxShadow = on ? `0 0 0 3px ${S.ring}` : 'none';
}

/** Field — label + help/error wrapper. Associates label↔control via htmlFor/id. */
export function StitchField({ label, htmlFor, required, error, help, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label ? (
        <label htmlFor={htmlFor} style={{ fontSize: 12.5, fontWeight: 600, color: S.textSecondary, display: 'flex', gap: 4 }}>
          {label}{required ? <span style={{ color: S.danger }} aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <span role="alert" style={{ fontSize: 12, color: S.danger, fontWeight: 600 }}>{error}</span>
        : help ? <span style={{ fontSize: 12, color: S.textMuted }}>{help}</span> : null}
    </div>
  );
}

export function StitchInput({ invalid = false, icon, style, id, ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {icon ? (
        <span style={{ position: 'absolute', left: 12, color: S.textMuted, pointerEvents: 'none', display: 'inline-flex' }}>
          <Icon name={icon} size={16} />
        </span>
      ) : null}
      <input
        id={fieldId}
        aria-invalid={invalid || undefined}
        onFocus={(e) => applyFocus(e, true)}
        onBlur={(e) => applyFocus(e, false)}
        style={{
          ...fieldFill(),
          padding: icon ? '10px 12px 10px 36px' : '10px 12px',
          borderColor: invalid ? S.danger : 'transparent',
          ...style,
        }}
        {...rest}
      />
    </div>
  );
}

export function StitchSearchInput({ value, onChange, placeholder = 'Search…', onClear, style, ...rest }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }}>
      <span style={{ position: 'absolute', left: 12, color: S.textMuted, pointerEvents: 'none', display: 'inline-flex' }}>
        <Icon name="search" size={16} />
      </span>
      <input
        type="search" value={value} onChange={onChange} placeholder={placeholder}
        onFocus={(e) => applyFocus(e, true)} onBlur={(e) => applyFocus(e, false)}
        style={{ ...fieldFill(), padding: '9px 12px 9px 36px' }}
        {...rest}
      />
    </div>
  );
}

export function StitchTextarea({ invalid = false, rows = 4, style, ...rest }) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      onFocus={(e) => applyFocus(e, true)}
      onBlur={(e) => applyFocus(e, false)}
      style={{ ...fieldFill(), padding: '10px 12px', resize: 'vertical', borderColor: invalid ? S.danger : 'transparent', ...style }}
      {...rest}
    />
  );
}

export function StitchSelect({ invalid = false, children, style, ...rest }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <select
        aria-invalid={invalid || undefined}
        onFocus={(e) => applyFocus(e, true)}
        onBlur={(e) => applyFocus(e, false)}
        style={{
          ...fieldFill(), padding: '10px 36px 10px 12px', appearance: 'none', cursor: 'pointer',
          borderColor: invalid ? S.danger : 'transparent', ...style,
        }}
        {...rest}
      >
        {children}
      </select>
      <span style={{ position: 'absolute', right: 12, color: S.textMuted, pointerEvents: 'none', display: 'inline-flex' }}>
        <Icon name="arrowRight" size={14} style={{ transform: 'rotate(90deg)' }} />
      </span>
    </div>
  );
}

/** Accessible on/off switch (real button with role=switch). */
export function StitchSwitch({ checked = false, onChange, label, disabled = false, id }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <label htmlFor={fieldId} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
      <button
        id={fieldId} type="button" role="switch" aria-checked={checked} disabled={disabled}
        className="stitch-focusable"
        onClick={() => !disabled && onChange?.(!checked)}
        style={{
          width: 40, height: 24, borderRadius: 9999, border: 'none', position: 'relative', cursor: 'inherit',
          background: checked ? S.brand : S.surfaceHighest, transition: 'background 0.18s ease', flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 19 : 3, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', boxShadow: S.shadowSm, transition: 'left 0.18s ease',
        }} />
      </button>
      {label ? <span style={{ fontSize: 13.5, color: S.textPrimary, fontWeight: 500 }}>{label}</span> : null}
    </label>
  );
}

export function StitchCheckbox({ checked = false, onChange, label, disabled = false, id }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <label htmlFor={fieldId} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <button
        id={fieldId} type="button" role="checkbox" aria-checked={checked} disabled={disabled}
        className="stitch-focusable"
        onClick={() => !disabled && onChange?.(!checked)}
        style={{
          width: 18, height: 18, borderRadius: 5, cursor: 'inherit',
          border: `1.5px solid ${checked ? S.brand : S.outlineVariant}`,
          background: checked ? S.brand : S.card, color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'background 0.15s ease, border-color 0.15s ease',
        }}
      >
        {checked ? <Icon name="checkSquare" size={12} style={{ stroke: '#fff' }} /> : null}
      </button>
      {label ? <span style={{ fontSize: 13.5, color: S.textPrimary }}>{label}</span> : null}
    </label>
  );
}
