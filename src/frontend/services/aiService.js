/* AI / CITATION SERVICES (extracted from meta-lab-3-patched.jsx) -- prompt46 Phase 5.
   Moved VERBATIM out of the monolith. All behind AI_FEATURES_ENABLED=false (dead-ish);
   the callClaude infrastructure stays fully intact. Self-contained: uses only browser
   globals (fetch, FileReader, setTimeout, JSON, Promise). */

/* ════════════ AI FEATURE VISIBILITY (prompt6 Task 16) ════════════ */
// AI features hidden pending future implementation.
// Single visibility flag — flip to true to restore every AI surface (AIButton,
// the Search-string generator panel, the AI Study Extractor, the Claude citation
// fallback in Add Study, the PROSPERO generator, the Manuscript drafter, and the
// AI marketing copy). The callClaude infrastructure below stays fully intact.
export const AI_FEATURES_ENABLED = false;

/* ════════════ AI CALL HELPER ════════════ */
// Try models in order — most current first
export const CLAUDE_MODELS = ["claude-sonnet-4-6","claude-sonnet-4-5-20250514","claude-3-5-sonnet-20241022"];

export async function callClaude(prompt, maxTokens=2000) {
  // `prompt` may be a plain string OR an array of content blocks (text/document/image)
  var content = (typeof prompt === "string") ? prompt : prompt;
  var lastErr = null;
  for (var mi = 0; mi < CLAUDE_MODELS.length; mi++) {
    var model = CLAUDE_MODELS[mi];
    try {
      var body = JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        messages: [{role: "user", content: content}]
      });
      var resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: body,
      });
      var rawText = await resp.text();
      var data;
      try { data = JSON.parse(rawText); }
      catch (parseErr) {
        lastErr = new Error("Response not JSON (HTTP " + resp.status + "): " + rawText.slice(0, 200));
        continue;
      }
      if (!resp.ok) {
        var msg = (data && data.error && data.error.message) || ("HTTP " + resp.status);
        lastErr = new Error("[" + model + "] " + msg);
        // Rate-limited: wait and retry the same model (up to 2 retries)
        if (resp.status === 429) {
          var retryAfter = parseInt(resp.headers.get("retry-after") || "8", 10);
          var wait = Math.max(retryAfter, 8) * 1000;
          for (var ri = 0; ri < 2; ri++) {
            await new Promise(res => setTimeout(res, wait));
            var r2 = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{"Content-Type":"application/json"}, body:body });
            var rt = await r2.text();
            var d2; try{ d2=JSON.parse(rt); }catch(_){ break; }
            if (r2.ok) {
              var t2 = d2.content ? d2.content.map(function(b){return b.text||"";}).join("").trim() : "";
              if (t2) return t2;
            }
            if (r2.status !== 429) break;
            wait = wait * 2;
          }
          continue; // try next model
        }
        // If it's a model-specific error, try the next one
        if (msg.toLowerCase().indexOf("model") !== -1 || resp.status === 404) continue;
        throw lastErr;
      }
      var text = "";
      if (data && data.content && data.content.map) {
        text = data.content.map(function(b){ return b.text || ""; }).join("").trim();
      }
      if (!text) {
        lastErr = new Error("Empty response from " + model);
        continue;
      }
      return text;
    } catch (e) {
      lastErr = e;
      // Network / DOMException — try next model
      if (e.name === "TypeError" || e.name === "AbortError") continue;
      // Otherwise propagate immediately
      if (mi === CLAUDE_MODELS.length - 1) throw e;
    }
  }
  throw lastErr || new Error("All model attempts failed");
}

/* Like callClaude but enables the server-side web_search tool and concatenates all
   text blocks across the (possibly multi-step) response. Used for citation lookup,
   which can't reach CrossRef/PubMed directly from the sandboxed browser. */
