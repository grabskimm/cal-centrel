/**
 * Pure free-slot computation for the public scheduling endpoint.
 *
 * Given anonymized busy intervals (UTC) and a request (date range, timezone,
 * slot length, working hours, allowed weekdays), produce the bookable FREE slots
 * as UTC instants. No Worker globals here — only `Intl`/`Date` — so it is unit
 * testable in plain Node, and DST is handled correctly via a tz-offset helper.
 */

export interface Busy {
  start: string; // UTC ISO (…Z)
  end: string; // UTC ISO (…Z)
}

export interface SlotParams {
  fromDate: string; // YYYY-MM-DD (inclusive), interpreted in `tz`
  toDate: string; // YYYY-MM-DD (inclusive)
  tz: string; // IANA, e.g. America/New_York
  durationMin: number; // slot length, real minutes
  stepMin: number; // gap between slot starts (defaults to durationMin)
  workStart: string; // HH:MM local
  workEnd: string; // HH:MM local
  days: number[]; // allowed weekdays, 0=Sun … 6=Sat
  nowMs: number; // current instant; slots starting before this are dropped
  maxSlots: number; // hard cap on returned slots
}

export interface Slot {
  start: string; // UTC ISO
  end: string; // UTC ISO
}

/**
 * Offset (ms) such that `localWallClock = utcInstant + offset` for `tz` at the
 * given instant. Uses Intl to read the zone's wall time and diff it against UTC.
 */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  // Intl renders hour 24 for midnight in some engines; normalise to 0.
  const hour = p.hour === 24 ? 0 : p.hour;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second);
  return asUtc - utcMs;
}

/**
 * Convert a wall-clock time in `tz` to a UTC instant (ms). Refines once so DST
 * transitions resolve to the correct offset.
 */
export function wallTimeToUtcMs(
  y: number,
  mo: number,
  d: number,
  hh: number,
  mm: number,
  tz: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}

function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`invalid HH:MM: ${s}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`invalid HH:MM: ${s}`);
  return h * 60 + min;
}

function parseDate(s: string): { y: number; mo: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`invalid date (YYYY-MM-DD): ${s}`);
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

/** Parse "1-5" or "0,1,2" into a sorted unique weekday list. */
export function parseDays(spec: string): number[] {
  const out = new Set<number>();
  for (const tok of spec.split(',').map((t) => t.trim()).filter(Boolean)) {
    const range = /^(\d)-(\d)$/.exec(tok);
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) out.add(i % 7);
    } else if (/^\d$/.test(tok)) {
      out.add(Number(tok) % 7);
    } else {
      throw new Error(`invalid days spec: ${spec}`);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function overlapsBusy(startMs: number, endMs: number, busy: Array<[number, number]>): boolean {
  for (const [bs, be] of busy) {
    if (startMs < be && endMs > bs) return true;
  }
  return false;
}

/** Compute bookable free slots. */
export function computeSlots(busyRaw: Busy[], p: SlotParams): Slot[] {
  const busy: Array<[number, number]> = busyRaw
    .map((b) => [Date.parse(b.start), Date.parse(b.end)] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);

  const startMin = parseHHMM(p.workStart);
  const endMin = parseHHMM(p.workEnd);
  const step = Math.max(1, p.stepMin || p.durationMin);
  const durMs = p.durationMin * 60_000;
  const allowed = new Set(p.days);

  const from = parseDate(p.fromDate);
  const to = parseDate(p.toDate);
  // Iterate calendar dates inclusively using a UTC midnight cursor (date-only).
  let cursor = Date.UTC(from.y, from.mo - 1, from.d);
  const last = Date.UTC(to.y, to.mo - 1, to.d);

  const slots: Slot[] = [];
  while (cursor <= last && slots.length < p.maxSlots) {
    const cd = new Date(cursor);
    const y = cd.getUTCFullYear();
    const mo = cd.getUTCMonth() + 1;
    const d = cd.getUTCDate();
    if (allowed.has(cd.getUTCDay())) {
      for (let t = startMin; t + p.durationMin <= endMin; t += step) {
        const startMs = wallTimeToUtcMs(y, mo, d, Math.floor(t / 60), t % 60, p.tz);
        const endMs = startMs + durMs;
        if (startMs < p.nowMs) continue; // past
        if (overlapsBusy(startMs, endMs, busy)) continue; // busy
        slots.push({
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
        });
        if (slots.length >= p.maxSlots) break;
      }
    }
    cursor += 86_400_000;
  }
  return slots;
}
