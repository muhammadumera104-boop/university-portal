import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const adminSupabase = config.supabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

export function userSupabase(accessToken) {
  if (!config.supabaseConfigured) return null;
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