export async function callClaudeWeb(prompt, maxTokens=1500) {
  var lastErr = null;
  for (var mi = 0; mi < CLAUDE_MODELS.length; mi++) {
    var model = CLAUDE_MODELS[mi];
    try {
      var body = JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        messages: [{role:"user", content: prompt}],
        tools: [{type:"web_search_20250305", name:"web_search", max_uses:3}],
      });
      var resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"}, body: body,
      });
      var rawText = await resp.text();
      var data; try { data = JSON.parse(rawText); }
      catch(e){ lastErr=new Error("Response not JSON (HTTP "+resp.status+")"); continue; }
      if(!resp.ok){
        var msg=(data&&data.error&&data.error.message)||("HTTP "+resp.status);
        lastErr=new Error("["+model+"] "+msg);
        if(msg.toLowerCase().indexOf("model")!==-1||resp.status===404) continue;
        // tool not supported on this model → try next
        if(msg.toLowerCase().indexOf("tool")!==-1) continue;
        throw lastErr;
      }
      var text="";
      if(data&&data.content&&data.content.map){
        text=data.content.map(function(b){return b.type==="text"?(b.text||""):"";}).join("").trim();
      }
      if(!text){ lastErr=new Error("Empty response from "+model); continue; }
      return text;
    } catch(e){
      lastErr=e;
      if(e.name==="TypeError"||e.name==="AbortError") continue;
      if(mi===CLAUDE_MODELS.length-1) throw e;
    }
  }
  throw lastErr || new Error("All model attempts failed");
}

/* AI-assisted citation lookup via web search — works inside the sandbox.
   kind: "doi" | "pmid" | "title". Returns the same shape as fetchByDOI/fetchByPMID. */
