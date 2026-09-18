import crypto from 'node:crypto';

// Recordings must stay behind the same RBAC as /api, but the native <audio> element can't send
// an Authorization header. So /api/calls/:id issues a short-lived signed URL (checked here) instead
// of exposing /audio as an open static mount.
const SECRET = process.env.AUDIO_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
const TTL_MS = 6 * 60 * 60 * 1000;

// Same fail-closed convention as supabaseConfigured (supabaseClient.ts): warn once at startup
// instead of throwing mid-request, and every /audio request gets a clean 401 until it's set.
export const audioTokenConfigured = Boolean(SECRET);
if (!audioTokenConfigured) {
  console.warn('AUDIO_TOKEN_SECRET / SUPABASE_SERVICE_ROLE_KEY are not set — every /audio request will be rejected.');
}

function sign(filename: string, expiresAt: number): string {
  return crypto.createHmac('sha256', SECRET || 'unconfigured').update(`${filename}.${expiresAt}`).digest('hex');
}

export function signedAudioUrl(filename: string): string {
  const expiresAt = Date.now() + TTL_MS;
  return `/audio/${encodeURIComponent(filename)}?exp=${expiresAt}&sig=${sign(filename, expiresAt)}`;
}

export function verifyAudioToken(filename: string, exp: unknown, sig: unknown): boolean {
  if (!audioTokenConfigured) return false;
  if (typeof exp !== 'string' || typeof sig !== 'string') return false;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = Buffer.from(sign(filename, expiresAt));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
