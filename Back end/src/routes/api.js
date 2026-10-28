import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { adminSupabase, userSupabase } from '../supabase.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { canManageCourse, isEnrolled, teachesCourse } from '../lib/access.js';
import { detectAllowedMime, storagePath } from '../lib/files.js';
import { adminUsers } from './auth.js';
import { resources } from './resources.js';
import { chat } from './chat.js';
import { complaints } from './complaints.js';
import { quizzes as quizRoutes } from './quizzes.js';
import { notifications } from './notifications.js';

export const api = Router();
api.get('/health', (_req, res) => res.json({ status: 'ok', supabaseConfigured: Boolean(adminSupabase) }));
api.use(authenticate);
api.use(adminUsers);
api.use(resources);
api.use(chat);
api.use(complaints);
api.use(quizRoutes);
api.use(notifications);

const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) });
const byPosition = (a, b) => a.position - b.position;
const submissionUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const submissionExtensions = ['.pdf', '.docx', '.pptx', '.zip', '.png', '.jpg', '.jpeg', '.txt'];

async function profileNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await adminSupabase.from('profiles').select('id,full_name,role').in('id', unique);
  if (error) throw error;
  return new Map(data.map((profile) => [profile.id, profile]));
}

api.get('/me', async (req, res, next) => {
  try {
    const { data, error } = await adminSupabase.from('profiles').select('*').eq('id', req.user.id).single();
    if (error) throw error;
    res.json({ profile: data });
  } catch (error) { next(error); }
});

// Simple role-visible lists. RLS decides which rows each user receives.
const tables = {
  assignments: { order: 'due_at', select: '*, course:courses(title), submissions(id,student_id,status,submitted_at,marks_obtained,feedback,is_late,text_answer,file_path)' },
  enrollments: { order: 'enrolled_at', select: '*' },
  quizzes: { order: 'created_at', select: '*' },
};
for (const [table, policy] of Object.entries(tables)) {
  api.get(`/${table}`, async (req, res, next) => {
    try {
      const pagination = paginationSchema.safeParse(req.query);
      if (!pagination.success) return res.status(400).json({ error: 'Please check the page filters.' });
      const client = userSupabase(req.accessToken);
      const start = (pagination.data.page - 1) * pagination.data.pageSize;
      const { data, count, error } = await client.from(table).select(policy.select, { count: 'exact' }).order(policy.order, { ascending: table === 'assignments' }).range(start, start + pagination.data.pageSize - 1);
      if (error) throw error;
      // Students can be enrolled in a course that is not yet published; hide its work until the course is visible.
      const rows = table === 'assignments'
        ? data.filter((row) => req.profile.role !== 'student' || row.course).map((row) => ({ ...row, my_submission: row.submissions?.find((submission) => submission.student_id === req.user.id) || null }))
        : data;
      res.json({ [table]: rows, meta: { page: pagination.data.page, pageSize: pagination.data.pageSize, total: count || 0 } });
    } catch (error) { next(error); }
  });
}

// Courses
api.get('/courses', async (req, res, next) => {
  try {
    const parsed = paginationSchema.extend({ includeArchived: z.enum(['true', 'false']).default('false') }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the course filters.' });
    const client = userSupabase(req.accessToken);
    const start = (parsed.data.page - 1) * parsed.data.pageSize;
    let query = client.from('courses').select('*, course_modules(id, lessons(id))', { count: 'exact' }).order('created_at', { ascending: false }).range(start, start + parsed.data.pageSize - 1);
    if (!(req.profile.role === 'admin' && parsed.data.includeArchived === 'true')) query = query.eq('is_archived', false);
    const { data, count, error } = await query;
    if (error) throw error;
    const ids = data.map((course) => course.id);
    const isStudent = req.profile.role === 'student';
    const [teachers, enrollments, progress] = await Promise.all([
      ids.length ? adminSupabase.from('course_teachers').select('course_id, teacher:teacher_id(full_name)').in('course_id', ids) : { data: [] },
      ids.length && !isStudent ? adminSupabase.from('enrollments').select('course_id').in('course_id', ids).limit(10000) : { data: [] },
      ids.length && isStudent ? adminSupabase.from('lesson_progress').select('lesson_id').eq('student_id', req.user.id).limit(10000) : { data: [] },
    ]);
    const failed = [teachers, enrollments, progress].find((result) => result.error);
    if (failed) throw failed.error;
    const completed = new Set(progress.data.map((row) => row.lesson_id));
    const courses = data.map(({ course_modules: modules, ...course }) => {
      const lessonIds = modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));
      const done = lessonIds.filter((id) => completed.has(id)).length;
      return {
        ...course,
        module_count: modules.length,
        lesson_count: lessonIds.length,
        teachers: teachers.data.filter((row) => row.course_id === course.id).map((row) => row.teacher?.full_name).filter(Boolean),
        student_count: isStudent ? null : enrollments.data.filter((row) => row.course_id === course.id).length,
        progress: isStudent ? (lessonIds.length ? Math.round(done / lessonIds.length * 100) : 0) : null,
      };
    });
    res.json({ courses, meta: { page: parsed.data.page, pageSize: parsed.data.pageSize, total: count || 0 } });
  } catch (error) { next(error); }
});

const courseSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9-]{2,24}$/).optional(), title: z.string().trim().min(2).max(120), description: z.string().max(2000).default(''), category: z.string().trim().min(1).max(80).default('General'), status: z.enum(['draft', 'published']).default('draft'), cover_color: z.enum(['violet', 'mint', 'coral', 'sand']).default('violet') });
api.post('/courses', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = courseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the course details.', details: parsed.error.flatten() });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('courses').insert({ ...parsed.data, instructor_id: req.user.id }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A course with that code already exists.' });
      throw error;
    }
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'course.created', entity: 'course', entity_id: data.id });
    res.status(201).json({ course: data });
  } catch (error) { next(error); }
});

api.get('/courses/:courseId', async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('courses').select('*, course_modules(*, lessons(*))').eq('id', req.params.courseId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Course not found, or you do not have access to it.' });
    const [{ data: teacherRows, error: teacherError }, progress] = await Promise.all([
      adminSupabase.from('course_teachers').select('teacher:teacher_id(id,full_name)').eq('course_id', data.id),
      req.profile.role === 'student' ? adminSupabase.from('lesson_progress').select('lesson_id').eq('student_id', req.user.id).limit(10000) : { data: [] },
    ]);
    if (teacherError || progress.error) throw teacherError || progress.error;
    const modules = data.course_modules.sort(byPosition).map((module) => ({ ...module, lessons: module.lessons.sort(byPosition) }));
    res.json({ course: { ...data, course_modules: modules, teachers: teacherRows.map((row) => row.teacher).filter(Boolean), completed_lesson_ids: progress.data.map((row) => row.lesson_id) } });
  } catch (error) { next(error); }
});

api.get('/me/courses', async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    if (req.profile.role === 'admin') {
      const { data, error } = await client.from('courses').select('*').eq('is_archived', false).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return res.json({ courses: data });
    }
    const relation = req.profile.role === 'teacher' ? 'course_teachers' : 'enrollments';
    const key = req.profile.role === 'teacher' ? 'teacher_id' : 'student_id';
    const { data, error } = await client.from(relation).select('course:courses(*)').eq(key, req.user.id).limit(100);
    if (error) throw error;
    res.json({ courses: data.map((item) => item.course).filter((course) => course && !course.is_archived) });
  } catch (error) { next(error); }
});

api.patch('/courses/:courseId', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = courseSchema.extend({ status: z.enum(['draft', 'published', 'archived']) }).partial().strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the course details.' });
    const changes = { ...parsed.data, ...(parsed.data.status ? { is_archived: parsed.data.status === 'archived' } : {}) };
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('courses').update(changes).eq('id', req.params.courseId).select().single();
    if (error) throw error;
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'course.updated', entity: 'course', entity_id: data.id, details: changes });
    res.json({ course: data });
  } catch (error) { next(error); }
});

api.delete('/courses/:courseId', allowRoles('admin'), async (req, res, next) => {
  try {
    // Courses are archived, never hard-deleted, so marks and submissions remain available.
    const client = userSupabase(req.accessToken);
    const { error } = await client.from('courses').update({ status: 'archived', is_archived: true }).eq('id', req.params.courseId).select('id').single();
    if (error) throw error;
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'course.archived', entity: 'course', entity_id: req.params.courseId });
    res.status(204).end();
  } catch (error) { next(error); }
});

api.get('/admin/courses/:courseId/teachers', allowRoles('admin'), async (req, res, next) => {
  try {
    const { data, error } = await adminSupabase.from('course_teachers').select('teacher:teacher_id(id,full_name,email,role)').eq('course_id', req.params.courseId);
    if (error) throw error;
    res.json({ teachers: data.map((row) => row.teacher) });
  } catch (error) { next(error); }
});

