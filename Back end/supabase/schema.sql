-- Run in the Supabase SQL Editor. Auth users are created by Supabase Auth.
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'teacher', 'student');
create type public.course_status as enum ('draft', 'published', 'archived');
create type public.submission_status as enum ('draft', 'submitted', 'graded', 'returned');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null unique,
  role public.app_role not null default 'student',
  roll_no text unique,
  job_title text not null default '',
  department text not null default '',
  avatar_url text,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('CRS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  title text not null check (char_length(title) between 2 and 120),
  description text not null default '',
  category text not null default 'General',
  status public.course_status not null default 'draft',
  is_archived boolean not null default false,
  cover_color text not null default 'indigo',
  instructor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_teachers (
  course_id uuid not null references public.courses(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (course_id, teacher_id)
);

create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  description text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique(course_id, position)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete cascade,
  title text not null,
  content jsonb not null default '{}'::jsonb,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique(module_id, position)
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  progress integer not null default 0 check (progress between 0 and 100),
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(course_id, student_id)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  instructions text not null default '',
  due_at timestamptz not null,
  max_marks numeric(6,2) not null default 100 check (max_marks > 0),
  allow_late boolean not null default false,
  attachment_path text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  text_answer text,
  file_path text,
  attachment_url text,
  status public.submission_status not null default 'draft',
  score numeric check (score >= 0),
  marks_obtained numeric(6,2),
  is_late boolean not null default false,
  feedback text not null default '',
  graded_by uuid references public.profiles(id),
  submitted_at timestamptz,
  graded_at timestamptz,
  unique(assignment_id, student_id)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 160),
  body text not null check (char_length(body) between 1 and 5000),
  course_id uuid references public.courses(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.announcement_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, announcement_id)
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  description text not null default '',
  time_limit_minutes integer not null check (time_limit_minutes > 0),
  attempts_allowed integer not null default 1 check (attempts_allowed > 0),
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null default (now() + interval '7 days'),
  is_published boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  prompt text not null,
  question_type text not null check (question_type in ('mcq_single', 'mcq_multi', 'true_false')),
  options jsonb not null default '[]'::jsonb,
  points numeric(5,2) not null default 1 check (points > 0),
  position integer not null default 0
);

