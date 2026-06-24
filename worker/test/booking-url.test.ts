import { describe, expect, it } from 'vitest';

import { outlookComposeUrl } from '../src/booking-url';

const slot = { start: '2026-06-24T13:00:00.000Z', end: '2026-06-24T13:30:00.000Z' };

describe('outlookComposeUrl', () => {
  it('builds an M365 (office) compose deeplink with slot + invitee', () => {
    const url = outlookComposeUrl(slot, { owner: 'me@corp.com', title: 'Intro call', flavor: 'office' });
    expect(url.startsWith('https://outlook.office.com/calendar/0/deeplink/compose?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('rru')).toBe('addevent');
    expect(q.get('startdt')).toBe(slot.start);
    expect(q.get('enddt')).toBe(slot.end);
    expect(q.get('subject')).toBe('Intro call');
    expect(q.get('to')).toBe('me@corp.com');
  });

  it('uses outlook.com for the personal (live) flavor', () => {
    const url = outlookComposeUrl(slot, { owner: '', title: 'X', flavor: 'live' });
    expect(url.startsWith('https://outlook.live.com/calendar/0/deeplink/compose?')).toBe(true);
  });

  it('omits the invitee when owner is empty', () => {
    const url = outlookComposeUrl(slot, { owner: '', title: 'X', flavor: 'office' });
    expect(new URL(url).searchParams.has('to')).toBe(false);
  });

  it('url-encodes the subject', () => {
    const url = outlookComposeUrl(slot, { owner: '', title: 'Q3 review & sync', flavor: 'office' });
    expect(url).toContain('subject=Q3+review+%26+sync');
  });
});