api.get('/admin/courses/:courseId/enrollments', allowRoles('admin'), async (req, res, next) => {
  try {
    const { data, error } = await adminSupabase.from('enrollments').select('enrolled_at,student:profiles(id,full_name,email,roll_no,role)').eq('course_id', req.params.courseId).order('enrolled_at', { ascending: false }).limit(500);
    if (error) throw error;
    res.json({ students: data.map((row) => row.student) });
  } catch (error) { next(error); }
});

api.put('/admin/courses/:courseId/teachers', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = z.object({ teacherIds: z.array(z.string().uuid()).max(100) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please provide a valid teacher list.' });
    const teacherIds = [...new Set(parsed.data.teacherIds)];
    if (teacherIds.length) {
      const { data: teachers, error: lookupError } = await adminSupabase.from('profiles').select('id,role,is_active').in('id', teacherIds);
      if (lookupError) throw lookupError;
      if (teachers.length !== teacherIds.length || teachers.some((user) => user.role !== 'teacher' || !user.is_active)) return res.status(422).json({ error: 'Every selected account must be an active teacher.' });
    }
    const { error: deleteError } = await adminSupabase.from('course_teachers').delete().eq('course_id', req.params.courseId);
    if (deleteError) throw deleteError;
    if (teacherIds.length) {
      const { error } = await adminSupabase.from('course_teachers').insert(teacherIds.map((teacher_id) => ({ course_id: req.params.courseId, teacher_id })));
      if (error) throw error;
    }
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'course.teachers_replaced', entity: 'course', entity_id: req.params.courseId, details: { teacherIds } });
    res.json({ teacherIds });
  } catch (error) { next(error); }
});

api.post('/admin/courses/:courseId/enrollments', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = z.object({ studentIds: z.array(z.string().uuid()).max(500).optional(), studentEmails: z.array(z.string().trim().email().max(254)).max(500).optional() }).refine((data) => data.studentIds?.length || data.studentEmails?.length).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Provide student IDs or valid email addresses.' });
    const { data: course } = await adminSupabase.from('courses').select('id').eq('id', req.params.courseId).maybeSingle();
    if (!course) return res.status(404).json({ error: 'Course not found.' });
    let matchedIds = [...new Set(parsed.data.studentIds || [])];
    const requestedEmails = [...new Set((parsed.data.studentEmails || []).map((email) => email.toLowerCase()))];
    let unmatchedEmails = [];
    if (requestedEmails.length) {
      const { data: profiles, error } = await adminSupabase.from('profiles').select('id,email,role').in('email', requestedEmails);
      if (error) throw error;
      const students = profiles.filter((profile) => profile.role === 'student');
      matchedIds.push(...students.map((profile) => profile.id));
      const found = new Set(students.map((profile) => profile.email.toLowerCase()));
      unmatchedEmails = requestedEmails.filter((email) => !found.has(email));
    }
    matchedIds = [...new Set(matchedIds)];
    let duplicates = [];
    if (matchedIds.length) {
      const { data: students, error } = await adminSupabase.from('profiles').select('id,role').in('id', matchedIds);
      if (error) throw error;
      if (students.length !== matchedIds.length || students.some((student) => student.role !== 'student')) return res.status(422).json({ error: 'All selected accounts must be students.' });
      const { data: existing, error: existingError } = await adminSupabase.from('enrollments').select('student_id').eq('course_id', course.id).in('student_id', matchedIds);
      if (existingError) throw existingError;
      duplicates = existing.map((row) => row.student_id);
      const { error: enrollmentError } = await adminSupabase.from('enrollments').upsert(matchedIds.map((student_id) => ({ course_id: course.id, student_id })), { onConflict: 'course_id,student_id', ignoreDuplicates: true });
      if (enrollmentError) throw enrollmentError;
    }
    const added = matchedIds.filter((id) => !duplicates.includes(id));
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'course.students_enrolled', entity: 'course', entity_id: course.id, details: { added: added.length, duplicates: duplicates.length } });
    res.status(201).json({ matched: added, duplicates, unmatchedEmails });
  } catch (error) { next(error); }
});

api.delete('/admin/courses/:courseId/enrollments/:studentId', allowRoles('admin'), async (req, res, next) => {
  try {
    const { error } = await adminSupabase.from('enrollments').delete().eq('course_id', req.params.courseId).eq('student_id', req.params.studentId);
    if (error) throw error;
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'course.student_unenrolled', entity: 'course', entity_id: req.params.courseId, details: { studentId: req.params.studentId } });
    res.status(204).end();
  } catch (error) { next(error); }
});

// Modules and lessons
async function nextPosition(client, table, column, value) {
  const { data, error } = await client.from(table).select('position').eq(column, value).order('position', { ascending: false }).limit(1);
  if (error) throw error;
  return data.length ? data[0].position + 1 : 0;
}

