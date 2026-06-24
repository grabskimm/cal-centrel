import { describe, expect, it } from 'vitest';

import { availabilityHtml } from '../src/availability-page';

describe('availabilityHtml', () => {
  const html = availabilityHtml({ title: 'Find a time with Mendel', fallbackTz: 'America/Los_Angeles' });

  it('shows the personalised title and a month-calendar picker', () => {
    expect(html).toContain('Find a time with Mendel');
    expect(html).toContain('id="cal"');
    expect(html).toContain('id="times"');
    expect(html).toContain('createPicker(');
    expect(html).toContain('/slots.json?');
    expect(html).toContain('/book?from=');
  });
});
