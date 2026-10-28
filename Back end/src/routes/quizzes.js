import { Router } from 'express';
import { z } from 'zod';
import { adminSupabase, userSupabase } from '../supabase.js';
import { allowRoles } from '../middleware/auth.js';
import { canManageCourse, isCourseMember } from '../lib/access.js';

export const quizzes = Router();
const questionSchema = z.object({ prompt: z.string().trim().min(2).max(5000), question_type: z.enum(['mcq_single','mcq_multi','true_false']), options: z.array(z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(500) })).min(2).max(10), points: z.number().min(0.01).max(1000).default(1), position: z.number().int().min(0).default(0), correct_option_ids: z.array(z.string().min(1).max(40)).min(1).max(10) }).superRefine((question, ctx) => {
  const ids = new Set(question.options.map((option) => option.id));
  if (ids.size !== question.options.length || question.correct_option_ids.some((id) => !ids.has(id))) ctx.addIssue({ code: 'custom', message: 'Question option identifiers must be unique and valid.' });
  if (question.question_type !== 'mcq_multi' && question.correct_option_ids.length !== 1) ctx.addIssue({ code: 'custom', message: 'Single-answer questions need exactly one correct option.' });
});
const quizSchema = z.object({ title: z.string().trim().min(2).max(160), description: z.string().max(5000).default(''), time_limit_minutes: z.number().int().min(1).max(360), opens_at: z.string().datetime(), closes_at: z.string().datetime(), is_published: z.boolean().default(false), questions: z.array(questionSchema).min(1).max(100) });


async function scoreAnswers(quizId, answers) {
  const { data: questions, error } = await adminSupabase.from('quiz_questions').select('id,points,quiz_answers(correct_option_ids)').eq('quiz_id', quizId);
  if (error) throw error;
  let score = 0;
  for (const question of questions) {
    const key = Array.isArray(question.quiz_answers) ? question.quiz_answers[0] : question.quiz_answers;
    const expected = [...(key?.correct_option_ids || [])].sort();
    const submitted = [...(answers[question.id] || [])].sort();
    if (expected.length === submitted.length && expected.every((item, index) => item === submitted[index])) score += Number(question.points);
  }
  return score;
}

quizzes.post('/courses/:courseId/quizzes', allowRoles('admin','teacher'), async (req, res, next) => {
  try {
    const parsed = quizSchema.safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Please check the quiz and questions.' });
    if (new Date(parsed.data.closes_at) <= new Date(parsed.data.opens_at)) return res.status(422).json({ error: 'The quiz closing time must be after its opening time.' });
    const client = userSupabase(req.accessToken);
    const { questions, ...quizInput } = parsed.data;
    const { data: quiz, error } = await client.from('quizzes').insert({ ...quizInput, course_id: req.params.courseId, created_by: req.user.id, attempts_allowed: 1 }).select().single();
    if (error) throw error;
    try {
      for (const question of questions) {
        const { correct_option_ids, ...questionInput } = question;
        const { data, error: questionError } = await client.from('quiz_questions').insert({ ...questionInput, quiz_id: quiz.id }).select('id').single();
        if (questionError) throw questionError;
        const { error: answerError } = await client.from('quiz_answers').insert({ question_id: data.id, correct_option_ids });
        if (answerError) throw answerError;
      }
    } catch (questionError) {
      // Without a transaction, remove the half-built quiz so it never appears with missing questions or answer keys.
      await adminSupabase.from('quizzes').delete().eq('id', quiz.id);
      throw questionError;
    }
    res.status(201).json({ quiz: { ...quiz, questionCount: questions.length } });
  } catch (error) { next(error); }
});