const moduleSchema = z.object({ title: z.string().trim().min(2).max(160), description: z.string().max(2000).default('') });
api.post('/courses/:courseId/modules', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const parsed = moduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the module details.' });
    if (!(await canManageCourse(req.params.courseId, req.profile))) return res.status(403).json({ error: 'You can only edit courses you teach.' });
    const client = userSupabase(req.accessToken);
    const position = await nextPosition(client, 'course_modules', 'course_id', req.params.courseId);
    const { data, error } = await client.from('course_modules').insert({ ...parsed.data, position, course_id: req.params.courseId }).select().single();
    if (error) throw error;
    res.status(201).json({ module: { ...data, lessons: [] } });
  } catch (error) { next(error); }
});

api.patch('/modules/:moduleId', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const parsed = moduleSchema.partial().strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the module details.' });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('course_modules').update(parsed.data).eq('id', req.params.moduleId).select().single();
    if (error) throw error;
    res.json({ module: data });
  } catch (error) { next(error); }
});

api.delete('/modules/:moduleId', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('course_modules').delete().eq('id', req.params.moduleId).select('id,course_id');
    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Module not found.' });
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'module.deleted', entity: 'course_module', entity_id: data[0].id, details: { courseId: data[0].course_id } });
    res.status(204).end();
  } catch (error) { next(error); }
});

const lessonSchema = z.object({ title: z.string().trim().min(2).max(160), content: z.object({ body: z.string().max(20000).default(''), url: z.union([z.string().trim().url().max(500), z.literal('')]).default('') }).default({ body: '', url: '' }), duration_minutes: z.number().int().min(0).max(1440).default(0) });
api.post('/modules/:moduleId/lessons', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const parsed = lessonSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the lesson details.' });
    const client = userSupabase(req.accessToken);
    const position = await nextPosition(client, 'lessons', 'module_id', req.params.moduleId);
    const { data, error } = await client.from('lessons').insert({ ...parsed.data, position, module_id: req.params.moduleId }).select().single();
    if (error) throw error;
    res.status(201).json({ lesson: data });
  } catch (error) { next(error); }
});

api.patch('/lessons/:lessonId', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const parsed = lessonSchema.partial().strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the lesson details.' });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('lessons').update(parsed.data).eq('id', req.params.lessonId).select().single();
    if (error) throw error;
    res.json({ lesson: data });
  } catch (error) { next(error); }
});

api.delete('/lessons/:lessonId', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('lessons').delete().eq('id', req.params.lessonId).select('id');
    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Lesson not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
});

async function lessonCourse(lessonId) {
  const { data } = await adminSupabase.from('lessons').select('id, module:course_modules(course_id)').eq('id', lessonId).maybeSingle();
  return data?.module?.course_id || null;
}

api.post('/lessons/:lessonId/complete', allowRoles('student'), async (req, res, next) => {
  try {
    const courseId = await lessonCourse(req.params.lessonId);
    if (!courseId || !(await isEnrolled(courseId, req.user.id))) return res.status(404).json({ error: 'Lesson not found.' });
    const { error } = await adminSupabase.from('lesson_progress').upsert({ lesson_id: req.params.lessonId, student_id: req.user.id }, { onConflict: 'lesson_id,student_id', ignoreDuplicates: true });
    if (error) throw error;
    res.status(201).json({ completed: true });
  } catch (error) { next(error); }
});

api.delete('/lessons/:lessonId/complete', allowRoles('student'), async (req, res, next) => {
  try {
    const { error } = await adminSupabase.from('lesson_progress').delete().eq('lesson_id', req.params.lessonId).eq('student_id', req.user.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) { next(error); }
});

// Assignments and submissions
const assignmentSchema = z.object({ title: z.string().trim().min(2).max(160), instructions: z.string().max(10000).default(''), due_at: z.string().datetime(), max_marks: z.number().min(0.01).max(9999).default(100), allow_late: z.boolean().default(false) });
api.post('/courses/:courseId/assignments', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const parsed = assignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the assignment details.' });
    if (!(await canManageCourse(req.params.courseId, req.profile))) return res.status(403).json({ error: 'You can only add assignments to courses you teach.' });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('assignments').insert({ ...parsed.data, course_id: req.params.courseId, created_by: req.user.id }).select().single();
    if (error) throw error;
    res.status(201).json({ assignment: data });
  } catch (error) { next(error); }
});

