/**
 * AvailCal Cloudflare Worker.
 *
 * Three responsibilities, all scale-to-zero:
 *
 *  1. Cron Trigger (hourly) -> boot the merge Container and call POST /run,
 *     which pulls every source, merges, and writes the feed to R2. The Container
 *     then idles and Cloudflare sleeps it (see `sleepAfter`).
 *  2. Serve the feed: GET /availability.ics (and /raw/<label>.ics overlays) read
 *     straight from R2 via the native binding, gated by a secret token in the
 *     query string (calendar clients can't send headers).
 *  3. Accept device-agent uploads: PUT /raw/<source>.json with a Bearer token,
 *     written to R2 via the native binding.
 *
 * On the PUBLIC host it also exposes a token-free, CORS-enabled scheduling
 * surface for webpages: /freebusy.json (anonymized busy), /slots.json (computed
 * bookable free slots), and a demo page at /.
 *
 * The Container computes + writes to R2 with a scoped R2 token (boto3); the
 * Worker serves + accepts uploads via its R2 binding. Both touch one bucket.
 */
import { Container, getContainer } from '@cloudflare/containers';

import { DEMO_HTML } from './demo';
import { type Busy, computeSlots, parseDays } from './slots';

export interface Env {
  // Durable Object namespace backing the merge Container.
  MERGE_CONTAINER: DurableObjectNamespace<MergeContainer>;
  // Native R2 binding used for serving the feed and accepting agent uploads.
  AVAILCAL_BUCKET: R2Bucket;

  // --- auth tokens (Workers Secrets) ---
  FEED_TOKEN: string; // read the merged feed (?token=)
  AGENT_TOKEN: string; // device-agent PUT uploads (Bearer)
  RUN_TOKEN: string; // Worker<->Container trigger + manual POST /run (Bearer)

  // Hostname for the fully-anonymized PUBLIC feed (no token, no labels). When a
  // request arrives on this host, only the public feed is served. Empty = off.
  PUBLIC_FEED_HOST: string;

  // --- config passed through to the Container process ---
  AVAILCAL_R2_BUCKET: string;
  AVAILCAL_R2_ACCOUNT_ID: string;
  AVAILCAL_R2_ACCESS_KEY_ID: string;
  AVAILCAL_R2_SECRET_ACCESS_KEY: string;
  AVAILCAL_ICS_FEEDS: string;
  AVAILCAL_DEFAULT_TZ: string;
  AVAILCAL_HORIZON_DAYS: string;
  AVAILCAL_INCLUDE_TENTATIVE: string;
  // "true" makes the merge job also write the anonymized public feed to R2.
  AVAILCAL_EMIT_PUBLIC: string;

  // --- public scheduling defaults (optional; overridable per request) ---
  SCHEDULE_SLOT_MINUTES?: string; // default slot length (min)
  SCHEDULE_WORK_START?: string; // default working hours start HH:MM
  SCHEDULE_WORK_END?: string; // default working hours end HH:MM
  SCHEDULE_DAYS?: string; // default allowed weekdays, e.g. "1-5"
  SCHEDULE_MAX_RANGE_DAYS?: string; // clamp the requested date range
}

const MERGED_KEY = 'merged/availability.ics';
const PUBLIC_KEY = 'public/availability.ics';
const PUBLIC_FREEBUSY_KEY = 'public/freebusy.json';
const RAW_ICS_RE = /^\/raw\/[A-Za-z0-9_]+\.ics$/;
const RAW_JSON_RE = /^\/raw\/[A-Za-z0-9_]+\.json$/;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const DAY_MS = 86_400_000;

/**
 * The merge Container. It runs the Python HTTP server (image default CMD); the
 * Worker proxies POST /run to it. Env vars (incl. the scoped R2 token) are
 * injected from Workers Secrets so no secret is baked into the image.
 */
export class MergeContainer extends Container<Env> {
  defaultPort = 8080;
  // Idle this long after the last request, then scale to zero.
  sleepAfter = '5m';

  constructor(...args: ConstructorParameters<typeof Container<Env>>) {
    super(...args);
    const env = args[1];
    this.envVars = {
      // Storage backend: Cloudflare R2 (S3-compatible).
      AVAILCAL_R2_BUCKET: env.AVAILCAL_R2_BUCKET,
      AVAILCAL_R2_ACCOUNT_ID: env.AVAILCAL_R2_ACCOUNT_ID,
      AVAILCAL_R2_ACCESS_KEY_ID: env.AVAILCAL_R2_ACCESS_KEY_ID,
      AVAILCAL_R2_SECRET_ACCESS_KEY: env.AVAILCAL_R2_SECRET_ACCESS_KEY,
      // Sources + merge behaviour.
      AVAILCAL_ICS_FEEDS: env.AVAILCAL_ICS_FEEDS ?? '',
      AVAILCAL_DEFAULT_TZ: env.AVAILCAL_DEFAULT_TZ ?? 'America/New_York',
      AVAILCAL_HORIZON_DAYS: env.AVAILCAL_HORIZON_DAYS ?? '90',
      AVAILCAL_INCLUDE_TENTATIVE: env.AVAILCAL_INCLUDE_TENTATIVE ?? 'true',
      AVAILCAL_EMIT_PUBLIC: env.AVAILCAL_EMIT_PUBLIC ?? 'false',
      // The Worker authenticates its /run call with this token.
      AVAILCAL_RUN_TOKEN: env.RUN_TOKEN,
    };
  }
}