export async function fetchCitationAI(kind, value){
  const v=String(value).trim();
  const what = kind==="doi" ? `the article with DOI "${v}"`
             : kind==="pmid" ? `the PubMed article with PMID ${v}`
             : `the article titled "${v}"`;
  const prompt=`Find ${what} and return its bibliographic details. Search the web (PubMed, CrossRef, or the publisher) to confirm.

Respond with ONLY a JSON object, no markdown, no commentary:
{"title":"","authors":"semicolon-separated Family Initials","journal":"","year":"YYYY","doi":"","pmid":"","abstract":"short abstract if available"}

If you cannot find a real match, return {"notfound":true}. Do not invent details.`;
  const text=await callClaudeWeb(prompt,1800);
  const parsed=safeParseJSON(text);
  if(!parsed||parsed.notfound) throw new Error("No reliable match found online.");
  const authors=String(parsed.authors||"").trim();
  const first=authors?authors.split(/[;,]/)[0].trim():"";
  return {
    title:parsed.title||"",
    authors,
    author:first?(first.split(" ")[0]+(authors.split(/;/).length>1?" et al.":"")):"",
    journal:parsed.journal||"",
    year:parsed.year?String(parsed.year).match(/\d{4}/)?.[0]||"":"",
    doi:(parsed.doi||"").replace(/^https?:\/\/(dx\.)?doi\.org\//i,""),
    pmid:parsed.pmid?String(parsed.pmid).replace(/[^0-9]/g,""):(kind==="pmid"?v.replace(/[^0-9]/g,""):""),
    abstract:(parsed.abstract||"").replace(/\s+/g," ").trim().slice(0,4000),
  };
}

/* Read a File as base64 (strips the data: prefix) */
export function fileToBase64(file){
  return new Promise(function(resolve,reject){
    var r=new FileReader();
    r.onload=function(){ var res=String(r.result); var comma=res.indexOf(","); resolve(comma>=0?res.slice(comma+1):res); };
    r.onerror=function(){ reject(new Error("Could not read the file.")); };
    r.readAsDataURL(file);
  });
}

/* ════════════ CITATION LOOKUP (via same-origin /api/citation proxy) ════════════ */
/* The proxy passes CrossRef/NCBI responses through verbatim, so parsing here is
   unchanged — but the browser only ever talks to its own origin, keeping the
   strict CSP `connect-src 'self'` intact (prompt 51).

   117.md §29 — the "smart reference lookup" behind Add Reference resolves DOI,
   PMID, PMCID and TITLE through these same functions. Two rules apply throughout:
     - every field returned is one the upstream registry actually stated. Nothing is
       inferred, completed or guessed — a missing volume comes back as "", so the
       Add Reference preview can show honestly that it is missing.
     - the caller applies the result as an `auto` patch, which by contract never
       overwrites a field the researcher already corrected by hand. */

/* 117.md §29 — CrossRef `type` → our §28 reference taxonomy. Only unambiguous
   mappings; anything else is left unset so the library keeps its own default. */
const CROSSREF_TYPE_TO_REFERENCE_TYPE = {
  "journal-article": "journal-article",
  "posted-content": "preprint",
  "book": "book", "monograph": "book", "reference-book": "book",
  "book-chapter": "book-chapter", "book-section": "book-chapter", "book-part": "book-chapter",
  "proceedings-article": "conference-proceeding",
  "report": "report", "report-component": "report",
  "dissertation": "thesis",
  "dataset": "dataset",
  "component": "other", "standard": "guideline", "peer-review": "other",
};

/** Map one CrossRef `message` object onto the reference shape. Pure. */
export function crossrefToReference(m, doiHint){
  const msg=m||{};
  const auth=(msg.author||[]).map(a=>[a.family,a.given].filter(Boolean).join(" ")).filter(Boolean);
  const yr=(msg.issued&&msg.issued["date-parts"]&&msg.issued["date-parts"][0]&&msg.issued["date-parts"][0][0])||
    (msg["published-print"]&&msg["published-print"]["date-parts"]&&msg["published-print"]["date-parts"][0][0])||
    (msg["published-online"]&&msg["published-online"]["date-parts"]&&msg["published-online"]["date-parts"][0][0])||"";
  const out={
    title:(msg.title&&msg.title[0])||"",
    authors:auth.join("; "),
    author:auth.length?(auth[0].split(" ").slice(-1)[0]+(auth.length>1?" et al.":"")):"",
    journal:(msg["container-title"]&&msg["container-title"][0])||"",
    year:yr?String(yr):"",
    doi:String(doiHint||msg.DOI||"").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i,""),
    // 117.md §27 — the fields the manuscript's Vancouver/JAMA/APA formatters need.
    volume:msg.volume?String(msg.volume):"",
    issue:msg.issue?String(msg.issue):"",
    pages:msg.page?String(msg.page):"",
    articleNumber:msg["article-number"]?String(msg["article-number"]):"",
    publisher:msg.publisher||"",
    isbn:(Array.isArray(msg.ISBN)&&msg.ISBN[0])||"",
    url:msg.URL||"",
    language:msg.language||"",
    abstract:(msg.abstract||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(),
  };
  const t=CROSSREF_TYPE_TO_REFERENCE_TYPE[String(msg.type||"").toLowerCase()];
  if(t) out.referenceType=t;
  return out;
}

/* DOI → CrossRef (proxied) */
export async function fetchByDOI(doi){
  const clean=String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i,"");
  const resp=await fetch("/api/citation/crossref?doi="+encodeURIComponent(clean),{headers:{Accept:"application/json"},credentials:"include"});
  if(!resp.ok) throw new Error("CrossRef returned HTTP "+resp.status+" for that DOI.");
  const data=await resp.json();
  return crossrefToReference(data.message||{},clean);
}
/* PMID → NCBI E-utilities (esummary for citation, efetch for abstract), proxied. */
export async function fetchByPMID(pmid){
  const id=String(pmid).trim().replace(/[^0-9]/g,"");
  if(!id) throw new Error("Enter a numeric PubMed ID.");
  const sumResp=await fetch(`/api/citation/pubmed/esummary?id=${id}`,{credentials:"include"});
  if(!sumResp.ok) throw new Error("PubMed returned HTTP "+sumResp.status+".");
  const sum=await sumResp.json();
  const rec=sum.result&&sum.result[id];
  if(!rec||rec.error) throw new Error("No PubMed record found for PMID "+id+".");
  const auth=(rec.authors||[]).map(a=>a.name).filter(Boolean);
  const yr=(rec.pubdate||"").match(/\d{4}/);
  let abstract="";
  try{
    const abResp=await fetch(`/api/citation/pubmed/efetch?id=${id}`,{credentials:"include"});
    if(abResp.ok){ abstract=(await abResp.text()).replace(/\s+/g," ").trim().slice(0,4000); }
  }catch(_){}
  // 117.md §27 — esummary states volume/issue/pages/language/PMCID/publication type
  // in fields this parser used to ignore; the reference library needs all of them.
  const pmcid=(rec.articleids||[]).filter(a=>a&&a.idtype==="pmcid").map(a=>String(a.value||"").trim())[0]||"";
  const doiId=(rec.articleids||[]).filter(a=>a&&a.idtype==="doi").map(a=>String(a.value||"").trim())[0]||"";
  return {
    title:rec.title||"",
    authors:auth.join("; "),
    author:auth.length?(auth[0].split(" ")[0]+(auth.length>1?" et al.":"")):"",
    journal:rec.fulljournalname||rec.source||"",
    year:yr?yr[0]:"",
    doi:doiId||(rec.elocationid||"").replace(/^doi:\s*/i,""),
    pmid:id,
    pmcid:(pmcid.match(/PMC\d+/i)||[""])[0],
    volume:rec.volume?String(rec.volume):"",
    issue:rec.issue?String(rec.issue):"",
    pages:rec.pages?String(rec.pages):"",
    language:(Array.isArray(rec.lang)?rec.lang[0]:rec.lang)||"",
    publicationType:(Array.isArray(rec.pubtype)?rec.pubtype.join("; "):"")||"",
    abstract,
  };
}
/* 117.md §29 — PMCID → PMID/DOI via the ID Converter, then the normal record
   lookup. Returns the SAME shape as fetchByPMID/fetchByDOI so every caller (and
   the Add Reference preview) treats all four lookup kinds identically. */
