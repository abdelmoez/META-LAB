/**
 * features/extraction/FormPanel.jsx — 66.md (P5). CENTER panel: the extraction FORM
 * for the selected study. One section per Data Element (name + description tooltip +
 * required marker + unit), each with a type-appropriate input (dichotomous events/
 * total per arm, continuous mean/sd/n per arm, categorical select, numeric/text/date).
 *
 * Values are the CURRENT extractor's own values (blinded). Editing patches a local
 * draft; the workspace persists via a debounced PUT plus an explicit Save button and
 * shows save status. Each field carries a provenance affordance (a small "source"
 * button opening a popover: type sentence/table/page + excerpt + page number) that is
 * stored on the value's provenance.
 *
 * ARM SCOPE: an arm-scoped element renders one input row per arm in `arms`
 * (default ['intervention','comparator']); a study-scoped element renders a single row
 * under armKey ''. The value map is keyed `${elementId}::${armKey || ''}` (model.js).
 */
import { useState } from 'react';
import { C, btnS, inp, lbl, themeAlpha, ValueInput } from './parts.jsx';

const DEFAULT_ARMS = ['intervention', 'comparator'];
const keyOf = (elementId, armKey) => `${elementId}::${armKey || ''}`;

const PROV_TYPES = [['sentence', 'Sentence'], ['table', 'Table'], ['page', 'Page / figure']];

/* ── Provenance popover ────────────────────────────────────────────────────── */
function ProvenancePopover({ provenance, onSave, onClose }) {
  const p = provenance && typeof provenance === 'object' ? provenance : {};
  const [type, setType] = useState(p.type || 'sentence');
  const [excerpt, setExcerpt] = useState(p.excerpt || '');
  const [page, setPage] = useState(p.page == null ? '' : String(p.page));

  return (
    <div style={{
      position: 'absolute', zIndex: 40, top: '100%', right: 0, marginTop: 6, width: 320,
      background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 10, padding: 12,
      boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.5, marginBottom: 8 }}>WHERE DID THIS VALUE COME FROM?</div>
      <label style={lbl}>Source type</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {PROV_TYPES.map(([k, label]) => (
          <button key={k} onClick={() => setType(k)} style={{
            padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            border: `1px solid ${type === k ? themeAlpha(C.acc, '66') : C.brd}`,
            background: type === k ? themeAlpha(C.acc, '18') : 'transparent',
            color: type === k ? C.acc : C.muted,
          }}>{label}</button>
        ))}
      </div>
      <label style={lbl}>Excerpt (quote the source)</label>
      <textarea
        value={excerpt} onChange={(e) => setExcerpt(e.target.value)}
        placeholder="e.g. “42 of 210 patients (20.0%) in the intervention arm…”"
        style={{ ...inp, height: 62, resize: 'vertical', fontSize: 11.5, lineHeight: 1.45, marginBottom: 10 }}
      />
      <label style={lbl}>Page number (optional)</label>
      <input value={page} onChange={(e) => setPage(e.target.value)} placeholder="e.g. 5" inputMode="numeric"
        style={{ ...inp, fontSize: 12, marginBottom: 12, width: 90 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={{ ...btnS('ghost'), fontSize: 11 }}>Cancel</button>
        <button
          onClick={() => {
            const out = { type, excerpt: excerpt.trim() };
            const pg = Number(page);
            if (page.trim() && Number.isFinite(pg)) out.page = pg;
            onSave(out);
          }}
          style={{ ...btnS('primary'), fontSize: 11 }}
        >Save source</button>
      </div>
    </div>
  );
}

/* ── One field row (a single element × arm) ────────────────────────────────── */
function FieldRow({ element, armKey, armLabel, entry, disabled, onChange, onProvenance }) {
  const [showProv, setShowProv] = useState(false);
  const value = entry ? entry.value : {};
  const provenance = entry ? entry.provenance : null;
  const hasProv = provenance && (provenance.excerpt || provenance.type || provenance.page != null);
  const isAi = entry && (entry.origin === 'ai_accepted' || entry.origin === 'ai_edited');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, position: 'relative' }}>
      {armLabel && (
        <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: 0.5, textTransform: 'uppercase' }}>{armLabel}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ValueInput element={element} value={value} onChange={onChange} disabled={disabled} />
        </div>
        <button
          onClick={() => setShowProv((s) => !s)}
          title={hasProv ? 'Edit the source for this value' : 'Add the source for this value'}
          disabled={disabled}
          style={{
            ...btnS('ghost'), fontSize: 10.5, padding: '5px 9px', whiteSpace: 'nowrap',
            color: hasProv ? C.grn : C.muted, borderColor: hasProv ? themeAlpha(C.grn, '55') : C.brd2,
          }}
        >{hasProv ? '✓ source' : 'source'}</button>
      </div>
      {isAi && (
        <span style={{ fontSize: 10, color: C.purp }}>
          {entry.origin === 'ai_accepted' ? 'From an accepted suggestion' : 'Edited from a suggestion'}
        </span>
      )}
      {showProv && (
        <ProvenancePopover
          provenance={provenance}
          onClose={() => setShowProv(false)}
          onSave={(prov) => { onProvenance(prov); setShowProv(false); }}
        />
      )}
    </div>
  );
}

