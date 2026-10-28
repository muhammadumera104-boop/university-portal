import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { adminSupabase, userSupabase } from '../supabase.js';
import { canManageCourse, isCourseMember } from '../lib/access.js';
import { allowRoles } from '../middleware/auth.js';

export const chat = Router();
const sendLimit = rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: (req) => req.user.id, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'You are sending messages too quickly. Please wait a moment.' } });


chat.get('/courses/:courseId/messages', async (req, res, next) => {
  try {
    const parsed = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the message page.' });
    if (!(await isCourseMember(req.params.courseId, req.profile))) return res.status(404).json({ error: 'Course not found.' });
    let query = adminSupabase.from('chat_messages').select('id,course_id,sender_id,body,created_at,updated_at,deleted_at,profiles:sender_id(full_name,role)').eq('course_id', req.params.courseId).order('created_at', { ascending: false }).limit(parsed.data.limit);
    if (parsed.data.before) query = query.lt('created_at', parsed.data.before);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ messages: data.reverse().map((message) => message.deleted_at ? { ...message, body: '', isDeleted: true } : { ...message, isDeleted: false }), nextBefore: data.length ? data[0].created_at : null });
  } catch (error) { next(error); }
});

chat.post('/courses/:courseId/messages', allowRoles('teacher', 'student'), sendLimit, async (req, res, next) => {
  try {
    const parsed = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Messages must be between 1 and 2,000 characters.' });
    if (!(await isCourseMember(req.params.courseId, req.profile))) return res.status(404).json({ error: 'Course not found.' });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('chat_messages').insert({ course_id: req.params.courseId, sender_id: req.user.id, body: parsed.data.body }).select().single();
    if (error) throw error;
    res.status(201).json({ message: data });
  } catch (error) { next(error); }
});

chat.delete('/messages/:messageId', async (req, res, next) => {
  try {
    const { data: message, error } = await adminSupabase.from('chat_messages').select('id,course_id,sender_id,created_at,deleted_at').eq('id', req.params.messageId).maybeSingle();
    if (error || !message) return res.status(404).json({ error: 'Message not found.' });
    const isOwner = message.sender_id === req.user.id;
    const withinWindow = Date.now() - new Date(message.created_at).getTime() <= 5 * 60 * 1000;
    const isStaff = await canManageCourse(message.course_id, req.profile);
    if (!(isStaff || (isOwner && withinWindow))) return res.status(404).json({ error: 'Message not found.' });
    if (!message.deleted_at) {
      const { error: updateError } = await adminSupabase.from('chat_messages').update({ body: '', deleted_at: new Date().toISOString() }).eq('id', message.id);
      if (updateError) throw updateError;
    }
    res.status(204).end();
  } catch (error) { next(error); }
});
