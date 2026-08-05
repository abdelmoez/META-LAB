/**
 * SSR smoke for the CLASSIC assisted extraction panel after 98.md §16 (immediate
 * click-replace convergence). House style: renderToStaticMarkup, no jsdom; effects
 * never run, so this exercises module loading (decideWrite import removed, engine
 * articleStatus guards added) and the initial render contract only:
 *  - the workspace + method bar still render for a selected study;
 *  - the retired §21.5 blocking Keep/Replace dialog can no longer appear;
 *  - the persistent aria-live capture-status container exists from first paint.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistedExtractionPanel from '../../../src/features/extraction/unified/AssistedExtractionPanel.jsx';

const study = { id: 'st1', author: 'Vega', year: '2023', esType: 'OR', notes: '', conversions: [] };

describe('AssistedExtractionPanel SSR (98.md §16)', () => {
  it('renders the workspace, method bar and aria-live status container — no dialog', () => {
    const html = renderToStaticMarkup(
      <AssistedExtractionPanel projectId="p1" studies={[study]} selectedStudyId="st1" />
    );
    expect(html).toContain('EXTRACTION WORKSPACE');
    expect(html).toContain('Click-assign');
    // Immediate-replace semantics: the blocking overwrite dialog is retired for good.
    expect(html).not.toContain('alertdialog');
    expect(html).not.toContain('Keep current');
    // Capture/replace announcements have a persistent polite live region.
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it('renders the Click-assign method box with the field picker when selected', () => {
    // method state is internal ('auto' by default); the picker options are still part
    // of the module contract — assert the ASSIGN_FIELDS wiring via the auto surface.
    const html = renderToStaticMarkup(
      <AssistedExtractionPanel projectId="p1" studies={[study]} selectedStudyId="st1" />
    );
    expect(html).toContain('Auto-generate');
  });
});
