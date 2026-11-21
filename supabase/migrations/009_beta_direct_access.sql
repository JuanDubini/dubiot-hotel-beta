-- Self-service entry for the confirmed-email public beta tenant only.
-- Other hotels continue to require a manager's approval.
create or replace function public.request_hotel_membership(
  _hotel_id uuid,
  _requested_role text
) returns uuid
language plpgsql
security definer
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
  ) then raise exception 'A verified email is required'; end if;
  if _requested_role not in ('supervisor','technician','staff') then
    raise exception 'Invalid requested role';
  end if;

  select h.slug into v_hotel_slug
  from public.hotels h
  where h.id = _hotel_id and h.status = 'active';
  if not found then raise exception 'Active hotel not found'; end if;

  select m.id, m.status into v_membership_id, v_status
  from public.hotel_memberships m
  where m.hotel_id = _hotel_id and m.user_id = v_actor
  for update;

  if v_hotel_slug = 'hotel-demo' then
    if not found then
      insert into public.hotel_memberships(hotel_id,user_id,role,status,approved_at)
      values (_hotel_id,v_actor,_requested_role,'active',clock_timestamp())
      returning id into v_membership_id;
      return v_membership_id;
    end if;
    if v_status = 'pending' then
      update public.hotel_memberships
      set role=_requested_role,status='active',requested_at=coalesce(requested_at,clock_timestamp()),
          approved_by=null,approved_at=clock_timestamp(),
          rejected_by=null,rejected_at=null,rejection_reason=null,
          revoked_by=null,revoked_at=null,revocation_reason=null
      where id=v_membership_id;
      return v_membership_id;
    end if;
    if v_status = 'active' then return v_membership_id; end if;
    raise exception 'Rejected or suspended demo access requires manager review';
  end if;

  -- Non-demo hotels keep manager approval and cannot be self-elevated.
  if not found then
    insert into public.hotel_memberships(hotel_id,user_id,role,status)
    values (_hotel_id,v_actor,_requested_role,'pending')
    returning id into v_membership_id;
    return v_membership_id;
  end if;
  if v_status = 'pending' then
    update public.hotel_memberships set role=_requested_role,requested_at=clock_timestamp()
    where id=v_membership_id;
    return v_membership_id;
  end if;
  if v_status = 'active' then return v_membership_id; end if;
  raise exception 'Rejected or suspended membership requires hotel manager review';
end;
$$;

revoke all on function public.request_hotel_membership(uuid,text) from public,anon;
grant execute on function public.request_hotel_membership(uuid,text) to authenticated;

create or replace function public.request_hotel_membership_by_slug(_hotel_slug text,_requested_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_hotel_id uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required'; end if;
  select h.id into v_hotel_id from public.hotels h
  where h.slug=lower(trim(_hotel_slug)) and h.status='active';
  if not found then raise exception 'Active hotel not found'; end if;
  return public.request_hotel_membership(v_hotel_id,_requested_role);
end;
$$;

revoke all on function public.request_hotel_membership_by_slug(text,text) from public,anon;
grant execute on function public.request_hotel_membership_by_slug(text,text) to authenticated;

