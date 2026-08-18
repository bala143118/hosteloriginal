-- Repairs installations that already had an older `announcements` table.
-- Safe to run after 20260814_create_announcements.sql and safe to re-run.
alter table public.announcements
  add column if not exists title text,
  add column if not exists message text,
  add column if not exists priority text,
  add column if not exists audience text,
  add column if not exists admin_name text,
  add column if not exists created_at timestamptz;

update public.announcements
set
  title = coalesce(nullif(trim(title), ''), 'Hostel announcement'),
  message = coalesce(nullif(trim(message), ''), 'No message provided.'),
  priority = case when priority in ('Normal', 'Important', 'Emergency') then priority else 'Normal' end,
  audience = case when audience in ('All Students', 'Boys Hostel', 'Girls Hostel', 'Specific Block') then audience else 'All Students' end,
  admin_name = coalesce(nullif(trim(admin_name), ''), 'Hostel Administration'),
  created_at = coalesce(created_at, now());

alter table public.announcements
  alter column title set not null,
  alter column message set not null,
  alter column priority set default 'Normal',
  alter column priority set not null,
  alter column audience set not null,
  alter column admin_name set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);
