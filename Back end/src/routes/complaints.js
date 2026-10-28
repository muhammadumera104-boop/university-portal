import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { adminSupabase, userSupabase } from '../supabase.js';
import { allowRoles } from '../middleware/auth.js';
import { isCourseMember } from '../lib/access.js';
import { detectAllowedMime, storagePath } from '../lib/files.js';

export const complaints = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const attachmentExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.txt'];

complaints.post('/complaints', allowRoles('student','teacher'), upload.single('attachment'), async (req, res, next) => {
  let uploadedPath;
  try {
    const parsed = z.object({ category: z.enum(['academic','course','technical','conduct','other']), subject: z.string().trim().min(2).max(160), description: z.string().trim().min(1).max(10000), course_id: z.preprocess((value) => value || null, z.string().uuid().nullable()) }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Please complete the complaint form.' });
    if (parsed.data.course_id && !(await isCourseMember(parsed.data.course_id, req.profile))) return res.status(422).json({ error: 'Choose one of your own courses.' });
    const client = userSupabase(req.accessToken);
    if (req.file) {
      const mimeType = detectAllowedMime(req.file, attachmentExtensions);
      if (!mimeType) return res.status(415).json({ error: 'This attachment type is not supported or does not match its contents.' });
      uploadedPath = storagePath(req.user.id, req.file.originalname);
      const { error } = await client.storage.from('complaints').upload(uploadedPath, req.file.buffer, { contentType: mimeType, upsert: false });
      if (error) throw error;
    }
    const { data, error } = await client.from('complaints').insert({ ...parsed.data, complainant_id: req.user.id, attachment_path: uploadedPath || null }).select().single();
    if (error) {
      if (uploadedPath) await client.storage.from('complaints').remove([uploadedPath]);
      throw error;
    }
    res.status(201).json({ complaint: data });
  } catch (error) { next(error); }
});

complaints.get('/complaints/mine', allowRoles('student','teacher'), async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('complaints').select('id,category,subject,description,status,admin_response,attachment_path,course_id,created_at,updated_at,comments:complaint_comments(id,author_id,body,created_at)').eq('complainant_id', req.user.id).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    res.json({ complaints: data });
  } catch (error) { next(error); }
});

complaints.get('/admin/complaints', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = z.object({ status: z.enum(['open','in_review','resolved','rejected']).optional(), category: z.enum(['academic','course','technical','conduct','other']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the complaint filters.' });
    const start = (parsed.data.page - 1) * parsed.data.pageSize;
    let query = adminSupabase.from('complaints').select('*, complainant:complainant_id(id,full_name,email,role,roll_no), comments:complaint_comments(id,author_id,body,created_at)', { count: 'exact' }).order('created_at', { ascending: false }).range(start, start + parsed.data.pageSize - 1);
    if (parsed.data.status) query = query.eq('status', parsed.data.status);
    if (parsed.data.category) query = query.eq('category', parsed.data.category);
    const { data, count, error } = await query;
    if (error) throw error;
    res.json({ complaints: data, meta: { page: parsed.data.page, pageSize: parsed.data.pageSize, total: count || 0 } });
  } catch (error) { next(error); }
});

complaints.patch('/admin/complaints/:complaintId', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = z.object({ status: z.enum(['in_review','resolved','rejected']), adminResponse: z.string().trim().max(5000).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Choose a valid status and response.' });
    if (['resolved','rejected'].includes(parsed.data.status) && !parsed.data.adminResponse?.trim()) return res.status(422).json({ error: 'A response is required to close a complaint.' });
    const { data: previous, error: lookupError } = await adminSupabase.from('complaints').select('id,status,complainant_id').eq('id', req.params.complaintId).maybeSingle();
    if (lookupError || !previous) return res.status(404).json({ error: 'Complaint not found.' });
    const allowed = { open: ['in_review'], in_review: ['resolved','rejected'], resolved: [], rejected: [] };
    if (!allowed[previous.status].includes(parsed.data.status)) return res.status(409).json({ error: 'This complaint cannot move to that status.' });
    const { data, error } = await adminSupabase.from('complaints').update({ status: parsed.data.status, admin_response: parsed.data.adminResponse || null, resolved_by: req.user.id, resolved_at: ['resolved','rejected'].includes(parsed.data.status) ? new Date().toISOString() : null }).eq('id', previous.id).select().single();
    if (error) throw error;
    await adminSupabase.from('notifications').insert({ user_id: previous.complainant_id, kind: 'complaint.status', title: 'Your complaint was updated', body: parsed.data.adminResponse || `Status changed to ${parsed.data.status.replace('_',' ')}.`, entity_id: previous.id });
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'complaint.status_changed', entity: 'complaint', entity_id: previous.id, details: { from: previous.status, to: data.status } });
    res.json({ complaint: data });
  } catch (error) { next(error); }
});

complaints.post('/complaints/:complaintId/comments', allowRoles('student','teacher'), async (req, res, next) => {
  try {
    const parsed = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'A comment is required.' });
    const { count, error: countError } = await adminSupabase.from('complaint_comments').select('id', { count: 'exact', head: true }).eq('complaint_id', req.params.complaintId).eq('author_id', req.user.id);
    if (countError) throw countError;
    if (count) return res.status(409).json({ error: 'Only one follow-up comment is allowed.' });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('complaint_comments').insert({ complaint_id: req.params.complaintId, author_id: req.user.id, body: parsed.data.body }).select().single();
    if (error) return res.status(404).json({ error: 'Complaint not found.' });
    res.status(201).json({ comment: data });
  } catch (error) { next(error); }
});

complaints.get('/complaints/:complaintId/attachment', async (req, res, next) => {
  try {
    const { data: complaint, error } = await adminSupabase.from('complaints').select('complainant_id,attachment_path').eq('id', req.params.complaintId).maybeSingle();
    if (error || !complaint?.attachment_path) return res.status(404).json({ error: 'Attachment not found.' });
    if (complaint.complainant_id !== req.user.id && req.profile.role !== 'admin') return res.status(404).json({ error: 'Attachment not found.' });
    const { data, error: signedError } = await adminSupabase.storage.from('complaints').createSignedUrl(complaint.attachment_path, 60);
    if (signedError) throw signedError;
    res.json({ url: data.signedUrl, expiresIn: 60 });
  } catch (error) { next(error); }
});
