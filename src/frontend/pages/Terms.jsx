/**
 * Terms.jsx — META·LAB / META·SIFT Terms of Service + Privacy Policy
 * (prompt29 Part 11). Public page at /terms (anchors #terms and #privacy). The
 * registration agreement links here.
 *
 * This is an original, app-specific STRONG PLACEHOLDER written from the platform's
 * actual scope. It is NOT a substitute for formal legal review (see the disclaimer
 * banner). No competitor text was copied.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';

const UPDATED = 'June 16, 2026';

export default function Terms() {
  // Honour the #terms / #privacy anchor on load (router doesn't auto-scroll).
  useEffect(() => {
    const id = (window.location.hash || '').replace('#', '');
    if (id) { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' }); }
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.txt, fontFamily: FONT }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderBottom: `1px solid ${C.brd}`, background: C.card }}>
        <Link to="/" style={{ ...ghost, textDecoration: 'none' }}>← Home</Link>
        <span style={{ fontWeight: 800, fontSize: 16 }}>Terms &amp; Privacy</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>Updated {UPDATED}</span>
      </header>

      <main style={{ maxWidth: 820, margin: '0 auto', padding: '28px 22px 80px', lineHeight: 1.65, fontSize: 14.5, color: C.txt2 }}>
        {/* Disclaimer */}
        <div style={{ padding: '12px 15px', background: alpha(C.acc, '10'), border: `1px solid ${alpha(C.acc, '34')}`, borderRadius: 10, fontSize: 13, marginBottom: 24 }}>
          <strong style={{ color: C.txt }}>Plain-language summary &amp; notice.</strong> This page explains, in plain English, how
          META·LAB and META·SIFT (“the Platform”) may be used and how your data is handled. It is provided as a clear,
          good-faith placeholder and is <strong>not a substitute for formal legal review</strong>. The operator may publish a
          legally reviewed version; where that version differs, it governs.
        </div>

        {/* Table of contents */}
        <nav aria-label="Contents" style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 28, fontSize: 13 }}>
          <a href="#terms" style={tocLink}>1. Terms of Service</a>
          <a href="#privacy" style={tocLink}>2. Privacy Policy</a>
          <a href="#contact" style={tocLink}>3. Contact</a>
        </nav>

        {/* ── TERMS ─────────────────────────────────────────────────────────── */}
        <Section id="terms" title="1. Terms of Service">
          <H>Acceptance of terms</H>
          <P>By creating an account or using the Platform, you agree to these terms. If you do not agree, do not use the Platform.</P>

          <H>Description of service</H>
          <P>The Platform is a collaborative toolkit for planning, screening, extracting, and analysing evidence for systematic reviews and meta-analyses — including PICO/protocol tools, citation screening (META·SIFT), data extraction, risk-of-bias assessment, statistical synthesis, PRISMA support, and exports. Some features are experimental (see “Beta features”).</P>

          <H>Eligibility &amp; accounts</H>
          <P>You must be able to form a binding agreement to use the Platform and provide accurate registration details (name, email, password). You are responsible for keeping your credentials secure and for activity under your account. Tell the operator promptly about any unauthorised use.</P>

          <H>User responsibilities &amp; proper use</H>
          <P>You agree to use the Platform lawfully and for legitimate research, education, or evidence-synthesis purposes. You will not attempt to disrupt, reverse-engineer, overload, or gain unauthorised access to the Platform or other users’ data.</P>

          <H>Research &amp; project content</H>
          <P>You retain ownership of the research data, project content, criteria, screening decisions, extracted data, and analyses you create. You are responsible for the accuracy and lawfulness of what you upload, and for holding any rights needed to use it on the Platform.</P>

          <H>Uploaded files &amp; PDFs</H>
          <P>You may upload manuscripts and PDFs to support screening and assessment. Only upload files you are permitted to store and use. Do not upload malicious files or content that infringes others’ rights.</P>

          <H>Open-access retrieval — publisher terms</H>
          <P>The Platform can help locate <em>legitimately open-access</em> full-text PDFs. You agree to respect publisher terms and copyright. The Platform does not, and you must not use it to, bypass paywalls, access controls, or publisher restrictions. Where automated retrieval is not possible, attach the PDF you are licensed to use manually.</P>

          <H>Collaboration, membership, permissions &amp; roles</H>
          <P>Projects may be shared with collaborators under roles (e.g. owner, leader, reviewer, viewer) that determine what each member can see and change. Owners and leaders are responsible for whom they invite and what they grant. Treat other members’ contributions and any shared content responsibly.</P>

          <H>User-generated content &amp; intellectual property</H>
          <P>You grant the operator a limited licence to host, process, display, and back up your content solely to provide and improve the Platform for you and your collaborators. The Platform’s own software, design, and trademarks remain the property of the operator and its licensors.</P>

          <H>Prohibited conduct</H>
          <P>Do not: misuse open-access retrieval; upload unlawful, infringing, or harmful content; attempt to access data you are not authorised to; scrape or abuse the service; or impersonate others.</P>

          <H>Research-integrity disclaimer</H>
          <P>The Platform supports your methodology; it does not replace your expert judgement. <strong>Statistical outputs, automated suggestions, risk-of-bias proposals, and any generated text require your review and verification.</strong> The operator makes no guarantee of correctness, completeness, fitness for a particular review, or of publication. You are responsible for validating results before relying on or publishing them.</P>

          <H>Service availability &amp; beta features</H>
          <P>The Platform is provided “as is” and “as available”. Features may change, and some are clearly marked beta/experimental and may behave unexpectedly or be withdrawn. Maintenance and outages may occur.</P>

          <H>Account termination</H>
          <P>You may stop using the Platform at any time. The operator may suspend or terminate accounts that violate these terms or pose a security or legal risk, with reasonable notice where practical.</P>

          <H>Limitation of liability</H>
          <P>To the maximum extent permitted by law, the operator is not liable for indirect, incidental, or consequential damages, or for loss of data, profits, or research outcomes arising from your use of the Platform. Keep your own backups of critical data.</P>

          <H>Changes to these terms</H>
          <P>These terms may be updated. Material changes will be reflected by the “Updated” date above and, where appropriate, by notice in-app or by email. Continued use after changes means you accept them.</P>
        </Section>

        {/* ── PRIVACY ───────────────────────────────────────────────────────── */}
        <Section id="privacy" title="2. Privacy Policy">
          <H>Information collected at registration</H>
          <P>To create an account we collect your name, email address, and a hashed password. Passwords are stored only as a secure hash — never in plain text.</P>

          <H>Optional profile / onboarding data</H>
          <P>You may optionally provide profile and onboarding details (e.g. role, institution, areas of interest). Onboarding is skippable and these fields are not required to use the Platform.</P>

          <H>Project &amp; research data</H>
          <P>We store the project content you create: PICO/protocol, eligibility criteria, imported citations, screening decisions, extracted data, risk-of-bias assessments, analysis configurations and outputs, and related notes.</P>

          <H>Uploaded files, PDFs, and content</H>
          <P>Files and PDFs you upload are stored to provide preview, screening, and assessment. Open-access retrieval records the source/provenance of any file it attaches.</P>

          <H>Usage, analytics, cookies &amp; local storage</H>
          <P>We collect limited operational and usage data (e.g. sign-in events, feature usage, presence/online status, error diagnostics) to run, secure, and improve the Platform. We use a session cookie to keep you signed in, and browser local storage for preferences (such as keyboard shortcuts and which side panels you collapse). We do not sell your personal data.</P>

          <H>How we use information</H>
          <P>To provide and secure the service, enable collaboration, remember your preferences, send necessary account and verification emails, diagnose problems, and improve features. We process your data to deliver the Platform to you and your project members.</P>

          <H>How information is shared &amp; visibility</H>
          <P>Project content is visible to the members you collaborate with, according to their roles. Under blind review, reviewer identities may be hidden from other reviewers. Authorised operator/administrative staff may access data as needed to operate, support, secure, and maintain the Platform. We may share data with service providers who process it on our behalf, or where required by law.</P>

          <H>Email notifications &amp; verification</H>
          <P>We may send transactional emails (verification, password reset, invitations, and important notices). If email verification is enabled by an administrator, you may be asked to verify your address after registration.</P>

          <H>Data retention</H>
          <P>We retain account and project data while your account is active and as needed to provide the service. Some records use soft deletion so collaborators are not disrupted and audit history is preserved; deleted content may persist in backups for a limited period before removal.</P>

          <H>Security practices</H>
          <P>We use reasonable technical and organisational measures — including hashed passwords, authenticated access, and access controls scoped to project ownership/membership. No system is perfectly secure; please use a strong, unique password.</P>

          <H>Your choices</H>
          <P>You can review and update your profile, skip optional onboarding, and manage preferences. To access, correct, export, or delete your data beyond in-app controls, contact us (below).</P>

          <H>International users</H>
          <P>The Platform may be used internationally and your data may be processed in the country where the service is operated. By using the Platform you consent to such processing, subject to applicable law.</P>

          <H>Children / minors</H>
          <P>The Platform is intended for researchers and professionals and is not directed to children. Do not register if you are below the age of digital consent in your jurisdiction.</P>

          <H>Changes to this policy</H>
          <P>We may update this policy; the “Updated” date above reflects the latest version, with notice for material changes where appropriate.</P>
        </Section>

        <Section id="contact" title="3. Contact">
          <P>Questions about these terms or your data? Contact the platform operator at <strong style={{ color: C.txt }}>[contact email placeholder]</strong>. We will route requests to the appropriate team.</P>
          <P style={{ marginTop: 18 }}><Link to="/register" style={{ color: C.acc, fontWeight: 600 }}>← Back to registration</Link></P>
        </Section>
      </main>
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} style={{ scrollMarginTop: 72, marginBottom: 36 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.txt, margin: '0 0 14px', paddingBottom: 8, borderBottom: `1px solid ${C.brd}` }}>{title}</h2>
      {children}
    </section>
  );
}
function H({ children }) { return <h3 style={{ fontSize: 15.5, fontWeight: 700, color: C.txt, margin: '18px 0 5px' }}>{children}</h3>; }
function P({ children, style }) { return <p style={{ margin: '0 0 4px', ...style }}>{children}</p>; }

const ghost = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt2, fontSize: 13, cursor: 'pointer', fontFamily: FONT };
const tocLink = { color: C.acc, fontWeight: 600, textDecoration: 'none' };