quizzes.get('/courses/:courseId/quizzes', async (req, res, next) => {
  try {
    if (!(await isCourseMember(req.params.courseId, req.profile))) return res.status(403).json({ error: 'You are not a member of this course.' });
    const client = userSupabase(req.accessToken);
    // Students only receive question counts here; prompts and options are released when an attempt starts.
    const { data, error } = await client.from('quizzes').select('id,title,description,time_limit_minutes,opens_at,closes_at,is_published,created_at,quiz_questions(id,points)').eq('course_id', req.params.courseId).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    let attempts = new Map();
    if (req.profile.role === 'student' && data.length) {
      const { data: rows, error: attemptError } = await adminSupabase.from('quiz_attempts').select('quiz_id,started_at,submitted_at,score').eq('student_id', req.user.id).in('quiz_id', data.map((quiz) => quiz.id));
      if (attemptError) throw attemptError;
      attempts = new Map(rows.map((row) => [row.quiz_id, row]));
    }
    res.json({ quizzes: data.map((quiz) => ({ ...quiz, question_count: quiz.quiz_questions.length, total_points: quiz.quiz_questions.reduce((sum, question) => sum + Number(question.points), 0), my_attempt: attempts.get(quiz.id) || null })) });
  } catch (error) { next(error); }
});

quizzes.delete('/quizzes/:quizId', allowRoles('admin','teacher'), async (req, res, next) => {
  try {
    const { data: quiz, error: quizError } = await adminSupabase.from('quizzes').select('id,course_id').eq('id', req.params.quizId).maybeSingle();
    if (quizError || !quiz || !(await canManageCourse(quiz.course_id, req.profile))) return res.status(404).json({ error: 'Quiz not found.' });
    const { count, error: attemptsError } = await adminSupabase.from('quiz_attempts').select('id', { count: 'exact', head: true }).eq('quiz_id', quiz.id);
    if (attemptsError) throw attemptsError;
    if (count) return res.status(409).json({ error: 'A quiz with learner attempts cannot be deleted. Unpublish it instead.' });
    const { error } = await adminSupabase.from('quizzes').delete().eq('id', quiz.id);
    if (error) throw error;
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'quiz.deleted', entity: 'quiz', entity_id: quiz.id });
    res.status(204).end();
  } catch (error) { next(error); }
});

