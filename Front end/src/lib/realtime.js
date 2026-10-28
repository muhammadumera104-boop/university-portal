import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isSupabaseConfigured = Boolean(url && anonKey);
// The browser uses Supabase directly only for Realtime subscriptions; everything else goes through the API.
export const realtimeClient = isSupabaseConfigured ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
