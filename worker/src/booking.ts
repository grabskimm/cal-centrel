/**
 * Provider-agnostic booking page served at `/book` on the public host. Reads
 * AvailCal's /slots.json (owner working hours, only free times). Selecting a slot
 * opens a modal that adds the time to the visitor's calendar: Google / Outlook
 * calendar, or a universal .ics download. No write credential, no backend —
 * AvailCal stays read-only. Times show in a tz the visitor picks.
 */
import { CALENDAR_PICKER_JS, escapeHtml, SHARED_CSS, TZ_PICKER_JS } from './availability-page';
import { googleCalendarUrl, icsContent, outlookComposeUrl } from './calendar-links';

export interface BookingPageCfg {
  owner: string; // owner email (invitee/guest + email recipient)
  title: string; // default event subject
  flavor: string; // 'office' | 'live'
  tz: string;
  durationMin: string;
  heading: string; // hero heading, e.g. "Book a time with Mendel"
  footer?: string; // optional footer HTML (copyright/link)
  homeHref?: string; // "Home" link target (defaults to '/')
  contactHref?: string; // when set, shows a "Contact" link in the top nav
  fallbackTz?: string;
  slotsBase?: string; // origin for /slots.json ('' = same origin)
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
<style>${SHARED_CSS}</style>
</head>
<body>
  <header class="hero">
    <nav class="topnav">
      <a href="${escapeHtml(cfg.homeHref ?? '/')}">⌂ Home</a>
      <span class="spacer"></span>
      ${cfg.contactHref ? `<a href="${escapeHtml(cfg.contactHref)}">✉ Contact</a>` : ''}
    </nav>
    <h1>${escapeHtml(cfg.heading)}</h1>
    <p>Choose a day, then a time. Shown in your time zone.</p>
  </header>
  <div class="wrap">
    <div class="panel">
      <div class="controls">
        <div class="field grow"><label for="tz">Time zone</label><select id="tz"></select></div>
        <div class="field grow"><label for="title">Subject</label><input type="text" id="title" /></div>
      </div>
      <div class="booklayout">
        <section class="card calcard">
          <div class="calhead"><button id="prev" aria-label="Previous month">‹</button>
            <span class="ml" id="ml"></span><button id="next" aria-label="Next month">›</button></div>
          <div class="cal" id="cal"></div>
        </section>
        <section class="card timecard"><div class="timescol" id="times"></div></section>
      </div>
    </div>
    <div id="status"></div>
    ${cfg.footer ?? ''}
  </div>

