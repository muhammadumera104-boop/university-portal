import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import multer from 'multer';

const fake = vi.hoisted(() => ({ current: null }));
vi.mock('../src/supabase.js', async () => {
  const { createFakeSupabase: create } = await import('./fakeSupabase.js');
  fake.current = create();
  return { adminSupabase: fake.current.client, userSupabase: () => fake.current.client };
});

const { app, toHttpError } = await import('../src/app.js');
const { detectAllowedMime } = await import('../src/lib/files.js');
const db = () => fake.current;
const COURSE = '11111111-1111-4111-8111-111111111111';
const OTHER_COURSE = '22222222-2222-4222-8222-222222222222';
const as = (token) => ({ Authorization: `Bearer ${token}` });
let admin, teacher, student;

beforeEach(() => {
  db().reset();
  admin = db().signIn({ id: 'a0000000-0000-4000-8000-000000000001', email: 'admin@test.local', full_name: 'Ada Admin', role: 'admin' });
  teacher = db().signIn({ id: 'b0000000-0000-4000-8000-000000000002', email: 'teacher@test.local', full_name: 'Tess Teacher', role: 'teacher' });
  student = db().signIn({ id: 'c0000000-0000-4000-8000-000000000003', email: 'student@test.local', full_name: 'Sam Student', role: 'student' });
  db().seed('courses', { id: COURSE, title: 'Algebra', status: 'published', is_archived: false }, { id: OTHER_COURSE, title: 'Biology', status: 'published', is_archived: false });
  db().seed('course_teachers', { course_id: COURSE, teacher_id: teacher });
  db().seed('enrollments', { id: crypto.randomUUID(), course_id: COURSE, student_id: student });
});

describe('authentication', () => {
  it('reports health without a session', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
  it('rejects requests without a token', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
  });
  it('rejects an invalid token', async () => {
    expect((await request(app).get('/api/me').set(as('not-a-real-token'))).status).toBe(401);
  });
  it('blocks a deactivated user even with a valid token', async () => {
    db().tables.profiles.find((row) => row.id === student).is_active = false;
    expect((await request(app).get('/api/me').set(as(student))).status).toBe(401);
  });
  it('forces a password change before other requests', async () => {
    db().tables.profiles.find((row) => row.id === student).must_change_password = true;
    const res = await request(app).get('/api/me').set(as(student));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
  it('returns the generic login error for malformed credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nope', password: '' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password.');
  });
  it('answers forgot-password neutrally', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'unknown@test.local' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If an account exists/);
  });
  it('has no sign-up route', async () => {
    expect((await request(app).post('/api/auth/signup').send({})).status).toBe(404);
  });
});

describe('self-registration', () => {
  const body = { fullName: 'New Student', email: 'new@test.local', password: 'abcdefghi1' };
  it('accepts a registration and replies neutrally', async () => {
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(202);
    expect(res.body.message).toMatch(/waiting for administrator approval/);
  });
  it('rejects weak passwords and bad emails', async () => {
    expect((await request(app).post('/api/auth/register').send({ ...body, password: 'short1' })).status).toBe(422);
    expect((await request(app).post('/api/auth/register').send({ ...body, password: 'onlylettersonly' })).status).toBe(422);
    expect((await request(app).post('/api/auth/register').send({ ...body, email: 'nope' })).status).toBe(422);
  });
  it('ignores a client-supplied role', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...body, role: 'admin' });
    expect(res.status).toBe(202);
  });
  it('lets only admins approve or reject registrations', async () => {
    const pending = 'd0000000-0000-4000-8000-000000000004';
    db().signIn({ id: pending, email: 'pending@test.local', full_name: 'Pending One', role: 'student' });
    const row = db().tables.profiles.find((item) => item.id === pending);
    Object.assign(row, { is_active: false, registration_status: 'pending' });
    expect((await request(app).post('/api/admin/users/' + pending + '/approve').set(as(teacher))).status).toBe(403);
    expect((await request(app).post('/api/admin/users/' + pending + '/approve').set(as(student))).status).toBe(403);
    const ok = await request(app).post('/api/admin/users/' + pending + '/approve').set(as(admin));
    expect(ok.status).toBe(200);
    expect(row.is_active).toBe(true);
    expect(row.registration_status).toBe('approved');
    expect((await request(app).post('/api/admin/users/' + pending + '/approve').set(as(admin))).status).toBe(404);
  });
  it('rejects a pending registration', async () => {
    const pending = 'e0000000-0000-4000-8000-000000000005';
    db().signIn({ id: pending, email: 'p2@test.local', full_name: 'Pending Two', role: 'student' });
    const row = db().tables.profiles.find((item) => item.id === pending);
    Object.assign(row, { is_active: false, registration_status: 'pending' });
    expect((await request(app).post('/api/admin/users/' + pending + '/reject').set(as(admin))).status).toBe(200);
    expect(row.registration_status).toBe('rejected');
  });
});

