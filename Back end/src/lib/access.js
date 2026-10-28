import { adminSupabase } from '../supabase.js';

export async function teachesCourse(courseId, userId) {
  const { data } = await adminSupabase.from('course_teachers').select('course_id').eq('course_id', courseId).eq('teacher_id', userId).maybeSingle();
  return Boolean(data);
}

export async function isEnrolled(courseId, userId) {
  const { data } = await adminSupabase.from('enrollments').select('id').eq('course_id', courseId).eq('student_id', userId).maybeSingle();
  return Boolean(data);
}

// Admins manage every course; teachers only the courses they are assigned to.
export async function canManageCourse(courseId, profile) {
  if (profile.role === 'admin') return true;
  return profile.role === 'teacher' && teachesCourse(courseId, profile.id);
}

// Course members: admins, assigned teachers, and enrolled students.
export async function isCourseMember(courseId, profile) {
  if (profile.role === 'admin') return true;
  return profile.role === 'teacher' ? teachesCourse(courseId, profile.id) : isEnrolled(courseId, profile.id);
}

export const uuidParam = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
