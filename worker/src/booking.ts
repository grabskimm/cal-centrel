/**
 * Provider-agnostic booking page served at `/book` on the public host. It reads
 * AvailCal's own /slots.json (only genuinely-free times, owner working hours) and
 * on selecting a slot offers a universal `.ics` download plus Add-to-Google and
 * Add-to-Outlook links — works whatever calendar the booker uses. No write
 * credential, no backend: AvailCal stays read-only; the booked event self-removes
 * from availability on the next hourly merge. Times display in a timezone the
 * visitor picks (defaults to local).
 */
import { SHARED_CSS, TZ_PICKER_JS } from './availability-page';
import { googleCalendarUrl, icsContent, outlookComposeUrl } from './calendar-links';

export interface BookingPageCfg {
  owner: string; // owner email (invitee/guest)
  title: string; // default event subject
  flavor: string; // 'office' | 'live' — which Outlook quick-link to use
  tz: string; // unused for compute; display defaults to viewer local
  durationMin: string; // shown as a hint only
  fallbackTz?: string; // tz fallback when local can't resolve
  slotsBase?: string; // origin for /slots.json ('' = same origin; set when self-hosting)
}

export function bookingHtml(cfg: BookingPageCfg): string {
  const cfgJson = JSON.stringify(cfg);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Book a time</title>
<style>${SHARED_CSS}
  #actions { position: sticky; bottom: 0; background:#fff; border:1px solid var(--line);
    border-radius:12px; padding:.8rem 1rem; margin-top:1rem; box-shadow:0 -4px 16px rgba(2,6,23,.06); }
  #actions[hidden]{ display:none; }
  #actions a { display:inline-block; margin-right:.5rem; padding:.5rem .85rem; border-radius:9px;
    text-decoration:none; border:1px solid var(--ok); color:#166534; font-weight:600; }
  #actions a:hover { background:var(--ok); color:#fff; }
  .chip[aria-pressed=true]{ background:var(--brand); color:#fff; border-color:var(--brand); }
</style>
</head>
<body>
  <header class="hero">
    <h1>Book a time</h1>
    <p>Pick an open slot, then add it to your calendar — Apple, Google, or Outlook.</p>
  </header>
  <div class="wrap">
    <div class="panel">
      <div class="controls">
        <div class="field grow">
          <label for="tz">Time zone</label>
          <select id="tz"></select>
        </div>
        <div class="field"><label for="from">From</label><input type="date" id="from" /></div>
        <div class="field"><label for="to">To</label><input type="date" id="to" /></div>
        <div class="field grow"><label for="title">Subject</label><input type="text" id="title" /></div>
      </div>
    </div>
    <div id="status">Loading…</div>
    <div id="out"></div>
    <div id="actions" hidden></div>
  </div>

<script>
const CFG = ${cfgJson};
${TZ_PICKER_JS}
// Embedded verbatim from calendar-links.ts (single source of truth).
const googleCalendarUrl = ${googleCalendarUrl.toString()};
const outlookComposeUrl = ${outlookComposeUrl.toString()};
const icsContent = ${icsContent.toString()};

const tzSel = document.getElementById('tz');
const fromEl = document.getElementById('from');
const toEl = document.getElementById('to');
const titleEl = document.getElementById('title');
const out = document.getElementById('out');
const statusEl = document.getElementById('status');
const actions = document.getElementById('actions');
let cache = [], icsUrl = null;

buildTzPicker(tzSel, CFG.fallbackTz);
const isoDate = (d) => d.toISOString().slice(0,10);
const today = new Date();
fromEl.value = isoDate(today);
toEl.value = isoDate(new Date(today.getTime() + 14*864e5));
titleEl.value = CFG.title || 'Meeting';

const fmtTime = (s, tz) => new Date(s).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone: tz });
const fmtDayKey = (s, tz) => new Date(s).toLocaleDateString('en-CA', { timeZone: tz });
const fmtDayLabel = (s, tz) => new Date(s).toLocaleDateString([], { weekday:'long', month:'long', day:'numeric', timeZone: tz });

function selectSlot(s, tz, btn) {
  document.querySelectorAll('.chip[aria-pressed=true]').forEach((b)=>b.setAttribute('aria-pressed','false'));
  btn.setAttribute('aria-pressed','true');
  const cfg = { owner: CFG.owner, title: titleEl.value || CFG.title };
  if (icsUrl) URL.revokeObjectURL(icsUrl);
  icsUrl = URL.createObjectURL(new Blob([icsContent(s, cfg)], { type:'text/calendar;charset=utf-8' }));
  actions.innerHTML = '';
  const lbl = document.createElement('span'); lbl.className='muted';
  lbl.style.marginRight='.5rem';
  lbl.textContent = 'Add ' + fmtDayLabel(s.start, tz) + ' ' + fmtTime(s.start, tz) + ' to: ';
  actions.appendChild(lbl);
  const mk = (text, href, dl) => { const a=document.createElement('a'); a.textContent=text; a.href=href;
    if (dl) a.download='booking.ics'; else { a.target='_blank'; a.rel='noopener'; } actions.appendChild(a); };
  mk('Download .ics', icsUrl, true);
  mk('Google', googleCalendarUrl(s, cfg), false);
  mk('Outlook', outlookComposeUrl(s, cfg, CFG.flavor), false);
  actions.hidden = false;
}

function render() {
  const tz = tzSel.value;
  out.innerHTML = ''; actions.hidden = true;
  if (!cache.length) { out.innerHTML = '<div class="empty">No open times in this range.</div>'; return; }
  const byDay = new Map();
  for (const s of cache) {
    const k = fmtDayKey(s.start, tz);
    if (!byDay.has(k)) byDay.set(k, { label: fmtDayLabel(s.start, tz), slots: [] });
    byDay.get(k).slots.push(s);
  }
  for (const { label, slots } of byDay.values()) {
    const day = document.createElement('div'); day.className='day';
    const h = document.createElement('h2'); h.textContent = label; day.appendChild(h);
    const chips = document.createElement('div'); chips.className='chips';
    for (const s of slots) {
      const b = document.createElement('button'); b.className='chip'; b.type='button';
      b.setAttribute('aria-pressed','false'); b.textContent = fmtTime(s.start, tz);
      b.addEventListener('click', () => selectSlot(s, tz, b));
      chips.appendChild(b);
    }
    day.appendChild(chips); out.appendChild(day);
  }
}

async function load() {
  statusEl.textContent = 'Loading…';
  try {
    const q = new URLSearchParams({ from: fromEl.value, to: toEl.value });
    const res = await fetch((CFG.slotsBase || '') + '/slots.json?' + q.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    cache = data.slots || [];
    statusEl.textContent = cache.length ? (cache.length + ' open times') : 'No open times in this range.';
    render();
  } catch (e) { statusEl.textContent = 'Could not load: ' + e.message; }
}

tzSel.addEventListener('change', render);
fromEl.addEventListener('change', load);
toEl.addEventListener('change', load);
load();
</script>
</body>
</html>`;
}