api.get('/courses/:courseId/assignments', async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('assignments').select('*, submissions(id,student_id,status,submitted_at,marks_obtained,feedback,is_late,text_answer,file_path)').eq('course_id', req.params.courseId).order('due_at').limit(100);
    if (error) throw error;
    res.json({ assignments: data.map((row) => ({ ...row, my_submission: row.submissions?.find((submission) => submission.student_id === req.user.id) || null })) });
  } catch (error) { next(error); }
});

api.patch('/assignments/:assignmentId', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const parsed = assignmentSchema.partial().strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the assignment details.' });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('assignments').update(parsed.data).eq('id', req.params.assignmentId).select().single();
    if (error) throw error;
    res.json({ assignment: data });
  } catch (error) { next(error); }
});

api.delete('/assignments/:assignmentId', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('assignments').delete().eq('id', req.params.assignmentId).select('id');
    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Assignment not found, or it was created by another teacher.' });
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'assignment.deleted', entity: 'assignment', entity_id: data[0].id });
    res.status(204).end();
  } catch (error) { next(error); }
});

api.put('/assignments/:assignmentId/submission', allowRoles('student'), submissionUpload.single('file'), async (req, res, next) => {
  let uploadedPath;
  try {
    const parsed = z.object({ text_answer: z.string().max(20000).default(''), remove_file: z.preprocess((value) => value === true || value === 'true', z.boolean()) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check your submission.' });
    const { data: assignment, error: assignmentError } = await adminSupabase.from('assignments').select('id,course_id,due_at,allow_late').eq('id', req.params.assignmentId).maybeSingle();
    if (assignmentError || !assignment || !(await isEnrolled(assignment.course_id, req.user.id))) return res.status(404).json({ error: 'Assignment not found.' });
    const isLate = new Date() > new Date(assignment.due_at);
    if (isLate && !assignment.allow_late) return res.status(409).json({ error: 'The submission deadline has passed.' });
    const { data: previous } = await adminSupabase.from('submissions').select('file_path').eq('assignment_id', assignment.id).eq('student_id', req.user.id).maybeSingle();
    let filePath = parsed.data.remove_file ? null : previous?.file_path || null;
    if (req.file) {
      const mimeType = detectAllowedMime(req.file, submissionExtensions);
      if (!mimeType) return res.status(415).json({ error: 'This file type is not supported or does not match its contents.' });
      uploadedPath = storagePath(`${assignment.id}/${req.user.id}`, req.file.originalname);
      const { error: uploadError } = await adminSupabase.storage.from('submissions').upload(uploadedPath, req.file.buffer, { contentType: mimeType, upsert: false });
      if (uploadError) {
        uploadedPath = undefined;
        if (/bucket not found/i.test(uploadError.message)) return res.status(503).json({ error: 'File submissions are not set up yet. Ask an administrator to apply the latest database migration.' });
        throw uploadError;
      }
      filePath = uploadedPath;
    }
    if (!parsed.data.text_answer.trim() && !filePath) return res.status(422).json({ error: 'Add a written answer or attach a file.' });
    // The file path is always set by the server; clients can never point a submission at someone else's file.
    const { data, error } = await adminSupabase.from('submissions').upsert({ assignment_id: assignment.id, student_id: req.user.id, text_answer: parsed.data.text_answer, body: parsed.data.text_answer, file_path: filePath, status: 'submitted', is_late: isLate, submitted_at: new Date().toISOString(), marks_obtained: null, score: null, feedback: '', graded_at: null, graded_by: null }, { onConflict: 'assignment_id,student_id' }).select().single();
    if (error) throw error;
    uploadedPath = undefined;
    if (previous?.file_path && previous.file_path !== filePath) await adminSupabase.storage.from('submissions').remove([previous.file_path]);
    res.status(201).json({ submission: data });
  } catch (error) {
    if (uploadedPath) await adminSupabase.storage.from('submissions').remove([uploadedPath]);
    next(error);
  }
});

api.get('/submissions/:submissionId/file', async (req, res, next) => {
  try {
    const { data: submission } = await adminSupabase.from('submissions').select('student_id,file_path,assignment:assignments(course_id)').eq('id', req.params.submissionId).maybeSingle();
    if (!submission?.file_path) return res.status(404).json({ error: 'File not found.' });
    const allowed = submission.student_id === req.user.id || (await canManageCourse(submission.assignment.course_id, req.profile));
    if (!allowed) return res.status(404).json({ error: 'File not found.' });
    const { data, error } = await adminSupabase.storage.from('submissions').createSignedUrl(submission.file_path, 60);
    if (error) throw error;
    res.json({ url: data.signedUrl, expiresIn: 60 });
  } catch (error) { next(error); }
});

api.get('/assignments/:assignmentId/submissions', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const { data: assignment } = await adminSupabase.from('assignments').select('id,course_id').eq('id', req.params.assignmentId).maybeSingle();
    if (!assignment || !(await canManageCourse(assignment.course_id, req.profile))) return res.status(404).json({ error: 'Assignment not found.' });
    const { data, error } = await adminSupabase.from('submissions').select('*, profiles:student_id(id,full_name,roll_no,email)').eq('assignment_id', req.params.assignmentId).order('submitted_at', { ascending: false }).limit(500);
    if (error) throw error;
    res.json({ submissions: data });
  } catch (error) { next(error); }
});

