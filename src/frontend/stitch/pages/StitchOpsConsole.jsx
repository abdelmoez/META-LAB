/**
 * StitchOpsConsole.jsx — the Stitch "Vivid Enterprise" Ops Console (route /ops).
 *
 * Parallel presentation of the legacy src/frontend/pages/admin/AdminConsole.jsx.
 * It reuses the SAME admin api client (adminApiClient.js — adminApi + fetchVersion)
 * and the SAME role model (useAuth().user.role + the server's GET /api/admin/console
 * capability descriptor), so there is NO forked business logic and NO new endpoint.
 *
 * The route is already guarded by <AdminRoute> (admin OR mod). This page does NOT
 * re-implement auth; it only reflects role:
 *   - admin → Overview (live platform metrics), System Health (DB/version/uptime),
 *             Feature Flags (real toggles persisted via PUT /api/admin/feature-flags).
 *   - mod   → admin-only endpoints (metrics/health/flags) return 403; those tabs
 *             render an honest "admin only" info state. Mods keep access to the
 *             Users + Messages sections in the legacy console (linked, not faked here).
 *
 * Sections that the legacy console owns but are out of scope for THIS page
 * (Users, Projects, Messages, Waitlist, Appearance, AI policy, deep analytics) are
 * surfaced as honest section cards that deep-link to the full legacy console — no
 * fabricated data, no dead controls.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { adminApi, fetchVersion } from '../../pages/admin/adminApiClient.js';
import StitchAppShell from '../shell/StitchAppShell.jsx';
import { StitchContextRail } from '../shell/shellParts.jsx';
import {
  StitchPageHeader, StitchSectionHeader, StitchCard, StitchPanel, StitchDivider,
  StitchMetricCard, StitchBadge, StitchStatusDot,
  StitchTabs, StitchTable, StitchSwitch, StitchButton, StitchTooltip, StitchIcon,
  StitchEmptyState, StitchErrorState, StitchLoadingState, StitchSpinner,
  useStitchToast, S, salpha,
} from '../primitives';

const MONO = "'IBM Plex Mono', ui-monospace, monospace";

/* ── Feature-flag catalogue — mirrors AdminConsole.jsx FLAG_META verbatim so the
 * label/description copy stays consistent across both presentation layers. The
 * server merges defaultFeatureFlags() under the stored row, so every known flag is
 * always present in the GET response; this list controls ORDER + human copy. ──── */
const FLAG_META = [
  { key: 'autosave',             label: 'Autosave',              desc: 'Automatically save project changes as the user types.' },
  { key: 'contactForm',          label: 'Contact Form',          desc: 'Show the public contact form on the landing page.' },
  { key: 'projectDuplication',   label: 'Project Duplication',   desc: 'Allow users to clone existing projects.' },
  { key: 'advancedMetaAnalysis', label: 'Advanced Meta-Analysis', desc: "Enable trim-and-fill, Egger's test, and influence diagnostics." },
  { key: 'exportTools',          label: 'Export Tools',          desc: 'Allow project and data exports in various formats.' },
  { key: 'rob_engine_v2',        label: 'Risk of Bias (RoB 2)',  desc: 'Enable the PecanRev RoB 2 assessment workspace (beta). Off by default until validated.' },
  { key: 'serverBackedWorkflowState', label: 'Server-Backed Workflow State', desc: 'Persist migrated workflow modules (Protocol, Search Builder) server-side with revision-based conflict detection. Off keeps the legacy whole-project autosave.' },
  { key: 'searchEngine',         label: 'Search Builder Engine', desc: 'Enable the new concept→multi-database Search Builder (MeSH lookup + live PubMed counts via the NLM proxy). Off keeps the legacy in-app search builder.' },
  { key: 'aiScreening',          label: 'AI Screening Engine',   desc: 'Enable the PecanRev Screening Intelligence Engine: deterministic TF-IDF + active-learning relevance scoring, ranking, explanations, and validation metrics inside the screening workbench. Assistive only — human decisions are never automated. Off by default until validated. Configure global policy in Screening → AI Policy.' },
  { key: 'betaWaitlist',         label: 'Beta Waitlist Landing Page', desc: 'When ON, unauthenticated visitors to the homepage ( / ) see the Beta Waitlist sign-up page instead of the standard landing page. Signed-in users and the login/register pages are unaffected. The existing landing page is preserved and returns when this is OFF. Manage applicants in the Beta Waitlist tab. Preview at /beta-waitlist.' },
];

