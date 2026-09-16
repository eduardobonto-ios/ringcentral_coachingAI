import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Demo/preview builds bake data into window.__SEED__ and never call Supabase or the API — see
// src/api.ts's isDemo. Everywhere else, these must be set (server/.env has the equivalent
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY pair for the backend).
export const supabaseConfigured = Boolean(url && anonKey);
if (!supabaseConfigured) {
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — sign-in will not work.');
}

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key');