create table public.quiz_answers (
  question_id uuid primary key references public.quiz_questions(id) on delete cascade,
  correct_option_ids text[] not null
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  score numeric check (score >= 0),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique(quiz_id, student_id)
);

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique(lesson_id, student_id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text not null default '',
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  complainant_id uuid not null references public.profiles(id) on delete restrict,
  course_id uuid references public.courses(id) on delete set null,
  category text not null,
  subject text not null check (char_length(subject) between 2 and 160),
  description text not null check (char_length(description) between 1 and 10000),
  attachment_path text,
  status text not null default 'open' check (status in ('open','in_review','resolved','rejected')),
  admin_response text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.complaint_comments (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index courses_instructor_idx on public.courses(instructor_id);
create index courses_status_idx on public.courses(status);
create index course_teachers_teacher_idx on public.course_teachers(teacher_id);
create index enrollments_student_idx on public.enrollments(student_id);
create index assignments_course_due_idx on public.assignments(course_id, due_at);
create index submissions_student_idx on public.submissions(student_id);
create index announcements_created_idx on public.announcements(created_at desc);
create index quiz_attempts_student_idx on public.quiz_attempts(student_id);
create index lesson_progress_student_idx on public.lesson_progress(student_id);
create index audit_log_created_idx on public.audit_log(created_at desc);
create index resources_course_title_idx on public.resources(course_id, title);
create index chat_messages_course_created_idx on public.chat_messages(course_id, created_at desc);
create index complaints_queue_idx on public.complaints(status, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger courses_set_updated_at before update on public.courses
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create or replace function public.user_is_enrolled(_course_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.enrollments where course_id = _course_id and student_id = _user_id)
$$;
create or replace function public.user_owns_course(_course_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.courses where id = _course_id and instructor_id = _user_id)
$$;
create or replace function public.user_owns_assignment(_assignment_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assignments a join public.course_teachers t on t.course_id=a.course_id where a.id = _assignment_id and t.teacher_id = _user_id)
$$;
create or replace function public.user_teaches_course(_course_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.course_teachers where course_id = _course_id and teacher_id = _user_id)
$$;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.user_is_enrolled(uuid, uuid) to authenticated;
grant execute on function public.user_owns_course(uuid, uuid) to authenticated;
grant execute on function public.user_owns_assignment(uuid, uuid) to authenticated;
grant execute on function public.user_teaches_course(uuid, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_modules enable row level security;
alter table public.lessons enable row level security;
alter table public.enrollments enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.announcements enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.audit_log enable row level security;
alter table public.course_teachers enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.resources enable row level security;
alter table public.chat_messages enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_comments enable row level security;
alter table public.notifications enable row level security;

create policy "Users view their own profile" on public.profiles for select to authenticated using (id = (select auth.uid()) or public.current_app_role() = 'admin');
create policy "Users update their own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Course access follows role and enrollment" on public.courses for select to authenticated using (
  public.current_app_role() = 'admin' or instructor_id = (select auth.uid()) or public.user_teaches_course(courses.id, (select auth.uid())) or
  (status = 'published' and public.user_is_enrolled(courses.id, (select auth.uid())))
);
create policy "Admins create courses" on public.courses for insert to authenticated with check (public.current_app_role()='admin');
create policy "Admins update courses" on public.courses for update to authenticated using (public.current_app_role()='admin') with check (public.current_app_role()='admin');
create policy "Admins archive courses" on public.courses for delete to authenticated using (public.current_app_role()='admin');
create policy "Admin manages teacher assignments" on public.course_teachers for all to authenticated using (public.current_app_role()='admin') with check (public.current_app_role()='admin');
create policy "Assigned teachers view own course assignments" on public.course_teachers for select to authenticated using (teacher_id=(select auth.uid()) or public.current_app_role()='admin');

create policy "Course members read modules" on public.course_modules for select to authenticated using (public.current_app_role()='admin' or public.user_teaches_course(course_modules.course_id, (select auth.uid())) or public.user_is_enrolled(course_modules.course_id, (select auth.uid())));
create policy "Teachers manage modules" on public.course_modules for all to authenticated using (public.current_app_role()='admin' or public.user_teaches_course(course_modules.course_id, (select auth.uid()))) with check (public.current_app_role()='admin' or public.user_teaches_course(course_modules.course_id, (select auth.uid())));
create policy "Course members read lessons" on public.lessons for select to authenticated using (public.current_app_role()='admin' or exists (select 1 from public.course_modules m where m.id=module_id and (public.user_teaches_course(m.course_id, (select auth.uid())) or public.user_is_enrolled(m.course_id, (select auth.uid())))));
create policy "Teachers manage lessons" on public.lessons for all to authenticated using (public.current_app_role()='admin' or exists(select 1 from public.course_modules m where m.id=lessons.module_id and public.user_teaches_course(m.course_id, (select auth.uid())))) with check (public.current_app_role()='admin' or exists(select 1 from public.course_modules m where m.id=lessons.module_id and public.user_teaches_course(m.course_id, (select auth.uid()))));

create policy "Enrollment visibility" on public.enrollments for select to authenticated using (student_id=(select auth.uid()) or public.current_app_role()='admin' or public.user_teaches_course(enrollments.course_id, (select auth.uid())));
create policy "Admins manage enrollments" on public.enrollments for insert to authenticated with check (public.current_app_role()='admin');
create policy "Course members read assignments" on public.assignments for select to authenticated using (public.current_app_role()='admin' or public.user_teaches_course(assignments.course_id, (select auth.uid())) or public.user_is_enrolled(assignments.course_id, (select auth.uid())));
create policy "Course teachers manage assignments" on public.assignments for all to authenticated using (public.current_app_role()='admin' or (public.current_app_role()='teacher' and created_by=(select auth.uid()) and public.user_teaches_course(assignments.course_id, (select auth.uid())))) with check (public.current_app_role()='admin' or (public.current_app_role()='teacher' and created_by=(select auth.uid()) and public.user_teaches_course(assignments.course_id, (select auth.uid()))));
create policy "Students read own submissions" on public.submissions for select to authenticated using (student_id=(select auth.uid()) or public.current_app_role()='admin' or (public.current_app_role()='teacher' and public.user_owns_assignment(submissions.assignment_id, (select auth.uid()))));
create policy "Students create own submissions" on public.submissions for insert to authenticated with check (student_id=(select auth.uid()) and public.current_app_role()='student' and exists(select 1 from public.assignments a where a.id=submissions.assignment_id and (a.due_at >= now() or a.allow_late=true)));
create policy "Students and teachers update submissions" on public.submissions for update to authenticated using (student_id=(select auth.uid()) or public.current_app_role()='admin' or (public.current_app_role()='teacher' and public.user_owns_assignment(submissions.assignment_id, (select auth.uid())))) with check ((student_id=(select auth.uid()) and status in ('draft','submitted') and exists(select 1 from public.assignments a where a.id=submissions.assignment_id and (a.due_at >= now() or a.allow_late=true))) or public.current_app_role()='admin' or (public.current_app_role()='teacher' and public.user_owns_assignment(submissions.assignment_id, (select auth.uid()))));
create policy "Staff create announcements" on public.announcements for insert to authenticated with check (author_id=(select auth.uid()) and (public.current_app_role()='admin' or (public.current_app_role()='teacher' and announcements.course_id is not null and public.user_teaches_course(announcements.course_id, (select auth.uid())))));
create policy "Authors and admins manage announcements" on public.announcements for update to authenticated using (author_id=(select auth.uid()) or public.current_app_role()='admin') with check (author_id=(select auth.uid()) or public.current_app_role()='admin');
create policy "Staff manage quizzes" on public.quizzes for all to authenticated using (public.current_app_role()='admin' or (public.current_app_role()='teacher' and public.user_teaches_course(quizzes.course_id, (select auth.uid())))) with check (public.current_app_role()='admin' or (public.current_app_role()='teacher' and public.user_teaches_course(quizzes.course_id, (select auth.uid()))));
create policy "Students read published enrolled quizzes" on public.quizzes for select to authenticated using (is_published=true and public.user_is_enrolled(quizzes.course_id, (select auth.uid())));
create policy "Members read quiz questions" on public.quiz_questions for select to authenticated using (public.current_app_role()='admin' or exists(select 1 from public.quizzes q where q.id=quiz_id and (public.user_teaches_course(q.course_id, (select auth.uid())) or public.user_is_enrolled(q.course_id, (select auth.uid())))));
create policy "Staff manage quiz questions" on public.quiz_questions for all to authenticated using (public.current_app_role()='admin' or exists(select 1 from public.quizzes q where q.id=quiz_id and public.user_teaches_course(q.course_id, (select auth.uid())))) with check (public.current_app_role()='admin' or exists(select 1 from public.quizzes q where q.id=quiz_id and public.user_teaches_course(q.course_id, (select auth.uid()))));
create policy "Quiz answers remain private" on public.quiz_answers for all to authenticated using (public.current_app_role()='admin' or exists(select 1 from public.quiz_questions q join public.quizzes z on z.id=q.quiz_id where q.id=quiz_answers.question_id and public.user_teaches_course(z.course_id, (select auth.uid())))) with check (public.current_app_role()='admin' or exists(select 1 from public.quiz_questions q join public.quizzes z on z.id=q.quiz_id where q.id=quiz_answers.question_id and public.user_teaches_course(z.course_id, (select auth.uid()))));
create policy "Students and course teachers manage attempts" on public.quiz_attempts for all to authenticated using (student_id=(select auth.uid()) or public.current_app_role()='admin' or exists(select 1 from public.quizzes q where q.id=quiz_attempts.quiz_id and public.user_teaches_course(q.course_id, (select auth.uid())))) with check (student_id=(select auth.uid()) or public.current_app_role()='admin' or exists(select 1 from public.quizzes q where q.id=quiz_attempts.quiz_id and public.user_teaches_course(q.course_id, (select auth.uid()))));
create policy "Students manage their lesson progress" on public.lesson_progress for all to authenticated using (student_id=(select auth.uid())) with check (student_id=(select auth.uid()));
create policy "Admins read audit log" on public.audit_log for select to authenticated using (public.current_app_role()='admin');
create policy "Members read course resources" on public.resources for select to authenticated using (public.current_app_role()='admin' or public.user_teaches_course(resources.course_id, (select auth.uid())) or public.user_is_enrolled(resources.course_id, (select auth.uid())));
create policy "Teachers manage own course resources" on public.resources for all to authenticated using (public.current_app_role()='admin' or (uploaded_by=(select auth.uid()) and public.user_teaches_course(resources.course_id, (select auth.uid())))) with check (public.current_app_role()='admin' or (uploaded_by=(select auth.uid()) and public.user_teaches_course(resources.course_id, (select auth.uid()))));
create policy "Members read course chat" on public.chat_messages for select to authenticated using (public.current_app_role()='admin' or public.user_teaches_course(chat_messages.course_id, (select auth.uid())) or public.user_is_enrolled(chat_messages.course_id, (select auth.uid())));
create policy "Members send course chat" on public.chat_messages for insert to authenticated with check (sender_id=(select auth.uid()) and (public.user_teaches_course(chat_messages.course_id, (select auth.uid())) or public.user_is_enrolled(chat_messages.course_id, (select auth.uid()))));
create policy "Members edit chat safely" on public.chat_messages for update to authenticated using ((sender_id=(select auth.uid()) and created_at > now()-interval '5 minutes') or public.current_app_role()='admin' or public.user_teaches_course(chat_messages.course_id, (select auth.uid()))) with check (sender_id=(select auth.uid()) or public.current_app_role()='admin' or public.user_teaches_course(chat_messages.course_id, (select auth.uid())));
create policy "Users file complaints" on public.complaints for insert to authenticated with check (complainant_id=(select auth.uid()) and public.current_app_role() in ('student','teacher'));
create policy "Users view own complaints admins view all" on public.complaints for select to authenticated using (complainant_id=(select auth.uid()) or public.current_app_role()='admin');
create policy "Admins resolve complaints" on public.complaints for update to authenticated using (public.current_app_role()='admin') with check (public.current_app_role()='admin');
create policy "Complainants and admins read complaint comments" on public.complaint_comments for select to authenticated using (public.current_app_role()='admin' or exists(select 1 from public.complaints c where c.id=complaint_id and c.complainant_id=(select auth.uid())));
create policy "Complainants add complaint followups" on public.complaint_comments for insert to authenticated with check (author_id=(select auth.uid()) and exists(select 1 from public.complaints c where c.id=complaint_id and c.complainant_id=(select auth.uid())));
create policy "Users mark own announcements read" on public.announcement_reads for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy "Users see eligible announcements" on public.announcements for select to authenticated using (course_id is null or public.current_app_role()='admin' or public.user_teaches_course(announcements.course_id, (select auth.uid())) or public.user_is_enrolled(announcements.course_id, (select auth.uid())));
create policy "Users manage own notifications" on public.notifications for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, job_title, department, avatar_url) on public.profiles to authenticated;
grant select, insert, update, delete on public.courses, public.course_modules, public.lessons, public.assignments, public.announcements, public.quizzes, public.quiz_questions to authenticated;
grant select, insert, update, delete on public.course_teachers, public.resources, public.chat_messages, public.complaints, public.complaint_comments, public.announcement_reads, public.notifications to authenticated;
grant select, insert on public.enrollments to authenticated;
grant select on public.submissions to authenticated;
grant insert (assignment_id, student_id, body, text_answer, file_path, attachment_url) on public.submissions to authenticated;
grant update (body, attachment_url, status, submitted_at) on public.submissions to authenticated;
grant select on public.quiz_attempts to authenticated;
grant select, insert on public.lesson_progress to authenticated;
grant select on public.audit_log to authenticated;
grant select, insert, update, delete on public.quiz_answers to authenticated;

create or replace view public.student_marks with (security_invoker = true) as
  select s.student_id, a.course_id, c.title as course_title, 'assignment'::text as item_type,
    a.id as item_id, a.title as item_title, s.marks_obtained as marks_obtained,
    a.max_marks as max_marks, s.status::text as status, s.graded_at
  from public.assignments a
  join public.courses c on c.id = a.course_id
  left join public.submissions s on s.assignment_id = a.id
  union all
  select attempts.student_id, q.course_id, c.title, 'quiz'::text, q.id, q.title,
    attempts.score, coalesce(question_totals.total_marks, 0),
    case when attempts.submitted_at is null then 'in_progress' else 'graded' end,
    attempts.submitted_at
  from public.quizzes q
  join public.courses c on c.id = q.course_id
  left join public.quiz_attempts attempts on attempts.quiz_id = q.id
  left join lateral (select sum(points) as total_marks from public.quiz_questions where quiz_id = q.id) question_totals on true
  where q.is_published = true;
grant select on public.student_marks to authenticated;

insert into storage.buckets (id, name, public, file_size_limit) values
  ('resources', 'resources', false, 26214400),
  ('complaints', 'complaints', false, 10485760)
on conflict (id) do update set public = false;

create policy "Members read private course resource objects" on storage.objects for select to authenticated using (
  bucket_id='resources' and (public.current_app_role()='admin' or public.user_teaches_course((storage.foldername(name))[1]::uuid, (select auth.uid())) or public.user_is_enrolled((storage.foldername(name))[1]::uuid, (select auth.uid())))
);
create policy "Teachers upload private course resources" on storage.objects for insert to authenticated with check (
  bucket_id='resources' and (public.current_app_role()='admin' or public.user_teaches_course((storage.foldername(name))[1]::uuid, (select auth.uid())))
);
create policy "Teachers delete private course resources" on storage.objects for delete to authenticated using (
  bucket_id='resources' and (public.current_app_role()='admin' or public.user_teaches_course((storage.foldername(name))[1]::uuid, (select auth.uid())))
);
create policy "Users manage own complaint attachments" on storage.objects for all to authenticated using (bucket_id='complaints' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.current_app_role()='admin')) with check (bucket_id='complaints' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.current_app_role()='admin'));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- Promote the first user in the SQL Editor: update public.profiles set role = 'admin', is_active = true where email = 'you@example.com';

-- ===== Hardening (identical to migrations/20261027000000_hardening.sql) =====
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

-- ===== Registration (identical to migrations/20261027000100_registration.sql) =====
-- Self-registration with administrator approval. Additive and safe to run more than once.
alter table public.profiles add column if not exists registration_status text not null default 'approved';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_registration_status_check') then
    alter table public.profiles add constraint profiles_registration_status_check check (registration_status in ('approved', 'pending', 'rejected'));
  end if;
end $$;
create index if not exists profiles_registration_idx on public.profiles(registration_status) where registration_status <> 'approved';
-- Browsers must never change this column; only the API (service role) does.
