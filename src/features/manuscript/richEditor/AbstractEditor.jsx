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

// 117.md §11 — the abstract carries cross-references too, so the registry set and
// the caption template are threaded straight through to every subsection editor: a
// reference to a deleted table must read as broken WHEREVER it sits.
//
// 118.md §8.1 — …and so does every OTHER shared editor prop. `fieldProps` is the
// panel's per-section prop bag (the same one `editorProps(sectionId)` builds for
// body sections, with the owning section reported as 'abstract'), spread into every
// subsection editor. Without it the abstract mounted editors that knew nothing about
// the citation style or the reference library, so a citation inserted in the
// abstract rendered as a bare numeric chip with no hover card and no action menu
// while the identical citation in Methods rendered "(Smith, 2020)" and opened one.
// Per-field props (value/onChange/testId/ariaLabel/placeholder/minHeight) are applied
// AFTER the spread and always win — a bag can never take a field's own identity.
// 120.md §5 — the abstract's registry entry must DIE with its editors.
//
// A body section registers through `apiRef` and un-registers when React detaches
// it. The abstract has no ref of its own: its sub-editors register by ACTIVATING
// (that is what makes `apiFor('abstract')` honest about which field holds the
// caret), and there was no cleanup at all — so after a regenerate, a template
// switch or a snapshot restore, `apis['abstract']` still pointed at an editor
// whose DOM had been thrown away, and every insert routed to it silently
// disappeared into detached nodes. `onRelease(api)` is the missing half: the
// workspace drops the entry only when the handle being released is the one it
// holds, so a field unmounting while ANOTHER field owns the caret changes nothing.
export function AbstractEditor({
  value, templateId, orderMap, assetNumbers = null, resetKey, onChange, onActivate,
  readOnly = false, knownAssetIds = null, captionTemplateId = null,
  fieldProps = null, onRelease = null,
}) {
  const parsed = useMemo(() => parseAbstractSubsections(value), [value]);
  const info = useMemo(() => abstractTemplateInfo(templateId), [templateId]);
  const totalWords = abstractWordCount(value);

  /* 118.md §8.1 — ONE bag, built once per render, mounted by every field (and by
     the free-form fallback). `templateId` here is the CAPTION/label template the
     rich editor formats with, which is a different prop from this component's own
     `templateId` (the abstract's STRUCTURE template); the explicit
     `captionTemplateId` keeps winning, and falls back to the bag's when a caller
     passes only the bag. */
  const field = {
    ...(fieldProps || {}),
    orderMap,
    assetNumbers,
    knownAssetIds,
    templateId: captionTemplateId != null ? captionTemplateId : ((fieldProps && fieldProps.templateId) || null),
    onActivate,
    readOnly,
  };

  // Freshest subsections at edit time (a render is always in flight while typing).
  const subsRef = useRef(parsed.subsections);
  subsRef.current = parsed.subsections;

  /* 120.md §5 — one STABLE ref callback per field slot. Stability is the whole
     point: an inline arrow would be a new callback on every render, React would
     detach and re-attach the ref each time, and the release would fire (dropping a
     LIVE registry entry) on every keystroke. Cached by index, so a callback is
     created once per slot and fires with null exactly when that slot's editor is
     genuinely unmounted. */
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const fieldApis = useRef(new Map());
  const fieldRefs = useRef(new Map());
  const refFor = (slot) => {
    if (!fieldRefs.current.has(slot)) {
      fieldRefs.current.set(slot, (apiHandle) => {
        if (apiHandle) { fieldApis.current.set(slot, apiHandle); return; }
        const prev = fieldApis.current.get(slot);
        fieldApis.current.delete(slot);
        if (prev && releaseRef.current) releaseRef.current(prev);
      });
    }
    return fieldRefs.current.get(slot);
  };

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
        <RichSectionEditor key={resetKey} ref={refFor('free')} {...field} value={value}
          onChange={onChange}
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
                  ref={refFor(i)}
                  {...field}
                  value={sub.text}
                  onChange={(md) => onField(i, md)}
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
