import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseConfigured = Boolean(url && serviceRoleKey);
if (!supabaseConfigured) {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — every /api route will reject requests.');
}

// Service-role key: bypasses RLS by design. This is the one place in the app allowed to read
// every profile (e.g. to build a department roster for a manager) — never expose this key to the
// frontend or log it.
export const supabaseAdmin = createClient(url || 'https://placeholder.supabase.co', serviceRoleKey || 'placeholder', {
  auth: { autoRefreshToken: false, persistSession: false },
});
