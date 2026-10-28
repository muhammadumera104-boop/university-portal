import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { userSupabase } from '../supabase.js';
import { allowRoles } from '../middleware/auth.js';
import { canManageCourse, isCourseMember } from '../lib/access.js';
import { detectAllowedMime, safeFileName, storagePath } from '../lib/files.js';

export const resources = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const resourceExtensions = ['.pdf', '.docx', '.pptx', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

resources.post('/courses/:courseId/resources', allowRoles('admin', 'teacher'), upload.single('file'), async (req, res, next) => {
  try {
    const parsed = z.object({ title: z.string().trim().min(2).max(160), description: z.string().max(2000).default('') }).safeParse(req.body);
    if (!parsed.success || !req.file) return res.status(400).json({ error: 'Add a title and a supported file.' });
    if (!(await canManageCourse(req.params.courseId, req.profile))) return res.status(403).json({ error: 'You can only upload resources to courses you teach.' });
    const mimeType = detectAllowedMime(req.file, resourceExtensions);
    if (!mimeType) return res.status(415).json({ error: 'This file type is not supported or does not match its contents.' });
    const client = userSupabase(req.accessToken);
    const filePath = storagePath(req.params.courseId, req.file.originalname);
    const { error: uploadError } = await client.storage.from('resources').upload(filePath, req.file.buffer, { contentType: mimeType, upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await client.from('resources').insert({ ...parsed.data, course_id: req.params.courseId, uploaded_by: req.user.id, file_path: filePath, file_name: safeFileName(req.file.originalname), mime_type: mimeType, size_bytes: req.file.size }).select().single();
    if (error) {
      await client.storage.from('resources').remove([filePath]);
      throw error;
    }
    const { data: signed } = await client.storage.from('resources').createSignedUrl(filePath, 60);
    res.status(201).json({ resource: { ...data, downloadUrl: signed?.signedUrl } });
  } catch (error) { next(error); }
});

resources.get('/courses/:courseId/resources', async (req, res, next) => {
  try {
    const parsed = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().max(100).optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the resource filters.' });
    if (!(await isCourseMember(req.params.courseId, req.profile))) return res.status(403).json({ error: 'You are not a member of this course.' });
    const client = userSupabase(req.accessToken);
    const from = (parsed.data.page - 1) * parsed.data.pageSize;
    let query = client.from('resources').select('id,title,description,file_path,file_name,mime_type,size_bytes,created_at,uploaded_by', { count: 'exact' }).eq('course_id', req.params.courseId).order('created_at', { ascending: false }).range(from, from + parsed.data.pageSize - 1);
    if (parsed.data.search) query = query.ilike('title', `%${parsed.data.search}%`);
    const { data, count, error } = await query;
    if (error) throw error;
    const signedResources = await Promise.all(data.map(async (resource) => {
      const { data: signed } = await client.storage.from('resources').createSignedUrl(resource.file_path, 60);
      return { ...resource, downloadUrl: signed?.signedUrl };
    }));
    res.json({ resources: signedResources, meta: { page: parsed.data.page, pageSize: parsed.data.pageSize, total: count || 0 } });
  } catch (error) { next(error); }
});

resources.get('/resources/:resourceId/download', async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    const { data: resource, error } = await client.from('resources').select('file_path').eq('id', req.params.resourceId).maybeSingle();
    if (error || !resource) return res.status(404).json({ error: 'Resource not found.' });
    const { data, error: urlError } = await client.storage.from('resources').createSignedUrl(resource.file_path, 60);
    if (urlError) return res.status(404).json({ error: 'Resource not found.' });
    res.json({ url: data.signedUrl, expiresIn: 60 });
  } catch (error) { next(error); }
});

resources.delete('/resources/:resourceId', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    // Delete the row first: RLS limits this to the uploader (or an admin), so a co-teacher cannot orphan another teacher's file.
    const { data: removed, error } = await client.from('resources').delete().eq('id', req.params.resourceId).select('id,file_path');
    if (error) throw error;
    if (!removed.length) return res.status(404).json({ error: 'Resource not found, or you did not upload it.' });
    const { error: storageError } = await client.storage.from('resources').remove([removed[0].file_path]);
    if (storageError) throw storageError;
    res.status(204).end();
  } catch (error) { next(error); }
});
