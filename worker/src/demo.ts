/**
 * Self-contained demo/landing page served at `/` on the public host. It fetches
 * the same-origin /slots.json and renders bookable slots as buttons — a minimal,
 * copy-pasteable example of consuming the endpoint from a webpage. Booking is
 * intentionally out of scope (AvailCal is read-only): clicking a slot just emits
 * a `availcal:slot-selected` event / console log for the host page to wire up.
 */
export const DEMO_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Availability — pick a time</title>
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
  <h1>Pick a time</h1>
  <p class="muted">Free slots derived from a private calendar. Times shown in the
  selected timezone. (Demo — selecting a slot does not book; wire it to your own
  booking flow.)</p>

  <form id="controls">
    <label>From <input type="date" name="from" /></label>
    <label>To <input type="date" name="to" /></label>
    <label>Timezone <input type="text" name="tz" placeholder="America/New_York" /></label>
    <label>Slot minutes <input type="number" name="duration" value="30" min="5" step="5" /></label>
    <label>Work start <input type="time" name="workStart" value="09:00" /></label>
    <label>Work end <input type="time" name="workEnd" value="17:00" /></label>
  </form>

  <div id="status" class="muted">Loading…</div>
  <div id="out"></div>

<script>
const form = document.getElementById('controls');
const out = document.getElementById('out');
const statusEl = document.getElementById('status');

// Default the date range to the next 7 days and tz to the browser's.
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
form.from.value = iso(today);
const plus7 = new Date(today.getTime() + 7 * 864e5);
form.to.value = iso(plus7);
form.tz.value = tz;

function fmtTime(isoStr, tz) {
  return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz });
}
function fmtDay(isoStr, tz) {
  return new Date(isoStr).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
}

async function load() {
  const q = new URLSearchParams({
    from: form.from.value, to: form.to.value, tz: form.tz.value,
    duration: form.duration.value, workStart: form.workStart.value, workEnd: form.workEnd.value,
  });
  statusEl.textContent = 'Loading…';
  out.innerHTML = '';
  try {
    const res = await fetch('/slots.json?' + q.toString());
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
          document.dispatchEvent(new CustomEvent('availcal:slot-selected', { detail: s }));
          console.log('slot selected', s);
          statusEl.textContent = 'Selected ' + fmtDay(s.start, data.tz) + ' ' + fmtTime(s.start, data.tz)
            + ' — wire this to your booking flow.';
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
