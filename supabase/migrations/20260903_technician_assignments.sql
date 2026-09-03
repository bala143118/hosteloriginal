-- ============================================================================
-- Migration: 20260903_technician_assignments.sql
-- Description: Extend users table for dynamic Warden & Technician management,
--              first-time password change flags, and technician assignments.
-- ============================================================================

-- 1. Extend USERS table with fields for Warden & Technician criteria and Auth state
alter table if exists public.users add column if not exists must_change_password boolean default false;
alter table if exists public.users add column if not exists emergency_contact text default '';
alter table if exists public.users add column if not exists profile_photo text default '';
alter table if exists public.users add column if not exists address text default '';
alter table if exists public.users add column if not exists shift text default 'General Shift (9 AM - 5 PM)';
alter table if exists public.users add column if not exists department text default '';
alter table if exists public.users add column if not exists admin_id text default '';
alter table if exists public.users add column if not exists admin_email text default '';
alter table if exists public.users add column if not exists gender text default 'Male';
alter table if exists public.users add column if not exists specialization text default 'General Maintenance';

create index if not exists idx_users_must_change_pwd on public.users(must_change_password);
create index if not exists idx_users_role on public.users(role);

-- 2. TECHNICIAN ASSIGNMENTS TABLE
create table if not exists public.technician_assignments (
  id uuid primary key default gen_random_uuid(),
  technician_id text not null,
  technician_name text not null,
  email text not null,
  phone text default '',
  specialization text not null default 'General Maintenance',
  department text not null default 'Maintenance Department',
  hostel_block text not null default 'All Blocks',
  shift text not null default 'General Shift (9 AM - 5 PM)',
  gender text default 'Male',
  emergency_contact text default '',
  profile_photo text default '',
  address text default '',
  status text not null default 'Active',
  admin_id text default '',
  admin_email text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tech_assignments_tech_id on public.technician_assignments(technician_id);
create index if not exists idx_tech_assignments_email on public.technician_assignments(email);
create index if not exists idx_tech_assignments_status on public.technician_assignments(status);

-- Automatic updated_at trigger
drop trigger if exists set_tech_assignments_updated_at on public.technician_assignments;
create trigger set_tech_assignments_updated_at
  before update on public.technician_assignments
  for each row execute function public.handle_updated_at();

-- 3. RLS POLICIES
alter table public.technician_assignments enable row level security;
drop policy if exists "Enable all for technician_assignments" on public.technician_assignments;
create policy "Enable all for technician_assignments" on public.technician_assignments for all using (true) with check (true);
