// Pure mapping between RingCentral call-log records and this app's domain types.
//
// Deliberately free of I/O and of ./db — so it can be unit-tested against fixtures with no
// RingCentral credentials and no sqlite file. That matters: this logic had to be written
// before we had API access, so fixtures are the only way it gets exercised.
import type { RcCallRecord, RcExtension } from './ringcentral.js';
import type { Agent } from './pipeline.js';

/**
 * Calls shorter than this are transfers, voicemail drops, misdials and quick lookups — there is
 * no conversation in them to coach.
 *
 * Set to 90s from the real distribution measured 2026-09-23 over 110 calls: 18% ran under 60s,
 * 31% under 90s, median 155s. At the old 30s floor a 40-second call came back scored
 * "needs-intervention" with zero strengths, because the model had nothing to work with and
 * judged the silence. Feedback like that is exactly what this tool is meant not to produce, and
 * those calls also drag the daily trend down for everyone.
 */
export const MIN_COACHABLE_SEC = 90;

const idOf = (v: string | number | undefined | null): string | null =>
  v === undefined || v === null || String(v).length === 0 ? null : String(v);

/**
 * Which extension belongs to the agent on this call.
 *
 * Verified against live ValveMan data 2026-09-23, and it differs by direction:
 *
 * - **Outbound** carries a top-level `extension`, and `from.extensionId` as well.
 * - **Inbound** carries *neither* — `to` holds only the dialled phone number. The answering
 *   agent appears in `legs[]`: the first leg is the ring group and has no extension, and the
 *   leg where someone actually picked up carries `extension.id`. Reading only the top level
 *   silently dropped every inbound call, which is a third of the recorded volume.
 *
 * On a transfer, several legs carry extensions; the first accepted one is the agent who took
 * the call, which is who the coaching is about.
 */
export function agentExtensionId(record: RcCallRecord): string | null {
  const own = idOf(record.extension?.id);
  if (own) return own;

  const side = record.direction === 'Outbound' ? record.from : record.to;
  const sideId = idOf(side?.extensionId);
  if (sideId) return sideId;

  const legs = record.legs ?? [];
  const accepted = legs.find((l) => l.legType === 'Accept' && idOf(l.extension?.id));
  if (accepted) return idOf(accepted.extension?.id);

  const anyLeg = legs.find((l) => idOf(l.extension?.id));
  return anyLeg ? idOf(anyLeg.extension?.id) : null;
}

/** A call we can actually coach: real voice call, has recorded audio, long enough to have content. */
export function isCoachable(record: RcCallRecord): boolean {
  if (!record.recording?.contentUri) return false;
  if (record.type && record.type !== 'Voice') return false;
  return (record.duration ?? 0) >= MIN_COACHABLE_SEC;
}

export function toAgent(ext: RcExtension): Agent {
  return {
    id: ext.id,
    name: ext.name,
    email: ext.email,
    // The pipeline puts this in the coaching prompt, so a sensible default beats an empty string.
    role: ext.jobTitle || 'Customer Service Rep',
  };
}

export function directionOf(record: RcCallRecord): 'inbound' | 'outbound' | 'unknown' {
  if (record.direction === 'Inbound') return 'inbound';
  if (record.direction === 'Outbound') return 'outbound';
  return 'unknown';
}

/**
 * Stable per-recording key used to avoid re-ingesting a call on the next sync.
 * Keyed on the recording, not the call: a single call log entry keeps one recording, but
 * record.id churns across call-log views while recording.id does not.
 */
export function externalIdOf(record: RcCallRecord): string {
  return `rc:${record.recording?.id ?? record.id}`;
}

/** Local filename for a downloaded recording. RC serves MP3 for automatic recordings. */
export function recordingFilename(record: RcCallRecord): string {
  const stamp = new Date(record.startTime).toISOString().replace(/[:.]/g, '-');
  return `rc-${record.recording?.id ?? record.id}-${stamp}.mp3`;
}

/** Index extensions by id for O(1) attribution while walking the call log. */
export function extensionIndex(extensions: RcExtension[]): Map<string, RcExtension> {
  return new Map(extensions.map((e) => [e.id, e]));
}
