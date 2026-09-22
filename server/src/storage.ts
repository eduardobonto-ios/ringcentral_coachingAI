// Call recordings in Supabase Storage.
//
// Audio used to be written to server/audio/ and served by express.static behind a signed token
// (audioToken.ts). That tied playback to whichever machine ran the sync, which is the other half
// of what made hosting impossible. Objects now live in the private "call-recordings" bucket and
// are handed to the browser as short-lived signed URLs — the same security model, minus the
// filesystem.
import fs from 'node:fs';
import { supabaseAdmin, supabaseConfigured } from './supabaseClient.js';

export const RECORDINGS_BUCKET = 'call-recordings';

/** Playback links outlive a page view but not a session; long enough to scrub a 15-minute call. */
const SIGNED_URL_TTL_SEC = 60 * 60;

export async function uploadRecording(localPath: string, objectKey: string): Promise<void> {
  if (!supabaseConfigured) throw new Error('Supabase is not configured — cannot store recordings.');

  const { error } = await supabaseAdmin.storage
    .from(RECORDINGS_BUCKET)
    .upload(objectKey, fs.readFileSync(localPath), { contentType: 'audio/mpeg', upsert: true });

  if (error) throw new Error(`recording upload failed for ${objectKey}: ${error.message}`);
}

/**
 * A time-limited URL for one recording, or null if it cannot be signed.
 *
 * Returns null rather than throwing: a call whose audio is missing should still show its
 * transcript and coaching, with the player simply unavailable.
 */
export async function signedRecordingUrl(objectKey: string): Promise<string | null> {
  if (!supabaseConfigured || !objectKey) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(RECORDINGS_BUCKET)
    .createSignedUrl(objectKey, SIGNED_URL_TTL_SEC);

  if (error) {
    console.warn(`[storage] could not sign ${objectKey}: ${error.message}`);
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function recordingExists(objectKey: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { data } = await supabaseAdmin.storage.from(RECORDINGS_BUCKET).list('', { search: objectKey });
  return Boolean(data?.some((f) => f.name === objectKey));
}
