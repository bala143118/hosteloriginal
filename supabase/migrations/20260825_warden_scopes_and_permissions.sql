-- ============================================================================
-- Migration: 20260825_warden_scopes_and_permissions.sql
-- Description: Warden Control Scopes, Granular RBAC Permissions, Notifications, and Schema Extensions
-- ============================================================================

-- 1. Extend USERS table with status, hostel, floor, and warden references if not already present
alter table if exists public.users add column if not exists status text default 'Active';
alter table if exists public.users add column if not exists hostel text default 'Main Hostel';
alter table if exists public.users add column if not exists floor text default '1';
alter table if exists public.users add column if not exists warden_id text default '';
alter table if exists public.users add column if not exists warden_email text default '';
alter table if exists public.users add column if not exists warden_name text default '';

-- 2. WARDEN SCOPES TABLE
create table if not exists public.warden_scopes (
  id uuid primary key default gen_random_uuid(),
  warden_id text not null,
  hostel text not null default 'All',
  block text not null default 'All',
  floors text not null default 'All',
  rooms text not null default 'All',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_warden_scopes_warden_id on public.warden_scopes(warden_id);
create index if not exists idx_warden_scopes_active on public.warden_scopes(is_active);

-- Automatic updated_at trigger for warden_scopes
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_warden_scopes_updated_at on public.warden_scopes;
create trigger set_warden_scopes_updated_at
  before update on public.warden_scopes
  for each row execute function public.handle_updated_at();

-- 3. WARDEN PERMISSIONS TABLE
create table if not exists public.warden_permissions (
  id uuid primary key default gen_random_uuid(),
  warden_id text unique not null,
  permissions jsonb not null default '[
    "view_students",
    "manage_students",
    "view_gatepasses",
    "approve_gatepasses",
    "view_complaints",
    "manage_complaints",
    "view_laundry",
    "manage_laundry",
    "view_announcements",
    "create_announcements",
    "view_inventory",
    "manage_inventory",
    "view_alerts",
    "view_cctv",
    "receive_security_alerts"
  ]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_warden_permissions_warden_id on public.warden_permissions(warden_id);

drop trigger if exists set_warden_permissions_updated_at on public.warden_permissions;
create trigger set_warden_permissions_updated_at
  before update on public.warden_permissions
  for each row execute function public.handle_updated_at();

-- 4. NOTIFICATIONS TABLE
create table if not exists public.notifications (
  id text primary key,
  recipient_id text default '',
  recipient_email text default '',
  recipient_role text default '',
  title text not null,
  message text not null,
  type text not null default 'general',
  priority text not null default 'Normal' check (priority in ('Normal', 'Important', 'Emergency', 'Low', 'Medium', 'High')),
  read boolean not null default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_id on public.notifications(recipient_id);
create index if not exists idx_notifications_recipient_email on public.notifications(recipient_email);
create index if not exists idx_notifications_recipient_role on public.notifications(recipient_role);
create index if not exists idx_notifications_created_at on public.notifications(created_at desc);

-- 5. RLS POLICIES
alter table public.warden_scopes enable row level security;
alter table public.warden_permissions enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Enable all for warden_scopes" on public.warden_scopes;
create policy "Enable all for warden_scopes" on public.warden_scopes for all using (true) with check (true);

drop policy if exists "Enable all for warden_permissions" on public.warden_permissions;
create policy "Enable all for warden_permissions" on public.warden_permissions for all using (true) with check (true);

drop policy if exists "Enable all for notifications" on public.notifications;
create policy "Enable all for notifications" on public.notifications for all using (true) with check (true);
