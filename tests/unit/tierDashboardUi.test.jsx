/**
 * tierDashboardUi.test.jsx — 72.md User Tier Management admin UI layer.
 *
 * SSR-safe contract tests (house style: renderToStaticMarkup, no jsdom). These
 * assert the presentational contract — tiles, tables, form controls, timeline,
 * subscription fields — of the pure pieces that extend Ops → Tiers. Effects/clicks
 * do not run under static rendering, so interaction is asserted by control presence.
 *
 * Guard rail: NO user-facing "AI" string may appear in any rendered markup.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TierAnalyticsDashboard,
  TierUsersTable,
  UserTierEditorForm,
  TierHistoryTimeline,
  SubscriptionPanel,
  TIER_CHANGE_TYPES,
} from '../../src/frontend/pages/admin/AdminConsole.jsx';

const noop = () => {};
const noAI = (html) => expect(html).not.toMatch(/\bAI\b/);

describe('TierAnalyticsDashboard', () => {
  // The REAL server contract (GET /api/admin/tiers/analytics): the window
  // tallies recentPromotions/recentDowngrades/manualChanges/trialUsers are
  // NUMBERS; the list rows live on the additive *List keys (73.md Part 10).
  const data = {
    totalUsers: 1234,
    byTier: [
      { tierId: 'free', displayName: 'Free', count: 1000, pct: 81 },
      { tierId: 'plus', displayName: 'Plus', count: 200, pct: 16 },
      { tierId: 'pro',  displayName: 'Pro',  count: 34,  pct: 3 },
    ],
    unassigned: 12,
    avgDaysInCurrentTier: 47,
    recentChanges: [
      { userId: 'u1', email: 'a@x.io', from: 'free', to: 'plus', changeType: 'promotion', at: new Date().toISOString(), byName: 'Admin One' },
    ],
    recentPromotions: 5,
    recentDowngrades: 0,
    manualChanges: 3,
    trialUsers: 1,
    recentPromotionsList: [
      { userId: 'u1', email: 'a@x.io', from: 'free', to: 'plus', changeType: 'promotion', at: new Date().toISOString(), byName: 'Admin One' },
    ],
    recentDowngradesList: [],
    trialUsersList: [
      { userId: 'u2', email: 'trial@x.io', tierId: 'pro', effectiveFrom: '2026-06-15T00:00:00.000Z', effectiveUntil: '2026-08-01T00:00:00.000Z' },
    ],
    expiringSoon: [
      { userId: 'u3', email: 'exp@x.io', tierId: 'plus', effectiveUntil: '2026-07-10T00:00:00.000Z' },
    ],
    newByTier: [],
    newUnassigned: 0,
    window: { days: 30 },
  };

  it('renders total + per-tier count tiles with percentages', () => {
    const html = renderToStaticMarkup(h(TierAnalyticsDashboard, { data }));
    expect(html).toContain('Total users');
    expect(html).toContain('1,234');
    expect(html).toContain('Free');
    expect(html).toContain('1,000');
    expect(html).toContain('81% of users');
    expect(html).toContain('Unassigned');
    expect(html).toContain('Avg days in tier');
    expect(html).toContain('47');
    noAI(html);
  });

  it('renders the window tallies as count tiles (they are numbers, not rows)', () => {
    const html = renderToStaticMarkup(h(TierAnalyticsDashboard, { data }));
    expect(html).toContain('Promotions (30d)');
    expect(html).toContain('Downgrades (30d)');
    expect(html).toContain('Manual changes (30d)');
    expect(html).toContain('5'); // recentPromotions tally rendered somewhere
    noAI(html);
  });

  it('renders the compact lists: recent changes, trial users, expiring soon', () => {
    const html = renderToStaticMarkup(h(TierAnalyticsDashboard, { data }));
    expect(html).toContain('Recent tier changes');
    expect(html).toContain('Recent promotions');
    expect(html).toContain('Recent downgrades');
    expect(html).toContain('Trial users');
    expect(html).toContain('Expiring soon');
    // a change row shows from → to + the humanized change type + who
    expect(html).toContain('a@x.io');
    expect(html).toContain('Free → Plus');
    expect(html).toContain('promotion');
    expect(html).toContain('Admin One');
    // the trial + expiring rows show the user + an until date
    expect(html).toContain('trial@x.io');
    expect(html).toContain('exp@x.io');
    expect(html).toContain('until');
    noAI(html);
  });

  it('shows the empty copy for lists with no rows', () => {
    const html = renderToStaticMarkup(h(TierAnalyticsDashboard, { data: { ...data, recentDowngradesList: [] } }));
    expect(html).toContain('No recent downgrades.');
  });

  it('REGRESSION (73.md Part 10): non-zero NUMBER tallies with the *List keys ABSENT (legacy server) render without crashing', () => {
    // This is the exact shape that crashed the Tiers tab to the app-level
    // boundary: counts fed where the lists expected row arrays, and the
    // '(!rows || rows.length === 0)' guard let non-zero numbers through to .map.
    const legacy = {
      totalUsers: 10,
      byTier: [{ tierId: 'pro', displayName: 'Pro', count: 10, pct: 100 }],
      unassigned: 0,
      avgDaysInCurrentTier: 2,
      recentChanges: [],
      recentPromotions: 4,
      recentDowngrades: 2,
      manualChanges: 1,
      trialUsers: 3,
      expiringSoon: [],
      window: { days: 30 },
    };
    const html = renderToStaticMarkup(h(TierAnalyticsDashboard, { data: legacy }));
    // The tallies surface as tiles…
    expect(html).toContain('Promotions (30d)');
    expect(html).toContain('Downgrades (30d)');
    expect(html).toContain('Manual changes (30d)');
    // …and the lists degrade to their empty copy instead of rows.map crashing.
    expect(html).toContain('No recent promotions.');
    expect(html).toContain('No recent downgrades.');
    expect(html).toContain('No trial users.');
    expect(html).toContain('Nothing expiring soon.');
    noAI(html);
  });
});

describe('TierUsersTable', () => {
  const users = [
    { id: 'u1', email: 'a@x.io', name: 'Ada', role: 'user', tierId: 'plus', dateEntered: '2026-06-01T00:00:00.000Z', daysInTier: 32, previousTierId: 'free', changeType: 'promotion', assignedByName: 'Admin One', reason: 'Grant', lastActive: new Date().toISOString(), status: 'active' },
    { id: 'u2', email: 'b@x.io', name: 'Bo',  role: 'user', tierId: 'plus', dateEntered: '2026-05-01T00:00:00.000Z', daysInTier: 63, previousTierId: null, changeType: 'manual', assignedByName: 'Admin Two', reason: '', lastActive: null, status: 'active' },
  ];

  it('renders one row per user plus an Export CSV link to the export URL', () => {
    const html = renderToStaticMarkup(h(TierUsersTable, {
      users, total: 2, page: 1, perPage: 20, onPage: noop,
      csvUrl: '/api/admin/tiers/plus/users/export',
      tierName: (id) => ({ free: 'Free', plus: 'Plus' }[id] || id),
      onChangeTier: noop, onHistory: noop, onSubscription: noop,
    }));
    expect(html).toContain('a@x.io');
    expect(html).toContain('b@x.io');
    expect(html).toContain('Ada');
    expect(html).toContain('Grant');
    // previous-tier id resolved through the name lookup
    expect(html).toContain('Free');
    // CSV export anchor to the export endpoint
    expect(html).toContain('Export CSV');
    expect(html).toContain('/api/admin/tiers/plus/users/export');
    expect(html).toContain('download');
    // per-row actions
    expect(html).toContain('Change tier');
    expect(html).toContain('History');
    noAI(html);
  });

  it('shows an empty message when no users are in the tier', () => {
    const html = renderToStaticMarkup(h(TierUsersTable, { users: [], total: 0, csvUrl: '/x', onPage: noop }));
    expect(html).toContain('No users in this tier.');
  });
});

describe('UserTierEditorForm', () => {
  const tiers = [
    { id: 'free', displayName: 'Free', isActive: true },
    { id: 'plus', displayName: 'Plus', isActive: true },
    { id: 'pro',  displayName: 'Pro',  isActive: true },
  ];
  const value = { tierId: 'plus', changeType: 'promotion', reason: 'Upgrade', effectiveUntil: '2026-09-01', notes: 'note text' };

  it('renders the change-type select with every enum option', () => {
    const html = renderToStaticMarkup(h(UserTierEditorForm, { tiers, value, onChange: noop, currentTierLabel: 'Free' }));
    expect(html).toContain('Change type');
    for (const opt of TIER_CHANGE_TYPES) {
      expect(html).toContain(opt.label); // Manual, Promotion, Downgrade, Trial start, …
    }
    expect(html).toContain('Current tier:');
    noAI(html);
  });

  it('renders the new-tier select, a required reason, an effective-until date and notes', () => {
    const html = renderToStaticMarkup(h(UserTierEditorForm, { tiers, value, onChange: noop }));
    expect(html).toContain('New tier');
    expect(html).toContain('Site default');
    expect(html).toContain('Reason');
    expect(html).toContain('Effective until');
    expect(html).toContain('type="date"');
    expect(html).toContain('2026-09-01');   // effective-until value
    expect(html).toContain('Notes');
    // the selected new tier is present as an option
    expect(html).toContain('Plus');
    noAI(html);
  });
});

describe('TierHistoryTimeline', () => {
  const history = [
    { id: 'a3', tierId: 'pro', previousTierId: 'plus', changeType: 'promotion', reason: 'Renewal', assignedByName: 'Admin One', effectiveFrom: '2026-06-01', effectiveUntil: null, isCurrent: true, reverted: false, createdAt: new Date().toISOString() },
    { id: 'a2', tierId: 'plus', previousTierId: 'free', changeType: 'trial_start', reason: 'Trial', assignedByName: 'Admin Two', effectiveFrom: '2026-05-01', effectiveUntil: '2026-05-31', isCurrent: false, reverted: true, createdAt: '2026-05-01T00:00:00.000Z' },
  ];

  it('renders a timeline entry per change with current/reverted badges and a revert control on the current one', () => {
    const html = renderToStaticMarkup(h(TierHistoryTimeline, {
      history,
      tierName: (id) => ({ free: 'Free', plus: 'Plus', pro: 'Pro' }[id] || id),
      onRevert: noop,
    }));
    expect(html).toContain('Plus → Pro');
    expect(html).toContain('Free → Plus');
    expect(html).toContain('promotion');
    expect(html).toContain('trial start');    // humanized change type
    expect(html).toContain('Current');
    expect(html).toContain('Reverted');
    expect(html).toContain('Renewal');
    expect(html).toContain('Admin One');
    // revert control appears on the current, non-reverted entry
    expect(html).toContain('tier-history-revert-a3');
    expect(html).toContain('Revert');
    // …and NOT on the already-reverted / non-current entry
    expect(html).not.toContain('tier-history-revert-a2');
    noAI(html);
  });

  it('shows an empty state when there is no history', () => {
    const html = renderToStaticMarkup(h(TierHistoryTimeline, { history: [], onRevert: noop }));
    expect(html).toContain('No tier history for this user yet.');
  });
});

describe('SubscriptionPanel', () => {
  const subscription = {
    status: 'trialing', provider: 'stripe', providerCustomerId: 'cus_123', providerSubscriptionId: 'sub_456',
    priceId: 'price_789', planId: 'plan_pro', currentPeriodStart: '2026-06-01', currentPeriodEnd: '2026-07-01',
    trialStart: '2026-05-25', trialEnd: '2026-06-01', cancelAtPeriodEnd: false,
    lastPaymentAt: null, nextRenewalAt: '2026-07-01', failedPaymentCount: 0,
  };

  it('renders the placeholder label and the subscription fields (no payments processed)', () => {
    const html = renderToStaticMarkup(h(SubscriptionPanel, { subscription, onChange: noop }));
    expect(html).toContain('future billing');
    expect(html).toContain('placeholder');
    expect(html).toContain('no payments processed');
    expect(html).toContain('Status');
    expect(html).toContain('Provider');
    expect(html).toContain('Customer ID');
    expect(html).toContain('Subscription ID');
    expect(html).toContain('Current period end');
    expect(html).toContain('Trial start');
    expect(html).toContain('Cancel at period end');
    expect(html).toContain('Next renewal');
    expect(html).toContain('Failed payments');
    // values are bound into the inputs
    expect(html).toContain('trialing');
    expect(html).toContain('cus_123');
    noAI(html);
  });
});
