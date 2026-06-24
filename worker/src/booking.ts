/**
 * Outlook booking page served at `/book` on the public host. It reads AvailCal's
 * own /slots.json (so only genuinely-free times are offered) and, on click,
 * opens an Outlook compose deeplink prefilled with the slot — the visitor saves
 * it and you (the owner) get the invite. No write credential, no backend:
 * AvailCal stays read-only and the booked event self-removes from availability
 * on the next hourly merge (it lands on a calendar AvailCal already reads).
 */
import { outlookComposeUrl } from './booking-url';

export interface BookingPageCfg {
  owner: string; // owner email (invitee)
  title: string; // default event subject
  flavor: string; // 'office' | 'live'
  tz: string; // default timezone for slot display + query
  durationMin: string; // default slot length
  slotsBase?: string; // origin for /slots.json ('' = same origin; set when self-hosting)
}

export function bookingHtml(cfg: BookingPageCfg): string {
  // Embed the deeplink builder verbatim (single source of truth) + a JSON config.
  const cfgJson = JSON.stringify(cfg);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Book a time</title>
<style>
  :root { font-family: system-ui, sans-serif; }
  body { max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.3rem; }
  form { display: grid; grid-template-columns: repeat(2, 1fr); gap: .5rem 1rem; margin: 1rem 0; }
  label { display: flex; flex-direction: column; font-size: .8rem; gap: .2rem; }
  input { padding: .35rem; font: inherit; }
  .day { margin: 1rem 0; }
  .day h2 { font-size: .95rem; border-bottom: 1px solid #ddd; padding-bottom: .25rem; }
  .slots { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .5rem; }
  button.slot { padding: .4rem .7rem; border: 1px solid #2563eb; background: #eff6ff;
    color: #1e40af; border-radius: 6px; cursor: pointer; font: inherit; }
  button.slot:hover { background: #2563eb; color: #fff; }
  .muted { color: #666; font-size: .8rem; }
  #status { margin: .5rem 0; }
</style>
</head>
<body>
  <h1>Book a time</h1>
  <p class="muted">Pick an open slot. It opens Outlook with the event prefilled —
  just press Save and the invite is sent.</p>

  <form id="controls">
    <label>From <input type="date" name="from" /></label>
    <label>To <input type="date" name="to" /></label>
    <label>Timezone <input type="text" name="tz" /></label>
    <label>Slot minutes <input type="number" name="duration" min="5" step="5" /></label>
    <label>Your name <input type="text" name="title" placeholder="Meeting subject" /></label>
  </form>

  <div id="status" class="muted">Loading…</div>
  <div id="out"></div>

<script>
const CFG = ${cfgJson};
// Embedded verbatim from booking-url.ts (single source of truth). Bound to a
// stable name so a minified bundle can't rename it out from under the caller.
const outlookComposeUrl = ${outlookComposeUrl.toString()};

const form = document.getElementById('controls');
const out = document.getElementById('out');
const statusEl = document.getElementById('status');

const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
form.from.value = iso(today);
form.to.value = iso(new Date(today.getTime() + 7 * 864e5));
form.tz.value = CFG.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
form.duration.value = CFG.durationMin || '30';
form.title.value = CFG.title || 'Meeting';

const fmtTime = (s, tz) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz });
const fmtDay = (s, tz) => new Date(s).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });

async function load() {
  const tz = form.tz.value;
  const q = new URLSearchParams({ from: form.from.value, to: form.to.value, tz, duration: form.duration.value });
  statusEl.textContent = 'Loading…';
  out.innerHTML = '';
  try {
    const res = await fetch((CFG.slotsBase || '') + '/slots.json?' + q.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const slots = data.slots || [];
    statusEl.textContent = slots.length + ' open slot(s).';
    const byDay = new Map();
    for (const s of slots) {
      const k = fmtDay(s.start, data.tz);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(s);
    }
    for (const [day, daySlots] of byDay) {
      const wrap = document.createElement('div'); wrap.className = 'day';
      const h = document.createElement('h2'); h.textContent = day; wrap.appendChild(h);
      const row = document.createElement('div'); row.className = 'slots';
      for (const s of daySlots) {
        const b = document.createElement('button');
        b.className = 'slot'; b.type = 'button';
        b.textContent = fmtTime(s.start, data.tz);
        b.addEventListener('click', () => {
          const url = outlookComposeUrl(s, { owner: CFG.owner, title: form.title.value || CFG.title, flavor: CFG.flavor });
          window.open(url, '_blank', 'noopener');
        });
        row.appendChild(b);
      }
      wrap.appendChild(row); out.appendChild(wrap);
    }
    if (!slots.length) out.innerHTML = '<p class="muted">No open slots in this range.</p>';
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}
form.addEventListener('change', load);
load();
</script>
</body>
</html>`;
}