/* ── Formatting helpers (local, presentational) ─────────────────────────────── */
const nf = new Intl.NumberFormat();
const fmtNum = (n) => (typeof n === 'number' && Number.isFinite(n) ? nf.format(n) : '—');

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtUptime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

/* A small uniform error → either "403 admin only" info state or a real error. */
function isForbidden(err) { return err && (err.status === 403 || err.status === 401); }

/* ────────────────────────────────────────────────────────────────────────────
 * Overview tab — live platform metrics (GET /api/admin/metrics, admin only).
 * ─────────────────────────────────────────────────────────────────────────── */
function OverviewTab({ isAdmin }) {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    adminApi.metrics()
      .then((d) => setMetrics(d))
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (isAdmin) load(); else setLoading(false); }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <StitchEmptyState
        icon="lock" title="Platform metrics are admin-only"
        desc="Your role can manage users and contact messages. Open the full Ops console to access the sections available to you."
        action={<StitchButton variant="soft" icon="externalLink" onClick={() => navigate('/ops?ui=legacy')}>Open full Ops console</StitchButton>}
      />
    );
  }
  if (loading) return <StitchLoadingState label="Loading platform metrics…" />;
  if (error) {
    if (isForbidden(error)) {
      return <StitchEmptyState icon="lock" title="Admin access required" desc="Platform metrics require an admin role." />;
    }
    return <StitchErrorState title="Could not load metrics" desc={error.message} onRetry={load} />;
  }

  const m = metrics || {};
  const users = m.users || {};
  const projects = m.projects || {};
  const messages = m.contactMessages || {};
  const active = m.activeUsers || {};
  const logins = m.logins || {};
  const online = typeof users.online === 'number' ? users.online : 0;
  const onlinePct = users.total ? Math.round((online / users.total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <StitchSectionHeader title="Platform at a glance" desc="Live counts across the PecanRev platform." />
        <StitchButton variant="ghost" size="sm" icon="refresh" onClick={load}>Refresh</StitchButton>
      </div>

      {/* Headline metric grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        <StitchMetricCard
          label="Total users" value={fmtNum(users.total)} icon="users" tone="brand"
          delta={users.thisMonth ? `+${fmtNum(users.thisMonth)} this month` : undefined} deltaTone="success"
          onClick={() => navigate('/ops?ui=legacy')}
        />
        <StitchMetricCard label="Online now" value={fmtNum(online)} icon="circleCheck" tone="success"
          delta={`${onlinePct}% of users`} deltaTone="success" />
        <StitchMetricCard label="Projects" value={fmtNum(projects.total)} icon="folder" tone="neutral"
          delta={projects.thisMonth ? `+${fmtNum(projects.thisMonth)} this month` : undefined} deltaTone="success" />
        <StitchMetricCard label="Studies" value={fmtNum(m.studies)} icon="fileText" tone="neutral" />
        <StitchMetricCard label="Records" value={fmtNum(m.records)} icon="table" tone="neutral" />
        <StitchMetricCard
          label="Unread messages" value={fmtNum(messages.unread)} icon="mail"
          tone={messages.unread ? 'warn' : 'neutral'}
          onClick={() => navigate('/ops?ui=legacy')}
        />
        <StitchMetricCard
          label="Suspended users" value={fmtNum(users.suspended)} icon="lock"
          tone={users.suspended ? 'danger' : 'neutral'}
        />
        <StitchMetricCard
          label="Failed logins (7d)" value={fmtNum(m.securityEvents?.failedLogins7d)} icon="shield"
          tone={m.securityEvents?.failedLogins7d ? 'warn' : 'neutral'}
        />
      </div>

      {/* New-account funnel */}
      <StitchCard pad>
        <StitchSectionHeader title="New accounts" desc="Registrations by rolling window." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 14 }}>
          <WindowStat label="Today" value={users.today} />
          <WindowStat label="This week" value={users.thisWeek} />
          <WindowStat label="This month" value={users.thisMonth} />
          <WindowStat label="Admins" value={users.admins} icon="shieldCheck" />
        </div>
      </StitchCard>

      {/* Engagement: active users + unique logins by window */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <StitchCard pad>
          <StitchSectionHeader title="Active users" desc="Distinct users seen per rolling window." />
          <WindowRows
            rows={[
              ['24 hours', active.day], ['7 days', active.week], ['30 days', active.month],
              ['90 days', active.quarter], ['365 days', active.year],
            ]}
          />
        </StitchCard>
        <StitchCard pad>
          <StitchSectionHeader title="Unique logins" desc="Distinct successful sign-ins per rolling window." />
          <WindowRows
            rows={[
              ['24 hours', logins.day], ['7 days', logins.week], ['30 days', logins.month],
              ['90 days', logins.quarter], ['365 days', logins.year],
            ]}
          />
        </StitchCard>
      </div>

      {/* Email + linking honest summaries (real, additive metric keys) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <StitchCard pad>
          <StitchSectionHeader title="Email system" desc="Outbound email delivery." />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
            <StitchStatusDot status={m.email?.configured ? 'online' : 'offline'} title={m.email?.configured ? 'Configured' : 'Not configured'} />
            <span style={{ fontSize: 13, color: S.textPrimary, fontWeight: 600 }}>
              {m.email?.configured ? 'Configured' : 'Not configured'}
            </span>
            {m.email?.provider ? <StitchBadge tone="info">{m.email.provider}</StitchBadge> : null}
          </div>
          <WindowRows
            rows={[
              ['Sent', m.emailStats?.sent], ['Failed', m.emailStats?.failed],
              ['Invites sent', m.emailStats?.invites?.sent], ['Password resets', m.emailStats?.passwordResets?.sent],
            ]}
          />
          <div style={{ fontSize: 11, color: S.textMuted, marginTop: 8 }}>
            Last sent {fmtDate(m.emailStats?.lastSentAt)}
          </div>
        </StitchCard>
        <StitchCard pad>
          <StitchSectionHeader title="Workspace linking" desc="META·LAB ↔ Screening links." />
          <WindowRows
            rows={[
              ['Linked workspaces', m.linking?.linkedWorkspaces],
              ['Unlinked screening projects', m.linking?.unlinkedSiftProjects],
              ['Unlinked META·LAB projects', m.linking?.unlinkedMetaLabProjects],
              ['Pending invites', m.invites?.pending],
            ]}
          />
        </StitchCard>
      </div>
    </div>
  );
}

function WindowStat({ label, value, icon }) {
  return (
    <StitchPanel tone="low" style={{ padding: '14px 16px', borderRadius: S.radiusControl }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: S.textMuted }}>
        {icon ? <StitchIcon name={icon} size={13} /> : null}{label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: S.textPrimary, marginTop: 4, lineHeight: 1 }}>{fmtNum(value)}</div>
    </StitchPanel>
  );
}

function WindowRows({ rows }) {
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
      {rows.map(([label, value], i) => (
        <div key={label} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 0', borderBottom: i < rows.length - 1 ? `1px solid ${salpha(S.outlineVariant, 0.35)}` : 'none',
        }}>
          <span style={{ fontSize: 13, color: S.textSecondary }}>{label}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: S.textPrimary, fontFamily: MONO }}>{fmtNum(value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * System Health tab — GET /api/admin/health (admin only) + /api/version.
 * ─────────────────────────────────────────────────────────────────────────── */
function HealthTab({ isAdmin }) {
  const [health, setHealth] = useState(null);
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      adminApi.health(),
      fetchVersion(), // never throws; null on 404
    ])
      .then(([h, v]) => { setHealth(h); setVersion(v); })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (isAdmin) load(); else setLoading(false); }, [isAdmin, load]);

  if (!isAdmin) {
    return <StitchEmptyState icon="lock" title="System health is admin-only" desc="Health, version, and uptime are visible to admins only." />;
  }
  if (loading) return <StitchLoadingState label="Checking system health…" />;
  if (error) {
    if (isForbidden(error)) return <StitchEmptyState icon="lock" title="Admin access required" desc="System health requires an admin role." />;
    return <StitchErrorState title="Could not reach the server" desc={error.message} onRetry={load} />;
  }

  const h = health || {};
  const apiOk = h.status === 'ok';
  const dbOk = h.db === 'ok';
  const ver = version?.version || h.version;
  const commit = version?.commit || h.commit;
  const buildDate = version?.buildDate || h.buildDate;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <StitchSectionHeader title="System health" desc={`Checked ${fmtDate(h.timestamp)}`} />
        <StitchButton variant="ghost" size="sm" icon="refresh" onClick={load}>Re-check</StitchButton>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <StatusTile label="API server" ok={apiOk} okLabel="Operational" badLabel="Degraded" icon="globe" />
        <StatusTile label="Database" ok={dbOk} okLabel="Connected" badLabel="Unreachable" icon="layers" />
        <StitchCard pad>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: S.textMuted }}>Environment</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: S.textPrimary, marginTop: 6, textTransform: 'capitalize' }}>{h.env || '—'}</div>
          <StitchBadge tone={h.env === 'production' ? 'success' : 'warn'} dot style={{ marginTop: 8 }}>{h.env || 'unknown'}</StitchBadge>
        </StitchCard>
        <StitchCard pad>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: S.textMuted }}>Uptime</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: S.textPrimary, marginTop: 6, fontFamily: MONO }}>{fmtUptime(h.uptime)}</div>
          <div style={{ fontSize: 11, color: S.textMuted, marginTop: 8 }}>since last restart</div>
        </StitchCard>
      </div>

      <StitchCard pad>
        <StitchSectionHeader title="Build & version" desc="Currently deployed release of the PecanRev server." />
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
          <DetailRow label="Version" value={ver ? <span style={{ fontFamily: MONO }}>v{ver}</span> : <span style={{ color: S.textMuted }}>not reported</span>} />
          <DetailRow label="Commit" value={commit ? <span style={{ fontFamily: MONO }}>{String(commit).slice(0, 10)}</span> : <span style={{ color: S.textMuted }}>—</span>} />
          <DetailRow label="Build date" value={fmtDate(buildDate)} last />
        </div>
        {!version && (
          <div style={{ fontSize: 11, color: S.textMuted, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <StitchIcon name="info" size={13} /> /api/version is not wired in this build; values fall back to the health endpoint.
          </div>
        )}
      </StitchCard>
    </div>
  );
}

