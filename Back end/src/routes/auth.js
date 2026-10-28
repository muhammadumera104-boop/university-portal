import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { adminSupabase } from '../supabase.js';
import { authenticate, allowRoles } from '../middleware/auth.js';

export const auth = Router();
export const adminUsers = Router();
const refreshCookie = 'lms_refresh';
const cookieSettings = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};
const authClient = () => createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const passwordSchema = z.string().min(10).regex(/[A-Za-z]/).regex(/[0-9]/);
const accountError = { error: 'Invalid email or password.' };

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || '').trim().toLowerCase()}`,
  message: { error: 'Too many sign-in attempts. Try again later.', code: 'RATE_LIMITED' },
});
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || '').trim().toLowerCase()}`,
  message: { error: 'Too many reset requests. Try again later.', code: 'RATE_LIMITED' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Try again later.', code: 'RATE_LIMITED' },
});
const registrationReceived = { message: 'Thanks! Your registration was received and is waiting for administrator approval. You can sign in once it is approved.' };

// Self-registration creates a pending student account. It cannot sign in or see any course until an admin approves it.
auth.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const parsed = z.object({ fullName: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254), rollNo: z.string().trim().max(50).optional(), password: passwordSchema.max(128) }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Enter your name, a valid email, and a password of at least 10 characters with a letter and a number.' });
    const email = parsed.data.email.toLowerCase();
    const { data, error } = await adminSupabase.auth.admin.createUser({ email, password: parsed.data.password, email_confirm: true, user_metadata: { full_name: parsed.data.fullName } });
    // An existing address gets the same response, so this form cannot be used to discover who has an account.
    if (error) return res.status(202).json(registrationReceived);
    const { error: profileError } = await adminSupabase.from('profiles').update({ full_name: parsed.data.fullName, email, role: 'student', roll_no: parsed.data.rollNo || null, is_active: false, must_change_password: false, registration_status: 'pending' }).eq('id', data.user.id);
    if (profileError) {
      await adminSupabase.auth.admin.deleteUser(data.user.id);
      if (profileError.code === '23505') return res.status(409).json({ error: 'That roll number is already registered.' });
      throw profileError;
    }
    await adminSupabase.from('audit_log').insert({ actor_id: null, action: 'user.registered', entity: 'profile', entity_id: data.user.id });
    res.status(202).json(registrationReceived);
  } catch (error) { next(error); }
});

auth.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) }).safeParse(req.body);
    if (!parsed.success) return res.status(401).json(accountError);
    const client = authClient();
    const { data, error } = await client.auth.signInWithPassword(parsed.data);
    if (error || !data.user || !data.session) return res.status(401).json(accountError);
    const { data: profile, error: profileError } = await adminSupabase.from('profiles').select('id, full_name, email, role, is_active, must_change_password, registration_status').eq('id', data.user.id).single();
    if (profileError || !profile?.is_active) {
      await client.auth.signOut();
      if (profile?.registration_status === 'pending') return res.status(403).json({ error: 'Your registration is waiting for administrator approval. You will be able to sign in once it is approved.', code: 'PENDING_APPROVAL' });
      if (profile?.registration_status === 'rejected') return res.status(403).json({ error: 'Your registration was not approved. Contact an administrator if you think this is a mistake.', code: 'REGISTRATION_REJECTED' });
      return res.status(401).json(accountError);
    }
    res.cookie(refreshCookie, data.session.refresh_token, cookieSettings);
    res.json({ accessToken: data.session.access_token, expiresIn: data.session.expires_in, user: { id: profile.id, email: profile.email, fullName: profile.full_name, role: profile.role, mustChangePassword: profile.must_change_password } });
  } catch (error) { next(error); }
});

auth.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.[refreshCookie];
  if (!refreshToken) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  const client = authClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) {
    res.clearCookie(refreshCookie, { ...cookieSettings, maxAge: undefined });
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  const { data: profile, error: profileError } = await adminSupabase.from('profiles').select('id, full_name, email, role, is_active, must_change_password').eq('id', data.user.id).single();
  if (profileError || !profile?.is_active) {
    res.clearCookie(refreshCookie, { ...cookieSettings, maxAge: undefined });
    return res.status(401).json(accountError);
  }
  res.cookie(refreshCookie, data.session.refresh_token, cookieSettings);
  res.json({ accessToken: data.session.access_token, expiresIn: data.session.expires_in, user: { id: profile.id, email: profile.email, fullName: profile.full_name, role: profile.role, mustChangePassword: profile.must_change_password } });
});