  <div id="modal" class="modal" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mtitle">
      <button class="x" id="x" aria-label="Close">×</button>
      <h3 id="mtitle">Add to your calendar</h3>
      <p class="muted" id="mwhen" style="margin:.1rem 0 0"></p>
      <div class="row" id="cal-row" style="margin-top:.6rem"></div>
    </div>
  </div>

<script>
const CFG = ${cfgJson};
${TZ_PICKER_JS}
${CALENDAR_PICKER_JS}
// esbuild builds the Worker with keepNames, which wraps inner helper functions
// with __name(...) calls and defines __name at the top of the WORKER bundle.
// The functions below are embedded via .toString() into this BROWSER page, so
// their source carries __name(...) calls with no __name in scope. Define a no-op
// shim so the embedded copies run. (Without this, icsContent() throws
// "__name is not defined" on click and the booking modal never opens.)
var __name = function (f) { return f; };
// Embedded verbatim (single source of truth) from calendar-links.ts.
const googleCalendarUrl = ${googleCalendarUrl.toString()};
const outlookComposeUrl = ${outlookComposeUrl.toString()};
const icsContent = ${icsContent.toString()};

const $ = (id) => document.getElementById(id);
const tzSel=$('tz'), titleEl=$('title'), statusEl=$('status'), modal=$('modal');
let cache=[], icsUrl=null;

// Surface any uncaught error on the page itself, so a silent failure becomes
// visible ("nothing happens" -> a readable message) without needing DevTools.
function showErr(msg){ if (statusEl){ statusEl.style.color='#dc2626'; statusEl.textContent='⚠ '+msg; } }
window.addEventListener('error', (e)=> showErr((e && e.message) || 'Unexpected error'));
window.addEventListener('unhandledrejection', (e)=> showErr((e && e.reason && e.reason.message) || 'Unexpected error'));

buildTzPicker(tzSel, CFG.fallbackTz);
titleEl.value = CFG.title || 'Meeting';

const fmtTime = (s, tz) => new Date(s).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', timeZone: tz });
const fmtDayLabel = (s, tz) => new Date(s).toLocaleDateString([], { weekday:'long', month:'long', day:'numeric', timeZone: tz });

function linkBtn(text, href, opts) {
  const a=document.createElement('a'); a.className='btn '+(opts.cls||'btn-ghost'); a.textContent=text; a.href=href;
  if (opts.download) a.download='booking.ics'; else { a.target='_blank'; a.rel='noopener'; }
  if (opts.full) a.classList.add('full');
  return a;
}

function openModal(s, tz) {
 try {
  const subject = titleEl.value || CFG.title || 'Meeting';
  const when = fmtDayLabel(s.start, tz) + ' · ' + fmtTime(s.start, tz) + '–' + fmtTime(s.end, tz) + ' (' + tz + ')';
  const cfg = { owner: CFG.owner, title: subject };
  if (icsUrl) URL.revokeObjectURL(icsUrl);
  icsUrl = URL.createObjectURL(new Blob([icsContent(s, cfg)], { type:'text/calendar;charset=utf-8' }));

  $('mwhen').textContent = when;
  const cr = $('cal-row'); cr.innerHTML='';
  cr.appendChild(linkBtn('Google Calendar', googleCalendarUrl(s, cfg), {}));
  cr.appendChild(linkBtn('Outlook Calendar', outlookComposeUrl(s, cfg, CFG.flavor), {}));
  cr.appendChild(linkBtn('Download .ics (Apple/other)', icsUrl, { download:true, full:true }));

  // Force visibility explicitly — don't rely solely on the [hidden] attribute /
  // CSS, which is the kind of thing that can silently no-op in some setups.
  modal.hidden = false;
  modal.style.display = 'flex';
  statusEl.textContent = '';
 } catch (err) { showErr('Could not open booking options: ' + (err && err.message ? err.message : err)); }
}
function closeModal(){ modal.hidden = true; modal.style.display = 'none'; }
$('x').addEventListener('click', closeModal);
modal.addEventListener('click', (e)=>{ if (e.target===modal) closeModal(); });
document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') closeModal(); });

// If we arrived from the home page with ?from=YYYY-MM-DD, preselect that date so
// the chosen day's times appear straight away.
const fromParam = (new URLSearchParams(location.search).get('from') || '').slice(0, 10);
const picker = createPicker({
  calEl:$('cal'), timesEl:$('times'), monthLabelEl:$('ml'), prevEl:$('prev'), nextEl:$('next'),
  getTz: ()=>tzSel.value, getSlots: ()=>cache,
  onTime: (s, tz)=>{ statusEl.style.color=''; statusEl.textContent='Opening booking options…'; openModal(s, tz); },
  initialDate: fromParam,
});

async function load() {
  statusEl.textContent='Loading…';
  try {
    const today = new Date(); const iso=(d)=>d.toISOString().slice(0,10);
    const q = new URLSearchParams({ from: iso(today), to: iso(new Date(today.getTime()+60*864e5)) });
    const res = await fetch((CFG.slotsBase||'') + '/slots.json?' + q.toString());
    if (!res.ok) throw new Error('HTTP '+res.status);
    cache = (await res.json()).slots || [];
    statusEl.textContent = cache.length ? '' : 'No open times right now. Check back soon.';
    picker.refresh();
    // Came from the availability page with a specific slot (?at=ISO)? Open its
    // booking options straight away — no need to pick the same time twice.
    const at = new URLSearchParams(location.search).get('at');
    if (at) { const slot = cache.find((x)=>x.start===at); if (slot) openModal(slot, tzSel.value); }
  } catch (e) { statusEl.textContent='Could not load: '+e.message; }
}

tzSel.addEventListener('change', ()=>picker.refresh());
load();
</script>
</body>
</html>`;
}