function StatusTile({ label, ok, okLabel, badLabel, icon }) {
  return (
    <StitchCard pad>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StitchIcon name={icon} size={16} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: S.textMuted }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 10 }}>
        <StitchStatusDot status={ok ? 'online' : 'danger'} size={11} ring title={ok ? okLabel : badLabel} />
        <span style={{ fontSize: 18, fontWeight: 800, color: ok ? S.success : S.danger }}>{ok ? okLabel : badLabel}</span>
      </div>
    </StitchCard>
  );
}

function DetailRow({ label, value, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      padding: '11px 0', borderBottom: last ? 'none' : `1px solid ${salpha(S.outlineVariant, 0.35)}`,
    }}>
      <span style={{ fontSize: 13, color: S.textSecondary }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: S.textPrimary }}>{value}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Feature Flags tab — GET/PUT /api/admin/feature-flags (admin only).
 * Mirrors AdminConsole.FlagsSection: load all flags, toggle locally, save the
 * whole object. Save is a single PUT (the server replaces the stored row).
 * ─────────────────────────────────────────────────────────────────────────── */
function FlagsTab({ isAdmin }) {
  const toast = useStitchToast();
  const [flags, setFlags] = useState(null);
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    adminApi.featureFlags.get()
      .then((d) => { const obj = d && typeof d === 'object' ? d : {}; setFlags(obj); setOriginal(obj); })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (isAdmin) load(); else setLoading(false); }, [isAdmin, load]);

  const dirty = useMemo(() => {
    if (!flags || !original) return false;
    return FLAG_META.some((f) => !!flags[f.key] !== !!original[f.key]);
  }, [flags, original]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const saved = await adminApi.featureFlags.save(flags);
      const obj = saved && typeof saved === 'object' ? saved : flags;
      setFlags(obj); setOriginal(obj);
      toast.toast('Feature flags saved', { tone: 'success' });
    } catch (e) {
      toast.toast(e.message || 'Could not save feature flags', { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }, [flags, toast]);

  if (!isAdmin) {
    return <StitchEmptyState icon="lock" title="Feature flags are admin-only" desc="Only admins can read or change platform feature flags." />;
  }
  if (loading) return <StitchLoadingState label="Loading feature flags…" />;
  if (error) {
    if (isForbidden(error)) return <StitchEmptyState icon="lock" title="Admin access required" desc="Feature flags require an admin role." />;
    return <StitchErrorState title="Could not load feature flags" desc={error.message} onRetry={load} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <StitchSectionHeader title="Feature flags" desc="Toggle platform capabilities. Changes apply after you save — no redeploy required." />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {dirty ? <StitchBadge tone="warn" dot>Unsaved changes</StitchBadge> : null}
          <StitchButton variant="primary" icon="checkSquare" onClick={save} loading={saving} disabled={!dirty}>
            Save changes
          </StitchButton>
        </div>
      </div>

      <StitchCard pad={false}>
        {FLAG_META.map((f, i) => {
          const on = !!(flags && flags[f.key]);
          return (
            <div key={f.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
              padding: '16px 20px',
              borderBottom: i < FLAG_META.length - 1 ? `1px solid ${salpha(S.outlineVariant, 0.35)}` : 'none',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: S.textPrimary }}>{f.label}</span>
                  <StitchBadge tone={on ? 'success' : 'neutral'} dot>{on ? 'On' : 'Off'}</StitchBadge>
                </div>
                <div style={{ fontSize: 12, color: S.textMuted, marginTop: 4, lineHeight: 1.5 }}>{f.desc}</div>
              </div>
              <StitchSwitch
                checked={on}
                onChange={(v) => setFlags((prev) => ({ ...prev, [f.key]: v }))}
                label={`Toggle ${f.label}`}
              />
            </div>
          );
        })}
      </StitchCard>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Other sections — honest links to the full legacy console (no faked data).
 * ─────────────────────────────────────────────────────────────────────────── */
const SECTION_LINKS = [
  { key: 'users',     label: 'Users',          icon: 'users',     desc: 'Directory, roles, status, password resets, and per-user activity.', adminOnly: false },
  { key: 'projects',  label: 'Projects',       icon: 'folder',    desc: 'Project lifecycle — archive, restore, and link inspection.',        adminOnly: true },
  { key: 'sift',      label: 'Screening',      icon: 'checkSquare', desc: 'Screening workspace health, progress, members, and audit.',        adminOnly: true },
  { key: 'rob',       label: 'Risk of Bias',   icon: 'scale',     desc: 'RoB engine settings and assessment metrics.',                       adminOnly: true },
  { key: 'waitlist',  label: 'Beta Waitlist',  icon: 'clipboard', desc: 'Applicant pipeline, statuses, notes, and CSV export.',              adminOnly: true },
  { key: 'messages',  label: 'Messages',       icon: 'mail',      desc: 'Contact inbox, replies, and staff-initiated email.',                adminOnly: false },
  { key: 'style',     label: 'Appearance',     icon: 'sliders',   desc: 'Global brand theme and landing-page content.',                       adminOnly: true },
  { key: 'security',  label: 'Security & audit', icon: 'shield',  desc: 'Audit log and security event monitoring.',                          adminOnly: true },
];

function MoreTab({ isAdmin }) {
  const navigate = useNavigate();
  const visible = SECTION_LINKS.filter((s) => isAdmin || !s.adminOnly);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StitchSectionHeader
        title="Full Ops console"
        desc="These sections are managed in the complete Ops console. Open one to work with its live data and controls."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {visible.map((s) => (
          <StitchCard key={s.key} pad interactive as="button" onClick={() => navigate('/ops?ui=legacy')}
            style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{
                width: 38, height: 38, borderRadius: S.radiusControl, display: 'grid', placeItems: 'center',
                background: S.brandSoft, color: S.onBrandSoft,
              }}>
                <StitchIcon name={s.icon} size={18} />
              </div>
              <StitchIcon name="arrowRight" size={16} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: S.textPrimary }}>{s.label}</div>
            <div style={{ fontSize: 12, color: S.textMuted, lineHeight: 1.5 }}>{s.desc}</div>
          </StitchCard>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Page shell
 * ─────────────────────────────────────────────────────────────────────────── */
export default function StitchOpsConsole() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role || 'user';
  const isAdmin = role === 'admin';

  // Capability descriptor from the server (source of truth for what this staff
  // member may see). Read-only; tabs still gate themselves on isAdmin so an
  // endpoint-level 403 is handled gracefully even if console() is unavailable.
  const [console_, setConsole] = useState(null);
  useEffect(() => { adminApi.console().then(setConsole).catch(() => {}); }, []);

  const [tab, setTab] = useState('overview');

  // Admins get the data-rich tabs; mods get the sections they can actually use.
  const tabs = useMemo(() => {
    const base = [
      { id: 'overview', label: 'Overview', icon: 'grid' },
      { id: 'health',   label: 'System Health', icon: 'shieldCheck' },
      { id: 'flags',    label: 'Feature Flags', icon: 'sliders', count: isAdmin ? FLAG_META.length : undefined },
      { id: 'more',     label: 'More', icon: 'folders' },
    ];
    return base;
  }, [isAdmin]);

  const emailConfigured = console_?.emailConfigured;

  const contextRail = (
    <StitchContextRail
      title="Ops Console"
      subtitle={isAdmin ? 'Full administrator access' : 'Moderator access'}
      footer={
        <StitchButton variant="ghost" size="sm" icon="externalLink" block onClick={() => navigate('/ops?ui=legacy')}>
          Open full console
        </StitchButton>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: S.textMuted }}>Signed in as</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <StitchBadge tone={isAdmin ? 'brand' : 'info'} icon="shield">{role}</StitchBadge>
          </div>
        </div>
        <StitchDivider />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: S.textMuted }}>Email delivery</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            {console_ == null ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.textMuted }}>
                <StitchSpinner size={12} /> checking…
              </span>
            ) : (
              <>
                <StitchStatusDot status={emailConfigured ? 'online' : 'offline'} title={emailConfigured ? 'Configured' : 'Not configured'} />
                <span style={{ fontSize: 12.5, color: S.textSecondary }}>{emailConfigured ? 'Configured' : 'Not configured'}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </StitchContextRail>
  );

  return (
    <StitchAppShell activeKey="ops" breadcrumb="Ops Console" contextRail={contextRail}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StitchPageHeader
          eyebrow="Administration"
          title="Ops Console"
          subtitle={isAdmin
            ? 'Live platform metrics, system health, and feature flags.'
            : 'Moderator tools. Some sections are limited to administrators.'}
          icon="shield"
          actions={
            <StitchTooltip label="Open the full legacy Ops console">
              <StitchButton variant="soft" icon="externalLink" onClick={() => navigate('/ops?ui=legacy')}>Full console</StitchButton>
            </StitchTooltip>
          }
        />

        <StitchTabs tabs={tabs} value={tab} onChange={setTab} />

        <div>
          {tab === 'overview' && <OverviewTab isAdmin={isAdmin} />}
          {tab === 'health'   && <HealthTab   isAdmin={isAdmin} />}
          {tab === 'flags'    && <FlagsTab    isAdmin={isAdmin} />}
          {tab === 'more'     && <MoreTab     isAdmin={isAdmin} />}
        </div>
      </div>
    </StitchAppShell>
  );
}
