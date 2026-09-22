// RingCentral REST client — JWT server-to-server auth, call-log reads, recording downloads.
//
// No SDK: Node 22 has global fetch, and we need exactly four calls. Adding @ringcentral/sdk
// would pull a transitive tree to save ~80 lines.
//
// Auth is the JWT flow (developers.ringcentral.com -> app -> "JWT auth flow"). The password
// grant is deprecated; do not reintroduce it. The JWT itself is minted in the Developer Console
// and pasted into RINGCENTRAL_JWT — we never sign one locally, so there is no private key here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = process.env.RINGCENTRAL_SERVER_URL || 'https://platform.ringcentral.com';

/** Verified against the live account 2026-09-23: 10 requests per 60s on the call-log group. */
const API_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;
/** Pagination is driven by `navigation.nextPage`; this only guards against a malformed response. */
const MAX_PAGES = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Access tokens live ~1hr. Re-minting on every call would burn rate limit, so cache with a margin. */
let cachedToken: { value: string; expiresAt: number } | null = null;
const EXPIRY_MARGIN_MS = 60_000;

export function ringCentralConfigured(): boolean {
  return Boolean(process.env.RINGCENTRAL_CLIENT_ID && process.env.RINGCENTRAL_CLIENT_SECRET && process.env.RINGCENTRAL_JWT);
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - EXPIRY_MARGIN_MS) return cachedToken.value;
  if (!ringCentralConfigured()) {
    throw new Error('RingCentral is not configured — set RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET and RINGCENTRAL_JWT.');
  }

  const basic = Buffer.from(`${process.env.RINGCENTRAL_CLIENT_ID}:${process.env.RINGCENTRAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${SERVER}/restapi/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: process.env.RINGCENTRAL_JWT!,
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!res.ok) {
    // RC puts the useful part in error_description ("Invalid assertion", "Unauthorized for this grant type").
    const body = await res.text();
    throw new Error(`RingCentral token exchange failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

/** Clears the cached token. Only needed by tests and after a 401. */
export function resetTokenCache() {
  cachedToken = null;
}

// --- rate limiting -----------------------------------------------------------------------
//
// RingCentral allows 10 requests/60s on this endpoint group and reports the budget on every
// response. Waiting for a 429 and then sleeping is far slower than simply not spending the
// last request in a window, so track the headers and pause *before* hitting the wall.

let budget = { remaining: Number.POSITIVE_INFINITY, resetAt: 0 };

function recordRateLimit(res: Response) {
  const remaining = Number(res.headers.get('X-Rate-Limit-Remaining'));
  const window = Number(res.headers.get('X-Rate-Limit-Window'));
  if (!Number.isFinite(remaining)) return;
  budget.remaining = remaining;
  if (Number.isFinite(window) && window > 0) budget.resetAt = Date.now() + window * 1000;
}

async function awaitBudget() {
  if (budget.remaining >= 1) return;
  const waitMs = budget.resetAt - Date.now();
  if (waitMs > 0) {
    console.log(`[ringcentral] rate budget spent, pausing ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs + 250);
  }
  budget.remaining = Number.POSITIVE_INFINITY; // optimistic until the next response corrects us
}

/** Only for tests — forget the observed rate-limit budget. */
export function resetRateBudget() {
  budget = { remaining: Number.POSITIVE_INFINITY, resetAt: 0 };
}

/** Authorized, rate-paced, timeout-bounded fetch against the RC API. */
export async function rcFetch(pathOrUrl: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${SERVER}${pathOrUrl}`;

  for (let attempt = 1; ; attempt++) {
    await awaitBudget();
    const res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await getAccessToken()}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    recordRateLimit(res);

    if (res.status === 401) {
      // Token rejected mid-run (revoked, or clock skew). Drop it so the next attempt re-mints.
      resetTokenCache();
    }
    if (res.status !== 429 || attempt >= MAX_ATTEMPTS) return res;

    const waitSec = Number(res.headers.get('Retry-After') ?? 60);
    console.warn(`[ringcentral] 429, retrying in ${waitSec}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
    await sleep(waitSec * 1000);
  }
}

// --- pagination --------------------------------------------------------------------------

/**
 * Whether another page exists.
 *
 * The live API returns `paging: {page, perPage, pageStart, pageEnd}` with **no `totalPages`**,
 * so any check against that field compares with `undefined`, is always false, and paginates
 * forever. `navigation.nextPage` is the field that actually disappears on the last page.
 */
export function hasNextPage(json: { navigation?: { nextPage?: unknown } }): boolean {
  return Boolean(json?.navigation?.nextPage);
}

export type RcCaller = { phoneNumber?: string; name?: string; extensionId?: string };
export type RcLeg = {
  legType?: string;
  result?: string;
  direction?: string;
  extension?: { id?: string | number };
  to?: RcCaller;
  from?: RcCaller;
};
export type RcCallRecord = {
  id: string;
  sessionId?: string;
  startTime: string;
  duration: number;
  type?: string;
  direction?: 'Inbound' | 'Outbound';
  result?: string;
  to?: RcCaller;
  from?: RcCaller;
  extension?: { id?: string | number };
  legs?: RcLeg[];
  recording?: { id: string; contentUri: string; type?: string };
};

export type RcExtension = { id: string; extensionNumber?: string; name: string; email: string; jobTitle?: string };

/**
 * Account-level extension roster, used to attribute a recording to an agent.
 * Only "User" extensions with an email are useful — departments, IVR menus and announcements
 * also live in this list and have nobody to coach.
 */
export async function fetchExtensions(): Promise<RcExtension[]> {
  const out: RcExtension[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await rcFetch(`/restapi/v1.0/account/~/extension?perPage=1000&page=${page}&type=User&status=Enabled`);
    if (!res.ok) throw new Error(`RingCentral extension list failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { records?: any[]; navigation?: { nextPage?: unknown } };

    for (const r of json.records ?? []) {
      const email = r?.contact?.email;
      if (!email) continue;
      out.push({
        id: String(r.id),
        extensionNumber: r.extensionNumber ? String(r.extensionNumber) : undefined,
        name: [r.contact?.firstName, r.contact?.lastName].filter(Boolean).join(' ') || r.name || email,
        email,
        jobTitle: r.contact?.jobTitle || undefined,
      });
    }

    if (!hasNextPage(json)) break;
  }

  return out;
}

// The roster changes only when someone joins or leaves, but every sync used to re-fetch it —
// pure waste against a 10-request budget. Cache it next to the database.
const ROSTER_CACHE = path.join(__dirname, '..', 'data', 'rc-extensions.json');
const ROSTER_TTL_MS = 24 * 3600_000;

export async function fetchExtensionsCached(opts: { force?: boolean } = {}): Promise<RcExtension[]> {
  if (!opts.force) {
    try {
      const raw = JSON.parse(fs.readFileSync(ROSTER_CACHE, 'utf8')) as { fetchedAt: number; extensions: RcExtension[] };
      if (Date.now() - raw.fetchedAt < ROSTER_TTL_MS && raw.extensions?.length) {
        console.log(`[ringcentral] using cached extension roster (${raw.extensions.length} agents)`);
        return raw.extensions;
      }
    } catch {
      // No cache, unreadable, or stale — fall through and fetch.
    }
  }

  const extensions = await fetchExtensions();
  try {
    fs.mkdirSync(path.dirname(ROSTER_CACHE), { recursive: true });
    fs.writeFileSync(ROSTER_CACHE, JSON.stringify({ fetchedAt: Date.now(), extensions }, null, 2));
  } catch (e) {
    console.warn(`[ringcentral] could not cache roster: ${(e as Error).message}`);
  }
  return extensions;
}

/**
 * Account-level call log for a window, recordings only.
 *
 * Account-level (not `/extension/~/call-log`) so one pass covers every agent; this is why the
 * app needs a role with ReadCompanyCallLog rather than a plain Standard user.
 */
export async function fetchCallLog(opts: { dateFrom: string; dateTo: string; perPage?: number }): Promise<RcCallRecord[]> {
  const out: RcCallRecord[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      type: 'Voice',
      view: 'Detailed',
      withRecording: 'true',
      perPage: String(opts.perPage ?? 250),
      page: String(page),
    });

    const res = await rcFetch(`/restapi/v1.0/account/~/call-log?${params}`);
    if (!res.ok) throw new Error(`RingCentral call log failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { records?: RcCallRecord[]; navigation?: { nextPage?: unknown } };

    out.push(...(json.records ?? []));
    if (!hasNextPage(json)) break;
  }

  return out;
}

/** Streams recording audio to disk. RC serves these from media.ringcentral.com via contentUri. */
export async function downloadRecording(contentUri: string, destPath: string): Promise<void> {
  const res = await rcFetch(contentUri, {}, DOWNLOAD_TIMEOUT_MS);
  if (!res.ok || !res.body) throw new Error(`RingCentral recording download failed (${res.status}): ${await res.text()}`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(destPath));
}
