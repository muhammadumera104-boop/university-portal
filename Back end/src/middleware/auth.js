import { adminSupabase } from '../supabase.js';

export async function authenticate(req, res, next) {
  if (!adminSupabase) return res.status(503).json({ error: 'Supabase is not configured yet.' });
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'A valid session is required.' });
  const { data, error } = await adminSupabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid or expired.' });
  const { data: profile, error: profileError } = await adminSupabase.from('profiles').select('id, role, is_active, must_change_password').eq('id', data.user.id).single();
  if (profileError || !profile || !profile.is_active) return res.status(401).json({ error: 'Invalid email or password.' });
  if (profile.must_change_password && !req.path.endsWith('/change-password')) return res.status(403).json({ error: 'You must change your temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
  req.user = data.user;
  req.profile = profile;
  req.accessToken = token;
  next();
}

export function allowRoles(...roles) {
  return async (req, res, next) => {
    if (!roles.includes(req.profile.role)) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}