export async function fetchByPMCID(pmcid){
  const digits=String(pmcid).trim().replace(/^PMC/i,"").replace(/[^0-9]/g,"");
  if(!digits) throw new Error("Enter a PubMed Central ID (e.g. PMC1234567).");
  const resp=await fetch(`/api/citation/pmcid?id=PMC${digits}`,{credentials:"include"});
  if(!resp.ok) throw new Error("PubMed Central returned HTTP "+resp.status+".");
  const data=await resp.json();
  const rec=(data&&Array.isArray(data.records)?data.records[0]:null)||null;
  if(!rec||rec.status==="error") throw new Error("No record found for PMC"+digits+".");
  const pmid=String(rec.pmid||"").replace(/[^0-9]/g,"");
  const doi=String(rec.doi||"").trim();
  if(pmid){ const out=await fetchByPMID(pmid); return { ...out, pmcid:`PMC${digits}` }; }
  if(doi){ const out=await fetchByDOI(doi); return { ...out, pmcid:`PMC${digits}` }; }
  throw new Error("PMC"+digits+" has no linked PubMed record or DOI.");
}
/* 117.md §29 — TITLE → CrossRef bibliographic match. Returns CANDIDATES, never a
   silent pick: a title is ambiguous by nature, so the user confirms which record
   is theirs before anything is written. */
export async function searchCitationsByTitle(title){
  const q=String(title||"").trim();
  if(q.length<6) throw new Error("Enter at least a few words of the title.");
  const resp=await fetch("/api/citation/crossref/search?q="+encodeURIComponent(q),{headers:{Accept:"application/json"},credentials:"include"});
  if(!resp.ok) throw new Error("CrossRef returned HTTP "+resp.status+" for that title.");
  const data=await resp.json();
  const items=(data&&data.message&&Array.isArray(data.message.items))?data.message.items:[];
  return items.map(m=>crossrefToReference(m)).filter(r=>r.title);
}

export async function testClaudeConnection() {
  try {
    var result = await callClaude("Say only the word: OK", 20);
    return { ok: true, message: result };
  } catch (e) {
    return { ok: false, message: e.message, name: e.name || "Error" };
  }
}

