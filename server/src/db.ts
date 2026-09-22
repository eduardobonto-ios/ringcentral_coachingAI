// Call, agent and coaching storage — Supabase Postgres.
//
// Replaces the previous better-sqlite3 database. SQLite tied the whole app to one machine's
// filesystem, which made hosting impossible; the data now lives in the same Supabase project
// that already holds auth, and travels unchanged when the app moves from Vercel to Azure.
//
// Two consequences worth knowing when reading call sites:
//   * every function here is async now, where the SQLite ones were synchronous;
//   * transcript_json / analysis_json are real `jsonb` columns, so they come back as objects.
//     Callers no longer JSON.parse them, and no longer stringify on the way in.
//
// All access uses the service-role key, which bypasses RLS by design. Per-user scoping is
// applied above this layer in auth.ts / index.ts, exactly as it was with SQLite.
import { supabaseAdmin, supabaseConfigured } from './supabaseClient.js';

export type Turn = { start: number; speaker: string; text: string };

function assertConfigured() {
  if (!supabaseConfigured) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — cannot reach the database.');
  }
}

/** Supabase returns an embedded one-to-one either as an object or a single-element array. */
const one = <T>(v: T | T[] | null | undefined): T | undefined =>
  Array.isArray(v) ? v[0] : (v ?? undefined);

export async function upsertAgent(agent: { id: string; name: string; email: string; role: string }) {
  assertConfigured();
  const { error } = await supabaseAdmin.from('agents').upsert(agent, { onConflict: 'id' });
  if (error) throw new Error(`upsertAgent failed: ${error.message}`);
}

const SUMMARY_SELECT =
  'id, recorded_at, duration_sec, status, source, direction, analysis_json,' +
  ' agents!inner(name, email, role), emails(status, sent_at, to_email)';

/** Row shape the frontend's CallSummary expects — deliberately still snake_case. */
export async function listCallSummaries() {
  assertConfigured();
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select(SUMMARY_SELECT)
    .order('recorded_at', { ascending: false });
  if (error) throw new Error(`listCallSummaries failed: ${error.message}`);

  return (data ?? []).map((r: any) => {
    const agent = one<any>(r.agents);
    const email = one<any>(r.emails);
    const analysis = r.analysis_json;
    return {
      id: r.id,
      recorded_at: r.recorded_at,
      duration_sec: r.duration_sec,
      status: r.status,
      source: r.source,
      direction: r.direction,
      agent_name: agent?.name ?? null,
      agent_email: agent?.email ?? null,
      agent_role: agent?.role ?? null,
      // SQLite pulled these out with json_extract; jsonb hands us the object, so read it here.
      overall_score: analysis?.overallScore ?? null,
      band: analysis?.band ?? null,
      outcome: analysis?.outcome ?? null,
      flags_json: analysis?.flags ? JSON.stringify(analysis.flags) : null,
      email_status: email?.status ?? null,
      sent_at: email?.sent_at ?? null,
      to_email: email?.to_email ?? null,
    };
  });
}

export async function getCallDetail(id: string) {
  assertConfigured();
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select(
      'id, recorded_at, duration_sec, status, audio_path, engine, transcript_json, analysis_json,' +
        ' agents!inner(name, email, role), emails(status, to_email, subject, sent_at)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getCallDetail failed: ${error.message}`);
  if (!data) return undefined;

  const r: any = data;
  const agent = one<any>(r.agents);
  const email = one<any>(r.emails);
  return {
    id: r.id,
    recorded_at: r.recorded_at,
    duration_sec: r.duration_sec,
    status: r.status,
    audio_path: r.audio_path,
    engine: r.engine,
    transcript_json: r.transcript_json as Turn[] | null,
    analysis_json: r.analysis_json,
    agent_name: agent?.name ?? null,
    agent_email: agent?.email ?? null,
    agent_role: agent?.role ?? null,
    email_status: email?.status ?? null,
    to_email: email?.to_email ?? null,
    email_subject: email?.subject ?? null,
    email_sent_at: email?.sent_at ?? null,
  };
}

export async function getEmailBody(callId: string): Promise<{ body_html: string } | undefined> {
  assertConfigured();
  const { data, error } = await supabaseAdmin.from('emails').select('body_html').eq('call_id', callId).maybeSingle();
  if (error) throw new Error(`getEmailBody failed: ${error.message}`);
  return data ?? undefined;
}

export async function insertCall(row: {
  id: string;
  recorded_at: string;
  duration_sec: number;
  status: string;
  source: string;
  direction: string;
  agent_id: string;
  audio_path: string;
  engine: string | null;
  transcript_json: unknown | null;
  analysis_json: unknown | null;
  external_id?: string | null;
}) {
  assertConfigured();
  const { error } = await supabaseAdmin.from('calls').insert({ external_id: null, ...row });
  if (error) throw new Error(`insertCall failed: ${error.message}`);
}

/** True once a RingCentral recording has been ingested, so syncs stay idempotent. */
export async function hasExternalCall(externalId: string): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabaseAdmin.from('calls').select('id').eq('external_id', externalId).maybeSingle();
  if (error) throw new Error(`hasExternalCall failed: ${error.message}`);
  return Boolean(data);
}

/** The stored call for an upstream recording, if it has already been coached. */
export async function findCallByExternalId(externalId: string): Promise<{ id: string } | undefined> {
  assertConfigured();
  const { data, error } = await supabaseAdmin.from('calls').select('id').eq('external_id', externalId).maybeSingle();
  if (error) throw new Error(`findCallByExternalId failed: ${error.message}`);
  return data ?? undefined;
}

export async function updateCallAnalysis(id: string, transcript: unknown, analysis: unknown, status: string) {
  assertConfigured();
  const { error } = await supabaseAdmin
    .from('calls')
    .update({ transcript_json: transcript, analysis_json: analysis, status })
    .eq('id', id);
  if (error) throw new Error(`updateCallAnalysis failed: ${error.message}`);
}

export async function upsertEmail(row: {
  call_id: string;
  status: string;
  to_email: string;
  subject: string;
  body_html: string;
  sent_at: string | null;
  error?: string | null;
}) {
  assertConfigured();
  const { error } = await supabaseAdmin.from('emails').upsert({ error: null, ...row }, { onConflict: 'call_id' });
  if (error) throw new Error(`upsertEmail failed: ${error.message}`);
}

/**
 * Analyses from the last 7 days, for the weekly manager report.
 *
 * weeklyReport.ts used to reach past this module and run its own SQL against the sqlite handle;
 * with Postgres there is no shared handle to borrow, so the query belongs here.
 */
export async function listRecentAnalyses(days = 7): Promise<{ agent_name: string; analysis_json: any }[]> {
  assertConfigured();
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('analysis_json, agents!inner(name)')
    .gte('recorded_at', since)
    .not('analysis_json', 'is', null);
  if (error) throw new Error(`listRecentAnalyses failed: ${error.message}`);

  return (data ?? []).map((r: any) => ({
    agent_name: one<any>(r.agents)?.name ?? 'Unknown',
    analysis_json: r.analysis_json,
  }));
}
