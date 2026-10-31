import 'dotenv/config';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
export const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Largest upload accepted, in bytes. Vercel rejects request bodies above about 4.5 MB, so set MAX_UPLOAD_MB=4 there.
  maxUploadBytes: Math.round(Math.min(Math.max(Number(process.env.MAX_UPLOAD_MB) || 25, 1), 25) * 1024 * 1024),
  passwordResetRedirect: process.env.PASSWORD_RESET_REDIRECT || 'http://localhost:5173/reset-password',
  get supabaseConfigured() { return required.every((key) => Boolean(process.env[key])); },
};
