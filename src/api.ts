import { supabase } from './supabaseClient';

export type CallSummary = {
  id: string;
  recorded_at: string;
  duration_sec: number;
  status: string;
  source: string;
  direction: string;
  agent_name: string;
  agent_email: string;
  agent_role: string;
  overall_score: number | null;
  band: string | null;
  outcome: string | null;
  flags_json: string | null;
  email_status: string | null;
  sent_at: string | null;
  to_email: string | null;
};

export type Turn = {
  start: number;
  speaker: 'agent' | 'customer' | 'system' | string;
  text: string;
  lowConfidence?: boolean;
};

export type Score = {
  key: string;
  label?: string;
  score: number;
  rationale: string;
  evidence: { t: number; quote: string }[];
};

export type CallDetail = {
  id: string;
  recorded_at: string;
  duration_sec: number;
  status: string;
  audio_path: string;
  audio_url: string;
  agent_name: string;
  agent_email: string;
  agent_role: string;
  engine: string | null;
  turns: Turn[];
  analysis: {
    rubricVersion: string;
    overallScore: number;
    band: string;
    outcome: string | null;
    scores: Score[];
    strengths: { title: string; detail: string }[];
    improvements: { title: string; detail: string; instead: string; say: string }[];
    practiceAction: string;
    flags: string[];
  } | null;
  email: { status: string; to: string; subject: string; sentAt: string | null } | null;
};

export type Dimension = { key: string; label: string; weight: number };

/**
 * Demo mode. When the page is served with a `window.__SEED__` payload baked in
 * (the published preview build), the app reads from that instead of calling the
 * API — same components, no server required.
 */
type Seed = {
  calls: CallSummary[];
  details: Record<string, CallDetail>;
  rubric: { version: string; dimensions: Dimension[] };
  emails: Record<string, string>;
  audio?: Record<string, string>;
};
const seed: Seed | undefined = (globalThis as any).__SEED__;

/**
 * Where the API lives.
 *
 * Empty in dev and for a same-origin deploy, so requests stay relative and Vite's proxy handles
 * them. Set VITE_API_BASE_URL when the API is hosted separately from the frontend — which it is
 * in production, because the nightly sync needs a persistent process and cannot run on the same
 * serverless platform that serves the static site.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

const apiUrl = (path: string) => `${API_BASE}${path}`;

// Demo mode never calls this (isDemo short-circuits first), so it's fine to always attach an
// auth header here — no Supabase session just means no header, and the server will 401.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(apiUrl(url), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const isDemo = !!seed;

export function audioSrc(call: { id: string; audio_url: string }): string {
  return seed?.audio?.[call.id] ?? call.audio_url;
}

export const api = {
  calls: () => (seed ? Promise.resolve({ calls: seed.calls }) : get<{ calls: CallSummary[] }>('/api/calls')),
  call: (id: string) =>
    seed ? Promise.resolve(seed.details[id]) : get<CallDetail>(`/api/calls/${id}`),
  rubric: () =>
    seed ? Promise.resolve(seed.rubric) : get<{ version: string; dimensions: Dimension[] }>('/api/rubric'),
  // Fetched (not a plain <iframe src>) because the live route needs a Bearer header, which a
  // src="..." navigation can't send — render the result with <iframe srcDoc>.
  emailHtml: async (id: string): Promise<string> => {
    if (seed) return seed.emails[id] ?? '';
    const res = await fetch(apiUrl(`/api/calls/${id}/email`), { headers: await authHeaders() });
    return res.ok ? res.text() : '';
  },
  upload: async (file: File) => {
    if (seed) throw new Error('This is a read-only preview — run the server to process new recordings.');
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(apiUrl('/api/upload'), { method: 'POST', body, headers: await authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ callId: string }>;
  },
  analyze: async (id: string) => {
    if (seed) throw new Error('This is a read-only preview — run the server to process new recordings.');
    const res = await fetch(apiUrl(`/api/calls/${id}/analyze`), { method: 'POST', headers: await authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ status: string }>;
  },
};

export type RingCentralCallOption = {
  externalId: string;
  recordingId: string;
  startTime: string;
  durationSec: number;
  direction: 'inbound' | 'outbound' | 'unknown';
  agentEmail: string;
  agentName: string;
  coached: boolean;
  callId: string | null;
};

export type DayCount = {
  /** YYYY-MM-DD in Manila. */
  date: string;
  /** False means nobody has indexed this day yet — render it as unknown, never as zero. */
  indexed: boolean;
  coachable: number;
  coached: number;
};

/**
 * On-demand coaching. Listing a day reads the RingCentral call log and downloads nothing, so it
 * is fast and free; only `coach` costs anything, and only for the call the person picked.
 */
export const ringcentral = {
  callsOn: (date: string) =>
    seed
      ? Promise.resolve({ date, calls: [] as RingCentralCallOption[] })
      : get<{ date: string; calls: RingCentralCallOption[] }>(`/api/ringcentral/calls?date=${date}`),

  monthOverview: (month: string) =>
    seed
      ? Promise.resolve({ month, days: [] as DayCount[] })
      : get<{ month: string; days: DayCount[] }>(`/api/ringcentral/month?month=${month}`),

  coach: async (date: string, recordingId: string) => {
    if (seed) throw new Error('This is a read-only preview — run the server to coach a call.');
    const res = await fetch(apiUrl('/api/ringcentral/coach'), {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, recordingId }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as any)?.error ?? (await res.text()));
    return res.json() as Promise<{ callId: string; alreadyCoached: boolean }>;
  },
};

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
