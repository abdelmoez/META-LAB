/**
 * features/extraction/AiAssistPanel.jsx — 66.md (P5). RIGHT-panel "AI assist" tab.
 * Generates extraction SUGGESTIONS (never commits them) via POST /ai-suggest, then
 * lets the extractor Accept (writes the value into the form with origin 'ai_accepted'
 * + provenance + suggestionId), Edit (fills the field for manual tweak, origin
 * 'ai_edited'), or Reject (dims it). "Mark reviewed" flips the suggestion set to
 * reviewed. The mandatory human-review banner is ALWAYS shown.
 *
 * Suggestion payload shape (heuristicExtract.suggestFromText):
 *   Found:     { elementId, armKey, value, confidence:'low'|'medium',
 *                provenance:{ type:'sentence', excerpt, location }, notFound:false, [ambiguity] }
 *   Not found: { elementId, notFound:true }
 */
import { useState } from 'react';
import { C, btnS, inp, lbl, themeAlpha, Chip, AiReviewBanner, renderValue } from './parts.jsx';

const CONF_TONE = { high: 'green', medium: 'blue', low: 'amber' };

function SuggestionRow({ element, suggestion, rejected, onAccept, onEdit, onReject, disabled }) {
  if (!suggestion || suggestion.notFound) {
    return (
      <div style={{ padding: '8px 11px', border: `1px solid ${C.brd}`, borderRadius: 8, opacity: 0.7 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.txt }}>{element ? element.name : suggestion.elementId}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>No value proposed — the assistant found nothing to extract.</div>
      </div>
    );
  }
  return (
    <div style={{
      padding: '10px 11px', border: `1px solid ${rejected ? C.brd : themeAlpha(C.purp, '40')}`,
      borderRadius: 8, opacity: rejected ? 0.5 : 1, background: rejected ? 'transparent' : themeAlpha(C.purp, '08'),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.txt, flex: 1, minWidth: 0 }}>
          {element ? element.name : suggestion.elementId}
          {suggestion.armKey ? <span style={{ color: C.dim, fontWeight: 400 }}> · {suggestion.armKey}</span> : null}
        </span>
        {suggestion.confidence && <Chip tone={CONF_TONE[suggestion.confidence] || 'muted'}>{suggestion.confidence} confidence</Chip>}
      </div>
      <div style={{ fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", color: C.acc, marginBottom: 6 }}>
        {element ? renderValue(element, suggestion.value) : JSON.stringify(suggestion.value)}
      </div>
      {suggestion.provenance && suggestion.provenance.excerpt && (
        <div style={{
          fontSize: 11, color: C.muted, fontStyle: 'italic', lineHeight: 1.5, marginBottom: 6,
          borderLeft: `2px solid ${C.brd2}`, paddingLeft: 8,
        }}>“{suggestion.provenance.excerpt}”</div>
      )}
      {suggestion.ambiguity && (
        <div style={{ fontSize: 10.5, color: C.yel, marginBottom: 6, lineHeight: 1.45 }}>⚠ {suggestion.ambiguity}</div>
      )}
      {!rejected && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onAccept} disabled={disabled} style={{ ...btnS('success'), fontSize: 11, padding: '5px 12px' }}>Accept</button>
          <button onClick={onEdit} disabled={disabled} style={{ ...btnS('ghost'), fontSize: 11, padding: '5px 12px' }}>Edit</button>
          <button onClick={onReject} disabled={disabled} style={{ ...btnS('ghost'), fontSize: 11, padding: '5px 12px', color: C.red, borderColor: themeAlpha(C.red, '40') }}>Reject</button>
        </div>
      )}
      {rejected && <span style={{ fontSize: 10.5, color: C.dim }}>Rejected — not written to the form.</span>}
    </div>
  );
}

export default function AiAssistPanel({
  elementsById, suggestion, llm, aiEnabled, disabled,
  loading, error, onSuggest, onAccept, onEdit, onReject, onMarkReviewed, rejectedKeys,
}) {
  const [text, setText] = useState('');
  const payload = suggestion && Array.isArray(suggestion.payload) ? suggestion.payload : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <AiReviewBanner />

      {llm && (
        <div style={{ fontSize: 10.5, color: C.dim }}>
          Provider: <strong style={{ color: C.muted }}>{llm.provider || 'heuristic'}</strong>
          {llm.model ? ` · ${llm.model}` : ''}
        </div>
      )}

      {!aiEnabled && (
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          AI extraction assist is disabled by the administrator. You can still extract values manually in the form.
        </div>
      )}

      {aiEnabled && (
        <>
          <div>
            <label style={lbl}>Paste methods/results text for better coverage (optional)</label>
            <textarea
              value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Paste the relevant Methods and Results passages so the assistant has more than the abstract to work from…"
              style={{ ...inp, height: 76, resize: 'vertical', fontSize: 11.5, lineHeight: 1.5 }}
              disabled={disabled || loading}
            />
          </div>
          <button
            onClick={() => onSuggest(text)}
            disabled={disabled || loading}
            style={{ ...btnS('primary'), fontSize: 12, opacity: (disabled || loading) ? 0.6 : 1 }}
          >
            {loading ? 'Generating…' : 'Suggest values (AI)'}
          </button>
        </>
      )}

      {error && <div style={{ fontSize: 11.5, color: C.red, lineHeight: 1.5 }}>{error}</div>}

      {payload.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 0.5 }}>SUGGESTIONS ({payload.length})</span>
            {suggestion.status !== 'reviewed' ? (
              <button onClick={onMarkReviewed} disabled={disabled} style={{ ...btnS('ghost'), fontSize: 10.5, padding: '4px 10px' }}>Mark reviewed</button>
            ) : (
              <Chip tone="green">Reviewed</Chip>
            )}
          </div>
          {payload.map((sg, i) => {
            const key = `${sg.elementId}::${sg.armKey || ''}`;
            return (
              <SuggestionRow
                key={`${key}-${i}`}
                element={elementsById[sg.elementId]}
                suggestion={sg}
                rejected={rejectedKeys.has(key)}
                disabled={disabled}
                onAccept={() => onAccept(sg)}
                onEdit={() => onEdit(sg)}
                onReject={() => onReject(sg)}
              />
            );
          })}
        </div>
      )}

      {aiEnabled && !loading && payload.length === 0 && !error && (
        <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5, marginTop: 2 }}>
          No suggestions yet. Click <strong>Suggest values (AI)</strong> to generate a set to review.
        </div>
      )}
    </div>
  );
}