auth.post('/logout', async (req, res) => {
  const token = req.cookies?.[refreshCookie];
  if (token && adminSupabase) {
    try {
      const client = authClient();
      const { data } = await client.auth.refreshSession({ refresh_token: token });
      if (data.session) await client.auth.signOut();
    } catch { /* Always clear the browser session, even if the provider token expired. */ }
  }
  res.clearCookie(refreshCookie, { ...cookieSettings, maxAge: undefined });
  res.status(204).end();
});

auth.post('/forgot-password', forgotLimiter, async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(req.body);
  if (parsed.success && config.supabaseConfigured) {
    try { await authClient().auth.resetPasswordForEmail(parsed.data.email, { redirectTo: config.passwordResetRedirect }); } catch { /* Keep the response neutral for known and unknown addresses. */ }
  }
  res.json({ message: 'If an account exists for that email, password reset instructions are on the way.' });
});

auth.post('/reset-password', async (req, res, next) => {
  try {
    const parsed = z.object({ accessToken: z.string().min(20), newPassword: passwordSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Use at least 10 characters, including one letter and one number.' });
    const { data, error } = await adminSupabase.auth.getUser(parsed.data.accessToken);
    if (error || !data.user) return res.status(401).json({ error: 'This reset link is invalid or expired. Request a new one.' });
    const { error: updateError } = await adminSupabase.auth.admin.updateUserById(data.user.id, { password: parsed.data.newPassword });
    if (updateError) return res.status(422).json({ error: 'The password could not be updated. Request a new reset link.' });
    await adminSupabase.auth.admin.signOut(parsed.data.accessToken, 'global');
    await adminSupabase.from('profiles').update({ must_change_password: false }).eq('id', data.user.id);
    res.json({ message: 'Your password has been updated. Sign in with your new password.' });
  } catch (error) { next(error); }
});

auth.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const parsed = z.object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Use at least 10 characters, including one letter and one number.' });
    const client = authClient();
    const { data: verified, error: verificationError } = await client.auth.signInWithPassword({ email: req.user.email, password: parsed.data.currentPassword });
    if (verificationError || verified.user?.id !== req.user.id) return res.status(401).json({ error: 'Your current password is incorrect.' });
    const { error } = await adminSupabase.auth.admin.updateUserById(req.user.id, { password: parsed.data.newPassword });
    if (error) return res.status(422).json({ error: 'The password could not be updated.' });
    await adminSupabase.auth.admin.signOut(req.accessToken, 'others');
    await adminSupabase.from('profiles').update({ must_change_password: false }).eq('id', req.user.id);
    res.json({ message: 'Password updated. Sign in again with your new password.' });
  } catch (error) { next(error); }
});

const newAccountSchema = z.object({ email: z.string().trim().email().max(254), fullName: z.string().trim().min(2).max(100), role: z.enum(['teacher', 'student']), rollNo: z.string().trim().max(50).optional() });

// Creates one confirmed, active account with a one-time password the person must change at first sign-in.
async function createAccount(details, actorId) {
  const temporaryPassword = randomBytes(18).toString('base64url') + 'A7';
  const email = details.email.toLowerCase();
  const { data, error } = await adminSupabase.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { full_name: details.fullName } });
  if (error) return { ok: false, status: 409, error: 'An account with that email may already exist.' };
  const { data: profile, error: profileError } = await adminSupabase.from('profiles').update({ full_name: details.fullName, email, role: details.role, roll_no: details.rollNo || null, is_active: true, must_change_password: true, registration_status: 'approved' }).eq('id', data.user.id).select('id, full_name, email, role, roll_no, is_active').single();
  if (profileError) {
    // Do not leave a sign-in-capable Auth user behind without a usable profile.
    await adminSupabase.auth.admin.deleteUser(data.user.id);
    if (profileError.code === '23505') return { ok: false, status: 409, error: 'That roll number is already assigned to another account.' };
    throw profileError;
  }
  await adminSupabase.from('audit_log').insert({ actor_id: actorId, action: 'user.created', entity: 'profile', entity_id: data.user.id, details: { role: details.role } });
  return { ok: true, user: profile, temporaryPassword };
}

