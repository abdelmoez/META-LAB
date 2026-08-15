/**
 * server/routes/citation.js — same-origin proxy for citation metadata lookups
 * (prompt 51 review fix).
 *
 * The "Add Study by DOI / PMID" auto-fill (src/frontend/services/aiService.js)
 * used to fetch CrossRef + NCBI E-utilities DIRECTLY from the browser. That would
 * be blocked by the strict `connect-src 'self'` CSP under enforcement. Proxying
 * the request through the server keeps the policy tight AND matches the project's
 * "external APIs are server-proxied" invariant (PubMed, OpenAlex, etc. already
 * go through the server).
 *
 * The proxy is a thin pass-through: the upstream JSON/text is returned verbatim
 * so ALL parsing stays in the existing client code (no behavior change). Mounted
 * behind requireAuth so it cannot be used as an open relay; inputs are strictly
 * validated; nothing user-controlled reaches the URL except an encoded id.
 */
import express from 'express';

const router = express.Router();

const CROSSREF = 'https://api.crossref.org/works/';
const NCBI = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
// 117.md §29 — PMCID → PMID/DOI. Same public NCBI ID Converter the OA PDF resolver
// already uses (server/services/pmidToDoi.js); reusing the endpoint keeps one
// external contract instead of two.
const IDCONV = 'https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/';
// CrossRef "polite pool" identification (no secret; an email improves rate limits).
const CONTACT = process.env.APP_CONTACT_EMAIL || 'support@pecanrev.com';
const UA = `PecanRev/1.0 (mailto:${CONTACT})`;
// NCBI is happier (and faster) with an API key, but it is OPTIONAL — the public
// rate limit works without it, exactly as the old direct browser fetch did.
function ncbiKey() {
  const k = process.env.NCBI_API_KEY || process.env.SEARCH_ENGINE_NCBI_KEY;
  return k ? `&api_key=${encodeURIComponent(k)}` : '';
}

const TIMEOUT_MS = 12_000;

/** Fetch an upstream URL and stream its body back verbatim (JSON or text). */
async function passthrough(res, url, { text = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { Accept: text ? 'text/plain' : 'application/json', 'User-Agent': UA },
      signal: ctrl.signal,
    });
    if (!r.ok) return res.status(502).json({ error: `Upstream returned ${r.status}` });
    if (text) {
      res.type('text/plain; charset=utf-8');
      return res.send(await r.text());
    }
    res.type('application/json; charset=utf-8');
    return res.send(await r.text()); // pass JSON through unparsed (client parses it)
  } catch {
    return res.status(502).json({ error: 'Citation lookup failed' });
  } finally {
    clearTimeout(timer);
  }
}

// DOI → CrossRef. DOI goes in the QUERY (DOIs contain '/', which a path param
// would split); encodeURIComponent neutralizes any path/host escaping.
router.get('/crossref', (req, res) => {
  const doi = String(req.query.doi || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (!doi || doi.length > 256) return res.status(400).json({ error: 'Invalid DOI' });
  return passthrough(res, CROSSREF + encodeURIComponent(doi));
});

// PMID → NCBI esummary (citation) / efetch (abstract). id is digits only.
router.get('/pubmed/esummary', (req, res) => {
  const id = String(req.query.id || '').replace(/[^0-9]/g, '');
  if (!id || id.length > 20) return res.status(400).json({ error: 'Invalid PMID' });
  return passthrough(res, `${NCBI}esummary.fcgi?db=pubmed&id=${id}&retmode=json${ncbiKey()}`);
});

router.get('/pubmed/efetch', (req, res) => {
  const id = String(req.query.id || '').replace(/[^0-9]/g, '');
  if (!id || id.length > 20) return res.status(400).json({ error: 'Invalid PMID' });
  return passthrough(res, `${NCBI}efetch.fcgi?db=pubmed&id=${id}&rettype=abstract&retmode=text${ncbiKey()}`, { text: true });
});

/**
 * 117.md §29 — PMCID → the record's other identifiers (PMID, DOI).
 *
 * The proxy stays a pass-through: the CLIENT turns the returned ids into a PubMed
 * or CrossRef lookup, exactly as it does for a typed PMID. Input is normalised to
 * `PMC<digits>` before it reaches the URL, so nothing user-controlled can escape
 * the query — the same rule the DOI and PMID routes follow.
 */
router.get('/pmcid', (req, res) => {
  const digits = String(req.query.id || '').trim().replace(/^PMC/i, '').replace(/[^0-9]/g, '');
  if (!digits || digits.length > 20) return res.status(400).json({ error: 'Invalid PMCID' });
  return passthrough(res, `${IDCONV}?ids=${encodeURIComponent(`PMC${digits}`)}&format=json`);
});

/**
 * 117.md §29 — TITLE → CrossRef bibliographic search.
 *
 * `query.bibliographic` is CrossRef's own free-form citation matcher, which is the
 * right tool for "I have the title, find the record". Bounded to 5 rows: this is a
 * lookup to CONFIRM, never a literature search (that is the Search engine's job),
 * and an unbounded row count would turn a citation proxy into a scraping relay.
 */
router.get('/crossref/search', (req, res) => {
  const q = String(req.query.q || '').trim().replace(/[\r\n]+/g, ' ');
  if (q.length < 6 || q.length > 512) return res.status(400).json({ error: 'Invalid search title' });
  const rowsRaw = parseInt(String(req.query.rows || '5'), 10);
  const rows = Number.isFinite(rowsRaw) ? Math.min(Math.max(rowsRaw, 1), 5) : 5;
  const select = 'DOI,title,author,container-title,issued,volume,issue,page,publisher,ISBN,URL,type,abstract';
  return passthrough(
    res,
    `${CROSSREF}?query.bibliographic=${encodeURIComponent(q)}&rows=${rows}&select=${encodeURIComponent(select)}`,
  );
});

export default router;
