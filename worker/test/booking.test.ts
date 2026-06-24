import { describe, expect, it } from 'vitest';

import { bookingHtml } from '../src/booking';

describe('bookingHtml', () => {
  const html = bookingHtml({
    owner: 'me@corp.com',
    title: 'Intro call',
    flavor: 'office',
    tz: 'America/New_York',
    durationMin: '30',
    slotsBase: '',
  });

  it('injects the deployment config', () => {
    expect(html).toContain('"owner":"me@corp.com"');
    expect(html).toContain('"flavor":"office"');
    expect(html).toContain('"tz":"America/New_York"');
  });

  it('consumes AvailCal /slots.json (uses the generated availability)', () => {
    expect(html).toContain("/slots.json?");
  });

  it('embeds the deeplink builder bound to a stable name', () => {
    expect(html).toContain('const outlookComposeUrl =');
    expect(html).toContain('deeplink/compose');
    expect(html).toContain('window.open(url');
  });
});
