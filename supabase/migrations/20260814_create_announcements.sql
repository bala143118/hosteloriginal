create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  message text not null check (char_length(trim(message)) > 0),
  priority text not null default 'Normal'
    check (priority in ('Normal', 'Important', 'Emergency')),
  audience text not null
    check (audience in ('All Students', 'Boys Hostel', 'Girls Hostel', 'Specific Block')),
  admin_name text not null check (char_length(trim(admin_name)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);

alter table public.announcements enable row level security;

-- The Node backend uses the service_role key, which bypasses RLS. Do not add a
-- public read/write policy unless browser clients are intentionally authorized.
