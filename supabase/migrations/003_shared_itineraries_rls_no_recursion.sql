-- Fix "infinite recursion detected in policy for relation shared_itineraries".
-- Policies on shared_itineraries and shared_itinerary_members referenced each other;
-- use SECURITY DEFINER helpers so membership/owner checks do not re-enter RLS.

create or replace function public.si_is_active_member(p_share_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.shared_itinerary_members m
    where m.shared_itinerary_id = p_share_id
      and m.user_id = p_uid
      and m.revoked_at is null
  );
$$;

create or replace function public.si_is_active_editor(p_share_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.shared_itinerary_members m
    where m.shared_itinerary_id = p_share_id
      and m.user_id = p_uid
      and m.role = 'editor'
      and m.revoked_at is null
  );
$$;

create or replace function public.si_is_share_owner(p_share_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.shared_itineraries s
    where s.id = p_share_id
      and s.owner_user_id = p_uid
  );
$$;

create or replace function public.si_profile_visible_to_share_owner(p_profile_user_id uuid, p_viewer uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.shared_itinerary_members sim
    join public.shared_itineraries si on si.id = sim.shared_itinerary_id
    where sim.user_id = p_profile_user_id
      and si.owner_user_id = p_viewer
  );
$$;

grant execute on function public.si_is_active_member(uuid, uuid) to authenticated;
grant execute on function public.si_is_active_editor(uuid, uuid) to authenticated;
grant execute on function public.si_is_share_owner(uuid, uuid) to authenticated;
grant execute on function public.si_profile_visible_to_share_owner(uuid, uuid) to authenticated;

drop policy if exists "shared_itineraries_select" on public.shared_itineraries;
drop policy if exists "shared_itineraries_update_editor" on public.shared_itineraries;
drop policy if exists "shared_itinerary_members_select" on public.shared_itinerary_members;
drop policy if exists "shared_itinerary_members_update_owner" on public.shared_itinerary_members;
drop policy if exists "profiles_select_share_members" on public.profiles;

create policy "shared_itineraries_select"
  on public.shared_itineraries for select
  using (
    auth.uid() = owner_user_id
    or (
      revoked_at is null
      and public.si_is_active_member(id, auth.uid())
    )
  );

create policy "shared_itineraries_update_editor"
  on public.shared_itineraries for update
  using (
    revoked_at is null
    and public.si_is_active_editor(id, auth.uid())
  )
  with check (
    revoked_at is null
    and public.si_is_active_editor(id, auth.uid())
  );

create policy "shared_itinerary_members_select"
  on public.shared_itinerary_members for select
  using (
    user_id = auth.uid()
    or public.si_is_share_owner(shared_itinerary_id, auth.uid())
  );

create policy "shared_itinerary_members_update_owner"
  on public.shared_itinerary_members for update
  using (public.si_is_share_owner(shared_itinerary_id, auth.uid()))
  with check (public.si_is_share_owner(shared_itinerary_id, auth.uid()));

create policy "profiles_select_share_members"
  on public.profiles for select
  using (public.si_profile_visible_to_share_owner(id, auth.uid()));

notify pgrst, 'reload schema';
