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

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const isDemo = !!seed;

export function audioSrc(call: { id: string; audio_path: string }): string {
  return seed?.audio?.[call.id] ?? `/audio/${call.audio_path.split('/').pop()}`;
}

export const api = {
  calls: () => (seed ? Promise.resolve({ calls: seed.calls }) : get<{ calls: CallSummary[] }>('/api/calls')),
  call: (id: string) =>
    seed ? Promise.resolve(seed.details[id]) : get<CallDetail>(`/api/calls/${id}`),
  rubric: () =>
    seed ? Promise.resolve(seed.rubric) : get<{ version: string; dimensions: Dimension[] }>('/api/rubric'),
  emailUrl: (id: string) =>
    seed
      ? `data:text/html;charset=utf-8,${encodeURIComponent(seed.emails[id] ?? '')}`
      : `/api/calls/${id}/email`,
  upload: async (file: File, agentId: string) => {
    if (seed) throw new Error('This is a read-only preview — run the server to process new recordings.');
    const body = new FormData();
    body.append('agentId', agentId);
    body.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ callId: string }>;
  },
  analyze: async (id: string) => {
    if (seed) throw new Error('This is a read-only preview — run the server to process new recordings.');
    const res = await fetch(`/api/calls/${id}/analyze`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ status: string }>;
  },
};

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