describe('bulk account import', () => {
  it('creates valid rows and reports bad ones without blocking the rest', async () => {
    const res = await request(app).post('/api/admin/users/bulk').set(as(admin)).send({ users: [
      { fullName: 'Good Student', email: 'good@test.local', role: 'student' },
      { fullName: 'Bad Role', email: 'bad@test.local', role: 'admin' },
      { fullName: 'Good Student Again', email: 'GOOD@test.local', role: 'student' },
      { fullName: 'Some Teacher', email: 'teach@test.local', role: 'teacher' },
    ] });
    expect(res.status).toBe(207);
    expect(res.body.created).toBe(2);
    expect(res.body.failed).toBe(2);
    expect(res.body.results.find((row) => row.email === 'bad@test.local').error).toMatch(/Invalid/);
    expect(res.body.results.filter((row) => row.ok).every((row) => row.temporaryPassword.length > 12)).toBe(true);
  });
  it('is admin only and limits batch size', async () => {
    expect((await request(app).post('/api/admin/users/bulk').set(as(teacher)).send({ users: [{ fullName: 'A B', email: 'a@test.local', role: 'student' }] })).status).toBe(403);
    expect((await request(app).post('/api/admin/users/bulk').set(as(admin)).send({ users: [] })).status).toBe(400);
  });
});

describe('role-based access', () => {
  it('lets an admin list users', async () => {
    const res = await request(app).get('/api/admin/users').set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(3);
  });
  it.each([['student'], ['teacher']])('denies %s access to admin user management', async (role) => {
    const token = role === 'student' ? student : teacher;
    expect((await request(app).get('/api/admin/users').set(as(token))).status).toBe(403);
    expect((await request(app).post('/api/admin/users').set(as(token)).send({ email: 'x@test.local', fullName: 'X Y', role: 'student' })).status).toBe(403);
  });
  it('denies course creation to non-admins', async () => {
    expect((await request(app).post('/api/courses').set(as(teacher)).send({ title: 'New course' })).status).toBe(403);
  });
  it('validates new account details', async () => {
    const res = await request(app).post('/api/admin/users').set(as(admin)).send({ email: 'bad', fullName: 'X', role: 'admin' });
    expect(res.status).toBe(400);
  });
  it('stops an admin from removing their own admin role', async () => {
    const res = await request(app).patch(`/api/admin/users/${admin}/role`).set(as(admin)).send({ role: 'student' });
    expect(res.status).toBe(409);
  });
  it('stops an admin from deactivating themselves', async () => {
    expect((await request(app).patch(`/api/admin/users/${admin}/active`).set(as(admin)).send({ isActive: false })).status).toBe(409);
  });
  it('returns 404 for unknown authenticated routes', async () => {
    expect((await request(app).get('/api/does-not-exist').set(as(admin))).status).toBe(404);
  });
});

describe('announcements', () => {
  it('requires teachers to target a course they teach', async () => {
    const global = await request(app).post('/api/announcements').set(as(teacher)).send({ title: 'Hello', body: 'Everyone' });
    expect(global.status).toBe(403);
    const other = await request(app).post('/api/announcements').set(as(teacher)).send({ title: 'Hello', body: 'Biology', course_id: OTHER_COURSE });
    expect(other.status).toBe(403);
    const own = await request(app).post('/api/announcements').set(as(teacher)).send({ title: 'Hello', body: 'Algebra', course_id: COURSE });
    expect(own.status).toBe(201);
  });
  it('denies students from posting announcements', async () => {
    expect((await request(app).post('/api/announcements').set(as(student)).send({ title: 'Hi', body: 'x', course_id: COURSE })).status).toBe(403);
  });
});

describe('chat', () => {
  it('hides a course chat from non-members', async () => {
    expect((await request(app).get(`/api/courses/${OTHER_COURSE}/messages`).set(as(student))).status).toBe(404);
    expect((await request(app).post(`/api/courses/${OTHER_COURSE}/messages`).set(as(student)).send({ body: 'hi' })).status).toBe(404);
  });
  it('lets members post and rejects empty messages', async () => {
    expect((await request(app).post(`/api/courses/${COURSE}/messages`).set(as(student)).send({ body: 'hello class' })).status).toBe(201);
    expect((await request(app).post(`/api/courses/${COURSE}/messages`).set(as(student)).send({ body: '   ' })).status).toBe(422);
  });
  it('lets admins read but not post', async () => {
    expect((await request(app).get(`/api/courses/${COURSE}/messages`).set(as(admin))).status).toBe(200);
    expect((await request(app).post(`/api/courses/${COURSE}/messages`).set(as(admin)).send({ body: 'hello' })).status).toBe(403);
  });
});

