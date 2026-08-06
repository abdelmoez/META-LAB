/**
 * SearchMeaningPanel.jsx — 100.md §§6-11. "What this search is looking for."
 *
 * A READ-ONLY reading of the live search strategy, in language that needs no Boolean
 * theory, no parentheses, no MeSH, no field tags. It sits directly under the concept
 * board and replaces the retired "Your search so far" panel and the always-on database
 * previews (100.md §§1-2).
 *
 * Design rules it obeys:
 *  · §8  READ-ONLY. There is not one control here that edits the strategy — no term
 *        chips, no AND/OR toggle, no rename. Editing happens on the board above, which
 *        stays the single place a strategy is changed.
 *  · §9  LIVE. It renders `interpretStrategy(...)` of the SAME in-memory concepts the
 *        compilers use, so it re-renders in the same commit as the query. No save, no
 *        refresh, no second copy of the state.
 *  · §10 The Boolean structure is the LAYOUT: one card per concept, "any one of these"
 *        inside, an explicit connector sentence between. Nobody has to decode
 *        `(A OR B) AND (C OR D)`.
 *  · §11 The exact per-database strings stay one click away in a closed disclosure, so
 *        the technical layer is never lost — just not in the way.
 *
 * Presentational leaf: plain props + pure helpers, no fetch, no state beyond the
 * native <details> the browser owns.
 */
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { Disclosure } from '../../pecanSearch/components/parts.jsx';
import { interpretStrategy, TERM_KIND } from '../../../research-engine/searchBuilder/interpretation.js';

const KIND_LABEL = {
  [TERM_KIND.PHRASE]: 'phrase',
  [TERM_KIND.WORD]: 'word',
  [TERM_KIND.PREFIX]: 'word start',
  [TERM_KIND.SUBJECT]: 'subject',
};

function TermLine({ term }) {
  const subject = term.kind === TERM_KIND.SUBJECT;
  return (
    <li data-testid="sm-term" data-kind={term.kind}
      style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0', fontSize: 12, color: C.txt2, lineHeight: 1.6 }}>
      <span aria-hidden="true"
        style={{
          flexShrink: 0, fontSize: 8, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
          color: subject ? C.grn : C.muted, border: `1px solid ${alpha(subject ? C.grn : C.muted, '55')}`,
          borderRadius: 4, padding: '0 5px', minWidth: 54, textAlign: 'center',
        }}>
        {KIND_LABEL[term.kind] || 'term'}
      </span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{term.reading}</span>
    </li>
  );
}

function ConceptBlock({ group, index }) {
  return (
    <li data-testid="sm-group" style={{ listStyle: 'none' }}>
      {group.join && (
        <div data-testid="sm-join" data-op={group.join}
          style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 2px' }}>
          <span aria-hidden="true" style={{ flex: 1, height: 1, background: C.brd2 }} />
          <span style={{
            fontFamily: MONO, fontSize: 9.5, fontWeight: 800, letterSpacing: 1,
            color: group.join === 'OR' ? C.yel : C.acc,
            background: alpha(group.join === 'OR' ? C.yel : C.acc, '10'),
            border: `1px solid ${alpha(group.join === 'OR' ? C.yel : C.acc, '44')}`,
            borderRadius: 6, padding: '2px 9px', flexShrink: 0,
          }}>{group.join}</span>
          <span style={{ fontSize: 11.5, color: C.muted, flexShrink: 0 }}>{group.joinReading}</span>
          <span aria-hidden="true" style={{ flex: 1, height: 1, background: C.brd2 }} />
        </div>
      )}
      <div style={{ background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 9, padding: '10px 13px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: C.muted, textTransform: 'uppercase' }}>
            Idea {index + 1}
          </span>
          <span data-testid="sm-group-name" style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>{group.name}</span>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{group.anyReading}</div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {group.terms.map((t, i) => <TermLine key={i} term={t} />)}
        </ul>
      </div>
    </li>
  );
}

/**
 * props
 *   concepts, filters   the LIVE canonical strategy (same objects the compilers get)
 *   compiled            optional compileAll() results — the §11 technical disclosure
 *   technicalHint       optional one-liner saying where those queries can be EDITED
 */
export default function SearchMeaningPanel({ concepts, filters, compiled, technicalHint }) {
  const model = interpretStrategy({ concepts, filters });

  return (
    <section data-testid="sb-search-meaning" aria-label="What this search is looking for"
      style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14, fontFamily: FONT }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>
        What this search is looking for
      </h3>

      {model.isEmpty ? (
        <p data-testid="sm-empty" style={{ margin: 0, fontSize: 12, color: C.muted, fontStyle: 'italic', lineHeight: 1.6 }}>
          Add a term to a concept above and this will explain, in plain English, exactly what Pecan will search for.
        </p>
      ) : (
        <>
          <p data-testid="sm-summary"
            style={{ margin: '0 0 12px', fontSize: 13.5, color: C.txt, lineHeight: 1.65, fontWeight: 600 }}>
            {model.summary}
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {model.groups.map((g, i) => <ConceptBlock key={g.id} group={g} index={i} />)}
          </ul>
        </>
      )}

      {model.limits.length > 0 && (
        <div data-testid="sm-limits" style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.brd2}` }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
            Narrowed to
          </div>
          {model.limits.map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: C.txt2, lineHeight: 1.6 }}>{l}</div>
          ))}
        </div>
      )}

      {model.skipped.length > 0 && (
        <div data-testid="sm-skipped" style={{ marginTop: 10, fontSize: 11, color: C.muted, lineHeight: 1.55 }}>
          Not part of the search yet (no terms): {model.skipped.join(', ')}.
        </div>
      )}

      {/* 100.md §11 — the technical layer stays reachable, one click away and closed by
          default, so beginners never meet database syntax and specialists never lose it. */}
      {Array.isArray(compiled) && compiled.length > 0 && !model.isEmpty && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.brd2}` }}>
          <Disclosure summary={`Exact database queries (${compiled.length})`}>
            {technicalHint && (
              <div style={{ fontSize: 10.5, color: C.dim, lineHeight: 1.55, marginBottom: 8 }}>{technicalHint}</div>
            )}
            {compiled.map((res) => (
              <div key={res.dbId} data-testid={`sm-db-query-${res.dbId}`} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.txt2 }}>{res.label}</span>
                  {res.overridden && (
                    <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: C.yel, textTransform: 'uppercase' }}>edited</span>
                  )}
                  {res.vocab && res.vocab.fallback > 0 && (
                    <span title="This database has no verified equivalent for your subject heading, so the concept was searched as free text."
                      style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: C.muted, textTransform: 'uppercase' }}>
                      subject → free text
                    </span>
                  )}
                </div>
                <pre tabIndex={0} aria-label={`${res.label} query`}
                  style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 7, padding: 9, margin: 0, fontFamily: MONO, fontSize: 10.5, lineHeight: 1.6, color: C.txt2, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflowY: 'auto' }}>
                  {res.query || '(no terms)'}
                </pre>
              </div>
            ))}
          </Disclosure>
        </div>
      )}
    </section>
  );
}