quizzes.patch('/quizzes/:quizId', allowRoles('admin','teacher'), async (req, res, next) => {
  try {
    const parsed = z.object({ title: z.string().trim().min(2).max(160).optional(), description: z.string().max(5000).optional(), opens_at: z.string().datetime().optional(), closes_at: z.string().datetime().optional(), is_published: z.boolean().optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check the quiz details.' });
    if (parsed.data.opens_at && parsed.data.closes_at && new Date(parsed.data.closes_at) <= new Date(parsed.data.opens_at)) return res.status(422).json({ error: 'The quiz closing time must be after its opening time.' });
    const { data: quiz, error: quizError } = await adminSupabase.from('quizzes').select('id,course_id').eq('id', req.params.quizId).maybeSingle();
    if (quizError || !quiz) return res.status(404).json({ error: 'Quiz not found.' });
    if (!(await canManageCourse(quiz.course_id, req.profile))) return res.status(404).json({ error: 'Quiz not found.' });
    const { count, error: attemptsError } = await adminSupabase.from('quiz_attempts').select('id', { count: 'exact', head: true }).eq('quiz_id', quiz.id);
    if (attemptsError) throw attemptsError;
    if (count) return res.status(409).json({ error: 'A quiz cannot be edited after a learner has started an attempt.' });
    const { data, error } = await adminSupabase.from('quizzes').update(parsed.data).eq('id', quiz.id).select().single();
    if (error) throw error;
    res.json({ quiz: data });
  } catch (error) { next(error); }
});

quizzes.post('/quizzes/:quizId/attempt', allowRoles('student'), async (req, res, next) => {
  try {
    const { data: quiz, error } = await adminSupabase.from('quizzes').select('id,course_id,title,description,time_limit_minutes,opens_at,closes_at,is_published').eq('id', req.params.quizId).maybeSingle();
    if (error || !quiz) return res.status(404).json({ error: 'Quiz not found.' });
    const { data: enrollment } = await adminSupabase.from('enrollments').select('id').eq('course_id', quiz.course_id).eq('student_id', req.user.id).maybeSingle();
    if (!enrollment || !quiz.is_published) return res.status(404).json({ error: 'Quiz not found.' });
    const now = Date.now();
    const { data: priorAttempt, error: priorError } = await adminSupabase.from('quiz_attempts').select('id,started_at,answers,submitted_at').eq('quiz_id', quiz.id).eq('student_id', req.user.id).maybeSingle();
    if (priorError) throw priorError;
    if (priorAttempt?.submitted_at) return res.status(409).json({ error: 'You have already submitted your attempt for this quiz.' });
    if (!priorAttempt && (now < new Date(quiz.opens_at).getTime() || now > new Date(quiz.closes_at).getTime())) return res.status(409).json({ error: 'This quiz is outside its available window.' });
    let attempt = priorAttempt;
    if (!attempt) {
      const { data, error: insertError } = await adminSupabase.from('quiz_attempts').insert({ quiz_id: quiz.id, student_id: req.user.id, answers: {} }).select('id,started_at,answers,submitted_at').single();
      if (insertError?.code === '23505') {
        const { data: raced, error: raceError } = await adminSupabase.from('quiz_attempts').select('id,started_at,answers,submitted_at').eq('quiz_id', quiz.id).eq('student_id', req.user.id).single();
        if (raceError) throw raceError;
        attempt = raced;
      } else if (insertError) throw insertError;
      else attempt = data;
    }
    const expiresAt = new Date(new Date(attempt.started_at).getTime() + (quiz.time_limit_minutes * 60 + 10) * 1000);
    if (now > expiresAt.getTime()) {
      const score = await scoreAnswers(quiz.id, attempt.answers || {});
      const { data: completed, error: completionError } = await adminSupabase.from('quiz_attempts').update({ score, submitted_at: new Date().toISOString() }).eq('id', attempt.id).is('submitted_at', null).select('id,score,submitted_at').maybeSingle();
      if (completionError) throw completionError;
      if (completed) await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'quiz.attempt_auto_submitted', entity: 'quiz_attempt', entity_id: completed.id, details: { score, reason: 'timer_expired' } });
      return res.json({ completed: true, score: completed?.score ?? score });
    }
    const client = userSupabase(req.accessToken);
    const { data: questions, error: questionError } = await client.from('quiz_questions').select('id,prompt,question_type,options,points,position').eq('quiz_id', quiz.id).order('position');
    if (questionError) throw questionError;
    const shuffled = [...questions].sort(() => Math.random() - 0.5);
    res.status(priorAttempt ? 200 : 201).json({ attemptId: attempt.id, startedAt: attempt.started_at, expiresAt: expiresAt.toISOString(), answers: attempt.answers || {}, resumed: Boolean(priorAttempt), quiz: { id: quiz.id, title: quiz.title, description: quiz.description, timeLimitMinutes: quiz.time_limit_minutes }, questions: shuffled });
  } catch (error) { next(error); }
});

