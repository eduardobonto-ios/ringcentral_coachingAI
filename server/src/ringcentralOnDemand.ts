// On-demand coaching: list a person's recorded calls for a day, and coach one when asked.
//
// Replaces the nightly batch sync as the primary path. The batch downloaded and transcribed
// every recorded call whether or not anyone ever opened it — which cost money for nothing, meant
// holding a copy of every customer conversation, and above all took 30-45 minutes, so the API
// could not be hosted anywhere serverless.
//
// Listing a day is free: it reads the call log and downloads no audio. Only coaching one call
// costs anything, and one call is ~15-20s, comfortably inside any function timeout.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchExtensionsCached, fetchCallLog, downloadRecording, type RcCallRecord, type RcExtension } from './ringcentral.js';
import { agentExtensionId, isCoachable, toAgent, directionOf, externalIdOf, recordingFilename, extensionIndex } from './ringcentralMap.js';
import { processRecording } from './pipeline.js';
import { hasExternalCall, findCallByExternalId } from './db.js';

// Recordings live in Supabase Storage; this is only somewhere for the transcription API to
// read a file from before it is uploaded and deleted. Temp is correct, and works on serverless.
const AUDIO_DIR = path.join(os.tmpdir(), 'coaching-audio');

/** The timezone the rest of the app displays and groups by — see src/dailyRollup.ts. */
const TZ_OFFSET = '+08:00'; // Asia/Manila, no DST

export type CallOption = {
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

/** A calendar day in Manila, as the UTC instants the RingCentral call log expects. */
function dayWindow(date: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD.`);
  const from = new Date(`${date}T00:00:00${TZ_OFFSET}`);
  const to = new Date(from.getTime() + 24 * 3600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Which calls this viewer may see.
 *
 * An admin sees everyone. Anyone else sees only calls attributed to their own extension —
 * matched on the email RingCentral holds for that extension, which is the same join the rest of
 * the app uses. Someone with no RingCentral extension sees nothing, which is correct: they make
 * no calls.
 */
function visibleTo(
  records: RcCallRecord[],
  byExtension: Map<string, RcExtension>,
  viewer: { email: string; isAdmin: boolean },
): { record: RcCallRecord; extension: RcExtension }[] {
  const out: { record: RcCallRecord; extension: RcExtension }[] = [];
  for (const record of records) {
    if (!isCoachable(record)) continue;
    const extId = agentExtensionId(record);
    const extension = extId ? byExtension.get(extId) : undefined;
    if (!extension) continue;
    if (!viewer.isAdmin && extension.email.toLowerCase() !== viewer.email.toLowerCase()) continue;
    out.push({ record, extension });
  }
  return out;
}

export async function listCallsForDay(opts: { date: string; email: string; isAdmin: boolean }): Promise<CallOption[]> {
  const { from, to } = dayWindow(opts.date);
  const byExtension = extensionIndex(await fetchExtensionsCached());
  const records = await fetchCallLog({ dateFrom: from, dateTo: to });

  const visible = visibleTo(records, byExtension, { email: opts.email, isAdmin: opts.isAdmin });

  return Promise.all(
    visible.map(async ({ record, extension }) => {
      const externalId = externalIdOf(record);
      const existing = await findCallByExternalId(externalId);
      return {
        externalId,
        recordingId: record.recording!.id,
        startTime: record.startTime,
        durationSec: record.duration,
        direction: directionOf(record),
        agentEmail: extension.email,
        agentName: extension.name,
        coached: Boolean(existing),
        callId: existing?.id ?? null,
      };
    }),
  );
}

/**
 * Coach one call: download it, transcribe, analyze, store.
 *
 * Takes a date and recording id rather than a URL. The recording's contentUri is re-fetched from
 * RingCentral here and never accepted from the client — otherwise the endpoint would download
 * and store whatever a caller pointed it at. Ownership is re-checked for the same reason: the
 * list endpoint filtering is a convenience, not the access control.
 */
export async function coachOneCall(opts: {
  date: string;
  recordingId: string;
  email: string;
  isAdmin: boolean;
}): Promise<{ callId: string; alreadyCoached: boolean }> {
  const { from, to } = dayWindow(opts.date);
  const byExtension = extensionIndex(await fetchExtensionsCached());
  const records = await fetchCallLog({ dateFrom: from, dateTo: to });

  const match = visibleTo(records, byExtension, { email: opts.email, isAdmin: opts.isAdmin }).find(
    ({ record }) => record.recording?.id === opts.recordingId,
  );
  if (!match) throw new Error('That recording is not available to coach.');

  const externalId = externalIdOf(match.record);
  const existing = await findCallByExternalId(externalId);
  if (existing) return { callId: existing.id, alreadyCoached: true };

  const filename = recordingFilename(match.record);
  const audioPath = path.join(AUDIO_DIR, filename);
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  try {
    await downloadRecording(match.record.recording!.contentUri, audioPath);
    const { callId } = await processRecording({
      audioPath,
      audioFilename: filename,
      recordedAt: match.record.startTime,
      source: 'ringcentral',
      direction: directionOf(match.record),
      agent: toAgent(match.extension),
      externalId,
    });
    return { callId, alreadyCoached: false };
  } finally {
    // Supabase Storage holds the recording now; the local file was only somewhere for the
    // transcription API to read from.
    fs.rmSync(audioPath, { force: true });
  }
}

export { hasExternalCall };