api.patch('/submissions/:submissionId/grade', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const parsed = z.object({ score: z.number().min(0), feedback: z.string().max(5000).default('') }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please provide a valid score and feedback.' });
    const { data: submission } = await adminSupabase.from('submissions').select('id,assignment_id,assignments(course_id,max_marks)').eq('id', req.params.submissionId).maybeSingle();
    if (!submission || !(await canManageCourse(submission.assignments.course_id, req.profile))) return res.status(404).json({ error: 'Submission not found.' });
    if (parsed.data.score > Number(submission.assignments.max_marks)) return res.status(422).json({ error: 'The score cannot exceed the assignment maximum marks.' });
    const { data, error } = await adminSupabase.from('submissions').update({ score: parsed.data.score, marks_obtained: parsed.data.score, feedback: parsed.data.feedback, status: 'graded', graded_by: req.user.id, graded_at: new Date().toISOString() }).eq('id', req.params.submissionId).select().single();
    if (error) throw error;
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'submission.graded', entity: 'submission', entity_id: data.id, details: { marks: parsed.data.score } });
    res.json({ submission: data });
  } catch (error) { next(error); }
});

// Marks
api.get('/me/marks', allowRoles('student'), async (req, res, next) => {
  try {
    const parsed = z.object({ courseId: z.string().uuid().optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Please provide a valid course.' });
    const client = userSupabase(req.accessToken);
    let query = client.from('student_marks').select('*').eq('student_id', req.user.id).order('course_title').order('item_title').limit(500);
    if (parsed.data.courseId) query = query.eq('course_id', parsed.data.courseId);
    const { data, error } = await query;
    if (error) throw error;
    const courseMap = new Map();
    for (const mark of data) {
      const course = courseMap.get(mark.course_id) || { courseId: mark.course_id, courseTitle: mark.course_title, earned: 0, possible: 0, items: [] };
      course.items.push({ itemType: mark.item_type, itemId: mark.item_id, title: mark.item_title, marks: mark.status === 'graded' ? mark.marks_obtained : null, maxMarks: mark.max_marks, status: mark.status });
      if (mark.status === 'graded' && mark.marks_obtained !== null) { course.earned += Number(mark.marks_obtained); course.possible += Number(mark.max_marks); }
      courseMap.set(mark.course_id, course);
    }
    res.json({ courses: [...courseMap.values()].map((course) => ({ ...course, percentage: course.possible ? Math.round(course.earned / course.possible * 10000) / 100 : null })) });
  } catch (error) { next(error); }
});

api.get('/courses/:courseId/gradebook', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    if (!(await canManageCourse(req.params.courseId, req.profile))) return res.status(404).json({ error: 'Course not found.' });
    const [course, enrollments, assignments, quizzes] = await Promise.all([
      adminSupabase.from('courses').select('id,code,title').eq('id', req.params.courseId).single(),
      adminSupabase.from('enrollments').select('student:profiles(id,full_name,roll_no,email)').eq('course_id', req.params.courseId),
      adminSupabase.from('assignments').select('id,title,max_marks,due_at,submissions(id,student_id,status,text_answer,body,file_path,is_late,marks_obtained,feedback,submitted_at)').eq('course_id', req.params.courseId).order('due_at'),
      adminSupabase.from('quizzes').select('id,title,quiz_questions(points),quiz_attempts(id,student_id,score,submitted_at)').eq('course_id', req.params.courseId),
    ]);
    const failed = [course, enrollments, assignments, quizzes].find((result) => result.error);
    if (failed) throw failed.error;
    res.json({
      course: course.data,
      students: enrollments.data.map((row) => row.student),
      assignments: assignments.data.map((assignment) => ({ ...assignment, submissions: assignment.submissions.map(({ file_path: filePath, body, ...submission }) => ({ ...submission, text_answer: submission.text_answer ?? body, has_file: Boolean(filePath) })) })),
      quizzes: quizzes.data.map(({ quiz_questions: questions, ...quiz }) => ({ ...quiz, total_points: questions.reduce((sum, question) => sum + Number(question.points), 0) })),
    });
  } catch (error) { next(error); }
});

