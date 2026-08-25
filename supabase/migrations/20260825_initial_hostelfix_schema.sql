-- ============================================================================
-- HostelFix Comprehensive Supabase Database Schema Migration
-- Migration: 20260825_initial_hostelfix_schema.sql
-- ============================================================================

-- 1. EXTENSIONS
create extension if not exists "pgcrypto";

-- Helper function for automatic updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- 2. USERS TABLE
-- ============================================================================
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  user_id text unique not null,
  email text unique not null check (char_length(trim(email)) > 0),
  password text not null check (char_length(password) >= 4),
  name text not null check (char_length(trim(name)) > 0),
  role text not null check (role in ('student', 'technician', 'warden', 'security', 'admin')),
  room_number text default '',
  block text default '',
  registration_number text default '',
  phone text default '',
  specialization text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_email on public.users(email);
create index if not exists idx_users_user_id on public.users(user_id);
create index if not exists idx_users_role on public.users(role);

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
  before update on public.users
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 3. COMPLAINTS TABLE
-- ============================================================================
create table if not exists public.complaints (
  id text primary key,
  title text not null,
  description text not null,
  category text not null check (category in ('Electrical', 'Plumbing', 'Carpentry', 'HVAC', 'Cleaning', 'Appliance', 'General Maintenance', 'Other')),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Emergency')),
  status text not null default 'Pending' check (status in ('Pending', 'In Progress', 'Completed', 'Rejected')),
  block text not null,
  room_number text not null,
  student_id text default '',
  student_name text not null,
  student_email text not null,
  technician_id text default null,
  technician_name text default 'Unassigned',
  photo_url text default '',
  notes text default '',
  resolved_at timestamptz default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_complaints_status on public.complaints(status);
create index if not exists idx_complaints_student_email on public.complaints(student_email);
create index if not exists idx_complaints_technician_id on public.complaints(technician_id);
create index if not exists idx_complaints_created_at on public.complaints(created_at desc);

drop trigger if exists set_complaints_updated_at on public.complaints;
create trigger set_complaints_updated_at
  before update on public.complaints
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 4. GATE PASSES TABLE
-- ============================================================================
create table if not exists public.gate_passes (
  id text primary key,
  student_id text not null,
  student_name text not null,
  registration_number text default '',
  email text not null,
  room_number text not null,
  block text not null,
  reason text not null,
  destination text not null,
  parent_phone text default '',
  student_phone text default '',
  departure_date date not null,
  departure_time time not null,
  expected_return_date date not null,
  expected_return_time time not null,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Out', 'Returned', 'Overdue')),
  warden_approved_by text default '',
  warden_approved_at timestamptz default null,
  warden_notes text default '',
  actual_exit_at timestamptz default null,
  actual_entry_at timestamptz default null,
  signature text default '',
  qr_token text unique default '',
  student_photo text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gate_passes_student_id on public.gate_passes(student_id);
create index if not exists idx_gate_passes_status on public.gate_passes(status);
create index if not exists idx_gate_passes_departure_date on public.gate_passes(departure_date);
create index if not exists idx_gate_passes_created_at on public.gate_passes(created_at desc);

drop trigger if exists set_gate_passes_updated_at on public.gate_passes;
create trigger set_gate_passes_updated_at
  before update on public.gate_passes
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 5. LAUNDRY REQUESTS TABLE
-- ============================================================================
create table if not exists public.laundry_requests (
  id text primary key,
  student_id text not null,
  student_name text not null,
  student_email text not null,
  room_number text not null,
  block text not null,
  cloth_count integer not null default 1,
  cloth_types jsonb default '[]'::jsonb,
  notes text default '',
  photo_url text default '',
  status text not null default 'Requested' check (status in ('Requested', 'Scheduled', 'In Progress', 'Ready for Delivery', 'Completed', 'Cancelled')),
  pickup_date date default null,
  delivery_date date default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_laundry_student_email on public.laundry_requests(student_email);
create index if not exists idx_laundry_status on public.laundry_requests(status);
create index if not exists idx_laundry_created_at on public.laundry_requests(created_at desc);

drop trigger if exists set_laundry_requests_updated_at on public.laundry_requests;
create trigger set_laundry_requests_updated_at
  before update on public.laundry_requests
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 6. ANNOUNCEMENTS TABLE
-- ============================================================================
create table if not exists public.announcements (
  id text primary key,
  title text not null check (char_length(trim(title)) > 0),
  message text not null check (char_length(trim(message)) > 0),
  priority text not null default 'Normal' check (priority in ('Normal', 'Important', 'Emergency')),
  audience text not null default 'All Students' check (audience in ('All Students', 'Boys Hostel', 'Girls Hostel', 'Specific Block', 'Individual')),
  admin_name text not null default 'Hostel Administration',
  target_email text default '',
  type text default 'general',
  created_at timestamptz not null default now()
);

create index if not exists idx_announcements_created_at on public.announcements(created_at desc);
create index if not exists idx_announcements_priority on public.announcements(priority);
create index if not exists idx_announcements_target_email on public.announcements(target_email);

-- ============================================================================
-- 7. INVENTORY TABLE
-- ============================================================================
create table if not exists public.inventory (
  id text primary key,
  item_name text not null,
  category text not null,
  quantity integer not null default 0,
  unit text not null default 'units',
  min_stock integer not null default 5,
  location text default 'Central Maintenance Store',
  status text not null default 'In Stock' check (status in ('In Stock', 'Low Stock', 'Out of Stock')),
  last_restocked_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_category on public.inventory(category);
create index if not exists idx_inventory_status on public.inventory(status);

drop trigger if exists set_inventory_updated_at on public.inventory;
create trigger set_inventory_updated_at
  before update on public.inventory
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 8. SECURITY EVENTS TABLE
-- ============================================================================
create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_id text unique not null,
  camera_id text not null,
  student_id text default '',
  student_name text default 'Unknown person',
  timestamp timestamptz not null default now(),
  image_url text default '',
  status text not null default 'UNAUTHORIZED',
  reason text not null,
  acknowledged boolean not null default false,
  acknowledged_by text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_security_events_event_id on public.security_events(event_id);
create index if not exists idx_security_events_timestamp on public.security_events(timestamp desc);
create index if not exists idx_security_events_acknowledged on public.security_events(acknowledged);

-- ============================================================================
-- 9. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
alter table public.users enable row level security;
alter table public.complaints enable row level security;
alter table public.gate_passes enable row level security;
alter table public.laundry_requests enable row level security;
alter table public.announcements enable row level security;
alter table public.inventory enable row level security;
alter table public.security_events enable row level security;

-- Public/Anon Read-Write Policies for Authorized Application Operations
drop policy if exists "Enable read access for all users" on public.users;
create policy "Enable read access for all users" on public.users for select using (true);

drop policy if exists "Enable insert for all users" on public.users;
create policy "Enable insert for all users" on public.users for insert with check (true);

drop policy if exists "Enable update for all users" on public.users;
create policy "Enable update for all users" on public.users for update using (true);

drop policy if exists "Enable all for complaints" on public.complaints;
create policy "Enable all for complaints" on public.complaints for all using (true) with check (true);

drop policy if exists "Enable all for gate_passes" on public.gate_passes;
create policy "Enable all for gate_passes" on public.gate_passes for all using (true) with check (true);

drop policy if exists "Enable all for laundry_requests" on public.laundry_requests;
create policy "Enable all for laundry_requests" on public.laundry_requests for all using (true) with check (true);

drop policy if exists "Enable all for announcements" on public.announcements;
create policy "Enable all for announcements" on public.announcements for all using (true) with check (true);

drop policy if exists "Enable all for inventory" on public.inventory;
create policy "Enable all for inventory" on public.inventory for all using (true) with check (true);

drop policy if exists "Enable all for security_events" on public.security_events;
create policy "Enable all for security_events" on public.security_events for all using (true) with check (true);