/* ── Element section ───────────────────────────────────────────────────────── */
function ElementSection({ element, arms, entries, disabled, onFieldChange, onFieldProvenance }) {
  const armList = element.armScope === 'arm' ? arms : [''];
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 9, padding: 13 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>
          {element.name || '(unnamed element)'}
          {element.required ? <span style={{ color: C.red, marginLeft: 4 }} title="Required">*</span> : null}
        </span>
        {element.unit ? <span style={{ fontSize: 10.5, color: C.dim }}>({element.unit})</span> : null}
        {element.armScope === 'arm' ? (
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 0.3 }}>· per arm</span>
        ) : null}
        {element.description ? (
          <span title={element.description} style={{
            fontSize: 10, color: C.muted, cursor: 'help', border: `1px solid ${C.brd2}`,
            borderRadius: 99, width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>?</span>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {armList.map((armKey) => {
          const label = element.armScope === 'arm'
            ? (armKey.charAt(0).toUpperCase() + armKey.slice(1))
            : '';
          return (
            <FieldRow
              key={keyOf(element.id, armKey)}
              element={element}
              armKey={armKey}
              armLabel={label}
              entry={entries[keyOf(element.id, armKey)]}
              disabled={disabled}
              onChange={(val) => onFieldChange(element, armKey, val)}
              onProvenance={(prov) => onFieldProvenance(element, armKey, prov)}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Panel ─────────────────────────────────────────────────────────────────── */
export default function FormPanel({
  study, elements, entries, arms = DEFAULT_ARMS, disabled,
  saveStatus, dirty, onFieldChange, onFieldProvenance, onSave, onAdjudicate, canAdjudicate,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {/* Study header + save controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.txt, lineHeight: 1.3 }}>{study.title || '(untitled study)'}</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
            {[study.author, study.year].filter(Boolean).join(' · ')}
            {study.doi ? ` · ${study.doi}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: saveStatus === 'saved' ? C.grn : saveStatus === 'error' ? C.red : C.muted }}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'All changes saved' : saveStatus === 'error' ? 'Save failed' : dirty ? 'Unsaved changes' : ''}
          </span>
          {canAdjudicate && (
            <button onClick={onAdjudicate} style={{ ...btnS('ghost'), fontSize: 12 }} title="Compare both extractors and resolve conflicts">Adjudicate</button>
          )}
          <button onClick={onSave} disabled={disabled || !dirty} style={{ ...btnS('primary'), fontSize: 12, opacity: (disabled || !dirty) ? 0.5 : 1 }}>
            Save
          </button>
        </div>
      </div>

      {elements.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.muted, padding: 20, textAlign: 'center', lineHeight: 1.55 }}>
          The extraction form has no data elements yet. Open <strong>Form</strong> to add elements or pick a template.
        </div>
      ) : (
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 2 }}>
          {elements.map((el) => (
            <ElementSection
              key={el.id}
              element={el}
              arms={arms}
              entries={entries}
              disabled={disabled}
              onFieldChange={onFieldChange}
              onFieldProvenance={onFieldProvenance}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export { keyOf, DEFAULT_ARMS };