api.get('/courses/:courseId/gradebook.csv', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    if (!(await canManageCourse(req.params.courseId, req.profile))) return res.status(404).json({ error: 'Course not found.' });
    const { data, error } = await adminSupabase.from('student_marks').select('student_id,item_type,item_title,marks_obtained,max_marks,status').eq('course_id', req.params.courseId).limit(5000);
    if (error) throw error;
    const studentIds = [...new Set(data.map((row) => row.student_id).filter(Boolean))];
    const { data: people, error: peopleError } = studentIds.length ? await adminSupabase.from('profiles').select('id,full_name,roll_no').in('id', studentIds) : { data: [] };
    if (peopleError) throw peopleError;
    const names = new Map(people.map((person) => [person.id, person]));
    const cell = (value) => { const text = String(value ?? '').replaceAll('\r', ' ').replaceAll('\n', ' '); const safe = /^[=+@\-\t]/.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; };
    const lines = [['Student', 'Roll number', 'Type', 'Item', 'Marks', 'Maximum', 'Status'], ...data.map((row) => [names.get(row.student_id)?.full_name, names.get(row.student_id)?.roll_no, row.item_type, row.item_title, row.status === 'graded' ? row.marks_obtained : '', row.max_marks, row.status])].map((line) => line.map(cell).join(','));
    res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="gradebook.csv"').send(`\uFEFF${lines.join('\r\n')}`);
  } catch (error) { next(error); }
});

// Administration
api.get('/admin/users', allowRoles('admin'), async (req, res, next) => {
  try {
    const query = z.object({ search: z.string().max(100).regex(/^[\p{L}\p{N} .@_-]*$/u).optional(), role: z.enum(['admin', 'teacher', 'student']).optional(), registrationStatus: z.enum(['approved', 'pending', 'rejected']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: 'Search can only contain letters, numbers, spaces, and . @ _ -' });
    let request = adminSupabase.from('profiles').select('id, full_name, email, role, job_title, department, roll_no, is_active, registration_status, created_at').order('created_at', { ascending: false }).limit(query.data.limit);
    if (query.data.role) request = request.eq('role', query.data.role);
    if (query.data.registrationStatus) request = request.eq('registration_status', query.data.registrationStatus);
    if (query.data.search) request = request.or(`full_name.ilike.%${query.data.search}%,email.ilike.%${query.data.search}%`);
    const { data, error } = await request;
    if (error) throw error;
    res.json({ users: data });
  } catch (error) { next(error); }
});

api.patch('/admin/users/:userId/role', allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = z.object({ role: z.enum(['admin', 'teacher', 'student']) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please select a valid role.' });
    if (req.params.userId === req.user.id && parsed.data.role !== 'admin') return res.status(409).json({ error: 'You cannot remove your own admin role. Ask another admin to do it.' });
    const { data, error } = await adminSupabase.from('profiles').update({ role: parsed.data.role }).eq('id', req.params.userId).select('id, full_name, email, role').single();
    if (error) throw error;
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'role.updated', entity: 'profile', entity_id: req.params.userId, details: { role: parsed.data.role } });
    res.json({ user: data });
  } catch (error) { next(error); }
});

api.get('/admin/audit', allowRoles('admin'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const { data, error } = await adminSupabase.from('audit_log').select('id, actor_id, action, entity, entity_id, details, created_at').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    const names = await profileNames(data.map((event) => event.actor_id));
    res.json({ events: data.map((event) => ({ ...event, actor_name: names.get(event.actor_id)?.full_name || null })) });
  } catch (error) { next(error); }
});

api.get('/admin/overview', allowRoles('admin'), async (_req, res, next) => {
  try {
    const count = (table, filter = (query) => query) => filter(adminSupabase.from(table).select('id', { count: 'exact', head: true }));
    const results = await Promise.all([
      count('profiles'), count('profiles', (q) => q.eq('role', 'student')), count('profiles', (q) => q.eq('role', 'teacher')),
      count('courses', (q) => q.eq('is_archived', false)), count('assignments'), count('complaints', (q) => q.in('status', ['open', 'in_review'])), count('profiles', (q) => q.eq('registration_status', 'pending')),
    ]);
    const failed = results.find((item) => item.error);
    if (failed) throw failed.error;
    const [users, students, teachers, courses, assignments, openComplaints, pendingRegistrations] = results.map((item) => item.count || 0);
    res.json({ users, students, teachers, courses, assignments, openComplaints, pendingRegistrations });
  } catch (error) { next(error); }
});

