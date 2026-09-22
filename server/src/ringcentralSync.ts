// Pulls the day's recorded calls out of RingCentral and feeds them to the coaching pipeline.
//
// Runs nightly rather than on a webhook: coaching is a daily digest (see src/dailyRollup.ts),
// so there is no value in reacting within seconds of a call ending, and a single batched pass
// is far kinder to RingCentral's rate limits than per-call notifications.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { hasExternalCall } from './db.js';
import { processRecording } from './pipeline.js';
import { ringCentralConfigured, fetchExtensionsCached, fetchCallLog, downloadRecording } from './ringcentral.js';
import { uploadRecording } from './storage.js';
import {
  agentExtensionId,
  isCoachable,
  toAgent,
  directionOf,
  externalIdOf,
  recordingFilename,
  extensionIndex,
} from './ringcentralMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, '..', 'audio');

const TIMEZONE = 'Asia/Manila';

export type SyncResult = {
  window: { from: string; to: string };
  seen: number;
  ingested: number;
  skipped: Record<string, number>;
  errors: { externalId: string; message: string }[];
};

const bump = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/**
 * Ingest every coachable recording in a window.
 *
 * `dryRun` reports exactly what would be ingested without downloading audio, spending money on
 * transcription, or emailing agents. Use it for the first live run — a misconfigured extension
 * map would otherwise send coaching to the wrong people, which is the one failure mode this
 * tool cannot take back.
 *
 * `sendEmail: false` still transcribes, analyzes and stores, so everything is reviewable in the
 * admin UI, but nobody is emailed. `limit` caps how many calls are ingested, for validating the
 * end-to-end path before committing to a full day of transcription time and spend.
 */
export async function syncRingCentral(
  opts: { since?: Date; until?: Date; dryRun?: boolean; sendEmail?: boolean; limit?: number } = {},
): Promise<SyncResult> {
  if (!ringCentralConfigured()) {
    throw new Error('RingCentral is not configured — see RINGCENTRAL_* in server/.env.example.');
  }

  const until = opts.until ?? new Date();
  const since = opts.since ?? new Date(until.getTime() - 24 * 3600_000);
  const result: SyncResult = {
    window: { from: since.toISOString(), to: until.toISOString() },
    seen: 0,
    ingested: 0,
    skipped: {},
    errors: [],
  };

  const byExtension = extensionIndex(await fetchExtensionsCached());
  const records = await fetchCallLog({ dateFrom: since.toISOString(), dateTo: until.toISOString() });
  result.seen = records.length;

  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  for (const record of records) {
    if (!isCoachable(record)) {
      bump(result.skipped, record.recording?.contentUri ? 'too-short' : 'no-recording');
      continue;
    }

    const externalId = externalIdOf(record);
    if (await hasExternalCall(externalId)) {
      bump(result.skipped, 'already-ingested');
      continue;
    }

    const extId = agentExtensionId(record);
    const extension = extId ? byExtension.get(extId) : undefined;
    if (!extension) {
      // Ring groups, IVR menus and deactivated users land here. Coaching nobody is correct;
      // guessing an agent is not.
      bump(result.skipped, 'unknown-extension');
      continue;
    }

    if (opts.dryRun) {
      console.log(`[rc-sync] would ingest ${externalId} -> ${extension.email} (${record.duration}s)`);
      result.ingested += 1;
      continue;
    }

    if (opts.limit !== undefined && result.ingested >= opts.limit) {
      bump(result.skipped, 'over-limit');
      continue;
    }

    const filename = recordingFilename(record);
    const audioPath = path.join(AUDIO_DIR, filename);

    try {
      await downloadRecording(record.recording!.contentUri, audioPath);
      await uploadRecording(audioPath, filename);
      await processRecording({
        audioPath,
        audioFilename: filename,
        recordedAt: record.startTime,
        source: 'ringcentral',
        direction: directionOf(record),
        agent: toAgent(extension),
        externalId,
        sendEmail: opts.sendEmail,
      });
      // The bucket is the system of record now; the local file was only a staging area for
      // transcription, which needs a real file on disk.
      fs.rmSync(audioPath, { force: true });
      result.ingested += 1;
      console.log(`[rc-sync] ingested ${result.ingested}${opts.limit ? `/${opts.limit}` : ''} — ${extension.email} (${record.duration}s)`);
    } catch (e) {
      // One bad recording must not abort the night's remaining calls.
      const message = (e as Error).message;
      console.error(`[rc-sync] ${externalId} failed: ${message}`);
      result.errors.push({ externalId, message });
      fs.rmSync(audioPath, { force: true });
    }
  }

  return result;
}

/**
 * Nightly at 9pm Manila — after the agents' day has ended, so a full day of calls is coached
 * in one batch and the morning digest is ready before the next shift starts.
 */
export function startRingCentralSyncCron() {
  if (!ringCentralConfigured()) {
    console.log('[rc-sync] RingCentral not configured — nightly sync disabled, manual upload still works.');
    return;
  }

  cron.schedule(
    '0 21 * * *',
    () => {
      syncRingCentral()
        .then((r) => console.log(`[rc-sync] ingested ${r.ingested}/${r.seen}`, r.skipped, r.errors.length ? r.errors : ''))
        .catch((e) => console.error('[rc-sync] failed:', e));
    },
    { timezone: TIMEZONE },
  );

  console.log(`[rc-sync] nightly sync scheduled for 21:00 ${TIMEZONE}`);
}
