/**
 * features/manuscript/richEditor/AbstractEditor.jsx — 65.md (MS-5). Structured
 * abstract editor: renders the template's `**Label.** text` subsections as
 * labelled rich-text fields and serializes every edit back into the SINGLE
 * markdown string the engine persists (sections.abstract — shape unchanged).
 * Free-form abstracts (pattern mismatch) fall back to one rich editor.
 */
import { useMemo, useRef } from 'react';
import { C, tagS } from '../../../frontend/workspace/ui/styles.js';
import {
  parseAbstractSubsections, serializeAbstractSubsections, abstractTemplateInfo,
  abstractWordCount, isPlaceholderText,
} from '../../../research-engine/manuscript/index.js';
import { RichSectionEditor } from './RichSectionEditor.jsx';

export function AbstractEditor({ value, templateId, orderMap, assetNumbers = null, resetKey, onChange, onActivate, readOnly = false }) {
  const parsed = useMemo(() => parseAbstractSubsections(value), [value]);
  const info = useMemo(() => abstractTemplateInfo(templateId), [templateId]);
  const totalWords = abstractWordCount(value);

  // Freshest subsections at edit time (a render is always in flight while typing).
  const subsRef = useRef(parsed.subsections);
  subsRef.current = parsed.subsections;

  const overLimit = info.wordLimit != null && totalWords > info.wordLimit;
  const counter = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      <span data-testid="stitch-manuscript-abstract-words"
        style={tagS(overLimit ? 'red' : 'gray')}>
        {totalWords} word{totalWords === 1 ? '' : 's'}{info.wordLimit != null ? ` / ~${info.wordLimit} limit` : ''}
      </span>
      {info.wordLimit != null && (
        <span style={{ fontSize: 10.5, color: overLimit ? C.red : C.muted }}>
          {overLimit ? 'Over the template word limit — trim before submission.' : 'Template word limit is a guide — verify against the journal.'}
        </span>
      )}
    </div>
  );

  if (!parsed.matched) {
    return (
      <div>
        {counter}
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
          Free-form abstract — regenerate from the template to get labelled subsections.
        </div>
        <RichSectionEditor key={resetKey} value={value} orderMap={orderMap} assetNumbers={assetNumbers}
          onChange={onChange} onActivate={onActivate} readOnly={readOnly}
          ariaLabel="Abstract" placeholder="Write or generate the abstract…" minHeight={280} />
      </div>
    );
  }

  const onField = (i, mdText) => {
    const subs = subsRef.current.map((s, j) => (j === i ? { ...s, text: mdText } : s));
    onChange(serializeAbstractSubsections(subs));
  };

  const labelsPresent = new Set(parsed.subsections.map((s) => s.label.toLowerCase()));
  const missing = info.labels.filter((l) => !labelsPresent.has(l.toLowerCase()));

  return (
    <div data-testid="stitch-manuscript-abstract-editor">
      {counter}
      {missing.length > 0 && (
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 10 }}>
          Template also expects: {missing.join(', ')} — regenerate the abstract to add them.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {parsed.subsections.map((sub, i) => {
          const filled = !isPlaceholderText(sub.text);
          const words = abstractWordCount(sub.text);
          return (
            <div key={`${sub.label}:${i}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
                  color: filled ? C.grn : C.muted, fontFamily: "'IBM Plex Sans',sans-serif",
                }}>
                  {filled ? '✓' : '○'} {sub.label}
                </span>
                <span style={{ fontSize: 9.5, color: C.muted, fontFamily: "'IBM Plex Sans',sans-serif" }}>
                  {words} w
                </span>
              </div>
              <div style={{ borderLeft: `2px solid ${filled ? '#c8e6c9' : '#e2e6ee'}`, paddingLeft: 12 }}>
                <RichSectionEditor
                  key={`${resetKey}:${i}`}
                  value={sub.text}
                  orderMap={orderMap}
                  assetNumbers={assetNumbers}
                  onChange={(md) => onField(i, md)}
                  onActivate={onActivate}
                  readOnly={readOnly}
                  ariaLabel={`Abstract — ${sub.label}`}
                  testId={`stitch-manuscript-abstract-field-${i}`}
                  placeholder={`${sub.label}…`}
                  minHeight={56}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AbstractEditor;
