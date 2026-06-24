/**
 * Pure builder for an Outlook "compose event" deeplink. Clicking it opens
 * Outlook (web) with a prefilled event the user saves — a credential-free way to
 * turn an AvailCal free slot into a booking. Kept self-contained (no imports, no
 * closure refs) so it can be both unit-tested here AND embedded verbatim into the
 * booking page via `.toString()` — one source of truth.
 */

export interface BookingSlot {
  start: string; // UTC ISO
  end: string; // UTC ISO
}

export interface BookingCfg {
  owner: string; // owner email -> added as invitee ('to'); '' to omit
  title: string;
  flavor: string; // 'live' for outlook.com personal, else office365
}

export function outlookComposeUrl(slot: BookingSlot, cfg: BookingCfg): string {
  const base =
    cfg.flavor === 'live'
      ? 'https://outlook.live.com/calendar/0/deeplink/compose'
      : 'https://outlook.office.com/calendar/0/deeplink/compose';
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    startdt: slot.start,
    enddt: slot.end,
    subject: cfg.title,
  });
  if (cfg.owner) p.set('to', cfg.owner);
  return base + '?' + p.toString();
}
