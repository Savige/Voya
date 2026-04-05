-- Shared itineraries: canonical trip_json per share, link token, member roles, RLS, accept RPC.
--
-- If you see "relation public.profiles does not exist", either:
--   1) Run 001_user_trips_and_profiles.sql first (recommended — you need user_trips too), or
--   2) Rely on the block below, which creates profiles when missing.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own'
  ) then
    create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_insert_own'
  ) then
    create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_own'
  ) then
    create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
  end if;
end $$;

create table if not exists public.shared_itineraries (
  id uuid primary key default gen_random_uuid(),
  share_token text not null unique,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  source_trip_id text not null,
  trip_json jsonb not null,
  default_permission text not null check (default_permission in ('viewer', 'editor')),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists shared_itineraries_one_active_per_source
  on public.shared_itineraries (owner_user_id, source_trip_id)
  where revoked_at is null;

create index if not exists shared_itineraries_owner_idx on public.shared_itineraries (owner_user_id);
create index if not exists shared_itineraries_token_idx on public.shared_itineraries (share_token);

create table if not exists public.shared_itinerary_members (
  shared_itinerary_id uuid not null references public.shared_itineraries (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  joined_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (shared_itinerary_id, user_id)
);

create index if not exists shared_itinerary_members_user_idx on public.shared_itinerary_members (user_id);

alter table public.shared_itineraries enable row level security;
alter table public.shared_itinerary_members enable row level security;

-- shared_itineraries: owner always sees own rows; members see active shares only.
create policy "shared_itineraries_select"
  on public.shared_itineraries for select
  using (
    auth.uid() = owner_user_id
    or (
      revoked_at is null
      and exists (
        select 1 from public.shared_itinerary_members m
        where m.shared_itinerary_id = shared_itineraries.id
          and m.user_id = auth.uid()
          and m.revoked_at is null
      )
    )
  );

create policy "shared_itineraries_insert"
  on public.shared_itineraries for insert
  with check (auth.uid() = owner_user_id);

create policy "shared_itineraries_update_owner"
  on public.shared_itineraries for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create policy "shared_itineraries_update_editor"
  on public.shared_itineraries for update
  using (
    shared_itineraries.revoked_at is null
    and exists (
      select 1 from public.shared_itinerary_members m
      where m.shared_itinerary_id = shared_itineraries.id
        and m.user_id = auth.uid()
        and m.role = 'editor'
        and m.revoked_at is null
    )
  )
  with check (
    shared_itineraries.revoked_at is null
    and exists (
      select 1 from public.shared_itinerary_members m
      where m.shared_itinerary_id = shared_itineraries.id
        and m.user_id = auth.uid()
        and m.role = 'editor'
        and m.revoked_at is null
    )
  );

-- Members: self or share owner.
create policy "shared_itinerary_members_select"
  on public.shared_itinerary_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.shared_itineraries s
      where s.id = shared_itinerary_members.shared_itinerary_id
        and s.owner_user_id = auth.uid()
    )
  );

-- Inserts only via accept_shared_itinerary (security definer).
create policy "shared_itinerary_members_update_owner"
  on public.shared_itinerary_members for update
  using (
    exists (
      select 1 from public.shared_itineraries s
      where s.id = shared_itinerary_members.shared_itinerary_id
        and s.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.shared_itineraries s
      where s.id = shared_itinerary_members.shared_itinerary_id
        and s.owner_user_id = auth.uid()
    )
  );

-- Owner can read profiles of users who are (or were) members of their shares (for manage UI).
create policy "profiles_select_share_members"
  on public.profiles for select
  using (
    exists (
      select 1 from public.shared_itinerary_members sim
      join public.shared_itineraries si on si.id = sim.shared_itinerary_id
      where sim.user_id = profiles.id
        and si.owner_user_id = auth.uid()
    )
  );

create or replace function public.accept_shared_itinerary(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_share public.shared_itineraries%rowtype;
  v_role text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  if p_token is null or length(trim(p_token)) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Invalid or expired link');
  end if;

  select * into v_share
  from public.shared_itineraries
  where share_token = trim(p_token)
    and revoked_at is null
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invalid or expired link');
  end if;

  if v_share.owner_user_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'You already own this itinerary');
  end if;

  v_role := case when v_share.default_permission = 'viewer' then 'viewer' else 'editor' end;

  insert into public.shared_itinerary_members (shared_itinerary_id, user_id, role, joined_at)
  values (v_share.id, v_uid, v_role, now())
  on conflict (shared_itinerary_id, user_id) do update
    set revoked_at = null,
        role = excluded.role;

  return jsonb_build_object(
    'ok', true,
    'shared_itinerary_id', v_share.id,
    'source_trip_id', v_share.source_trip_id
  );
end;
$$;

grant execute on function public.accept_shared_itinerary(text) to authenticated;

revoke all on public.shared_itineraries from public;
revoke all on public.shared_itinerary_members from public;

grant select, insert, update on public.shared_itineraries to authenticated;
grant select, update on public.shared_itinerary_members to authenticated;

-- PostgREST (REST) keeps a schema cache; reload after DDL so Supabase client sees new tables.
notify pgrst, 'reload schema';
