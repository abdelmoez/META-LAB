/**
 * InstitutionAutocomplete.jsx — institution/organization typeahead (prompt35).
 *
 * Debounced, backend-driven (GET /api/institutions/search → local DB + ROR), with
 * a single-value contract so it drops cleanly into the onboarding engine and the
 * profile page. The user can always keep their own typed name (allowCustom) — a
 * lookup failure NEVER blocks them. Day-first themed, keyboard accessible
 * (combobox + listbox), and mobile-friendly.
 *
 * Value contract:
 *   value: null | string | { name, rorId?, canonicalName?, city?, countryName?,
 *                            countryCode?, source, confidence? }
 *   onChange(answer): fired with the object above (canonical pick) or
 *                     { name, source:'custom' } (typed) or null (cleared).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from './icons.jsx';
import { api } from '../api-client/apiClient.js';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

function answerText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.name || v.canonicalName || '';
}
function locLine(r) {
  return [r.city, r.countryName].filter(Boolean).join(', ');
}

export default function InstitutionAutocomplete({
  value = null,
  onChange,
  placeholder = 'Start typing your institution or organization…',
  disabled = false,
  allowCustom = true,
  autoFocus = false,
  id = 'institution-ac',
}) {
  const [text, setText] = useState(answerText(value));
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | searching | error
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  // Keep the field in sync if the parent replaces the value (e.g. profile load).
  useEffect(() => { setText(answerText(value)); }, [value && (value.name || value.canonicalName || value)]);

  const selectedCanonical = value && typeof value === 'object' && (value.rorId || value.canonicalName)
    && answerText(value) === text ? value : null;

  // Debounced search. Latest-request guard prevents stale results from racing in.
  useEffect(() => {
    const q = text.trim();
    if (q.length < MIN_CHARS) { setResults([]); setStatus('idle'); return undefined; }
    const mySeq = ++seq.current;
    setStatus('searching');
    const t = setTimeout(async () => {
      try {
        const res = await api.institutions.search(q);
        if (mySeq !== seq.current) return;
        setResults(Array.isArray(res?.results) ? res.results : []);
        setStatus('idle');
      } catch {
        if (mySeq !== seq.current) return;
        setResults([]);
        setStatus('error'); // shown softly; the user can still keep their typed name
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const commitCustom = useCallback((raw) => {
    const s = String(raw || '').trim();
    onChange && onChange(s ? { name: s, source: 'custom' } : null);
  }, [onChange]);

  const pick = useCallback((r) => {
    const answer = {
      name: r.canonicalName,
      canonicalName: r.canonicalName,
      rorId: r.rorId || undefined,
      city: r.city || undefined,
      countryName: r.countryName || undefined,
      countryCode: r.countryCode || undefined,
      source: r.source || (r.rorId ? 'ror' : 'local'),
      confidence: typeof r.confidence === 'number' ? r.confidence : undefined,
    };
    setText(r.canonicalName);
    setResults([]);
    setOpen(false);
    setActive(-1);
    onChange && onChange(answer);
    inputRef.current && inputRef.current.focus();
  }, [onChange]);

  function onType(e) {
    const v = e.target.value;
    setText(v);
    setOpen(true);
    setActive(-1);
    if (allowCustom) commitCustom(v); // keep the typed name as the answer until a pick upgrades it
  }

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(-1, i - 1)); }
    else if (e.key === 'Enter') {
      if (active >= 0 && results[active]) { e.preventDefault(); pick(results[active]); }
      else setOpen(false);
    } else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
  }

  function clear() {
    setText(''); setResults([]); setOpen(false); setActive(-1);
    onChange && onChange(null);
    inputRef.current && inputRef.current.focus();
  }

  const q = text.trim();
  const showDropdown = open && q.length >= MIN_CHARS;
  const showNoResults = showDropdown && status === 'idle' && results.length === 0;

  return (
    <div ref={boxRef} style={{ position: 'relative', fontFamily: FONT }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={text}
          placeholder={placeholder}
          onChange={onType}
          onFocus={() => { if (q.length >= MIN_CHARS) setOpen(true); }}
          onKeyDown={onKeyDown}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 36px 10px 12px',
            background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 9,
            color: C.txt, fontSize: 14, fontFamily: FONT, outline: 'none',
            opacity: disabled ? 0.6 : 1,
          }}
        />
        {text && !disabled && (
          <button type="button" onClick={clear} aria-label="Clear institution"
            style={{ position: 'absolute', right: 8, background: 'none', border: 'none', color: C.muted, cursor: 'pointer', display: 'inline-flex', padding: 4 }}>
            <Icon name="x" size={15} />
          </button>
        )}
      </div>

      {/* Selected / status line (non-blocking) */}
      {selectedCanonical ? (
        <div style={{ marginTop: 6, fontSize: 11.5, color: C.grn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="check" size={13} />
          {selectedCanonical.rorId ? 'Linked to a verified institution (ROR)' : 'Linked to a known institution'}
          {locLine(selectedCanonical) ? <span style={{ color: C.muted }}>· {locLine(selectedCanonical)}</span> : null}
        </div>
      ) : status === 'error' ? (
        <div style={{ marginTop: 6, fontSize: 11.5, color: C.muted }}>
          Couldn’t reach institution search — you can keep your typed name.
        </div>
      ) : q.length > 0 && q.length < MIN_CHARS ? (
        <div style={{ marginTop: 6, fontSize: 11.5, color: C.muted }}>Keep typing to search…</div>
      ) : null}

      {showDropdown && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          style={{
            position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', left: 0, right: 0,
            margin: 0, padding: 4, listStyle: 'none', maxHeight: 280, overflowY: 'auto',
            background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, boxShadow: C.shadow,
          }}
        >
          {status === 'searching' && results.length === 0 && (
            <li style={{ padding: '10px 12px', fontSize: 12.5, color: C.muted, fontFamily: MONO }}>Searching…</li>
          )}
          {results.map((r, i) => {
            const on = i === active;
            return (
              <li
                key={(r.rorId || r.canonicalName) + i}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={on}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                style={{
                  padding: '9px 11px', borderRadius: 7, cursor: 'pointer',
                  background: on ? alpha(C.acc, '14') : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.canonicalName}</div>
                  {(locLine(r) || r.usersCount > 0) && (
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>
                      {locLine(r)}{locLine(r) && r.usersCount > 0 ? ' · ' : ''}{r.usersCount > 0 ? `${r.usersCount} member${r.usersCount === 1 ? '' : 's'}` : ''}
                    </div>
                  )}
                </div>
                <span style={{
                  flexShrink: 0, fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.04em',
                  textTransform: 'uppercase', padding: '2px 7px', borderRadius: 6,
                  color: r.source === 'ror' ? C.acc : C.muted,
                  background: r.source === 'ror' ? alpha(C.acc, '14') : alpha(C.txt, '08'),
                  border: `1px solid ${r.source === 'ror' ? alpha(C.acc, '40') : C.brd}`,
                }}>{r.source === 'ror' ? 'ROR' : 'In use'}</span>
              </li>
            );
          })}
          {showNoResults && (
            <li style={{ padding: '10px 12px', fontSize: 12.5, color: C.txt2, lineHeight: 1.5 }}>
              No matches found.{allowCustom ? ' Can’t find your institution? Continue with your typed name.' : ''}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