// Announcements
api.get('/announcements', async (req, res, next) => {
  try {
    const parsed = paginationSchema.extend({ courseId: z.string().uuid().optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the announcement filters.' });
    const client = userSupabase(req.accessToken);
    const start = (parsed.data.page - 1) * parsed.data.pageSize;
    let query = client.from('announcements').select('*, announcement_reads(user_id)', { count: 'exact' }).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).range(start, start + parsed.data.pageSize - 1);
    if (parsed.data.courseId) query = query.eq('course_id', parsed.data.courseId);
    const { data, count, error } = await query;
    if (error) throw error;
    const courseIds = [...new Set(data.map((row) => row.course_id).filter(Boolean))];
    const [authors, { data: courses, error: courseError }] = await Promise.all([
      profileNames(data.map((row) => row.author_id)),
      courseIds.length ? adminSupabase.from('courses').select('id,title').in('id', courseIds) : { data: [] },
    ]);
    if (courseError) throw courseError;
    const titles = new Map(courses.map((course) => [course.id, course.title]));
    const announcements = data.map(({ announcement_reads: reads, ...row }) => ({ ...row, author_name: authors.get(row.author_id)?.full_name || 'Staff member', author_role: authors.get(row.author_id)?.role || 'staff', course_title: row.course_id ? titles.get(row.course_id) || 'Course' : null, is_read: reads.some((read) => read.user_id === req.user.id) }));
    res.json({ announcements, meta: { page: parsed.data.page, pageSize: parsed.data.pageSize, total: count || 0 } });
  } catch (error) { next(error); }
});

const announcementSchema = z.object({ title: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(5000), course_id: z.string().uuid().nullable().optional(), is_pinned: z.boolean().default(false) });
api.post('/announcements', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the announcement details.' });
    if (req.profile.role === 'teacher' && (!parsed.data.course_id || !(await teachesCourse(parsed.data.course_id, req.user.id)))) return res.status(403).json({ error: 'Teachers can only post to a course they teach. Only admins can post to everyone.' });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('announcements').insert({ ...parsed.data, course_id: parsed.data.course_id || null, author_id: req.user.id }).select().single();
    if (error) throw error;
    res.status(201).json({ announcement: data });
  } catch (error) { next(error); }
});

api.patch('/announcements/:announcementId', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const parsed = announcementSchema.omit({ course_id: true }).partial().extend({ is_pinned: z.boolean().optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the announcement details.' });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('announcements').update(parsed.data).eq('id', req.params.announcementId).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Announcement not found.' });
    res.json({ announcement: data });
  } catch (error) { next(error); }
});

api.delete('/announcements/:announcementId', allowRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    const { data: post } = await adminSupabase.from('announcements').select('id,author_id').eq('id', req.params.announcementId).maybeSingle();
    if (!post || (req.profile.role !== 'admin' && post.author_id !== req.user.id)) return res.status(404).json({ error: 'Announcement not found.' });
    const { error } = await adminSupabase.from('announcements').delete().eq('id', post.id);
    if (error) throw error;
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'announcement.deleted', entity: 'announcement', entity_id: post.id });
    res.status(204).end();
  } catch (error) { next(error); }
});

api.post('/announcements/read', async (req, res, next) => {
  try {
    const parsed = z.object({ upTo: z.string().datetime().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please provide a valid read timestamp.' });
    const client = userSupabase(req.accessToken);
    let query = client.from('announcements').select('id').order('created_at', { ascending: false }).limit(500);
    if (parsed.data.upTo) query = query.lte('created_at', parsed.data.upTo);
    const { data: announcements, error } = await query;
    if (error) throw error;
    if (announcements.length) {
      const readAt = new Date().toISOString();
      const { error: insertError } = await client.from('announcement_reads').upsert(announcements.map(({ id }) => ({ user_id: req.user.id, announcement_id: id, read_at: readAt })), { onConflict: 'user_id,announcement_id' });
      if (insertError) throw insertError;
    }
    res.json({ readCount: announcements.length });
  } catch (error) { next(error); }
});

api.patch('/profiles/me', async (req, res, next) => {
  try {
    const profileSchema = z.object({ full_name: z.string().trim().min(2).max(100), job_title: z.string().trim().max(100).optional(), department: z.string().trim().max(100).optional(), avatar_url: z.string().url().nullable().optional() }).strict();
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Your name must be 2 to 100 characters; title and department up to 100.' });
    const client = userSupabase(req.accessToken);
    const { data, error } = await client.from('profiles').update(parsed.data).eq('id', req.user.id).select().single();
    if (error) throw error;
    res.json({ profile: data });
  } catch (error) { next(error); }
});