adminUsers.post('/admin/users', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = newAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the new account details.' });
    const result = await createAccount(parsed.data, req.user.id);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ user: result.user, temporaryPassword: result.temporaryPassword });
  } catch (error) { next(error); }
});

// Bulk import: each row succeeds or fails on its own, so one bad row never blocks the rest.
adminUsers.post('/admin/users/bulk', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = z.object({ users: z.array(z.unknown()).min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Provide between 1 and 100 accounts.' });
    const results = [];
    const seen = new Set();
    for (const row of parsed.data.users) {
      const details = newAccountSchema.safeParse(row);
      if (!details.success) { results.push({ email: row?.email ?? '', ok: false, error: 'Invalid name, email or role.' }); continue; }
      const key = details.data.email.toLowerCase();
      if (seen.has(key)) { results.push({ email: key, ok: false, error: 'Duplicate email in this file.' }); continue; }
      seen.add(key);
      const result = await createAccount(details.data, req.user.id);
      results.push(result.ok ? { email: key, ok: true, fullName: result.user.full_name, role: result.user.role, temporaryPassword: result.temporaryPassword } : { email: key, ok: false, error: result.error });
    }
    res.status(207).json({ results, created: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length });
  } catch (error) { next(error); }
});

adminUsers.patch('/admin/users/:userId/active', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please choose an account status.' });
    if (req.params.userId === req.user.id && !parsed.data.isActive) return res.status(409).json({ error: 'You cannot deactivate your own admin account.' });
    const { data, error } = await adminSupabase.from('profiles').update({ is_active: parsed.data.isActive, ...(parsed.data.isActive ? { registration_status: 'approved' } : {}) }).eq('id', req.params.userId).select('id, full_name, email, role, is_active').single();
    if (error) throw error;
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: parsed.data.isActive ? 'user.activated' : 'user.deactivated', entity: 'profile', entity_id: req.params.userId });
    res.json({ user: data });
  } catch (error) { next(error); }
});

adminUsers.post('/admin/users/:userId/reset-password', allowRoles('admin'), async (req, res, next) => {
  try {
    const { data: profile, error } = await adminSupabase.from('profiles').select('email').eq('id', req.params.userId).single();
    if (error) return res.status(404).json({ error: 'User not found.' });
    await authClient().auth.resetPasswordForEmail(profile.email, { redirectTo: config.passwordResetRedirect });
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'user.password_reset_requested', entity: 'profile', entity_id: req.params.userId });
    res.json({ message: 'Password reset instructions have been sent.' });
  } catch (error) { next(error); }
});

adminUsers.post('/admin/users/:userId/approve', allowRoles('admin'), async (req, res, next) => {
  try {
    const { data, error } = await adminSupabase.from('profiles').update({ is_active: true, registration_status: 'approved' }).eq('id', req.params.userId).eq('registration_status', 'pending').select('id, full_name, email, role, is_active').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No pending registration found for this account.' });
    await adminSupabase.from('notifications').insert({ user_id: data.id, kind: 'registration.approved', title: 'Your registration was approved', body: 'An administrator will enroll you in your courses.' });
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'user.approved', entity: 'profile', entity_id: data.id });
    res.json({ user: data });
  } catch (error) { next(error); }
});

adminUsers.post('/admin/users/:userId/reject', allowRoles('admin'), async (req, res, next) => {
  try {
    const { data, error } = await adminSupabase.from('profiles').update({ is_active: false, registration_status: 'rejected' }).eq('id', req.params.userId).eq('registration_status', 'pending').select('id, full_name, email, role, is_active').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No pending registration found for this account.' });
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'user.rejected', entity: 'profile', entity_id: data.id });
    res.json({ user: data });
  } catch (error) { next(error); }
});
