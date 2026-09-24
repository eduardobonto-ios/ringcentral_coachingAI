import { randomUUID } from 'node:crypto';
import { insertCall, upsertEmail, upsertAgent } from './db.js';
import { transcribe } from './transcribe.js';
import { uploadRecording } from './storage.js';
import { analyzeCall, type Analysis, type Turn } from './coaching.js';
import { buildCoachingEmail } from './emailTemplate.js';
import { sendEmail } from './email.js';

export type Agent = { id: string; name: string; email: string; role: string };

/**
 * Master switch for outbound coaching mail, default OFF.
 *
 * Agents read their coaching by signing into the app, so email is a convenience, not the
 * delivery mechanism. A sent message cannot be recalled, and the RingCentral call log contains
 * people who are not coached agents at all — so nothing leaves this system until someone sets
 * COACHING_EMAILS_ENABLED=true deliberately.
 */
export const coachingEmailsEnabled = (): boolean => process.env.COACHING_EMAILS_ENABLED === 'true';

/** Full automatic path: transcribe -> AI-analyze -> store -> email. Used by POST /api/upload and the RingCentral sync. */
export async function processRecording(opts: {
  audioPath: string;
  audioFilename: string;
  recordedAt: string;
  source: 'manual-upload' | 'ringcentral';
  direction: 'inbound' | 'outbound' | 'unknown';
  agent: Agent;
  /** Stable upstream key (e.g. `rc:<recordingId>`) so repeat syncs don't re-ingest. */
  externalId?: string;
  /** Overrides the COACHING_EMAILS_ENABLED master switch for this one call. `false` always
   *  suppresses; omitted means "follow the switch". */
  sendEmail?: boolean;
}): Promise<{ callId: string; durationSec: number }> {
  await upsertAgent(opts.agent);
  const callId = randomUUID();
  const raw = await transcribe(opts.audioPath);
  // The recording's own length, which is what the call page plays and times. It is shorter than
  // the call-log duration for the same call, because recording starts on answer.
  const durationSec = Math.round(raw.duration);

  // The RingCentral sync uploads before calling in; a manual upload arrives as a local temp
  // file and still needs storing. upsert:true makes the double-call harmless.
  await uploadRecording(opts.audioPath, opts.audioFilename);

  let status = 'needs-analysis';
  let analysis: Analysis | null = null;
  let turnsForDb: Turn[] = raw.segments.map((s) => ({ start: s.start, speaker: 'agent', text: s.text }));

  try {
    const { turns, analysis: result } = await analyzeCall({
      segments: raw.segments,
      agentName: opts.agent.name,
      agentRole: opts.agent.role,
    });
    turnsForDb = turns;
    analysis = result;
    status = 'analyzed';
  } catch (e) {
    console.warn(`[pipeline] skipping AI analysis for ${callId}: ${(e as Error).message}`);
  }

  await insertCall({
    id: callId,
    recorded_at: opts.recordedAt,
    duration_sec: durationSec,
    status,
    source: opts.source,
    direction: opts.direction,
    agent_id: opts.agent.id,
    audio_path: opts.audioFilename,
    engine: 'faster-whisper/small.en',
    transcript_json: turnsForDb,
    analysis_json: analysis,
    external_id: opts.externalId ?? null,
  });

  if (analysis && (opts.sendEmail ?? coachingEmailsEnabled())) {
    await emailCoaching(callId, opts.agent, opts.recordedAt, turnsForDb, analysis);
  }

  return { callId, durationSec };
}

export async function emailCoaching(callId: string, agent: Agent, recordedAt: string, turns: Turn[], analysis: Analysis) {
  const { subject, html } = buildCoachingEmail({ agentName: agent.name, recordedAt, turns, analysis });
  const result = await sendEmail({ to: agent.email, subject, html });
  await upsertEmail({
    call_id: callId,
    status: result.ok ? 'sent' : 'failed',
    to_email: agent.email,
    subject,
    body_html: html,
    sent_at: result.ok ? new Date().toISOString() : null,
    error: result.error ?? null,
  });
  return result;
}
