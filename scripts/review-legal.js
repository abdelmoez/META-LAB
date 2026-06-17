#!/usr/bin/env node
/**
 * review-legal.js (prompt31 Part 2) — developer/product safety check, NOT legal
 * advice. Inspects changed files (git diff) and flags whether the Terms of
 * Service / Privacy Policy (src/frontend/pages/Terms.jsx) likely need a review.
 *
 *   node scripts/review-legal.js            # diff vs origin/main (fallback HEAD~1)
 *   node scripts/review-legal.js --base HEAD~3
 *   node scripts/review-legal.js fileA.js fileB.js   # explicit file list
 *   node scripts/review-legal.js --ci       # exit 0 always (warning-only)
 *
 * Writes docs/legal-review-report.md. This is a heuristic prompt to a human; it
 * never rewrites legal copy and never claims to replace attorney review.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TERMS_FILE = 'src/frontend/pages/Terms.jsx';

// Area → { match (path/keyword regexes), why, sections of Terms/Privacy to revisit }
const AREAS = [
  { id: 'auth/registration', re: /auth|register|login|password|reset|verif/i, sections: ['User accounts', 'Eligibility', 'Information collected at registration', 'Email notifications & verification'] },
  { id: 'onboarding/profile', re: /onboard|profile|institution/i, sections: ['Optional profile / onboarding data'] },
  { id: 'email', re: /email|smtp|mailer|notification/i, sections: ['Email notifications & verification', 'How information is used'] },
  { id: 'analytics', re: /analytic|usage|metrics|growth|presence/i, sections: ['Usage, analytics, cookies & local storage'] },
  { id: 'country/IP', re: /\bgeo\b|country|ip-|ipCountry|trust proxy|x-forwarded/i, sections: ['Information collected at registration', 'Security practices', 'International users'] },
  { id: 'uploads/PDF', re: /pdf|upload|attachment|storage/i, sections: ['Uploaded files, PDFs, and content'] },
  { id: 'open-access retrieval', re: /\boa\b|open-?access|unpaywall|openalex|crossref|resolver/i, sections: ['Open-access retrieval — publisher terms', 'Uploaded files & PDFs'] },
  { id: 'sharing/collaboration', re: /member|invite|share|collaborat|presence|realtime/i, sections: ['Collaboration, membership, permissions & roles', 'How information is shared & visibility'] },
  { id: 'permissions/roles', re: /permission|role|preset|canAssess|access/i, sections: ['Permissions and roles', 'Collaboration, membership, permissions & roles'] },
  { id: 'chat/messages', re: /chat|message/i, sections: ['User-generated content', 'How information is shared & visibility'] },
  { id: 'exports/reports', re: /export|report|prisma|manuscript/i, sections: ['Research/project content', 'How we use information'] },
  { id: 'ops/admin', re: /admin|adminController|ops|siteSetting|featureFlag/i, sections: ['Admin/Ops access', 'How information is shared & visibility'] },
  { id: 'data retention/deletion', re: /delete|retention|deletedAt|softDelete|archive/i, sections: ['Data retention'] },
  { id: 'audit logs', re: /audit|auditLog/i, sections: ['Admin/Ops access', 'Data retention'] },
  { id: 'AI/future', re: /\bai\b|openai|anthropic|llm|prompt|gemini/i, sections: ['Beta/experimental features', 'Research-integrity disclaimer'] },
];

function changedFiles() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (args.length) return args;
  const baseIdx = process.argv.indexOf('--base');
  let base = baseIdx >= 0 ? process.argv[baseIdx + 1] : null;
  const candidates = base ? [base] : ['origin/main', 'main', 'HEAD~1'];
  for (const b of candidates) {
    try {
      const out = execSync(`git diff --name-only ${b}...HEAD`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const staged = execSync('git diff --name-only --cached', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const unstaged = execSync('git diff --name-only', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const files = [...new Set((out + staged + unstaged).split('\n').map(s => s.trim()).filter(Boolean))];
      if (files.length) return files;
    } catch { /* try next base */ }
  }
  return [];
}

function main() {
  const files = changedFiles().filter(f => !f.startsWith('docs/legal-review'));
  const hits = new Map(); // areaId -> Set(files)
  for (const f of files) {
    for (const a of AREAS) {
      if (a.re.test(f)) { (hits.get(a.id) || hits.set(a.id, new Set()).get(a.id)).add(f); }
    }
  }
  const affected = AREAS.filter(a => hits.has(a.id));
  const termsExists = existsSync(resolve(ROOT, TERMS_FILE));
  const termsTxt = termsExists ? readFileSync(resolve(ROOT, TERMS_FILE), 'utf8') : '';

  const lines = [];
  lines.push('# Legal review report (developer safety check — NOT legal advice)');
  lines.push('');
  lines.push('> This is a heuristic prompt for a human reviewer. It does not constitute legal');
  lines.push('> advice and does not replace review by a qualified attorney.');
  lines.push('');
  lines.push(`Changed files inspected: **${files.length}**`);
  lines.push('');
  if (!affected.length) {
    lines.push('## ✅ No legal-copy update likely needed');
    lines.push('');
    lines.push('No changed files matched data/privacy-sensitive areas. Still review if you');
    lines.push('know a change affects how user data is collected, shared, or retained.');
  } else {
    lines.push('## ⚠️ Legal copy review RECOMMENDED');
    lines.push('');
    lines.push('Changed files touch areas that may affect the Terms of Service / Privacy Policy.');
    lines.push('');
    lines.push('| Area | Changed files | Terms/Privacy sections to revisit |');
    lines.push('| --- | --- | --- |');
    for (const a of affected) {
      const fs = [...hits.get(a.id)].slice(0, 6).join('<br>');
      const secs = a.sections.map(s => `${termsTxt.includes(s) ? '✓' : '⚠ missing?'} ${s}`).join('<br>');
      lines.push(`| ${a.id} | ${fs} | ${secs} |`);
    }
    lines.push('');
    lines.push('### Suggested next steps');
    lines.push(`- Open \`${TERMS_FILE}\` and confirm each listed section still matches behaviour.`);
    lines.push('- A "⚠ missing?" marker means the section heading was not found verbatim — add or rename it.');
    lines.push('- Keep wording original, app-specific, and avoid overstating legal certainty.');
  }
  lines.push('');
  lines.push(`_Generated by \`npm run review:legal\` on ${process.env.LEGAL_REVIEW_DATE || '(date omitted)'}._`);

  const report = lines.join('\n') + '\n';
  writeFileSync(resolve(ROOT, 'docs/legal-review-report.md'), report);

  // Console summary
  console.log(affected.length
    ? `⚠️  Legal review recommended — ${affected.length} area(s): ${affected.map(a => a.id).join(', ')}`
    : '✅ No legal-copy update likely needed.');
  console.log(`   Report: docs/legal-review-report.md (${files.length} changed files inspected)`);

  // Warning-only by default; --strict makes it fail when areas are affected.
  if (process.argv.includes('--strict') && affected.length) process.exit(2);
}

main();
