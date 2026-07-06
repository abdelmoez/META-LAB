/**
 * features/extraction/engine/ArticleList.jsx — 76.md §6 (Article list).
 *
 * The Pecan Extraction Engine entry view: every extraction-stage article for the
 * project as a calm, scannable list with per-row status / progress / validation /
 * PDF availability / analysis-sync, plus search, sort, status filters, a "continue
 * where you left off" affordance, and full keyboard navigation (↑/↓ move, Enter opens).
 * Presentational — the parent owns data + open/complete actions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { C, btnS, inp, tagS } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { filterSortArticles, ARTICLE_SORTS } from '../../../research-engine/extraction/engine/articleList.js';
import { STATUS_META, ARTICLE_STATUSES } from '../../../research-engine/extraction/engine/articleStatus.js';
import { SYNC_STATUS_META } from '../../../research-engine/extraction/engine/syncState.js';

const TONE_TAG = { neutral: 'gray', info: 'blue', warn: 'yellow', brand: 'purple', success: 'green' };
function StatusTag({ status }) {
  const meta = STATUS_META[status] || { label: status, tone: 'neutral' };
  return <span style={tagS(TONE_TAG[meta.tone] || 'gray')}>{meta.label}</span>;
}
function SyncTag({ sync }) {
  const meta = SYNC_STATUS_META[sync] || null;
  if (!meta || sync === 'not_ready') return null;
  return <span style={tagS(TONE_TAG[meta.tone] || 'gray')}>{meta.label}</span>;
}

function ProgressBar({ pct }) {
  const col = pct >= 100 ? C.grn : pct > 0 ? C.acc : C.brd2;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 99, background: themeAlpha(C.brd, '80'), overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: col, transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ fontSize: 10.5, color: C.muted, fontFamily: "'IBM Plex Mono',monospace", width: 30, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

const STAT_CHIPS = [
  { key: '', label: 'All' },
  ...ARTICLE_STATUSES.map((s) => ({ key: s, label: (STATUS_META[s] || {}).label || s })),
];

export default function ArticleList({
  articles = [], stats = null, loading = false, error = '',
  onOpen, onRefresh, canEdit = false, lastArticleId = '',
}) {
  const [query, setQuery] = useState({ search: '', status: '', sort: 'recent', pdf: '', issues: '' });
  const [active, setActive] = useState(0);   // keyboard cursor
  const listRef = useRef(null);
  const set = (patch) => setQuery((q) => ({ ...q, ...patch }));

  const rows = useMemo(() => filterSortArticles(articles, query), [articles, query]);
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, rows.length - 1))); }, [rows.length]);

  const lastArticle = useMemo(() => articles.find((a) => a.id === lastArticleId && a.status !== 'complete' && a.status !== 'locked'), [articles, lastArticleId]);

  const onKeyDown = (e) => {
    if (!rows.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; if (r) onOpen && onOpen(r.id); }
  };

  return (
    <div data-testid="pex-article-list" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header: title + stats + continue */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '4px 2px 14px' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.txt, letterSpacing: '-0.01em' }}>Articles for extraction</div>
          {stats ? (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              {stats.total} article{stats.total === 1 ? '' : 's'} · {stats.complete} complete · {stats.inProgress} in progress
              {stats.needsValidation ? ` · ${stats.needsValidation} need validation` : ''} · avg {stats.avgProgress}% extracted
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastArticle ? (
            <button onClick={() => onOpen && onOpen(lastArticle.id)} style={btnS('primary')}>
              ↩ Continue: {(lastArticle.author || lastArticle.title || 'last article').slice(0, 28)}
            </button>
          ) : null}
          {onRefresh ? <button onClick={onRefresh} style={btnS('ghost')} title="Refresh the list">↻</button> : null}
        </div>
      </div>

      {/* Controls: search + status chips + sort + filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', paddingBottom: 12, borderBottom: `1px solid ${C.brd}` }}>
        <input
          value={query.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search title, author, year, DOI, outcome…"
          aria-label="Search articles"
          style={{ ...inp, width: 300, maxWidth: '48vw' }}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {STAT_CHIPS.map((c) => (
            <button key={c.key || 'all'} onClick={() => set({ status: c.key })}
              style={{ ...btnS(query.status === c.key ? 'primary' : 'ghost'), padding: '5px 11px', fontSize: 11 }}>
              {c.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <select value={query.pdf} onChange={(e) => set({ pdf: e.target.value })} aria-label="PDF filter" style={{ ...inp, width: 'auto', fontSize: 12 }}>
          <option value="">PDF: any</option>
          <option value="yes">Has PDF</option>
          <option value="no">No PDF</option>
        </select>
        <select value={query.issues} onChange={(e) => set({ issues: e.target.value })} aria-label="Validation filter" style={{ ...inp, width: 'auto', fontSize: 12 }}>
          <option value="">Checks: any</option>
          <option value="errors">Has errors</option>
          <option value="warnings">Has warnings</option>
          <option value="clean">Clean</option>
        </select>
        <select value={query.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort" style={{ ...inp, width: 'auto', fontSize: 12 }}>
          {ARTICLE_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {/* List */}
      <div ref={listRef} tabIndex={0} onKeyDown={onKeyDown} role="listbox" aria-label="Extraction articles"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', outline: 'none', paddingTop: 8 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading articles…</div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.red, fontSize: 13 }}>{error}</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted, fontSize: 13 }}>
            {articles.length === 0
              ? 'No articles have reached extraction yet. Accept full-text records in Screening to send them here.'
              : 'No articles match these filters.'}
          </div>
        ) : rows.map((a, i) => (
          <div key={a.id} role="option" aria-selected={i === active}
            onClick={() => { setActive(i); onOpen && onOpen(a.id); }}
            onMouseEnter={() => setActive(i)}
            style={{
              display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 150px 130px auto', gap: 14, alignItems: 'center',
              padding: '12px 14px', borderRadius: 10, cursor: 'pointer', marginBottom: 6,
              background: i === active ? themeAlpha(C.acc, '0d') : C.card,
              border: `1px solid ${i === active ? themeAlpha(C.acc, '40') : C.brd}`,
            }}>
            {/* col 1: identity */}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <StatusTag status={a.status} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '52ch' }}>
                  {a.author || a.title || '(untitled study)'}{a.year ? ` (${a.year})` : ''}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.outcome ? `${a.outcome}` : <span style={{ color: C.dim }}>outcome not named</span>}
                {a.journal ? ` · ${a.journal}` : ''}{a.doi ? ` · ${a.doi}` : ''}
              </div>
            </div>
            {/* col 2: progress */}
            <ProgressBar pct={a.progressPct} />
            {/* col 3: signals */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span title={a.pdfAvailable ? 'PDF available' : 'No PDF linked'} style={{ fontSize: 12, color: a.pdfAvailable ? C.grn : C.dim }}>
                  {a.pdfAvailable ? '📄' : '—'}
                </span>
                {a.validationErrors > 0 ? <span style={tagS('red')}>{a.validationErrors} err</span>
                  : a.validationWarnings > 0 ? <span style={tagS('yellow')}>{a.validationWarnings} warn</span>
                    : <span style={{ fontSize: 11, color: C.grn }}>✓</span>}
              </div>
              <SyncTag sync={a.syncStatus} />
            </div>
            {/* col 4: open */}
            <button onClick={(e) => { e.stopPropagation(); onOpen && onOpen(a.id); }} style={{ ...btnS('ghost'), fontSize: 11 }}>
              {canEdit ? 'Open →' : 'View →'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