quizzes.put('/quizzes/:quizId/attempt/draft', allowRoles('student'), async (req, res, next) => {
  try {
    const parsed = z.object({ attemptId: z.string().uuid(), answers: z.record(z.string(), z.array(z.string().max(40)).max(10)) }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Please provide valid quiz answers.' });
    const { data: attempt, error: attemptError } = await adminSupabase.from('quiz_attempts').select('id,quiz_id,student_id,started_at,submitted_at').eq('id', parsed.data.attemptId).eq('quiz_id', req.params.quizId).maybeSingle();
    if (attemptError || !attempt || attempt.student_id !== req.user.id) return res.status(404).json({ error: 'Quiz attempt not found.' });
    if (attempt.submitted_at) return res.status(409).json({ error: 'This quiz attempt has already been submitted.' });
    const { data: quiz, error: quizError } = await adminSupabase.from('quizzes').select('time_limit_minutes').eq('id', attempt.quiz_id).single();
    if (quizError) throw quizError;
    if (Date.now() > new Date(attempt.started_at).getTime() + (quiz.time_limit_minutes * 60 + 10) * 1000) return res.status(409).json({ error: 'The quiz timer has expired.' });
    const { data: questions, error: questionError } = await adminSupabase.from('quiz_questions').select('id,options').eq('quiz_id', attempt.quiz_id);
    if (questionError) throw questionError;
    const allowed = new Map(questions.map((question) => [question.id, new Set((question.options || []).map((option) => option.id))]));
    for (const [questionId, optionIds] of Object.entries(parsed.data.answers)) {
      const options = allowed.get(questionId);
      if (!options || optionIds.some((optionId) => !options.has(optionId))) return res.status(422).json({ error: 'One or more selected answers are invalid.' });
    }
    const { error: saveError } = await adminSupabase.from('quiz_attempts').update({ answers: parsed.data.answers }).eq('id', attempt.id).is('submitted_at', null);
    if (saveError) throw saveError;
    res.json({ saved: true });
  } catch (error) { next(error); }
});

quizzes.post('/quizzes/:quizId/attempt/submit', allowRoles('student'), async (req, res, next) => {
  try {
    const parsed = z.object({ attemptId: z.string().uuid(), answers: z.record(z.string(), z.array(z.string().max(40)).max(10)) }).safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Please provide valid quiz answers.' });
    const { data: attempt, error: attemptError } = await adminSupabase.from('quiz_attempts').select('id,quiz_id,student_id,started_at,submitted_at').eq('id', parsed.data.attemptId).eq('quiz_id', req.params.quizId).maybeSingle();
    if (attemptError || !attempt || attempt.student_id !== req.user.id) return res.status(404).json({ error: 'Quiz attempt not found.' });
    if (attempt.submitted_at) return res.status(409).json({ error: 'This quiz attempt has already been submitted.' });
    const { data: quiz } = await adminSupabase.from('quizzes').select('time_limit_minutes').eq('id', attempt.quiz_id).single();
    if (Date.now() > new Date(attempt.started_at).getTime() + (quiz.time_limit_minutes * 60 + 10) * 1000) return res.status(409).json({ error: 'The quiz timer has expired.' });
    const score = await scoreAnswers(attempt.quiz_id, parsed.data.answers);
    const { data, error } = await adminSupabase.from('quiz_attempts').update({ answers: parsed.data.answers, score, submitted_at: new Date().toISOString() }).eq('id', attempt.id).is('submitted_at', null).select('id,score,submitted_at').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'This quiz attempt has already been submitted.' });
    await adminSupabase.from('audit_log').insert({ actor_id: req.user.id, action: 'quiz.attempt_submitted', entity: 'quiz_attempt', entity_id: data.id, details: { score } });
    res.json({ result: data });
  } catch (error) { next(error); }
});

quizzes.get('/quizzes/:quizId/results', allowRoles('admin','teacher'), async (req, res, next) => {
  try {
    const { data: quiz, error: quizError } = await adminSupabase.from('quizzes').select('id,course_id,title').eq('id', req.params.quizId).maybeSingle();
    if (quizError || !quiz || !(await canManageCourse(quiz.course_id, req.profile))) return res.status(404).json({ error: 'Quiz not found.' });
    const [{ data, error }, { data: questions, error: questionError }] = await Promise.all([
      adminSupabase.from('quiz_attempts').select('id,student_id,started_at,submitted_at,score,profiles:student_id(full_name,roll_no)').eq('quiz_id', quiz.id).order('submitted_at', { ascending: false }).limit(500),
      adminSupabase.from('quiz_questions').select('points').eq('quiz_id', quiz.id),
    ]);
    if (error || questionError) throw error || questionError;
    res.json({ quiz: { ...quiz, total_points: questions.reduce((sum, question) => sum + Number(question.points), 0) }, results: data });
  } catch (error) { next(error); }
});