/* Robust JSON extractor — handles unterminated strings, stray newlines, truncation */
export function safeParseJSON(raw) {
  var s = String(raw).trim();
  // Strip markdown fences using charCode (no regex with newlines)
  var BT = String.fromCharCode(96);
  if (s.charCodeAt(0)===96 && s.charCodeAt(1)===96 && s.charCodeAt(2)===96) {
    var nl = -1;
    for (var k=0; k<s.length; k++){ if(s.charCodeAt(k)===10){ nl=k; break; } }
    if (nl !== -1) s = s.slice(nl + 1);
    var fence = s.lastIndexOf(BT+BT+BT);
    if (fence !== -1) s = s.slice(0, fence);
    s = s.trim();
  }
  var start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found');
  s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch(e1) {}
  // Sanitise: escape literal LF/CR/TAB inside strings
  var out = '', inStr = false, i = 0;
  while (i < s.length) {
    var code = s.charCodeAt(i);
    if (inStr) {
      if (code === 92) { out += s[i]; i++; if(i<s.length){out+=s[i];i++;} continue; }
      if (code === 34) { inStr = false; out += s[i]; }
      else if (code === 10) { out += String.fromCharCode(92) + 'n'; }
      else if (code === 13) { out += String.fromCharCode(92) + 'r'; }
      else if (code === 9)  { out += String.fromCharCode(92) + 't'; }
      else { out += s[i]; }
    } else {
      if (code === 34) inStr = true;
      out += s[i];
    }
    i++;
  }
  try { return JSON.parse(out); } catch(e2) {}
  if (inStr) out += String.fromCharCode(34);
  var depth = 0;
  for (var ci=0; ci<out.length; ci++) {
    if (out[ci] === '{') depth++;
    else if (out[ci] === '}') depth--;
  }
  while (depth > 0) { out += '}'; depth--; }
  return JSON.parse(out);
}

/* Parse a markdown-section format response — bulletproof, no JSON escaping needed.
   Format expected:
     ## SECTION_NAME
     content here
     can span lines
     ## NEXT_SECTION
     ...
   Returns: { section_name: "content", ... } with keys lowercased. */
export function parseSections(raw) {
  var lines = String(raw).split(String.fromCharCode(10));
  var out = {};
  var current = null;
  var buf = [];
  function commit() {
    if (current !== null) {
      out[current] = buf.join(String.fromCharCode(10)).trim();
    }
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(/^##+\s+([A-Z0-9_]+)\s*$/);
    if (m) {
      commit();
      current = m[1].toLowerCase();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  commit();
  return out;
}

/* Parse a bullet list ("- item" or "* item" lines) into an array */
export function parseBullets(text) {
  if (!text) return [];
  return String(text).split(String.fromCharCode(10))
    .map(function(l){ return l.replace(/^\s*[-*]\s+/, '').trim(); })
    .filter(function(l){ return l.length > 0 && !l.startsWith('##'); });
}

/* Parse "TERM | reason" lines into objects */
export function parseTermReasons(text) {
  if (!text) return [];
  return parseBullets(text).map(function(line){
    var parts = line.split('|');
    return { term: (parts[0]||'').trim(), reason: (parts.slice(1).join('|')||'').trim() };
  }).filter(function(o){ return o.term; });
}

/* Parse PICO/Design concept blocks: "P | clause" or "I | clause" etc */
export function parseConceptBlocks(text) {
  if (!text) return [];
  var out = [];
  var labelMap = { P: "Population", I: "Intervention", C: "Comparator", O: "Outcome", D: "Study Design" };
  var colorMap = { P: "#38bdf8", I: "#34d399", C: "#fbbf24", O: "#c084fc", D: "#f87171" };
  String(text).split(String.fromCharCode(10)).forEach(function(line){
    var trimmed = line.replace(/^\s*[-*]\s*/, '').trim();
    if (!trimmed) return;
    var parts = trimmed.split('|');
    if (parts.length < 2) return;
    var code = parts[0].trim().toUpperCase().charAt(0);
    if (!labelMap[code]) return;
    out.push({
      code: code,
      label: labelMap[code],
      color: colorMap[code],
      clause: parts.slice(1).join('|').trim()
    });
  });
  return out;
}

/* Parse filter lines: "FILTER_NAME | clause | when to apply" */
export function parseFilters(text) {
  if (!text) return [];
  return parseBullets(text).map(function(line){
    var parts = line.split('|');
    return {
      name: (parts[0]||'').trim(),
      clause: (parts[1]||'').trim(),
      when: (parts[2]||'').trim()
    };
  }).filter(function(o){ return o.name && o.clause; });
}
