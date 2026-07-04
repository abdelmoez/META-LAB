/* aiExtractService.js — client for the OPTIONAL server-proxied LLM extraction
   path (/api/ai-extract). This REPLACES the old direct browser call to
   api.anthropic.com (which had no x-api-key/anthropic-version headers and was
   blocked by the strict CSP connect-src 'self' anyway) — the browser only ever
   talks to its own origin; the Anthropic key never leaves the server.
   Available ONLY when the admin flips the `aiExtraction` flag AND the server
   env is configured — probe with aiExtractStatus() before showing any UI. */

/**
 * aiExtractStatus() → Promise<{available:boolean, model?:string}>
 * Fail-closed: any error (network, 4xx/5xx, bad JSON) reads as unavailable.
 */
export async function aiExtractStatus() {
  try {
    const res = await fetch("/api/ai-extract/status", { credentials: "include" });
    if (!res.ok) return { available: false };
    const data = await res.json();
    if (data && data.available === true) {
      return data.model ? { available: true, model: String(data.model) } : { available: true };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

/**
 * aiExtract({pdfBase64, text, focus}) → Promise<{fields, patch, conversions, warnings}>
 * POSTs the document to the server proxy (ONE real model call, server-side).
 * Throws an Error carrying the server's honest message plus `.status`.
 */
export async function aiExtract({ pdfBase64, text, focus } = {}) {
  const body = {};
  if (pdfBase64) body.pdfBase64 = pdfBase64;
  if (text) body.text = text;
  if (focus) body.focus = focus;

  const res = await fetch("/api/ai-extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error body — handled below */ }

  if (!res.ok) {
    const err = new Error((data && data.error) || `AI extraction failed (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return {
    fields: (data && data.fields) || {},
    patch: (data && data.patch) || {},
    conversions: (data && data.conversions) || [],
    warnings: (data && data.warnings) || [],
  };
}
