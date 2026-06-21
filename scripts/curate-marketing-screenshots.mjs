/**
 * curate-marketing-screenshots.mjs — the "marketing agent" that CHOOSES which
 * screenshots to use. It sends the captured candidates to Claude (vision) with a
 * marketing rubric; Claude scores each shot, writes a caption + alt text, flags
 * unusable ones (empty state, blur, clipped popover, visible PII/email/secret),
 * and recommends a retake. The script writes:
 *
 *   marketing/screenshots/<date>/manifest.json   — full per-shot verdicts
 *   marketing/screenshots/<date>/SELECTION.md     — ranked picks + captions + retakes
 *
 * Run AFTER capture:   npm run marketing:curate
 * Requires ANTHROPIC_API_KEY (no-ops with a clear message if unset). No SDK
 * dependency — calls the Messages API over fetch. Model defaults to claude-opus-4-8
 * (override with MARKETING_CURATOR_MODEL).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.MARKETING_CURATOR_MODEL || 'claude-opus-4-8';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const log = (...a) => console.log('[curate]', ...a);

function latestShotDir(explicit) {
  if (explicit) return path.resolve(explicit);
  const base = path.join(ROOT, 'marketing', 'screenshots');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter((d) => fs.statSync(path.join(base, d)).isDirectory()).sort();
  return dirs.length ? path.join(base, dirs[dirs.length - 1]) : null;
}

const SYSTEM = `You are a senior product-marketing art director reviewing screenshots of "PecanRev" — an institution-grade systematic review & meta-analysis platform — for a landing page and sales deck. For EACH screenshot decide if it is marketing-usable and how strong it is.

Return ONLY a JSON array (no prose, no code fences). One object per screenshot, in the order given:
[{
  "file": "<filename>",
  "usable": true|false,
  "score": 0-100,                 // marketing impact: clarity, populated/realistic data, polish, "serious platform" feel
  "issues": ["empty state","blurry","clipped popover","visible email/PII","secret/token/IP","debug UI","other"],
  "caption": "<one-line marketing caption>",
  "alt": "<concise accessibility alt text>",
  "retake": true|false,
  "retake_reason": "<short, only if retake>"
}]
Rules: mark usable=false for empty/placeholder states, blur, clipped dropdowns, or anything showing a real email, IP, token, password, or debug label. Reward populated, realistic, clean views. Be decisive.`;

async function reviewBatch(files, dir) {
  const content = [];
  for (const f of files) {
    const data = fs.readFileSync(path.join(dir, f)).toString('base64');
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
    content.push({ type: 'text', text: `Screenshot file: ${f}` });
  }
  content.push({ type: 'text', text: 'Review the screenshots above. Return ONLY the JSON array described in the system prompt.' });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system: SYSTEM, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const body = await r.json();
  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const m = text.match(/\[[\s\S]*\]/); // extract the JSON array defensively
  if (!m) throw new Error('no JSON array in model response');
  return JSON.parse(m[0]);
}

async function main() {
  const dir = latestShotDir(process.argv[2]);
  if (!dir || !fs.existsSync(dir)) { log('no screenshots folder found — run "npm run marketing:screenshots" first.'); return; }
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  if (!files.length) { log('no PNGs in', dir); return; }
  if (!API_KEY) {
    log('ANTHROPIC_API_KEY not set — skipping AI curation.');
    log(`Found ${files.length} screenshots in ${path.relative(ROOT, dir)}; set ANTHROPIC_API_KEY and re-run to auto-select the best.`);
    return;
  }

  log(`reviewing ${files.length} screenshots with ${MODEL}…`);
  const verdicts = [];
  for (let i = 0; i < files.length; i += 4) {
    const batch = files.slice(i, i + 4);
    try { verdicts.push(...await reviewBatch(batch, dir)); log(`  reviewed ${Math.min(i + 4, files.length)}/${files.length}`); }
    catch (e) { log('  batch failed:', e.message); for (const f of batch) verdicts.push({ file: f, usable: null, score: 0, issues: ['review-failed'], caption: '', alt: '', retake: true, retake_reason: e.message }); }
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ model: MODEL, dir: path.relative(ROOT, dir), verdicts }, null, 2));

  const ranked = [...verdicts].sort((a, b) => (b.score || 0) - (a.score || 0));
  const picks = ranked.filter((v) => v.usable && !v.retake);
  const retakes = verdicts.filter((v) => v.retake || v.usable === false);
  const md = [
    `# Marketing screenshot selection (${path.basename(dir)})`,
    `Curated by ${MODEL}. ${picks.length}/${files.length} usable; ${retakes.length} flagged for retake.`,
    '',
    '## Recommended (ranked)',
    ...picks.map((v) => `- **${v.score}** \`${v.file}\` — ${v.caption}`),
    '',
    '## Flagged for retake / not usable',
    ...(retakes.length ? retakes.map((v) => `- \`${v.file}\` — ${(v.issues || []).join(', ') || 'n/a'}${v.retake_reason ? ` (${v.retake_reason})` : ''}`) : ['- none 🎉']),
    '',
    '## Alt text (for accessibility / SEO)',
    ...picks.map((v) => `- \`${v.file}\`: ${v.alt}`),
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'SELECTION.md'), md + '\n');

  log(`done → ${path.relative(ROOT, dir)}/manifest.json + SELECTION.md`);
  log(`top picks: ${picks.slice(0, 5).map((v) => v.file).join(', ') || '(none)'}`);
}

main().catch((e) => { console.error('[curate] FAILED:', e.message); process.exit(1); });