/** Constant-time-ish string compare (avoids trivial timing oracles). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
}

/** Trigger one merge cycle by proxying POST /run to the Container. */
async function triggerMerge(env: Env): Promise<Response> {
  const container = getContainer(env.MERGE_CONTAINER);
  return container.fetch(
    new Request('http://merge-container/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RUN_TOKEN}` },
    }),
  );
}

export default {
  /** Hourly Cron Trigger: run a merge cycle. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const resp = await triggerMerge(env);
        const body = await resp.text();
        console.log(`scheduled merge -> ${resp.status}: ${body.slice(0, 300)}`);
      })(),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- PUBLIC host: token-free, read-only scheduling surface ---
    // Only anonymized reads are reachable here; the token feed, overlays,
    // uploads, and /run are all unreachable, so the public hostname can never
    // expose labels or accept writes.
    if (env.PUBLIC_FEED_HOST && url.hostname === env.PUBLIC_FEED_HOST) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method === 'GET') {
        if (path === '/') {
          return new Response(DEMO_HTML, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
          });
        }
        if (path === '/availability.ics') return serveObject(env, PUBLIC_KEY);
        if (path === '/freebusy.json') {
          return serveObject(env, PUBLIC_FREEBUSY_KEY, 'application/json; charset=utf-8', CORS);
        }
        if (path === '/slots.json') return handleSlots(url, env);
      }
      return new Response('not found', { status: 404, headers: CORS });
    }

    // --- serve the merged feed ---
    if (request.method === 'GET' && path === '/availability.ics') {
      const token = url.searchParams.get('token') ?? '';
      if (!safeEqual(token, env.FEED_TOKEN)) return new Response('forbidden', { status: 403 });
      return serveObject(env, MERGED_KEY);
    }

    // --- serve a per-source overlay ---
    if (request.method === 'GET' && RAW_ICS_RE.test(path)) {
      const token = url.searchParams.get('token') ?? '';
      if (!safeEqual(token, env.FEED_TOKEN)) return new Response('forbidden', { status: 403 });
      return serveObject(env, path.slice(1));
    }

    // --- device-agent upload ---
    if (request.method === 'PUT' && RAW_JSON_RE.test(path)) {
      const tok = bearer(request);
      if (!tok || !safeEqual(tok, env.AGENT_TOKEN)) return new Response('unauthorized', { status: 401 });
      const key = path.slice(1); // raw/<source>.json
      await env.AVAILCAL_BUCKET.put(key, request.body, {
        httpMetadata: { contentType: 'application/json' },
      });
      return new Response(JSON.stringify({ status: 'ok', key }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- manual trigger (admin) ---
    if (request.method === 'POST' && path === '/run') {
      const tok = bearer(request);
      if (!tok || !safeEqual(tok, env.RUN_TOKEN)) return new Response('unauthorized', { status: 401 });
      const resp = await triggerMerge(env);
      return new Response(await resp.text(), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/health') return new Response('ok');
    return new Response('not found', { status: 404 });
  },
};

async function serveObject(
  env: Env,
  key: string,
  contentType = 'text/calendar; charset=utf-8',
  extra: Record<string, string> = {},
): Promise<Response> {
  const obj = await env.AVAILCAL_BUCKET.get(key);
  if (!obj) return new Response('not found', { status: 404, headers: extra });
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      // Clients poll hourly; a few minutes of edge cache is plenty.
      'Cache-Control': 'public, max-age=300',
      ETag: obj.httpEtag,
      ...extra,
    },
  });
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Compute bookable free slots from the anonymized busy JSON in R2. All inputs
 * are query params with env-configurable defaults; the date range is clamped to
 * SCHEDULE_MAX_RANGE_DAYS to bound work.
 */
async function handleSlots(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams;
  const nowMs = Date.now();
  const tz = q.get('tz') || env.AVAILCAL_DEFAULT_TZ || 'America/New_York';

  const fromDate = q.get('from') || isoDate(nowMs);
  const maxRange = Number(env.SCHEDULE_MAX_RANGE_DAYS ?? '62') || 62;
  const fromMs = Date.parse(fromDate + 'T00:00:00Z');
  let toDate = q.get('to') || isoDate(nowMs + 7 * DAY_MS);
  let toMs = Date.parse(toDate + 'T00:00:00Z');
  if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
    if (toMs < fromMs) toMs = fromMs;
    if (toMs - fromMs > maxRange * DAY_MS) toMs = fromMs + maxRange * DAY_MS;
    toDate = isoDate(toMs);
  }

  const num = (v: string | null, d: number) => {
    const n = Number(v);
    return v !== null && Number.isFinite(n) && n > 0 ? n : d;
  };
  const durationMin = num(q.get('duration'), Number(env.SCHEDULE_SLOT_MINUTES ?? '30') || 30);
  const stepMin = num(q.get('step'), durationMin);
  const workStart = q.get('workStart') || env.SCHEDULE_WORK_START || '09:00';
  const workEnd = q.get('workEnd') || env.SCHEDULE_WORK_END || '17:00';

  const obj = await env.AVAILCAL_BUCKET.get(PUBLIC_FREEBUSY_KEY);
  const busy: Busy[] = obj ? await obj.json() : [];

  try {
    const days = parseDays(q.get('days') || env.SCHEDULE_DAYS || '1-5');
    const slots = computeSlots(busy, {
      fromDate,
      toDate,
      tz,
      durationMin,
      stepMin,
      workStart,
      workEnd,
      days,
      nowMs,
      maxSlots: 2000,
    });
    return jsonResponse(
      { tz, from: fromDate, to: toDate, durationMin, slots },
      200,
      { 'Cache-Control': 'public, max-age=60' },
    );
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
