/**
 * email/EmailSection.jsx — 112.md follow-up — the Ops › Email section shell:
 * sub-tabs for template management and the outbox delivery history.
 *
 * Extracted package (the research/ precedent): AdminConsole.jsx mounts exactly
 * this default export for the `email` section id, and the package is
 * SSR-testable in isolation. LEGACY DESIGN ONLY — /ops never renders Stitch.
 *
 * KEEP IN LOCKSTEP (tests/unit/opsSectionSync.test.js): the `email` id lives in
 * server getConsole, NAV_SECTIONS, AdminConsole's sections map and
 * OpsPage.OPS_SECTION_IDS. The <h2> below is what OpsPage.HEADINGS matches.
 */
import { useState } from 'react';
import { C } from '../../../theme/tokens.js';
import { SubTabs } from '../research/primitives.jsx';
import TemplatesTab from './TemplatesTab.jsx';
import DeliveryTab from './DeliveryTab.jsx';

export const EMAIL_TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'delivery', label: 'Delivery' },
];

export default function EmailSection() {
  const [tab, setTab] = useState('templates');

  const panels = {
    templates: <TemplatesTab />,
    delivery: <DeliveryTab />,
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: 0, letterSpacing: '-0.02em' }}>Email</h2>
        <p style={{ fontSize: 13, color: C.txt2, marginTop: 6, marginBottom: 0, maxWidth: 860, lineHeight: 1.6 }}>
          Everything the product sends by email. The code-owned registry holds canonical copy; edits here are stored
          as audited overrides (Restore Default deletes them), only optional templates can be disabled, and the
          Delivery tab shows the durable outbox history — subjects and statuses, never bodies.
        </p>
      </div>

      <SubTabs tabs={EMAIL_TABS} active={tab} onSelect={setTab} testIdPrefix="em-tab" />
      {panels[tab]}
    </div>
  );
}
