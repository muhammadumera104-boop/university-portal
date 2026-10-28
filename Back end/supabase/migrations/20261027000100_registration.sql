-- Self-registration with administrator approval. Additive and safe to run more than once.
alter table public.profiles add column if not exists registration_status text not null default 'approved';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_registration_status_check') then
    alter table public.profiles add constraint profiles_registration_status_check check (registration_status in ('approved', 'pending', 'rejected'));
  end if;
end $$;
create index if not exists profiles_registration_idx on public.profiles(registration_status) where registration_status <> 'approved';
-- Browsers must never change this column; only the API (service role) does.
