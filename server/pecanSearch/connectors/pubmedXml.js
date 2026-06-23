/**
 * pecanSearch/connectors/pubmedXml.js — a focused, tolerant parser for PubMed
 * efetch (db=pubmed, retmode=xml, rettype=abstract) responses.
 *
 * We deliberately avoid adding an XML-parser dependency: PubMed's PubmedArticle
 * XML is regular enough that a per-article, field-targeted extraction is reliable
 * and fully unit-testable with recorded fixtures. The parser is PURE and TOTAL —
 * a malformed article block yields a partial record (never throws), so one bad
 * record never breaks a page.
 *
 * Output: an array of PARTIAL records (the raw-ish field bag) that the connector
 * passes to normalize.js. Each item also carries `_raw` (the article XML block,
 * capped) for provenance.
 */

/** Decode XML entities used in PubMed text. */
function decode(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&amp;/g, '&'); // amp last so we don't double-decode
}
function cp(n) { try { return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; } catch { return ''; } }

/** Strip XML tags (e.g. <i>, <sup>) from inner content, then decode + collapse. */
function stripTags(s) { return decode(String(s == null ? '' : s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }

/** First captured group of a regex against `xml`, tag-stripped, or ''. */
function pick(xml, re) { const m = xml.match(re); return m ? stripTags(m[1]) : ''; }

/** All captured first-groups (tag-stripped) of a global regex. */
function pickAll(xml, re) {
  const out = []; let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(xml))) { const v = stripTags(m[1]); if (v) out.push(v); }
  return out;
}

/** Split the efetch document into per-article XML blocks. */
export function splitArticles(xml) {
  const s = String(xml || '');
  const blocks = [];
  const re = /<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g;
  let m;
  while ((m = re.exec(s))) blocks.push(m[0]);
  // PubmedBookArticle (rare) — include for completeness.
  const reBook = /<PubmedBookArticle\b[\s\S]*?<\/PubmedBookArticle>/g;
  while ((m = reBook.exec(s))) blocks.push(m[0]);
  return blocks;
}

/** Parse ONE PubmedArticle block into a partial record. */
export function parseArticle(block) {
  const xml = String(block || '');

  // PMID — the first <PMID …>…</PMID> (the MedlineCitation PMID).
  const pmid = pick(xml, /<PMID[^>]*>(\d+)<\/PMID>/);

  // Title.
  const title = pick(xml, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)
    || pick(xml, /<BookTitle[^>]*>([\s\S]*?)<\/BookTitle>/);

  // Abstract — concatenate all AbstractText sections, prefixing labels when present.
  const absParts = [];
  const absRe = /<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/g;
  let am;
  while ((am = absRe.exec(xml))) {
    const attrs = am[1] || '';
    const labelM = attrs.match(/Label=['"]([^'"]*)['"]/);
    const text = stripTags(am[2]);
    if (!text) continue;
    absParts.push(labelM && labelM[1] ? `${stripTags(labelM[1])}: ${text}` : text);
  }
  const abstract = absParts.join(' ');

  // Authors — LastName + ForeName/Initials, in document order.
  const authors = [];
  const authRe = /<Author\b[\s\S]*?<\/Author>/g;
  let aum;
  while ((aum = authRe.exec(xml))) {
    const a = aum[0];
    const last = pick(a, /<LastName>([\s\S]*?)<\/LastName>/);
    const fore = pick(a, /<ForeName>([\s\S]*?)<\/ForeName>/) || pick(a, /<Initials>([\s\S]*?)<\/Initials>/);
    const collective = pick(a, /<CollectiveName>([\s\S]*?)<\/CollectiveName>/);
    if (last) authors.push(fore ? `${last} ${fore}` : last);
    else if (collective) authors.push(collective);
  }

  // Journal + bibliographic detail.
  const journal = pick(xml, /<Journal\b[\s\S]*?<Title>([\s\S]*?)<\/Title>/)
    || pick(xml, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/);
  const volume = pick(xml, /<Volume>([\s\S]*?)<\/Volume>/);
  const issue = pick(xml, /<Issue>([\s\S]*?)<\/Issue>/);
  const pages = pick(xml, /<MedlinePgn>([\s\S]*?)<\/MedlinePgn>/);

  // Year — PubDate Year, else MedlineDate, else ArticleDate.
  const year = pick(xml, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)
    || (pick(xml, /<PubDate>[\s\S]*?<MedlineDate>([\s\S]*?)<\/MedlineDate>/).match(/\d{4}/) || [''])[0]
    || pick(xml, /<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/);

  // Identifiers — ELocationID / ArticleId by IdType (tolerant of single/double quotes).
  const doi = pick(xml, /<ELocationID[^>]*EIdType=['"]doi['"][^>]*>([\s\S]*?)<\/ELocationID>/)
    || pick(xml, /<ArticleId[^>]*IdType=['"]doi['"][^>]*>([\s\S]*?)<\/ArticleId>/);
  const pmcid = pick(xml, /<ArticleId[^>]*IdType=['"]pmc['"][^>]*>([\s\S]*?)<\/ArticleId>/);

  // Publication types + language.
  const pubType = pickAll(xml, /<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/);
  const language = pick(xml, /<Language>([\s\S]*?)<\/Language>/);

  // MeSH descriptors + keywords.
  const meshTerms = pickAll(xml, /<DescriptorName[^>]*>([\s\S]*?)<\/DescriptorName>/);
  const keywords = pickAll(xml, /<Keyword[^>]*>([\s\S]*?)<\/Keyword>/);

  // Retraction signal (PublicationType "Retracted Publication" or "Retraction of Publication").
  const retracted = /Retracted Publication|Retraction of Publication/i.test(xml);

  return {
    providerRecordId: pmid || '',
    pmid, pmcid, doi,
    title, abstract,
    authors, year, journal, volume, issue, pages,
    pubType, language, meshTerms, keywords, retracted,
    url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '',
    _raw: xml.slice(0, 20000),
  };
}

/** Parse a full efetch XML document into an array of partial records. */
export function parsePubmedXml(xml) {
  return splitArticles(xml).map(parseArticle);
}

/** Parse an esearch JSON response → { count, idlist, webenv, queryKey }. */
export function parseEsearch(json) {
  const r = (json && json.esearchresult) || {};
  const count = /^\d+$/.test(String(r.count)) ? parseInt(r.count, 10) : null;
  return {
    count,
    idlist: Array.isArray(r.idlist) ? r.idlist : [],
    webenv: r.webenv || '',
    queryKey: r.querykey || '',
    warnings: r.warninglist ? r.warninglist : null,
    error: r.error || (r.errorlist ? JSON.stringify(r.errorlist) : ''),
  };
}
