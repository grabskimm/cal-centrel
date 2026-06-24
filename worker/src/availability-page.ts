/**
 * Public availability page served at `/` on the public host. Friendly, branded,
 * read-only: it shows when the owner is FREE (computed from /slots.json), grouped
 * by day, in a timezone the visitor picks from a dropdown (defaults to their
 * local zone). Working hours and slot length are owner-controlled via env, so
 * they are not shown here. Anonymized — no calendar names. Links to /book.
 */
export interface AvailabilityPageCfg {
  title: string; // friendly heading
  fallbackTz: string; // used if the browser can't resolve a local zone
}

// Shared look-and-feel for the public pages.
export const SHARED_CSS = `
  :root { --bg:#0f172a; --card:#ffffff; --ink:#0f172a; --muted:#64748b;
    --brand:#4f46e5; --brand2:#7c3aed; --chip:#eef2ff; --chipink:#3730a3;
    --ok:#16a34a; --line:#e2e8f0; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color:var(--ink); background:#f1f5f9; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 0 1rem 3rem; }
  header.hero { background: linear-gradient(135deg, var(--brand), var(--brand2));
    color:#fff; padding: 2.2rem 1rem 3.2rem; text-align:center; }
  header.hero h1 { margin:0 0 .35rem; font-size: 1.7rem; letter-spacing:-.02em; }
  header.hero p { margin:0; opacity:.9; font-size:.98rem; }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:14px;
    box-shadow: 0 10px 30px rgba(2,6,23,.06); padding: 1rem 1.1rem; margin-top:-1.8rem; }
  .controls { display:flex; flex-wrap:wrap; gap:.8rem 1rem; align-items:flex-end; }
  .field { display:flex; flex-direction:column; gap:.25rem; }
  .field label { font-size:.72rem; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .field select, .field input { padding:.5rem .6rem; font:inherit; border:1px solid var(--line);
    border-radius:9px; background:#fff; min-width: 11rem; }
  .grow { flex:1 1 auto; }
  a.book { margin-left:auto; align-self:center; background:var(--brand); color:#fff; text-decoration:none;
    padding:.55rem .9rem; border-radius:9px; font-weight:600; font-size:.9rem; white-space:nowrap; }
  a.book:hover { filter:brightness(1.08); }
  #status { color:var(--muted); font-size:.85rem; margin:1.1rem .2rem .4rem; }
  .day { margin-top:1.1rem; }
  .day h2 { font-size:.95rem; margin:0 0 .55rem; color:var(--ink); }
  .day .date { color:var(--muted); font-weight:500; }
  .chips { display:flex; flex-wrap:wrap; gap:.45rem; }
  .chip { padding:.45rem .7rem; border-radius:999px; background:var(--chip); color:var(--chipink);
    font-size:.9rem; font-weight:600; border:1px solid #e0e7ff; }
  a.chip { text-decoration:none; }
  a.chip:hover { background:var(--brand); color:#fff; border-color:var(--brand); }
  .empty { text-align:center; color:var(--muted); padding:2.5rem 1rem; }
  footer { text-align:center; color:var(--muted); font-size:.78rem; margin-top:2rem; }
`;

// Populates a <select id=tz> with the browser's IANA zones, selects the local
// one (or a fallback), and exposes window.__tz / a 'change' callback. Embedded
// into pages that need the timezone picker.
export const TZ_PICKER_JS = `
function buildTzPicker(selectEl, fallbackTz) {
  let zones = [];
  try { zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []; } catch (e) {}
  if (!zones.length) zones = ['America/Los_Angeles','America/Denver','America/Chicago',
    'America/New_York','UTC','Europe/London','Europe/Paris','Asia/Kolkata','Asia/Singapore',
    'Asia/Tokyo','Australia/Sydney'];
  let local = fallbackTz;
  try { local = Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTz; } catch (e) {}
  if (!zones.includes(local)) zones = [local, ...zones];
  selectEl.innerHTML = '';
  for (const z of zones) {
    const o = document.createElement('option');
    o.value = z; o.textContent = z.replace(/_/g,' ');
    if (z === local) o.selected = true;
    selectEl.appendChild(o);
  }
  return local;
}
`;

export function availabilityHtml(cfg: AvailabilityPageCfg): string {
  const cfgJson = JSON.stringify(cfg);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(cfg.title)}</title>
<style>${SHARED_CSS}</style>
</head>
<body>
  <header class="hero">
    <h1>${escapeHtml(cfg.title)}</h1>
    <p>Pick your time zone and a date range to see open times.</p>
  </header>
  <div class="wrap">
    <div class="panel">
      <div class="controls">
        <div class="field grow">
          <label for="tz">Time zone</label>
          <select id="tz"></select>
        </div>
        <div class="field">
          <label for="from">From</label>
          <input type="date" id="from" />
        </div>
        <div class="field">
          <label for="to">To</label>
          <input type="date" id="to" />
        </div>
        <a class="book" href="/book">Request a time →</a>
      </div>
    </div>
    <div id="status">Loading…</div>
    <div id="out"></div>
    <footer>Times shown in your selected zone. Availability updates hourly.</footer>
  </div>

<script>
const CFG = ${cfgJson};
${TZ_PICKER_JS}
const tzSel = document.getElementById('tz');
const fromEl = document.getElementById('from');
const toEl = document.getElementById('to');
const out = document.getElementById('out');
const statusEl = document.getElementById('status');
let cache = [];

buildTzPicker(tzSel, CFG.fallbackTz);
const isoDate = (d) => d.toISOString().slice(0,10);
const today = new Date();
fromEl.value = isoDate(today);
toEl.value = isoDate(new Date(today.getTime() + 14*864e5));

const fmtTime = (s, tz) => new Date(s).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone: tz });
const fmtDayKey = (s, tz) => new Date(s).toLocaleDateString('en-CA', { timeZone: tz });
const fmtDayLabel = (s, tz) => new Date(s).toLocaleDateString([], { weekday:'long', month:'long', day:'numeric', timeZone: tz });

function render() {
  const tz = tzSel.value;
  out.innerHTML = '';
  if (!cache.length) { out.innerHTML = '<div class="empty">No open times in this range. Try widening the dates.</div>'; return; }
  const byDay = new Map();
  for (const s of cache) {
    const k = fmtDayKey(s.start, tz);
    if (!byDay.has(k)) byDay.set(k, { label: fmtDayLabel(s.start, tz), slots: [] });
    byDay.get(k).slots.push(s);
  }
  for (const { label, slots } of byDay.values()) {
    const day = document.createElement('div'); day.className = 'day';
    const h = document.createElement('h2'); h.textContent = label; day.appendChild(h);
    const chips = document.createElement('div'); chips.className = 'chips';
    for (const s of slots) {
      const a = document.createElement('a'); a.className = 'chip';
      a.textContent = fmtTime(s.start, tz);
      a.href = '/book?from=' + encodeURIComponent(s.start.slice(0,10));
      chips.appendChild(a);
    }
    day.appendChild(chips); out.appendChild(day);
  }
}

async function load() {
  statusEl.textContent = 'Loading…';
  try {
    const q = new URLSearchParams({ from: fromEl.value, to: toEl.value });
    const res = await fetch('/slots.json?' + q.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    cache = data.slots || [];
    statusEl.textContent = cache.length ? (cache.length + ' open times') : 'No open times in this range.';
    render();
  } catch (e) { statusEl.textContent = 'Could not load availability: ' + e.message; }
}

tzSel.addEventListener('change', render);   // re-render only; slots are tz-independent
fromEl.addEventListener('change', load);
toEl.addEventListener('change', load);
load();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
