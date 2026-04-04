-- Run in Supabase SQL Editor after creating a project, or via supabase db push.
-- Stores full TripsState JSON per user (Option A from plan).

create table if not exists public.user_trips (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists user_trips_updated_at_idx on public.user_trips (updated_at desc);

alter table public.user_trips enable row level security;

create policy "user_trips_select_own"
  on public.user_trips for select
  using (auth.uid() = user_id);

create policy "user_trips_insert_own"
  on public.user_trips for insert
  with check (auth.uid() = user_id);

create policy "user_trips_update_own"
  on public.user_trips for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_trips_delete_own"
  on public.user_trips for delete
  using (auth.uid() = user_id);

-- Optional profile row for display name (synced from signup metadata in app).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
