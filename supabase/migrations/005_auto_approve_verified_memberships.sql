-- Automatically activate verified hotel memberships for beta self-service.
-- Members may select supervisor, technician, or staff; nobody can self-assign
-- hotel_manager. Rejected or suspended memberships still require manager review.

create or replace function public.request_hotel_membership(_hotel_id uuid, _requested_role text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_hotel_slug text;
  v_membership_id uuid;
  v_status text;
begin
  if v_actor is null then raise exception 'Authenticated actor required'; end if;
  if not exists (
    select 1 from auth.users u
    where u.id = v_actor and u.email_confirmed_at is not null
  ) then
    raise exception 'A verified email is required';
  end if;
  if _requested_role not in ('supervisor','technician','staff') then
    raise exception 'Invalid requested role';
  end if;
  select h.slug into v_hotel_slug from public.hotels h where h.id = _hotel_id and h.status = 'active';
  if not found then
    raise exception 'Active hotel not found';
  end if;

  select m.id, m.status into v_membership_id, v_status
    from public.hotel_memberships m
    where m.hotel_id = _hotel_id and m.user_id = v_actor
    for update;

  -- Automatic membership is deliberately confined to the public beta tenant.
  -- Other hotels retain the original manager-approved request flow.
  if v_hotel_slug <> 'hotel-demo' then
    if not found then
      insert into public.hotel_memberships(hotel_id, user_id, role, status)
      values (_hotel_id, v_actor, _requested_role, 'pending')
      returning id into v_membership_id;
      return v_membership_id;
    end if;
    if v_status in ('pending','active') then
      raise exception 'A pending request or active membership already exists';
    end if;
    update public.hotel_memberships
      set role = _requested_role, status = 'pending', requested_at = clock_timestamp(),
          approved_by = null, approved_at = null,
          rejected_by = null, rejected_at = null, rejection_reason = null,
          revoked_by = null, revoked_at = null, revocation_reason = null
      where id = v_membership_id;
    return v_membership_id;
  end if;

  if not found then
    insert into public.hotel_memberships(hotel_id, user_id, role, status, approved_at)
    values (_hotel_id, v_actor, _requested_role, 'active', clock_timestamp())
    returning id into v_membership_id;
    return v_membership_id;
  end if;
  if v_status = 'pending' then
    update public.hotel_memberships
      set role = _requested_role, status = 'active',
          approved_by = null, approved_at = clock_timestamp(),
          rejected_by = null, rejected_at = null, rejection_reason = null,
          revoked_by = null, revoked_at = null, revocation_reason = null
      where id = v_membership_id;
    return v_membership_id;
  end if;
  if v_status in ('rejected','suspended') then
    raise exception 'Membership requires hotel manager review';
  end if;
  raise exception 'An active membership already exists';
end;
$$;

revoke all on function public.request_hotel_membership(uuid, text) from public, anon;
grant execute on function public.request_hotel_membership(uuid, text) to authenticated;

-- Approve already-pending, email-confirmed beta users once. Keep rejected or
-- suspended users untouched so manager decisions cannot be bypassed.
update public.hotel_memberships m
set status = 'active', approved_by = null, approved_at = clock_timestamp()
from public.hotels h, auth.users u
where h.id = m.hotel_id
  and u.id = m.user_id
  and h.slug = 'hotel-demo'
  and h.status = 'active'
  and m.status = 'pending'
  and u.email_confirmed_at is not null;