describe('resources', () => {
  const pdf = Buffer.from('%PDF-1.4 test file');
  it('blocks uploads to a course the teacher does not teach', async () => {
    const res = await request(app).post(`/api/courses/${OTHER_COURSE}/resources`).set(as(teacher)).field('title', 'Notes').attach('file', pdf, { filename: 'notes.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });
  it('rejects files whose contents do not match their type', async () => {
    const res = await request(app).post(`/api/courses/${COURSE}/resources`).set(as(teacher)).field('title', 'Notes').attach('file', Buffer.from('MZ fake executable'), { filename: 'notes.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(415);
  });
  it('accepts a valid upload from a course teacher', async () => {
    const res = await request(app).post(`/api/courses/${COURSE}/resources`).set(as(teacher)).field('title', 'Notes').attach('file', pdf, { filename: 'notes.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(db().storage[0]).toMatch(new RegExp(`^${COURSE}/[0-9a-f-]+-notes\\.pdf$`));
  });
  it('denies the resource list to students who are not enrolled', async () => {
    expect((await request(app).get(`/api/courses/${OTHER_COURSE}/resources`).set(as(student))).status).toBe(403);
  });
});

describe('assignments and grading', () => {
  const assignmentId = '33333333-3333-4333-8333-333333333333';
  it('rejects a late submission when late work is not allowed', async () => {
    db().seed('assignments', { id: assignmentId, course_id: COURSE, due_at: new Date(Date.now() - 3600000).toISOString(), allow_late: false });
    const res = await request(app).put(`/api/assignments/${assignmentId}/submission`).set(as(student)).send({ text_answer: 'my work' });
    expect(res.status).toBe(409);
  });
  it('accepts an on-time submission and ignores any client-supplied file path', async () => {
    db().seed('assignments', { id: assignmentId, course_id: COURSE, due_at: new Date(Date.now() + 3600000).toISOString(), allow_late: false });
    const res = await request(app).put(`/api/assignments/${assignmentId}/submission`).set(as(student)).send({ text_answer: 'my work', file_path: 'resources/someone-else.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.submission.file_path).toBeNull();
    expect(res.body.submission.is_late).toBe(false);
  });
  it('requires an answer or a file', async () => {
    db().seed('assignments', { id: assignmentId, course_id: COURSE, due_at: new Date(Date.now() + 3600000).toISOString(), allow_late: false });
    expect((await request(app).put(`/api/assignments/${assignmentId}/submission`).set(as(student)).send({ text_answer: ' ' })).status).toBe(422);
  });
  it('hides assignments from students who are not enrolled', async () => {
    db().seed('assignments', { id: assignmentId, course_id: OTHER_COURSE, due_at: new Date(Date.now() + 3600000).toISOString(), allow_late: true });
    expect((await request(app).put(`/api/assignments/${assignmentId}/submission`).set(as(student)).send({ text_answer: 'x' })).status).toBe(404);
  });
  it('rejects marks above the maximum and grades within it', async () => {
    const submissionId = '44444444-4444-4444-8444-444444444444';
    db().seed('submissions', { id: submissionId, assignment_id: assignmentId, student_id: student, assignments: { course_id: COURSE, max_marks: 10 } });
    expect((await request(app).patch(`/api/submissions/${submissionId}/grade`).set(as(teacher)).send({ score: 11 })).status).toBe(422);
    const ok = await request(app).patch(`/api/submissions/${submissionId}/grade`).set(as(teacher)).send({ score: 9, feedback: 'Good' });
    expect(ok.status).toBe(200);
    expect(ok.body.submission.status).toBe('graded');
  });
  it('stops a teacher grading another course', async () => {
    const submissionId = '55555555-5555-4555-8555-555555555555';
    db().seed('submissions', { id: submissionId, assignment_id: assignmentId, student_id: student, assignments: { course_id: OTHER_COURSE, max_marks: 10 } });
    expect((await request(app).patch(`/api/submissions/${submissionId}/grade`).set(as(teacher)).send({ score: 5 })).status).toBe(404);
  });
  it('denies students the gradebook', async () => {
    expect((await request(app).get(`/api/courses/${COURSE}/gradebook`).set(as(student))).status).toBe(403);
  });
});

describe('error mapping', () => {
  it.each([
    [{ code: 'PGRST116' }, 404], [{ code: '42501' }, 403], [{ code: '23505' }, 409], [{ code: '22P02' }, 400],
    [new multer.MulterError('LIMIT_FILE_SIZE'), 413], [{ status: 422, message: 'nope' }, 422], [new Error('boom'), 500],
  ])('maps %o to %i', (error, status) => {
    expect(toHttpError(error)[0]).toBe(status);
  });
  it('never exposes internal error messages', () => {
    expect(toHttpError(new Error('connection string leaked'))[1]).toBe('The request could not be completed.');
  });
});

describe('file validation', () => {
  const file = (name, mimetype, bytes) => ({ originalname: name, mimetype, buffer: Buffer.from(bytes) });
  it('accepts a real PDF', () => expect(detectAllowedMime(file('a.pdf', 'application/pdf', '%PDF-1.7'), ['.pdf'])).toBe('application/pdf'));
  it('rejects an executable', () => expect(detectAllowedMime(file('a.exe', 'application/octet-stream', 'MZ'), ['.pdf'])).toBeNull());
  it('rejects a renamed file', () => expect(detectAllowedMime(file('a.png', 'image/png', '%PDF-1.7'), ['.png'])).toBeNull());
  it('respects the per-route allow list', () => expect(detectAllowedMime(file('a.txt', 'text/plain', 'hello'), ['.pdf'])).toBeNull());
});

