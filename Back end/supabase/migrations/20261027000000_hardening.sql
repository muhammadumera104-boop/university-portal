-- Additive hardening. Safe to run more than once; drops no tables and deletes no rows.

-- 1. Accounts created outside the admin screen (for example a public Auth sign-up) start inactive,
--    so they cannot use the API. The admin "create account" endpoint activates the profiles it creates.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, is_active)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''), false)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 2. Private bucket for assignment submission files. No storage policies are granted to
--    authenticated users: only the API (service role) reads and writes it, after its own checks.
insert into storage.buckets (id, name, public, file_size_limit) values ('submissions', 'submissions', false, 26214400)
on conflict (id) do update set public = false;

-- 3. Marks list every enrolled student's assignments and published quizzes, including work that
--    has not been submitted yet, so "My marks" and the gradebook export show pending items.
drop view if exists public.student_marks;
create view public.student_marks with (security_invoker = true) as
  select e.student_id, a.course_id, c.title as course_title, 'assignment'::text as item_type,
    a.id as item_id, a.title as item_title, s.marks_obtained::numeric as marks_obtained,
    a.max_marks::numeric as max_marks, coalesce(s.status::text, 'not_submitted') as status, s.graded_at
  from public.enrollments e
  join public.assignments a on a.course_id = e.course_id
  join public.courses c on c.id = a.course_id
  left join public.submissions s on s.assignment_id = a.id and s.student_id = e.student_id
  union all
  select e.student_id, q.course_id, c.title, 'quiz'::text, q.id, q.title,
    attempts.score, coalesce(question_totals.total_marks, 0),
    case when attempts.id is null then 'not_started' when attempts.submitted_at is null then 'in_progress' else 'graded' end,
    attempts.submitted_at
  from public.enrollments e
  join public.quizzes q on q.course_id = e.course_id and q.is_published = true
  join public.courses c on c.id = q.course_id
  left join public.quiz_attempts attempts on attempts.quiz_id = q.id and attempts.student_id = e.student_id
  left join lateral (select sum(points) as total_marks from public.quiz_questions where quiz_id = q.id) question_totals on true;
grant select on public.student_marks to authenticated;
