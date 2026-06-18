/**
 * SSR render tests for InstitutionAutocomplete (prompt35). The project's test infra
 * renders to static markup (no jsdom), so these assert the server-rendered surface:
 * the typeahead input, and the "linked canonical" indicator for a selected value.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import InstitutionAutocomplete from '../../src/frontend/components/InstitutionAutocomplete.jsx';

describe('InstitutionAutocomplete (prompt35)', () => {
  it('renders an accessible combobox input with the placeholder', () => {
    const html = renderToStaticMarkup(<InstitutionAutocomplete value={null} onChange={() => {}} placeholder="Find your institution…" />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('Find your institution');
    expect(html).toContain('aria-autocomplete="list"');
  });

  it('shows the canonical-link indicator for a selected ROR value, with location', () => {
    const value = { name: 'Harvard University', canonicalName: 'Harvard University', rorId: 'https://ror.org/03vek6s52', source: 'ror', city: 'Cambridge', countryName: 'United States' };
    const html = renderToStaticMarkup(<InstitutionAutocomplete value={value} onChange={() => {}} />);
    expect(html).toContain('Harvard University'); // shown in the input value
    expect(html).toContain('Linked to a verified institution');
    expect(html).toContain('Cambridge, United States');
  });

  it('renders a custom string value without a canonical-link indicator', () => {
    const html = renderToStaticMarkup(<InstitutionAutocomplete value={'My Independent Lab'} onChange={() => {}} />);
    expect(html).toContain('My Independent Lab');
    expect(html).not.toContain('Linked to a verified institution');
  });
});
