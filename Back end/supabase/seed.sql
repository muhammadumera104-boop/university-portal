-- Optional local development seed. Run after promoting an Auth profile to admin.
insert into public.courses (code, title, description, category, status, instructor_id)
select 'GUTECH-101', 'Welcome to GU TECH', 'A starter course for exploring your LMS workspace.', 'General', 'published', p.id
from public.profiles p
where p.role = 'admin'
  and not exists (select 1 from public.courses c where c.code = 'GUTECH-101')
order by p.created_at
limit 1;
